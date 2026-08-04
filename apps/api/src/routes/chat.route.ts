import type { ConversationId } from "@deepagents/experimental/zukhruf"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { streamSSE } from "hono/streaming"
import { getMimeType } from "hono/utils/mime"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { WhatsAppChatRuntime } from "../group/chat-runtime.js"
import {
  WhatsAppGroupLimitError,
  WhatsAppReplyTargetError,
} from "../group/whatsapp.js"
import { conversationFrom } from "../chat/conversation.js"
import type { AuthRoutes } from "./auth.route.js"

export type OpenArtifact = (
  conversation: ConversationId,
  path: string
) => Promise<{ body: Uint8Array<ArrayBuffer>; size: number } | null>

export function createChatRoutes(
  app: Hono<{ Variables: { userId: string } }>,
  auth: Pick<AuthRoutes, "getSession">,
  chats: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >,
  openArtifact: OpenArtifact
) {
  app.use("/api/chat/*", async (context, next) => {
    const session = await auth.getSession(context.req.raw.headers)
    if (!session) return context.json({ error: "Unauthorized." }, 401)

    context.set("userId", session.user.id)
    await next()
  })

  /**
   * @openapi getChatState
   * @tags chat
   * @description Gets the current chat state.
   */
  app.get(
    "/api/chat/:chatId/state",
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
    })),
    async (context) => {
      const conversation = conversationFrom(
        context.get("userId"),
        context.var.input.chatId
      )
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json(await chats.snapshot(conversation))
    }
  )

  /**
   * @openapi getChatEvents
   * @tags chat
   * @description Streams chat events after a cursor.
   */
  app.get(
    "/api/chat/:chatId/events",
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
      after: { select: payload.query.after, against: z.string().optional() },
    })),
    async (context) => {
      const conversation = conversationFrom(
        context.get("userId"),
        context.var.input.chatId
      )
      const after = eventCursor(
        context.req.header("Last-Event-ID") ?? context.var.input.after ?? "0"
      )
      if (!conversation || after === null) {
        return context.json({ error: "Invalid chat event cursor." }, 400)
      }

      return streamSSE(context, async (output) => {
        using subscription = await chats.subscribe(
          conversation,
          after,
          (event) =>
            output
              .writeSSE({
                event: event.type,
                id: String(event.cursor),
                data: JSON.stringify(event),
              })
              .catch(() => undefined)
        )
        await new Promise<void>((resolve) => output.onAbort(resolve))
      })
    }
  )

  /**
   * @openapi getAgentTraces
   * @tags chat
   * @description Gets an agent's traces for a chat.
   */
  app.get(
    "/api/chat/:chatId/agents/:agent/traces",
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
      agent: { select: payload.params.agent, against: z.string() },
    })),
    async (context) => {
      const conversation = conversationFrom(
        context.get("userId"),
        context.var.input.chatId
      )
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      const traces = await chats.traces(conversation, context.var.input.agent)
      if (!traces) {
        return context.json({ error: "Agent not found." }, 404)
      }
      return context.json(traces)
    }
  )

  /**
   * @openapi getArtifact
   * @tags chat
   * @description Gets a generated chat artifact.
   */
  app.get(
    "/api/chat/:chatId/artifacts/:path{.+}",
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
      path: { select: payload.params.path, against: z.string() },
    })),
    async (context) => {
      const conversation = conversationFrom(
        context.get("userId"),
        context.var.input.chatId
      )
      const path = artifactPath(context.var.input.path)
      if (!conversation || !path) {
        return context.json({ error: "Invalid artifact path." }, 400)
      }

      const artifact = await openArtifact(conversation, path)
      if (!artifact) {
        return context.json({ error: "Artifact not found." }, 404)
      }

      context.header(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1)!)}`
      )
      context.header(
        "Content-Type",
        getMimeType(path) ?? "application/octet-stream"
      )
      context.header("Content-Length", String(artifact.size))
      context.header("X-Content-Type-Options", "nosniff")

      return context.body(artifact.body)
    }
  )

  /**
   * @openapi stopChat
   * @tags chat
   * @description Stops active work in a chat.
   */
  app.post(
    "/api/chat/:chatId/stop",
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
    })),
    async (context) => {
      const conversation = conversationFrom(
        context.get("userId"),
        context.var.input.chatId
      )
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json(await chats.stop(conversation))
    }
  )

  /**
   * @openapi postChatMessage
   * @tags chat
   * @description Posts a message to a chat.
   */
  app.post(
    "/api/chat/:chatId/messages",
    bodyLimit({
      maxSize: 10 * 1024,
      onError: (context) =>
        context.json({ error: "Chat message is too large." }, 413),
    }),
    async (context, next) => {
      const body = await context.req.json().catch(() => null)
      if (!body || typeof body !== "object") {
        return context.json({ error: "Invalid chat message." }, 400)
      }
      await next()
    },
    validate((payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
      id: { select: payload.body.id, against: z.string() },
      content: { select: payload.body.content, against: z.string() },
      replyToMessageId: {
        select: payload.body.replyToMessageId,
        against: z.string().optional(),
      },
    })),
    async (context) => {
      const { chatId, id, content, replyToMessageId } = context.var.input
      const conversation = conversationFrom(context.get("userId"), chatId)
      if (
        !conversation ||
        !id.trim() ||
        id.length > 200 ||
        !content.trim() ||
        content.length > 8_000 ||
        (replyToMessageId !== undefined &&
          (!replyToMessageId.trim() || replyToMessageId.length > 200))
      ) {
        return context.json({ error: "Invalid chat message." }, 400)
      }

      try {
        const message = await chats.post(conversation, {
          id,
          content: content.trim(),
          ...(replyToMessageId
            ? { replyToMessageId: replyToMessageId.trim() }
            : {}),
        })
        return context.json({ message }, 201)
      } catch (error) {
        if (error instanceof WhatsAppGroupLimitError) {
          return context.json({ error: error.message }, 409)
        }
        if (error instanceof WhatsAppReplyTargetError) {
          return context.json({ error: error.message }, 400)
        }
        throw error
      }
    }
  )

  return app
}

function eventCursor(value: string) {
  const cursor = Number(value)
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null
}

function artifactPath(path: string | undefined) {
  if (
    !path ||
    path.length > 1_024 ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return null
  }

  const segments = path.split("/")
  return segments.some(
    (segment) => !segment || segment === "." || segment === ".."
  )
    ? null
    : path
}
