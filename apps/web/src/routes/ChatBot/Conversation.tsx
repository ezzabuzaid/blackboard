import {
  Bubble,
  BubbleContent,
  BubbleGroup,
  Marker,
  MarkerContent,
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
import type { UIMessage } from "ai"
import { useMemo } from "react"
import { Streamdown } from "streamdown"

import { AgentTrajectory } from "./AgentTrajectory"
import { useChatSession } from "./ChatSession"
import { artifactBaseUrl, artifactRemarkPlugins } from "./artifactLinks"
import {
  GroupAvatar,
  GroupAvatarStack,
  groupMemberNameClass,
} from "./GroupAvatar"
import {
  groupReplies,
  groupReplyClusters,
  type GroupMessageCluster,
} from "./groupMessages"

export function Conversation() {
  const { id: chatId, messages, status } = useChatSession()
  const latestMessage = messages.at(-1)
  const pending = status === "submitted" || status === "streaming"
  const waitingForAssistant = pending && latestMessage?.role === "user"

  return (
    <section aria-label="Conversation" className="min-h-0 flex-1 bg-muted/60">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={status === "streaming"}
              className="mx-auto w-full max-w-3xl justify-end gap-3 px-3 py-4 sm:px-5 sm:py-6"
            >
              {messages.length === 0 && (
                <MessageScrollerItem>
                  <WelcomeMessage />
                </MessageScrollerItem>
              )}

              {messages
                .filter((message) => message.parts.length > 0)
                .map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    className="animate-in duration-300 fade-in slide-in-from-bottom-2"
                  >
                    <ConversationMessage
                      active={
                        status === "streaming" &&
                        message.id === latestMessage?.id
                      }
                      chatId={chatId}
                      message={message}
                    />
                  </MessageScrollerItem>
                ))}

              {waitingForAssistant && (
                <MessageScrollerItem>
                  <Marker
                    role="status"
                    className="animate-in gap-3 duration-200 fade-in"
                  >
                    <GroupAvatarStack />
                    <MarkerContent>
                      The group is considering your message
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  )
}

function ConversationMessage({
  active,
  chatId,
  message,
}: {
  active: boolean
  chatId: string
  message: UIMessage
}) {
  const replies = groupReplies(message)
  if (replies.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {groupReplyClusters(replies).map((cluster) => (
          <GroupReplyCluster
            chatId={chatId}
            cluster={cluster}
            key={cluster.messages[0].id}
          />
        ))}
      </div>
    )
  }

  return (
    <Message align={message.role === "user" ? "end" : "start"}>
      <MessageContent>
        {message.role === "assistant" && (
          <>
            <MessageHeader>DeepAgents Group</MessageHeader>
            <AgentTrajectory active={active} parts={message.parts} />
          </>
        )}
        <Bubble variant={message.role === "user" ? "tinted" : "ghost"}>
          <BubbleContent
            className={
              message.role === "user"
                ? "relative !overflow-visible rounded-[8px] rounded-tr-none px-[9px] py-1.5 text-sm leading-5 whitespace-pre-wrap before:absolute before:top-0 before:-right-2 before:size-2 before:bg-inherit before:[clip-path:polygon(0_0,100%_0,0_100%)] before:content-['']"
                : "max-w-[65ch] text-base leading-tight"
            }
          >
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                message.role === "assistant" ? (
                  <AssistantMarkdown
                    active={active}
                    chatId={chatId}
                    key={`${message.id}-${index}`}
                    text={part.text}
                  />
                ) : (
                  <p key={`${message.id}-${index}`}>{part.text}</p>
                )
              ) : null
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function GroupReplyCluster({
  chatId,
  cluster,
}: {
  chatId: string
  cluster: GroupMessageCluster
}) {
  return (
    <Message
      className="items-end gap-2"
      aria-label={`${cluster.author} messages`}
    >
      <GroupAvatar name={cluster.author} className="mb-0.5" />
      <BubbleGroup className="w-full gap-0.5">
        {cluster.messages.map((message, index) => (
          <Bubble variant="outline" key={message.id}>
            <BubbleContent
              className={`relative max-w-[65ch] !overflow-visible !border-transparent !bg-card rounded-[8px] px-[9px] py-1.5 text-sm leading-5 ${
                index === 0
                  ? "rounded-tl-none before:absolute before:top-0 before:-left-2 before:size-2 before:bg-inherit before:[clip-path:polygon(100%_0,100%_100%,0_0)] before:content-['']"
                  : ""
              }`}
            >
              {index === 0 && (
                <MessageHeader
                  className={`px-0 text-[13px] leading-[22px] font-medium ${groupMemberNameClass(
                    cluster.author
                  )}`}
                >
                  {cluster.author}
                </MessageHeader>
              )}
              <AssistantMarkdown
                active={false}
                chatId={chatId}
                text={message.content}
              />
            </BubbleContent>
          </Bubble>
        ))}
      </BubbleGroup>
    </Message>
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
      linkSafety={linkSafety}
      mode={active ? "streaming" : "static"}
      remarkPlugins={remarkPlugins}
    >
      {text}
    </Streamdown>
  )
}

function WelcomeMessage() {
  return (
    <Message className="items-start gap-3 max-sm:flex-col">
      <GroupAvatarStack className="mt-1 max-sm:mt-0" />
      <MessageContent className="gap-1">
        <MessageHeader className="text-foreground">
          DeepAgents Group
        </MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="max-w-[65ch] text-base leading-relaxed whitespace-pre-wrap">
            Message the group. Specialists reply only when they have something
            useful to add.
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
