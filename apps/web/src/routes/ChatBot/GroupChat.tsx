import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"

import { apiUrl } from "./api"
import {
  addGroupMessage,
  isGroupMessage,
  isGroupRoomEvent,
  reduceGroupRoom,
  type GroupRoomState,
} from "./groupMessages"

interface GroupChat extends GroupRoomState {
  chatId: string
  posting: boolean
  error: Error | null
  clearError(): void
  postMessage(content: string): Promise<void>
}

const GroupChatContext = createContext<GroupChat | null>(null)

export function useGroupChat() {
  const chat = useContext(GroupChatContext)
  if (!chat) throw new Error("Group chat is missing")
  return chat
}

interface GroupChatProviderProps extends PropsWithChildren {
  chatId: string
  initialState: GroupRoomState
}

export function GroupChatProvider({
  chatId,
  initialState,
  children,
}: GroupChatProviderProps) {
  const [room, setRoom] = useState(initialState)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const source = new EventSource(
      `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/events?after=${initialState.cursor}`
    )
    const receive = ({ data }: MessageEvent<string>) => {
      try {
        const event: unknown = JSON.parse(data)
        if (isGroupRoomEvent(event)) {
          setRoom((current) => reduceGroupRoom(current, event))
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
    setPosting(true)
    setError(null)
    try {
      const response = await fetch(
        `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: crypto.randomUUID(), content }),
        }
      )
      const body: unknown = await response.json()
      const message =
        isRecord(body) && isGroupMessage(body.message) ? body.message : null
      if (!response.ok || !message) {
        throw new Error("The group could not receive your message.")
      }
      setRoom((current) => ({
        ...current,
        messages: addGroupMessage(current.messages, message),
      }))
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

  return (
    <GroupChatContext.Provider
      value={{
        ...room,
        chatId,
        posting,
        error,
        clearError: () => setError(null),
        postMessage,
      }}
    >
      {children}
    </GroupChatContext.Provider>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
