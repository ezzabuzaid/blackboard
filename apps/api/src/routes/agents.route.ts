import type { Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"

import type { AgentTemplate } from "../group/participants/agent-catalog.js"

export function createAgentsRoute(
  app: Hono<{ Variables: { userId: string } }>,
  agents: readonly AgentTemplate[]
) {
  /**
   * @openapi listAgents
   * @tags agents
   * @description Lists the available agent catalog.
   */
  app.get(
    "/api/agents",
    validate(() => ({})),
    (context) => context.json({ agents })
  )
}
