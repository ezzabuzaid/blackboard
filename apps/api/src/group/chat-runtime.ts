import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  PollingChangeSource,
  SqliteContextStore,
  SqliteStreamStore,
  StreamManager,
  type StreamPart,
} from "@deepagents/context"
import {
  SqliteMailboxStore,
  type AgentDeclaration,
  type AgentRuntimeInfo,
  type ConversationId,
  type TurnInput,
} from "@deepagents/experimental/zukhruf"

import {
  WhatsAppGroup,
  type WhatsAppChatEvent,
  type WhatsAppGroupLimits,
  type WhatsAppMessage,
  type WhatsAppMessageAnnotation,
  type WhatsAppParticipant,
} from "./whatsapp.js"
import { readAgentTraces } from "../traces/agent-traces.js"

const CHAT_EVENT_TYPE = "data-whatsapp-chat-event"

interface ChatSession {
  group: WhatsAppGroup
  participants: WhatsAppParticipant[]
  resources: AsyncDisposableStack
}

export class WhatsAppChatRuntime implements AsyncDisposable {
  readonly info: AgentRuntimeInfo = {
    root: "whatsapp-group",
    agents: [],
  }
  readonly #chats = new Map<string, Promise<ChatSession>>()
  readonly #resources = new AsyncDisposableStack()
  readonly #store: SqliteContextStore
  readonly #streamStore: SqliteStreamStore
  readonly #streams: StreamManager
  readonly #mailboxStore: SqliteMailboxStore
  readonly #limits: WhatsAppGroupLimits
  readonly #loadParticipants: (
    conversation: ConversationId
  ) => Promise<readonly WhatsAppParticipant[]>
  readonly #onMessage?: (
    conversation: ConversationId,
    message: WhatsAppMessage,
    cursor: number
  ) => void | Promise<void>
  readonly #sandboxForChat: (
    conversation: ConversationId
  ) => AgentDeclaration["sandbox"]
  readonly #queueDirectory: string

  constructor(options: {
    loadParticipants: (
      conversation: ConversationId
    ) => Promise<readonly WhatsAppParticipant[]>
    onMessage?: (
      conversation: ConversationId,
      message: WhatsAppMessage,
      cursor: number
    ) => void | Promise<void>
    limits: WhatsAppGroupLimits
    sandboxForChat: (
      conversation: ConversationId
    ) => AgentDeclaration["sandbox"]
    databasePath: string
    mailboxPath: string
    /** Root for the per-group queue databases that carry pending schedules. */
    queueDirectory: string
  }) {
    this.#loadParticipants = options.loadParticipants
    this.#onMessage = options.onMessage
    this.#limits = options.limits
    this.#sandboxForChat = options.sandboxForChat
    this.#queueDirectory = options.queueDirectory

    const database = new DatabaseSync(options.databasePath)
    this.#resources.defer(() => database.close())
    this.#store = new SqliteContextStore(database)
    this.#streamStore = new SqliteStreamStore(database)
    this.#streams = new StreamManager({
      store: this.#streamStore,
      changeSource: new PollingChangeSource({ reads: this.#streamStore }),
    })
    this.#mailboxStore = this.#resources.use(
      new SqliteMailboxStore(options.mailboxPath)
    )
  }

  async post(
    conversation: ConversationId,
    message: {
      id: string
      content: string
      replyToMessageId?: string
      annotations?: WhatsAppMessageAnnotation[]
    }
  ) {
    const { group } = await this.#chat(conversation)
    return group.post(
      message.content,
      message.id,
      message.replyToMessageId,
      message.annotations
    )
  }

  async createSession(conversation: ConversationId) {
    await this.#chat(conversation)
  }

  async sessionExists(conversation: ConversationId) {
    return Boolean(await this.#streamStore.getStream(streamId(conversation)))
  }

  async enqueue(conversation: ConversationId, turn: TurnInput) {
    const id = streamId(conversation)
    const { group } = await this.#chat(conversation)
    const stream = this.#watch(group)
    try {
      await group.post(turn.input, turn.id)
      return { id, stream }
    } catch (error) {
      await stream.cancel()
      throw error
    }
  }

  observe(conversation: ConversationId) {
    const id = streamId(conversation)
    return {
      status: async (turnId?: string) => {
        if (turnId !== undefined && turnId !== id) return undefined
        const stream = await this.#streamStore.getStream(id)
        return stream
          ? {
              status: stream.status,
              startedAt: stream.startedAt,
              finishedAt: stream.finishedAt,
              error: stream.error,
            }
          : undefined
      },
      cancel: async () => {
        await this.stop(conversation)
      },
      resume: async () => {
        if (!(await this.sessionExists(conversation))) return null
        const { group } = await this.#chat(conversation)
        return this.#watch(group)
      },
    }
  }

  async snapshot(conversation: ConversationId) {
    const { group } = await this.#chat(conversation)
    return group.snapshot()
  }

  async transcript(conversation: ConversationId) {
    const messages: WhatsAppMessage[] = []
    for (const event of await this.#durableEvents(streamId(conversation))) {
      if (event.type === "message") messages.push(event.message)
    }
    const participants = (await this.#loadChatParticipants(conversation)).map(
      ({ name }) => ({ name })
    )
    return { messages, participants }
  }

  async replayMessages(conversation: ConversationId) {
    await this.#projectMessages(
      conversation,
      await this.#durableEvents(streamId(conversation))
    )
  }

  async stop(conversation: ConversationId) {
    const { group } = await this.#chat(conversation)
    return group.stop()
  }

  /**
   * Disposal must precede deletion: tearing the group down persists a final
   * stopped event, which fails the stream's foreign key once the row is gone.
   */
  async clear(conversation: ConversationId) {
    const key = conversation.chatId
    const pending = this.#chats.get(key)
    this.#chats.delete(key)
    const session = await pending?.catch(() => undefined)
    await session?.resources.disposeAsync()

    await rm(this.#queuePath(conversation), { recursive: true, force: true })

    await this.#streamStore.deleteStream(streamId(conversation))

    const { userId } = conversation
    const prefix = `${key}:participant:`
    const roots = (await this.#store.listChats({ userId })).filter(({ id }) =>
      id.startsWith(prefix)
    )
    for (const root of roots) {
      const tree = await this.#store.listChats({
        metadata: { key: "zukhrufTreeId", value: root.id },
      })
      for (const id of new Set([...tree.map(({ id }) => id), root.id])) {
        await this.#store.deleteChat(id, { userId })
      }
      await this.#mailboxStore.drain({ chatId: root.id, userId })
    }
  }

  async traces(conversation: ConversationId, participantName: string) {
    const { participants } = await this.#chat(conversation)
    const participant = participants.find(
      ({ name }) => name === participantName
    )
    if (!participant?.tracePath) return null
    return {
      agent: participant.name,
      turns: await readAgentTraces(
        participant.tracePath,
        `${conversation.chatId}:${participant.name}`
      ),
    }
  }

  async [Symbol.asyncDispose]() {
    const sessions = await Promise.allSettled(this.#chats.values())
    await Promise.allSettled(
      sessions.map((session) =>
        session.status === "fulfilled"
          ? session.value.resources.disposeAsync()
          : undefined
      )
    )
    await this.#resources.disposeAsync()
  }

  #chat(conversation: ConversationId) {
    const key = conversation.chatId
    const existing = this.#chats.get(key)
    if (existing) return existing

    const chat = this.#createChat(conversation)
    this.#chats.set(key, chat)
    void chat.catch(() => {
      if (this.#chats.get(key) === chat) this.#chats.delete(key)
    })
    return chat
  }

  async #createChat(conversation: ConversationId) {
    const id = streamId(conversation)
    const now = Date.now()
    await this.#streamStore.upsertStream({
      id,
      status: "running",
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      cancelRequestedAt: null,
      error: null,
    })
    const events = await this.#durableEvents(id)
    await this.#projectMessages(conversation, events)
    const participants = [...(await this.#loadChatParticipants(conversation))]
    const loadParticipants = async () => {
      const loaded = await this.#loadChatParticipants(conversation)
      const names = new Set(
        participants.map(({ name }) => name.toLocaleLowerCase("en"))
      )
      for (const participant of loaded) {
        const name = participant.name.toLocaleLowerCase("en")
        if (names.has(name)) continue
        participants.push(participant)
        names.add(name)
      }
      return loaded
    }
    const group = await WhatsAppGroup.create({
      conversation,
      participants,
      loadParticipants,
      queuePath: this.#queuePath(conversation),
      sandbox: this.#sandboxForChat(conversation),
      store: this.#store,
      streams: this.#streams,
      mailboxStore: this.#mailboxStore,
      events,
      limits: this.#limits,
      onMessage: (message, cursor) =>
        this.#onMessage?.(conversation, message, cursor),
      persist: (event) =>
        this.#streamStore.appendChunks([
          {
            streamId: id,
            seq: event.cursor,
            data: { type: CHAT_EVENT_TYPE, data: event },
            createdAt: Date.now(),
          },
        ]),
    })
    const resources = new AsyncDisposableStack()
    resources.use(group)
    await group.recoverInterrupted()
    return { group, participants, resources }
  }

  async #durableEvents(id: string) {
    return (await this.#streamStore.getChunks(id))
      .map(({ seq, data, createdAt }) => chatEvent(data, seq, createdAt))
      .filter(
        (event) =>
          event.type !== "activity" || event.activity.type !== "presence"
      )
  }

  async #projectMessages(
    conversation: ConversationId,
    events: readonly WhatsAppChatEvent[]
  ) {
    if (!this.#onMessage) return
    for (const event of events) {
      if (event.type === "message") {
        await this.#onMessage(conversation, event.message, event.cursor)
      }
    }
  }

  #watch(group: WhatsAppGroup) {
    let subscription: Disposable | undefined
    let closed = false
    return new ReadableStream<StreamPart>({
      start(controller) {
        subscription = group.subscribe({
          after: 0,
          onEvent(event) {
            if (closed) return
            controller.enqueue({ type: CHAT_EVENT_TYPE, data: event })
          },
        })
      },
      cancel() {
        closed = true
        subscription?.[Symbol.dispose]()
      },
    })
  }

  #queuePath(conversation: ConversationId) {
    return resolve(this.#queueDirectory, encodeURIComponent(conversation.chatId))
  }

  async #loadChatParticipants(conversation: ConversationId) {
    return (await this.#loadParticipants(conversation)).map((participant) =>
      participant.telemetry
        ? {
            ...participant,
            telemetry: {
              ...participant.telemetry,
              functionId: `${conversation.chatId}:${participant.name}`,
            },
          }
        : participant
    )
  }
}

function streamId(conversation: ConversationId) {
  return JSON.stringify(["whatsapp-chat", conversation.chatId])
}

function chatEvent(part: StreamPart, sequence: number, createdAt: number) {
  if (
    part.type !== CHAT_EVENT_TYPE ||
    typeof part.data !== "object" ||
    part.data === null ||
    !("cursor" in part.data) ||
    part.data.cursor !== sequence
  ) {
    throw new Error(`Invalid WhatsApp chat event at sequence ${sequence}`)
  }
  const event = part.data as WhatsAppChatEvent
  if (event.type !== "message") return event

  return {
    ...event,
    message: {
      ...event.message,
      sentAt: event.message.sentAt ?? new Date(createdAt).toISOString(),
      replyToMessageId: event.message.replyToMessageId ?? null,
      annotations: event.message.annotations ?? [],
    },
  }
}
