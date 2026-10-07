import type { DrainContext } from "evlog"
import { evlog, useLogger } from "evlog/hono"
import { type ConversationId } from "@deepagents/experimental/zukhruf"
import {
  type HttpRuntime,
  http,
} from "@deepagents/experimental/zukhruf/http"
import type { User } from "better-auth"
import { Hono } from "hono"
import { cors } from "hono/cors"

import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"
import type { GroupRecord } from "./group/group-store.js"
import type { MarketplaceGroupTemplateStore } from "./group/marketplace-group-template-store.js"
import type { GroupShareStore } from "./group/share-store.js"
import type { AgentTemplate } from "./group/participants/agent-catalog.js"
import type { OpenArtifact } from "./routes/chat.route.js"
import type { TranscriptionAudio } from "./transcription.js"
import { ZUKHRUF_HTTP_PATH } from "./zukhruf-http.js"

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
  listGroups(userId: string): Promise<GroupRecord[]>
  getGroup(userId: string, groupId: string): GroupRecord | null
  groupOwner(groupId: string): string | null
  markGroupRead(userId: string, groupId: string): boolean
  setGroupPinned(userId: string, groupId: string, pinned: boolean): boolean
  setGroupArchived(userId: string, groupId: string, archived: boolean): boolean
  clearGroupChat(userId: string, groupId: string): Promise<void>
  deleteGroup(userId: string, groupId: string): Promise<boolean>
  groupDeleting(groupId: string): boolean
  shares: Pick<
    GroupShareStore,
    "create" | "active" | "revoke" | "resolve" | "deleteForGroup"
  >
  marketplaceTemplates: Pick<
    MarketplaceGroupTemplateStore,
    | "create"
    | "update"
    | "publish"
    | "unpublish"
    | "published"
    | "owns"
    | "findPublished"
    | "findBySourceGroup"
    | "removeSourceGroup"
    | "delete"
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
    | "clear"
    | "conversationStatus"
    | "createSession"
    | "enqueue"
    | "info"
    | "messageCount"
    | "observe"
    | "plugin"
    | "post"
    | "sessionExists"
    | "subscribeConversationStatus"
    | "snapshot"
    | "stop"
    | "traces"
    | "transcript"
  >
  openArtifact: OpenArtifact
  transcribeAudio(audio: TranscriptionAudio): Promise<string>
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
  groupDeleting,
  listGroups,
}: AppDependencies): HttpRuntime {
  const reachable = ({ chatId, userId }: ConversationId) => {
    if (groupDeleting(chatId)) return false
    const owner = groupOwner(chatId)
    return owner === null || owner === userId
  }

  return {
    info: runtime.info,
    createSession: (conversation) => runtime.createSession(conversation),
    enqueue: (conversation, turn) => runtime.enqueue(conversation, turn),
    plugin: (definition) => runtime.plugin(definition),
    listHistory: async (userId) => {
      if (!userId) return []
      return Promise.all(
        (await listGroups(userId)).map(async (group) => {
          const conversation = { chatId: group.id, userId }
          const [status, messageCount] = await Promise.all([
            runtime.conversationStatus(conversation),
            runtime.messageCount(conversation),
          ])
          return {
            chatId: group.id,
            userId,
            title: group.name,
            createdAt: Date.parse(group.createdAt),
            updatedAt: Date.parse(group.lastMessage?.sentAt ?? group.createdAt),
            messageCount,
            status,
          }
        }),
      )
    },
    sessionExists: async (conversation) =>
      reachable(conversation) && (await runtime.sessionExists(conversation)),
    subscribeConversationStatus: (signal) =>
      runtime.subscribeConversationStatus(signal),
    observe: (conversation) => {
      const observation = reachable(conversation)
        ? runtime.observe(conversation)
        : {
            status: async () => undefined,
            cancel: async () => {},
            resume: async () => null,
          }
      return {
        ...observation,
        engine: {
          getMessages: async () => {
            if (!reachable(conversation)) return []
            const { messages } = await runtime.transcript(conversation)
            return messages.map((message) => ({
              id: message.id,
              role: message.author === "user" ? "user" : "assistant",
              parts: [{ type: "text", text: message.content }],
              metadata: { whatsapp: message },
            }))
          },
        },
      }
    },
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

  const zukhrufPath = `/api${ZUKHRUF_HTTP_PATH}` as const
  app.use(`${zukhrufPath}/*`, async (context, next) => {
    const session = await dependencies.auth.getSession(context.req.raw.headers)
    if (session) context.set("userId", session.user.id)
    await next()
  })
  app.route(zukhrufPath, http(ownedSessionsOnly(dependencies)))

  for (const route of routes) {
    route.default(app.basePath("/api"))
  }

  return app
}
