import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"
import { initLogger } from "evlog"
import { createFsDrain } from "evlog/fs"

import { createApp } from "./app.js"
import { createAuthentication } from "./auth.js"
import { createChatGPTSubscription } from "./chatgpt.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { GroupStore } from "./group/group-store.js"
import { MarketplaceGroupTemplateStore } from "./group/marketplace-group-template-store.js"
import { loadAgentCatalog } from "./group/participants/agent-catalog.js"
import { ParticipantDirectory } from "./group/participants/index.js"
import { createWhatsAppSandbox } from "./group/sandbox.js"
import { openArtifact } from "./sandbox.js"

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

const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`
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
const participants = new ParticipantDirectory({
  databasePath: resolve(dataDirectory, "participants.sqlite"),
  builtinsDirectory: resolve(import.meta.dirname, "../../../participants"),
  catalogDirectory: resolve(import.meta.dirname, "../../../catalog/agents"),
  telemetryDirectory: resolve(dataDirectory, "group-telemetry"),
  loadDefaults: async (userId) => {
    const chatgpt = await createChatGPTSubscription(authentication.auth, userId)
    return {
      model: chatgpt.model,
      tools: { web_search: chatgpt.webSearch },
    }
  },
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

const app = createApp({
  structuredLogDrain,
  agents,
  createGroup: (userId, input) => groups.create(userId, input),
  listGroups: (userId) => groups.list(userId),
  markGroupRead: (userId, groupId) => groups.markRead(userId, groupId),
  marketplaceTemplates,
  auth: {
    handler: authentication.auth.handler,
    getSession: (headers) => authentication.auth.api.getSession({ headers }),
    getSessionResponse: (request) =>
      authentication.auth.api.getSession({
        headers: request.headers,
        asResponse: true,
      }),
    startDevice: (headers) =>
      authentication.auth.api.device({ headers, asResponse: true }),
    pollDevice: (headers) =>
      authentication.auth.api.poll({ headers, asResponse: true }),
    cancelDevice: (headers) =>
      authentication.auth.api.cancel({ headers, asResponse: true }),
  },
  runtime,
  openArtifact: (conversation, path) =>
    openArtifact(dataDirectory, conversation, path),
})

const webRoute = await import("./routes/web.route.js")
webRoute.default(app)

await using server = serve(
  {
    fetch: app.fetch,
    port,
  },
  ({ port }) => console.log(`API listening on http://localhost:${port}`)
)

createTerminus(server, {
  signals: ["SIGINT", "SIGTERM"],
  useExit0: true,
  onSignal: () => resources.disposeAsync(),
  logger: (message, error) => console.error(message, error),
})

await new Promise<never>(() => {})
