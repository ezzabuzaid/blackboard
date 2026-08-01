import type { ConversationId, TurnRef } from "@deepagents/experimental/zukhruf"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { streamSSE } from "hono/streaming"
import { getMimeType } from "hono/utils/mime"

import type { WhatsAppChatRuntime } from "../group/chat-runtime.js"
import {
  WhatsAppGroupLimitError,
  WhatsAppReplyTargetError,
} from "../group/whatsapp.js"
import { conversationFrom } from "./conversation.js"

export interface QueuedTurn {
  id: string
  kind: TurnRef["kind"]
  input: string | null
}

export type ListQueuedTurns = (
  conversation: ConversationId
) => Promise<QueuedTurn[]>

export type OpenArtifact = (
  conversation: ConversationId,
  path: string
) => Promise<{ body: Uint8Array<ArrayBuffer>; size: number } | null>

export function createChatRoutes(
  chats: Pick<
    WhatsAppChatRuntime,
    "post" | "snapshot" | "stop" | "subscribe" | "traces"
  >,
  listQueuedTurns: ListQueuedTurns,
  openArtifact: OpenArtifact
) {
  return new Hono()
    .get("/:chatId/state", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json(await chats.snapshot(conversation))
    })
    .get("/:chatId/events", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      const after = eventCursor(
        context.req.header("Last-Event-ID") ?? context.req.query("after") ?? "0"
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
    })
    .get("/:chatId/turns", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json({
        turns: await listQueuedTurns(conversation),
      })
    })
    .get("/:chatId/agents/:agent/traces", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      const traces = await chats.traces(
        conversation,
        context.req.param("agent")
      )
      return traces
        ? context.json(traces)
        : context.json({ error: "Agent not found." }, 404)
    })
    .get("/:chatId/artifacts/:path{.+}", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      const path = artifactPath(context.req.param("path"))
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
    })
    .post("/:chatId/stop", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json(await chats.stop(conversation))
    })
    .post(
      "/:chatId/messages",
      bodyLimit({
        maxSize: 10 * 1024,
        onError: (context) =>
          context.json({ error: "Chat message is too large." }, 413),
      }),
      async (context) => {
        const conversation = conversationFrom(context.req.param("chatId"))
        const body = await context.req.json().catch(() => null)
        const id =
          body && typeof body === "object" && "id" in body ? body.id : null
        const content =
          body && typeof body === "object" && "content" in body
            ? body.content
            : null
        const replyToMessageId =
          body && typeof body === "object" && "replyToMessageId" in body
            ? body.replyToMessageId
            : undefined
        if (
          !conversation ||
          typeof id !== "string" ||
          !id.trim() ||
          id.length > 200 ||
          typeof content !== "string" ||
          !content.trim() ||
          content.length > 8_000 ||
          (replyToMessageId !== undefined &&
            (typeof replyToMessageId !== "string" ||
              !replyToMessageId.trim() ||
              replyToMessageId.length > 200))
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
