export type GroupActivityEvent =
  | { type: "started"; participants: string[] }
  | {
      type: "notification"
      notification: number
      messageCount: number
      recipients: string[]
    }
  | {
      type: "participant"
      notification: number
      participant: string
      state: "considering" | "replied" | "passed" | "failed"
      replies?: number
    }
  | { type: "settled"; notifications: number }

export type ParticipantActivityState =
  "notified" | "considering" | "replied" | "passed" | "caught-up" | "failed"

export interface GroupActivityState {
  phase: "idle" | "active" | "settled"
  notification: number
  messageCount: number
  participants: {
    name: string
    state: ParticipantActivityState
    replies: number
  }[]
}

export const initialGroupActivity: GroupActivityState = {
  phase: "idle",
  notification: 0,
  messageCount: 0,
  participants: [],
}

export function reduceGroupActivity(
  state: GroupActivityState,
  event: GroupActivityEvent
): GroupActivityState {
  if (event.type === "started") {
    return {
      phase: "active",
      notification: 0,
      messageCount: 0,
      participants: event.participants.map((name) => ({
        name,
        state: "notified",
        replies: 0,
      })),
    }
  }

  if (event.type === "notification") {
    const recipients = new Set(event.recipients)
    return {
      ...state,
      phase: "active",
      notification: event.notification,
      messageCount: event.messageCount,
      participants: state.participants.map((participant) =>
        recipients.has(participant.name)
          ? { ...participant, state: "notified" }
          : participant
      ),
    }
  }

  if (event.type === "settled") {
    return {
      ...state,
      phase: "settled",
      notification: event.notifications,
      participants: state.participants.map((participant) => ({
        ...participant,
        state:
          participant.state === "failed" ? "failed" : ("caught-up" as const),
      })),
    }
  }

  return {
    ...state,
    participants: state.participants.map((participant) =>
      participant.name === event.participant
        ? {
            ...participant,
            state: event.state,
            replies: participant.replies + (event.replies ?? 0),
          }
        : participant
    ),
  }
}

export function isGroupActivityEvent(
  value: unknown
): value is GroupActivityEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false

  if (value.type === "started") {
    return stringArray(value.participants)
  }
  if (value.type === "notification") {
    return (
      positiveInteger(value.notification) &&
      positiveInteger(value.messageCount) &&
      stringArray(value.recipients)
    )
  }
  if (value.type === "settled") {
    return positiveInteger(value.notifications)
  }
  if (value.type !== "participant") return false

  return (
    positiveInteger(value.notification) &&
    typeof value.participant === "string" &&
    ["considering", "replied", "passed", "failed"].includes(
      String(value.state)
    ) &&
    (value.replies === undefined || positiveInteger(value.replies))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}
