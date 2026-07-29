import { useLoaderData } from "react-router"

import { ChatComposer } from "./ChatComposer"
import { Conversation } from "./Conversation"
import { GroupActivityOverlay } from "./GroupActivityOverlay"
import { GroupChatProvider } from "./GroupChat"
import { loader } from "./loader"

export { loader }

export default function ChatBot() {
  const { chatId, initialState } = useLoaderData<typeof loader>()

  return (
    <GroupChatProvider key={chatId} chatId={chatId} initialState={initialState}>
      <main className="relative flex h-svh flex-col bg-background">
        <GroupActivityOverlay />
        <Conversation />
        <ChatComposer />
      </main>
    </GroupChatProvider>
  )
}
