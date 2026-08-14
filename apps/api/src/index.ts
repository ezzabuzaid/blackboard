import { mkdirSync } from "node:fs"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"

import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"
import { initLogger } from "evlog"
import { createFsDrain } from "evlog/fs"

import { createApp } from "./app.js"
import { createAuthentication } from "./auth.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { createGroupDeletion } from "./group/delete-group.js"
import { GroupStore } from "./group/group-store.js"
import { MarketplaceGroupTemplateStore } from "./group/marketplace-group-template-store.js"
import { GroupShareStore } from "./group/share-store.js"
import { loadAgentCatalog } from "./group/participants/agent-catalog.js"
import { ParticipantDirectory } from "./group/participants/index.js"
import { createWhatsAppSandbox } from "./group/sandbox.js"
import { createParticipantDefaults } from "./participant-defaults.js"
import { openArtifact, sandboxRoot } from "./sandbox.js"
import { createOpenRouterTranscriber } from "./transcription.js"

const dataDirectory = process.env.ZUKHRUF_DATA_DIR
if (!dataDirectory) throw new Error("ZUKHRUF_DATA_DIR is required")
mkdirSync(dataDirectory, { recursive: true })

const structuredLogDrain = createFsDrain({
  dir: resolve(import.meta.dirname, "../.evlog/logs"),
  maxFiles: 5,
  maxSizePerFile: 10 * 1024 * 1024,
  pretty: false,
})
initLogger({
  drain: structuredLogDrain,
  env: { service: "baseera-api" },
  redact: true,
  silent: true,
})

const port = Number(process.env.PORT)
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port")
}

const authSecret = process.env.BETTER_AUTH_SECRET
if (!authSecret || authSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters")
}

const openRouterAPIKey = process.env.OPENROUTER_API_KEY?.trim()
if (!openRouterAPIKey) throw new Error("OPENROUTER_API_KEY is required")
const participantDefaults = createParticipantDefaults({
  apiKey: openRouterAPIKey,
  modelId: process.env.OPENROUTER_MODEL?.trim() || undefined,
  appUrl: process.env.WEB_ORIGIN,
})
const transcribeAudio = createOpenRouterTranscriber({
  apiKey: openRouterAPIKey,
  model:
    process.env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() ||
    "openai/gpt-4o-mini-transcribe",
  appUrl: process.env.WEB_ORIGIN,
})

const baseURL =
  process.env.BETTER_AUTH_URL ??
  process.env.WEB_ORIGIN ??
  `http://localhost:${port}`
const trustedOrigins = process.env.WEB_ORIGIN
  ? [process.env.WEB_ORIGIN]
  : ["http://localhost:5173", "http://127.0.0.1:5173"]

await using resources = new AsyncDisposableStack()

const authentication = resources.use(
  await createAuthentication({
    databasePath: resolve(dataDirectory, "auth.sqlite"),
    baseURL,
    secret: authSecret,
    trustedOrigins,
  })
)
const sandboxResources = resources.use(new AsyncDisposableStack())
const agents = loadAgentCatalog(
  resolve(import.meta.dirname, "../../../catalog/agents")
)
const groups = new GroupStore(
  resolve(dataDirectory, "group.sqlite"),
  agents.map(({ id }) => id)
)
resources.defer(() => groups[Symbol.dispose]())
const marketplaceTemplates = new MarketplaceGroupTemplateStore(
  resolve(dataDirectory, "group-templates.sqlite"),
  agents.map(({ id }) => id)
)
resources.defer(() => marketplaceTemplates[Symbol.dispose]())
const shares = new GroupShareStore(resolve(dataDirectory, "shares.sqlite"))
resources.defer(() => shares[Symbol.dispose]())
const participants = new ParticipantDirectory({
  databasePath: resolve(dataDirectory, "participants.sqlite"),
  builtinsDirectory: resolve(import.meta.dirname, "../../../participants"),
  catalogDirectory: resolve(import.meta.dirname, "../../../catalog/agents"),
  telemetryDirectory: resolve(dataDirectory, "group-telemetry"),
  loadDefaults: async () => participantDefaults,
})
const groupAgentIds = (conversation: { userId: string; chatId: string }) => {
  const agentIds = groups.get(
    conversation.userId,
    conversation.chatId
  )?.agentIds
  return agentIds?.length ? agentIds : undefined
}
const runtime = resources.use(
  new WhatsAppChatRuntime({
    loadParticipants: (conversation) =>
      participants.participants(
        conversation.userId,
        groupAgentIds(conversation)
      ),
    onMessage: (conversation, message) => {
      groups.recordMessage(conversation.userId, conversation.chatId, message)
    },
    limits: {
      notifications: 25,
      agentMessages: 100,
      transcriptMessages: 500,
    },
    sandboxForChat: createWhatsAppSandbox(
      sandboxResources,
      dataDirectory,
      (conversation) =>
        participants.filesystem(
          conversation.userId,
          groupAgentIds(conversation)
        )
    ),
    databasePath: resolve(dataDirectory, "group.sqlite"),
    mailboxPath: resolve(dataDirectory, "mailbox.sqlite"),
  })
)

const groupDeletion = createGroupDeletion({
  exists: (userId, groupId) => groups.get(userId, groupId) !== null,
  clearRuntime: (userId, groupId) =>
    runtime.clear({ chatId: groupId, userId }),
  deleteSandbox: (userId, groupId) =>
    rm(sandboxRoot(dataDirectory, { chatId: groupId, userId }), {
      recursive: true,
      force: true,
    }),
  deleteShares: (userId, groupId) => {
    shares.deleteForGroup(userId, groupId)
  },
  removeMarketplaceSource: (userId, groupId) => {
    marketplaceTemplates.removeSourceGroup(userId, groupId)
  },
  deleteRecord: (userId, groupId) => groups.delete(userId, groupId),
})

const app = createApp({
  structuredLogDrain,
  agents,
  createGroup: (userId, input) => groups.create(userId, input),
  listGroups: (userId) =>
    groups
      .list(userId)
      .filter(({ id }) => !groupDeletion.has(userId, id)),
  getGroup: (userId, groupId) =>
    groupDeletion.has(userId, groupId) ? null : groups.get(userId, groupId),
  groupOwner: (groupId) => groups.ownerOf(groupId),
  groupDeleting: (groupId) => groupDeletion.hasGroup(groupId),
  markGroupRead: (userId, groupId) =>
    !groupDeletion.has(userId, groupId) && groups.markRead(userId, groupId),
  setGroupPinned: (userId, groupId, pinned) =>
    groups.setPinned(userId, groupId, pinned),
  setGroupArchived: (userId, groupId, archived) =>
    groups.setArchived(userId, groupId, archived),
  clearGroupChat: async (userId, groupId) => {
    const conversation = { chatId: groupId, userId }
    await runtime.clear(conversation)
    await rm(sandboxRoot(dataDirectory, conversation), {
      recursive: true,
      force: true,
    })
    groups.clearMessages(userId, groupId)
  },
  deleteGroup: (userId, groupId) => groupDeletion.delete(userId, groupId),
  marketplaceTemplates,
  shares,
  auth: {
    handler: authentication.auth.handler,
    getSession: (headers) => authentication.auth.api.getSession({ headers }),
    getSessionResponse: (request) =>
      authentication.auth.api.getSession({
        headers: request.headers,
        asResponse: true,
      }),
  },
  runtime,
  transcribeAudio,
  openArtifact: (conversation, path) =>
    openArtifact(dataDirectory, conversation, path),
})

const webRoute = await import("./routes/web.route.js")
webRoute.default(app)

await using server = serve(
  {
    fetch: app.fetch,
    port,
    ...(process.env.PORTLESS_URL ? { hostname: "127.0.0.1" } : {}),
  },
  ({ port }) =>
    console.log(
      `API listening on ${process.env.PORTLESS_URL ?? `http://localhost:${port}`}`
    )
)

createTerminus(server, {
  signals: ["SIGINT", "SIGTERM"],
  useExit0: true,
  onSignal: () => resources.disposeAsync(),
  logger: (message, error) => console.error(message, error),
})

await new Promise<never>(() => {})
