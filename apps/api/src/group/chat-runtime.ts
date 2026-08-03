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
  type ConversationId,
} from "@deepagents/experimental/zukhruf"

import {
  WhatsAppGroup,
  type WhatsAppChatEvent,
  type WhatsAppGroupLimits,
  type WhatsAppParticipant,
} from "./whatsapp.js"
import { readAgentTraces } from "../traces/agent-traces.js"

const CHAT_EVENT_TYPE = "data-whatsapp-chat-event"

interface ChatSession {
  group: WhatsAppGroup
  participants: WhatsAppParticipant[]
}

export class WhatsAppChatRuntime implements AsyncDisposable {
  readonly #chats = new Map<string, Promise<ChatSession>>()
  readonly #resources = new AsyncDisposableStack()
  readonly #store: SqliteContextStore
  readonly #streamStore: SqliteStreamStore
  readonly #streams: StreamManager
  readonly #mailboxStore: SqliteMailboxStore
  readonly #limits: WhatsAppGroupLimits
  readonly #loadParticipants: (
    userId: string
  ) => Promise<readonly WhatsAppParticipant[]>
  readonly #sandboxForChat: (
    conversation: ConversationId
  ) => AgentDeclaration["sandbox"]

  constructor(options: {
    loadParticipants: (
      userId: string
    ) => Promise<readonly WhatsAppParticipant[]>
    limits: WhatsAppGroupLimits
    sandboxForChat: (
      conversation: ConversationId
    ) => AgentDeclaration["sandbox"]
    databasePath: string
    mailboxPath: string
  }) {
    this.#loadParticipants = options.loadParticipants
    this.#limits = options.limits
    this.#sandboxForChat = options.sandboxForChat

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
    message: { id: string; content: string; replyToMessageId?: string }
  ) {
    const { group } = await this.#chat(conversation)
    return group.post(message.content, message.id, message.replyToMessageId)
  }

  async snapshot(conversation: ConversationId) {
    const { group } = await this.#chat(conversation)
    return group.snapshot()
  }

  async subscribe(
    conversation: ConversationId,
    after: number,
    onEvent: (event: WhatsAppChatEvent) => void | Promise<void>
  ) {
    const { group } = await this.#chat(conversation)
    return group.subscribe({ after, onEvent })
  }

  async stop(conversation: ConversationId) {
    const { group } = await this.#chat(conversation)
    return group.stop()
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
    await Promise.allSettled(this.#chats.values())
    await this.#resources.disposeAsync()
  }

  #chat(conversation: ConversationId) {
    const key = conversation.chatId
    const existing = this.#chats.get(key)
    if (existing) return existing

    const chat = this.#createChat(conversation)
    this.#chats.set(key, chat)
    void chat.catch(() => this.#chats.delete(key))
    return chat
  }

  async #createChat(conversation: ConversationId) {
    const streamId = JSON.stringify(["whatsapp-chat", conversation.chatId])
    const now = Date.now()
    await this.#streamStore.upsertStream({
      id: streamId,
      status: "running",
      createdAt: now,
      startedAt: now,
      finishedAt: null,
      cancelRequestedAt: null,
      error: null,
    })
    const events = (await this.#streamStore.getChunks(streamId)).map(
      ({ seq, data, createdAt }) => chatEvent(data, seq, createdAt)
    )
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
      sandbox: this.#sandboxForChat(conversation),
      store: this.#store,
      streams: this.#streams,
      mailboxStore: this.#mailboxStore,
      events,
      limits: this.#limits,
      persist: (event) =>
        this.#streamStore.appendChunks([
          {
            streamId,
            seq: event.cursor,
            data: { type: CHAT_EVENT_TYPE, data: event },
            createdAt: Date.now(),
          },
        ]),
    })
    this.#resources.use(group)
    await group.recoverInterrupted()
    return { group, participants }
  }

  async #loadChatParticipants(conversation: ConversationId) {
    return (await this.#loadParticipants(conversation.userId)).map(
      (participant) =>
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
    },
  }
}
