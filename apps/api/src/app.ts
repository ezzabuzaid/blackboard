import type { DrainContext } from "evlog"
import { evlog, useLogger } from "evlog/hono"
import {
  ZUKHRUF_ROUTE_PREFIX,
  zukhruf,
} from "@deepagents/experimental/zukhruf"
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
  structuredLogDrain?: (context: DrainContext) => void | Promise<void>
  agents: readonly AgentTemplate[]
  createGroup(
    userId: string,
    input: { name: string; agentIds: readonly string[] }
  ): GroupRecord
  listGroups(userId: string): GroupRecord[]
  markGroupRead(userId: string, groupId: string): boolean
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
  }
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "traces"
  > &
    Parameters<typeof zukhruf>[0]
  openArtifact: OpenArtifact
}

export type AppEnv = {
  Variables: { userId: string; dependencies: AppDependencies }
}

export function createApp(dependencies: AppDependencies) {
  const app = new Hono<AppEnv>()
  if (dependencies.structuredLogDrain) {
    app.use(
      "/api/*",
      evlog({
        drain: dependencies.structuredLogDrain,
        enrich: ({ event, response }) => {
          if (response?.status && response.status >= 500) event.level = "error"
          else if (response?.status && response.status >= 400)
            event.level = "warn"
        },
        redact: true,
      })
    )
    app.use("/api/*", async (context, next) => {
      await next()
      if (context.error) useLogger().error(context.error)
    })
  }
  app.use(
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

  const zukhrufPath = `/api${ZUKHRUF_ROUTE_PREFIX}` as const
  app.use(`${zukhrufPath}/*`, async (context, next) => {
    const session = await dependencies.auth.getSession(context.req.raw.headers)
    if (session) context.set("userId", session.user.id)
    await next()
  })
  app.route(zukhrufPath, zukhruf(dependencies.runtime))

  for (const route of routes) {
    route.default(app.basePath("/api"))
  }

  return app
}
