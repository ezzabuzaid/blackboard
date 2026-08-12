import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StrictMode } from "react"
import { type Mock, describe, expect, it, vi } from "vitest"

import { VoiceRecordButton } from "./VoiceRecordButton"

const recorderMock = vi.hoisted(() => {
  const recorder: {
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
  return recorder
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
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: class MediaRecorder {},
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  })
}

function VoiceButton({
  transcribe = vi.fn().mockResolvedValue({ text: "hello world" }),
  disabled = false,
}: {
  transcribe?: (audio: Blob) => Promise<{ text: string }>
  disabled?: boolean
}) {
  return (
    <VoiceRecordButton
      enabled={true}
      disabled={disabled}
      isTranscribing={false}
      transcribe={transcribe}
      onTranscription={vi.fn()}
      renderButton={({ icon, label, onClick, disabled: blocked }) => (
        <button
          type="button"
          onClick={onClick}
          disabled={blocked}
          aria-label={label}
        >
          {icon}
        </button>
      )}
    />
  )
}

describe("VoiceRecordButton", () => {
  it("calls transcribe when the recorder produces a blob after stop", async () => {
    arrangeRecorderEnv()
    const user = userEvent.setup()
    const transcribe = vi.fn().mockResolvedValue({ text: "hello world" })

    render(<VoiceButton transcribe={transcribe} />)

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start voice input" })
      ).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: "Start voice input" }))
    expect(recorderMock.startRecording).toHaveBeenCalled()

    act(() => {
      recorderMock.onStop?.(
        "blob:test",
        new Blob(["voice"], { type: "audio/webm" })
      )
    })

    await waitFor(() => {
      expect(transcribe).toHaveBeenCalledWith(expect.any(Blob))
    })
  })

  it("survives React Strict Mode remount and still transcribes", async () => {
    arrangeRecorderEnv()
    const user = userEvent.setup()
    const transcribe = vi.fn().mockResolvedValue({ text: "after strict mode" })

    render(
      <StrictMode>
        <VoiceButton transcribe={transcribe} />
      </StrictMode>
    )

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start voice input" })
      ).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: "Start voice input" }))
    act(() => {
      recorderMock.onStop?.(
        "blob:strict",
        new Blob(["after-strict"], { type: "audio/webm" })
      )
    })

    await waitFor(() => {
      expect(transcribe).toHaveBeenCalledWith(expect.any(Blob))
    })
  })

  it("renders nothing when disabled at the feature boundary", () => {
    arrangeRecorderEnv()
    render(
      <VoiceRecordButton
        enabled={false}
        isTranscribing={false}
        transcribe={vi.fn()}
        onTranscription={vi.fn()}
        renderButton={() => (
          <button type="button" data-testid="mic">
            mic
          </button>
        )}
      />
    )

    expect(screen.queryByTestId("mic")).not.toBeInTheDocument()
  })

  it("honors caller state before starting a recording", async () => {
    arrangeRecorderEnv()
    render(<VoiceButton disabled={true} />)

    expect(
      await screen.findByRole("button", { name: "Start voice input" })
    ).toBeDisabled()
  })
})
