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
import { SendIcon } from "lucide-react"

import { useChatSession } from "./ChatSession"

export function ChatComposer() {
  const {
    clearError,
    error,
    sendMessage: submitChatMessage,
    status,
  } = useChatSession()
  const [draft, setDraft] = useState("")
  const pending = status === "submitted" || status === "streaming"

  async function sendMessage() {
    const text = draft.trim()
    if (!text || pending) return

    clearError()
    setDraft("")
    await submitChatMessage({ text })
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
          <InputGroup className="min-h-[52px] rounded-full border-transparent bg-card has-disabled:!bg-card has-disabled:!opacity-100 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent has-[[data-slot=input-group-control]:focus-visible]:!ring-0">
            <InputGroupTextarea
              id="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Message the group…"
              disabled={pending}
              aria-invalid={!!error}
              rows={1}
              className="max-h-40 min-h-10 px-4 py-[9px] text-[15px] leading-[22px]"
            />
            <InputGroupAddon align="inline-end" className="self-end p-1">
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={pending || !draft.trim()}
                aria-label={pending ? "Sending" : "Send"}
                className="size-10 rounded-full"
              >
                <SendIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
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
