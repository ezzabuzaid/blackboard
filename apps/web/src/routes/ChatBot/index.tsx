import { useLoaderData } from "react-router"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { ChatSessionProvider } from "./ChatSession"
import { Conversation } from "./Conversation"
import { loader } from "./loader"
import { QueuedTurnsOverlay } from "./QueuedTurnsOverlay"

export { loader }

export default function ChatBot() {
  const { chatId, initialMessages, resume } =
    useLoaderData<typeof loader>()

  return (
    <ChatSessionProvider
      chatId={chatId}
      initialMessages={initialMessages}
      resume={resume}
    >
      <main className="relative flex h-svh flex-col bg-background">
        <ChatHeader />
        <QueuedTurnsOverlay />
        <Conversation />
        <ChatComposer />
      </main>
    </ChatSessionProvider>
  )
}
