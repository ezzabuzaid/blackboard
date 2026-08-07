import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@stdlib/shadcn"
import { MessageCircle } from "lucide-react"
import { useMemo } from "react"
import { useLoaderData } from "react-router"

import {
  GroupReplyCluster,
  UserMessageCluster,
} from "../ChatBot/Conversation"
import { GroupAvatarStack } from "../ChatBot/GroupAvatar"
import { groupMessageClusters } from "../ChatBot/groupMessages"
import type { loader } from "./loader"

export { loader } from "./loader"

export default function Share() {
  const { shared } = useLoaderData<typeof loader>()
  const messagesById = useMemo(
    () => new Map((shared?.messages ?? []).map((message) => [message.id, message])),
    [shared]
  )

  if (!shared) return <UnavailableShare />

  const participants = shared.participants.map(({ name }) => name)

  return (
    <main className="flex h-svh flex-col bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-3 py-3 sm:px-5">
          <GroupAvatarStack members={participants} />
          <div className="min-w-0 flex-1">
            <h1
              dir="auto"
              className="truncate text-sm font-medium [unicode-bidi:plaintext]"
            >
              {shared.name}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {participants.length > 0
                ? `Shared read-only conversation with ${participants.join(", ")}`
                : "Shared read-only conversation"}
            </p>
          </div>
        </div>
      </header>

      <section
        aria-label="Shared conversation"
        className="min-h-0 flex-1 bg-muted/60"
      >
        <MessageScrollerProvider>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end gap-2 px-3 py-4 sm:px-5 sm:py-6">
                {shared.messages.length === 0 && (
                  <MessageScrollerItem>
                    <p className="mx-auto max-w-[65ch] py-8 text-center text-sm text-muted-foreground">
                      This conversation has no messages yet.
                    </p>
                  </MessageScrollerItem>
                )}

                {groupMessageClusters(shared.messages).map((cluster) => (
                  <MessageScrollerItem
                    key={cluster.messages[0].id}
                    messageId={cluster.messages[0].id}
                  >
                    {cluster.author === "user" ? (
                      <UserMessageCluster
                        cluster={cluster}
                        messagesById={messagesById}
                      />
                    ) : (
                      <GroupReplyCluster
                        cluster={cluster}
                        messagesById={messagesById}
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

      <footer className="border-t border-border/60 bg-card">
        <p className="mx-auto w-full max-w-3xl px-3 py-2.5 text-center text-xs text-muted-foreground sm:px-5">
          Shared via Baseera · read-only
        </p>
      </footer>
    </main>
  )
}

function UnavailableShare() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <MessageCircle
          aria-hidden="true"
          className="size-8 text-muted-foreground"
        />
        <h1 className="text-base font-medium">
          This link is no longer available.
        </h1>
        <p className="text-sm text-muted-foreground">
          The conversation was unshared, or the link is incorrect.
        </p>
      </div>
    </main>
  )
}
