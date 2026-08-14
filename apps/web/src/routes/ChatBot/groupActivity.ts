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
  | {
      type: "presence"
      notification: number
      participant: string
      state: Exclude<ParticipantPresenceState, "idle">
    }
  | { type: "settled"; notifications: number }
  | {
      type: "stopped"
      notifications: number
      reason: "user" | "limit" | "interrupted"
    }

export type ParticipantActivityState =
  | "notified"
  | "considering"
  | "replied"
  | "passed"
  | "caught-up"
  | "failed"
  | "stopped"

const toolPresenceStates = [
  "searching-web",
  "working-with-files",
  "scheduling",
  "using-tool",
] as const

type ParticipantToolPresenceState = (typeof toolPresenceStates)[number]

const toolPresenceLabels = {
  "searching-web": "searching the web",
  "working-with-files": "working with group files",
  scheduling: "scheduling a follow-up",
  "using-tool": "using a tool",
} satisfies Record<ParticipantToolPresenceState, string>

const participantPresenceStates = [
  "idle",
  "reading",
  "typing",
  ...toolPresenceStates,
  "seen",
] as const

export type ParticipantPresenceState =
  (typeof participantPresenceStates)[number]

export interface GroupActivityState {
  phase: "idle" | "active" | "settled" | "stopped"
  stopReason?: "user" | "limit" | "interrupted"
  notification: number
  messageCount: number
  participants: {
    name: string
    state: ParticipantActivityState
    replies: number
  }[]
  presence: { name: string; state: ParticipantPresenceState }[]
}

export const initialGroupActivity: GroupActivityState = {
  phase: "idle",
  notification: 0,
  messageCount: 0,
  participants: [],
  presence: [],
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
      presence: event.participants.map((name) => ({ name, state: "idle" })),
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
      presence: state.presence.map((participant) =>
        recipients.has(participant.name)
          ? { ...participant, state: "idle" }
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
      presence: state.presence.map((participant) => ({
        ...participant,
        state: "seen",
      })),
    }
  }
  if (event.type === "stopped") {
    return {
      ...state,
      phase: "stopped",
      stopReason: event.reason,
      notification: event.notifications,
      participants: state.participants.map((participant) => ({
        ...participant,
        state: participant.state === "failed" ? "failed" : ("stopped" as const),
      })),
      presence: state.presence.map((participant) => ({
        ...participant,
        state: "idle",
      })),
    }
  }

  if (event.type === "presence") {
    return {
      ...state,
      presence: state.presence.map((participant) =>
        participant.name === event.participant
          ? { ...participant, state: event.state }
          : participant
      ),
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
  if (value.type === "presence") {
    return (
      positiveInteger(value.notification) &&
      typeof value.participant === "string" &&
      isParticipantPresenceState(value.state) &&
      value.state !== "idle"
    )
  }
  if (value.type === "stopped") {
    return (
      nonNegativeInteger(value.notifications) &&
      ["user", "limit", "interrupted"].includes(String(value.reason))
    )
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

export function isGroupActivityState(
  value: unknown
): value is GroupActivityState {
  return (
    isRecord(value) &&
    ["idle", "active", "settled", "stopped"].includes(String(value.phase)) &&
    (value.stopReason === undefined ||
      ["user", "limit", "interrupted"].includes(String(value.stopReason))) &&
    (value.phase !== "stopped" || value.stopReason !== undefined) &&
    nonNegativeInteger(value.notification) &&
    nonNegativeInteger(value.messageCount) &&
    Array.isArray(value.participants) &&
    value.participants.every(
      (participant) =>
        isRecord(participant) &&
        typeof participant.name === "string" &&
        [
          "notified",
          "considering",
          "replied",
          "passed",
          "caught-up",
          "failed",
          "stopped",
        ].includes(String(participant.state)) &&
        nonNegativeInteger(participant.replies)
    ) &&
    Array.isArray(value.presence) &&
    value.presence.every(
      (participant) =>
        isRecord(participant) &&
        typeof participant.name === "string" &&
        isParticipantPresenceState(participant.state)
    )
  )
}

export function groupActivityIndicator(state: GroupActivityState) {
  if (state.phase !== "active") return null

  const typing = state.presence
    .filter(({ state }) => state === "typing")
    .map(({ name }) => name)
  if (typing.length > 0) {
    return {
      participants: typing,
      label:
        typing.length === 1
          ? `${typing[0]} is typing…`
          : `${typing.length} agents are typing…`,
    }
  }

  const tools = state.presence.filter(
    (
      participant
    ): participant is {
      name: string
      state: ParticipantToolPresenceState
    } => isToolPresenceState(participant.state)
  )
  if (tools.length > 1) {
    return {
      participants: tools.map(({ name }) => name),
      label: `${tools.length} agents are using tools…`,
    }
  }
  if (tools.length === 1) {
    const [{ name, state: tool }] = tools
    return {
      participants: [name],
      label: `${name} is ${toolPresenceLabels[tool]}…`,
    }
  }

  const thinking = state.participants
    .filter(
      (participant) =>
        participant.state === "notified" ||
        participant.state === "considering" ||
        state.presence.some(
          ({ name, state }) =>
            name === participant.name && state === "reading"
        )
    )
    .map(({ name }) => name)
  if (thinking.length === 0) return null

  return {
    participants: thinking,
    label:
      thinking.length === 1
        ? `${thinking[0]} is thinking…`
        : `${thinking.length} agents are thinking…`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isParticipantPresenceState(
  value: unknown
): value is ParticipantPresenceState {
  return participantPresenceStates.includes(value as ParticipantPresenceState)
}

function isToolPresenceState(
  value: ParticipantPresenceState
): value is ParticipantToolPresenceState {
  return toolPresenceStates.includes(value as ParticipantToolPresenceState)
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}
