import { resolve } from "node:path"

import { openai } from "@ai-sdk/openai"
import { createFileTelemetry } from "@deepagents/context/telemetry/file"
import type { ConversationId } from "@deepagents/experimental/zukhruf"

import {
  WhatsAppGroup,
  type WhatsAppGroupLimits,
  type WhatsAppParticipant,
  type WhatsAppRoomEvent,
} from "./whatsapp.js"
import { WhatsAppRoomStore } from "./room-store.js"

export class WhatsAppChatRuntime implements AsyncDisposable {
  readonly #participants: WhatsAppParticipant[]
  readonly #chats = new Map<string, Promise<WhatsAppGroup>>()
  readonly #resources = new AsyncDisposableStack()
  readonly #store: WhatsAppRoomStore
  readonly #limits?: Partial<WhatsAppGroupLimits>

  constructor(
    participants = defaultParticipants(),
    {
      storagePath = resolve(
        process.env.ZUKHRUF_DATA_DIR ?? ".data/zukhruf",
        "group-rooms.sqlite"
      ),
      limits,
    }: {
      storagePath?: string
      limits?: Partial<WhatsAppGroupLimits>
    } = {}
  ) {
    this.#participants = participants
    this.#limits = limits
    this.#store = this.#resources.use(new WhatsAppRoomStore(storagePath))
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
    const hydration = this.#store.load(conversation)
    const participants = (
      hydration
        ? hydration.snapshot.participants.map(({ name, specialty }) => {
            const participant = this.#participants.find(
              (candidate) => candidate.name === name
            )
            if (!participant) {
              throw new Error(
                `Stored participant "${name}" is not configured in this runtime`
              )
            }
            return { ...participant, specialty }
          })
        : this.#participants
    ).map((participant) =>
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
      userId: conversation.userId,
      participants,
      hydration: hydration ?? undefined,
      limits: this.#limits,
      persist: (snapshot, event) =>
        this.#store.save(conversation, snapshot, event),
    })
    this.#resources.use(group)
    await group.recoverInterrupted()
    this.#store.save(conversation, group.snapshot())
    return group
  }
}

function defaultParticipants(): WhatsAppParticipant[] {
  const model = () => openai("gpt-5.6-luna")
  return [
    {
      name: "Maya",
      specialty: "Research",
      instructions:
        "You contribute evidence, concrete facts, and questions that need research. You are curious but socially reserved and sometimes respond to greetings.",
      model: model(),
      tools: {
        web_search: openai.tools.webSearch(),
      },
    },
    {
      name: "Omar",
      specialty: "Engineering",
      instructions:
        "You contribute technical feasibility, architecture, and implementation consequences. You are quiet in casual conversation and usually let others answer greetings.",
      model: model(),
    },
    {
      name: "Lina",
      specialty: "Product",
      instructions:
        "You contribute user needs, product scope, adoption, and business value. You are warm and welcoming and often respond to greetings.",
      model: model(),
    },
    {
      name: "Rami",
      specialty: "Critic",
      instructions:
        "You contribute contradictions, risks, missing assumptions, and failure modes. You are reserved and rarely respond to greetings.",
      model: model(),
    },
    {
      name: "Noor",
      specialty: "Creative alternatives",
      instructions:
        "You contribute useful alternatives and ideas that the others are unlikely to surface. You are playful and sociable and often respond briefly to casual messages.",
      model: model(),
    },
  ].map((participant, index) => ({
    ...participant,
    telemetry: {
      integrations: createFileTelemetry({
        path: resolve(
          process.env.ZUKHRUF_DATA_DIR ?? ".data/zukhruf",
          "group-telemetry",
          `${index}-${encodeURIComponent(participant.name).slice(0, 100)}.jsonl`
        ),
      }),
    },
  }))
}
