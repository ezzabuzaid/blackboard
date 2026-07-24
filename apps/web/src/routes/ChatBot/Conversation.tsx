import { Bubble, BubbleContent } from "@workspace/ui/components/bubble"
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@workspace/ui/components/marker"
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@workspace/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { Spinner } from "@workspace/ui/components/spinner"
import { Streamdown } from "streamdown"

import { useChatSession } from "./ChatSession"

export function Conversation() {
  const { messages, status } = useChatSession()
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

              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                  className="animate-in duration-300 fade-in slide-in-from-bottom-2"
                >
                  <Message align={message.role === "user" ? "end" : "start"}>
                    <MessageContent>
                      {message.role === "assistant" && (
                        <MessageHeader>Assistant</MessageHeader>
                      )}
                      <Bubble
                        variant={message.role === "user" ? "default" : "ghost"}
                      >
                        <BubbleContent
                          className={
                            message.role === "user"
                              ? "whitespace-pre-wrap"
                              : undefined
                          }
                        >
                          {message.parts.map((part, index) =>
                            part.type === "text" ? (
                              message.role === "assistant" ? (
                                <Streamdown
                                  key={`${message.id}-${index}`}
                                  mode={
                                    status === "streaming" &&
                                    message.id === latestMessage?.id
                                      ? "streaming"
                                      : "static"
                                  }
                                >
                                  {part.text}
                                </Streamdown>
                              ) : (
                                <p key={`${message.id}-${index}`}>
                                  {part.text}
                                </p>
                              )
                            ) : null
                          )}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
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

function WelcomeMessage() {
  return (
    <Message>
      <MessageContent>
        <MessageHeader>Assistant</MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="whitespace-pre-wrap">
            Ask me anything. I’m running locally with DeepAgents.
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
