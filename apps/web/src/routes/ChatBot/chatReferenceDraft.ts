import type { GroupMessageAnnotation } from "./groupMessages"

const STORAGE_KEY_PREFIX = "chat-reference-draft:v1:"

export interface ChatReferenceDraft {
  replyToMessageId: string | null
  annotations: GroupMessageAnnotation[]
}

export function readChatReferenceDraft(chatId: string): ChatReferenceDraft {
  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${chatId}`)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isChatReferenceDraft(parsed)) return parsed
    } catch {
      // Ignore malformed browser state.
    }
  }
  return { replyToMessageId: null, annotations: [] }
}

export function writeChatReferenceDraft(
  chatId: string,
  draft: ChatReferenceDraft
) {
  const key = `${STORAGE_KEY_PREFIX}${chatId}`
  if (!draft.replyToMessageId && draft.annotations.length === 0) {
    localStorage.removeItem(key)
    return
  }
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Quota exhaustion or privacy mode: the draft just won't survive a reload.
  }
}

function isChatReferenceDraft(value: unknown): value is ChatReferenceDraft {
  return (
    isRecord(value) &&
    (value.replyToMessageId === null ||
      typeof value.replyToMessageId === "string") &&
    Array.isArray(value.annotations) &&
    value.annotations.every(
      (annotation) =>
        isRecord(annotation) &&
        typeof annotation.messageId === "string" &&
        typeof annotation.excerpt === "string" &&
        (annotation.comment === undefined ||
          typeof annotation.comment === "string")
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
