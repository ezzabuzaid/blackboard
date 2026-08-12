import { useEffect, useRef } from "react"
import {
  type StatusMessages,
  useReactMediaRecorder,
} from "react-media-recorder"

export type RecorderCommand = {
  id: number
  action: "start" | "stop"
}

export type RecorderControllerState = {
  ready: boolean
  status: StatusMessages
  error: string | null
}

export function VoiceRecorderController(props: {
  command: RecorderCommand | null
  onStateChange: (state: RecorderControllerState) => void
  onStop: (blob: Blob) => void
}) {
  if (typeof window === "undefined" || !window.MediaRecorder) {
    return <UnsupportedRecorder onStateChange={props.onStateChange} />
  }

  return <ReactMediaRecorderController {...props} />
}

function UnsupportedRecorder({
  onStateChange,
}: {
  onStateChange: (state: RecorderControllerState) => void
}) {
  useEffect(() => {
    onStateChange({
      ready: false,
      status: "idle",
      error: "recorder_unavailable",
    })
  }, [onStateChange])

  return null
}

function ReactMediaRecorderController({
  command,
  onStateChange,
  onStop,
}: {
  command: RecorderCommand | null
  onStateChange: (state: RecorderControllerState) => void
  onStop: (blob: Blob) => void
}) {
  const suppressStopRef = useRef(false)
  const recorder = useReactMediaRecorder({
    audio: true,
    blobPropertyBag: { type: "audio/webm" },
    onStop: (url, blob) => {
      URL.revokeObjectURL(url)
      if (!suppressStopRef.current) onStop(blob)
    },
  })

  const startRecordingRef = useRef(recorder.startRecording)
  const stopRecordingRef = useRef(recorder.stopRecording)
  const handledCommandIdRef = useRef<number | null>(null)

  useEffect(() => {
    startRecordingRef.current = recorder.startRecording
    stopRecordingRef.current = recorder.stopRecording
  }, [recorder.startRecording, recorder.stopRecording])

  useEffect(() => {
    onStateChange({
      ready: true,
      status: recorder.status,
      error: recorder.error || null,
    })
  }, [onStateChange, recorder.error, recorder.status])

  useEffect(() => {
    if (!command || command.id === handledCommandIdRef.current) return

    handledCommandIdRef.current = command.id
    if (command.action === "start") {
      startRecordingRef.current()
      return
    }

    stopRecordingRef.current()
  }, [command])

  useEffect(() => {
    // Reset on every mount so Strict Mode's simulated unmount/remount does not
    // suppress every recording produced by the second mount.
    suppressStopRef.current = false
    return () => {
      suppressStopRef.current = true
      stopRecordingRef.current()
      onStateChange({ ready: false, status: "idle", error: null })
    }
  }, [onStateChange])

  return null
}
