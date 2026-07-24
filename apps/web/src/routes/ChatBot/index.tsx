import type { LoaderFunctionArgs } from "react-router"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { apiUrl, ChatSessionProvider } from "./ChatSession"
import { Conversation } from "./Conversation"

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      signal: request.signal,
    })
    return {
      apiStatus: response.ok ? ("ready" as const) : ("offline" as const),
    }
  } catch (error) {
    if (request.signal.aborted) throw error
    return { apiStatus: "offline" as const }
  }
}

export default function ChatBot() {
  return (
    <ChatSessionProvider>
      <main className="flex h-svh flex-col bg-background">
        <ChatHeader />
        <Conversation />
        <ChatComposer />
      </main>
    </ChatSessionProvider>
  )
}
