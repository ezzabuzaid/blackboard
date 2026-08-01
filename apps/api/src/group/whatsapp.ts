import { randomUUID } from "node:crypto"

import {
  type AgentModel,
  type ContextStore,
  type StreamManager,
  role,
} from "@deepagents/context"
import {
  AgentRuntime,
  MessageDeliveryMode,
  PgBossTurnQueue,
  type AgentDeclaration,
  type ConversationId,
  type MailboxStore,
  createInterAgentCommunication,
  defineAgent,
  defineTool,
} from "@deepagents/experimental/zukhruf"
import { PGlite } from "@electric-sql/pglite"
import { jsonSchema, type ToolSet } from "ai"
import { PgBoss, fromPglite } from "pg-boss"

export interface WhatsAppParticipant {
  name: string
  source: string
  instructions?: string
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
}

export type WhatsAppParticipantPresence = "idle" | "reading" | "typing" | "seen"

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
  participants: { name: string; source: string }[]
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
  sandbox: AgentDeclaration["sandbox"]
  store: ContextStore
  streams: StreamManager
  mailboxStore: MailboxStore
  events: WhatsAppChatEvent[]
  limits: WhatsAppGroupLimits
  persist: (event: WhatsAppChatEvent) => void | Promise<void>
  onMessage?: (message: WhatsAppMessage) => void | Promise<void>
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
  conversation: ConversationId
  runtime: AgentRuntime
  active: boolean
  seenThroughSequence: number
  turnId?: string
}

type WhatsAppReplyResult =
  | { posted: true }
  | { posted: false; reason: "stopped" | "limit" }
  | {
      posted: false
      reason: "transcript_changed"
      messages: WhatsAppMessage[]
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
  readonly #profiles: { name: string; source: string }[]
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
    }
  ) {
    this.#resources = resources.disposables
    this.#participants = resources.participants
    this.#user = options.conversation
    this.#profiles = options.participants.map(({ name, source }) => ({
      name,
      source,
    }))
    this.#limits = options.limits
    this.#persist = options.persist
    for (const event of structuredClone(options.events)) {
      this.#events.push(event)
      this.#cursor = event.cursor
      if (event.type === "message") {
        const { message } = event
        this.#messages.push(message)
        this.#messagesById.set(message.id, message)
        this.#sequence = message.sequence
        if (message.author !== "user") {
          this.#replyCounts.set(
            message.author,
            (this.#replyCounts.get(message.author) ?? 0) + 1
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
    const database = new PGlite()
    resources.defer(() => database.close())
    const boss = new PgBoss({ db: fromPglite(database), backend: "pglite" })
    boss.on("error", (error) => console.error("[queue error]", error))
    resources.defer(() => boss.stop({ close: false, graceful: true }))
    const participants: RunningParticipant[] = []
    let publishReply: (
      author: string,
      content: string,
      replyToMessageId?: string
    ) => Promise<WhatsAppReplyResult>

    await boss.start()
    for (const [index, participant] of options.participants.entries()) {
      const queue = new PgBossTurnQueue(boss, {
        queue: `zukhruf-whatsapp-${index}`,
        schema: "pgboss",
        pollingIntervalSeconds: 0.5,
      })
      await queue.initialize()

      const runtime = new AgentRuntime(
        defineAgent({
          name: participant.name,
          model: participant.model,
          telemetry: participant.telemetry,
          sandbox: options.sandbox,
          instructions: [
            role(
              [
                `You are ${participant.name} in a WhatsApp-style group chat. You own this data source: ${participant.source}. ${participant.instructions ?? ""}`,
                "Every turn is a notification containing new public group messages.",
                "New public messages may also arrive as mailbox communications between model steps; reconsider your planned contribution when they do.",
                "Read them and decide autonomously whether to participate.",
                "For casual or social messages, you may respond briefly; silence is also natural, and the group should not answer in chorus.",
                "For substantive messages, reply only when your owned data source gives you something useful and non-duplicative to add.",
                `When the user explicitly asks for exactly one answer, only the named participant may reply; if nobody is named, only ${options.participants[0]!.name} may reply. Every other participant must stay silent.`,
                "A short, unaddressed user follow-up or acknowledgment belongs to the participant who authored the immediately preceding public reply. If that was not you, stay silent. An explicit participant name or request to the whole group overrides this.",
                "If yes, call reply_to_group with the concise message you want everyone to see.",
                "If reply_to_group reports transcript_changed, reconsider the new messages and either retry with a distinct contribution or remain silent.",
                "If no, do not call reply_to_group. Do not reply merely to agree, repeat, or announce silence.",
                "Your ordinary assistant text is private and never appears in the group.",
              ].join(" ")
            ),
          ],
          tools: {
            ...participant.tools,
            reply_to_group: defineTool({
              description:
                "Post one useful contribution to the public group chat. Cite web sources with standard Markdown links containing full URLs, and never include private citation markers such as cite....",
              inputSchema: jsonSchema<{
                message: string
                replyToMessageId?: string
              }>({
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    minLength: 1,
                    maxLength: 8_000,
                    pattern: "\\S",
                  },
                  replyToMessageId: {
                    type: "string",
                    minLength: 1,
                    maxLength: 200,
                    description:
                      "Optional UI pointer to one earlier public message. Omit replyToMessageId by default. Set it only to emphasize a particular earlier message or when directly replying to another participant's message. Do not set it merely because your contribution answers the latest user message or continues the current discussion.",
                  },
                },
                required: ["message"],
                additionalProperties: false,
              }),
              execute: async ({ message, replyToMessageId }) => {
                return publishReply(
                  participant.name,
                  message.trim(),
                  replyToMessageId
                )
              },
            }),
          },
        }),
        {
          store: options.store,
          streams: options.streams,
          queue,
          mailboxStore: options.mailboxStore,
        }
      )

      participants.push({
        name: participant.name,
        conversation: {
          chatId: `${options.conversation.chatId}:participant:${index}`,
          userId: options.conversation.userId,
        },
        runtime,
        active: false,
        seenThroughSequence: 0,
      })
      resources.use(await runtime.work())
    }

    const group = new WhatsAppGroup(options, {
      disposables: resources.move(),
      participants,
    })
    publishReply = async (author, content, replyToMessageId) => {
      return group.#postParticipant(author, content, replyToMessageId)
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

  async post(
    content: string,
    id: string = randomUUID(),
    replyToMessageId?: string
  ) {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    const message = content.trim()
    if (!message) throw new Error("WhatsAppGroup message cannot be empty")
    if (!this.#pump) {
      this.#stopRequested = null
      this.#agentMessages = 0
    }
    return this.#post("user", message, id, replyToMessageId)
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

  async #post(
    author: string,
    content: string,
    id: string = randomUUID(),
    replyToMessageId?: string
  ) {
    const existing = this.#messagesById.get(id)
    if (existing) return existing
    if (this.#messages.length >= this.#limits.transcriptMessages) {
      throw new WhatsAppGroupLimitError(
        "WhatsApp chat transcript limit reached"
      )
    }
    if (replyToMessageId && !this.#messagesById.has(replyToMessageId)) {
      throw new WhatsAppReplyTargetError("Reply target was not found")
    }

    const message = {
      id,
      sequence: ++this.#sequence,
      author,
      content,
      sentAt: new Date().toISOString(),
      replyToMessageId: replyToMessageId ?? null,
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
    replyToMessageId?: string
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
        messageAuthor !== author && sequence > participant.seenThroughSequence
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
    await this.#post(author, content, randomUUID(), replyToMessageId)
    return { posted: true }
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

          participant.seenThroughSequence = Math.max(
            participant.seenThroughSequence,
            notifications.at(-1)!.sequence
          )
          participant.active = true
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
            const turn = await participant.runtime.enqueue(
              participant.conversation,
              {
                id: randomUUID(),
                input: this.#notification(notifications),
              }
            )
            participant.turnId = turn.id
            let failure: string | undefined
            const typingCalls = new Set<string>()
            await turn.stream.pipeTo(
              new WritableStream({
                write: async (part) => {
                  if (part.type === "error") failure = part.errorText
                  if (
                    (part.type === "tool-input-start" ||
                      part.type === "tool-input-available") &&
                    part.toolName === "reply_to_group" &&
                    !typingCalls.has(part.toolCallId)
                  ) {
                    typingCalls.add(part.toolCallId)
                    await this.#emitActivity({
                      type: "presence",
                      notification,
                      participant: participant.name,
                      state: "typing",
                    })
                  }
                  if (
                    part.type === "tool-output-available" &&
                    typingCalls.delete(part.toolCallId)
                  ) {
                    await this.#emitActivity({
                      type: "presence",
                      notification,
                      participant: participant.name,
                      state: "reading",
                    })
                  }
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
    await this.#persist(event)
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
    await this.#persist(event)
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
    event: WhatsAppChatEvent,
    legacyCallback?: () => void | Promise<void>
  ) {
    const delivery = subscriber.delivery.then(async () => {
      await subscriber.onEvent?.(event)
      await legacyCallback?.()
    })
    subscriber.delivery = delivery.catch(() => undefined)
    return delivery
  }

  #notification(messages: WhatsAppMessage[]) {
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
      "Reply only through reply_to_group when you have something useful to add.",
      "Omit replyToMessageId by default. It points to one earlier public message in the UI; use it only to emphasize that message or when directly replying to another participant. Do not use it for an ordinary response to the latest user message or current discussion.",
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
            content: message.replyToMessageId
              ? `${this.#replyContext(message.replyToMessageId)}\n${
                  message.content
                }`
              : message.content,
            metadata: {
              chatMessageId: message.id,
              chatSequence: message.sequence,
              replyToMessageId: message.replyToMessageId,
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
    if (!options.conversation.userId.trim()) {
      throw new Error("WhatsAppGroup userId cannot be empty")
    }
    if (!options.conversation.chatId.trim()) {
      throw new Error("WhatsAppGroup chatId cannot be empty")
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
        !participant.source.trim() ||
        participant.source !== participant.source.trim() ||
        participant.source.length > 200
      ) {
        throw new Error(
          "WhatsAppGroup participant sources must be valid, unpadded text"
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
    for (const [name, limit] of Object.entries(options.limits)) {
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
