import {
  isGroupActivityEvent,
  isGroupActivityState,
  reduceGroupActivity,
  type GroupActivityEvent,
  type GroupActivityState,
} from "./groupActivity"

export interface GroupMessage {
  id: string
  sequence: number
  author: string
  content: string
  sentAt: string
  replyToMessageId: string | null
}

export interface GroupParticipant {
  name: string
}

export interface GroupChatState {
  messages: GroupMessage[]
  participants: GroupParticipant[]
  activity: GroupActivityState
  cursor: number
}

export type GroupChatEvent =
  | { cursor: number; type: "message"; message: GroupMessage }
  | { cursor: number; type: "activity"; activity: GroupActivityEvent }

export interface GroupMessageCluster {
  author: string
  messages: GroupMessage[]
}

export function groupMessageClusters(messages: readonly GroupMessage[]) {
  return messages.reduce<GroupMessageCluster[]>((clusters, message) => {
    const current = clusters.at(-1)
    if (current?.author === message.author) {
      current.messages.push(message)
    } else {
      clusters.push({ author: message.author, messages: [message] })
    }
    return clusters
  }, [])
}

export function reduceGroupChat(
  state: GroupChatState,
  event: GroupChatEvent
): GroupChatState {
  if (event.cursor <= state.cursor) return state

  if (event.type === "activity") {
    return {
      ...state,
      activity: reduceGroupActivity(state.activity, event.activity),
      cursor: event.cursor,
    }
  }

  return {
    ...state,
    messages: addGroupMessage(state.messages, event.message),
    cursor: event.cursor,
  }
}

export function addGroupMessage(
  messages: readonly GroupMessage[],
  message: GroupMessage
) {
  if (messages.some(({ id }) => id === message.id)) return [...messages]
  return [...messages, message].sort((left, right) => {
    return left.sequence - right.sequence
  })
}

export function isGroupMessage(value: unknown): value is GroupMessage {
  return (
    isRecord(value) &&
    "id" in value &&
    typeof value.id === "string" &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 &&
    "author" in value &&
    typeof value.author === "string" &&
    "content" in value &&
    typeof value.content === "string" &&
    typeof value.sentAt === "string" &&
    !Number.isNaN(Date.parse(value.sentAt)) &&
    (value.replyToMessageId === null ||
      typeof value.replyToMessageId === "string")
  )
}

export function isGroupChatState(value: unknown): value is GroupChatState {
  if (!isRecord(value) || !Array.isArray(value.messages)) return false
  const messages = value.messages

  return (
    messages.every(isGroupMessage) &&
    messages.every(
      (message, index) =>
        index === 0 ||
        message.sequence > (messages[index - 1] as GroupMessage).sequence
    ) &&
    Array.isArray(value.participants) &&
    value.participants.every(isGroupParticipant) &&
    isGroupActivityState(value.activity) &&
    Number.isSafeInteger(value.cursor) &&
    Number(value.cursor) >= 0
  )
}

export function isGroupChatEvent(value: unknown): value is GroupChatEvent {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.cursor) ||
    Number(value.cursor) <= 0
  ) {
    return false
  }
  if (value.type === "message") return isGroupMessage(value.message)
  return value.type === "activity" && isGroupActivityEvent(value.activity)
}

export function groupChatEventFromStreamPart(value: unknown) {
  return isRecord(value) &&
    value.type === "data-whatsapp-chat-event" &&
    isGroupChatEvent(value.data)
    ? value.data
    : null
}

function isGroupParticipant(value: unknown): value is GroupParticipant {
  return isRecord(value) && typeof value.name === "string" && !!value.name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
