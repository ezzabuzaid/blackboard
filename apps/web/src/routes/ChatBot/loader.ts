import { redirect, type LoaderFunctionArgs } from "react-router"

import { apiUrl } from "./api"
import { initialGroupActivity } from "./groupActivity"
import { isGroupRoomState } from "./groupMessages"

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
    if (!isGroupRoomState(state)) {
      throw new Error("Invalid chat state")
    }

    return {
      apiStatus: "ready" as const,
      chatId,
      initialState: state,
    }
  } catch (error) {
    if (request.signal.aborted) throw error
    return {
      apiStatus: "offline" as const,
      chatId,
      initialState: {
        messages: [],
        participants: [],
        activity: initialGroupActivity,
        cursor: 0,
      },
    }
  }
}
