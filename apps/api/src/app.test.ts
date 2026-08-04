import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

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
import type { DrainContext } from "evlog"
import { InMemoryFs } from "just-bash"

import { createApp, type AppDependencies } from "./app.js"
import { createAuthentication } from "./auth.js"
import type { OpenArtifact } from "./routes/chat.route.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import type { GroupRecord } from "./group/group-store.js"
import { groupTemplates } from "./group/group-template-catalog.js"
import {
  MarketplaceGroupTemplateStore,
  type MarketplaceGroupTemplate,
} from "./group/marketplace-group-template-store.js"
import { ParticipantDirectory } from "./group/participants/index.js"
import { createWhatsAppSandbox, shareSandboxInstance } from "./group/sandbox.js"
import { createParticipantDefaults } from "./participant-defaults.js"
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
const testCreatedAt = "2026-08-04T00:00:00.000Z"

function testGroupRecord(
  id: string,
  name: string,
  agentIds: readonly string[]
): GroupRecord {
  return {
    id,
    name,
    agentIds,
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
  }
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
    loadParticipants: async () => participants,
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
    loadParticipants: async () => participants,
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
const unusedMarketplaceTemplates: AppDependencies["marketplaceTemplates"] = {
  create() {
    throw new Error("Unexpected marketplace template creation")
  },
  update() {
    throw new Error("Unexpected marketplace template update")
  },
  publish() {
    throw new Error("Unexpected marketplace template publication")
  },
  unpublish() {
    throw new Error("Unexpected marketplace template withdrawal")
  },
  published() {
    return []
  },
  findPublished() {
    return null
  },
}
const authenticatedAuth: AppDependencies["auth"] = {
  handler: async () => new Response(null, { status: 404 }),
  getSession: async () => ({ user: { id: "local-user" } }),
  getSessionResponse: async () => Response.json({ user: { id: "local-user" } }),
}

function testApp({
  structuredLogDrain,
  agents = [],
  auth = authenticatedAuth,
  createGroup = () => {
    throw new Error("Unexpected group creation")
  },
  listGroups = () => [],
  markGroupRead = () => false,
  marketplaceTemplates = unusedMarketplaceTemplates,
  runtime = unusedRuntime,
  openArtifact = noArtifact,
}: {
  structuredLogDrain?: AppDependencies["structuredLogDrain"]
  agents?: AppDependencies["agents"]
  auth?: AppDependencies["auth"]
  createGroup?: AppDependencies["createGroup"]
  listGroups?: AppDependencies["listGroups"]
  markGroupRead?: AppDependencies["markGroupRead"]
  marketplaceTemplates?: AppDependencies["marketplaceTemplates"]
  runtime?: ChatRuntime
  openArtifact?: OpenArtifact
} = {}) {
  return createApp({
    structuredLogDrain,
    agents,
    auth,
    createGroup,
    listGroups,
    markGroupRead,
    marketplaceTemplates,
    runtime,
    openArtifact,
  })
}

function responseCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ")
}

const app = testApp()

test("passkey registration requires only a name", async () => {
  await using authentication = await createAuthentication({
    databasePath: ":memory:",
    baseURL: "http://localhost:3001",
    secret: "test-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://localhost:5173"],
  })
  const headers = {
    Origin: "http://localhost:5173",
  }
  const registration = await authentication.auth.handler(
    new Request(
      "http://localhost:3001/api/auth/passkey/generate-register-options?context=Test%20Person",
      { headers }
    )
  )
  assert.equal(registration.status, 200)

  const body = (await registration.json()) as {
    user?: { id?: unknown; name?: unknown; displayName?: unknown }
    authenticatorSelection?: {
      residentKey?: unknown
      userVerification?: unknown
    }
  }
  assert.equal(typeof body.user?.id, "string")
  assert.deepEqual(body.user, {
    id: body.user?.id,
    name: "Test Person",
    displayName: "Test Person",
  })
  assert.equal(body.authenticatorSelection?.residentKey, "required")
  assert.equal(body.authenticatorSelection?.userVerification, "required")

  const session = await authentication.auth.handler(
    new Request("http://localhost:3001/api/auth/get-session", {
      headers: { Cookie: responseCookies(registration) },
    })
  )
  assert.equal(await session.json(), null)

  const missingName = await authentication.auth.handler(
    new Request(
      "http://localhost:3001/api/auth/passkey/generate-register-options",
      { headers }
    )
  )
  assert.equal(missingName.status, 400)
})

test("participant defaults use the configured OpenRouter key", () => {
  const defaults = createParticipantDefaults({ apiKey: "openrouter-key-1" })
  assert.equal(defaults.model.provider, "openrouter")
  assert.equal(defaults.model.modelId, "openrouter/auto")
  assert.equal(defaults.tools.web_search?.type, "provider")
})

test("health reports the WhatsApp group service", async () => {
  const response = await app.request("/api/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: "ok" })
})

test("structured logging records request failures without authorization headers", async () => {
  const events: DrainContext[] = []
  const response = await testApp({
    structuredLogDrain: (event) => {
      events.push(event)
    },
    createGroup: () => {
      throw new Error("controlled failure")
    },
  }).request("/api/groups", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-marker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ templateId: "scratch" }),
  })

  assert.equal(response.status, 500)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.event.level, "error")
  assert.equal(events[0]?.event.path, "/api/groups")
  assert.equal(events[0]?.event.status, 500)
  assert.match(JSON.stringify(events[0]?.event.error), /controlled failure/)
  assert.equal(events[0]?.headers?.authorization, undefined)
})

test("agent catalog exposes native character metadata", async () => {
  const response = await testApp({
    agents: [
      {
        id: "paul-graham",
        name: "Paul Graham",
        category: "Fund",
        headline: "YC's essayist-in-chief",
        tags: ["strategy", "fundraising"],
      },
    ],
  }).request("/api/agents")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    agents: [
      {
        id: "paul-graham",
        name: "Paul Graham",
        category: "Fund",
        headline: "YC's essayist-in-chief",
        tags: ["strategy", "fundraising"],
      },
    ],
  })
})

test("group template catalog resolves agent names", async () => {
  const response = await testApp({
    agents: groupTemplates.flatMap(({ agents }) =>
      agents.map(({ agentId }) => ({
        id: agentId,
        name: `Name for ${agentId}`,
        category: "Test",
        headline: "Test agent",
        tags: ["test"],
      }))
    ),
  }).request("/api/group-templates")

  assert.equal(response.status, 200)
  const body = (await response.json()) as {
    templates: { agents: unknown[] }[]
  }
  assert.equal(body.templates.length, groupTemplates.length)
  assert.deepEqual(body.templates[0]?.agents[0], {
    id: "rob-fitzpatrick",
    name: "Name for rob-fitzpatrick",
    responsibility: "Keeps interviews grounded in real past behavior.",
  })
})

test("a publisher owns the marketplace template lifecycle", async () => {
  using marketplaceTemplates = new MarketplaceGroupTemplateStore(":memory:", [
    "annie-duke",
    "paul-graham",
  ])
  let userId = "publisher-1"
  const application = testApp({
    marketplaceTemplates,
    auth: {
      ...authenticatedAuth,
      getSession: async () => ({ user: { id: userId } }),
    },
  })
  const input = {
    name: "Founder Panel",
    category: "Strategy",
    outcome: "Pressure-test a company decision.",
    agents: [
      {
        agentId: "paul-graham",
        responsibility: "Keeps the company focused on users.",
      },
    ],
  }

  const createResponse = await application.request("/api/group-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  assert.equal(createResponse.status, 201)
  const created = (await createResponse.json()) as MarketplaceGroupTemplate
  assert.equal(created.published, false)

  const invalidResponse = await application.request("/api/group-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      agents: [{ agentId: "missing", responsibility: "Unknown agent." }],
    }),
  })
  assert.equal(invalidResponse.status, 400)

  const publishResponse = await application.request(
    `/api/group-templates/${created.id}/publish`,
    { method: "POST" }
  )
  assert.equal(publishResponse.status, 200)
  assert.equal(
    ((await publishResponse.json()) as MarketplaceGroupTemplate).published,
    true
  )

  const updateResponse = await application.request(
    `/api/group-templates/${created.id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        outcome: "Pressure-test the next company decision.",
      }),
    }
  )
  assert.equal(updateResponse.status, 200)
  assert.deepEqual(await updateResponse.json(), {
    ...created,
    outcome: "Pressure-test the next company decision.",
    published: true,
  })

  userId = "publisher-2"
  const foreignResponse = await application.request(
    `/api/group-templates/${created.id}/unpublish`,
    { method: "POST" }
  )
  assert.equal(foreignResponse.status, 404)

  userId = "publisher-1"
  const unpublishResponse = await application.request(
    `/api/group-templates/${created.id}/unpublish`,
    { method: "POST" }
  )
  assert.equal(unpublishResponse.status, 200)
  assert.equal(
    ((await unpublishResponse.json()) as MarketplaceGroupTemplate).published,
    false
  )
})

test("published marketplace templates create ordinary groups", async () => {
  using marketplaceTemplates = new MarketplaceGroupTemplateStore(":memory:", [
    "paul-graham",
  ])
  const template = marketplaceTemplates.create("publisher-1", {
    name: "Founder Board",
    category: "Strategy",
    outcome: "Challenge the next company decision.",
    agents: [
      {
        agentId: "paul-graham",
        responsibility: "Keeps the company focused on users.",
      },
    ],
  })
  marketplaceTemplates.publish("publisher-1", template.id)

  const calls: unknown[] = []
  const application = testApp({
    agents: groupTemplates.flatMap(({ agents }) =>
      agents.map(({ agentId }) => ({
        id: agentId,
        name: `Name for ${agentId}`,
        category: "Test",
        headline: "Test agent",
        tags: ["test"],
      }))
    ),
    marketplaceTemplates,
    createGroup: (userId, input) => {
      calls.push({ userId, input })
      return testGroupRecord("group-2", input.name, input.agentIds)
    },
  })

  const listResponse = await application.request("/api/group-templates")
  const list = (await listResponse.json()) as {
    templates: Array<{ id: string } & Record<string, unknown>>
  }
  assert.deepEqual(
    list.templates.find(({ id }) => id === template.id),
    {
      id: template.id,
      name: "Founder Board",
      category: "Strategy",
      outcome: "Challenge the next company decision.",
      source: "marketplace",
      agents: [
        {
          id: "paul-graham",
          name: "Name for paul-graham",
          responsibility: "Keeps the company focused on users.",
        },
      ],
    }
  )

  const createResponse = await application.request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: template.id }),
  })
  assert.equal(createResponse.status, 201)
  assert.deepEqual(calls, [
    {
      userId: "local-user",
      input: { name: "Founder Board", agentIds: ["paul-graham"] },
    },
  ])
  assert.deepEqual(await createResponse.json(), {
    id: "group-2",
    name: "Founder Board",
    agentIds: ["paul-graham"],
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
  })

  marketplaceTemplates.unpublish("publisher-1", template.id)
  const withdrawnResponse = await application.request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: template.id }),
  })
  assert.equal(withdrawnResponse.status, 400)
})

test("group template selection creates a normal group roster", async () => {
  const calls: unknown[] = []
  const application = testApp({
    createGroup: (userId, input) => {
      calls.push({ userId, input })
      return testGroupRecord("group-1", input.name, input.agentIds)
    },
  })
  const response = await application.request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: "customer-discovery" }),
  })

  assert.equal(response.status, 201)
  assert.deepEqual(calls, [
    {
      userId: "local-user",
      input: {
        name: "Customer Discovery",
        agentIds: [
          "rob-fitzpatrick",
          "april-dunford",
          "elena-verna",
          "andrew-chen",
        ],
      },
    },
  ])
  assert.deepEqual(await response.json(), {
    id: "group-1",
    name: "Customer Discovery",
    agentIds: [
      "rob-fitzpatrick",
      "april-dunford",
      "elena-verna",
      "andrew-chen",
    ],
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
  })

  const unknown = await application.request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: "missing" }),
  })
  assert.equal(unknown.status, 400)
})

test("group listing is scoped to the authenticated user", async () => {
  const userIds: string[] = []
  const groups = [testGroupRecord("group-1", "Founder panel", ["paul-graham"])]
  const response = await testApp({
    listGroups: (userId) => {
      userIds.push(userId)
      return groups
    },
  }).request("/api/groups")

  assert.equal(response.status, 200)
  assert.deepEqual(userIds, ["local-user"])
  assert.deepEqual(await response.json(), { groups })
})

test("scratch groups are persisted and can be marked read", async () => {
  const calls: unknown[] = []
  const response = await testApp({
    createGroup: (userId, input) => {
      calls.push({ userId, input })
      return testGroupRecord("scratch-1", input.name, input.agentIds)
    },
  }).request("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: "scratch" }),
  })

  assert.equal(response.status, 201)
  assert.deepEqual(calls, [
    { userId: "local-user", input: { name: "New group", agentIds: [] } },
  ])

  const readCalls: unknown[] = []
  const read = await testApp({
    markGroupRead: (userId, groupId) => {
      readCalls.push({ userId, groupId })
      return true
    },
  }).request("/api/groups/scratch-1/read", { method: "POST" })
  assert.equal(read.status, 200)
  assert.deepEqual(readCalls, [{ userId: "local-user", groupId: "scratch-1" }])
  assert.deepEqual(await read.json(), { read: true })
})

test("SDK auth routes preserve Better Auth response headers", async () => {
  const response = await testApp({
    auth: {
      ...authenticatedAuth,
      getSessionResponse: async () =>
        Response.json(null, {
          headers: {
            "Set-Cookie": "session=test-session; HttpOnly; Path=/",
            "X-Auth-Result": "checked",
          },
        }),
    },
  }).request("/api/auth/get-session")

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Auth-Result"), "checked")
  assert.deepEqual(response.headers.getSetCookie(), [
    "session=test-session; HttpOnly; Path=/",
  ])
  assert.equal(await response.json(), null)
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

test("a user with no participants gets an empty group", async () => {
  await using runtime = memoryRuntime([])
  const groupApp = testApp({ runtime })

  const stateResponse = await groupApp.request("/api/chat/chat-1/state")
  assert.equal(stateResponse.status, 200)
  assert.deepEqual(await stateResponse.json(), {
    messages: [],
    participants: [],
    activity: {
      phase: "idle",
      notification: 0,
      messageCount: 0,
      participants: [],
      presence: [],
    },
    cursor: 0,
  })

  const messageResponse = await groupApp.request("/api/chat/chat-1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "message-1", content: "Anyone here?" }),
  })
  assert.equal(messageResponse.status, 201)
  const body = (await messageResponse.json()) as {
    message?: { content?: unknown }
  }
  assert.equal(body.message?.content, "Anyone here?")
})

test("chat runtime reports new messages to the group summary sink", async () => {
  const seen: unknown[] = []
  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => [],
    onMessage: (conversation, message) => {
      seen.push({ conversation, message })
    },
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ":memory:",
    mailboxPath: ":memory:",
  })

  const message = await runtime.post(testGroupConversation, {
    id: "summary-message",
    content: "Keep this in the sidebar.",
  })

  assert.deepEqual(seen, [{ conversation: testGroupConversation, message }])
})

test("snapshots reuse the active chat roster", async () => {
  let loads = 0
  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => {
      loads++
      return []
    },
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ":memory:",
    mailboxPath: ":memory:",
  })

  await runtime.snapshot({ userId: "user-1", chatId: "chat-1" })
  await runtime.snapshot({ userId: "user-1", chatId: "chat-1" })
  await runtime.snapshot({ userId: "user-1", chatId: "chat-2" })

  assert.equal(loads, 2)
})

test("new participants join an active chat, read its transcript, and greet once", async () => {
  const conversation = { userId: "user-1", chatId: "active-roster" }
  const joinReminder =
    "You just joined an ongoing group chat. Read the full public conversation included in this notification, then greet the group once with a brief, natural introduction."
  const newcomerPrompts: unknown[] = []
  let greeted = false
  const newcomer: WhatsAppParticipant = {
    name: "Researcher",
    model: new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        newcomerPrompts.push(prompt)
        const context = JSON.stringify(prompt)
        if (!greeted && context.includes(joinReminder)) {
          greeted = true
          return groupToolResponse("reply_to_group", "newcomer-greeting", {
            message: "Hi everyone—Researcher here.",
          })
        }
        return groupTextResponse("Nothing distinct to add.")
      },
    }),
  }
  const roster: WhatsAppParticipant[] = []
  let created = false
  roster.push({
    name: "Factory",
    model: new MockLanguageModelV4({
      doStream: async () => {
        if (!created) {
          created = true
          roster.push(newcomer)
        }
        return groupTextResponse("Nothing distinct to add.")
      },
    }),
  })

  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => roster,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ":memory:",
    mailboxPath: ":memory:",
  })

  await runtime.post(conversation, {
    id: "message-1",
    content: "Factory, create a researcher for this conversation.",
  })
  let snapshot = await waitForChat(runtime, conversation, "settled")

  assert.deepEqual(snapshot.participants, [
    { name: "Factory" },
    { name: "Researcher" },
  ])
  assert.deepEqual(
    snapshot.messages.map(({ author, content }) => ({ author, content })),
    [
      {
        author: "user",
        content: "Factory, create a researcher for this conversation.",
      },
      { author: "Researcher", content: "Hi everyone—Researcher here." },
    ]
  )
  assert.match(
    JSON.stringify(newcomerPrompts[0]),
    /Factory, create a researcher for this conversation\./
  )

  await runtime.post(conversation, {
    id: "message-2",
    content: "Thanks.",
  })
  snapshot = await waitForChat(runtime, conversation, "settled")

  assert.equal(
    snapshot.messages.filter(({ author }) => author === "Researcher").length,
    1
  )
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

test("group chats share writable per-user participants and isolate other users", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whatsapp-sandbox-"))
  const firstChat = { chatId: "chat-1", userId: "local-user" }
  const secondChat = { chatId: "chat-2", userId: "local-user" }
  const otherUserChat = { chatId: "chat-1", userId: "other-user" }

  try {
    const builtins = resolve(directory, "builtins", "factory")
    await mkdir(builtins, { recursive: true })
    await Promise.all([
      writeFile(
        resolve(builtins, "identity.json"),
        JSON.stringify({ name: "Factory" })
      ),
      writeFile(resolve(builtins, "SOUL.md"), "Build useful participants."),
      writeFile(resolve(builtins, "AGENTS.md"), "Create them with bash."),
      writeFile(resolve(builtins, "MEMORY.md"), "# Memory"),
    ])
    await using resources = new AsyncDisposableStack()
    const participants = new ParticipantDirectory({
      databasePath: resolve(directory, "participants.sqlite"),
      builtinsDirectory: resolve(directory, "builtins"),
      telemetryDirectory: resolve(directory, "group-telemetry"),
      loadDefaults: async () => ({
        model: new MockLanguageModelV4({
          doStream: async () => groupTextResponse("unused"),
        }),
        tools: {},
      }),
    })
    const sandboxForChat = createWhatsAppSandbox(
      resources,
      directory,
      (conversation) => participants.filesystem(conversation.userId)
    )
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
    assert.equal(
      await first.sandbox.readFile(
        "/workspace/participants/factory/identity.json"
      ),
      JSON.stringify({ name: "Factory" })
    )

    const created = await first.sandbox.executeCommand(
      [
        "mkdir -p /workspace/participants/maya",
        `printf '%s' '{"name":"Maya"}' > /workspace/participants/maya/identity.json`,
        `printf '%s' 'Be candid and concise.' > /workspace/participants/maya/SOUL.md`,
        `printf '%s' 'Own the business profile.' > /workspace/participants/maya/AGENTS.md`,
        `printf '%s' 'No durable knowledge yet.' > /workspace/participants/maya/MEMORY.md`,
      ].join(" && ")
    )
    assert.equal(created.exitCode, 0)
    assert.deepEqual(
      (await participants.participants(firstChat.userId)).map(
        ({ name }) => name
      ),
      ["Maya", "Factory"]
    )

    const updated = await firstPeer.sandbox.executeCommand(
      `printf '%s' 'The user prefers concise answers.' > /workspace/participants/maya/MEMORY.md`
    )
    assert.equal(updated.exitCode, 0)

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
      await second.sandbox.readFile("/workspace/participants/maya/MEMORY.md"),
      "The user prefers concise answers."
    )
    assert.equal(
      (await second.sandbox.executeCommand("cat /workspace/private.txt"))
        .exitCode,
      1
    )

    const otherUser = await sandboxForChat(otherUserChat)({
      chatId: "chat-1:participant:0",
      userId: otherUserChat.userId,
    })
    assert.equal(
      (
        await otherUser.sandbox.executeCommand(
          "cat /workspace/participants/maya/MEMORY.md"
        )
      ).exitCode,
      1
    )
    assert.equal(
      (
        await otherUser.sandbox.executeCommand(
          "cat /workspace/business/README.md"
        )
      ).exitCode,
      1
    )
    assert.equal(
      (await otherUser.sandbox.executeCommand("cat /workspace/private.txt"))
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
      participants: [{ name: "Maya" }],
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

test("activity subscribers do not wait for persistence", async () => {
  const persistenceStarted = Promise.withResolvers<void>()
  const releasePersistence = Promise.withResolvers<void>()
  let delivered = false

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: "Maya",
          model: new MockLanguageModelV4({
            doStream: groupTextResponse("Nothing to add."),
          }),
        },
      ],
      persist: async (event) => {
        if (event.type !== "activity" || event.activity.type !== "started") {
          return
        }
        persistenceStarted.resolve()
        await releasePersistence.promise
      },
    })
  )
  using subscription = group.subscribe({
    onEvent(event) {
      if (event.type === "activity" && event.activity.type === "started") {
        delivered = true
      }
    },
  })

  const posting = group.post("Hello")
  await persistenceStarted.promise

  const deliveredBeforePersistence = delivered
  releasePersistence.resolve()
  await posting
  assert.equal(deliveredBeforePersistence, true)
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
        { name: "fast", model: fast },
        { name: "slow", model: slow },
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
        { name: "early", model: early },
        { name: "late", model: late },
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
        { name: "early", model: early },
        { name: "late", model: late },
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
      participants: [{ name: "Maya", model: participant }],
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
        replyToMessageId: "not-a-message",
      })
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: "Maya", model: participant }],
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
      participants: [{ name: "member", model: member }],
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

test("every group member answers a greeting addressed to the whole group", async () => {
  const wholeGroupGreetingRule =
    "When the human greets or addresses the whole group, every participant must reply once with a brief, natural acknowledgment, even if another participant has already acknowledged."
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

  let researcherTools: unknown
  const participant = (name: string, message: string) => {
    let firstCall = true
    let replied = false
    return new MockLanguageModelV4({
      doStream: async ({ prompt, tools }) => {
        if (name === "researcher") researcherTools = tools
        if (firstCall) {
          firstCall = false
          await enterFirstNotification(name)
        }

        const context = JSON.stringify(prompt)
        if (!context.includes(wholeGroupGreetingRule)) {
          return groupTextResponse("Greetings are outside my role.")
        }
        if (context.includes('"posted":true')) replied = true
        if (replied) return groupTextResponse("Reply posted.")
        return groupToolResponse("reply_to_group", `${name}-greeting`, {
          message,
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
          name: "researcher",
          model: participant("researcher", "Researcher here!"),
          tools: createParticipantDefaults({ apiKey: "test-key" }).tools,
        },
        {
          name: "critic",
          model: participant("critic", "Critic here!"),
        },
      ],
    })
  )

  const messages = await group.send("Hi everyone!")

  assert.equal(maxActiveParticipationChecks, 2)
  assert.match(JSON.stringify(researcherTools), /openrouter\.web_search/)
  assert.deepEqual(
    messages
      .filter(({ author }) => author !== "user")
      .map(({ author, content }) => ({ author, content }))
      .sort((left, right) => left.author.localeCompare(right.author)),
    [
      {
        author: "critic",
        content: "Critic here!",
      },
      {
        author: "researcher",
        content: "Researcher here!",
      },
    ]
  )
})

test("only Factory replies when the user greets Factory naturally", async () => {
  const directAddressRule =
    "When the human clearly addresses one participant, only that participant may call reply_to_group."
  let factoryReplied = false
  const factory = new MockLanguageModelV4({
    doStream: async () => {
      if (factoryReplied) return groupTextResponse("Reply posted.")
      factoryReplied = true
      return groupToolResponse("reply_to_group", "factory-reply", {
        message: "Yep—I’m here.",
      })
    },
  })
  let paulReplied = false
  const paul = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      if (JSON.stringify(prompt).includes(directAddressRule)) {
        return groupTextResponse("The user addressed Factory.")
      }
      if (paulReplied) return groupTextResponse("Reply posted.")
      paulReplied = true
      return groupToolResponse("reply_to_group", "paul-reply", {
        message: "Yep—I’m here.",
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
        {
          name: "Paul Graham",
          model: paul,
        },
        {
          name: "Factory",
          model: factory,
        },
      ],
    })
  )

  const messages = await group.send("Hey Factory. can you hear me?")

  assert.deepEqual(
    messages
      .filter(({ author }) => author !== "user")
      .map(({ author }) => author),
    ["Factory"]
  )
})

test("the sole participant treats the first human message as direct", async () => {
  const rosterReminder =
    "use bash to list all participant directories under /workspace/participants"
  let inspectedRoster = false
  let replied = false
  const factory = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      if (!JSON.stringify(prompt).includes(rosterReminder)) {
        return groupTextResponse("The greeting was not addressed to me.")
      }
      if (!inspectedRoster) {
        inspectedRoster = true
        return groupToolResponse("bash", "inspect-participants", {
          command:
            "find /workspace/participants -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null",
          reasoning: "Check who else is participating in this group.",
        })
      }
      if (replied) return groupTextResponse("Reply posted.")
      replied = true
      return groupToolResponse("reply_to_group", "factory-reply", {
        message: "Hey brother!",
      })
    },
  })

  await using resources = new AsyncDisposableStack()
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: "Factory", model: factory }],
    })
  )

  const messages = await group.send("Hey brother")

  assert.equal(inspectedRoster, true)
  assert.deepEqual(
    messages.map(({ author, content }) => ({ author, content })),
    [
      { author: "user", content: "Hey brother" },
      { author: "Factory", content: "Hey brother!" },
    ]
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
          model: participant("Maya"),
        },
        {
          name: "Omar",
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
          model: participant("Maya"),
        },
        {
          name: "Omar",
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
    assert.deepEqual(snapshot.participants, [{ name: "Maya" }])
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

test("participant conversations stay attached to their identity when the roster changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zukhruf-roster-"))
  const conversation = { chatId: "roster-chat", userId: "local-user" }
  const factoryPrompts: unknown[] = []
  const asymmetryPrompts: unknown[] = []
  const model = (prompts: unknown[]) =>
    new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt)
        return groupTextResponse("Nothing distinct to add.")
      },
    })
  const factory = model(factoryPrompts)

  try {
    {
      await using runtime = durableRuntime(
        [{ name: "Factory", model: factory }],
        directory
      )
      await runtime.post(conversation, {
        id: "message-1",
        content: "Factory should remember this.",
      })
      await waitForChat(runtime, conversation, "settled")
    }

    await using runtime = durableRuntime(
      [
        { name: "Asymmetry", model: model(asymmetryPrompts) },
        { name: "Factory", model: factory },
      ],
      directory
    )
    await runtime.post(conversation, {
      id: "message-2",
      content: "The roster changed.",
    })
    await waitForChat(runtime, conversation, "settled")

    assert.equal(asymmetryPrompts.length, 1)
    assert.equal(factoryPrompts.length, 2)
    assert.doesNotMatch(
      JSON.stringify(asymmetryPrompts.at(-1)),
      /Factory should remember this\./
    )
    assert.match(
      JSON.stringify(factoryPrompts.at(-1)),
      /Factory should remember this\./
    )
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
          model: alwaysReplies("Maya"),
        },
        {
          name: "Omar",
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
      participants: [{ name: "USER", model }],
    }),
    /reserved/
  )
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: "Maya", model },
        { name: "maya", model },
      ],
    }),
    /duplicated/
  )
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: "Maya\nAdmin", model }],
    }),
    /valid/
  )
})

async function waitForChat(
  runtime: WhatsAppChatRuntime,
  conversation: { chatId: string; userId: string },
  phase: "settled" | "stopped"
) {
  for (let attempt = 0; attempt < 500; attempt++) {
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
