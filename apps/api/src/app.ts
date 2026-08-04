import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { validate } from "@sdk-it/hono/runtime"

import { createChatRoutes, type OpenArtifact } from "./chat/routes.js"
import type { WhatsAppChatRuntime } from "./group/chat-runtime.js"

const configuredOrigin = process.env.WEB_ORIGIN

interface AuthSession {
  user: { id: string }
}

interface DeviceLogin {
  verificationUrl: string
  userCode: string
  interval: number
  expiresAt: number
}

type DevicePoll =
  | { status: "pending" | "expired" }
  | { status: "complete"; user: { id: string } }

export interface AppDependencies {
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

export function createApp({ auth, runtime, openArtifact }: AppDependencies) {
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

  /** @openapi getHealth */
  app.get(
    "/api/health",
    validate(() => ({})),
    (context) => {
      return context.json({ status: "ok" })
    }
  )

  /**
   * @openapi getSession
   * @tags auth
   */
  app.get(
    "/api/auth/get-session",
    validate(() => ({})),
    async (context) => {
      const response = await auth.getSessionResponse(context.req.raw)
      if (!response.ok) return response
      const session = (await response.json()) as AuthSession | null
      copyAuthHeaders(context, response.headers)
      return context.json(session)
    }
  )

  /**
   * @openapi startChatGPTDevice
   * @tags auth
   */
  app.post(
    "/api/auth/chatgpt/device",
    validate(() => ({})),
    async (context) => {
      const response = await auth.startDevice(context.req.raw.headers)
      if (!response.ok) return response
      const device = (await response.json()) as DeviceLogin
      copyAuthHeaders(context, response.headers)
      return context.json(device)
    }
  )

  /**
   * @openapi pollChatGPTDevice
   * @tags auth
   */
  app.post(
    "/api/auth/chatgpt/device/poll",
    validate(() => ({})),
    async (context) => {
      const response = await auth.pollDevice(context.req.raw.headers)
      if (!response.ok) return response
      const result = (await response.json()) as DevicePoll
      copyAuthHeaders(context, response.headers)
      return context.json(result)
    }
  )

  /**
   * @openapi cancelChatGPTDevice
   * @tags auth
   */
  app.post(
    "/api/auth/chatgpt/device/cancel",
    validate(() => ({})),
    async (context) => {
      const response = await auth.cancelDevice(context.req.raw.headers)
      if (!response.ok) return response
      const result = (await response.json()) as { cancelled: boolean }
      copyAuthHeaders(context, response.headers)
      return context.json(result)
    }
  )

  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    auth.handler(context.req.raw)
  )
  app.use("/api/chat/*", async (context, next) => {
    const session = await auth.getSession(context.req.raw.headers)
    if (!session) return context.json({ error: "Unauthorized." }, 401)

    context.set("userId", session.user.id)
    await next()
  })

  return createChatRoutes(app, runtime, openArtifact)
}

function copyAuthHeaders(context: Context, headers: Headers) {
  for (const cookie of headers.getSetCookie()) {
    context.header("Set-Cookie", cookie, { append: true })
  }
  for (const [name, value] of headers) {
    if (
      name.toLowerCase() !== "set-cookie" &&
      name.toLowerCase() !== "content-type" &&
      name.toLowerCase() !== "content-length"
    ) {
      context.header(name, value)
    }
  }
}
