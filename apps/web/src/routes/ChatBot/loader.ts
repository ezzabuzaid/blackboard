import { redirect, type LoaderFunctionArgs } from "react-router"

import { requireIdentity } from "../../auth"
import { api } from "./api"
import { initialGroupActivity } from "./groupActivity"
import { isGroupChatState } from "./groupMessages"

export interface GroupSummary {
  id: string
  name: string
  agentIds: readonly string[]
  createdAt: string
  lastMessage: {
    author: string
    content: string
    sentAt: string
  } | null
  unreadCount: number
  pinned: boolean
}

export async function loader(args: LoaderFunctionArgs) {
  await requireIdentity(args)

  const { request } = args
  const url = new URL(request.url)
  const groups = await loadGroups(request.signal)
  const chatId = url.searchParams.get("chatId")
  if (!chatId) {
    const firstGroup = groups.at(0)
    if (!firstGroup) throw redirect("/groups/new")
    url.searchParams.set("chatId", firstGroup.id)
    throw redirect(`${url.pathname}${url.search}`)
  }

  try {
    const [, state] = await Promise.all([
      api.request("GET /health", {}, { signal: request.signal }),
      api.request(
        "GET /chat/{chatId}/state",
        { chatId },
        { signal: request.signal }
      ),
    ])
    if (
      !isGroupChatState(state) ||
      !isRecord(state) ||
      typeof state.streamPath !== "string"
    ) {
      throw new Error("Invalid chat state")
    }
    const { streamPath, ...initialState } = state

    return {
      apiStatus: "ready" as const,
      chatId,
      groups,
      initialState,
      streamPath,
    }
  } catch (error) {
    if (error instanceof Response) throw error
    if (request.signal.aborted) throw error
    return {
      apiStatus: "offline" as const,
      chatId,
      groups,
      streamPath: null,
      initialState: {
        messages: [],
        participants: [],
        activity: initialGroupActivity,
        cursor: 0,
      },
    }
  }
}

async function loadGroups(signal: AbortSignal) {
  const response: unknown = await api.request("GET /groups", {}, { signal })
  if (
    !isRecord(response) ||
    !Array.isArray(response.groups) ||
    !response.groups.every(isGroupSummary)
  ) {
    throw new Error("Invalid group list")
  }
  return response.groups
}

function isGroupSummary(value: unknown): value is GroupSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    Array.isArray(value.agentIds) &&
    value.agentIds.every((id) => typeof id === "string") &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    (value.lastMessage === null ||
      (isRecord(value.lastMessage) &&
        typeof value.lastMessage.author === "string" &&
        typeof value.lastMessage.content === "string" &&
        typeof value.lastMessage.sentAt === "string" &&
        !Number.isNaN(Date.parse(value.lastMessage.sentAt)))) &&
    Number.isSafeInteger(value.unreadCount) &&
    Number(value.unreadCount) >= 0 &&
    typeof value.pinned === "boolean"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
