import {
  Badge,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Separator,
} from "@stdlib/shadcn"
import {
  BellRing,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  MinusCircle,
} from "lucide-react"

import { InfoOverlay } from "../../components/InfoOverlay"
import { useChatSession } from "./ChatSession"
import { GroupAvatar } from "./GroupAvatar"
import type { ParticipantActivityState } from "./groupActivity"

export function GroupActivityOverlay() {
  const { groupActivity } = useChatSession()
  const settled = groupActivity.phase === "settled"

  return (
    <InfoOverlay
      open={groupActivity.phase !== "idle"}
      aria-label="Group activity"
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Group activity</h2>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {activitySummary(groupActivity)}
          </p>
        </div>
        <Badge variant={settled ? "secondary" : "default"}>
          {settled ? "Settled" : "Live"}
        </Badge>
      </div>
      <Separator />
      <ItemGroup className="gap-2 p-3">
        {groupActivity.participants.map((participant) => (
          <Item key={participant.name} variant="muted" size="sm">
            <ItemMedia>
              <GroupAvatar name={participant.name} size="sm" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="capitalize">{participant.name}</ItemTitle>
              <ItemDescription>{stateLabel(participant.state)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ActivityIcon state={participant.state} />
              <Badge variant="outline">
                {participant.replies}{" "}
                {participant.replies === 1 ? "reply" : "replies"}
              </Badge>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <Separator />
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Private reasoning is not shown.
      </p>
    </InfoOverlay>
  )
}

function activitySummary({
  phase,
  notification,
  messageCount,
}: ReturnType<typeof useChatSession>["groupActivity"]) {
  if (phase === "settled") {
    return `Everyone is caught up with ${notification} ${
      notification === 1 ? "update" : "updates"
    }`
  }
  if (notification === 0) return "Starting the group…"
  return `Update ${notification}: ${messageCount} new ${
    messageCount === 1 ? "message" : "messages"
  }`
}

function stateLabel(state: ParticipantActivityState) {
  if (state === "caught-up") return "Caught up"
  if (state === "considering") return "Considering"
  if (state === "replied") return "Replied"
  if (state === "passed") return "Passed this update"
  if (state === "failed") return "Failed"
  return "Notified"
}

function ActivityIcon({ state }: { state: ParticipantActivityState }) {
  if (state === "caught-up")
    return <CheckCircle2 className="text-emerald-600" />
  if (state === "considering")
    return <LoaderCircle className="motion-safe:animate-spin" />
  if (state === "replied") return <MessageCircle />
  if (state === "passed") return <MinusCircle />
  if (state === "failed") return <CircleAlert className="text-destructive" />
  return <BellRing />
}
