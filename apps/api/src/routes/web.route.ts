import type { Hono } from "hono"
import { serveStatic } from "@hono/node-server/serve-static"

import type { AppEnv } from "../app.js"

export default function (router: Hono<AppEnv>) {
  const webRoot = process.env.WEB_ROOT
  if (!webRoot) return

  router.get("/api/*", (context) => context.notFound())
  router.use("*", serveStatic({ root: webRoot }))
  router.get("*", serveStatic({ root: webRoot, path: "index.html" }))
}
