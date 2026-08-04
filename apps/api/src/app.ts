import { Hono } from "hono"
import { cors } from "hono/cors"

import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import type { AgentTemplate } from "./group/participants/agent-catalog.js"
import { createAgentsRoute } from "./routes/agents.route.js"
import { createAuthRoutes, type AuthRoutes } from "./routes/auth.route.js"
import { createChatRoutes, type OpenArtifact } from "./routes/chat.route.js"
import { createGroupsRoute, type CreateGroup } from "./routes/groups.route.js"
import { createHealthRoute } from "./routes/health.route.js"

const configuredOrigin = process.env.WEB_ORIGIN

export interface AppDependencies {
  agents: readonly AgentTemplate[]
  createGroup: CreateGroup
  auth: AuthRoutes
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >
  openArtifact: OpenArtifact
}

export function createApp({
  agents,
  createGroup,
  auth,
  runtime,
  openArtifact,
}: AppDependencies) {
  const app = new Hono<{ Variables: { userId: string } }>().use(
    "/api/*",
    cors({
      credentials: true,
      origin: (origin) => {
        if (configuredOrigin) {
          return origin === configuredOrigin ? origin : null
        }

        try {
          const url = new URL(origin)
          return url.protocol === "http:" &&
            (url.hostname === "localhost" || url.hostname === "127.0.0.1")
            ? origin
            : null
        } catch {
          return null
        }
      },
    })
  )

  createHealthRoute(app)
  createAgentsRoute(app, agents)
  createAuthRoutes(app, auth)
  createGroupsRoute(app, auth, createGroup)
  createChatRoutes(app, auth, runtime, openArtifact)

  return app
}
