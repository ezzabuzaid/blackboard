import { useLoaderData } from "react-router"

import { ChatComposer } from "./ChatComposer"
import { ChatSessionProvider } from "./ChatSession"
import { Conversation } from "./Conversation"
import { GroupActivityOverlay } from "./GroupActivityOverlay"
import { loader } from "./loader"

export { loader }

export default function ChatBot() {
  const { chatId, initialMessages, resume } = useLoaderData<typeof loader>()

  return (
    <ChatSessionProvider
      chatId={chatId}
      initialMessages={initialMessages}
      resume={resume}
    >
      <main className="relative flex h-svh flex-col bg-background">
        <GroupActivityOverlay />
        <Conversation />
        <ChatComposer />
      </main>
    </ChatSessionProvider>
  )
}
