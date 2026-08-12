import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  Button,
  cn,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@stdlib/shadcn"
import { CornerUpLeft, MessageSquareQuote } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Streamdown } from "streamdown"

import { artifactBaseUrl, artifactRemarkPlugins } from "./artifactLinks"
import {
  GroupAvatar,
  GroupAvatarStack,
  groupMemberNameClass,
} from "./GroupAvatar"
import { useGroupChat } from "./GroupChat"
import { groupActivityIndicator } from "./groupActivity"
import {
  groupMessageClusters,
  type GroupMessage,
  type GroupMessageCluster,
} from "./groupMessages"

const messageTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

export function Conversation() {
  const {
    addAnnotation,
    apiStatus,
    activity,
    chatId,
    messages,
    participants,
    replyTo,
  } = useGroupChat()
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  )
  const activityIndicator = groupActivityIndicator(activity)
  const [selection, setSelection] = useState<{
    message: GroupMessage
    excerpt: string
    x: number
    y: number
    below: boolean
  } | null>(null)

  useEffect(() => {
    const update = () => setSelection(selectedMessageText(messagesById))
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [messagesById])

  return (
    <section
      aria-label="Conversation"
      className="min-h-0 flex-1 bg-muted/60"
      onScrollCapture={() => setSelection(null)}
    >
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={activity.phase === "active"}
              className="mx-auto w-full max-w-3xl justify-end gap-2 px-3 py-4 sm:px-5 sm:py-6"
            >
              {messages.length === 0 && (
                <MessageScrollerItem>
                  <WelcomeMessage
                    apiStatus={apiStatus}
                    participants={participants.map(({ name }) => name)}
                  />
                </MessageScrollerItem>
              )}

              {groupMessageClusters(messages).map((cluster) => (
                <MessageScrollerItem
                  key={cluster.messages[0].id}
                  messageId={cluster.messages[0].id}
                  className="animate-in duration-300 fade-in slide-in-from-bottom-2"
                >
                  {cluster.author === "user" ? (
                    <UserMessageCluster
                      cluster={cluster}
                      messagesById={messagesById}
                      onReply={replyTo}
                    />
                  ) : (
                    <GroupReplyCluster
                      chatId={chatId}
                      cluster={cluster}
                      messagesById={messagesById}
                      onReply={replyTo}
                    />
                  )}
                </MessageScrollerItem>
              ))}

              {activityIndicator && (
                <MessageScrollerItem className="animate-in duration-200 fade-in slide-in-from-bottom-1">
                  <GroupActivityIndicator {...activityIndicator} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {selection && (
        <Button
          type="button"
          size="sm"
          className="fixed z-50 h-8 -translate-x-1/2 gap-1.5 rounded-full px-3 shadow-lg"
          style={{
            left: selection.x,
            top: selection.below ? selection.y : undefined,
            bottom: selection.below
              ? undefined
              : globalThis.innerHeight - selection.y,
          }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            addAnnotation(selection.message, selection.excerpt)
            globalThis.getSelection()?.removeAllRanges()
            setSelection(null)
          }}
        >
          <MessageSquareQuote aria-hidden="true" />
          Add to chat
        </Button>
      )}
    </section>
  )
}

function GroupActivityIndicator({
  label,
  participants,
}: {
  label: string
  participants: readonly string[]
}) {
  return (
    <Message role="status" className="items-start gap-2">
      <GroupAvatarStack members={participants} className="mt-0.5" />
      <Bubble variant="outline">
        <BubbleContent className="relative flex h-8 items-center gap-1 !overflow-visible rounded-[8px] rounded-tl-none !border-transparent !bg-card px-3 before:absolute before:top-0 before:-left-2 before:size-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(100%_0,100%_100%,0_0)]">
          <span className="mr-1 text-xs text-muted-foreground">{label}</span>
          <span
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-300ms] motion-reduce:animate-none"
          />
          <span
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-150ms] motion-reduce:animate-none"
          />
          <span
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
          />
        </BubbleContent>
      </Bubble>
    </Message>
  )
}

interface MessageClusterProps {
  cluster: GroupMessageCluster
  messagesById: ReadonlyMap<string, GroupMessage>
  onReply?: (message: GroupMessage) => void
}

export function UserMessageCluster({
  cluster,
  messagesById,
  onReply,
}: MessageClusterProps) {
  return (
    <Message align="end" aria-label="Your messages">
      <MessageContent>
        <BubbleGroup className="items-end gap-0.5">
          {cluster.messages.map((message, index) => (
            <Bubble variant="tinted" key={message.id}>
              <ReplyButton message={message} align="end" onReply={onReply} />
              <BubbleContent
                className={`relative max-w-[65ch] min-w-12 !overflow-visible rounded-[8px] px-[9px] py-1.5 text-sm leading-5 whitespace-pre-wrap ${
                  index === 0
                    ? "rounded-tr-none before:absolute before:top-0 before:-right-2 before:size-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(0_0,100%_0,0_100%)]"
                    : ""
                }`}
              >
                <ReplyQuote
                  message={
                    message.replyToMessageId
                      ? messagesById.get(message.replyToMessageId)
                      : undefined
                  }
                />
                {message.annotations.map((annotation, index) => (
                  <ReplyQuote
                    key={`${annotation.messageId}:${index}`}
                    message={messagesById.get(annotation.messageId)}
                    excerpt={annotation.excerpt}
                  />
                ))}
                <p dir="auto" className="text-start [unicode-bidi:plaintext]">
                  <span data-annotation-message-id={message.id}>
                    {message.content}
                  </span>
                  <MessageTimestamp sentAt={message.sentAt} />
                </p>
              </BubbleContent>
            </Bubble>
          ))}
        </BubbleGroup>
      </MessageContent>
    </Message>
  )
}

export function GroupReplyCluster({
  chatId,
  cluster,
  messagesById,
  onReply,
}: MessageClusterProps & {
  chatId?: string
}) {
  return (
    <Message
      className="items-start gap-2"
      aria-label={`${cluster.author} messages`}
    >
      <GroupAvatar name={cluster.author} className="mt-0.5" />
      <BubbleGroup className="w-fit max-w-[85%] gap-0.5 sm:max-w-[75%]">
        {cluster.messages.map((message, index) => (
          <Bubble variant="outline" key={message.id}>
            <ReplyButton message={message} align="start" onReply={onReply} />
            <BubbleContent
              className={`relative max-w-[65ch] !overflow-visible rounded-[8px] !border-transparent !bg-card px-[9px] py-1.5 text-sm leading-5 ${
                index === 0
                  ? "rounded-tl-none before:absolute before:top-0 before:-left-2 before:size-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(100%_0,100%_100%,0_0)]"
                  : ""
              }`}
            >
              {index === 0 && (
                <MessageHeader
                  className={`px-0 text-[13px] leading-[22px] font-medium ${groupMemberNameClass}`}
                >
                  {cluster.author}
                </MessageHeader>
              )}
              <ReplyQuote
                message={
                  message.replyToMessageId
                    ? messagesById.get(message.replyToMessageId)
                    : undefined
                }
              />
              {message.annotations.map((annotation, index) => (
                <ReplyQuote
                  key={`${annotation.messageId}:${index}`}
                  message={messagesById.get(annotation.messageId)}
                  excerpt={annotation.excerpt}
                />
              ))}
              <div dir="auto" className="text-start [unicode-bidi:plaintext]">
                <div
                  className="contents"
                  data-annotation-message-id={message.id}
                >
                  <AssistantMarkdown
                    active={false}
                    chatId={chatId}
                    text={message.content}
                  />
                </div>
                <MessageTimestamp sentAt={message.sentAt} />
              </div>
            </BubbleContent>
          </Bubble>
        ))}
      </BubbleGroup>
    </Message>
  )
}

function ReplyButton({
  message,
  align,
  onReply,
}: {
  message: GroupMessage
  align: "start" | "end"
  onReply?: (message: GroupMessage) => void
}) {
  if (!onReply) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Reply to ${message.author === "user" ? "your message" : message.author}`}
      className={cn(
        "absolute z-10 text-muted-foreground opacity-60 sm:top-1/2 sm:-translate-y-1/2 sm:bg-transparent sm:opacity-0 sm:group-focus-within/bubble:opacity-100 sm:group-hover/bubble:opacity-100",
        align === "end"
          ? "top-1/2 -left-8 -translate-y-1/2"
          : "top-2 right-2 bg-card/90 sm:-right-8"
      )}
      onClick={() => onReply(message)}
    >
      <CornerUpLeft aria-hidden="true" />
    </Button>
  )
}

function ReplyQuote({
  message,
  excerpt,
}: {
  message?: GroupMessage
  excerpt?: string
}) {
  if (!message) return null
  return (
    <div className="mb-1.5 rounded-[6px] border-l-[3px] border-primary bg-muted/70 px-2 py-1">
      <p
        className={cn(
          "text-xs font-medium",
          message.author === "user" ? "text-primary" : groupMemberNameClass
        )}
      >
        {message.author === "user" ? "You" : message.author}
      </p>
      <p
        dir="auto"
        className="line-clamp-2 text-start text-xs text-muted-foreground [unicode-bidi:plaintext]"
      >
        {excerpt ?? message.content}
      </p>
    </div>
  )
}

function selectedMessageText(messagesById: ReadonlyMap<string, GroupMessage>) {
  const selection = globalThis.getSelection?.()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
    return null
  }

  const range = selection.getRangeAt(0)
  const start = annotationTarget(range.startContainer)
  const end = annotationTarget(range.endContainer)
  if (!start || start !== end) return null

  const message = messagesById.get(start.dataset.annotationMessageId ?? "")
  const excerpt = selection.toString().trim()
  if (!message || !excerpt) return null

  const bounds = range.getBoundingClientRect()
  const below = bounds.top < 48
  return {
    message,
    excerpt,
    x: Math.max(
      64,
      Math.min(globalThis.innerWidth - 64, bounds.left + bounds.width / 2)
    ),
    y: below ? bounds.bottom + 8 : bounds.top - 8,
    below,
  }
}

function annotationTarget(node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>("[data-annotation-message-id]") ?? null
}

function MessageTimestamp({ sentAt }: { sentAt: string }) {
  const date = new Date(sentAt)
  return (
    <time
      dir="ltr"
      dateTime={sentAt}
      title={date.toLocaleString()}
      className="ms-2 inline-block align-baseline text-[10px] leading-none whitespace-nowrap text-muted-foreground"
    >
      {messageTime.format(date)}
    </time>
  )
}

interface AssistantMarkdownProps {
  active: boolean
  chatId?: string
  text: string
}

export function AssistantMarkdown({
  active,
  chatId,
  text,
}: AssistantMarkdownProps) {
  const remarkPlugins = useMemo(
    () => (chatId ? artifactRemarkPlugins(chatId) : undefined),
    [chatId]
  )
  const trustedArtifactBaseUrl = chatId ? artifactBaseUrl(chatId) : null
  const linkSafety = useMemo(
    () => ({
      enabled: true,
      onLinkCheck: (url: string) =>
        trustedArtifactBaseUrl !== null &&
        url.startsWith(trustedArtifactBaseUrl),
    }),
    [trustedArtifactBaseUrl]
  )

  return (
    <Streamdown
      className="contents space-y-2 [&>p:last-child]:inline"
      linkSafety={linkSafety}
      mode={active ? "streaming" : "static"}
      remarkPlugins={remarkPlugins}
    >
      {text}
    </Streamdown>
  )
}

function WelcomeMessage({
  apiStatus,
  participants,
}: {
  apiStatus: "ready" | "offline"
  participants: readonly string[]
}) {
  return (
    <Message className="items-start gap-3 max-sm:flex-col">
      <GroupAvatarStack members={participants} className="mt-1 max-sm:mt-0" />
      <MessageContent className="gap-1">
        <MessageHeader className="text-foreground">Baseera</MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="max-w-[65ch] text-base leading-relaxed whitespace-pre-wrap">
            {apiStatus === "offline"
              ? "The group is unavailable. Try again when the API is online."
              : participants.length === 0
                ? "No agents yet. Add an agent folder with identity.json, SOUL.md, AGENTS.md, and MEMORY.md to start."
                : "Message the group. Specialists reply only when they have something useful to add."}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
