import type { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { GroupInputError } from "../group/group-store.js"
import { groupTemplates } from "../group/group-template-catalog.js"

export default function (router: Hono<AppEnv>) {
  router.use("/groups", async (context, next) => {
    const { auth } = context.var.dependencies
    const session = await auth.getSession(context.req.raw.headers)
    if (!session) return context.json({ error: "Unauthorized." }, 401)

    context.set("userId", session.user.id)
    await next()
  })

  /**
   * @openapi listGroups
   * @tags groups
   * @description Lists the authenticated user's groups, newest first.
   */
  router.get(
    "/groups",
    validate(() => ({})),
    (context) =>
      context.json({
        groups: context.var.dependencies.listGroups(context.get("userId")),
      })
  )

  /**
   * @openapi createGroup
   * @tags groups
   * @description Creates a normal group from a curated template.
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
      templateId: { select: payload.body.templateId, against: z.string() },
    })),
    (context) => {
      const template =
        groupTemplates.find(({ id }) => id === context.var.input.templateId) ??
        context.var.dependencies.marketplaceTemplates.findPublished(
          context.var.input.templateId
        )
      if (!template) {
        return context.json({ error: "Unknown group template." }, 400)
      }

      try {
        return context.json(
          context.var.dependencies.createGroup(context.get("userId"), {
            name: template.name,
            agentIds: template.agents.map(({ agentId }) => agentId),
          }),
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
