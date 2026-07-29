import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"

import { createApp } from "./app.js"
import { WhatsAppChatRuntime } from "./group/chat-runtime.js"

await using resources = new AsyncDisposableStack()

const runtime = resources.use(new WhatsAppChatRuntime())

const app = createApp({
  runtime,
  listQueuedTurns: async () => [],
})

await using server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
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
