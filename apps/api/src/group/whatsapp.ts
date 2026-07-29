import { randomUUID } from "node:crypto"

import {
  type AgentModel,
  InMemoryContextStore,
  SqliteStreamStore,
  createVirtualSandbox,
  role,
} from "@deepagents/context"
import {
  AgentRuntime,
  MessageDeliveryMode,
  PgBossTurnQueue,
  SqliteApprovalMutex,
  SqliteMailboxStore,
  type AgentDeclaration,
  type ConversationId,
  createInterAgentCommunication,
  defineAgent,
  defineSandbox,
  defineTool,
} from "@deepagents/experimental/zukhruf"
import { PGlite } from "@electric-sql/pglite"
import { jsonSchema, type ToolSet } from "ai"
import { InMemoryFs } from "just-bash"
import { PgBoss, fromPglite } from "pg-boss"

export interface WhatsAppParticipant {
  name: string
  specialty: string
  instructions?: string
  model: AgentModel
  tools?: ToolSet
  telemetry?: AgentDeclaration["telemetry"]
}

export interface WhatsAppMessage {
  id: string
  sequence: number
  author: string
  content: string
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
}

export type WhatsAppRoomEvent =
  | { cursor: number; type: "message"; message: WhatsAppMessage }
  | {
      cursor: number
      type: "activity"
      activity: WhatsAppGroupActivity
    }

export interface WhatsAppGroupSnapshot {
  messages: WhatsAppMessage[]
  participants: { name: string; specialty: string }[]
  activity: WhatsAppGroupActivityState
  cursor: number
}

export interface WhatsAppGroupHydration {
  snapshot: WhatsAppGroupSnapshot
  events: WhatsAppRoomEvent[]
}

export interface WhatsAppGroupLimits {
  notifications: number
  agentMessages: number
  transcriptMessages: number
}

export interface WhatsAppGroupOptions {
  userId: string
  participants: WhatsAppParticipant[]
  hydration?: WhatsAppGroupHydration
  limits?: Partial<WhatsAppGroupLimits>
  persist?: (
    snapshot: WhatsAppGroupSnapshot,
    event: WhatsAppRoomEvent
  ) => void | Promise<void>
  onMessage?: (message: WhatsAppMessage) => void | Promise<void>
  onActivity?: (activity: WhatsAppGroupActivity) => void | Promise<void>
  onEvent?: (event: WhatsAppRoomEvent) => void | Promise<void>
}

export class WhatsAppGroupLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WhatsAppGroupLimitError"
  }
}

interface RunningParticipant {
  name: string
  conversation: ConversationId
  runtime: AgentRuntime
  active: boolean
  turnId?: string
}

interface GroupSubscriber extends Pick<
  WhatsAppGroupOptions,
  "onMessage" | "onActivity" | "onEvent"
> {
  delivery: Promise<void>
}

export class WhatsAppGroup implements AsyncDisposable {
  readonly #resources: AsyncDisposableStack
  readonly #participants: RunningParticipant[]
  readonly #profiles: { name: string; specialty: string }[]
  readonly #user: ConversationId
  readonly #subscribers = new Set<GroupSubscriber>()
  readonly #messages: WhatsAppMessage[] = []
  readonly #messagesById = new Map<string, WhatsAppMessage>()
  readonly #events: WhatsAppRoomEvent[] = []
  readonly #pending: WhatsAppMessage[] = []
  readonly #mailboxRecipients = new Map<string, Set<string>>()
  readonly #replyCounts = new Map<string, number>()
  readonly #limits: WhatsAppGroupLimits
  readonly #persist?: WhatsAppGroupOptions["persist"]
  #activity: WhatsAppGroupActivityState = {
    phase: "idle",
    notification: 0,
    messageCount: 0,
    participants: [],
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
    }
  ) {
    this.#resources = resources.disposables
    this.#participants = resources.participants
    this.#user = { chatId: "user", userId: options.userId }
    this.#profiles =
      options.hydration?.snapshot.participants ??
      options.participants.map(({ name, specialty }) => ({
        name,
        specialty,
      }))
    this.#limits = {
      notifications: 25,
      agentMessages: 100,
      transcriptMessages: 500,
      ...options.limits,
    }
    this.#persist = options.persist
    if (options.hydration) {
      this.#messages.push(
        ...structuredClone(options.hydration.snapshot.messages)
      )
      for (const message of this.#messages) {
        this.#messagesById.set(message.id, message)
      }
      this.#events.push(...structuredClone(options.hydration.events))
      this.#activity = structuredClone(options.hydration.snapshot.activity)
      this.#sequence = this.#messages.at(-1)?.sequence ?? 0
      this.#cursor = options.hydration.snapshot.cursor
      for (const participant of this.#activity.participants) {
        this.#replyCounts.set(participant.name, participant.replies)
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
    const database = new PGlite()
    resources.defer(() => database.close())
    const streamStore = new SqliteStreamStore(":memory:")
    resources.defer(() => streamStore.close())
    const mailboxStore = new SqliteMailboxStore(":memory:")
    resources.defer(() => mailboxStore.close())
    const approvalMutex = new SqliteApprovalMutex(":memory:")
    resources.defer(() => approvalMutex.close())
    const boss = new PgBoss({ db: fromPglite(database), backend: "pglite" })
    boss.on("error", (error) => console.error("[queue error]", error))
    resources.defer(() => boss.stop({ close: false, graceful: false }))
    const store = new InMemoryContextStore()
    const participants: RunningParticipant[] = []
    let publishReply: (author: string, content: string) => Promise<boolean>

    await boss.start()
    for (const [index, participant] of options.participants.entries()) {
      const queue = new PgBossTurnQueue(boss, {
        queue: `zukhruf-whatsapp-${index}`,
        pollingIntervalSeconds: 0.5,
      })
      await queue.initialize()

      const runtime = new AgentRuntime(
        defineAgent({
          name: participant.name,
          model: participant.model,
          telemetry: participant.telemetry,
          sandbox: defineSandbox(() =>
            createVirtualSandbox({ fs: new InMemoryFs() })
          ),
          instructions: [
            role(
              [
                `You are ${participant.name} in a WhatsApp-style group chat. Your specialty is ${participant.specialty}. ${participant.instructions ?? ""}`,
                "Every turn is a notification containing new public group messages.",
                "New public messages may also arrive as mailbox communications between model steps; reconsider your planned contribution when they do.",
                "Read them and decide autonomously whether to participate.",
                "For casual or social messages, you may respond briefly when it fits your personality; silence is also natural, and the group should not answer in chorus.",
                "For substantive messages, reply only when your specialty gives you something useful and non-duplicative to add.",
                "If yes, call reply_to_group with the concise message you want everyone to see.",
                "If no, do not call reply_to_group. Do not reply merely to agree, repeat, or announce silence.",
                "Your ordinary assistant text is private and never appears in the group.",
              ].join(" ")
            ),
          ],
          tools: {
            ...participant.tools,
            reply_to_group: defineTool({
              description:
                "Post one useful contribution to the public group chat.",
              inputSchema: jsonSchema<{ message: string }>({
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    minLength: 1,
                    maxLength: 8_000,
                    pattern: "\\S",
                  },
                },
                required: ["message"],
                additionalProperties: false,
              }),
              execute: async ({ message }) => {
                return {
                  posted: await publishReply(participant.name, message.trim()),
                }
              },
            }),
          },
        }),
        {
          store,
          streamStore,
          queue,
          mailboxStore,
          approvalMutex,
        }
      )

      participants.push({
        name: participant.name,
        conversation: {
          chatId: `whatsapp-${index}`,
          userId: options.userId,
        },
        runtime,
        active: false,
      })
      resources.use(await runtime.work())
    }

    const group = new WhatsAppGroup(options, {
      disposables: resources.move(),
      participants,
    })
    publishReply = async (author, content) => {
      return group.#postParticipant(author, content)
    }
    return group
  }

  async send(
    content: string,
    onMessage?: WhatsAppGroupOptions["onMessage"],
    onActivity?: WhatsAppGroupOptions["onActivity"]
  ): Promise<readonly WhatsAppMessage[]> {
    using subscription = this.subscribe({ onMessage, onActivity })
    await this.post(content)
    await this.#whenSettled()
    return this.#messages
  }

  async post(content: string, id: string = randomUUID()) {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    const message = content.trim()
    if (!message) throw new Error("WhatsAppGroup message cannot be empty")
    if (!this.#pump) {
      this.#stopRequested = null
      this.#agentMessages = 0
    }
    return this.#post("user", message, id)
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
            .cancel(participant.turnId)
        )
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

  async #post(author: string, content: string, id: string = randomUUID()) {
    const existing = this.#messagesById.get(id)
    if (existing) return existing
    if (this.#messages.length >= this.#limits.transcriptMessages) {
      throw new WhatsAppGroupLimitError(
        "WhatsApp room transcript limit reached"
      )
    }

    const message = {
      id,
      sequence: ++this.#sequence,
      author,
      content,
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

  async #postParticipant(author: string, content: string) {
    if (this.#stopRequested) return false
    if (
      this.#agentMessages >= this.#limits.agentMessages ||
      this.#messages.length >= this.#limits.transcriptMessages
    ) {
      this.#stopRequested = "limit"
      return false
    }

    this.#agentMessages++
    await this.#post(author, content)
    return true
  }

  #ensurePump() {
    if (this.#pump) return
    const pump = Promise.resolve().then(() => this.#runPump())
    this.#pump = pump
    void pump.then(
      () => this.#finishPump(pump, true),
      () => this.#finishPump(pump, false)
    )
  }

  #finishPump(pump: Promise<void>, restart: boolean) {
    if (this.#pump === pump) this.#pump = null
    if (restart && this.#pending.length > 0) this.#ensurePump()
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
          ({ id, author }) =>
            author !== participant.name &&
            !this.#mailboxRecipients.get(id)?.has(participant.name)
        ),
      }))
      const recipients = batches
        .filter(({ notifications }) => notifications.length > 0)
        .map(({ participant }) => participant.name)
      if (recipients.length === 0) {
        for (const { id } of pending) this.#mailboxRecipients.delete(id)
        continue
      }

      notification++
      await this.#emitActivity({
        type: "notification",
        notification,
        messageCount: pending.length,
        recipients,
      })

      await Promise.all(
        batches.map(async ({ participant, notifications }) => {
          if (notifications.length === 0) return

          participant.active = true
          try {
            await this.#emitActivity({
              type: "participant",
              notification,
              participant: participant.name,
              state: "considering",
            })
            const repliesBefore = this.#replyCounts.get(participant.name) ?? 0
            const turn = await participant.runtime.enqueue(
              participant.conversation,
              {
                id: randomUUID(),
                input: WhatsAppGroup.#notification(notifications),
              }
            )
            participant.turnId = turn.id
            let failure: string | undefined
            await turn.stream.pipeTo(
              new WritableStream({
                write(part) {
                  if (part.type === "error") failure = part.errorText
                },
              })
            )
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
          } catch (error) {
            if (!this.#stopRequested) {
              await this.#emitActivity({
                type: "participant",
                notification,
                participant: participant.name,
                state: "failed",
              })
              console.error(
                `[group participant failed] ${participant.name}`,
                error
              )
            }
          } finally {
            participant.active = false
            participant.turnId = undefined
          }
        })
      )
      for (const { id } of pending) this.#mailboxRecipients.delete(id)
      if (this.#stopRequested) {
        this.#pending.length = 0
        await this.#emitStopped(this.#stopRequested)
        return
      }
    }

    await this.#emitActivity({ type: "settled", notifications: notification })
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
    this.#events.push(event)
    await this.#persist?.(this.snapshot(), event)
    await Promise.all(
      [...this.#subscribers].map((subscriber) =>
        this.#deliver(subscriber, event, () => subscriber.onMessage?.(message))
      )
    )
  }

  async #emitActivity(activity: WhatsAppGroupActivity) {
    this.#activity = reduceActivity(this.#activity, activity)
    const event = {
      cursor: ++this.#cursor,
      type: "activity" as const,
      activity,
    }
    this.#events.push(event)
    await this.#persist?.(this.snapshot(), event)
    await Promise.all(
      [...this.#subscribers].map((subscriber) =>
        this.#deliver(subscriber, event, () =>
          subscriber.onActivity?.(activity)
        )
      )
    )
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
    event: WhatsAppRoomEvent,
    legacyCallback?: () => void | Promise<void>
  ) {
    const delivery = subscriber.delivery.then(async () => {
      await subscriber.onEvent?.(event)
      await legacyCallback?.()
    })
    subscriber.delivery = delivery.catch(() => undefined)
    return delivery
  }

  static #notification(messages: WhatsAppMessage[]) {
    return [
      "New WhatsApp group messages:",
      "",
      ...messages.flatMap(({ author, content }) => [`${author}:`, content, ""]),
      "Reply only through reply_to_group when you have something useful to add.",
    ].join("\n")
  }

  async #deliverToActiveParticipants(message: WhatsAppMessage) {
    const recipients = this.#participants.filter(
      ({ active, name }) => active && name !== message.author
    )
    if (recipients.length === 0) return

    const eligibleRecipients = this.#participants.filter(
      ({ name }) => name !== message.author
    )
    const author =
      this.#participants.find(({ name }) => name === message.author)
        ?.conversation ?? this.#user
    const delivered = new Set<string>()
    this.#mailboxRecipients.set(message.id, delivered)

    await Promise.all(
      recipients.map(async (participant) => {
        await participant.runtime.deliver(
          createInterAgentCommunication({
            id: `${message.id}:${participant.conversation.chatId}`,
            author,
            recipient: participant.conversation,
            otherRecipients: eligibleRecipients
              .filter(({ name }) => name !== participant.name)
              .map(({ conversation }) => conversation),
            content: message.content,
            metadata: {
              roomMessageId: message.id,
              roomSequence: message.sequence,
              authorPath: message.author,
              recipientPath: participant.name,
              otherRecipientNames: eligibleRecipients
                .filter(({ name }) => name !== participant.name)
                .map(({ name }) => name),
            },
          }),
          MessageDeliveryMode.QueueOnly
        )
        delivered.add(participant.name)
      })
    )
  }

  static #validate(options: WhatsAppGroupOptions) {
    if (!options.userId.trim()) {
      throw new Error("WhatsAppGroup userId cannot be empty")
    }
    if (options.participants.length === 0) {
      throw new Error("WhatsAppGroup requires at least one participant")
    }
    const names = new Set<string>()
    for (const participant of options.participants) {
      if (
        !participant.name.trim() ||
        participant.name !== participant.name.trim() ||
        participant.name.length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(participant.name)
      ) {
        throw new Error(
          "WhatsAppGroup participant names must be valid, unpadded text"
        )
      }
      if (
        !participant.specialty.trim() ||
        participant.specialty !== participant.specialty.trim() ||
        participant.specialty.length > 200
      ) {
        throw new Error(
          "WhatsAppGroup participant specialties must be valid, unpadded text"
        )
      }
      if (participant.name.toLowerCase() === "user") {
        throw new Error(
          'WhatsAppGroup participant name "user" is reserved for the human author'
        )
      }
      const normalizedName = participant.name.toLowerCase()
      if (names.has(normalizedName)) {
        throw new Error(
          `WhatsAppGroup participant name "${participant.name}" is duplicated`
        )
      }
      names.add(normalizedName)
    }
    for (const [name, limit] of Object.entries({
      notifications: 25,
      agentMessages: 100,
      transcriptMessages: 500,
      ...options.limits,
    })) {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error(`WhatsAppGroup ${name} limit must be positive`)
      }
    }
  }
}

function reduceActivity(
  state: WhatsAppGroupActivityState,
  event: WhatsAppGroupActivity
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
