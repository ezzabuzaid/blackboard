import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import { GroupInputError, type GroupRecord } from "../group/group-store.js"
import type { AuthRoutes } from "./auth.route.js"

export type CreateGroup = (
  userId: string,
  input: { name: string; agentIds: readonly string[] }
) => GroupRecord

export function createGroupsRoute(
  app: Hono<{ Variables: { userId: string } }>,
  auth: Pick<AuthRoutes, "getSession">,
  createGroup: CreateGroup
) {
  app.use("/api/groups", async (context, next) => {
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
  app.post(
    "/api/groups",
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
          createGroup(context.get("userId"), context.var.input),
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
