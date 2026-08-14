import type { Hono, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { validator } from "hono/validator"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { groupTemplates } from "../group/group-template-catalog.js"
import { MarketplaceGroupTemplateInputError } from "../group/marketplace-group-template-store.js"

const authenticate: MiddlewareHandler<AppEnv> = async (context, next) => {
  const session = await context.var.dependencies.auth.getSession(
    context.req.raw.headers
  )
  if (!session) return context.json({ error: "Unauthorized." }, 401)

  context.set("userId", session.user.id)
  context.set("publisherName", session.user.name)
  await next()
}

export default function (router: Hono<AppEnv>) {
  /**
   * @openapi listGroupTemplates
   * @tags group-templates
   * @description Lists prebuilt and published marketplace group templates.
   */
  router.get(
    "/group-templates",
    validate(() => ({})),
    async (context) => {
      const session = await context.var.dependencies.auth.getSession(
        context.req.raw.headers
      )
      const agentNames = new Map(
        context.var.dependencies.agents.map(({ id, name }) => [id, name])
      )
      const templates = [
        ...groupTemplates.map((template) => ({
          ...template,
          source: "prebuilt" as const,
        })),
        ...context.var.dependencies.marketplaceTemplates
          .published()
          .map(
            ({
              id,
              sourceGroupId,
              publisherName,
              name,
              category,
              outcome,
              agents,
            }) => ({
              id,
              publisherName,
              name,
              category,
              outcome,
              agents,
              owned:
                session !== null &&
                context.var.dependencies.marketplaceTemplates.owns(
                  session.user.id,
                  id
                ),
              detached: sourceGroupId === null,
              source: "marketplace" as const,
            })
          ),
      ]

      return context.json({
        templates: templates.map(({ agents, ...template }) => ({
          ...template,
          agents: agents.map(({ agentId: id, responsibility }) => ({
            id,
            name: agentNames.get(id)!,
            responsibility,
          })),
        })),
      })
    }
  )

  /**
   * @openapi getGroupMarketplaceTemplate
   * @tags group-templates
   * @description Gets the marketplace template editor for one owned group.
   */
  router.get(
    "/groups/:groupId/marketplace-template",
    authenticate,
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const group = context.var.dependencies.getGroup(
        userId,
        context.var.input.groupId
      )
      if (!group) return context.json({ error: "Group not found." }, 404)

      const template =
        context.var.dependencies.marketplaceTemplates.findBySourceGroup(
          userId,
          group.id
        )
      const responsibilities = new Map(
        template?.agents.map(({ agentId, responsibility }) => [
          agentId,
          responsibility,
        ])
      )

      return context.json({
        template,
        group: { id: group.id, name: group.name },
        agents: group.agentIds.map((id) => {
          const agent = context.var.dependencies.agents.find(
            (candidate) => candidate.id === id
          )!
          return {
            id,
            name: agent.name,
            headline: agent.headline,
            responsibility: responsibilities.get(id) ?? agent.headline,
          }
        }),
      })
    }
  )

  /**
   * @openapi saveGroupMarketplaceTemplate
   * @tags group-templates
   * @description Creates or updates the marketplace template for one owned group.
   */
  router.put(
    "/groups/:groupId/marketplace-template",
    authenticate,
    bodyLimit({
      maxSize: 10 * 1024,
      onError: (context) =>
        context.json({ error: "Group template request is too large." }, 413),
    }),
    validator("json", (body) => body),
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
      category: { select: payload.body.category, against: z.string() },
      outcome: { select: payload.body.outcome, against: z.string() },
      agents: {
        select: payload.body.agents,
        against: z.array(
          z.object({ agentId: z.string(), responsibility: z.string() })
        ),
      },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId, category, outcome, agents } = context.var.input
      const group = context.var.dependencies.getGroup(userId, groupId)
      if (!group) return context.json({ error: "Group not found." }, 404)

      const selected = new Set(agents.map(({ agentId }) => agentId))
      if (
        selected.size !== agents.length ||
        agents.length !== group.agentIds.length ||
        group.agentIds.some((id) => !selected.has(id))
      ) {
        return context.json(
          { error: "Template agents must match the group roster." },
          400
        )
      }

      const definition = { name: group.name, category, outcome, agents }
      try {
        const existing =
          context.var.dependencies.marketplaceTemplates.findBySourceGroup(
            userId,
            group.id
          )
        if (existing) {
          return context.json(
            context.var.dependencies.marketplaceTemplates.update(
              userId,
              existing.id,
              definition
            )!
          )
        }
        return context.json(
          context.var.dependencies.marketplaceTemplates.create(
            userId,
            context.get("publisherName"),
            definition,
            group.id
          ),
          201
        )
      } catch (error) {
        if (error instanceof MarketplaceGroupTemplateInputError) {
          return context.json({ error: error.message }, 400)
        }
        throw error
      }
    }
  )

  /**
   * @openapi createMarketplaceGroupTemplate
   * @tags group-templates
   * @description Creates a private marketplace group template draft.
   */
  router.post(
    "/group-templates",
    authenticate,
    bodyLimit({
      maxSize: 10 * 1024,
      onError: (context) =>
        context.json({ error: "Group template request is too large." }, 413),
    }),
    validator("json", (body) => body),
    validate((payload) => ({
      name: { select: payload.body.name, against: z.string() },
      category: { select: payload.body.category, against: z.string() },
      outcome: { select: payload.body.outcome, against: z.string() },
      agents: {
        select: payload.body.agents,
        against: z.array(
          z.object({ agentId: z.string(), responsibility: z.string() })
        ),
      },
    })),
    (context) => {
      try {
        return context.json(
          context.var.dependencies.marketplaceTemplates.create(
            context.get("userId"),
            context.get("publisherName"),
            context.var.input
          ),
          201
        )
      } catch (error) {
        if (error instanceof MarketplaceGroupTemplateInputError) {
          return context.json({ error: error.message }, 400)
        }
        throw error
      }
    }
  )

  /**
   * @openapi updateMarketplaceGroupTemplate
   * @tags group-templates
   * @description Replaces a marketplace group template owned by the publisher.
   */
  router.put(
    "/group-templates/:templateId",
    authenticate,
    bodyLimit({
      maxSize: 10 * 1024,
      onError: (context) =>
        context.json({ error: "Group template request is too large." }, 413),
    }),
    validator("json", (body) => body),
    validate((payload) => ({
      templateId: {
        select: payload.params.templateId,
        against: z.string(),
      },
      name: { select: payload.body.name, against: z.string() },
      category: { select: payload.body.category, against: z.string() },
      outcome: { select: payload.body.outcome, against: z.string() },
      agents: {
        select: payload.body.agents,
        against: z.array(
          z.object({ agentId: z.string(), responsibility: z.string() })
        ),
      },
    })),
    (context) => {
      try {
        const { templateId, ...input } = context.var.input
        const template = context.var.dependencies.marketplaceTemplates.update(
          context.get("userId"),
          templateId,
          input
        )
        if (!template) {
          return context.json({ error: "Group template not found." }, 404)
        }
        return context.json(template)
      } catch (error) {
        if (error instanceof MarketplaceGroupTemplateInputError) {
          return context.json({ error: error.message }, 400)
        }
        throw error
      }
    }
  )

  /**
   * @openapi deleteMarketplaceGroupTemplate
   * @tags group-templates
   * @description Permanently withdraws a detached marketplace template owned by the publisher.
   */
  router.delete(
    "/group-templates/:templateId",
    authenticate,
    validate((payload) => ({
      templateId: {
        select: payload.params.templateId,
        against: z.string(),
      },
    })),
    (context) => {
      const deleted = context.var.dependencies.marketplaceTemplates.delete(
        context.get("userId"),
        context.var.input.templateId
      )
      return deleted
        ? context.json({ deleted: true })
        : context.json({ error: "Group template not found." }, 404)
    }
  )

  /**
   * @openapi publishMarketplaceGroupTemplate
   * @tags group-templates
   * @description Publishes a marketplace group template owned by the publisher.
   */
  router.post(
    "/group-templates/:templateId/publish",
    authenticate,
    validate((payload) => ({
      templateId: {
        select: payload.params.templateId,
        against: z.string(),
      },
    })),
    (context) => {
      const template = context.var.dependencies.marketplaceTemplates.publish(
        context.get("userId"),
        context.var.input.templateId
      )
      if (!template) {
        return context.json({ error: "Group template not found." }, 404)
      }
      return context.json(template)
    }
  )

  /**
   * @openapi unpublishMarketplaceGroupTemplate
   * @tags group-templates
   * @description Withdraws a marketplace group template owned by the publisher.
   */
  router.post(
    "/group-templates/:templateId/unpublish",
    authenticate,
    validate((payload) => ({
      templateId: {
        select: payload.params.templateId,
        against: z.string(),
      },
    })),
    (context) => {
      const template = context.var.dependencies.marketplaceTemplates.unpublish(
        context.get("userId"),
        context.var.input.templateId
      )
      if (!template) {
        return context.json({ error: "Group template not found." }, 404)
      }
      return context.json(template)
    }
  )
}
