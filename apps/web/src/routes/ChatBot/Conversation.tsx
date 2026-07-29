import {
  Bubble,
  BubbleContent,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  Spinner,
} from "@stdlib/shadcn"
import type { UIMessage } from "ai"
import { useMemo } from "react"
import { Streamdown } from "streamdown"

import { AgentTrajectory } from "./AgentTrajectory"
import { useChatSession } from "./ChatSession"
import { artifactBaseUrl, artifactRemarkPlugins } from "./artifactLinks"
import { groupReplies, type GroupMessage } from "./groupMessages"

export function Conversation() {
  const { id: chatId, messages, status } = useChatSession()
  const latestMessage = messages.at(-1)
  const pending = status === "submitted" || status === "streaming"
  const waitingForAssistant = pending && latestMessage?.role === "user"

  return (
    <section aria-label="Conversation" className="min-h-0 flex-1">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={status === "streaming"}
              className="mx-auto w-full max-w-3xl justify-end gap-8 px-5 py-10"
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
                    scrollAnchor={message.role === "user"}
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
                    className="animate-in duration-200 fade-in"
                  >
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>Thinking</MarkerContent>
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
      <div className="flex flex-col gap-6">
        {replies.map((reply) => (
          <GroupReply chatId={chatId} key={reply.id} message={reply} />
        ))}
      </div>
    )
  }

  return (
    <Message align={message.role === "user" ? "end" : "start"}>
      <MessageContent>
        {message.role === "assistant" && (
          <>
            <MessageHeader>Assistant</MessageHeader>
            <AgentTrajectory active={active} parts={message.parts} />
          </>
        )}
        <Bubble variant={message.role === "user" ? "default" : "ghost"}>
          <BubbleContent
            className={
              message.role === "user"
                ? "whitespace-pre-wrap"
                : "max-w-[65ch] text-base leading-relaxed"
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

function GroupReply({
  chatId,
  message,
}: {
  chatId: string
  message: GroupMessage
}) {
  return (
    <Message>
      <MessageContent>
        <MessageHeader>{message.author}</MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="max-w-[65ch] text-base leading-relaxed">
            <AssistantMarkdown
              active={false}
              chatId={chatId}
              text={message.content}
            />
          </BubbleContent>
        </Bubble>
      </MessageContent>
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
    <Message>
      <MessageContent>
        <MessageHeader>Assistant</MessageHeader>
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
