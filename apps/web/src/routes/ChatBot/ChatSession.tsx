import { useChat, type UseChatHelpers } from "@ai-sdk/react"
import {
  getToolName,
  isToolUIPart,
  safeValidateUIMessages,
  type UIMessage,
} from "ai"
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react"

import { apiUrl, chatTransport } from "./chatTransport"

type ChatSession = UseChatHelpers<UIMessage>

const ChatSessionContext = createContext<ChatSession | null>(null)

export function useChatSession() {
  const session = useContext(ChatSessionContext)
  if (!session) throw new Error("Chat session is missing")
  return session
}

interface ChatSessionProviderProps extends PropsWithChildren {
  chatId: string
  initialMessages: UIMessage[]
  resume: boolean
}

export function ChatSessionProvider({
  chatId,
  initialMessages,
  resume,
  children,
}: ChatSessionProviderProps) {
  const [shouldResume, setShouldResume] = useState(resume)
  const [scheduledStreamId, setScheduledStreamId] = useState<string | null>(
    null
  )
  const session = useChat({
    id: chatId,
    messages: initialMessages,
    transport: chatTransport,
    resume: shouldResume,
    onFinish: ({ message, isAbort, isError }) => {
      setShouldResume(false)
      if (!isAbort && !isError) {
        setScheduledStreamId(scheduledTurnId(message))
      }
    },
  })

  useEffect(() => {
    setShouldResume(resume)
    setScheduledStreamId(null)
  }, [chatId, resume])

  useEffect(() => {
    if (!scheduledStreamId) return

    const controller = new AbortController()
    void waitForStream(chatId, scheduledStreamId, controller.signal).then(
      (next) => {
        if (!next || controller.signal.aborted) return
        session.setMessages(next.messages)
        setScheduledStreamId(null)
        setShouldResume(true)
      }
    )
    return () => controller.abort()
  }, [chatId, scheduledStreamId, session.setMessages])

  return (
    <ChatSessionContext.Provider value={session}>
      {children}
    </ChatSessionContext.Provider>
  )
}

export function scheduledTurnId(message: UIMessage) {
  for (const part of message.parts) {
    if (
      !isToolUIPart(part) ||
      getToolName(part) !== "schedule_task" ||
      part.state !== "output-available"
    ) {
      continue
    }
    if (
      typeof part.output === "object" &&
      part.output !== null &&
      "turnId" in part.output &&
      typeof part.output.turnId === "string"
    ) {
      return part.output.turnId
    }
  }
  return null
}

export async function waitForStream(
  chatId: string,
  streamId: string,
  signal: AbortSignal
) {
  while (!signal.aborted) {
    try {
      const response = await fetch(
        `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/state`,
        { signal }
      )
      const state: unknown = await response.json()
      const messages =
        response.ok &&
        typeof state === "object" &&
        state !== null &&
        "streamId" in state &&
        state.streamId === streamId &&
        "messages" in state &&
        Array.isArray(state.messages)
          ? await safeValidateUIMessages({ messages: state.messages })
          : null
      if (messages?.success) {
        return { streamId, messages: messages.data }
      }
    } catch {
      if (signal.aborted) return null
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}
