import type { ConversationId } from "@deepagents/experimental/zukhruf"

const LOCAL_USER_ID = "local-user"
const MAX_CHAT_ID_LENGTH = 200

export function conversationFrom(chatId: unknown): ConversationId | null {
  return typeof chatId === "string" &&
    chatId.trim() &&
    chatId.length <= MAX_CHAT_ID_LENGTH
    ? { chatId, userId: LOCAL_USER_ID }
    : null
}
