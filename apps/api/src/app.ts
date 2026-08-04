import { Hono } from "hono"
import { cors } from "hono/cors"

import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import type { GroupRecord } from "./group/group-store.js"
import type { MarketplaceGroupTemplateStore } from "./group/marketplace-group-template-store.js"
import type { AgentTemplate } from "./group/participants/agent-catalog.js"
import type { OpenArtifact } from "./routes/chat.route.js"

const configuredOrigin = process.env.WEB_ORIGIN
const routes = await Promise.all([
  import("./routes/health.route.js"),
  import("./routes/agents.route.js"),
  import("./routes/group-templates.route.js"),
  import("./routes/auth.route.js"),
  import("./routes/groups.route.js"),
  import("./routes/chat.route.js"),
])

export interface AppDependencies {
  agents: readonly AgentTemplate[]
  createGroup(
    userId: string,
    input: { name: string; agentIds: readonly string[] }
  ): GroupRecord
  listGroups(userId: string): GroupRecord[]
  marketplaceTemplates: Pick<
    MarketplaceGroupTemplateStore,
    | "create"
    | "update"
    | "publish"
    | "unpublish"
    | "published"
    | "findPublished"
  >
  auth: {
    handler(request: Request): Promise<Response>
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>
    getSessionResponse(request: Request): Promise<Response>
    startDevice(headers: Headers): Promise<Response>
    pollDevice(headers: Headers): Promise<Response>
    cancelDevice(headers: Headers): Promise<Response>
  }
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >
  openArtifact: OpenArtifact
}

export type AppEnv = {
  Variables: { userId: string; dependencies: AppDependencies }
}

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<AppEnv>().use(
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
  app.use("/api/*", async (context, next) => {
    context.set("dependencies", dependencies)
    await next()
  })

  for (const route of routes) {
    route.default(app.basePath("/api"))
  }

  return app
}
