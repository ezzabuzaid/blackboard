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
  PgBossTurnQueue,
  SqliteApprovalMutex,
  SqliteMailboxStore,
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
  model: AgentModel
  tools?: ToolSet
}

export interface WhatsAppMessage {
  id: string
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

export interface WhatsAppGroupOptions {
  userId: string
  participants: WhatsAppParticipant[]
  onMessage?: (message: WhatsAppMessage) => void | Promise<void>
  onActivity?: (activity: WhatsAppGroupActivity) => void | Promise<void>
}

interface RunningParticipant {
  name: string
  conversation: { chatId: string; userId: string }
  runtime: AgentRuntime
}

class ReplyInbox {
  #replies: WhatsAppMessage[] = []

  post(author: string, content: string) {
    this.#replies.push({ id: randomUUID(), author, content })
  }

  drain() {
    return this.#replies.splice(0)
  }

  count(author: string) {
    return this.#replies.filter((reply) => reply.author === author).length
  }
}

export class WhatsAppGroup implements AsyncDisposable {
  readonly #boss: PgBoss
  readonly #database: PGlite
  readonly #streamStore: SqliteStreamStore
  readonly #mailboxStore: SqliteMailboxStore
  readonly #approvalMutex: SqliteApprovalMutex
  readonly #participants: RunningParticipant[]
  readonly #workers: AsyncDisposable[]
  readonly #replies: ReplyInbox
  readonly #onMessage?: WhatsAppGroupOptions["onMessage"]
  readonly #onActivity?: WhatsAppGroupOptions["onActivity"]
  readonly #messages: WhatsAppMessage[] = []
  #closed = false

  private constructor(
    options: WhatsAppGroupOptions,
    resources: {
      boss: PgBoss
      database: PGlite
      streamStore: SqliteStreamStore
      mailboxStore: SqliteMailboxStore
      approvalMutex: SqliteApprovalMutex
      participants: RunningParticipant[]
      workers: AsyncDisposable[]
      replies: ReplyInbox
    }
  ) {
    this.#boss = resources.boss
    this.#database = resources.database
    this.#streamStore = resources.streamStore
    this.#mailboxStore = resources.mailboxStore
    this.#approvalMutex = resources.approvalMutex
    this.#participants = resources.participants
    this.#workers = resources.workers
    this.#replies = resources.replies
    this.#onMessage = options.onMessage
    this.#onActivity = options.onActivity
  }

  static async create(options: WhatsAppGroupOptions) {
    WhatsAppGroup.#validate(options)

    const database = new PGlite()
    const boss = new PgBoss({ db: fromPglite(database), backend: "pglite" })
    boss.on("error", (error) => console.error("[queue error]", error))
    const streamStore = new SqliteStreamStore(":memory:")
    const mailboxStore = new SqliteMailboxStore(":memory:")
    const approvalMutex = new SqliteApprovalMutex(":memory:")
    const store = new InMemoryContextStore()
    const replies = new ReplyInbox()
    const participants: RunningParticipant[] = []
    const workers: AsyncDisposable[] = []

    try {
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
            sandbox: defineSandbox(() =>
              createVirtualSandbox({ fs: new InMemoryFs() })
            ),
            instructions: [
              role(
                [
                  `You are ${participant.name} in a WhatsApp-style group chat. ${participant.specialty}`,
                  "Every turn is a notification containing new public group messages.",
                  "Read them and decide autonomously whether your specialty gives you something useful and non-duplicative to add.",
                  "If yes, call reply_to_group with the concise message you want everyone to see.",
                  "If no, do not call reply_to_group. Do not reply merely to agree, repeat, acknowledge, or announce silence.",
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
                      pattern: "\\S",
                    },
                  },
                  required: ["message"],
                  additionalProperties: false,
                }),
                execute: async ({ message }) => {
                  replies.post(participant.name, message.trim())
                  return { posted: true }
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
        })
        workers.push(await runtime.work())
      }

      return new WhatsAppGroup(options, {
        boss,
        database,
        streamStore,
        mailboxStore,
        approvalMutex,
        participants,
        workers,
        replies,
      })
    } catch (error) {
      await WhatsAppGroup.#disposeResources({
        boss,
        database,
        streamStore,
        mailboxStore,
        approvalMutex,
        workers,
      })
      throw error
    }
  }

  async send(
    content: string,
    onMessage = this.#onMessage,
    onActivity = this.#onActivity
  ): Promise<readonly WhatsAppMessage[]> {
    if (this.#closed) throw new Error("WhatsAppGroup is closed")
    const message = content.trim()
    if (!message) throw new Error("WhatsAppGroup message cannot be empty")

    this.#replies.drain()
    let pending: WhatsAppMessage[] = [
      { id: randomUUID(), author: "user", content: message },
    ]
    let notification = 0
    await onActivity?.({
      type: "started",
      participants: this.#participants.map(({ name }) => name),
    })
    await this.#publish(pending, onMessage)

    while (pending.length > 0) {
      notification++
      const recipients = this.#participants
        .filter((participant) =>
          pending.some(({ author }) => author !== participant.name)
        )
        .map(({ name }) => name)
      await onActivity?.({
        type: "notification",
        notification,
        messageCount: pending.length,
        recipients,
      })

      await Promise.all(
        this.#participants.map(async (participant) => {
          const notifications = pending.filter(
            ({ author }) => author !== participant.name
          )
          if (notifications.length === 0) return

          await onActivity?.({
            type: "participant",
            notification,
            participant: participant.name,
            state: "considering",
          })
          const repliesBefore = this.#replies.count(participant.name)
          try {
            const turn = await participant.runtime.enqueue(
              participant.conversation,
              {
                id: randomUUID(),
                input: WhatsAppGroup.#notification(notifications),
              }
            )
            await turn.stream.pipeTo(new WritableStream())
            const replies =
              this.#replies.count(participant.name) - repliesBefore
            await onActivity?.({
              type: "participant",
              notification,
              participant: participant.name,
              state: replies > 0 ? "replied" : "passed",
              ...(replies > 0 ? { replies } : {}),
            })
          } catch (error) {
            await onActivity?.({
              type: "participant",
              notification,
              participant: participant.name,
              state: "failed",
            })
            throw error
          }
        })
      )

      pending = this.#replies.drain()
      await this.#publish(pending, onMessage)
    }

    await onActivity?.({ type: "settled", notifications: notification })
    return this.#messages
  }

  async [Symbol.asyncDispose]() {
    if (this.#closed) return
    this.#closed = true
    await WhatsAppGroup.#disposeResources({
      boss: this.#boss,
      database: this.#database,
      streamStore: this.#streamStore,
      mailboxStore: this.#mailboxStore,
      approvalMutex: this.#approvalMutex,
      workers: this.#workers,
    })
  }

  async #publish(
    messages: WhatsAppMessage[],
    onMessage: WhatsAppGroupOptions["onMessage"]
  ) {
    for (const message of messages) {
      this.#messages.push(message)
      await onMessage?.(message)
    }
  }

  static #notification(messages: WhatsAppMessage[]) {
    return [
      "New WhatsApp group messages:",
      "",
      ...messages.flatMap(({ author, content }) => [`${author}:`, content, ""]),
      "Reply only through reply_to_group when you have something useful to add.",
    ].join("\n")
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
        participant.name !== participant.name.trim()
      ) {
        throw new Error(
          "WhatsAppGroup participant names must be non-empty and unpadded"
        )
      }
      if (names.has(participant.name)) {
        throw new Error(
          `WhatsAppGroup participant name "${participant.name}" is duplicated`
        )
      }
      names.add(participant.name)
    }
  }

  static async #disposeResources(resources: {
    boss: PgBoss
    database: PGlite
    streamStore: SqliteStreamStore
    mailboxStore: SqliteMailboxStore
    approvalMutex: SqliteApprovalMutex
    workers: AsyncDisposable[]
  }) {
    for (const worker of resources.workers.toReversed()) {
      await worker[Symbol.asyncDispose]()
    }
    await resources.boss.stop({ graceful: false })
    await resources.database.close()
    resources.streamStore.close()
    resources.mailboxStore.close()
    resources.approvalMutex.close()
  }
}
