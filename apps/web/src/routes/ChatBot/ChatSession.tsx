import { useChat, type UseChatHelpers } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
} from "react"

import { chatTransport } from "./chatTransport"

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
  const resumedChatId = useRef<string | null>(null)
  const session = useChat({
    id: chatId,
    messages: initialMessages,
    transport: chatTransport,
  })

  useEffect(() => {
    if (!resume || resumedChatId.current === chatId) return
    resumedChatId.current = chatId
    void session.resumeStream()
  }, [chatId, resume, session.resumeStream])

  return (
    <ChatSessionContext.Provider value={session}>
      {children}
    </ChatSessionContext.Provider>
  )
}
