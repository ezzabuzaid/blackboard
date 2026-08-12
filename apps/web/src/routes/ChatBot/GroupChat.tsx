import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"

import { api, apiUrl } from "./api"
import {
  addGroupMessage,
  addGroupMessageAnnotation,
  groupChatEventFromStreamPart,
  isGroupChatState,
  isGroupMessage,
  reduceGroupChat,
  type GroupChatState,
  type GroupMessage,
  type GroupMessageAnnotation,
} from "./groupMessages"

interface GroupChat extends GroupChatState {
  chatId: string
  apiStatus: "ready" | "offline"
  posting: boolean
  stopping: boolean
  replyingTo: GroupMessage | null
  annotations: readonly GroupMessageAnnotation[]
  error: Error | null
  clearError(): void
  replyTo(message: GroupMessage): void
  addAnnotation(message: GroupMessage, excerpt: string): void
  removeAnnotation(annotation: GroupMessageAnnotation): void
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
  streamPath: string | null
}

export function GroupChatProvider({
  chatId,
  apiStatus,
  initialState,
  streamPath,
  children,
}: GroupChatProviderProps) {
  const [chat, setChat] = useState(initialState)
  const [posting, setPosting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [replyingTo, setReplyingTo] = useState<GroupMessage | null>(null)
  const [annotations, setAnnotations] = useState<
    readonly GroupMessageAnnotation[]
  >([])
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!streamPath) return
    const source = new EventSource(`${apiUrl}${streamPath}`, {
      withCredentials: true,
    })
    const receive = ({ data }: MessageEvent<string>) => {
      try {
        const event = groupChatEventFromStreamPart(JSON.parse(data))
        if (event) {
          setChat((current) => reduceGroupChat(current, event))
        }
      } catch {
        // A malformed event cannot advance the cursor.
      }
    }
    source.addEventListener("message", receive)
    return () => source.close()
  }, [streamPath])

  async function postMessage(content: string) {
    if (apiStatus === "offline") throw new Error("The group is unavailable.")
    if (chat.participants.length === 0) {
      throw new Error("Add an agent before sending a message.")
    }

    setPosting(true)
    setError(null)
    try {
      const body: unknown = await api.request("POST /chat/{chatId}/messages", {
        chatId,
        id: crypto.randomUUID(),
        content,
        ...(replyingTo ? { replyToMessageId: replyingTo.id } : {}),
        ...(annotations.length > 0 ? { annotations: [...annotations] } : {}),
      })
      const message =
        isRecord(body) && isGroupMessage(body.message) ? body.message : null
      if (!message) {
        throw new Error("The group could not receive your message.")
      }
      setChat((current) => ({
        ...current,
        messages: addGroupMessage(current.messages, message),
      }))
      setReplyingTo(null)
      setAnnotations([])
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
      const state: unknown = await api.request("POST /chat/{chatId}/stop", {
        chatId,
      })
      if (!isGroupChatState(state)) {
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
        annotations,
        error,
        clearError: () => setError(null),
        replyTo: setReplyingTo,
        addAnnotation: (message, excerpt) =>
          setAnnotations((current) =>
            addGroupMessageAnnotation(current, {
              messageId: message.id,
              excerpt,
            })
          ),
        removeAnnotation: (annotation) =>
          setAnnotations((current) =>
            current.filter(
              ({ messageId, excerpt }) =>
                messageId !== annotation.messageId ||
                excerpt !== annotation.excerpt
            )
          ),
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
