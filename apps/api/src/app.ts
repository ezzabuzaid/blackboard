import { Hono } from "hono"
import { cors } from "hono/cors"

import { createChatRoutes, type OpenArtifact } from "./chat/routes.js"
import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"

const configuredOrigin = process.env.WEB_ORIGIN

export interface AppDependencies {
  auth: {
    handler(request: Request): Promise<Response>
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>
  }
  runtime: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >
  openArtifact: OpenArtifact
}

export function createApp({ auth, runtime, openArtifact }: AppDependencies) {
  return new Hono<{ Variables: { userId: string } }>()
    .use(
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
    .get("/api/health", (context) => context.json({ status: "ok" }))
    .on(["GET", "POST"], "/api/auth/*", (context) =>
      auth.handler(context.req.raw)
    )
    .use("/api/chat/*", async (context, next) => {
      const session = await auth.getSession(context.req.raw.headers)
      if (!session) return context.json({ error: "Unauthorized." }, 401)

      context.set("userId", session.user.id)
      await next()
    })
    .route("/api/chat", createChatRoutes(runtime, openArtifact))
}
