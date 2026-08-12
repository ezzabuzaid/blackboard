import {
  Avatar,
  AvatarFallback,
  Button,
  Input,
  ScrollArea,
} from "@stdlib/shadcn"
import { BellRing, MessageSquarePlus, Pin, Search, Square } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useLoaderData } from "react-router"

import { api } from "./api"
import { ChatComposer } from "./ChatComposer"
import { Conversation } from "./Conversation"
import { GroupAvatarStack } from "./GroupAvatar"
import { GroupChatProvider, useGroupChat } from "./GroupChat"
import { GroupRowMenu } from "./GroupRowMenu"
import { loader } from "./loader"
import { ShareGroupDialog } from "./ShareGroupDialog"
import {
  AgentTraceProvider,
  AgentTraceSidebar,
} from "./traces/AgentTraceSidebar"

export { loader }

export default function ChatBot() {
  const { apiStatus, chatId, initialState, streamPath } =
    useLoaderData<typeof loader>()

  return (
    <GroupChatProvider
      key={chatId}
      apiStatus={apiStatus}
      chatId={chatId}
      initialState={initialState}
      streamPath={streamPath}
    >
      <AgentTraceProvider>
        <main className="relative flex h-svh bg-background">
          <GroupReadReceipt />
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
  agentIds: readonly string[]
  preview: string
  time: string
  initials: string
  unread: number
  active: boolean
  pinned: boolean
  sortAt: number
}

const groupTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

function GroupList() {
  const [query, setQuery] = useState("")
  const groups = useData(query)

  return (
    <>
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
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-10 rounded-full border-transparent bg-muted pr-4 pl-10 shadow-none"
          />
        </div>
      </div>
      <NotificationBanner />
      <ScrollArea className="min-h-0 flex-1">
        <div
          role="list"
          aria-label="Groups"
          className="w-0 min-w-full px-2 pb-3"
        >
          {groups.map((group) => (
            <GroupListItem key={group.id} group={group} />
          ))}
          {groups.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No groups found
            </p>
          )}
        </div>
      </ScrollArea>
    </>
  )
}

function useData(query: string): readonly GroupPreview[] {
  const { chatId, groups } = useLoaderData<typeof loader>()
  const { activity, messages, participants } = useGroupChat()
  const latestMessage = messages.at(-1)
  const activePreview = latestMessage
    ? `${latestMessage.author === "user" ? "You" : latestMessage.author}: ${latestMessage.content}`
    : activity.phase === "active"
      ? "Agents are working…"
      : participants.length > 0
        ? participants.map(({ name }) => name).join(", ")
        : "No agents yet"
  const activeGroup = groups.find(({ id }) => id === chatId)
  const records = activeGroup
    ? groups
    : [
        {
          id: chatId,
          name: "New group",
          agentIds: [],
          createdAt: new Date(0).toISOString(),
          lastMessage: null,
          unreadCount: 0,
          pinned: false,
        },
        ...groups,
      ]
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return records
    .map((group): GroupPreview => {
      const active = group.id === chatId
      const message =
        active && latestMessage ? latestMessage : group.lastMessage
      return {
        id: group.id,
        name: group.name,
        agentIds: group.agentIds,
        preview: active
          ? activePreview
          : message
            ? `${message.author === "user" ? "You" : message.author}: ${message.content}`
            : group.agentIds.length > 0
              ? `${group.agentIds.length} agents`
              : "No messages yet",
        time: message ? groupTime.format(new Date(message.sentAt)) : "",
        initials: groupInitials(group.name),
        unread: active ? 0 : group.unreadCount,
        active,
        pinned: group.pinned,
        sortAt: Date.parse(message?.sentAt ?? group.createdAt),
      }
    })
    .filter(({ name }) => name.toLocaleLowerCase().includes(normalizedQuery))
    .toSorted(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) || right.sortAt - left.sortAt
    )
}

function GroupListItem({ group }: { group: GroupPreview }) {
  return (
    <div role="listitem" className="group/row relative">
      <Link
        to={`/?${new URLSearchParams({ chatId: group.id })}`}
        aria-current={group.active ? "page" : undefined}
        className={`flex min-h-18 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-primary ${
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
            {group.pinned && (
              <Pin
                aria-label="Pinned"
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
            {group.unread > 0 && (
              <span
                aria-label={`${group.unread} unread messages`}
                className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] leading-5 font-semibold text-primary-foreground"
              >
                {group.unread}
              </span>
            )}
            <span className="w-6 shrink-0" aria-hidden="true" />
          </div>
        </div>
      </Link>
      <div className="absolute end-3 bottom-4">
        <GroupRowMenu
          groupId={group.id}
          name={group.name}
          agentIds={group.agentIds}
          pinned={group.pinned}
          active={group.active}
        />
      </div>
    </div>
  )
}

function GroupReadReceipt() {
  const { chatId, messages } = useGroupChat()
  const { groups } = useLoaderData<typeof loader>()
  const latestMessageId = messages.at(-1)?.id

  useEffect(() => {
    if (!groups.some(({ id }) => id === chatId)) return
    void api
      .request("POST /groups/{groupId}/read", { groupId: chatId })
      .catch(() => undefined)
  }, [chatId, groups, latestMessageId])

  return null
}

function groupInitials(name: string) {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase()
}

function GroupHeader() {
  const { apiStatus, activity, participants, stop, stopping } = useGroupChat()
  const { chatId, groups } = useLoaderData<typeof loader>()
  const name = groups.find(({ id }) => id === chatId)?.name ?? "New group"

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 sm:px-5">
      <GroupAvatarStack members={participants.map(({ name }) => name)} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{name}</h1>
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
      <ShareGroupDialog groupId={chatId} />
    </header>
  )
}
