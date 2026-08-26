import { createHash, randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"

import {
  type AgentModel,
  type ContextFragment,
  type ContextStore,
  type StreamManager,
} from "@deepagents/context"
import {
  type AgentDeclaration,
  AgentRuntime,
  type ConversationId,
  type MailboxStore,
  MessageDeliveryMode,
  PgBossTurnQueue,
  createInterAgentCommunication,
  defineAgent,
} from "@deepagents/experimental/zukhruf"
import {
  PgBossWakeScheduler,
  type SchedulingWake,
  conversationSchedulingCapabilities,
} from "@deepagents/experimental/zukhruf/conversation-scheduling"
import { PGlite } from "@electric-sql/pglite"
import type { ToolSet } from "ai"
import { PgBoss, fromPglite } from "pg-boss"

import { baseeraGroupChatAgent } from "../agent/group-chat-agent.js"
import {
  type GroupChatMessageAnnotation,
  type GroupChatReplyResult,
  groupChatCapabilities,
} from "../agent/plugins/group-chat.js"
import { recordAgentExecutionModel } from "./agent-executions.js"

/** Queue names must be stable per participant identity: with a durable queue database, drifting names would hand one participant another's pending turns and wakes. */
function queueSlug(name: string) {
  const base = name
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 8)
  return base ? `${base}-${digest}` : digest
}

export interface WhatsAppParticipant {
  name: string
  instructions?: readonly ContextFragment[]
  model: AgentModel
  tools?: ToolSet
  telemetry?: AgentDeclaration["telemetry"]
  tracePath?: string
}

export interface WhatsAppMessage {
  id: string
  sequence: number
  author: string
  content: string
  sentAt: string
  replyToMessageId: string | null
  annotations: WhatsAppMessageAnnotation[]
  responseAnnotations?: WhatsAppMessageAnnotation[]
}

export type WhatsAppMessageAnnotation = GroupChatMessageAnnotation

type WhatsAppParticipantToolPresence =
  | "typing"
  | "searching-web"
  | "working-with-files"
  | "scheduling"
  | "using-tool"

export type WhatsAppParticipantPresence =
  "idle" | "reading" | WhatsAppParticipantToolPresence | "seen"

function toolPresence(toolName: string): WhatsAppParticipantToolPresence {
  switch (toolName) {
    case "reply_to_group":
      return "typing"
    case "web_search":
      return "searching-web"
    case "bash":
      return "working-with-files"
    case "CronCreate":
    case "CronList":
    case "CronDelete":
    case "ScheduleWakeup":
      return "scheduling"
    default:
      return "using-tool"
  }
}

export type WhatsAppGroupActivity =
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
      state: Exclude<WhatsAppParticipantPresence, "idle">
    }
  | { type: "settled"; notifications: number }
  | {
      type: "stopped"
      notifications: number
      reason: "user" | "limit" | "interrupted"
    }

export interface WhatsAppGroupActivityState {
  phase: "idle" | "active" | "settled" | "stopped"
  stopReason?: "user" | "limit" | "interrupted"
  notification: number
  messageCount: number
  participants: {
    name: string
    state:
      | "notified"
      | "considering"
      | "replied"
      | "passed"
      | "caught-up"
      | "failed"
      | "stopped"
    replies: number
  }[]
  presence: { name: string; state: WhatsAppParticipantPresence }[]
}

export type WhatsAppChatEvent =
  | { cursor: number; type: "message"; message: WhatsAppMessage }
  | {
      cursor: number
      type: "activity"
      activity: WhatsAppGroupActivity
    }

export interface WhatsAppGroupSnapshot {
  messages: WhatsAppMessage[]
  participants: { name: string }[]
  activity: WhatsAppGroupActivityState
  cursor: number
}

export interface WhatsAppGroupLimits {
  notifications: number
  agentMessages: number
  transcriptMessages: number
}

export interface WhatsAppGroupOptions {
  conversation: ConversationId
  participants: readonly WhatsAppParticipant[]
  loadParticipants?: () => Promise<readonly WhatsAppParticipant[]>
  sandbox: AgentDeclaration["sandbox"]
  store: ContextStore
  streams: StreamManager
  mailboxStore: MailboxStore
  events: WhatsAppChatEvent[]
  limits: WhatsAppGroupLimits
  /** Directory for the durable turn/wake queue database. Omitted: in-memory, so pending schedules die with the process. */
  queuePath?: string
  persist: (event: WhatsAppChatEvent) => void | Promise<void>
  onMessage?: (message: WhatsAppMessage, cursor: number) => void | Promise<void>
  onActivity?: (activity: WhatsAppGroupActivity) => void | Promise<void>
  onEvent?: (event: WhatsAppChatEvent) => void | Promise<void>
}

export class WhatsAppGroupLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhatsAppGroupLimitError"
  }
}

export class WhatsAppReplyTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhatsAppReplyTargetError"
  }
}

interface RunningParticipant {
  name: string
  modelId: string
  conversation: ConversationId
  runtime: AgentRuntime
  active: boolean
  seenThroughSequence: number
  pendingReminder?: string
  responseAnnotations: WhatsAppMessageAnnotation[]
  turnId?: string
}

type StartParticipant = (
  participant: WhatsAppParticipant,
  joining: boolean,
) => Promise<RunningParticipant>

type WhatsAppReplyResult = GroupChatReplyResult<WhatsAppMessage>

interface GroupSubscriber extends Pick<
  WhatsAppGroupOptions,
  "onMessage" | "onActivity" | "onEvent"
> {
  delivery: Promise<void>
}

export class WhatsAppGroup implements AsyncDisposable {
  readonly #resources: AsyncDisposableStack
  readonly #participants: RunningParticipant[]
  readonly #profiles: { name: string }[]
  readonly #loadParticipants?: WhatsAppGroupOptions["loadParticipants"]
  readonly #startParticipant: StartParticipant
  readonly #user: ConversationId
  readonly #subscribers = new Set<GroupSubscriber>()
  readonly #messages: WhatsAppMessage[] = []
  readonly #messagesById = new Map<string, WhatsAppMessage>()
  readonly #events: WhatsAppChatEvent[] = []
  readonly #pending: WhatsAppMessage[] = []
  readonly #mailboxRecipients = new Map<string, Set<string>>()
  readonly #replyCounts = new Map<string, number>()
  readonly #limits: WhatsAppGroupLimits
  readonly #persist: WhatsAppGroupOptions["persist"]
  readonly #store: ContextStore
  #activity: WhatsAppGroupActivityState = {
    phase: "idle",
    notification: 0,
    messageCount: 0,
    participants: [],
    presence: [],
  }
  #pump: Promise<void> | null = null
  #sequence = 0
  #cursor = 0
  #agentMessages = 0
  #stopRequested: "user" | "limit" | "interrupted" | null = null
  #closed = false

  private constructor(
    options: WhatsAppGroupOptions,
    resources: {
      disposables: AsyncDisposableStack
      participants: RunningParticipant[]
      startParticipant: StartParticipant
    },
  ) {
    this.#resources = resources.disposables
    this.#participants = resources.participants
    this.#loadParticipants = options.loadParticipants
    this.#startParticipant = resources.startParticipant
    this.#user = options.conversation
    this.#profiles = options.participants.map(({ name }) => ({ name }))
    this.#limits = options.limits
    this.#persist = options.persist
    this.#store = options.store
    for (const event of structuredClone(options.events)) {
      this.#cursor = event.cursor
      this.#events.push(event)
      if (event.type === "message") {
        const { message } = event
        this.#messages.push(message)
        this.#messagesById.set(message.id, message)
        this.#sequence = message.sequence
        if (message.author !== "user") {
          this.#replyCounts.set(
            message.author,
            (this.#replyCounts.get(message.author) ?? 0) + 1,
          )
        }
      } else {
        this.#activity = reduceActivity(this.#activity, event.activity)
      }
    }
    if (options.onMessage || options.onActivity || options.onEvent) {
      this.#subscribers.add({
        onMessage: options.onMessage,
        onActivity: options.onActivity,
        onEvent: options.onEvent,
        delivery: Promise.resolve(),
      })
    }
  }

  static async create(options: WhatsAppGroupOptions) {
    WhatsAppGroup.#validate(options)

    await using resources = new AsyncDisposableStack()
    if (options.queuePath) mkdirSync(options.queuePath, { recursive: true })
    const database = new PGlite(options.queuePath)
    resources.defer(() => database.close())
    const boss = new PgBoss({ db: fromPglite(database), backend: "pglite" })
    boss.on("error", (error) => console.error("[queue error]", error))
    resources.defer(() => boss.stop({ close: false, graceful: true }))
    const participants: RunningParticipant[] = []

    await boss.start()
    const disposables = resources.move()
    try {
      const startParticipant: StartParticipant = async (
        participant,
        joining,
      ) => {
        const participantSlug = queueSlug(participant.name)
        const queue = new PgBossTurnQueue(boss, {
          queue: `zukhruf-whatsapp-${participantSlug}`,
          schema: "pgboss",
          pollingIntervalSeconds: 0.5,
        })
        await queue.initialize()
        const wakes = new PgBossWakeScheduler<SchedulingWake>(boss, {
          queue: `zukhruf-whatsapp-wakes-${participantSlug}`,
          pollingIntervalSeconds: 0.5,
        })
        await wakes.initialize()

        const runtime = new AgentRuntime(
          defineAgent({
            name: participant.name,
            model: participant.model,
            telemetry: participant.telemetry,
            sandbox: options.sandbox,
            instructions: [...(participant.instructions ?? [])],
            tools: participant.tools,
            ...baseeraGroupChatAgent,
          }),
          {
            store: options.store,
            streams: options.streams,
            queue,
            mailboxStore: options.mailboxStore,
            bindings: [
              groupChatCapabilities.primaryParticipantName.bind(
                options.participants[0]!.name,
              ),
              groupChatCapabilities.publishReply.bind((...reply) =>
                group.#postParticipant(...reply),
              ),
              conversationSchedulingCapabilities.scheduler.bind(wakes),
              conversationSchedulingCapabilities.timezone.bind(
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              ),
            ],
          },
        )

        const running = {
          name: participant.name,
          modelId: participant.model.modelId,
          conversation: {
            chatId: `${options.conversation.chatId}:participant:${encodeURIComponent(participant.name)}`,
            userId: options.conversation.userId,
          },
          runtime,
          active: false,
          seenThroughSequence: 0,
          responseAnnotations: [],
          pendingReminder: joining
            ? "You just joined an ongoing group chat. Read the full public conversation included in this notification, then greet the group once with a brief, natural introduction."
            : options.participants.length === 1
              ? "Before deciding whether to reply to the first human message, use bash to list all participant directories under /workspace/participants. If your own directory is the only participant directory, the human is speaking directly to you even when they do not name you."
              : undefined,
        }
        disposables.use(await runtime.work())
        return running
      }

      const group = new WhatsAppGroup(options, {
        disposables,
        participants,
        startParticipant,
      })
      for (const participant of options.participants) {
        participants.push(await startParticipant(participant, false))
      }
      return group
    } catch (error) {
      await disposables.disposeAsync()
      throw error
    }
  }

  async send(
    content: string,
    onMessage?: WhatsAppGroupOptions["onMessage"],
    onActivity?: WhatsAppGroupOptions["onActivity"],
  ): Promise<readonly WhatsAppMessage[]> {
    using subscription = this.subscribe({ onMessage, onActivity })
    await this.post(content)
    await this.#whenSettled()
    return this.#messages
  }

  async post(
    content: string,
    id: string = randomUUID(),
    replyToMessageId?: string,
    annotations?: readonly WhatsAppMessageAnnotation[],
  ) {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    const message = content.trim()
    if (!message && !annotations?.length) {
      throw new Error("WhatsAppGroup message cannot be empty")
    }
    if (!this.#pump) {
      this.#stopRequested = null
      this.#agentMessages = 0
    }
    return this.#post("user", message, id, replyToMessageId, annotations)
  }

  snapshot(): WhatsAppGroupSnapshot {
    return {
      messages: [...this.#messages],
      participants: [...this.#profiles],
      activity: structuredClone(this.#activity),
      cursor: this.#cursor,
    }
  }

  async stop(reason: "user" | "limit" | "interrupted" = "user") {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    if (!this.#pump && this.#activity.phase !== "active") {
      return this.snapshot()
    }

    this.#stopRequested = reason
    this.#pending.length = 0
    await Promise.allSettled(
      this.#participants
        .filter(({ active }) => active)
        .map((participant) =>
          participant.runtime
            .observe(participant.conversation)
            .cancel(participant.turnId),
        ),
    )
    await this.#pump?.catch(() => undefined)
    await this.#emitStopped(reason)
    return this.snapshot()
  }

  async recoverInterrupted() {
    if (this.#activity.phase === "active") {
      await this.#emitStopped("interrupted")
    }
  }

  subscribe({
    onMessage,
    onActivity,
    onEvent,
    after = this.#cursor,
  }: Pick<WhatsAppGroupOptions, "onMessage" | "onActivity" | "onEvent"> & {
    after?: number
  }) {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    const subscriber: GroupSubscriber = {
      onMessage,
      onActivity,
      onEvent,
      delivery: Promise.resolve(),
    }
    this.#subscribers.add(subscriber)
    for (const event of this.#events) {
      if (event.cursor > after) this.#deliver(subscriber, event)
    }
    return {
      [Symbol.dispose]: () => {
        this.#subscribers.delete(subscriber)
      },
    }
  }

  async [Symbol.asyncDispose]() {
    if (this.#closed) return
    if (this.#pump) await this.stop("interrupted")
    this.#closed = true
    await this.#resources.disposeAsync()
  }

  async #post(
    author: string,
    content: string,
    id: string = randomUUID(),
    replyToMessageId?: string,
    annotations: readonly WhatsAppMessageAnnotation[] = [],
    responseAnnotations: readonly WhatsAppMessageAnnotation[] = [],
  ) {
    const existing = this.#messagesById.get(id)
    if (existing) return existing
    if (this.#messages.length >= this.#limits.transcriptMessages) {
      throw new WhatsAppGroupLimitError(
        "WhatsApp chat transcript limit reached",
      )
    }
    if (replyToMessageId && !this.#messagesById.has(replyToMessageId)) {
      throw new WhatsAppReplyTargetError("Reply target was not found")
    }
    const normalizedAnnotations = annotations.map(
      ({ messageId, excerpt, comment }) => ({
        messageId: messageId.trim(),
        excerpt: excerpt.trim(),
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
      }),
    )
    for (const annotation of normalizedAnnotations) {
      const target = this.#messagesById.get(annotation.messageId)
      if (
        !target ||
        !annotation.excerpt ||
        !normalizedText(target.content).includes(
          normalizedText(annotation.excerpt),
        )
      ) {
        throw new WhatsAppReplyTargetError(
          "Annotation excerpt was not found in its target",
        )
      }
    }

    const message = {
      id,
      sequence: ++this.#sequence,
      author,
      content,
      sentAt: new Date().toISOString(),
      replyToMessageId: replyToMessageId ?? null,
      annotations: normalizedAnnotations,
      ...(responseAnnotations.length > 0
        ? {
            responseAnnotations: responseAnnotations.map((item) => ({
              ...item,
            })),
          }
        : {}),
    }
    this.#messages.push(message)
    this.#messagesById.set(id, message)
    this.#pending.push(message)
    if (author !== "user") {
      this.#replyCounts.set(author, (this.#replyCounts.get(author) ?? 0) + 1)
    }
    await this.#emitMessage(message)
    await this.#deliverToActiveParticipants(message)
    this.#ensurePump()
    return message
  }

  async #postParticipant(
    author: string,
    content: string,
    replyToMessageId?: string,
    annotations?: readonly WhatsAppMessageAnnotation[],
  ): Promise<WhatsAppReplyResult> {
    if (this.#stopRequested) return { posted: false, reason: "stopped" }
    if (
      this.#agentMessages >= this.#limits.agentMessages ||
      this.#messages.length >= this.#limits.transcriptMessages
    ) {
      this.#stopRequested = "limit"
      return { posted: false, reason: "limit" }
    }

    const participant = this.#participants.find(({ name }) => name === author)!
    const newerMessages = this.#messages.filter(
      ({ author: messageAuthor, sequence }) =>
        messageAuthor !== author && sequence > participant.seenThroughSequence,
    )
    if (newerMessages.length > 0) {
      participant.seenThroughSequence = newerMessages.at(-1)!.sequence
      return {
        posted: false,
        reason: "transcript_changed",
        messages: structuredClone(newerMessages),
      }
    }

    this.#agentMessages++
    const normalizedTargetId = replyToMessageId?.trim()
    const targetId =
      normalizedTargetId && this.#messagesById.has(normalizedTargetId)
        ? normalizedTargetId
        : undefined
    const targetAnnotations = annotations
      ?.map(({ messageId, excerpt, comment }) => ({
        messageId: messageId.trim(),
        excerpt: excerpt.trim(),
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
      }))
      .filter(({ messageId }) => this.#messagesById.has(messageId))
    await this.#post(
      author,
      content,
      randomUUID(),
      targetId,
      targetAnnotations,
      participant.responseAnnotations,
    )
    return { posted: true }
  }

  #ensurePump() {
    if (this.#pump) return
    const pump = Promise.resolve().then(() => this.#runPump())
    this.#pump = pump
    void pump.then(
      () => this.#finishPump(pump, true),
      (cause) => this.#abandonPump(pump, cause),
    )
  }

  #finishPump(pump: Promise<void>, restart: boolean) {
    if (this.#pump === pump) this.#pump = null
    if (restart && this.#pending.length > 0) this.#ensurePump()
  }

  async #abandonPump(pump: Promise<void>, cause: unknown) {
    this.#finishPump(pump, false)
    this.#pending.length = 0
    console.error("[group pump failed]", cause)
    try {
      // #deliver hands back the uncaught delivery promise, so a subscriber
      // that throws rejects this too — and nothing above would catch it.
      await this.#emitStopped(this.#stopRequested ?? "interrupted")
    } catch (emitCause) {
      console.error("[group pump stop notice failed]", emitCause)
    }
  }

  async #runPump() {
    let notification = 0
    await this.#emitActivity({
      type: "started",
      participants: this.#participants.map(({ name }) => name),
    })

    while (this.#pending.length > 0) {
      if (
        this.#stopRequested ||
        notification >= this.#limits.notifications ||
        this.#agentMessages >= this.#limits.agentMessages
      ) {
        const reason = this.#stopRequested ?? "limit"
        this.#pending.length = 0
        await this.#emitStopped(reason)
        return
      }

      const pending = this.#pending.splice(0)
      const batches = this.#participants.map((participant) => ({
        participant,
        notifications: pending.filter(
          (message) =>
            message.author !== participant.name &&
            !this.#mailboxRecipients.get(message.id)?.has(participant.name),
        ),
      }))
      const recipients = batches
        .filter(({ notifications }) => notifications.length > 0)
        .map(({ participant }) => participant.name)
      if (recipients.length > 0) {
        notification++
        await this.#emitActivity({
          type: "notification",
          notification,
          messageCount: pending.length,
          recipients,
        })
        await Promise.all(
          batches.map(({ participant, notifications }) =>
            notifications.length > 0
              ? this.#runParticipant(participant, notifications, notification)
              : undefined,
          ),
        )
      }
      for (const { id } of pending) this.#mailboxRecipients.delete(id)
      if (this.#stopRequested) {
        this.#pending.length = 0
        await this.#emitStopped(this.#stopRequested)
        return
      }

      let joined = await this.#joinParticipants()
      while (joined.length > 0) {
        if (
          this.#stopRequested ||
          notification >= this.#limits.notifications ||
          this.#agentMessages >= this.#limits.agentMessages
        ) {
          const reason = this.#stopRequested ?? "limit"
          this.#pending.length = 0
          await this.#emitStopped(reason)
          return
        }

        notification++
        const transcript = [...this.#messages]
        await this.#emitActivity({
          type: "notification",
          notification,
          messageCount: transcript.length,
          recipients: joined.map(({ name }) => name),
        })
        await Promise.all(
          joined.map((participant) =>
            this.#runParticipant(participant, transcript, notification),
          ),
        )
        joined = await this.#joinParticipants()
      }
    }

    await this.#emitActivity({ type: "settled", notifications: notification })
  }

  async #joinParticipants() {
    if (!this.#loadParticipants) return []
    const definitions = await this.#loadParticipants()
    WhatsAppGroup.#validateParticipants(definitions)
    const names = new Set(
      this.#participants.map(({ name }) => name.toLocaleLowerCase("en")),
    )
    const joined: RunningParticipant[] = []
    for (const definition of definitions) {
      const normalizedName = definition.name.toLocaleLowerCase("en")
      if (names.has(normalizedName)) continue
      const participant = await this.#startParticipant(definition, true)
      participant.seenThroughSequence = this.#sequence
      this.#participants.push(participant)
      this.#profiles.push({ name: participant.name })
      names.add(normalizedName)
      joined.push(participant)
    }
    return joined
  }

  async #runParticipant(
    participant: RunningParticipant,
    notifications: WhatsAppMessage[],
    notification: number,
  ) {
    participant.seenThroughSequence = Math.max(
      participant.seenThroughSequence,
      notifications.at(-1)?.sequence ?? 0,
    )
    participant.active = true
    participant.responseAnnotations = notifications.flatMap(
      ({ annotations }) => annotations,
    )
    try {
      await this.#emitActivity({
        type: "participant",
        notification,
        participant: participant.name,
        state: "considering",
      })
      await this.#emitActivity({
        type: "presence",
        notification,
        participant: participant.name,
        state: "reading",
      })
      const repliesBefore = this.#replyCounts.get(participant.name) ?? 0
      const turn = await participant.runtime.enqueue(participant.conversation, {
        id: JSON.stringify({
          kind: "whatsapp-notification",
          messages: notifications.map(({ id }) => id),
          reminder: participant.pendingReminder,
        }),
        input: this.#notification(notifications, participant.pendingReminder),
      })
      participant.pendingReminder = undefined
      participant.turnId = turn.id
      let failure: string | undefined
      const toolCalls = new Map<string, WhatsAppParticipantToolPresence>()
      try {
        await turn.stream.pipeTo(
          new WritableStream({
            write: async (part) => {
              if (part.type === "error") failure = part.errorText
              if (
                (part.type === "tool-input-start" ||
                  part.type === "tool-input-available") &&
                !toolCalls.has(part.toolCallId)
              ) {
                const state = toolPresence(part.toolName)
                toolCalls.set(part.toolCallId, state)
                await this.#emitActivity({
                  type: "presence",
                  notification,
                  participant: participant.name,
                  state,
                })
              }
              const toolFinished =
                part.type === "tool-input-error" ||
                part.type === "tool-output-error" ||
                part.type === "tool-output-denied" ||
                (part.type === "tool-output-available" &&
                  part.preliminary !== true)
              if (toolFinished && toolCalls.delete(part.toolCallId)) {
                const active = [...toolCalls.values()].at(-1)
                await this.#emitActivity({
                  type: "presence",
                  notification,
                  participant: participant.name,
                  state: active === undefined ? "reading" : active,
                })
              }
            },
          }),
        )
      } finally {
        await recordAgentExecutionModel(
          this.#store,
          participant.conversation,
          turn.id,
          participant.modelId,
        ).catch(() =>
          console.error(
            `[agent execution metadata failed] ${participant.name}`,
          ),
        )
      }
      if (failure) throw new Error(failure)
      if (this.#stopRequested) return
      const replies =
        (this.#replyCounts.get(participant.name) ?? 0) - repliesBefore
      await this.#emitActivity({
        type: "participant",
        notification,
        participant: participant.name,
        state: replies > 0 ? "replied" : "passed",
        ...(replies > 0 ? { replies } : {}),
      })
      await this.#emitActivity({
        type: "presence",
        notification,
        participant: participant.name,
        state: "seen",
      })
    } catch (error) {
      if (!this.#stopRequested) {
        await this.#emitActivity({
          type: "participant",
          notification,
          participant: participant.name,
          state: "failed",
        })
        await this.#emitActivity({
          type: "presence",
          notification,
          participant: participant.name,
          state: "seen",
        })
        console.error(`[group participant failed] ${participant.name}`)
      }
    } finally {
      participant.active = false
      participant.responseAnnotations = []
      participant.turnId = undefined
    }
  }

  async #whenSettled() {
    while (this.#pump) await this.#pump
  }

  async #emitMessage(message: WhatsAppMessage) {
    const event = {
      cursor: ++this.#cursor,
      type: "message" as const,
      message,
    }
    await this.#persist(event)
    this.#events.push(event)
    const deliveries = [...this.#subscribers].map((subscriber) =>
      this.#deliver(subscriber, event, () =>
        subscriber.onMessage?.(message, event.cursor),
      ),
    )
    await Promise.all(deliveries)
  }

  async #emitActivity(activity: WhatsAppGroupActivity) {
    this.#activity = reduceActivity(this.#activity, activity)
    const event = {
      cursor: ++this.#cursor,
      type: "activity" as const,
      activity,
    }
    const deliveries = [...this.#subscribers].map((subscriber) =>
      this.#deliver(subscriber, event, () => subscriber.onActivity?.(activity)),
    )
    if (activity.type === "presence") {
      await Promise.all(deliveries)
      return
    }
    this.#events.push(event)
    await Promise.all([...deliveries, this.#persist(event)])
  }

  async #emitStopped(reason: "user" | "limit" | "interrupted") {
    if (
      this.#activity.phase === "stopped" &&
      this.#activity.stopReason === reason
    ) {
      return
    }
    await this.#emitActivity({
      type: "stopped",
      notifications: this.#activity.notification,
      reason,
    })
  }

  #deliver(
    subscriber: GroupSubscriber,
    event: WhatsAppChatEvent,
    legacyCallback?: () => void | Promise<void>,
  ) {
    const delivery = subscriber.delivery.then(async () => {
      await subscriber.onEvent?.(event)
      await legacyCallback?.()
    })
    subscriber.delivery = delivery.catch(() => undefined)
    return delivery
  }

  #notification(messages: WhatsAppMessage[], reminder?: string) {
    const responseAnnotations = messages.flatMap(
      ({ annotations }) => annotations,
    )
    return [
      "New WhatsApp group messages:",
      "",
      ...messages.flatMap((message) => [
        `[${message.id}] ${message.author}:`,
        ...(message.replyToMessageId
          ? [this.#replyContext(message.replyToMessageId)]
          : []),
        message.content,
        "",
      ]),
      ...(responseAnnotations.length > 0
        ? [responseAnnotationsPrompt(responseAnnotations), ""]
        : []),
      ...(reminder
        ? [`<system-reminder>${reminder}</system-reminder>`, ""]
        : []),
      "Reply only through reply_to_group when you have something useful to add.",
      "Omit replyToMessageId by default. It points to one earlier public message in the UI; use it only to emphasize that message or when directly replying to another participant. Do not use it for an ordinary response to the latest user message or current discussion.",
      "Use annotations in reply_to_group only for exact excerpts you want to emphasize; each annotation names its own earlier public message.",
    ].join("\n")
  }

  #replyContext(replyToMessageId: string) {
    const target = this.#messagesById.get(replyToMessageId)
    return target
      ? `Replying to [${target.id}] ${target.author}: ${target.content}`
      : `Replying to [${replyToMessageId}]`
  }

  async #deliverToActiveParticipants(message: WhatsAppMessage) {
    const recipients = this.#participants.filter(
      (participant) =>
        participant.active && participant.name !== message.author,
    )
    if (recipients.length === 0) return

    const eligibleRecipients = this.#participants.filter(
      ({ name }) => name !== message.author,
    )
    const author =
      this.#participants.find(({ name }) => name === message.author)
        ?.conversation ?? this.#user
    const delivered = new Set<string>()
    this.#mailboxRecipients.set(message.id, delivered)
    const context = [
      ...(message.replyToMessageId
        ? [this.#replyContext(message.replyToMessageId)]
        : []),
      ...(message.annotations.length > 0
        ? [responseAnnotationsPrompt(message.annotations)]
        : []),
    ]

    await Promise.all(
      recipients.map(async (participant) => {
        participant.responseAnnotations.push(...message.annotations)
        await participant.runtime.deliver(
          createInterAgentCommunication({
            id: `${message.id}:${participant.conversation.chatId}`,
            author,
            recipient: participant.conversation,
            otherRecipients: eligibleRecipients
              .filter(({ name }) => name !== participant.name)
              .map(({ conversation }) => conversation),
            content:
              context.length > 0
                ? `${context.join("\n")}\n${message.content}`
                : message.content,
            metadata: {
              chatMessageId: message.id,
              chatSequence: message.sequence,
              replyToMessageId: message.replyToMessageId,
              annotations: message.annotations,
              authorPath: message.author,
              recipientPath: participant.name,
              otherRecipientNames: eligibleRecipients
                .filter(({ name }) => name !== participant.name)
                .map(({ name }) => name),
            },
          }),
          MessageDeliveryMode.QueueOnly,
        )
        delivered.add(participant.name)
      }),
    )
  }

  static #validate(options: WhatsAppGroupOptions) {
    if (!options.conversation.userId.trim()) {
      throw new Error("WhatsAppGroup userId cannot be empty")
    }
    if (!options.conversation.chatId.trim()) {
      throw new Error("WhatsAppGroup chatId cannot be empty")
    }
    WhatsAppGroup.#validateParticipants(options.participants)
    for (const [name, limit] of Object.entries(options.limits)) {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error(`WhatsAppGroup ${name} limit must be positive`)
      }
    }
  }

  static #validateParticipants(participants: readonly WhatsAppParticipant[]) {
    const names = new Set<string>()
    for (const participant of participants) {
      if (
        !participant.name.trim() ||
        participant.name !== participant.name.trim() ||
        participant.name.length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(participant.name)
      ) {
        throw new Error(
          "WhatsAppGroup participant names must be valid, unpadded text",
        )
      }
      if (participant.name.toLowerCase() === "user") {
        throw new Error(
          'WhatsAppGroup participant name "user" is reserved for the human author',
        )
      }
      const normalizedName = participant.name.toLowerCase()
      if (names.has(normalizedName)) {
        throw new Error(
          `WhatsAppGroup participant name "${participant.name}" is duplicated`,
        )
      }
      names.add(normalizedName)
    }
  }
}

function responseAnnotationsPrompt(
  annotations: readonly WhatsAppMessageAnnotation[],
) {
  return [
    "# Response annotations:",
    'Each item contains text selected from an earlier response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index="N"}`, where N is its one-based array position. Do not use unstructured annotation labels.',
    "<response-annotations>",
    JSON.stringify(
      annotations.map(({ excerpt, comment }) => ({
        text: excerpt,
        annotation: comment ?? "",
      })),
    ),
    "</response-annotations>",
  ].join("\n")
}

function normalizedText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim()
}

function reduceActivity(
  state: WhatsAppGroupActivityState,
  event: WhatsAppGroupActivity,
): WhatsAppGroupActivityState {
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
    const participantNames = new Set(state.participants.map(({ name }) => name))
    const presenceNames = new Set(state.presence.map(({ name }) => name))
    return {
      ...state,
      phase: "active",
      notification: event.notification,
      messageCount: event.messageCount,
      participants: [
        ...state.participants,
        ...event.recipients
          .filter((name) => !participantNames.has(name))
          .map((name) => ({ name, state: "notified" as const, replies: 0 })),
      ].map((participant) =>
        recipients.has(participant.name)
          ? { ...participant, state: "notified" }
          : participant,
      ),
      presence: [
        ...state.presence,
        ...event.recipients
          .filter((name) => !presenceNames.has(name))
          .map((name) => ({ name, state: "idle" as const })),
      ].map((participant) =>
        recipients.has(participant.name)
          ? { ...participant, state: "idle" }
          : participant,
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
          : participant,
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
        : participant,
    ),
  }
}
