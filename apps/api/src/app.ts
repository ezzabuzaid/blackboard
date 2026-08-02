import { Hono } from "hono"
import { cors } from "hono/cors"

import { createChatRoutes, type OpenArtifact } from "./chat/routes.js"
import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"

const configuredOrigin = process.env.WEB_ORIGIN

export interface AppDependencies {
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >
  openArtifact: OpenArtifact
}

export function createApp({ runtime, openArtifact }: AppDependencies) {
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
    .get("/api/health", (context) => context.json({ status: "ok" }))
    .route("/api/chat", createChatRoutes(runtime, openArtifact))
}
