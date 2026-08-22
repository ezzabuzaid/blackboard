import type {
  ContextStore,
  MessageData,
  StreamData,
  StreamStore,
} from "@deepagents/context"
import type { ConversationId } from "@deepagents/experimental/zukhruf"

const MODELS_METADATA_KEY = "baseeraAgentExecutionModels"

export interface AgentExecutionUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  totalTokens: number
}

export interface AgentExecutionStep {
  stepNumber: number
  finishReason: string | null
  responseTimeMs: number | null
  usage: AgentExecutionUsage
  content: unknown[]
}

export interface AgentExecutionTurn {
  callId: string
  startedAt: string
  endedAt: string | null
  modelId: string
  notification: string | null
  status: "running" | "completed" | "failed" | "aborted"
  finishReason: string | null
  usage: AgentExecutionUsage
  steps: AgentExecutionStep[]
  error: string | null
}

export async function recordAgentExecutionModel(
  store: ContextStore,
  conversation: ConversationId,
  callId: string,
  modelId: string,
) {
  await store.updateChat(conversation.chatId, (chat) => ({
    metadata: {
      ...chat.metadata,
      [MODELS_METADATA_KEY]: {
        ...models(chat.metadata),
        [callId]: modelId,
      },
    },
  }))
}

export async function readAgentExecutions(
  store: ContextStore,
  streams: StreamStore,
  conversation: ConversationId,
  currentModelId: string,
) {
  const chat = await store.getChat(conversation.chatId)
  if (!chat || chat.userId !== conversation.userId) return []

  const recordedModels = models(chat.metadata)
  const turns: AgentExecutionTurn[] = []
  let notification: string | null = null
  for (const message of await store.getMessages(conversation.chatId)) {
    const data = record(message.data)
    const role = string(data?.role) ?? message.name
    if (role === "user") {
      notification = messageText(data?.parts)
      continue
    }
    if (role !== "assistant") continue

    const stream = await streams.getStream(message.id)
    turns.push(
      executionTurn(
        message,
        data,
        stream,
        notification,
        string(recordedModels?.[message.id]) ??
          (stream?.status === "queued" || stream?.status === "running"
            ? currentModelId
            : "unknown"),
      ),
    )
    notification = null
  }
  return turns
}

function executionTurn(
  message: MessageData,
  data: Record<string, unknown> | null,
  stream: StreamData | undefined,
  notification: string | null,
  modelId: string,
): AgentExecutionTurn {
  const metadata = record(data?.metadata)
  const finishReason = string(metadata?.finishReason)
  const turnUsage = usage(metadata?.totalUsage ?? metadata?.usage)
  const startedAt = stream?.startedAt ?? message.createdAt
  const endedAt = stream?.finishedAt ?? null
  return {
    callId: message.id,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: endedAt === null ? null : new Date(endedAt).toISOString(),
    modelId,
    notification,
    status: status(stream, finishReason),
    finishReason,
    usage: turnUsage,
    steps: steps(
      data?.parts,
      metadata?.usage,
      finishReason,
      startedAt,
      endedAt,
    ),
    error: stream?.error ?? null,
  }
}

function steps(
  value: unknown,
  lastStepUsage: unknown,
  finishReason: string | null,
  startedAt: number,
  endedAt: number | null,
): AgentExecutionStep[] {
  if (!Array.isArray(value)) return []
  const contents: unknown[][] = []
  let content: unknown[] | null = null
  for (const item of value) {
    const part = record(item)
    if (part?.type === "step-start") {
      if (content?.length) contents.push(content)
      content = []
      continue
    }
    const projected = projectPart(part)
    if (projected.length) (content ??= []).push(...projected)
  }
  if (content?.length) contents.push(content)

  return contents.map((content, index) => {
    const last = index === contents.length - 1
    return {
      stepNumber: index,
      finishReason: last ? finishReason : null,
      responseTimeMs:
        last && contents.length === 1 && endedAt !== null
          ? Math.max(0, endedAt - startedAt)
          : null,
      usage: last ? usage(lastStepUsage) : usage(null),
      content,
    }
  })
}

function projectPart(part: Record<string, unknown> | null): unknown[] {
  const type = string(part?.type)
  if (!part || !type) return []
  if (type === "text" || type === "reasoning") {
    const text = string(part.text)
    return text ? [{ type, text }] : []
  }
  if (type === "source-url") {
    return [{ type: "source", title: part.title, url: part.url }]
  }

  const toolName =
    type === "dynamic-tool"
      ? string(part.toolName)
      : type.startsWith("tool-")
        ? type.slice("tool-".length)
        : null
  const toolCallId = string(part.toolCallId)
  if (!toolName || !toolCallId) return [part]

  const projected: unknown[] = [
    {
      type: "tool-call",
      toolCallId,
      toolName,
      title: part.title,
      input: part.input,
    },
  ]
  if (Object.hasOwn(part, "output")) {
    projected.push({ type: "tool-result", toolCallId, output: part.output })
  } else if (typeof part.errorText === "string") {
    projected.push({
      type: "tool-result",
      toolCallId,
      output: { error: part.errorText },
    })
  } else if (part.state === "output-denied") {
    projected.push({
      type: "tool-result",
      toolCallId,
      output: { denied: true },
    })
  }
  return projected
}

function status(
  stream: StreamData | undefined,
  finishReason: string | null,
): AgentExecutionTurn["status"] {
  if (stream?.status === "failed") return "failed"
  if (stream?.status === "cancelled") return "aborted"
  if (stream?.status === "completed" || (!stream && finishReason)) {
    return "completed"
  }
  return "running"
}

function models(metadata: Record<string, unknown> | undefined) {
  return record(metadata?.[MODELS_METADATA_KEY])
}

function messageText(value: unknown) {
  if (!Array.isArray(value)) return null
  const text = value
    .map(record)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part!.text)
    .join("\n")
  return text || null
}

function usage(value: unknown): AgentExecutionUsage {
  const data = record(value)
  const inputDetails = record(data?.inputTokenDetails)
  const outputDetails = record(data?.outputTokenDetails)
  const inputTokens = tokens(data?.inputTokens)
  const outputTokens = tokens(data?.outputTokens)
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: tokens(outputDetails?.reasoningTokens),
    cacheReadTokens: tokens(inputDetails?.cacheReadTokens),
    totalTokens: tokens(data?.totalTokens) || inputTokens + outputTokens,
  }
}

function tokens(value: unknown) {
  return number(value) ?? number(record(value)?.total) ?? 0
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function string(value: unknown) {
  return typeof value === "string" ? value : null
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
