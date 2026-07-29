import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { openai } from "@ai-sdk/openai"
import type { AgentRuntime } from "@deepagents/experimental/zukhruf"
import { simulateReadableStream, type UIMessage } from "ai"
import { MockLanguageModelV4 } from "ai/test"

import agentSandbox, {
  disposeSandboxes,
  removeSandbox,
} from "./agent/sandbox.js"
import { scheduleTask } from "./agent/tools/schedule-task.js"
import { createApp } from "./app.js"
import type { ChatRuntime, ChatStreamStore } from "./chat/chat-service.js"
import type { ListQueuedTurns, QueuedTurn } from "./chat/routes.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { WhatsAppGroup } from "./group/whatsapp.js"

const unusedRuntime: ChatRuntime = {
  async enqueue() {
    throw new Error("Unexpected enqueue")
  },
  observe() {
    throw new Error("Unexpected observe")
  },
}

const noQueuedTurns = async (): Promise<QueuedTurn[]> => []
const noStreams: ChatStreamStore = {
  async getStreamStatus() {
    return null
  },
}
function testApp({
  runtime = unusedRuntime,
  streams = noStreams,
  listQueuedTurns = noQueuedTurns,
}: {
  runtime?: ChatRuntime
  streams?: ChatStreamStore
  listQueuedTurns?: ListQueuedTurns
} = {}) {
  return createApp({ runtime, streams, listQueuedTurns })
}

const app = testApp()

test("health reports the linked agent", async () => {
  const response = await app.request("/api/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: "ok",
    agent: "zukhruf",
  })
})

test("chat rejects an invalid UI message", async () => {
  const response = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "chat-1",
      messages: [{ role: "user", content: "not a UI message" }],
    }),
  })

  assert.equal(response.status, 400)
})

test("chat enqueues the latest UI message as a Zukhruf turn", async () => {
  let received: Parameters<AgentRuntime["enqueue"]> | undefined
  const runtime: ChatRuntime = {
    async enqueue(...input) {
      received = input
      return {
        id: "stream-1",
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "start", messageId: "stream-1" })
            controller.enqueue({ type: "text-start", id: "text-1" })
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: "Hello",
            })
            controller.enqueue({ type: "text-end", id: "text-1" })
            controller.enqueue({ type: "finish", finishReason: "stop" })
            controller.close()
          },
        }),
      }
    },
    observe: unusedRuntime.observe,
  }
  const response = await testApp({ runtime }).request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "chat-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: " Hello " }],
        },
      ],
    }),
  })

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  assert.deepEqual(received, [
    { chatId: "chat-1", userId: "local-user" },
    { id: "message-1", input: "Hello" },
  ])
  assert.match(await response.text(), /"type":"text-delta"/)
})

test("chat streams group activity and volunteered replies as AI SDK data parts", async () => {
  let researcherCalls = 0
  const researcher = new MockLanguageModelV4({
    doStream: async () => {
      researcherCalls++
      return researcherCalls === 1
        ? groupToolResponse("reply_to_group", "research-reply", {
            message: "Start with one real customer workflow.",
          })
        : groupTextResponse("Reply posted.")
    },
  })
  const critic = new MockLanguageModelV4({
    doStream: async () => groupTextResponse("Nothing distinct to add."),
  })
  await using runtime = new WhatsAppChatRuntime([
    {
      name: "researcher",
      specialty: "Finds evidence.",
      model: researcher,
    },
    {
      name: "critic",
      specialty: "Finds missing assumptions.",
      model: critic,
    },
  ])

  const groupApp = testApp({ runtime })
  const response = await groupApp.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "chat-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "What should we do first?" }],
        },
      ],
    }),
  })

  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /"type":"data-groupActivity"/)
  assert.match(body, /"transient":true/)
  assert.match(body, /"type":"started"/)
  assert.match(body, /"type":"notification"/)
  assert.match(body, /"state":"considering"/)
  assert.match(body, /"state":"replied"/)
  assert.match(body, /"state":"passed"/)
  assert.match(body, /"type":"settled"/)
  assert.match(body, /"type":"data-groupMessage"/)
  assert.match(body, /"author":"researcher"/)
  assert.match(body, /Start with one real customer workflow\./)

  const state = await groupApp.request("/api/chat/chat-1/state")
  assert.equal(state.status, 200)
  assert.match(
    JSON.stringify(await state.json()),
    /Start with one real customer workflow\./
  )
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

test("chat state hydrates history without duplicating the replayable head", async () => {
  const messages: UIMessage[] = [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    },
    {
      id: "stream-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello back" }],
    },
  ]
  let received: { chatId: string; userId: string } | undefined
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe(conversation) {
      received = conversation
      return {
        engine: {
          async getMessages() {
            return messages
          },
          async headMessage() {
            return { id: "stream-1", name: "assistant" }
          },
        },
        async resume() {
          return null
        },
      }
    },
  }
  const streams: ChatStreamStore = {
    async getStreamStatus(id) {
      assert.equal(id, "stream-1")
      return "completed"
    },
  }

  const response = await testApp({ runtime, streams }).request(
    "/api/chat/chat-1/state"
  )

  assert.equal(response.status, 200)
  assert.deepEqual(received, { chatId: "chat-1", userId: "local-user" })
  assert.deepEqual(await response.json(), {
    messages: [messages[0]],
    resume: true,
    streamId: "stream-1",
  })
})

test("chat stream endpoint replays the durable head stream", async () => {
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe() {
      return {
        engine: {
          async getMessages() {
            return []
          },
          async headMessage() {
            return undefined
          },
        },
        async resume() {
          return new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "start", messageId: "stream-1" })
              controller.enqueue({ type: "text-start", id: "text-1" })
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: "Resumed",
              })
              controller.enqueue({ type: "text-end", id: "text-1" })
              controller.enqueue({ type: "finish", finishReason: "stop" })
              controller.close()
            },
          })
        },
      }
    },
  }

  const response = await testApp({ runtime }).request("/api/chat/chat-1/stream")

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  assert.match(await response.text(), /"delta":"Resumed"/)
})

test("chat stream endpoint returns no content before a turn exists", async () => {
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe() {
      return {
        engine: {
          async getMessages() {
            return []
          },
          async headMessage() {
            return undefined
          },
        },
        async resume() {
          return null
        },
      }
    },
  }

  const response = await testApp({ runtime }).request("/api/chat/chat-1/stream")

  assert.equal(response.status, 204)
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

  await using group = await WhatsAppGroup.create({
    userId: "user-1",
    participants: [
      { name: "fast", specialty: "Answers quickly.", model: fast },
      { name: "slow", specialty: "Checks carefully.", model: slow },
    ],
  })

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

test("each group member uses its own telemetry", async () => {
  const firstStarts: unknown[] = []
  const secondStarts: unknown[] = []
  await using group = await WhatsAppGroup.create({
    userId: "user-1",
    participants: [
      {
        name: "first",
        specialty: "Reviews the discussion.",
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
        specialty: "Challenges the discussion.",
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

  await group.send("Review this.")

  assert.match(JSON.stringify(firstStarts), /"functionId":"parent-chat:first"/)
  assert.doesNotMatch(JSON.stringify(firstStarts), /parent-chat:second/)
  assert.match(JSON.stringify(secondStarts), /"functionId":"parent-chat:second"/)
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

  await using group = await WhatsAppGroup.create({
    userId: "user-1",
    participants: [
      { name: "member", specialty: "Reviews the discussion.", model: member },
    ],
  })

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
          : groupTextResponse("Greetings are outside my specialty.")
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

  await using group = await WhatsAppGroup.create({
    userId: "user-1",
    participants: [
      {
        name: "researcher",
        specialty: "Finds evidence and is socially curious.",
        model: researcher,
        tools: {
          web_search: openai.tools.webSearch(),
        },
      },
      {
        name: "critic",
        specialty: "Challenges unsupported claims.",
        model: critic,
      },
    ],
  })

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
