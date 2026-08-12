import type { ReactNode } from "react"

import {
  type UseVoiceTranscriptionParams,
  useVoiceTranscription,
} from "./use-voice-transcription"

export interface VoiceRecordButtonRenderProps {
  icon: ReactNode
  label: string
  isRecording: boolean
  disabled: boolean
  onClick: () => void
}

export interface VoiceRecordButtonProps extends UseVoiceTranscriptionParams {
  renderButton: (props: VoiceRecordButtonRenderProps) => ReactNode
}

export function VoiceRecordButton({
  renderButton,
  enabled,
  disabled,
  isTranscribing,
  transcribe,
  onTranscription,
}: VoiceRecordButtonProps) {
  const {
    recorder,
    error,
    icon,
    label,
    isRecording,
    disabled: blocked,
    onClick,
  } = useVoiceTranscription({
    enabled,
    disabled,
    transcribe,
    isTranscribing,
    onTranscription,
  })

  const isBusy = isRecording || isTranscribing
  if (!enabled && !isBusy) return null

  return (
    <>
      {recorder}
      {renderButton({ icon, label, isRecording, disabled: blocked, onClick })}
      {error && (
        <span
          role="status"
          aria-live="polite"
          className="max-w-48 truncate text-xs text-destructive"
        >
          {error}
        </span>
      )}
    </>
  )
}
