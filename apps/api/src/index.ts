import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"

import { createApp } from "./app.js"
import { createAuthentication } from "./auth.js"
import { createChatGPTSubscription } from "./chatgpt.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { ParticipantDirectory } from "./group/participants/index.js"
import { createWhatsAppSandbox } from "./group/sandbox.js"
import { openArtifact } from "./sandbox.js"

const dataDirectory = process.env.ZUKHRUF_DATA_DIR
if (!dataDirectory) throw new Error("ZUKHRUF_DATA_DIR is required")
mkdirSync(dataDirectory, { recursive: true })

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
const participants = new ParticipantDirectory({
  databasePath: resolve(dataDirectory, "participants.sqlite"),
  builtinsDirectory: resolve(import.meta.dirname, "../../../participants"),
  telemetryDirectory: resolve(dataDirectory, "group-telemetry"),
  loadDefaults: async (userId) => {
    const chatgpt = await createChatGPTSubscription(authentication.auth, userId)
    return {
      model: chatgpt.model,
      tools: { web_search: chatgpt.webSearch },
    }
  },
})
const runtime = resources.use(
  new WhatsAppChatRuntime({
    loadParticipants: (userId) => participants.participants(userId),
    limits: {
      notifications: 25,
      agentMessages: 100,
      transcriptMessages: 500,
    },
    sandboxForChat: createWhatsAppSandbox(
      sandboxResources,
      dataDirectory,
      (userId) => participants.filesystem(userId)
    ),
    databasePath: resolve(dataDirectory, "group.sqlite"),
    mailboxPath: resolve(dataDirectory, "mailbox.sqlite"),
  })
)

const app = createApp({
  auth: {
    handler: authentication.auth.handler,
    getSession: (headers) => authentication.auth.api.getSession({ headers }),
    getSessionResponse: (request) =>
      authentication.auth.api.getSession({
        headers: request.headers,
        asResponse: true,
      }),
    startDevice: (request) =>
      authentication.auth.api.device({ request, asResponse: true }),
    pollDevice: (request) =>
      authentication.auth.api.poll({ request, asResponse: true }),
    cancelDevice: (request) =>
      authentication.auth.api.cancel({ request, asResponse: true }),
  },
  runtime,
  openArtifact: (conversation, path) =>
    openArtifact(dataDirectory, conversation, path),
})

const webRoot = process.env.WEB_ROOT
if (webRoot) {
  app.get("/api/*", (context) => context.notFound())
  app.use("*", serveStatic({ root: webRoot }))
  app.get("*", serveStatic({ root: webRoot, path: "index.html" }))
}

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
