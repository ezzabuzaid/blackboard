import { useState } from "react"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { Kbd } from "@workspace/ui/components/kbd"

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
    <footer className="shrink-0 border-t border-border/70 bg-background/95 backdrop-blur">
      <form
        className="mx-auto w-full max-w-3xl px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault()
          void sendMessage()
        }}
      >
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="message" className="sr-only">
            Message
          </FieldLabel>
          <InputGroup className="min-h-14 rounded-2xl bg-card shadow-sm">
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
              placeholder="Ask something…"
              disabled={pending}
              aria-invalid={!!error}
              rows={1}
              className="max-h-40 min-h-12 px-3 py-3"
            />
            <InputGroupAddon align="inline-end" className="self-end py-2">
              <InputGroupButton
                type="submit"
                variant="default"
                size="sm"
                disabled={pending || !draft.trim()}
                className="h-9 rounded-xl px-4"
              >
                {pending ? "Sending" : "Send"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {error ? (
            <FieldError className="min-h-5 px-1 text-xs">
              {error.message}
            </FieldError>
          ) : (
            <FieldDescription className="flex min-h-5 items-center gap-1 px-1 text-xs">
              <Kbd>Enter</Kbd>
              to send ·<Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
              for a new line
            </FieldDescription>
          )}
        </Field>
      </form>
    </footer>
  )
}
