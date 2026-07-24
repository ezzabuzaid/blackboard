import type { AgentRuntime } from "@deepagents/experimental/zukhruf"
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai"
import { Hono } from "hono"
import { cors } from "hono/cors"

const configuredOrigin = process.env.WEB_ORIGIN

export function createApp(runtime: Pick<AgentRuntime, "enqueue">) {
  return new Hono()
    .use(
      "/api/*",
      cors({
        origin: (origin) => {
          if (configuredOrigin) {
            return origin === configuredOrigin ? origin : null
          }

          try {
            const url = new URL(origin)
            return url.protocol === "http:" &&
              (url.hostname === "localhost" || url.hostname === "127.0.0.1")
              ? origin
              : null
          } catch {
            return null
          }
        },
      })
    )
    .get("/api/health", (context) =>
      context.json({ status: "ok", agent: "zukhruf" })
    )
    .post("/api/chat", async (context) => {
      const body = await context.req.json().catch(() => null)
      const chatId =
        body && typeof body === "object" && "id" in body ? body.id : undefined
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
        typeof chatId !== "string" ||
        !chatId.trim() ||
        chatId.length > 200 ||
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
        const turn = await runtime.enqueue(
          { chatId, userId: "local-user" },
          { id: lastMessage.id, input }
        )
        return createUIMessageStreamResponse({ stream: turn.stream })
      } catch (error) {
        console.error(error)
        return context.json({ error: "The agent could not respond." }, 502)
      }
    })
}
