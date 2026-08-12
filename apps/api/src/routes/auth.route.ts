import type { Context, Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"
import type { User } from "better-auth"

import type { AppEnv } from "../app.js"

interface AuthSession {
  user: Pick<User, "id" | "name">
}

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
