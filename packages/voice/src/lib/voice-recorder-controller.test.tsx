import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { type Mock, describe, expect, it, vi } from "vitest"

import {
  type RecorderCommand,
  type RecorderControllerState,
  VoiceRecorderController,
} from "./voice-recorder-controller"

const recorderMock = vi.hoisted(() => {
  const state: {
    onStop: ((url: string, blob: Blob) => void) | undefined
    startRecording: Mock
    stopRecording: Mock
    status: string
    error: string
  } = {
    onStop: undefined,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    status: "idle",
    error: "",
  }
  state.stopRecording.mockImplementation(() => {
    state.onStop?.("blob:recording", new Blob(["voice"], { type: "audio/wav" }))
  })
  return state
})

vi.mock("react-media-recorder", () => ({
  useReactMediaRecorder: (options: {
    onStop: (url: string, blob: Blob) => void
  }) => {
    recorderMock.onStop = options.onStop
    return {
      error: recorderMock.error,
      startRecording: recorderMock.startRecording,
      status: recorderMock.status,
      stopRecording: recorderMock.stopRecording,
    }
  },
}))

function arrangeRecorderEnv() {
  recorderMock.onStop = undefined
  recorderMock.startRecording.mockClear()
  recorderMock.stopRecording.mockClear()
  recorderMock.status = "idle"
  recorderMock.error = ""
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: class MediaRecorder {},
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  })
}

describe("VoiceRecorderController", () => {
  it("shows the transcript after the user stops recording", async () => {
    arrangeRecorderEnv()
    const user = userEvent.setup()
    render(<RecordingHarness />)

    await user.click(screen.getByRole("button", { name: "Stop recording" }))

    expect(screen.getByText("Transcript ready")).toBeInTheDocument()
  })

  it("does not show a transcript when recording stops during cleanup", async () => {
    arrangeRecorderEnv()
    const user = userEvent.setup()
    render(<RecordingHarness />)

    await user.click(screen.getByRole("button", { name: "Hide recorder" }))

    expect(screen.getByText("No transcript")).toBeInTheDocument()
  })

  it("releases the recording URL after the recorder stops", async () => {
    arrangeRecorderEnv()
    const user = userEvent.setup()
    render(<RecordingHarness />)

    await user.click(screen.getByRole("button", { name: "Stop recording" }))

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:recording")
  })
})

function RecordingHarness() {
  const [command, setCommand] = useState<RecorderCommand | null>(null)
  const [commandId, setCommandId] = useState(0)
  const [visible, setVisible] = useState(true)
  const [transcript, setTranscript] = useState("No transcript")
  const [state, setState] = useState<RecorderControllerState>({
    ready: false,
    status: "idle",
    error: null,
  })

  const stopRecording = () => {
    const nextId = commandId + 1
    setCommandId(nextId)
    setCommand({ id: nextId, action: "stop" })
  }

  return (
    <section aria-label="Voice recorder">
      <div role="status">{state.ready ? state.status : "not ready"}</div>
      <p>{transcript}</p>
      <button type="button" onClick={stopRecording}>
        Stop recording
      </button>
      <button type="button" onClick={() => setVisible(false)}>
        Hide recorder
      </button>
      {visible && (
        <VoiceRecorderController
          command={command}
          onStateChange={setState}
          onStop={() => setTranscript("Transcript ready")}
        />
      )}
    </section>
  )
}
