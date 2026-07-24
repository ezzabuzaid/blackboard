import type {
  ConversationId,
  TurnRef,
} from "@deepagents/experimental/zukhruf"
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai"
import { Hono } from "hono"

import { ChatService } from "./chat-service.js"
import { conversationFrom } from "./conversation.js"

export interface QueuedTurn {
  id: string
  kind: TurnRef["kind"]
  input: string | null
}

export type ListQueuedTurns = (
  conversation: ConversationId
) => Promise<QueuedTurn[]>

export function createChatRoutes(
  chats: ChatService,
  listQueuedTurns: ListQueuedTurns
) {
  return new Hono()
    .get("/:chatId/state", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      return context.json(await chats.snapshot(conversation))
    })
    .get("/:chatId/stream", async (context) => {
      const conversation = conversationFrom(context.req.param("chatId"))
      if (!conversation) {
        return context.json({ error: "Invalid chat id." }, 400)
      }

      const stream = await chats.resume(conversation)
      return stream
        ? createUIMessageStreamResponse({ stream })
        : context.body(null, 204)
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
    .post("/", async (context) => {
      const body = await context.req.json().catch(() => null)
      const conversation =
        body && typeof body === "object" && "id" in body
          ? conversationFrom(body.id)
          : null
      const messages =
        body && typeof body === "object" && "messages" in body
          ? await safeValidateUIMessages<UIMessage>({
              messages: body.messages,
            })
          : null
      const lastMessage = messages?.success ? messages.data.at(-1) : undefined
      const input =
        lastMessage?.role === "user"
          ? lastMessage.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
              .trim()
          : ""

      if (
        !conversation ||
        !messages?.success ||
        messages.data.length === 0 ||
        messages.data.length > 50 ||
        !lastMessage ||
        lastMessage.role !== "user" ||
        !lastMessage.id.trim() ||
        lastMessage.id.length > 200 ||
        !input ||
        input.length > 8_000
      ) {
        return context.json(
          {
            error:
              messages && !messages.success
                ? messages.error.message
                : "Invalid chat request.",
          },
          400
        )
      }

      try {
        const turn = await chats.enqueue(conversation, {
          id: lastMessage.id,
          input,
        })
        return createUIMessageStreamResponse({ stream: turn.stream })
      } catch (error) {
        console.error(error)
        return context.json({ error: "The agent could not respond." }, 502)
      }
    })
}
