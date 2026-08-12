import { Loader2, Mic, Square } from "lucide-react"
import {
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import type {
  RecorderCommand,
  RecorderControllerState,
} from "./voice-recorder-controller"

type MicPermissionState = PermissionState | "unknown"

const VoiceRecorderController = lazy(() =>
  import("./voice-recorder-controller").then((module) => ({
    default: module.VoiceRecorderController,
  }))
)

type AudioRecorderStatus = RecorderControllerState["status"]

export interface UseVoiceTranscriptionParams {
  /** Whether voice input is offered at all. */
  enabled: boolean
  /** Whether the caller's current state prevents starting a new recording. */
  disabled?: boolean
  /** Transport for the transcription request; the caller wires the endpoint. */
  transcribe: (audio: Blob) => Promise<{ text: string }>
  /** Mirrors the caller's transcription request state. */
  isTranscribing: boolean
  /** Inserts the completed transcription into the caller-owned composer. */
  onTranscription: (text: string) => void
}

export interface UseVoiceTranscriptionResult {
  available: boolean
  icon: ReactNode
  label: string
  isRecording: boolean
  disabled: boolean
  error: string | null
  onClick: () => void
  recorder: ReactNode
}

export function useVoiceTranscription({
  enabled,
  disabled: externallyDisabled = false,
  transcribe,
  isTranscribing,
  onTranscription,
}: UseVoiceTranscriptionParams): UseVoiceTranscriptionResult {
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState<RecorderCommand | null>(null)
  const isBrowser = useSyncExternalStore(
    subscribeToBrowserSnapshot,
    getBrowserSnapshot,
    getServerBrowserSnapshot
  )
  const [recorderState, setRecorderState] = useState<RecorderControllerState>({
    ready: false,
    status: "idle",
    error: null,
  })
  const permissionState = useMicPermission(enabled)

  const transcribeRef = useRef(transcribe)
  const onTranscriptionRef = useRef(onTranscription)
  useEffect(() => {
    transcribeRef.current = transcribe
    onTranscriptionRef.current = onTranscription
  })

  const onRecorderStop = (blob: Blob) => {
    setError(null)
    transcribeRef
      .current(blob)
      .then(({ text }) => {
        const trimmed = text.trim()
        if (trimmed) onTranscriptionRef.current(trimmed)
      })
      .catch((cause) => {
        console.error("[useVoiceTranscription] transcription failed", cause)
        setError(
          cause instanceof Error ? cause.message : "Transcription failed"
        )
      })
  }

  useEffect(() => {
    if (recorderState.error) {
      console.error(
        "[useVoiceTranscription] recorder error",
        recorderState.error
      )
    }
  }, [recorderState.error])

  const status = recorderState.status
  const isRecording = status === "recording"
  const isRecorderBusy = status === "acquiring_media" || status === "stopping"
  const isBlocked = permissionState === "denied"
  const blockedMessage = isBlocked
    ? "Microphone blocked — enable it in your browser site settings"
    : null
  const disabled =
    !recorderState.ready ||
    isBlocked ||
    isRecorderBusy ||
    (externallyDisabled && !isRecording) ||
    isTranscribing
  const displayError =
    error ??
    blockedMessage ??
    (recorderState.error ? recorderErrorMessage(recorderState.error) : null)

  const onClick = () => {
    setError(null)
    setCommand((previous) => ({
      id: (previous?.id ?? 0) + 1,
      action: isRecording ? "stop" : "start",
    }))
  }

  const { icon, label } = voiceButtonState({
    transcribing: isTranscribing,
    status,
    isRecording,
  })
  const recorder =
    enabled && isBrowser ? (
      <Suspense fallback={null}>
        <VoiceRecorderController
          command={command}
          onStateChange={setRecorderState}
          onStop={onRecorderStop}
        />
      </Suspense>
    ) : null

  return {
    available: enabled,
    icon,
    label,
    isRecording,
    disabled,
    error: displayError,
    onClick,
    recorder,
  }
}

function subscribeToBrowserSnapshot(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const timeout = window.setTimeout(onStoreChange, 0)
  return () => window.clearTimeout(timeout)
}

function getBrowserSnapshot() {
  return typeof window !== "undefined"
}

function getServerBrowserSnapshot() {
  return false
}

function useMicPermission(enabled: boolean): MicPermissionState {
  const [state, setState] = useState<MicPermissionState>("unknown")

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === "undefined" || !navigator.permissions?.query) {
      return
    }
    let cancelled = false
    let status: PermissionStatus | undefined
    const onChange = () => {
      if (!cancelled && status) setState(status.state)
    }
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((nextStatus) => {
        if (cancelled) return
        status = nextStatus
        setState(nextStatus.state)
        nextStatus.addEventListener("change", onChange)
      })
      .catch((cause) => {
        console.warn(
          "[useVoiceTranscription] permissions query unsupported",
          cause
        )
      })
    return () => {
      cancelled = true
      status?.removeEventListener("change", onChange)
      setState("unknown")
    }
  }, [enabled])

  return state
}

function voiceButtonState({
  transcribing,
  status,
  isRecording,
}: {
  transcribing: boolean
  status: AudioRecorderStatus
  isRecording: boolean
}): { icon: ReactNode; label: string } {
  if (transcribing) {
    return {
      icon: <Loader2 className="size-4 animate-spin" />,
      label: "Transcribing voice input",
    }
  }
  if (status === "acquiring_media") {
    return {
      icon: <Loader2 className="size-4 animate-spin" />,
      label: "Starting voice input",
    }
  }
  if (status === "stopping") {
    return {
      icon: <Loader2 className="size-4 animate-spin" />,
      label: "Stopping recording",
    }
  }
  if (isRecording) {
    return {
      icon: (
        <span className="relative inline-flex">
          <Square className="size-4 fill-current" />
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-destructive motion-safe:animate-pulse"
          />
        </span>
      ),
      label: "Stop recording",
    }
  }
  return {
    icon: <Mic className="size-4" />,
    label: "Start voice input",
  }
}

function recorderErrorMessage(error: string): string {
  switch (error) {
    case "media_aborted":
      return "Recording was interrupted"
    case "permission_denied":
      return "Microphone permission denied"
    case "no_specified_media_found":
      return "No microphone found"
    case "media_in_use":
      return "Microphone is in use"
    case "invalid_media_constraints":
      return "Microphone settings are not supported"
    case "no_constraints":
      return "No recording constraints were provided"
    case "recorder_error":
      return "Recorder failed to start"
    case "recorder_unavailable":
      return "Voice recording is unavailable in this browser"
    default:
      return "Could not start recording"
  }
}
