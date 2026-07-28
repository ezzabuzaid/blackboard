import { Hono } from "hono"
import { cors } from "hono/cors"

import {
  ChatService,
  type ChatRuntime,
  type ChatStreamStore,
} from "./chat/chat-service.js"
import { createChatRoutes, type ListQueuedTurns } from "./chat/routes.js"

const configuredOrigin = process.env.WEB_ORIGIN

export interface AppDependencies {
  runtime: ChatRuntime
  streams: ChatStreamStore
  listQueuedTurns: ListQueuedTurns
}

export function createApp({
  runtime,
  streams,
  listQueuedTurns,
}: AppDependencies) {
  const chats = new ChatService(runtime, streams)

  return new Hono()
    .use(
      "/api/*",
      cors({
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
    .get("/api/health", (context) =>
      context.json({ status: "ok", agent: "zukhruf" })
    )
    .route("/api/chat", createChatRoutes(chats, listQueuedTurns))
}
