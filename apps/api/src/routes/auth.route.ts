import type { Context, Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"

import type { AppEnv } from "../app.js"

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

export default function (router: Hono<AppEnv>) {
  /**
   * @openapi getSession
   * @tags auth
   * @description Gets the current authenticated session.
   */
  router.get(
    "/auth/get-session",
    validate(() => ({})),
    async (context) => {
      const { auth } = context.var.dependencies
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
   * @description Starts ChatGPT device authentication.
   */
  router.post(
    "/auth/chatgpt/device",
    validate(() => ({})),
    async (context) => {
      const { auth } = context.var.dependencies
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
   * @description Polls a ChatGPT device authentication attempt.
   */
  router.post(
    "/auth/chatgpt/device/poll",
    validate(() => ({})),
    async (context) => {
      const { auth } = context.var.dependencies
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
   * @description Cancels a ChatGPT device authentication attempt.
   */
  router.post(
    "/auth/chatgpt/device/cancel",
    validate(() => ({})),
    async (context) => {
      const { auth } = context.var.dependencies
      const response = await auth.cancelDevice(context.req.raw.headers)
      if (!response.ok) return response
      const result = (await response.json()) as { cancelled: boolean }
      copyAuthHeaders(context, response.headers)
      return context.json(result)
    }
  )

  router.on(["GET", "POST"], "/auth/*", (context) => {
    return context.var.dependencies.auth.handler(context.req.raw)
  })
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
