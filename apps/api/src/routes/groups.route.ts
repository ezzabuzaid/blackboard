import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { GroupInputError } from "../group/group-store.js"

export default function (router: Hono<AppEnv>) {
  router.use("/groups", async (context, next) => {
    const { auth } = context.var.dependencies
    const session = await auth.getSession(context.req.raw.headers)
    if (!session) return context.json({ error: "Unauthorized." }, 401)

    context.set("userId", session.user.id)
    await next()
  })

  /**
   * @openapi createGroup
   * @tags groups
   * @description Creates a group with a selected agent roster.
   */
  router.post(
    "/groups",
    bodyLimit({
      maxSize: 10 * 1024,
      onError: (context) =>
        context.json({ error: "Group request is too large." }, 413),
    }),
    async (context, next) => {
      const body = await context.req.json().catch(() => null)
      if (!body || typeof body !== "object") {
        return context.json({ error: "Invalid group." }, 400)
      }
      await next()
    },
    validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
      agentIds: {
        select: payload.body.agentIds,
        against: z.array(z.string()),
      },
    })),
    (context) => {
      try {
        return context.json(
          context.var.dependencies.createGroup(
            context.get("userId"),
            context.var.input
          ),
          201
        )
      } catch (error) {
        if (error instanceof GroupInputError) {
          return context.json({ error: error.message }, 400)
        }
        throw error
      }
    }
  )
}
