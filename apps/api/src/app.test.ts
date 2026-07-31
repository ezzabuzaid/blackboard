import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { openai } from "@ai-sdk/openai"
import {
  SqliteContextStore,
  SqliteStreamStore,
  createVirtualSandbox,
} from "@deepagents/context"
import {
  SqliteApprovalMutex,
  SqliteMailboxStore,
  defineSandbox,
} from "@deepagents/experimental/zukhruf"
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { InMemoryFs } from "just-bash"

import agentSandbox, {
  disposeSandboxes,
  removeSandbox,
} from "./agent/sandbox.js"
import { scheduleTask } from "./agent/tools/schedule-task.js"
import { createApp, type AppDependencies } from "./app.js"
import { parseChatGPTTokens } from "./chatgpt.js"
import type { ListQueuedTurns, QueuedTurn } from "./chat/routes.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import {
  businessProfilePath,
  gtmBacklogPath,
  productSignalsPath,
  shareSandboxInstance,
  whatsappSandboxName,
} from "./group/sandbox.js"
import {
  WhatsAppGroup,
  WhatsAppGroupLimitError,
  type WhatsAppParticipant,
} from "./group/whatsapp.js"

type ChatRuntime = AppDependencies["runtime"]

const testGroupSandbox = shareSandboxInstance(
  defineSandbox(() => createVirtualSandbox({ fs: new InMemoryFs() }))
)
const testDataDirectory = "/test/zukhruf"
const testGroupConversation = { chatId: "test-room", userId: "user-1" }
const testGroupLimits = {
  notifications: 25,
  agentMessages: 100,
  transcriptMessages: 500,
}

function testGroupDependencies(resources: AsyncDisposableStack) {
  const database = new DatabaseSync(":memory:")
  resources.defer(() => database.close())
  return {
    store: new SqliteContextStore(database),
    streamStore: new SqliteStreamStore(database),
    mailboxStore: resources.use(new SqliteMailboxStore(":memory:")),
    approvalMutex: resources.use(new SqliteApprovalMutex(":memory:")),
    events: [],
    limits: testGroupLimits,
    persist: async () => {},
  }
}

function memoryRuntime(participants: WhatsAppParticipant[]) {
  return new WhatsAppChatRuntime({
    participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ":memory:",
    mailboxPath: ":memory:",
    approvalPath: ":memory:",
  })
}

function durableRuntime(
  participants: WhatsAppParticipant[],
  directory: string
) {
  return new WhatsAppChatRuntime({
    participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: join(directory, "group.sqlite"),
    mailboxPath: join(directory, "mailbox.sqlite"),
    approvalPath: join(directory, "approval.sqlite"),
  })
}

const unusedRuntime: ChatRuntime = {
  async post() {
    throw new Error("Unexpected post")
  },
  async snapshot() {
    throw new Error("Unexpected snapshot")
  },
  async stop() {
    throw new Error("Unexpected stop")
  },
  async subscribe() {
    throw new Error("Unexpected subscribe")
  },
}

const noQueuedTurns = async (): Promise<QueuedTurn[]> => []
function testApp({
  runtime = unusedRuntime,
  listQueuedTurns = noQueuedTurns,
}: {
  runtime?: ChatRuntime
  listQueuedTurns?: ListQueuedTurns
} = {}) {
  return createApp({ runtime, listQueuedTurns })
}

const app = testApp()

test("saved ChatGPT credentials are validated before use", () => {
  assert.deepEqual(
    parseChatGPTTokens(
      JSON.stringify({
        accessToken: "access",
        refreshToken: "refresh",
        accountId: "account",
        expiresAt: 1,
      })
    ),
    {
      accessToken: "access",
      refreshToken: "refresh",
      accountId: "account",
      expiresAt: 1,
    }
  )
  assert.throws(
    () => parseChatGPTTokens('{"accessToken":42}'),
    /Invalid saved ChatGPT credentials/
  )
})

test("health reports the linked agent", async () => {
  const response = await app.request("/api/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: "ok",
    agent: "zukhruf",
  })
})

test("group members share one sandbox instance", async () => {
  const maya = {
    chatId: "room-1:participant:0",
    userId: "user-1",
  }
  const omar = {
    chatId: "room-1:participant:1",
    userId: "user-1",
  }
  const lina = {
    chatId: "room-1:participant:2",
    userId: "user-1",
  }
  const paul = {
    chatId: "room-1:participant:3",
    userId: "user-1",
  }
  const [mayaSandbox, omarSandbox, linaSandbox, paulSandbox] =
    await Promise.all([
      testGroupSandbox(maya),
      testGroupSandbox(omar),
      testGroupSandbox(lina),
      testGroupSandbox(paul),
    ])

  assert.equal(mayaSandbox, omarSandbox)
  assert.equal(mayaSandbox, linaSandbox)
  assert.equal(mayaSandbox, paulSandbox)
  assert.equal(mayaSandbox.sandbox, omarSandbox.sandbox)
  assert.equal(mayaSandbox.sandbox, linaSandbox.sandbox)
  assert.equal(mayaSandbox.sandbox, paulSandbox.sandbox)
})

test("group rooms keep distinct sandboxes and share GTM source folders", () => {
  const firstRoom = { chatId: "room-1", userId: "user-1" }
  const secondRoom = { chatId: "room-2", userId: "user-1" }

  assert.notEqual(
    whatsappSandboxName(testDataDirectory, firstRoom),
    whatsappSandboxName(testDataDirectory, secondRoom)
  )
  assert.equal(
    businessProfilePath(testDataDirectory, firstRoom.userId),
    businessProfilePath(testDataDirectory, secondRoom.userId)
  )
  assert.notEqual(
    businessProfilePath(testDataDirectory, "user-1"),
    businessProfilePath(testDataDirectory, "user-2")
  )
  assert.equal(
    gtmBacklogPath(testDataDirectory, firstRoom.userId),
    gtmBacklogPath(testDataDirectory, secondRoom.userId)
  )
  assert.notEqual(
    gtmBacklogPath(testDataDirectory, "user-1"),
    gtmBacklogPath(testDataDirectory, "user-2")
  )
  assert.equal(
    productSignalsPath(testDataDirectory, firstRoom.userId),
    productSignalsPath(testDataDirectory, secondRoom.userId)
  )
  assert.notEqual(
    productSignalsPath(testDataDirectory, "user-1"),
    productSignalsPath(testDataDirectory, "user-2")
  )
})

test("room message POST returns before active participants settle", async () => {
  const participantStarted = Promise.withResolvers<void>()
  const releaseParticipant = Promise.withResolvers<void>()
  const participant = new MockLanguageModelV4({
    doStream: async () => {
      participantStarted.resolve()
      await releaseParticipant.promise
      return groupTextResponse("Nothing distinct to add.")
    },
  })
  await using runtime = memoryRuntime([
    {
      name: "Maya",
      source: "Research evidence.",
      model: participant,
    },
  ])

  try {
    const groupApp = testApp({ runtime })
    const request = () =>
      groupApp.request("/api/chat/chat-1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "message-1",
          content: "What should we do first?",
        }),
      })
    const response = await Promise.race([
      request(),
      sleep(2_000).then(() => {
        throw new Error("message POST waited for the participant")
      }),
    ])

    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), {
      message: {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "What should we do first?",
      },
    })
    assert.deepEqual(await (await request()).json(), {
      message: {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "What should we do first?",
      },
    })
    await participantStarted.promise

    const state = (await (
      await groupApp.request("/api/chat/chat-1/state")
    ).json()) as ReturnType<WhatsAppGroup["snapshot"]>
    assert.deepEqual(state, {
      messages: [
        {
          id: "message-1",
          sequence: 1,
          author: "user",
          content: "What should we do first?",
        },
      ],
      participants: [{ name: "Maya", source: "Research evidence." }],
      activity: {
        phase: "active",
        notification: 1,
        messageCount: 1,
        participants: [{ name: "Maya", state: "considering", replies: 0 }],
      },
      cursor: 4,
    })

    const settled = Promise.withResolvers<void>()
    using settlement = await runtime.subscribe(
      { chatId: "chat-1", userId: "local-user" },
      state.cursor,
      (event) => {
        if (event.type === "activity" && event.activity.type === "settled") {
          settled.resolve()
        }
      }
    )
    releaseParticipant.resolve()
    await settled.promise

    async function readEvents(headers?: Record<string, string>) {
      const controller = new AbortController()
      const response = await groupApp.request(
        `/api/chat/chat-1/events?after=${state.cursor}`,
        { headers, signal: controller.signal }
      )
      assert.equal(response.status, 200)
      assert.match(
        response.headers.get("content-type") ?? "",
        /text\/event-stream/
      )
      const reader = response.body!.getReader()
      let events = ""
      while (!events.includes("id: 6")) {
        const chunk = await reader.read()
        if (chunk.done) break
        events += new TextDecoder().decode(chunk.value, { stream: true })
      }
      controller.abort()
      await reader.cancel().catch(() => undefined)
      return events
    }

    const events = await readEvents()
    assert.doesNotMatch(events, /id: 4\n/)
    assert.match(events, /event: activity/)
    assert.match(events, /id: 5/)
    assert.match(events, /id: 6/)
    assert.match(events, /"type":"settled"/)

    const reconnected = await readEvents({ "Last-Event-ID": "4" })
    assert.doesNotMatch(reconnected, /id: 4\n/)
    assert.match(reconnected, /id: 5/)
    assert.match(reconnected, /id: 6/)
  } finally {
    releaseParticipant.resolve()
  }
})

test("room message and event cursors are validated at the boundary", async () => {
  for (const body of [
    null,
    {},
    { id: "", content: "Hello" },
    { id: "message-1", content: "   " },
  ]) {
    const response = await app.request("/api/chat/chat-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 400)
  }

  assert.equal(
    (await app.request("/api/chat/chat-1/events?after=-1")).status,
    400
  )
  assert.equal(
    (await app.request("/api/chat/chat-1/events?after=invalid")).status,
    400
  )
  assert.equal((await app.request("/api/chat/chat-1/stream")).status, 404)
  assert.equal(
    (
      await app.request("/api/chat", {
        method: "POST",
      })
    ).status,
    404
  )

  const oversized = await app.request("/api/chat/chat-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "message-1", content: "x".repeat(12_000) }),
  })
  assert.equal(oversized.status, 413)

  const limited = await testApp({
    runtime: {
      ...unusedRuntime,
      async post() {
        throw new WhatsAppGroupLimitError("Room is full")
      },
    },
  }).request("/api/chat/chat-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "message-1", content: "One more message" }),
  })
  assert.equal(limited.status, 409)
  assert.deepEqual(await limited.json(), { error: "Room is full" })
})

test("queued turns endpoint uses the requested chat", async () => {
  let received: { chatId: string; userId: string } | undefined
  const response = await testApp({
    listQueuedTurns: async (conversation) => {
      received = conversation
      return [
        {
          id: "turn-2",
          kind: "ask",
          input: "Self-scheduled task:\nResearch the side lead.",
        },
      ]
    },
  }).request("/api/chat/chat-1/turns")

  assert.equal(response.status, 200)
  assert.deepEqual(received, { chatId: "chat-1", userId: "local-user" })
  assert.deepEqual(await response.json(), {
    turns: [
      {
        id: "turn-2",
        kind: "ask",
        input: "Self-scheduled task:\nResearch the side lead.",
      },
    ],
  })
})

test("development CORS accepts a local fallback port", async () => {
  const response = await app.request("/api/health", {
    headers: { Origin: "http://localhost:5174" },
  })

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5174"
  )
})

test("schedule_task enqueues work for the same conversation", async () => {
  let received:
    | [{ chatId: string; userId: string }, { id: string; input: string }]
    | undefined
  const executeOptions = {
    toolCallId: "tool-call-1",
    messages: [],
    abortSignal: new AbortController().signal,
    context: {
      actor: {
        thread: {
          conversation: { chatId: "chat-1", userId: "local-user" },
        },
      },
      controlPlane: {
        async enqueue(
          conversation: { chatId: string; userId: string },
          turn: { id: string; input: string }
        ) {
          received = [conversation, turn]
          return "turn-2"
        },
      },
    },
  } as Parameters<typeof scheduleTask.execute>[1]

  const result = await scheduleTask.execute(
    { task: " Research the side lead. " },
    executeOptions
  )

  assert.deepEqual(received, [
    { chatId: "chat-1", userId: "local-user" },
    {
      id: "tool-call-1",
      input: "Self-scheduled task:\nResearch the side lead.",
    },
  ])
  assert.deepEqual(result, { turnId: "turn-2" })
})

test("sandbox persists its workspace and exposes WebGL through agent-browser", async () => {
  const conversation = { chatId: "chat-1", userId: "local-user" }

  try {
    const firstTurn = await agentSandbox(conversation)
    await firstTurn.sandbox.writeFiles([
      { path: "/workspace/probe.txt", content: "sandbox" },
      { path: "/workspace/output/sample.pdf", content: "%PDF-sample" },
    ])

    const secondTurn = await agentSandbox(conversation)
    assert.equal(
      await secondTurn.sandbox.readFile("/workspace/probe.txt"),
      "sandbox"
    )
    const workingDirectory = await secondTurn.sandbox.executeCommand("pwd")
    assert.deepEqual(workingDirectory, {
      stdout: "/workspace\n",
      stderr: "",
      exitCode: 0,
    })

    const inventory = await secondTurn.sandbox.executeCommand(
      "find /workspace -maxdepth 1 -type f -print | sort"
    )
    assert.deepEqual(inventory, {
      stdout: "/workspace/probe.txt\n",
      stderr: "",
      exitCode: 0,
    })

    const webgl = await secondTurn.sandbox.executeCommand(
      `agent-browser --cdp 9222 --json eval "Boolean(document.createElement('canvas').getContext('webgl2'))"`
    )
    assert.equal(webgl.exitCode, 0, webgl.stderr)
    assert.equal(JSON.parse(webgl.stdout).data.result, true)

    const artifact = await app.request("/api/chat/chat-1/artifacts/sample.pdf")
    assert.equal(artifact.status, 200)
    assert.equal(artifact.headers.get("content-type"), "application/pdf")
    assert.equal(
      artifact.headers.get("content-disposition"),
      "inline; filename*=UTF-8''sample.pdf"
    )
    assert.equal(await artifact.text(), "%PDF-sample")

    const missing = await app.request("/api/chat/chat-1/artifacts/missing.pdf")
    assert.equal(missing.status, 404)

    const traversal = await app.request(
      "/api/chat/chat-1/artifacts/%2E%2E%2Fprobe.txt"
    )
    assert.equal(traversal.status, 400)
  } finally {
    await disposeSandboxes()
    await removeSandbox(conversation)
  }
})

test("publishes a group reply before slower members finish", async () => {
  const releaseSlowMember = Promise.withResolvers<void>()
  const fastMemberContinued = Promise.withResolvers<void>()

  let fastCalls = 0
  const fast = new MockLanguageModelV4({
    doStream: async () => {
      fastCalls++
      if (fastCalls === 1) {
        return groupToolResponse("reply_to_group", "fast-reply", {
          message: "I can answer this now.",
        })
      }
      fastMemberContinued.resolve()
      return groupTextResponse("Reply posted.")
    },
  })

  let slowCalls = 0
  const slow = new MockLanguageModelV4({
    doStream: async () => {
      slowCalls++
      if (slowCalls === 1) await releaseSlowMember.promise
      return groupTextResponse("I have nothing useful to add.")
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "fast", source: "Fast answers.", model: fast },
        { name: "slow", source: "Careful checks.", model: slow },
      ],
    })
  )

  const published: { author: string; content: string }[] = []
  const sending = group.send("Can anyone answer?", ({ author, content }) => {
    published.push({ author, content })
  })
  const fastFinished = await Promise.race([
    fastMemberContinued.promise.then(() => true),
    sleep(2_000).then(() => false),
  ])
  const replyWasAlreadyPublic = published.some(
    ({ author }) => author === "fast"
  )

  releaseSlowMember.resolve()
  await sending

  assert.equal(fastFinished, true, "the fast member did not finish in time")
  assert.equal(
    replyWasAlreadyPublic,
    true,
    "the fast reply waited for the slower member"
  )
})

test("an active member sees a peer reply before its next model step", async () => {
  const lateMemberStarted = Promise.withResolvers<void>()
  const earlyReplyPublished = Promise.withResolvers<void>()
  const latePrompts: unknown[] = []

  let earlyCalls = 0
  const early = new MockLanguageModelV4({
    doStream: async () => {
      earlyCalls++
      if (earlyCalls === 1) {
        await lateMemberStarted.promise
        return groupToolResponse("reply_to_group", "early-reply", {
          message: "The answer is already covered.",
        })
      }
      return groupTextResponse("Reply posted.")
    },
  })

  let lateCalls = 0
  const late = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      lateCalls++
      latePrompts.push(prompt)
      if (lateCalls === 1) {
        lateMemberStarted.resolve()
        await earlyReplyPublished.promise
        return groupToolResponse("bash", "late-boundary", {
          command: "printf boundary",
          reasoning: "Create a safe model-step boundary.",
        })
      }
      if (JSON.stringify(prompt).includes("The answer is already covered.")) {
        return groupTextResponse("Nothing non-duplicative to add.")
      }
      return groupToolResponse("reply_to_group", "late-duplicate", {
        message: "The answer is already covered.",
      })
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "early", source: "Fast answers.", model: early },
        { name: "late", source: "Careful checks.", model: late },
      ],
    })
  )

  const messages = await group.send("What is the answer?", (message) => {
    if (message.author === "early") earlyReplyPublished.resolve()
  })

  assert.equal(lateCalls, 2)
  assert.match(JSON.stringify(latePrompts[1]), /Sender: early/)
  assert.match(
    JSON.stringify(latePrompts[1]),
    /The answer is already covered\./
  )
  assert.deepEqual(
    messages
      .filter(({ author }) => author !== "user")
      .map(({ author, content }) => ({ author, content })),
    [{ author: "early", content: "The answer is already covered." }]
  )
})

test("each group member uses its own telemetry", async () => {
  const firstStarts: unknown[] = []
  const secondStarts: unknown[] = []
  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: "first",
          source: "Discussion record.",
          model: new MockLanguageModelV4({
            doStream: groupTextResponse("Nothing to add."),
          }),
          telemetry: {
            functionId: "parent-chat:first",
            integrations: {
              onStart(event) {
                firstStarts.push(event)
              },
            },
          },
        },
        {
          name: "second",
          source: "Risk record.",
          model: new MockLanguageModelV4({
            doStream: groupTextResponse("Nothing to add."),
          }),
          telemetry: {
            functionId: "parent-chat:second",
            integrations: {
              onStart(event) {
                secondStarts.push(event)
              },
            },
          },
        },
      ],
    })
  )

  await group.send("Review this.")

  assert.match(JSON.stringify(firstStarts), /"functionId":"parent-chat:first"/)
  assert.doesNotMatch(JSON.stringify(firstStarts), /parent-chat:second/)
  assert.match(
    JSON.stringify(secondStarts),
    /"functionId":"parent-chat:second"/
  )
  assert.doesNotMatch(JSON.stringify(secondStarts), /parent-chat:first/)
})

test("coalesces human interventions posted while a batch is running", async () => {
  const firstNotificationStarted = Promise.withResolvers<void>()
  const releaseFirstNotification = Promise.withResolvers<void>()
  const prompts: unknown[] = []
  let calls = 0
  const member = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      calls++
      prompts.push(prompt)
      if (calls === 1) {
        firstNotificationStarted.resolve()
        await releaseFirstNotification.promise
      }
      return groupTextResponse("I have nothing useful to add.")
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "member", source: "Discussion record.", model: member },
      ],
    })
  )

  const published: { author: string; content: string }[] = []
  const sending = group.send(
    "Review the launch plan.",
    ({ author, content }) => {
      published.push({ author, content })
    }
  )
  const started = await Promise.race([
    firstNotificationStarted.promise.then(() => true),
    sleep(2_000).then(() => false),
  ])

  await Promise.all([
    group.post("Also consider accessibility."),
    group.post("Also consider offline use."),
  ])
  const interventionsWereAlreadyPublic = [
    "Also consider accessibility.",
    "Also consider offline use.",
  ].every((expected) =>
    published.some(
      ({ author, content }) => author === "user" && content === expected
    )
  )

  releaseFirstNotification.resolve()
  await sending

  assert.equal(started, true, "the first notification did not start in time")
  assert.equal(
    interventionsWereAlreadyPublic,
    true,
    "the interventions waited for the active member"
  )
  assert.equal(calls, 2, "overlapping interventions created multiple batches")
  for (const intervention of [
    "Also consider accessibility.",
    "Also consider offline use.",
  ]) {
    assert.equal(
      prompts.filter((prompt) => JSON.stringify(prompt).includes(intervention))
        .length,
      1,
      `"${intervention}" was not delivered exactly once`
    )
  }
})

test("every group member receives greetings concurrently and social replies stay voluntary", async () => {
  const firstNotificationStarted = Promise.withResolvers<void>()
  const firstParticipants = new Set<string>()
  let activeParticipationChecks = 0
  let maxActiveParticipationChecks = 0

  const enterFirstNotification = async (name: string) => {
    firstParticipants.add(name)
    activeParticipationChecks++
    maxActiveParticipationChecks = Math.max(
      maxActiveParticipationChecks,
      activeParticipationChecks
    )
    if (firstParticipants.size === 2) firstNotificationStarted.resolve()
    await Promise.race([
      firstNotificationStarted.promise,
      sleep(2_000).then(() => {
        throw new Error("members did not receive the notification concurrently")
      }),
    ])
    activeParticipationChecks--
  }

  let researcherCalls = 0
  let researcherTools: unknown
  const researcher = new MockLanguageModelV4({
    doStream: async ({ prompt, tools }) => {
      researcherTools = tools
      researcherCalls++
      if (researcherCalls === 1) {
        await enterFirstNotification("researcher")
        return JSON.stringify(prompt).includes("casual or social messages")
          ? groupToolResponse("reply_to_group", "social-reply", {
              message: "Hey! Good to see you.",
            })
          : groupTextResponse("Greetings are outside my source.")
      }
      return groupTextResponse("Reply posted.")
    },
  })

  let criticCalls = 0
  const criticPrompts: unknown[] = []
  const critic = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      criticCalls++
      criticPrompts.push(prompt)
      if (criticCalls === 1) await enterFirstNotification("critic")
      return groupTextResponse("I have nothing useful to add.")
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: "researcher",
          source: "Research evidence.",
          model: researcher,
          tools: {
            web_search: openai.tools.webSearch(),
          },
        },
        {
          name: "critic",
          source: "Risk record.",
          model: critic,
        },
      ],
    })
  )

  const messages = await group.send("Hi everyone!")

  assert.equal(maxActiveParticipationChecks, 2)
  assert.match(JSON.stringify(researcherTools), /openai\.web_search/)
  assert.deepEqual(
    messages.map(({ author, content }) => ({ author, content })),
    [
      {
        author: "user",
        content: "Hi everyone!",
      },
      {
        author: "researcher",
        content: "Hey! Good to see you.",
      },
    ]
  )
  assert.equal(
    JSON.stringify(criticPrompts.at(-1)).includes("Hey! Good to see you."),
    true,
    "the social reply is broadcast back to the other group member"
  )
})

test("a room survives a runtime restart and replays persisted events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zukhruf-room-"))
  const conversation = { chatId: "durable-chat", userId: "local-user" }
  const participants = [
    {
      name: "Maya",
      source: "Research evidence.",
      model: new MockLanguageModelV4({
        doStream: groupTextResponse("Nothing distinct to add."),
      }),
    },
  ]

  try {
    {
      await using runtime = durableRuntime(participants, directory)
      await runtime.post(conversation, {
        id: "message-1",
        content: "Keep this after restart.",
      })
      await waitForRoom(runtime, conversation, "settled")
    }

    await using runtime = durableRuntime(participants, directory)
    const snapshot = await runtime.snapshot(conversation)
    assert.deepEqual(
      snapshot.messages.map(({ id, author, content }) => ({
        id,
        author,
        content,
      })),
      [
        {
          id: "message-1",
          author: "user",
          content: "Keep this after restart.",
        },
      ]
    )
    assert.deepEqual(snapshot.participants, [
      { name: "Maya", source: "Research evidence." },
    ])
    assert.equal(snapshot.activity.phase, "settled")

    const replayed: number[] = []
    const replayComplete = Promise.withResolvers<void>()
    using subscription = await runtime.subscribe(
      conversation,
      snapshot.cursor - 2,
      (event) => {
        replayed.push(event.cursor)
        if (event.cursor === snapshot.cursor) replayComplete.resolve()
      }
    )
    await replayComplete.promise
    assert.deepEqual(replayed, [snapshot.cursor - 1, snapshot.cursor])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("runtime shutdown persists interrupted participant work as stopped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zukhruf-interrupted-room-"))
  const conversation = { chatId: "interrupted-chat", userId: "local-user" }
  const participantStarted = Promise.withResolvers<void>()
  const releaseParticipant = Promise.withResolvers<void>()
  const participants = [
    {
      name: "Maya",
      source: "Research evidence.",
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          participantStarted.resolve()
          await Promise.race([
            releaseParticipant.promise,
            new Promise<void>((resolve) =>
              abortSignal?.addEventListener("abort", () => resolve(), {
                once: true,
              })
            ),
          ])
          return groupTextResponse("Nothing distinct to add.")
        },
      }),
    },
  ]

  try {
    const firstRuntime = durableRuntime(participants, directory)
    await firstRuntime.post(conversation, {
      id: "message-1",
      content: "This work will be interrupted.",
    })
    await participantStarted.promise
    await firstRuntime[Symbol.asyncDispose]()

    await using secondRuntime = durableRuntime(participants, directory)
    const snapshot = await secondRuntime.snapshot(conversation)
    assert.equal(snapshot.activity.phase, "stopped")
    assert.equal(snapshot.activity.stopReason, "interrupted")
    assert.deepEqual(
      snapshot.messages.map(({ id, content }) => ({ id, content })),
      [
        {
          id: "message-1",
          content: "This work will be interrupted.",
        },
      ]
    )
  } finally {
    releaseParticipant.resolve()
    await rm(directory, { recursive: true, force: true })
  }
})

test("room stop cancels active participant work", async () => {
  const participantStarted = Promise.withResolvers<void>()
  const releaseParticipant = Promise.withResolvers<void>()
  let aborted = false
  const participant = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      participantStarted.resolve()
      await Promise.race([
        releaseParticipant.promise,
        new Promise<void>((resolve) =>
          abortSignal?.addEventListener(
            "abort",
            () => {
              aborted = true
              resolve()
            },
            { once: true }
          )
        ),
      ])
      return groupTextResponse("Nothing distinct to add.")
    },
  })
  await using runtime = memoryRuntime([
    {
      name: "Maya",
      source: "Research evidence.",
      model: participant,
    },
  ])

  try {
    const groupApp = testApp({ runtime })
    await groupApp.request("/api/chat/chat-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "message-1", content: "Keep working." }),
    })
    await participantStarted.promise

    const response = await groupApp.request("/api/chat/chat-1/stop", {
      method: "POST",
    })
    assert.equal(response.status, 200)
    const state = (await response.json()) as ReturnType<
      WhatsAppGroup["snapshot"]
    >
    assert.equal(state.activity.phase, "stopped")
    assert.equal(state.activity.stopReason, "user")
    assert.equal(aborted, true)
  } finally {
    releaseParticipant.resolve()
  }
})

test("the room stops at its public reply ceiling", async () => {
  let replies = 0
  const alwaysReplies = (name: string) =>
    new MockLanguageModelV4({
      doStream: async () =>
        groupToolResponse("reply_to_group", `${name}-${++replies}`, {
          message: `${name} reply ${replies}`,
        }),
    })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: "Maya",
          source: "Research evidence.",
          model: alwaysReplies("Maya"),
        },
        {
          name: "Omar",
          source: "Engineering record.",
          model: alwaysReplies("Omar"),
        },
      ],
      limits: {
        ...testGroupLimits,
        notifications: 10,
        agentMessages: 2,
      },
    })
  )

  const messages = await group.send("Debate forever.")
  assert.equal(messages.filter(({ author }) => author !== "user").length, 2)
  assert.equal(group.snapshot().activity.phase, "stopped")
  assert.equal(group.snapshot().activity.stopReason, "limit")
})

test("one participant failure does not erase successful replies", async () => {
  let usefulCalls = 0
  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: "Maya",
          source: "Research evidence.",
          model: new MockLanguageModelV4({
            doStream: async () => {
              usefulCalls++
              return usefulCalls === 1
                ? groupToolResponse("reply_to_group", "useful-reply", {
                    message: "Here is the useful result.",
                  })
                : groupTextResponse("Nothing else to add.")
            },
          }),
        },
        {
          name: "Omar",
          source: "Engineering record.",
          model: new MockLanguageModelV4({
            doStream: async () => {
              throw new Error("participant unavailable")
            },
          }),
        },
      ],
    })
  )

  const messages = await group.send("Please investigate.")
  assert.equal(
    messages.some(
      ({ author, content }) =>
        author === "Maya" && content === "Here is the useful result."
    ),
    true
  )
  assert.equal(group.snapshot().activity.phase, "settled")
  assert.equal(
    group.snapshot().activity.participants.find(({ name }) => name === "Omar")
      ?.state,
    "failed"
  )
})

test("participant identities cannot collide with the human author", async () => {
  const model = new MockLanguageModelV4({
    doStream: groupTextResponse("Nothing to add."),
  })
  await using resources = new AsyncDisposableStack()
  const dependencies = testGroupDependencies(resources)

  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: "USER", source: "Impersonation.", model }],
    }),
    /reserved/
  )
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "Maya", source: "Research evidence.", model },
        { name: "maya", source: "Engineering record.", model },
      ],
    }),
    /duplicated/
  )
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: "Maya\nAdmin", source: "Impersonation.", model }],
    }),
    /valid/
  )
})

async function waitForRoom(
  runtime: WhatsAppChatRuntime,
  conversation: { chatId: string; userId: string },
  phase: "settled" | "stopped"
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = await runtime.snapshot(conversation)
    if (snapshot.activity.phase === phase) return snapshot
    await sleep(10)
  }
  throw new Error(`Room did not become ${phase}`)
}

const groupUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const

function groupTextResponse(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: text },
        { type: "text-end" as const, id: "text-1" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "" },
          usage: groupUsage,
        },
      ],
    }),
  }
}

function groupToolResponse(
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>
) {
  return {
    stream: simulateReadableStream({
      chunks: [
        {
          type: "tool-call" as const,
          toolCallId,
          toolName,
          input: JSON.stringify(input),
        },
        {
          type: "finish" as const,
          finishReason: { unified: "tool-calls" as const, raw: "" },
          usage: groupUsage,
        },
      ],
    }),
  }
}
