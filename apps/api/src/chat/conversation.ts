import type { ConversationId } from "@deepagents/experimental/zukhruf"

const MAX_CHAT_ID_LENGTH = 200

export function conversationFrom(
  userId: string,
  chatId: unknown
): ConversationId | null {
  return typeof chatId === "string" &&
    chatId.trim() &&
    chatId.length <= MAX_CHAT_ID_LENGTH
    ? { chatId, userId }
    : null
}
