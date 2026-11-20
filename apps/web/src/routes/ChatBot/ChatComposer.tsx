import {
  Composer,
  type ComposerItemEntry,
  type ComposerSubmission,
  type DictationError,
  type DictationState,
  serializeMentionPromptLink,
  useComposer,
  useComposerDictation,
} from '@deepagents/react-input/browser';
import { Annotation } from '@genui/annotation';
import { Field, FieldError, InputGroupButton } from '@zukhruf/shadcn';
import { CircleStop, Loader2, Mic, SendIcon, Square, X } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';

import { useGroupChat } from './GroupChat.tsx';
import { api } from './api.ts';
import type { GroupActivityState } from './groupActivity.ts';
import type { GroupParticipant } from './groupMessages.ts';
import { messageDisplayText } from './mentions.ts';

declare module 'react' {
  interface CSSProperties {
    [customProperty: `--${string}`]: string;
  }
}

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
  } = useGroupChat();
  const disabled = apiStatus === 'offline' || participants.length === 0;
  const mentionCandidates = useMemo(
    () => chatMentionCandidates(participants),
    [participants],
  );
  const slashCommands = useMemo(() => chatSlashCommands(activity), [activity]);

  function handleSubmit(event: ComposerSubmission) {
    if (isStopSubmission(event)) {
      void stop().catch(() => undefined);
      return;
    }
    const text = event.prompt.trim();
    if (!text && annotations.length === 0) return;

    clearError();
    return postMessage(text);
  }

  return (
    <footer className="bg-muted/60 shrink-0">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-5">
        <Field data-invalid={!!error}>
          <Composer.Root
            draftKey={chatId}
            disabled={posting || disabled}
            editorAriaLabel="Message"
            validateSubmission={validateSubmission}
            onSubmit={handleSubmit}
            dictation={
              apiStatus === 'ready'
                ? {
                    transcribe: (audio, { signal }) =>
                      api.request(
                        'POST /chat/{chatId}/transcription',
                        { chatId, audio },
                        { signal },
                      ),
                  }
                : undefined
            }
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
            <div className="bg-card overflow-hidden rounded-[26px]">
              <ReferenceChips />
              <div className="flex min-h-13 items-center">
                <MessageEditor />
                <div className="me-[-0.3rem] flex items-center gap-2 self-end p-1">
                  {apiStatus === 'ready' && <ChatVoiceButton />}
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
  );
}

function ReferenceChips() {
  const {
    annotations,
    cancelReply,
    messages,
    removeAnnotation,
    replyingTo,
    updateAnnotationComment,
  } = useGroupChat();

  return (
    <>
      {replyingTo && (
        <ReferenceChip
          label={`Replying to ${replyingTo.author === 'user' ? 'yourself' : replyingTo.author}`}
          text={messageDisplayText(replyingTo.content)}
          removeLabel="Cancel reply"
          onRemove={cancelReply}
        />
      )}
      {annotations.map((annotation, index) => {
        const message = messages.find(({ id }) => id === annotation.messageId);
        if (!message) return null;

        const label = `${index + 1} · Selected from ${message.author === 'user' ? 'yourself' : message.author}`;
        return (
          <ReferenceChip
            key={`${annotation.messageId}:${annotation.excerpt}`}
            label={label}
            text={messageDisplayText(annotation.excerpt)}
            removeLabel={`Remove annotation ${index + 1}`}
            onRemove={() => removeAnnotation(annotation)}
          >
            <Annotation.Comment
              value={annotation.comment ?? ''}
              maxLength={8_000}
              aria-label={`Comment on ${label}`}
              placeholder="Add a comment"
              autoFocus={index === annotations.length - 1}
              onChange={(event) =>
                updateAnnotationComment(annotation, event.currentTarget.value)
              }
            />
          </ReferenceChip>
        );
      })}
    </>
  );
}

function ReferenceChip({
  children,
  label,
  onRemove,
  removeLabel,
  text,
}: {
  children?: ReactNode;
  label: string;
  onRemove: () => void;
  removeLabel: string;
  text: string;
}) {
  return (
    <Annotation.Root>
      <Annotation.Content>
        <Annotation.Label>{label}</Annotation.Label>
        <Annotation.Excerpt>{text}</Annotation.Excerpt>
        {children}
      </Annotation.Content>
      <Annotation.Remove
        render={
          <InputGroupButton
            size="icon-xs"
            aria-label={removeLabel}
            className="text-muted-foreground"
            onClick={onRemove}
          />
        }
      >
        <X aria-hidden="true" />
      </Annotation.Remove>
    </Annotation.Root>
  );
}

function MessageEditor() {
  const { apiStatus, participants } = useGroupChat();

  return (
    <Composer.Editor
      placeholder={
        apiStatus === 'offline'
          ? 'Group unavailable'
          : participants.length === 0
            ? 'Add an agent to start chatting'
            : 'Message the group…'
      }
      style={{
        '--composer-min-height': '2.5rem',
        '--composer-max-height': '10rem',
        '--composer-font-size': '15px',
        '--composer-line-height': '22px',
        '--composer-padding': '9px 16px',
      }}
      className="min-w-0 flex-1 rounded-none! border-0! bg-transparent! text-start focus-within:shadow-none!"
    />
  );
}

function ChatVoiceButton() {
  const { state } = useComposerDictation('ChatVoiceButton');
  const label = voiceLabel(state);
  const failure = voiceFailure(state);

  return (
    <>
      <Composer.Dictate
        render={
          <InputGroupButton
            size="icon-sm"
            aria-label={label}
            title={label}
            className="size-10 rounded-full"
          />
        }
      >
        {voiceIcon(state)}
      </Composer.Dictate>
      {(state.status === 'starting' ||
        state.status === 'recording' ||
        state.status === 'finishing') && (
        <Composer.CancelDictation
          render={
            <InputGroupButton
              size="icon-sm"
              aria-label="Cancel voice input"
              title="Cancel voice input"
              className="size-10 rounded-full"
            />
          }
        >
          <X className="size-4" />
        </Composer.CancelDictation>
      )}
      {failure && (
        <span
          role="status"
          aria-live="polite"
          className="text-destructive max-w-48 truncate text-xs"
        >
          {failure}
        </span>
      )}
    </>
  );
}

function voiceLabel(state: DictationState) {
  switch (state.status) {
    case 'starting':
      return 'Starting voice input';
    case 'recording':
      return 'Stop recording';
    case 'finishing':
      return 'Transcribing voice input';
    case 'unavailable':
    case 'idle':
    case 'failed':
      return 'Start voice input';
  }
}

function voiceIcon(state: DictationState) {
  switch (state.status) {
    case 'starting':
    case 'finishing':
      return <Loader2 className="size-4 animate-spin" />;
    case 'recording':
      return (
        <span className="relative inline-flex">
          <Square className="size-4 fill-current" />
          <span
            aria-hidden="true"
            className="bg-destructive absolute -top-0.5 -right-0.5 size-1.5 rounded-full motion-safe:animate-pulse"
          />
        </span>
      );
    case 'unavailable':
    case 'idle':
    case 'failed':
      return <Mic className="size-4" />;
  }
}

function voiceFailure(state: DictationState) {
  switch (state.status) {
    case 'unavailable':
      return state.reason === 'blocked'
        ? 'Microphone blocked — enable it in your browser site settings'
        : 'Voice recording is unavailable in this browser';
    case 'failed':
      return dictationErrorMessage(state.error);
    case 'idle':
    case 'starting':
    case 'recording':
    case 'finishing':
      return null;
  }
}

function dictationErrorMessage(error: DictationError) {
  switch (error.code) {
    case 'permission-denied':
      return 'Microphone permission denied';
    case 'no-microphone':
      return 'No microphone found';
    case 'microphone-in-use':
      return 'Microphone is in use';
    case 'interrupted':
      return 'Recording was interrupted';
    case 'transcription-failed':
      return error.cause instanceof Error
        ? error.cause.message
        : 'Transcription failed';
  }
}

function SendButton() {
  const { annotations, posting } = useGroupChat();
  const { state, meta } = useComposer('SendButton');
  const empty =
    !state.text.trim() &&
    state.imageAttachments.length === 0 &&
    state.remoteImages.length === 0 &&
    state.pendingPastes.length === 0;
  const sendDisabled = meta.disabled || (empty && annotations.length === 0);

  return (
    <Composer.Submit
      disabled={sendDisabled}
      render={
        <InputGroupButton
          variant="default"
          size="icon-sm"
          aria-label={posting ? 'Sending' : 'Send'}
          className="size-10 rounded-full"
        />
      }
    >
      <SendIcon aria-hidden="true" />
    </Composer.Submit>
  );
}

function SendFailure() {
  const { error } = useGroupChat();
  if (!error) return null;

  return (
    <FieldError className="min-h-5 px-1 text-xs">{error.message}</FieldError>
  );
}

const STOP_COMMAND = 'stop';

function chatMentionCandidates(
  participants: readonly GroupParticipant[],
): ComposerItemEntry[] {
  return participants.map(({ name }) => ({
    id: `agent:${name}`,
    trigger: '@',
    value: name,
    label: name,
    detail: '',
    atomic: true,
    persistsAs: serializeMentionPromptLink(name),
  }));
}

function chatSlashCommands(
  activity: Pick<GroupActivityState, 'phase'>,
): ComposerItemEntry[] {
  return [
    {
      id: STOP_COMMAND,
      trigger: '/',
      value: STOP_COMMAND,
      label: 'stop',
      detail: "Stop the agents' current run",
      icon: <CircleStop aria-hidden="true" />,
      atomic: false,
      availability: activity.phase === 'active' ? 'enabled' : 'disabled',
    },
  ];
}

function isStopSubmission(submission: ComposerSubmission) {
  return submission.command === STOP_COMMAND;
}

function validateSubmission(event: ComposerSubmission) {
  const hasImage = event.items.some(
    ({ type }) =>
      type === 'image' ||
      type === 'video' ||
      type === 'audio' ||
      type === 'remote_image',
  );
  return hasImage ? "Image attachments aren't supported yet." : null;
}
