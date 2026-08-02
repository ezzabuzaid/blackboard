import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { openai } from "@ai-sdk/openai"
import {
  PollingChangeSource,
  SqliteContextStore,
  SqliteStreamStore,
  StreamManager,
  createVirtualSandbox,
} from "@deepagents/context"
import {
  SqliteMailboxStore,
  defineSandbox,
} from "@deepagents/experimental/zukhruf"
import { simulateReadableStream } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { decryptOAuthToken } from "better-auth/oauth2"
import { InMemoryFs } from "just-bash"

import { createApp, type AppDependencies } from "./app.js"
import { chatGPTAuthPlugin, parseDeviceAttempt } from "./auth/chatgpt-plugin.js"
import type { OpenArtifact } from "./chat/routes.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { createWhatsAppSandbox, shareSandboxInstance } from "./group/sandbox.js"
import {
  WhatsAppGroup,
  WhatsAppGroupLimitError,
  WhatsAppReplyTargetError,
  type WhatsAppParticipant,
} from "./group/whatsapp.js"
import { readAgentTraces } from "./traces/agent-traces.js"
import { openArtifact } from "./sandbox.js"

type ChatRuntime = AppDependencies["runtime"]

const testGroupSandbox = shareSandboxInstance(
  defineSandbox(() => createVirtualSandbox({ fs: new InMemoryFs() }))
)
const testDataDirectory = "/test/zukhruf"
const testGroupConversation = { chatId: "test-chat", userId: "user-1" }
const testGroupLimits = {
  notifications: 25,
  agentMessages: 100,
  transcriptMessages: 500,
}

function testGroupDependencies(resources: AsyncDisposableStack) {
  const database = new DatabaseSync(":memory:")
  resources.defer(() => database.close())
  const streamStore = new SqliteStreamStore(database)
  return {
    store: new SqliteContextStore(database),
    streams: new StreamManager({
      store: streamStore,
      changeSource: new PollingChangeSource({ reads: streamStore }),
    }),
    mailboxStore: resources.use(new SqliteMailboxStore(":memory:")),
    events: [],
    limits: testGroupLimits,
    persist: async () => {},
  }
}

function memoryRuntime(participants: WhatsAppParticipant[]) {
  return new WhatsAppChatRuntime({
    participantsForUser: async () => participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ":memory:",
    mailboxPath: ":memory:",
  })
}

function durableRuntime(
  participants: WhatsAppParticipant[],
  directory: string
) {
  return new WhatsAppChatRuntime({
    participantsForUser: async () => participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: join(directory, "group.sqlite"),
    mailboxPath: join(directory, "mailbox.sqlite"),
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
  async traces() {
    throw new Error("Unexpected traces")
  },
}

const noArtifact: OpenArtifact = async () => null
const authenticatedAuth: AppDependencies["auth"] = {
  handler: async () => new Response(null, { status: 404 }),
  getSession: async () => ({ user: { id: "local-user" } }),
}

function testApp({
  auth = authenticatedAuth,
  runtime = unusedRuntime,
  openArtifact = noArtifact,
}: {
  auth?: AppDependencies["auth"]
  runtime?: ChatRuntime
  openArtifact?: OpenArtifact
} = {}) {
  return createApp({ auth, runtime, openArtifact })
}

function responseCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ")
}

function testIdToken(claims: Record<string, unknown>) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`
}

const app = testApp()

test("ChatGPT device attempts are validated before use", () => {
  assert.deepEqual(
    parseDeviceAttempt(
      JSON.stringify({
        deviceAuthId: "device-1",
        userCode: "ABCD-EFGH",
      })
    ),
    {
      deviceAuthId: "device-1",
      userCode: "ABCD-EFGH",
    }
  )
  assert.equal(parseDeviceAttempt('{"deviceAuthId":42}'), null)
})

test("ChatGPT device approval creates an encrypted Better Auth session", async () => {
  const database = new DatabaseSync(":memory:")
  const idToken = testIdToken({
    sub: "openai-user-1",
    email: "person@example.com",
    email_verified: true,
    name: "Test Person",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "chatgpt-account-1",
      chatgpt_plan_type: "plus",
    },
  })
  const providerFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith("/api/accounts/deviceauth/usercode")) {
      return Response.json({
        device_auth_id: "device-1",
        user_code: "ABCD-EFGH",
        interval: 1,
      })
    }
    if (url.endsWith("/api/accounts/deviceauth/token")) {
      return Response.json({
        authorization_code: "authorization-1",
        code_verifier: "verifier-1",
        code_challenge: "challenge-1",
      })
    }
    if (url.endsWith("/oauth/token")) {
      return Response.json({
        access_token: "access-token-1",
        refresh_token: "refresh-token-1",
        id_token: idToken,
        expires_in: 3_600,
      })
    }
    return new Response(null, { status: 404 })
  }
  const options: BetterAuthOptions = {
    database,
    baseURL: "http://localhost:3001",
    secret: "test-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://localhost:5173"],
    account: { encryptOAuthTokens: true },
    plugins: [
      chatGPTAuthPlugin({
        issuer: "https://auth.example.com",
        fetch: providerFetch,
      }),
    ],
  }
  const auth = betterAuth(options)

  try {
    await (await auth.$context).runMigrations()
    const start = await auth.handler(
      new Request("http://localhost:3001/api/auth/chatgpt/device", {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    )
    assert.equal(start.status, 200)
    const started = (await start.json()) as Record<string, unknown>
    assert.equal(
      started.verificationUrl,
      "https://auth.example.com/codex/device"
    )
    assert.equal(started.userCode, "ABCD-EFGH")
    assert.equal(started.interval, 1)
    assert.equal(typeof started.expiresAt, "number")

    const poll = await auth.handler(
      new Request("http://localhost:3001/api/auth/chatgpt/device/poll", {
        method: "POST",
        headers: {
          Origin: "http://localhost:5173",
          "Content-Type": "application/json",
          Cookie: responseCookies(start),
        },
        body: "{}",
      })
    )
    assert.equal(poll.status, 200)
    const result = (await poll.json()) as { status?: unknown; user?: unknown }
    assert.equal(result.status, "complete")

    const session = await auth.handler(
      new Request("http://localhost:3001/api/auth/get-session", {
        headers: { Cookie: responseCookies(poll) },
      })
    )
    const body = (await session.json()) as {
      user?: { id?: unknown; email?: unknown }
    }
    assert.equal(body.user?.email, "person@example.com")

    const context = await auth.$context
    const account = (
      await context.internalAdapter.findAccountByUserId(String(body.user?.id))
    )[0]
    assert.notEqual(account?.accessToken, "access-token-1")
    assert.equal(
      await decryptOAuthToken(account?.accessToken ?? "", context),
      "access-token-1"
    )
  } finally {
    database.close()
  }
})

test("health reports the WhatsApp group service", async () => {
  const response = await app.request("/api/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ok" })
})

test("chat routes require a Better Auth session", async () => {
  const response = await testApp({
    auth: {
      ...authenticatedAuth,
      getSession: async () => null,
    },
  }).request("/api/chat/chat-1/state")

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: "Unauthorized." })
})

test("agent telemetry is grouped into complete chat-scoped turns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-traces-"))
  const path = join(directory, "maya.jsonl")
  const functionId = "chat-1:Maya"
  const entry = (event: string, timestamp: string, data: object) =>
    JSON.stringify({ event, timestamp, data: { functionId, ...data } })

  try {
    await writeFile(
      path,
      [
        "not json",
        entry("onStart", "2026-07-31T10:00:00.000Z", {
          callId: "call-1",
          modelId: "gpt-5.6-sol",
          messages: [{ role: "user", content: "New group message" }],
        }),
        JSON.stringify({
          event: "onEnd",
          timestamp: "2026-07-31T10:00:01.000Z",
          data: { functionId: "other-chat:Maya", callId: "ignored" },
        }),
        entry("onEnd", "2026-07-31T10:00:02.000Z", {
          callId: "call-1",
          model: "gpt-5.6-sol",
          finishReason: "stop",
          totalUsage: {
            inputTokens: 100,
            inputTokenDetails: { cacheReadTokens: 64 },
            outputTokens: 10,
            outputTokenDetails: { reasoningTokens: 4 },
            totalTokens: 110,
          },
          steps: [
            {
              stepNumber: 0,
              finishReason: "stop",
              performance: { responseTimeMs: 123 },
              usage: { totalTokens: 110 },
              content: [{ type: "reasoning", text: "Checked context" }],
            },
          ],
        }),
      ].join("\n")
    )

    assert.deepEqual(await readAgentTraces(path, functionId), [
      {
        callId: "call-1",
        startedAt: "2026-07-31T10:00:00.000Z",
        endedAt: "2026-07-31T10:00:02.000Z",
        modelId: "gpt-5.6-sol",
        notification: "New group message",
        status: "completed",
        finishReason: "stop",
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 4,
          cacheReadTokens: 64,
          totalTokens: 110,
        },
        steps: [
          {
            stepNumber: 0,
            finishReason: "stop",
            responseTimeMs: 123,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 110,
            },
            content: [{ type: "reasoning", text: "Checked context" }],
          },
        ],
        error: null,
      },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("group members share one sandbox instance", async () => {
  const maya = {
    chatId: "chat-1:participant:0",
    userId: "user-1",
  }
  const omar = {
    chatId: "chat-1:participant:1",
    userId: "user-1",
  }
  const lina = {
    chatId: "chat-1:participant:2",
    userId: "user-1",
  }
  const paul = {
    chatId: "chat-1:participant:3",
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

test("group chats isolate virtual workspaces and share GTM sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whatsapp-sandbox-"))
  const firstChat = { chatId: "chat-1", userId: "local-user" }
  const secondChat = { chatId: "chat-2", userId: "local-user" }

  try {
    await using resources = new AsyncDisposableStack()
    const sandboxForChat = createWhatsAppSandbox(resources, directory)
    const sandboxForFirstChat = sandboxForChat(firstChat)
    const first = await sandboxForFirstChat({
      chatId: "chat-1:participant:0",
      userId: firstChat.userId,
    })
    const firstPeer = await sandboxForFirstChat({
      chatId: "chat-1:participant:1",
      userId: firstChat.userId,
    })
    assert.equal(first.sandbox, firstPeer.sandbox)

    await first.sandbox.writeFiles([
      { path: "/workspace/business/README.md", content: "shared profile" },
      { path: "/workspace/private.txt", content: "first chat" },
      { path: "/workspace/output/sample.txt", content: "artifact" },
    ])

    const second = await sandboxForChat(secondChat)({
      chatId: "chat-2:participant:0",
      userId: secondChat.userId,
    })
    assert.equal(
      await second.sandbox.readFile("/workspace/business/README.md"),
      "shared profile"
    )
    assert.equal(
      (await second.sandbox.executeCommand("cat /workspace/private.txt"))
        .exitCode,
      1
    )

    const sandboxApp = testApp({
      openArtifact: (conversation, path) =>
        openArtifact(directory, conversation, path),
    })
    const artifact = await sandboxApp.request(
      "/api/chat/chat-1/artifacts/sample.txt"
    )
    assert.equal(artifact.status, 200)
    assert.equal(
      artifact.headers.get("content-type"),
      "text/plain; charset=utf-8"
    )
    assert.equal(
      artifact.headers.get("content-disposition"),
      "inline; filename*=UTF-8''sample.txt"
    )
    assert.equal(await artifact.text(), "artifact")
    assert.equal(
      (await sandboxApp.request("/api/chat/chat-2/artifacts/sample.txt"))
        .status,
      404
    )
    assert.equal(
      (
        await sandboxApp.request(
          "/api/chat/chat-1/artifacts/%2E%2E%2Fprivate.txt"
        )
      ).status,
      400
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("chat message POST returns before active participants settle", async () => {
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
    const posted = (await response.json()) as {
      message: ReturnType<WhatsAppGroup["snapshot"]>["messages"][number]
    }
    assert.match(posted.message.sentAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.deepEqual(posted, {
      message: {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "What should we do first?",
        sentAt: posted.message.sentAt,
        replyToMessageId: null,
      },
    })
    assert.deepEqual(await (await request()).json(), {
      message: {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "What should we do first?",
        sentAt: posted.message.sentAt,
        replyToMessageId: null,
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
          sentAt: posted.message.sentAt,
          replyToMessageId: null,
        },
      ],
      participants: [{ name: "Maya", source: "Research evidence." }],
      activity: {
        phase: "active",
        notification: 1,
        messageCount: 1,
        participants: [{ name: "Maya", state: "considering", replies: 0 }],
        presence: [{ name: "Maya", state: "reading" }],
      },
      cursor: 5,
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
      while (!events.includes('"type":"settled"')) {
        const chunk = await reader.read()
        if (chunk.done) break
        events += new TextDecoder().decode(chunk.value, { stream: true })
      }
      controller.abort()
      await reader.cancel().catch(() => undefined)
      return events
    }

    const events = await readEvents()
    assert.doesNotMatch(events, new RegExp(`id: ${state.cursor}\\n`))
    assert.match(events, /event: activity/)
    assert.match(events, new RegExp(`id: ${state.cursor + 1}`))
    assert.match(events, new RegExp(`id: ${state.cursor + 2}`))
    assert.match(events, new RegExp(`id: ${state.cursor + 3}`))
    assert.match(events, /"type":"settled"/)

    const reconnected = await readEvents({
      "Last-Event-ID": String(state.cursor),
    })
    assert.doesNotMatch(reconnected, new RegExp(`id: ${state.cursor}\\n`))
    assert.match(reconnected, new RegExp(`id: ${state.cursor + 1}`))
    assert.match(reconnected, new RegExp(`id: ${state.cursor + 3}`))
  } finally {
    releaseParticipant.resolve()
  }
})

test("chat message and event cursors are validated at the boundary", async () => {
  for (const body of [
    null,
    {},
    { id: "", content: "Hello" },
    { id: "message-1", content: "   " },
    { id: "message-1", content: "Hello", replyToMessageId: "" },
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
  assert.equal((await app.request("/api/chat/chat-1/turns")).status, 404)
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
        throw new WhatsAppGroupLimitError("Chat is full")
      },
    },
  }).request("/api/chat/chat-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "message-1", content: "One more message" }),
  })
  assert.equal(limited.status, 409)
  assert.deepEqual(await limited.json(), { error: "Chat is full" })

  const missingReply = await testApp({
    runtime: {
      ...unusedRuntime,
      async post() {
        throw new WhatsAppReplyTargetError("Reply target was not found")
      },
    },
  }).request("/api/chat/chat-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "message-2",
      content: "Reply",
      replyToMessageId: "missing",
    }),
  })
  assert.equal(missingReply.status, 400)
})

test("development CORS accepts a local fallback port", async () => {
  const response = await app.request("/api/health", {
    headers: { Origin: "http://localhost:5174" },
  })

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5174"
  )
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true")
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

test("reconsiders a stale first-wave reply before publishing it", async () => {
  const bothMembersStarted = Promise.withResolvers<void>()
  const earlyReplyPublished = Promise.withResolvers<void>()
  let startedMembers = 0

  const startTogether = async () => {
    startedMembers++
    if (startedMembers === 2) bothMembersStarted.resolve()
    await bothMembersStarted.promise
  }

  let earlyCalls = 0
  const early = new MockLanguageModelV4({
    doStream: async () => {
      earlyCalls++
      if (earlyCalls === 1) {
        await startTogether()
        return groupToolResponse("reply_to_group", "early-reply", {
          message: "The answer is already covered.",
        })
      }
      return groupTextResponse("Reply posted.")
    },
  })

  let lateCalls = 0
  const latePrompts: unknown[] = []
  const late = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      lateCalls++
      latePrompts.push(prompt)
      if (lateCalls === 1) {
        await startTogether()
        await earlyReplyPublished.promise
        return groupToolResponse("reply_to_group", "late-reply", {
          message: "The answer is already covered.",
        })
      }
      return groupTextResponse("Nothing non-duplicative to add.")
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

test("quoted replies persist resolved context and emit real presence", async () => {
  const prompts: unknown[] = []
  let calls = 0
  const participant = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      prompts.push(prompt)
      calls++
      if (calls === 1) {
        const messageId = JSON.stringify(prompt).match(
          /\[([\da-f-]{36})\] user:/u
        )?.[1]
        assert.ok(messageId)
        return groupToolResponse("reply_to_group", "reply-1", {
          message: "Start with the evidence.",
          replyToMessageId: messageId,
        })
      }
      return groupTextResponse("Nothing else to add.")
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "Maya", source: "Research evidence.", model: participant },
      ],
    })
  )

  const activity: string[] = []
  const messages = await group.send(
    "What should we do first?",
    undefined,
    (event) => {
      if (event.type === "presence") activity.push(event.state)
    }
  )
  const original = messages.find(({ author }) => author === "user")!
  const reply = messages.find(({ author }) => author === "Maya")
  assert.ok(reply, JSON.stringify({ messages, activity, prompts }))

  assert.equal(reply.replyToMessageId, original.id)
  assert.match(reply.sentAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.deepEqual(activity, ["reading", "typing", "reading", "seen"])

  const settled = Promise.withResolvers<void>()
  using subscription = group.subscribe({
    onActivity(event) {
      if (event.type === "settled") settled.resolve()
    },
  })
  await group.post("Can you clarify that?", "follow-up", reply.id)
  await settled.promise

  assert.match(
    JSON.stringify(prompts.at(-1)),
    new RegExp(`Replying to \\[${reply.id}] Maya: Start with the evidence\\.`)
  )
})

test("ordinary agent contributions do not quote their triggering message", async () => {
  let calls = 0
  let systemInstructions: string | undefined
  const participant = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      calls++
      if (calls > 1) return groupTextResponse("Nothing else to add.")

      const notification = JSON.stringify(prompt)
      const messageId = notification.match(/\[([\da-f-]{36})\] user:/u)?.[1]
      assert.ok(messageId)
      systemInstructions = prompt
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n")

      return groupToolResponse("reply_to_group", "introduction", {
        message: "I'm Maya. I own the research evidence.",
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
        { name: "Maya", source: "Research evidence.", model: participant },
      ],
    })
  )

  const messages = await group.send("Introduce yourself.")
  const reply = messages.find(({ author }) => author === "Maya")
  assert.ok(reply)
  assert.match(
    systemInstructions ?? "",
    /replyToMessageId is an optional UI pointer, not the message you are answering/u
  )
  assert.match(
    systemInstructions ?? "",
    /Omit replyToMessageId for ordinary responses to the latest user message or current discussion/u
  )
  assert.match(
    systemInstructions ?? "",
    /Set it only to emphasize a particular earlier message or directly reply to another participant/u
  )
  assert.equal(reply.replyToMessageId, null)
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

test("group prompt selects one responder for an explicitly single-answer request", async () => {
  const participant = (name: string) => {
    let replied = false
    return new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        if (replied) return groupTextResponse("Nothing else to add.")
        const instructions = JSON.stringify(prompt)
        const hasSingleResponderRule = instructions.includes(
          "When the user explicitly asks for exactly one answer"
        )
        if (hasSingleResponderRule && name !== "Maya") {
          return groupTextResponse("Maya owns this answer.")
        }
        replied = true
        return groupToolResponse("reply_to_group", `${name}-reply`, {
          message: `${name} answered.`,
        })
      },
    })
  }

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
          model: participant("Maya"),
        },
        {
          name: "Omar",
          source: "Engineering record.",
          model: participant("Omar"),
        },
      ],
    })
  )

  const messages = await group.send("Can exactly one of you answer this?")

  assert.deepEqual(
    messages
      .filter(({ author }) => author !== "user")
      .map(({ author }) => author),
    ["Maya"]
  )
})

test("group prompt keeps a short unaddressed follow-up with the previous responder", async () => {
  const followUpRule =
    "A short, unaddressed user follow-up or acknowledgment belongs to the participant who authored the immediately preceding public reply."
  const participant = (name: "Maya" | "Omar") => {
    let initialReplyPosted = false
    let followUpHandled = false
    return new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        const instructions = JSON.stringify(prompt)
        if (instructions.includes("thanks") && !followUpHandled) {
          followUpHandled = true
          if (instructions.includes(followUpRule) && name !== "Omar") {
            return groupTextResponse("The follow-up belongs to Omar.")
          }
          return groupToolResponse("reply_to_group", `${name}-thanks`, {
            message: `${name} acknowledged the follow-up.`,
          })
        }
        if (name === "Omar" && !initialReplyPosted) {
          initialReplyPosted = true
          return groupToolResponse("reply_to_group", "omar-initial", {
            message: "Omar answered the question.",
          })
        }
        return groupTextResponse("Nothing else to add.")
      },
    })
  }

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
          model: participant("Maya"),
        },
        {
          name: "Omar",
          source: "Engineering record.",
          model: participant("Omar"),
        },
      ],
    })
  )

  await group.send("Omar, what do you think?")
  const beforeFollowUp = group.snapshot().messages.length
  const messages = await group.send("thanks")

  assert.deepEqual(
    messages
      .slice(beforeFollowUp)
      .filter(({ author }) => author !== "user")
      .map(({ author }) => author),
    ["Omar"]
  )
})

test("a chat survives a runtime restart and replays persisted events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zukhruf-chat-"))
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
      await waitForChat(runtime, conversation, "settled")
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
  const directory = await mkdtemp(join(tmpdir(), "zukhruf-interrupted-chat-"))
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

test("chat stop cancels active participant work", async () => {
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

test("the chat stops at its public reply ceiling", async () => {
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

async function waitForChat(
  runtime: WhatsAppChatRuntime,
  conversation: { chatId: string; userId: string },
  phase: "settled" | "stopped"
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const snapshot = await runtime.snapshot(conversation)
    if (snapshot.activity.phase === phase) return snapshot
    await sleep(10)
  }
  throw new Error(`Chat did not become ${phase}`)
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
