import { serve } from "@hono/node-server"

import { createZukhrufHost } from "./agent/runtime.js"
import { createApp } from "./app.js"

const port = Number(process.env.PORT ?? 3001)
const host = await createZukhrufHost()
const app = createApp(host.runtime)

const server = serve({ fetch: app.fetch, port }, ({ port: listeningPort }) => {
  console.log(`API listening on http://localhost:${listeningPort}`)
})

let stopping: Promise<void> | undefined
function stop() {
  stopping ??= (async () => {
    await server[Symbol.asyncDispose]()
    await host.close()
  })()
  void stopping.catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

process.once("SIGINT", stop)
process.once("SIGTERM", stop)
