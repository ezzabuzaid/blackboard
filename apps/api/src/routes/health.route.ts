import type { Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"

export function createHealthRoute(
  app: Hono<{ Variables: { userId: string } }>
) {
  /**
   * @openapi getHealth
   * @tags health
   * @description Reports API health.
   */
  app.get(
    "/api/health",
    validate(() => ({})),
    (context) => context.json({ status: "ok" })
  )
}
