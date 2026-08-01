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
  const { cancelReply, clearError, error, postMessage, posting, replyingTo } =
    useGroupChat()
  const [draft, setDraft] = useState("")

  async function sendMessage() {
    const text = draft.trim()
    if (!text || posting) return

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
            {replyingTo && (
              <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
                <div className="min-w-0 flex-1 border-l-2 border-primary pl-2 text-left">
                  <p className="text-xs font-medium text-foreground">
                    Replying to{" "}
                    {replyingTo.author === "user"
                      ? "yourself"
                      : replyingTo.author}
                  </p>
                  <p className="truncate text-xs font-normal text-muted-foreground">
                    {replyingTo.content}
                  </p>
                </div>
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  aria-label="Cancel reply"
                  onClick={cancelReply}
                >
                  <X aria-hidden="true" />
                </InputGroupButton>
              </div>
            )}
            <InputGroup className="min-h-[52px] rounded-none border-transparent bg-transparent has-disabled:!bg-transparent has-disabled:!opacity-100 has-[[data-slot=input-group-control]:focus-visible]:!border-transparent has-[[data-slot=input-group-control]:focus-visible]:!ring-0">
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
                disabled={posting}
                aria-invalid={!!error}
                rows={1}
                className="max-h-40 min-h-10 px-4 py-[9px] text-[15px] leading-[22px]"
              />
              <InputGroupAddon align="inline-end" className="self-end p-1">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={posting || !draft.trim()}
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
