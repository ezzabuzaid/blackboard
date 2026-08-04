import type { Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"

import type { AppEnv } from "../app.js"

export default function (router: Hono<AppEnv>) {
  /**
   * @openapi listAgents
   * @tags agents
   * @description Lists the available agent catalog.
   */
  router.get(
    "/agents",
    validate(() => ({})),
    (context) => context.json({ agents: context.var.dependencies.agents })
  )
}
