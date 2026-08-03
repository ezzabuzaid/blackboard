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
import { CornerUpLeft } from "lucide-react"
import { useMemo } from "react"
import { Streamdown } from "streamdown"

import { artifactBaseUrl, artifactRemarkPlugins } from "./artifactLinks"
import {
  GroupAvatar,
  GroupAvatarStack,
  groupMemberNameClass,
} from "./GroupAvatar"
import { useGroupChat } from "./GroupChat"
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
  const { apiStatus, activity, chatId, messages, participants, replyTo } =
    useGroupChat()
  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  )

  return (
    <section aria-label="Conversation" className="min-h-0 flex-1 bg-muted/60">
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
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  )
}

interface MessageClusterProps {
  cluster: GroupMessageCluster
  messagesById: ReadonlyMap<string, GroupMessage>
  onReply(message: GroupMessage): void
}

function UserMessageCluster({
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
                <p dir="auto" className="text-start [unicode-bidi:plaintext]">
                  {message.content}
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

function GroupReplyCluster({
  chatId,
  cluster,
  messagesById,
  onReply,
}: MessageClusterProps & {
  chatId: string
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
              <div dir="auto" className="text-start [unicode-bidi:plaintext]">
                <AssistantMarkdown
                  active={false}
                  chatId={chatId}
                  text={message.content}
                />
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
  onReply(message: GroupMessage): void
}) {
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

function ReplyQuote({ message }: { message?: GroupMessage }) {
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
        {message.content}
      </p>
    </div>
  )
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
  chatId: string
  text: string
}

export function AssistantMarkdown({
  active,
  chatId,
  text,
}: AssistantMarkdownProps) {
  const remarkPlugins = useMemo(() => artifactRemarkPlugins(chatId), [chatId])
  const trustedArtifactBaseUrl = artifactBaseUrl(chatId)
  const linkSafety = useMemo(
    () => ({
      enabled: true,
      onLinkCheck: (url: string) => url.startsWith(trustedArtifactBaseUrl),
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
