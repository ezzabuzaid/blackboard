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
import { useMemo } from "react"
import { Streamdown } from "streamdown"

import { artifactBaseUrl, artifactRemarkPlugins } from "./artifactLinks"
import {
  GroupAvatar,
  GroupAvatarStack,
  groupMemberNameClass,
} from "./GroupAvatar"
import { useGroupChat } from "./GroupChat"
import { groupMessageClusters, type GroupMessageCluster } from "./groupMessages"

export function Conversation() {
  const { activity, chatId, messages } = useGroupChat()

  return (
    <section aria-label="Conversation" className="min-h-0 flex-1 bg-muted/60">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent
              aria-busy={activity.phase === "active"}
              className="mx-auto w-full max-w-3xl justify-end gap-3 px-3 py-4 sm:px-5 sm:py-6"
            >
              {messages.length === 0 && (
                <MessageScrollerItem>
                  <WelcomeMessage />
                </MessageScrollerItem>
              )}

              {groupMessageClusters(messages).map((cluster) => (
                <MessageScrollerItem
                  key={cluster.messages[0].id}
                  messageId={cluster.messages[0].id}
                  className="animate-in duration-300 fade-in slide-in-from-bottom-2"
                >
                  {cluster.author === "user" ? (
                    <UserMessageCluster cluster={cluster} />
                  ) : (
                    <GroupReplyCluster chatId={chatId} cluster={cluster} />
                  )}
                </MessageScrollerItem>
              ))}

              {activity.phase === "active" && (
                <MessageScrollerItem>
                  <Marker
                    role="status"
                    className="animate-in gap-3 duration-200 fade-in"
                  >
                    <GroupAvatarStack />
                    <MarkerContent>
                      The group is considering new messages
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

function UserMessageCluster({ cluster }: { cluster: GroupMessageCluster }) {
  return (
    <Message align="end" aria-label="Your messages">
      <MessageContent>
        <BubbleGroup className="items-end gap-0.5">
          {cluster.messages.map((message, index) => (
            <Bubble variant="tinted" key={message.id}>
              <BubbleContent
                className={`relative max-w-[65ch] min-w-12 !overflow-visible rounded-[8px] px-[9px] py-1.5 text-sm leading-5 whitespace-pre-wrap ${
                  index === 0
                    ? "rounded-tr-none before:absolute before:top-0 before:-right-2 before:size-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(0_0,100%_0,0_100%)]"
                    : ""
                }`}
              >
                {message.content}
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
              className={`relative max-w-[65ch] !overflow-visible rounded-[8px] !border-transparent !bg-card px-[9px] py-1.5 text-sm leading-5 ${
                index === 0
                  ? "rounded-tl-none before:absolute before:top-0 before:-left-2 before:size-2 before:bg-inherit before:content-[''] before:[clip-path:polygon(100%_0,100%_100%,0_0)]"
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
