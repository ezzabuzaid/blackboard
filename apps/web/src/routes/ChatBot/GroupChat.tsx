import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"

import { apiFetch, apiUrl } from "./api"
import {
  addGroupMessage,
  isGroupChatEvent,
  isGroupChatState,
  isGroupMessage,
  reduceGroupChat,
  type GroupChatState,
  type GroupMessage,
} from "./groupMessages"

interface GroupChat extends GroupChatState {
  chatId: string
  apiStatus: "ready" | "offline"
  posting: boolean
  stopping: boolean
  replyingTo: GroupMessage | null
  error: Error | null
  clearError(): void
  replyTo(message: GroupMessage): void
  cancelReply(): void
  postMessage(content: string): Promise<void>
  stop(): Promise<void>
}

const GroupChatContext = createContext<GroupChat | null>(null)

export function useGroupChat() {
  const chat = useContext(GroupChatContext)
  if (!chat) throw new Error("Group chat is missing")
  return chat
}

interface GroupChatProviderProps extends PropsWithChildren {
  chatId: string
  apiStatus: "ready" | "offline"
  initialState: GroupChatState
}

export function GroupChatProvider({
  chatId,
  apiStatus,
  initialState,
  children,
}: GroupChatProviderProps) {
  const [chat, setChat] = useState(initialState)
  const [posting, setPosting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const source = new EventSource(
      `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/events?after=${initialState.cursor}`,
      { withCredentials: true }
    )
    const receive = ({ data }: MessageEvent<string>) => {
      try {
        const event: unknown = JSON.parse(data)
        if (isGroupChatEvent(event)) {
          setChat((current) => reduceGroupChat(current, event))
        }
      } catch {
        // A malformed event cannot advance the cursor.
      }
    }
    source.addEventListener("message", receive)
    source.addEventListener("activity", receive)
    return () => source.close()
  }, [chatId, initialState.cursor])

  async function postMessage(content: string) {
    if (apiStatus === "offline") throw new Error("The group is unavailable.")
    if (chat.participants.length === 0) {
      throw new Error("Add an agent before sending a message.")
    }

    setPosting(true)
    setError(null)
    try {
      const response = await apiFetch(
        `/api/chat/${encodeURIComponent(chatId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            content,
            ...(replyingTo ? { replyToMessageId: replyingTo.id } : {}),
          }),
        }
      )
      const body: unknown = await response.json()
      const message =
        isRecord(body) && isGroupMessage(body.message) ? body.message : null
      if (!response.ok || !message) {
        throw new Error("The group could not receive your message.")
      }
      setChat((current) => ({
        ...current,
        messages: addGroupMessage(current.messages, message),
      }))
      setReplyingTo(null)
    } catch (cause) {
      const nextError =
        cause instanceof Error
          ? cause
          : new Error("The group could not receive your message.")
      setError(nextError)
      throw nextError
    } finally {
      setPosting(false)
    }
  }

  async function stop() {
    setStopping(true)
    setError(null)
    try {
      const response = await apiFetch(
        `/api/chat/${encodeURIComponent(chatId)}/stop`,
        { method: "POST" }
      )
      const state: unknown = await response.json()
      if (!response.ok || !isGroupChatState(state)) {
        throw new Error("The group could not be stopped.")
      }
      setChat(state)
    } catch (cause) {
      const nextError =
        cause instanceof Error
          ? cause
          : new Error("The group could not be stopped.")
      setError(nextError)
      throw nextError
    } finally {
      setStopping(false)
    }
  }

  return (
    <GroupChatContext.Provider
      value={{
        ...chat,
        chatId,
        apiStatus,
        posting,
        stopping,
        replyingTo,
        error,
        clearError: () => setError(null),
        replyTo: setReplyingTo,
        cancelReply: () => setReplyingTo(null),
        postMessage,
        stop,
      }}
    >
      {children}
    </GroupChatContext.Provider>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
