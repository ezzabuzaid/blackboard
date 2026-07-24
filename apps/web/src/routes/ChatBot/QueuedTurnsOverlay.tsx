import { useEffect, useState } from "react"

import {
  Alert,
  AlertDescription,
  Badge,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  ScrollArea,
  Separator,
} from "@stdlib/shadcn"
import { InfoOverlay } from "../../components/InfoOverlay"
import { CircleAlert, ListTodo } from "lucide-react"

import { useChatSession } from "./ChatSession"
import { apiUrl } from "./chatTransport"

interface QueuedTurn {
  id: string
  kind: "ask" | "continuation" | "mailbox"
  input: string | null
}

export function QueuedTurnsOverlay() {
  const { id: chatId } = useChatSession()
  const [turns, setTurns] = useState<QueuedTurn[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout>

    async function refresh() {
      try {
        const response = await fetch(
          `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/turns`,
          { signal: controller.signal }
        )
        const body: unknown = await response.json()
        if (!response.ok || !isQueuedTurnsResponse(body)) {
          throw new Error("Invalid queue response")
        }
        setTurns(body.turns)
        setError(false)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) {
          timeout = setTimeout(refresh, 500)
        }
      }
    }

    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [chatId])

  return (
    <InfoOverlay
      open
      aria-label="Queued turns"
      className="top-20 max-h-[calc(100%-6rem)]"
    >
      <div
        id="queued-turns-overlay"
        className="flex items-start justify-between gap-3 p-4"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-sm font-semibold">Queued turns</h2>
            <Badge variant="secondary">{turns.length}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Follow-up work waiting for this chat.
          </p>
        </div>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>Could not load the queue.</AlertDescription>
            </Alert>
          ) : turns.length === 0 ? (
            <Empty className="border py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListTodo />
                </EmptyMedia>
                <EmptyTitle>Nothing queued</EmptyTitle>
                <EmptyDescription>
                  Follow-up tasks will appear here while the current turn runs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {turns.map((turn) => (
                <Item key={turn.id} variant="muted" size="sm">
                  <ItemMedia variant="icon">
                    <ListTodo />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{turnTitle(turn)}</ItemTitle>
                    {turn.input && (
                      <ItemDescription className="line-clamp-none break-words whitespace-pre-wrap">
                        {turn.input.replace(/^Self-scheduled task:\n/, "")}
                      </ItemDescription>
                    )}
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">Queued</Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      </ScrollArea>
    </InfoOverlay>
  )
}

function turnTitle(turn: QueuedTurn) {
  if (turn.kind === "continuation") return "Resume paused turn"
  if (turn.kind === "mailbox") return "Process agent message"
  return "Next turn"
}

function isQueuedTurnsResponse(
  value: unknown
): value is { turns: QueuedTurn[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "turns" in value &&
    Array.isArray(value.turns) &&
    value.turns.every(
      (turn) =>
        typeof turn === "object" &&
        turn !== null &&
        "id" in turn &&
        typeof turn.id === "string" &&
        "kind" in turn &&
        (turn.kind === "ask" ||
          turn.kind === "continuation" ||
          turn.kind === "mailbox") &&
        "input" in turn &&
        (typeof turn.input === "string" || turn.input === null)
    )
  )
}
