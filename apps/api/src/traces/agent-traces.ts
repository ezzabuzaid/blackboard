import { createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"

export interface AgentTraceUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  totalTokens: number
}

export interface AgentTraceStep {
  stepNumber: number
  finishReason: string | null
  responseTimeMs: number | null
  usage: AgentTraceUsage
  content: unknown[]
}

export interface AgentTraceTurn {
  callId: string
  startedAt: string
  endedAt: string | null
  modelId: string
  notification: string | null
  status: "running" | "completed" | "failed" | "aborted"
  finishReason: string | null
  usage: AgentTraceUsage
  steps: AgentTraceStep[]
  error: string | null
}

export async function readAgentTraces(path: string, functionId: string) {
  const turns = new Map<string, AgentTraceTurn>()
  if (!existsSync(path)) return []
  const marker = JSON.stringify(functionId)
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    if (!line.includes(marker)) continue
    const entry = parseRecord(line)
    const data = record(entry?.data)
    const callId = string(data?.callId)
    if (
      !entry ||
      !data ||
      data.functionId !== functionId ||
      !callId ||
      !string(entry.timestamp)
    ) {
      continue
    }

    const current =
      turns.get(callId) ?? emptyTurn(callId, string(entry.timestamp)!)
    if (entry.event === "onStart") {
      current.startedAt = string(entry.timestamp)!
      current.modelId = string(data.modelId) ?? current.modelId
      current.notification = latestMessage(data.messages)
    } else if (entry.event === "onEnd") {
      current.endedAt = string(entry.timestamp)!
      current.status = "completed"
      current.modelId = modelId(data.model) ?? current.modelId
      current.finishReason = string(data.finishReason)
      current.usage = usage(data.totalUsage ?? data.usage)
      current.steps = steps(data.steps)
    } else if (entry.event === "onError" || entry.event === "onAbort") {
      current.endedAt = string(entry.timestamp)!
      current.status = entry.event === "onAbort" ? "aborted" : "failed"
      current.error = errorMessage(data.error)
    }
    turns.set(callId, current)
  }

  return [...turns.values()].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt)
  )
}

function emptyTurn(callId: string, startedAt: string): AgentTraceTurn {
  return {
    callId,
    startedAt,
    endedAt: null,
    modelId: "unknown",
    notification: null,
    status: "running",
    finishReason: null,
    usage: usage(null),
    steps: [],
    error: null,
  }
}

function steps(value: unknown): AgentTraceStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((value, index) => {
    const step = record(value)
    if (!step) return []
    const performance = record(step.performance)
    return [
      {
        stepNumber: number(step.stepNumber) ?? index,
        finishReason: string(step.finishReason),
        responseTimeMs: number(performance?.responseTimeMs),
        usage: usage(step.usage),
        content: Array.isArray(step.content) ? step.content : [],
      },
    ]
  })
}

function usage(value: unknown): AgentTraceUsage {
  const data = record(value)
  const inputDetails = record(data?.inputTokenDetails)
  const outputDetails = record(data?.outputTokenDetails)
  return {
    inputTokens: number(data?.inputTokens) ?? 0,
    outputTokens: number(data?.outputTokens) ?? 0,
    reasoningTokens: number(outputDetails?.reasoningTokens) ?? 0,
    cacheReadTokens: number(inputDetails?.cacheReadTokens) ?? 0,
    totalTokens: number(data?.totalTokens) ?? 0,
  }
}

function latestMessage(value: unknown) {
  if (!Array.isArray(value)) return null
  const message = [...value]
    .reverse()
    .map(record)
    .find((message) => message?.role === "user")
  if (!message) return null
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return null
  const text = message.content
    .map(record)
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part!.text)
    .join("\n")
  return text || null
}

function modelId(value: unknown) {
  if (typeof value === "string") return value
  return string(record(value)?.modelId)
}

function errorMessage(value: unknown) {
  if (typeof value === "string") return value
  const error = record(value)
  return (
    string(error?.message) ?? (value == null ? null : JSON.stringify(value))
  )
}

function parseRecord(value: string) {
  try {
    return record(JSON.parse(value))
  } catch {
    return null
  }
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
