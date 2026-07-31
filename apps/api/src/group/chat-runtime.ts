import { DatabaseSync } from "node:sqlite"

import {
  SqliteContextStore,
  SqliteStreamStore,
  type StreamPart,
} from "@deepagents/context"
import {
  SqliteApprovalMutex,
  SqliteMailboxStore,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"

import {
  WhatsAppGroup,
  type WhatsAppGroupLimits,
  type WhatsAppParticipant,
  type WhatsAppRoomEvent,
} from "./whatsapp.js"
import { readAgentTraces } from "../traces/agent-traces.js"

const CHAT_EVENT_TYPE = "data-whatsapp-chat-event"

export class WhatsAppChatRuntime implements AsyncDisposable {
  readonly #participants: readonly WhatsAppParticipant[]
  readonly #chats = new Map<string, Promise<WhatsAppGroup>>()
  readonly #resources = new AsyncDisposableStack()
  readonly #store: SqliteContextStore
  readonly #streamStore: SqliteStreamStore
  readonly #mailboxStore: SqliteMailboxStore
  readonly #approvalMutex: SqliteApprovalMutex
  readonly #limits: WhatsAppGroupLimits
  readonly #sandboxForChat: (
    conversation: ConversationId
  ) => AgentDeclaration["sandbox"]

  constructor(options: {
    participants: readonly WhatsAppParticipant[]
    limits: WhatsAppGroupLimits
    sandboxForChat: (
      conversation: ConversationId
    ) => AgentDeclaration["sandbox"]
    databasePath: string
    mailboxPath: string
    approvalPath: string
  }) {
    this.#participants = options.participants
    this.#limits = options.limits
    this.#sandboxForChat = options.sandboxForChat

    const database = new DatabaseSync(options.databasePath)
    this.#resources.defer(() => database.close())
    this.#store = new SqliteContextStore(database)
    this.#streamStore = new SqliteStreamStore(database)
    this.#mailboxStore = this.#resources.use(
      new SqliteMailboxStore(options.mailboxPath)
    )
    this.#approvalMutex = this.#resources.use(
      new SqliteApprovalMutex(options.approvalPath)
    )
  }

  async post(
    conversation: ConversationId,
    message: { id: string; content: string }
  ) {
    const group = await this.#chat(conversation)
    return group.post(message.content, message.id)
  }

  async snapshot(conversation: ConversationId) {
    const group = await this.#chat(conversation)
    return group.snapshot()
  }

  async subscribe(
    conversation: ConversationId,
    after: number,
    onEvent: (event: WhatsAppRoomEvent) => void | Promise<void>
  ) {
    const group = await this.#chat(conversation)
    return group.subscribe({ after, onEvent })
  }

  async stop(conversation: ConversationId) {
    const group = await this.#chat(conversation)
    return group.stop()
  }

  async traces(conversation: ConversationId, participantName: string) {
    const participant = this.#participants.find(
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
    const key = JSON.stringify([conversation.userId, conversation.chatId])
    const existing = this.#chats.get(key)
    if (existing) return existing

    const chat = this.#createChat(conversation)
    this.#chats.set(key, chat)
    void chat.catch(() => this.#chats.delete(key))
    return chat
  }

  async #createChat(conversation: ConversationId) {
    const streamId = JSON.stringify([
      "whatsapp-chat",
      conversation.userId,
      conversation.chatId,
    ])
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
      ({ seq, data }) => chatEvent(data, seq)
    )
    const participants = this.#participants.map((participant) =>
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
    const group = await WhatsAppGroup.create({
      conversation,
      participants,
      sandbox: this.#sandboxForChat(conversation),
      store: this.#store,
      streamStore: this.#streamStore,
      mailboxStore: this.#mailboxStore,
      approvalMutex: this.#approvalMutex,
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
    return group
  }
}

function chatEvent(part: StreamPart, sequence: number) {
  if (
    part.type !== CHAT_EVENT_TYPE ||
    typeof part.data !== "object" ||
    part.data === null ||
    !("cursor" in part.data) ||
    part.data.cursor !== sequence
  ) {
    throw new Error(`Invalid WhatsApp chat event at sequence ${sequence}`)
  }
  return part.data as WhatsAppRoomEvent
}
