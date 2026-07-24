import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { createContext, type PropsWithChildren, useContext } from "react"

export const apiUrl = import.meta.env?.VITE_API_URL ?? "http://localhost:3001"

const transport = new DefaultChatTransport({ api: `${apiUrl}/api/chat` })

type ChatSession = ReturnType<typeof useChat>

const ChatSessionContext = createContext<ChatSession | null>(null)

export function useChatSession() {
  const session = useContext(ChatSessionContext)
  if (!session) throw new Error("Chat session is missing")
  return session
}

export function ChatSessionProvider({ children }: PropsWithChildren) {
  const session = useChat({ transport })

  return (
    <ChatSessionContext.Provider value={session}>
      {children}
    </ChatSessionContext.Provider>
  )
}
