import type { DrainContext } from "evlog"
import { evlog, useLogger } from "evlog/hono"
import {
  ZUKHRUF_ROUTE_PREFIX,
  zukhruf,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"
import type { User } from "better-auth"
import { Hono } from "hono"
import { cors } from "hono/cors"

import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import type { GroupRecord } from "./group/group-store.js"
import type { MarketplaceGroupTemplateStore } from "./group/marketplace-group-template-store.js"
import type { GroupShareStore } from "./group/share-store.js"
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
  import("./routes/shares.route.js"),
])

export interface AppDependencies {
  structuredLogDrain?: (context: DrainContext) => void | Promise<void>
  agents: readonly AgentTemplate[]
  createGroup(
    userId: string,
    input: { name: string; agentIds: readonly string[] }
  ): GroupRecord
  listGroups(userId: string): GroupRecord[]
  getGroup(userId: string, groupId: string): GroupRecord | null
  groupOwner(groupId: string): string | null
  markGroupRead(userId: string, groupId: string): boolean
  setGroupPinned(userId: string, groupId: string, pinned: boolean): boolean
  setGroupArchived(userId: string, groupId: string, archived: boolean): boolean
  clearGroupChat(userId: string, groupId: string): Promise<void>
  shares: Pick<GroupShareStore, "create" | "active" | "revoke" | "resolve">
  marketplaceTemplates: Pick<
    MarketplaceGroupTemplateStore,
    | "create"
    | "update"
    | "publish"
    | "unpublish"
    | "published"
    | "findPublished"
    | "findBySourceGroup"
  >
  auth: {
    handler(request: Request): Promise<Response>
    getSession(
      headers: Headers
    ): Promise<{ user: Pick<User, "id" | "name"> } | null>
    getSessionResponse(request: Request): Promise<Response>
  }
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "traces" | "transcript" | "clear"
  > &
    Parameters<typeof zukhruf>[0]
  openArtifact: OpenArtifact
}

export type AppEnv = {
  Variables: {
    userId: string
    publisherName: string
    dependencies: AppDependencies
  }
}

/**
 * Zukhruf derives its own session ids from the authenticated user, so only the
 * routes accepting a caller-supplied session id can reach another user's group.
 */
function ownedSessionsOnly({
  runtime,
  groupOwner,
}: AppDependencies): Parameters<typeof zukhruf>[0] {
  const reachable = ({ chatId, userId }: ConversationId) => {
    const owner = groupOwner(chatId)
    return owner === null || owner === userId
  }

  return {
    info: runtime.info,
    createSession: (conversation) => runtime.createSession(conversation),
    enqueue: (conversation, turn) => runtime.enqueue(conversation, turn),
    sessionExists: async (conversation) =>
      reachable(conversation) && (await runtime.sessionExists(conversation)),
    observe: (conversation) =>
      reachable(conversation)
        ? runtime.observe(conversation)
        : { cancel: async () => {}, resume: async () => null },
  }
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
  app.route(zukhrufPath, zukhruf(ownedSessionsOnly(dependencies)))

  for (const route of routes) {
    route.default(app.basePath("/api"))
  }

  return app
}
