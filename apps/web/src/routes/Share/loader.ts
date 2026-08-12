import type { LoaderFunctionArgs } from "react-router"

import { api } from "../ChatBot/api"
import type { GroupMessage, GroupParticipant } from "../ChatBot/groupMessages"

export interface SharedGroup {
  name: string
  participants: GroupParticipant[]
  messages: GroupMessage[]
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const token = params.token
  if (!token) return { shared: null }

  try {
    const shared: unknown = await api.request(
      "GET /shares/{token}",
      { token },
      { signal: request.signal }
    )
    return { shared: isSharedGroup(shared) ? shared : null }
  } catch (error) {
    if (request.signal.aborted) throw error
    return { shared: null }
  }
}

function isSharedGroup(value: unknown): value is SharedGroup {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.participants) &&
    value.participants.every(
      (participant) =>
        isRecord(participant) && typeof participant.name === "string"
    ) &&
    Array.isArray(value.messages) &&
    value.messages.every(isGroupMessage)
  )
}

function isGroupMessage(value: unknown): value is GroupMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.author === "string" &&
    typeof value.content === "string" &&
    typeof value.sentAt === "string" &&
    !Number.isNaN(Date.parse(value.sentAt)) &&
    (value.replyToMessageId === null ||
      typeof value.replyToMessageId === "string") &&
    Array.isArray(value.annotations) &&
    value.annotations.every(
      (annotation) =>
        isRecord(annotation) &&
        typeof annotation.messageId === "string" &&
        typeof annotation.excerpt === "string"
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
