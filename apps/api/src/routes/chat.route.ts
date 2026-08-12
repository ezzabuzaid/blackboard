import {
  ZUKHRUF_SESSION_STREAM_ROUTE_PATH,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"
import { getMimeType } from "hono/utils/mime"
import { validate } from "@sdk-it/hono/runtime"
import { z } from "zod"

import type { AppEnv } from "../app.js"
import { conversationFrom } from "../chat/conversation.js"
import {
  WhatsAppGroupLimitError,
  WhatsAppReplyTargetError,
} from "../group/whatsapp.js"
import type { TranscriptionAudio } from "../transcription.js"

export type OpenArtifact = (
  conversation: ConversationId,
  path: string
) => Promise<{ body: Uint8Array<ArrayBuffer>; size: number } | null>

const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const audioFormats = new Map<string, TranscriptionAudio["format"]>([
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
])

export default function (router: Hono<AppEnv>) {
  router.use("/chat/*", async (context, next) => {
    const session = await context.var.dependencies.auth.getSession(
      context.req.raw.headers
    )
    if (!session) return context.json({ error: "Unauthorized." }, 401)

    context.set("userId", session.user.id)
    await next()
  })

  router.use("/chat/:chatId/*", async (context, next) => {
    const chatId = context.req.param("chatId")
    const group = context.var.dependencies.getGroup(
      context.get("userId"),
      chatId
    )
    if (!group) return context.json({ error: "Chat not found." }, 404)

    await next()
  })

  /**
   * @openapi getChatState
   * @tags chat
   * @description Gets the current chat state.
   */
  router.get(
    "/chat/:chatId/state",
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

      return context.json({
        ...(await context.var.dependencies.runtime.snapshot(conversation)),
        streamPath: ZUKHRUF_SESSION_STREAM_ROUTE_PATH.replace(
          ":sessionId",
          encodeURIComponent(conversation.chatId)
        ),
      })
    }
  )

  /**
   * @openapi getAgentTraces
   * @tags chat
   * @description Gets an agent's traces for a chat.
   */
  router.get(
    "/chat/:chatId/agents/:agent/traces",
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

      const traces = await context.var.dependencies.runtime.traces(
        conversation,
        context.var.input.agent
      )
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
  router.get(
    "/chat/:chatId/artifacts/:path{.+}",
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

      const artifact = await context.var.dependencies.openArtifact(
        conversation,
        path
      )
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
  router.post(
    "/chat/:chatId/stop",
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

      return context.json(
        await context.var.dependencies.runtime.stop(conversation)
      )
    }
  )

  /**
   * @openapi transcribeChatAudio
   * @tags chat
   * @description Transcribes a recorded chat message with the configured OpenRouter model.
   */
  router.post(
    "/chat/:chatId/transcription",
    bodyLimit({
      maxSize: MAX_AUDIO_BYTES,
      onError: (context) =>
        context.json({ error: "Audio recording is too large." }, 413),
    }),
    validate("multipart/form-data", (payload) => ({
      chatId: { select: payload.params.chatId, against: z.string() },
      audio: { select: payload.body.audio, against: z.instanceof(Blob) },
    })),
    async (context) => {
      const { audio } = context.var.input
      if (audio.size === 0) {
        return context.json({ error: "Audio recording is empty." }, 400)
      }

      const format = audioFormats.get(audio.type)
      if (!format) {
        return context.json({ error: "Unsupported audio format." }, 415)
      }

      try {
        const text = await context.var.dependencies.transcribeAudio({
          bytes: new Uint8Array(await audio.arrayBuffer()),
          format,
        })
        return context.json({ text })
      } catch (cause) {
        throw new HTTPException(502, {
          message: "Voice transcription failed.",
          cause,
        })
      }
    }
  )

  /**
   * @openapi postChatMessage
   * @tags chat
   * @description Posts a message to a chat.
   */
  router.post(
    "/chat/:chatId/messages",
    bodyLimit({
      maxSize: 20 * 1024,
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
      annotations: {
        select: payload.body.annotations,
        against: z
          .array(
            z.object({
              messageId: z.string(),
              excerpt: z.string(),
              comment: z.string().optional(),
            })
          )
          .optional(),
      },
    })),
    async (context) => {
      const { chatId, id, content, replyToMessageId, annotations } =
        context.var.input
      const conversation = conversationFrom(context.get("userId"), chatId)
      if (
        !conversation ||
        !id.trim() ||
        id.length > 200 ||
        (!content.trim() && !annotations?.length) ||
        content.length > 8_000 ||
        (replyToMessageId !== undefined &&
          (!replyToMessageId.trim() || replyToMessageId.length > 200)) ||
        (annotations !== undefined &&
          (annotations.length > 20 ||
            annotations.some(
              ({ messageId, excerpt, comment }) =>
                !messageId.trim() ||
                messageId.length > 200 ||
                !excerpt.trim() ||
                excerpt.length > 8_000 ||
                (comment !== undefined && comment.length > 8_000)
            )))
      ) {
        return context.json({ error: "Invalid chat message." }, 400)
      }

      try {
        const message = await context.var.dependencies.runtime.post(
          conversation,
          {
            id,
            content: content.trim(),
            ...(replyToMessageId
              ? { replyToMessageId: replyToMessageId.trim() }
              : {}),
            ...(annotations?.length
              ? {
                  annotations: annotations.map(
                    ({ messageId, excerpt, comment }) => ({
                      messageId: messageId.trim(),
                      excerpt: excerpt.trim(),
                      ...(comment?.trim() ? { comment: comment.trim() } : {}),
                    })
                  ),
                }
              : {}),
          }
        )
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
