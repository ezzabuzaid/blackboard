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
import { useGroupChat } from "./GroupChat"
import type {
  GroupActivityState,
  ParticipantActivityState,
} from "./groupActivity"
import type { GroupParticipant } from "./groupMessages"

export function GroupActivityOverlay() {
  const { activity, participants } = useGroupChat()
  const settled = activity.phase === "settled"
  const stopped = activity.phase === "stopped"

  return (
    <InfoOverlay
      open={activity.phase !== "idle"}
      aria-label="Group activity"
      className="top-16 max-h-[calc(100%-4.75rem)]"
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Group activity</h2>
          <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
            {activitySummary(activity)}
          </p>
        </div>
        <Badge variant={settled || stopped ? "secondary" : "default"}>
          {settled ? "Settled" : stopped ? "Stopped" : "Live"}
        </Badge>
      </div>
      <Separator />
      <ItemGroup className="gap-2 p-3">
        {activity.participants.map((participant) => (
          <Item
            key={participant.name}
            variant="muted"
            size="sm"
            className="flex-nowrap items-start"
          >
            <ItemMedia className="size-6">
              <ActivityIcon state={participant.state} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="capitalize">{participant.name}</ItemTitle>
              <ItemDescription className="line-clamp-1">
                {stateLabel(participant.state)}
              </ItemDescription>
              <ItemDescription className="line-clamp-1">
                {participantSource(participants, participant.name)}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="shrink-0 self-start">
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

function activitySummary(state: GroupActivityState) {
  const { phase, notification, messageCount } = state
  if (phase === "settled") {
    return `Everyone is caught up with ${notification} ${
      notification === 1 ? "update" : "updates"
    }`
  }
  if (phase === "stopped") {
    if (state.stopReason === "limit") {
      return "Stopped at the room safety limit"
    }
    if (state.stopReason === "interrupted") {
      return "Stopped because the API restarted"
    }
    return "Stopped by you"
  }
  if (notification === 0) return "Starting the group…"
  return `Update ${notification}: ${messageCount} new ${
    messageCount === 1 ? "message" : "messages"
  }`
}

function participantSource(participants: GroupParticipant[], name: string) {
  return participants.find((participant) => participant.name === name)?.source
}

function stateLabel(state: ParticipantActivityState) {
  if (state === "caught-up") return "Caught up"
  if (state === "considering") return "Considering"
  if (state === "replied") return "Replied"
  if (state === "passed") return "Passed this update"
  if (state === "failed") return "Failed"
  if (state === "stopped") return "Stopped"
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
  if (state === "stopped")
    return <MinusCircle className="text-muted-foreground" />
  return <BellRing />
}
