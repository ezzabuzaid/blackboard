import { Button } from "@stdlib/shadcn"
import { Plus, Square } from "lucide-react"
import { useLoaderData, useLocation, useNavigate } from "react-router"

import { ChatComposer } from "./ChatComposer"
import { Conversation } from "./Conversation"
import { GroupAvatarStack } from "./GroupAvatar"
import { GroupChatProvider, useGroupChat } from "./GroupChat"
import { loader } from "./loader"
import {
  AgentTraceProvider,
  AgentTraceSidebar,
} from "./traces/AgentTraceSidebar"

export { loader }

export default function ChatBot() {
  const { apiStatus, chatId, initialState } = useLoaderData<typeof loader>()

  return (
    <GroupChatProvider
      key={chatId}
      apiStatus={apiStatus}
      chatId={chatId}
      initialState={initialState}
    >
      <AgentTraceProvider>
        <main className="relative flex h-svh flex-col bg-background">
          <GroupHeader />
          <Conversation />
          <ChatComposer />
          <AgentTraceSidebar />
        </main>
      </AgentTraceProvider>
    </GroupChatProvider>
  )
}

function GroupHeader() {
  const { apiStatus, activity, participants, stop, stopping } = useGroupChat()
  const location = useLocation()
  const navigate = useNavigate()

  function newGroup() {
    const search = new URLSearchParams(location.search)
    search.set("chatId", crypto.randomUUID())
    void navigate(`${location.pathname}?${search}`)
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 sm:px-5">
      <GroupAvatarStack members={participants.map(({ name }) => name)} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">Baseera</h1>
        <p className="truncate text-xs text-muted-foreground">
          {apiStatus === "offline"
            ? "Group unavailable"
            : participants.map(({ name }) => name).join(", ") ||
              "No agents yet"}
        </p>
      </div>
      {activity.phase === "active" && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={stopping}
          onClick={() => void stop()}
        >
          <Square aria-hidden="true" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={newGroup}>
        <Plus aria-hidden="true" />
        New group
      </Button>
    </header>
  )
}
