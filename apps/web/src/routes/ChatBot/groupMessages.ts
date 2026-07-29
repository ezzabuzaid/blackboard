import { isDataUIPart, type UIMessage } from "ai"

import type { GroupActivityEvent } from "./groupActivity"

export interface GroupMessage {
  id: string
  author: string
  content: string
}

export interface GroupMessageCluster {
  author: string
  messages: GroupMessage[]
}

type GroupMessageData = {
  groupActivity: GroupActivityEvent
  groupMessage: GroupMessage
}

export type GroupUIMessage = UIMessage<unknown, GroupMessageData>

export function groupReplies(message: UIMessage) {
  return message.parts.flatMap((part) =>
    isDataUIPart(part) &&
    part.type === "data-groupMessage" &&
    isGroupMessage(part.data)
      ? [part.data]
      : []
  )
}

export function groupReplyClusters(messages: readonly GroupMessage[]) {
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

function isGroupMessage(value: unknown): value is GroupMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "author" in value &&
    typeof value.author === "string" &&
    "content" in value &&
    typeof value.content === "string"
  )
}
