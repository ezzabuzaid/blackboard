import { useState } from "react"

import {
  Field,
  FieldError,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@stdlib/shadcn"
import { SendIcon, X } from "lucide-react"

import { useGroupChat } from "./GroupChat"

export function ChatComposer() {
  const {
    annotations,
    apiStatus,
    cancelReply,
    clearError,
    error,
    participants,
    postMessage,
    posting,
    messages,
    removeAnnotation,
    replyingTo,
  } = useGroupChat()
  const [draft, setDraft] = useState("")
  const disabled = apiStatus === "offline" || participants.length === 0
  const references = [
    ...(replyingTo
      ? [
          {
            key: `reply:${replyingTo.id}`,
            label: `Replying to ${replyingTo.author === "user" ? "yourself" : replyingTo.author}`,
            text: replyingTo.content,
            removeLabel: "Cancel reply",
            remove: cancelReply,
          },
        ]
      : []),
    ...annotations.flatMap((annotation, index) => {
      const message = messages.find(({ id }) => id === annotation.messageId)
      return message
        ? [
            {
              key: `annotation:${annotation.messageId}:${annotation.excerpt}`,
              label: `Selected from ${message.author === "user" ? "yourself" : message.author}`,
              text: annotation.excerpt,
              removeLabel: `Remove annotation ${index + 1}`,
              remove: () => removeAnnotation(annotation),
            },
          ]
        : []
    }),
  ]

  async function sendMessage() {
    const text = draft.trim()
    if (!text || posting || disabled) return

    clearError()
    try {
      await postMessage(text)
      setDraft("")
    } catch {
      // The provider exposes the send failure beside the composer.
    }
  }

  return (
    <footer className="shrink-0 bg-muted/60">
      <form
        className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault()
          void sendMessage()
        }}
      >
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="message" className="sr-only">
            Message
          </FieldLabel>
          <div className="overflow-hidden rounded-[26px] bg-card">
            {references.map((reference) => (
              <div
                key={reference.key}
                className="flex items-center gap-2 border-b border-border/60 px-4 py-2"
              >
                <div className="min-w-0 flex-1 border-l-2 border-primary pl-2 text-start">
                  <p className="text-xs font-medium text-foreground">
                    {reference.label}
                  </p>
                  <p
                    dir="auto"
                    className="line-clamp-2 text-start text-xs font-normal whitespace-pre-wrap text-muted-foreground [unicode-bidi:plaintext]"
                  >
                    {reference.text}
                  </p>
                </div>
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  aria-label={reference.removeLabel}
                  onClick={reference.remove}
                >
                  <X aria-hidden="true" />
                </InputGroupButton>
              </div>
            ))}
            <InputGroup className="min-h-[52px] rounded-none border-transparent bg-transparent has-disabled:!bg-transparent has-disabled:!opacity-100 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent has-[[data-slot=input-group-control]:focus-visible]:!ring-0">
              <InputGroupTextarea
                dir="auto"
                id="message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder={
                  apiStatus === "offline"
                    ? "Group unavailable"
                    : participants.length === 0
                      ? "Add an agent to start chatting"
                      : "Message the group…"
                }
                disabled={posting || disabled}
                aria-invalid={!!error}
                rows={1}
                className="max-h-40 min-h-10 px-4 py-[9px] text-start text-[15px] leading-[22px] [unicode-bidi:plaintext]"
              />
              <InputGroupAddon align="inline-end" className="self-end p-1">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={posting || disabled || !draft.trim()}
                  aria-label={posting ? "Sending" : "Send"}
                  className="size-10 rounded-full"
                >
                  <SendIcon aria-hidden="true" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          {error && (
            <FieldError className="min-h-5 px-1 text-xs">
              {error.message}
            </FieldError>
          )}
        </Field>
      </form>
    </footer>
  )
}
