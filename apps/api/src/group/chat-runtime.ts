import { randomUUID } from "node:crypto"

import { openai } from "@ai-sdk/openai"
import type {
  ConversationId,
  TurnInput,
} from "@deepagents/experimental/zukhruf"
import { createUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"

import {
  WhatsAppGroup,
  type WhatsAppGroupActivity,
  type WhatsAppMessage,
  type WhatsAppParticipant,
} from "./whatsapp.js"

type GroupMessageData = {
  groupActivity: WhatsAppGroupActivity
  groupMessage: WhatsAppMessage
}

export type GroupUIMessage = UIMessage<unknown, GroupMessageData>

interface GroupChat {
  group: WhatsAppGroup
  messages: GroupUIMessage[]
}

export class WhatsAppChatRuntime implements AsyncDisposable {
  readonly #participants: WhatsAppParticipant[]
  readonly #chats = new Map<string, Promise<GroupChat>>()

  constructor(participants = defaultParticipants()) {
    this.#participants = participants
  }

  async enqueue(conversation: ConversationId, turn: TurnInput) {
    const chat = await this.#chat(conversation)
    const streamId = randomUUID()
    chat.messages = [
      ...chat.messages,
      {
        id: turn.id,
        role: "user",
        parts: [{ type: "text", text: turn.input }],
      },
    ]

    const stream = createUIMessageStream<GroupUIMessage>({
      originalMessages: chat.messages,
      execute: async ({ writer }) => {
        writer.write({ type: "start", messageId: streamId })
        await chat.group.send(
          turn.input,
          (message) => {
            if (message.author === "user") return
            writer.write({
              type: "data-groupMessage",
              id: message.id,
              data: message,
            })
          },
          (activity) => {
            writer.write({
              type: "data-groupActivity",
              data: activity,
              transient: true,
            })
          }
        )
        writer.write({ type: "finish", finishReason: "stop" })
      },
      onEnd: ({ messages }) => {
        chat.messages = messages
      },
    })

    return { id: streamId, stream }
  }

  observe(conversation: ConversationId) {
    const key = JSON.stringify([conversation.userId, conversation.chatId])
    return {
      engine: {
        getMessages: async () => {
          const chat = this.#chats.get(key)
          return chat ? (await chat).messages : []
        },
        headMessage: async () => undefined,
      },
      resume: async (): Promise<ReadableStream<UIMessageChunk> | null> => null,
    }
  }

  async [Symbol.asyncDispose]() {
    for (const chat of this.#chats.values()) {
      const resolved = await chat.catch(() => null)
      await resolved?.group[Symbol.asyncDispose]()
    }
  }

  #chat(conversation: ConversationId) {
    const key = JSON.stringify([conversation.userId, conversation.chatId])
    const existing = this.#chats.get(key)
    if (existing) return existing

    const chat = WhatsAppGroup.create({
      userId: conversation.userId,
      participants: this.#participants,
    }).then((group) => ({ group, messages: [] }))
    this.#chats.set(key, chat)
    void chat.catch(() => this.#chats.delete(key))
    return chat
  }
}

function defaultParticipants(): WhatsAppParticipant[] {
  const model = () => openai("gpt-5.6-terra")
  return [
    {
      name: "researcher",
      specialty:
        "You contribute evidence, concrete facts, and questions that need research.",
      model: model(),
      tools: {
        web_search: openai.tools.webSearch(),
      },
    },
    {
      name: "engineer",
      specialty:
        "You contribute technical feasibility, architecture, and implementation consequences.",
      model: model(),
    },
    {
      name: "product",
      specialty:
        "You contribute user needs, product scope, adoption, and business value.",
      model: model(),
    },
    {
      name: "critic",
      specialty:
        "You contribute contradictions, risks, missing assumptions, and failure modes.",
      model: model(),
    },
    {
      name: "creative",
      specialty:
        "You contribute useful alternatives and ideas that the others are unlikely to surface.",
      model: model(),
    },
  ]
}
