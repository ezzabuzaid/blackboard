import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"

import { createApp } from "./app.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import { whatsappParticipants } from "./group/participants.js"
import { createWhatsAppSandbox } from "./group/sandbox.js"

const dataDirectory = process.env.ZUKHRUF_DATA_DIR
if (!dataDirectory) throw new Error("ZUKHRUF_DATA_DIR is required")
mkdirSync(dataDirectory, { recursive: true })

const port = Number(process.env.PORT)
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port")
}

await using resources = new AsyncDisposableStack()

const sandboxResources = resources.use(new AsyncDisposableStack())
const runtime = resources.use(
  new WhatsAppChatRuntime({
    participants: whatsappParticipants,
    limits: {
      notifications: 25,
      agentMessages: 100,
      transcriptMessages: 500,
    },
    sandboxForChat: createWhatsAppSandbox(sandboxResources, dataDirectory),
    databasePath: resolve(dataDirectory, "group.sqlite"),
    mailboxPath: resolve(dataDirectory, "mailbox.sqlite"),
    approvalPath: resolve(dataDirectory, "approval.sqlite"),
  })
)

const app = createApp({
  runtime,
  listQueuedTurns: async () => [],
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
