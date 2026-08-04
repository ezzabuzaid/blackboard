import type { Hono } from "hono"
import { serveStatic } from "@hono/node-server/serve-static"

export function createWebRoute(
  app: Hono<{ Variables: { userId: string } }>,
  webRoot: string
) {
  app.get("/api/*", (context) => context.notFound())
  app.use("*", serveStatic({ root: webRoot }))
  app.get("*", serveStatic({ root: webRoot, path: "index.html" }))
}
