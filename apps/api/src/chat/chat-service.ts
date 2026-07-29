import type {
  AgentRuntime,
  ConversationId,
} from "@deepagents/experimental/zukhruf"
import type { UIMessage } from "ai"

interface ChatObservation {
  engine: {
    getMessages(): Promise<UIMessage[]>
    headMessage(): Promise<{ id: string; name: string } | undefined>
  }
  resume(): ReturnType<ReturnType<AgentRuntime["observe"]>["resume"]>
}

export interface ChatRuntime {
  enqueue: AgentRuntime["enqueue"]
  observe(conversation: ConversationId): ChatObservation
}

export interface ChatStreamStore {
  getStreamStatus(streamId: string): Promise<unknown>
}

export interface ChatSnapshot {
  messages: UIMessage[]
  resume: boolean
  streamId: string | null
}

export class ChatService {
  readonly #runtime: ChatRuntime
  readonly #streams: ChatStreamStore

  constructor(runtime: ChatRuntime, streams: ChatStreamStore) {
    this.#runtime = runtime
    this.#streams = streams
  }

  async snapshot(conversation: ConversationId): Promise<ChatSnapshot> {
    const observation = this.#runtime.observe(conversation)
    const head = await observation.engine.headMessage()
    const streamId =
      head?.name === "assistant" &&
      (await this.#streams.getStreamStatus(head.id)) !== null
        ? head.id
        : null
    const messages = await observation.engine.getMessages()

    return {
      messages: streamId
        ? messages.filter((message) => message.id !== streamId)
        : messages,
      resume: streamId !== null,
      streamId,
    }
  }

  enqueue(
    conversation: ConversationId,
    turn: Parameters<AgentRuntime["enqueue"]>[1]
  ) {
    return this.#runtime.enqueue(conversation, turn)
  }

  resume(conversation: ConversationId) {
    return this.#runtime.observe(conversation).resume()
  }
}
