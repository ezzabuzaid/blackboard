import {
  Avatar,
  AvatarFallback,
  Button,
  Input,
  ScrollArea,
} from "@stdlib/shadcn"
import { BellRing, MessageSquarePlus, Search, Square } from "lucide-react"
import { Link, useLoaderData } from "react-router"

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
        <main className="relative flex h-svh bg-background">
          <GroupSidebar />
          <section className="relative flex min-w-0 flex-1 flex-col">
            <GroupHeader />
            <Conversation />
            <ChatComposer />
          </section>
          <AgentTraceSidebar />
        </main>
      </AgentTraceProvider>
    </GroupChatProvider>
  )
}

function GroupSidebar() {
  return (
    <aside className="hidden w-[clamp(20rem,30vw,27rem)] shrink-0 flex-col border-r bg-card md:flex">
      <SidebarHeader />
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search groups"
            placeholder="Search groups"
            className="h-10 rounded-full border-transparent bg-muted pr-4 pl-10 shadow-none"
          />
        </div>
      </div>
      <NotificationBanner />
      <GroupList />
    </aside>
  )
}

function SidebarHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-4">
      <h1 className="text-xl font-semibold tracking-tight">Baseera</h1>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="New group"
        asChild
      >
        <Link to="/groups/new">
          <MessageSquarePlus aria-hidden="true" />
        </Link>
      </Button>
    </header>
  )
}

function NotificationBanner() {
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-primary/10 px-3 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-background text-primary">
        <BellRing aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Get notified of group replies</p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto justify-start p-0 text-xs text-muted-foreground"
          onClick={() => void Notification.requestPermission()}
        >
          Turn on desktop notifications
        </Button>
      </div>
    </div>
  )
}

interface GroupPreview {
  id: string
  name: string
  preview: string
  time: string
  initials: string
  unread?: number
  active?: boolean
}

const placeholderGroups: readonly GroupPreview[] = [
  {
    id: "discovery-room",
    name: "Discovery Room",
    preview: "Evidence Analyst: Three interviews agree…",
    time: "9:40 PM",
    initials: "DR",
    unread: 3,
  },
  {
    id: "launch-planning",
    name: "Launch Planning",
    preview: "You: Review the launch brief",
    time: "Mon",
    initials: "LP",
  },
  {
    id: "customer-research",
    name: "Customer Research",
    preview: "Market Mapper: I found a new pattern…",
    time: "Sun",
    initials: "CR",
    unread: 8,
  },
]

const groupTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

function GroupList() {
  const groups = useData()

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div role="list" aria-label="Groups" className="px-2 pb-3">
        {groups.map((group) => (
          <GroupListItem key={group.id} group={group} />
        ))}
      </div>
    </ScrollArea>
  )
}

function useData(): readonly GroupPreview[] {
  const { activity, messages, participants } = useGroupChat()
  const latestMessage = messages.at(-1)
  const preview = latestMessage
    ? `${latestMessage.author === "user" ? "You" : latestMessage.author}: ${latestMessage.content}`
    : activity.phase === "active"
      ? "Agents are working…"
      : participants.length > 0
        ? participants.map(({ name }) => name).join(", ")
        : "No agents yet"

  return [
    {
      id: "baseera",
      name: "Baseera",
      preview,
      time: latestMessage
        ? groupTime.format(new Date(latestMessage.sentAt))
        : "",
      initials: "BA",
      active: true,
    },
    ...placeholderGroups,
  ]
}

function GroupListItem({ group }: { group: GroupPreview }) {
  return (
    <article
      role="listitem"
      aria-current={group.active ? "page" : undefined}
      className={`flex min-h-18 items-center gap-3 rounded-lg px-2 py-2.5 ${
        group.active ? "bg-accent" : ""
      }`}
    >
      <Avatar size="lg" className="shrink-0">
        <AvatarFallback className="bg-muted font-medium">
          {group.initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 border-b border-border/60 py-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {group.name}
          </h2>
          <time className="shrink-0 text-[11px] text-muted-foreground">
            {group.time}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {group.preview}
          </p>
          {group.unread && (
            <span
              aria-label={`${group.unread} unread messages`}
              className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] leading-5 font-semibold text-primary-foreground"
            >
              {group.unread}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function GroupHeader() {
  const { apiStatus, activity, participants, stop, stopping } = useGroupChat()

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
    </header>
  )
}
