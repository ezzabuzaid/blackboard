import type { Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"

import type { AppEnv } from "../app.js"

export default function (router: Hono<AppEnv>) {
  /**
   * @openapi getHealth
   * @tags health
   * @description Reports API health.
   */
  router.get(
    "/health",
    validate(() => ({})),
    (context) => context.json({ status: "ok" })
  )
}
