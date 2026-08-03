import { redirect, type LoaderFunctionArgs } from "react-router"

import { requireIdentity } from "../../auth"
import { api } from "./api"
import { initialGroupActivity } from "./groupActivity"
import { isGroupChatState } from "./groupMessages"

export async function loader(args: LoaderFunctionArgs) {
  await requireIdentity(args)

  const { request } = args
  const url = new URL(request.url)
  const chatId = url.searchParams.get("chatId")
  if (!chatId) {
    url.searchParams.set("chatId", crypto.randomUUID())
    throw redirect(`${url.pathname}${url.search}`)
  }

  try {
    const [, state] = await Promise.all([
      api.request("GET /api/health", {}, { signal: request.signal }),
      api.request(
        "GET /api/chat/{chatId}/state",
        { chatId },
        { signal: request.signal }
      ),
    ])
    if (!isGroupChatState(state)) {
      throw new Error("Invalid chat state")
    }

    return {
      apiStatus: "ready" as const,
      chatId,
      initialState: state,
    }
  } catch (error) {
    if (error instanceof Response) throw error
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
