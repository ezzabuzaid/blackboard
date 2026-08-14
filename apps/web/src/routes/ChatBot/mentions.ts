import { tokenizePersistedPrompt } from "@genui/input"

interface MessageSegment {
  text: string
  /** Persisted source text, when it differs from what is displayed. */
  source?: string
  mention: boolean
}

/**
 * User messages render literally — no markdown — so every token except a
 * mention is passed through as its own source text.
 */
export function messageSegments(content: string): MessageSegment[] {
  return tokenizePersistedPrompt(content).map((token) =>
    token.kind === "mention"
      ? { text: token.label, source: token.source, mention: true }
      : { text: token.source, mention: false }
  )
}

/**
 * What a message reads as once persisted mention links are resolved to their
 * labels. For previews and quotes, which show text rather than tokens.
 */
export function messageDisplayText(content: string) {
  return messageSegments(content)
    .map(({ text }) => text)
    .join("")
}
