import type { Hono, MiddlewareHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { GroupInputError } from "../group/group-store.js"
import { groupTemplates } from "../group/group-template-catalog.js"

const authenticate: MiddlewareHandler<AppEnv> = async (context, next) => {
  const session = await context.var.dependencies.auth.getSession(
    context.req.raw.headers
  )
  if (!session) return context.json({ error: "Unauthorized." }, 401)

  context.set("userId", session.user.id)
  await next()
}


export default function (router: Hono<AppEnv>) {
  router.use("/groups", authenticate)
  router.use("/groups/*", authenticate)

  /**
   * @openapi listGroups
   * @tags groups
   * @description Lists the authenticated user's groups, newest first.
   */
  router.get(
    "/groups",
    validate(() => ({})),
    (context) => {
      const groups = context.var.dependencies
        .listGroups(context.get("userId"))
        .map(
          ({
            id,
            name,
            agentIds,
            createdAt,
            lastMessage,
            unreadCount,
            pinned,
          }) => ({
            id,
            name,
            agentIds,
            createdAt,
            lastMessage,
            unreadCount,
            pinned,
          })
        )
      return context.json({ groups })
    }
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
      templateId: {
        select: payload.body.templateId,
        against: z.string().optional(),
      },
      name: { select: payload.body.name, against: z.string().optional() },
      agentIds: {
        select: payload.body.agentIds,
        against: z.array(z.string()).min(1).max(8).optional(),
      },
    })),
    (context) => {
      const { templateId, name, agentIds } = context.var.input
      if (!templateId) {
        if (name === undefined || agentIds === undefined) {
          return context.json({ error: "Invalid custom group." }, 400)
        }

        try {
          return context.json(
            context.var.dependencies.createGroup(context.get("userId"), {
              name,
              agentIds,
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
      if (name !== undefined || agentIds !== undefined) {
        return context.json({ error: "Invalid group." }, 400)
      }

      const template =
        templateId === "scratch"
          ? { name: "Character Workshop", agents: [] }
          : (groupTemplates.find(({ id }) => id === templateId) ??
            context.var.dependencies.marketplaceTemplates.findPublished(
              templateId
            ))
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

  /**
   * @openapi deleteGroup
   * @tags groups
   * @description Permanently deletes a group and its group-owned data.
   */
  router.delete(
    "/groups/:groupId",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    async (context) => {
      const deleted = await context.var.dependencies.deleteGroup(
        context.get("userId"),
        context.var.input.groupId
      )
      return deleted
        ? context.json({ deleted: true })
        : context.json({ error: "Group not found." }, 404)
    }
  )

  /**
   * @openapi getGroupShare
   * @tags groups
   * @description Gets the active share link for the authenticated user's group.
   */
  router.get(
    "/groups/:groupId/share",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      return context.json({
        share: context.var.dependencies.shares.active(userId, groupId),
      })
    }
  )

  /**
   * @openapi createGroupShare
   * @tags groups
   * @description Creates a share link, replacing any existing one.
   */
  router.post(
    "/groups/:groupId/share",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      return context.json(
        context.var.dependencies.shares.create(userId, groupId),
        201
      )
    }
  )

  /**
   * @openapi revokeGroupShare
   * @tags groups
   * @description Revokes the active share link for a group.
   */
  router.delete(
    "/groups/:groupId/share",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      context.var.dependencies.shares.revoke(userId, groupId)
      return context.json({ revoked: true })
    }
  )

  /**
   * @openapi pinGroup
   * @tags groups
   * @description Pins a group to the top of the list.
   */
  router.post(
    "/groups/:groupId/pin",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      context.var.dependencies.setGroupPinned(userId, groupId, true)
      return context.json({ pinned: true })
    }
  )

  /**
   * @openapi unpinGroup
   * @tags groups
   * @description Removes a group's pin.
   */
  router.delete(
    "/groups/:groupId/pin",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      context.var.dependencies.setGroupPinned(userId, groupId, false)
      return context.json({ pinned: false })
    }
  )

  /**
   * @openapi archiveGroup
   * @tags groups
   * @description Archives a group, hiding it from the group list.
   */
  router.post(
    "/groups/:groupId/archive",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      context.var.dependencies.setGroupArchived(userId, groupId, true)
      return context.json({ archived: true })
    }
  )

  /**
   * @openapi unarchiveGroup
   * @tags groups
   * @description Restores an archived group to the group list.
   */
  router.delete(
    "/groups/:groupId/archive",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      context.var.dependencies.setGroupArchived(userId, groupId, false)
      return context.json({ archived: false })
    }
  )

  /**
   * @openapi clearGroupChat
   * @tags groups
   * @description Permanently deletes a group's messages, agent memory, and files.
   */
  router.post(
    "/groups/:groupId/clear",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    async (context) => {
      const userId = context.get("userId")
      const { groupId } = context.var.input
      if (!context.var.dependencies.getGroup(userId, groupId)) {
        return context.json({ error: "Group not found." }, 404)
      }

      await context.var.dependencies.clearGroupChat(userId, groupId)
      return context.json({ cleared: true })
    }
  )

  /**
   * @openapi markGroupRead
   * @tags groups
   * @description Marks the authenticated user's group as read.
   */
  router.post(
    "/groups/:groupId/read",
    validate((payload) => ({
      groupId: { select: payload.params.groupId, against: z.string() },
    })),
    (context) => {
      const read = context.var.dependencies.markGroupRead(
        context.get("userId"),
        context.var.input.groupId
      )
      return read
        ? context.json({ read: true })
        : context.json({ error: "Group not found." }, 404)
    }
  )
}
