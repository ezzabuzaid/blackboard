import { Hono } from "hono"
import { cors } from "hono/cors"

import {
  createChatRoutes,
  type ListQueuedTurns,
  type OpenArtifact,
} from "./chat/routes.js"
import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"

const configuredOrigin = process.env.WEB_ORIGIN

export interface AppDependencies {
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >
  listQueuedTurns: ListQueuedTurns
  openArtifact: OpenArtifact
}

export function createApp({
  runtime,
  listQueuedTurns,
  openArtifact,
}: AppDependencies) {
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
    .route(
      "/api/chat",
      createChatRoutes(runtime, listQueuedTurns, openArtifact)
    )
}
