import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

import { Annotation } from "@genui/annotation"
import {
  Composer,
  useComposer,
  type ComposerItemEntry,
  type ComposerSubmission,
} from "@genui/input/browser"
import "@genui/input/styles.css"
import { VoiceRecordButton } from "@genui/voice"
import { Field, FieldError, InputGroupButton } from "@stdlib/shadcn"
import { SendIcon, X } from "lucide-react"

import { api } from "./api"
import { useGroupChat } from "./GroupChat"
import type { GroupActivityState } from "./groupActivity"
import type { GroupParticipant } from "./groupMessages"

export function ChatComposer() {
  const {
    activity,
    annotations,
    apiStatus,
    chatId,
    clearError,
    error,
    participants,
    postMessage,
    posting,
    stop,
  } = useGroupChat()
  const disabled = apiStatus === "offline" || participants.length === 0
  const mentionCandidates = useMemo(
    () => chatMentionCandidates(participants),
    [participants]
  )
  const slashCommands = useMemo(() => chatSlashCommands(activity), [activity])

  function handleSubmit(event: ComposerSubmission) {
    if (isStopSubmission(event)) {
      void stop().catch(() => undefined)
      return
    }
    const text = event.prompt.trim()
    if (!text && annotations.length === 0) return

    clearError()
    return postMessage(text)
  }

  return (
    <footer className="shrink-0 bg-muted/60">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-5">
        <Field data-invalid={!!error}>
          <Composer.Root
            draftKey={chatId}
            disabled={posting || disabled}
            editorAriaLabel="Message"
            validateSubmission={validateSubmission}
            onSubmit={handleSubmit}
            className="border-0 bg-transparent"
          >
            <Composer.Trigger trigger="/">
              {slashCommands.map((command) => (
                <Composer.Command key={command.id} {...command} />
              ))}
            </Composer.Trigger>
            <Composer.Trigger trigger="@">
              {mentionCandidates.map((candidate) => (
                <Composer.Mention key={candidate.id} {...candidate} />
              ))}
            </Composer.Trigger>
            <Composer.Popup />
            <div className="overflow-hidden rounded-[26px] bg-card">
              <ReferenceChips />
              <div className="flex min-h-13 items-center">
                <MessageEditor />
                <div className="me-[-0.3rem] flex items-center gap-2 self-end p-1">
                  <ChatVoiceButton />
                  <SendButton />
                </div>
              </div>
              <Composer.Error className="mx-4 mb-2" />
            </div>
            <Composer.Shortcuts className="mt-2 rounded-2xl border" />
          </Composer.Root>
          <SendFailure />
        </Field>
      </div>
    </footer>
  )
}

function ReferenceChips() {
  const {
    annotations,
    cancelReply,
    messages,
    removeAnnotation,
    replyingTo,
    updateAnnotationComment,
  } = useGroupChat()

  return (
    <>
      {replyingTo && (
        <ReferenceChip
          label={`Replying to ${replyingTo.author === "user" ? "yourself" : replyingTo.author}`}
          text={replyingTo.content}
          removeLabel="Cancel reply"
          onRemove={cancelReply}
        />
      )}
      {annotations.map((annotation, index) => {
        const message = messages.find(({ id }) => id === annotation.messageId)
        if (!message) return null

        const label = `${index + 1} · Selected from ${message.author === "user" ? "yourself" : message.author}`
        return (
          <ReferenceChip
            key={`${annotation.messageId}:${annotation.excerpt}`}
            label={label}
            text={annotation.excerpt}
            removeLabel={`Remove annotation ${index + 1}`}
            onRemove={() => removeAnnotation(annotation)}
          >
            <Annotation.Comment
              value={annotation.comment ?? ""}
              maxLength={8_000}
              aria-label={`Comment on ${label}`}
              placeholder="Add a comment"
              autoFocus={index === annotations.length - 1}
              onChange={(event) =>
                updateAnnotationComment(annotation, event.currentTarget.value)
              }
            />
          </ReferenceChip>
        )
      })}
    </>
  )
}

function ReferenceChip({
  children,
  label,
  onRemove,
  removeLabel,
  text,
}: {
  children?: ReactNode
  label: string
  onRemove: () => void
  removeLabel: string
  text: string
}) {
  return (
    <Annotation.Root>
      <Annotation.Content>
        <Annotation.Label>{label}</Annotation.Label>
        <Annotation.Excerpt>{text}</Annotation.Excerpt>
        {children}
      </Annotation.Content>
      <Annotation.Remove>
        <InputGroupButton
          size="icon-xs"
          aria-label={removeLabel}
          className="text-muted-foreground"
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </InputGroupButton>
      </Annotation.Remove>
    </Annotation.Root>
  )
}

function MessageEditor() {
  const { apiStatus, participants } = useGroupChat()

  return (
    <Composer.Editor
      placeholder={
        apiStatus === "offline"
          ? "Group unavailable"
          : participants.length === 0
            ? "Add an agent to start chatting"
            : "Message the group…"
      }
      style={
        {
          "--composer-min-height": "2.5rem",
          "--composer-max-height": "10rem",
          "--composer-font-size": "15px",
          "--composer-line-height": "22px",
          "--composer-padding": "9px 16px",
        } as CSSProperties
      }
      className="min-w-0 flex-1 rounded-none! border-0! bg-transparent! text-start focus-within:shadow-none!"
    />
  )
}

function ChatVoiceButton() {
  const { apiStatus, chatId } = useGroupChat()
  const { state, actions, meta } = useComposer("ChatVoiceButton")
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)

  // insertText is a no-op while the composer is disabled (e.g. during a send),
  // so hold the transcript until the composer can actually receive it.
  useEffect(() => {
    if (transcript === null || meta.disabled) return
    const beforeCursor = state.text.slice(0, state.cursor)
    actions.insertText(
      beforeCursor && !/\s$/.test(beforeCursor) ? ` ${transcript}` : transcript
    )
    setTranscript(null)
  }, [transcript, meta.disabled, state, actions])

  return (
    <VoiceRecordButton
      enabled={apiStatus === "ready"}
      disabled={meta.disabled}
      isTranscribing={transcribing}
      transcribe={async (audio) => {
        setTranscribing(true)
        try {
          return await api.request("POST /chat/{chatId}/transcription", {
            chatId,
            audio,
          })
        } finally {
          setTranscribing(false)
        }
      }}
      onTranscription={(text) =>
        setTranscript((pending) => (pending ? `${pending} ${text}` : text))
      }
      renderButton={({
        icon,
        label,
        isRecording,
        disabled: voiceDisabled,
        onClick,
      }) => (
        <InputGroupButton
          type="button"
          size="icon-sm"
          disabled={voiceDisabled}
          aria-label={label}
          aria-pressed={isRecording}
          title={label}
          onClick={onClick}
          className="size-10 rounded-full"
        >
          {icon}
        </InputGroupButton>
      )}
    />
  )
}

function SendButton() {
  const { annotations, posting } = useGroupChat()
  const { state, meta } = useComposer("SendButton")
  const empty =
    !state.text.trim() &&
    state.localImages.length === 0 &&
    state.remoteImages.length === 0 &&
    state.pendingPastes.length === 0
  const sendDisabled = meta.disabled || (empty && annotations.length === 0)

  return (
    <Composer.Submit asChild disabled={sendDisabled}>
      <InputGroupButton
        type="button"
        variant="default"
        size="icon-sm"
        disabled={sendDisabled}
        aria-label={posting ? "Sending" : "Send"}
        className="size-10 rounded-full"
      >
        <SendIcon aria-hidden="true" />
      </InputGroupButton>
    </Composer.Submit>
  )
}

function SendFailure() {
  const { error } = useGroupChat()
  if (!error) return null

  return (
    <FieldError className="min-h-5 px-1 text-xs">{error.message}</FieldError>
  )
}

const STOP_COMMAND = "stop"

function chatMentionCandidates(
  participants: readonly GroupParticipant[]
): ComposerItemEntry[] {
  return participants.map(({ name }) => ({
    id: `agent:${name}`,
    trigger: "@",
    value: name,
    label: name,
    detail: "Agent",
    atomic: true,
  }))
}

function chatSlashCommands(
  activity: Pick<GroupActivityState, "phase">
): ComposerItemEntry[] {
  return [
    {
      id: STOP_COMMAND,
      trigger: "/",
      value: STOP_COMMAND,
      label: "stop",
      detail: "Stop the agents' current run",
      atomic: false,
      availability: activity.phase === "active" ? "enabled" : "disabled",
    },
  ]
}

function isStopSubmission(submission: ComposerSubmission) {
  return submission.command === STOP_COMMAND
}

function validateSubmission(event: ComposerSubmission) {
  const hasImage = event.items.some(
    ({ type }) => type === "local_image" || type === "remote_image"
  )
  return hasImage ? "Image attachments aren't supported yet." : null
}
