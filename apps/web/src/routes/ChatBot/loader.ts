import { safeValidateUIMessages } from "ai"
import { redirect, type LoaderFunctionArgs } from "react-router"

import { apiUrl } from "./chatTransport"
import type { GroupUIMessage } from "./groupMessages"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const chatId = url.searchParams.get("chatId")
  if (!chatId) {
    url.searchParams.set("chatId", crypto.randomUUID())
    throw redirect(`${url.pathname}${url.search}`)
  }

  try {
    const [healthResponse, stateResponse] = await Promise.all([
      fetch(`${apiUrl}/api/health`, { signal: request.signal }),
      fetch(`${apiUrl}/api/chat/${encodeURIComponent(chatId)}/state`, {
        signal: request.signal,
      }),
    ])
    if (!healthResponse.ok || !stateResponse.ok) {
      throw new Error("Chat API is unavailable")
    }

    const state: unknown = await stateResponse.json()
    if (
      !state ||
      typeof state !== "object" ||
      !("messages" in state) ||
      !Array.isArray(state.messages) ||
      !("resume" in state) ||
      typeof state.resume !== "boolean"
    ) {
      throw new Error("Invalid chat state")
    }

    const messages =
      state.messages.length === 0
        ? { success: true as const, data: [] }
        : await safeValidateUIMessages<GroupUIMessage>({
            messages: state.messages,
          })
    if (!messages.success) {
      throw messages.error
    }

    return {
      apiStatus: "ready" as const,
      chatId,
      initialMessages: messages.data,
      resume: state.resume,
    }
  } catch (error) {
    if (request.signal.aborted) throw error
    return {
      apiStatus: "offline" as const,
      chatId,
      initialMessages: [],
      resume: false,
    }
  }
}
