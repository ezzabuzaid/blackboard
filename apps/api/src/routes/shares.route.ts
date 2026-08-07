import type { Hono } from "hono"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { conversationFrom } from "../chat/conversation.js"

export default function (router: Hono<AppEnv>) {
  /**
   * @openapi getSharedGroup
   * @tags shares
   * @description Reads a shared group conversation without authentication.
   */
  router.get(
    "/shares/:token",
    validate((payload) => ({
      token: { select: payload.params.token, against: z.string() },
    })),
    async (context) => {
      const share = context.var.dependencies.shares.resolve(
        context.var.input.token
      )
      if (!share) {
        return context.json({ error: "Share not found." }, 404)
      }

      const group = context.var.dependencies.getGroup(
        share.userId,
        share.groupId
      )
      const conversation = conversationFrom(share.userId, share.groupId)
      if (!group || !conversation) {
        return context.json({ error: "Share not found." }, 404)
      }

      const { messages, participants } =
        await context.var.dependencies.runtime.transcript(conversation)
      return context.json({ name: group.name, participants, messages })
    }
  )
}
