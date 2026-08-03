import { api } from "../api"

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

export type AgentTraceItem =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | {
      type: "tool"
      name: string
      title: string | null
      input: unknown
      output: unknown
    }
  | { type: "source"; title: string | null; url: string }
  | { type: "raw"; label: string; value: unknown }

export async function fetchAgentTraces(
  chatId: string,
  agent: string,
  signal: AbortSignal
) {
  const value: unknown = await api.request(
    "GET /api/chat/{chatId}/agents/{agent}/traces",
    { chatId, agent },
    { signal }
  )
  if (!isAgentTraceResponse(value)) {
    throw new Error("Agent traces could not be loaded.")
  }
  return value.turns
}

export function traceItems(content: unknown[]): AgentTraceItem[] {
  const calls = new Set(
    content.flatMap((value) => {
      const part = record(value)
      const id = part?.type === "tool-call" ? string(part.toolCallId) : null
      return id ? [id] : []
    })
  )
  const results = new Map(
    content.flatMap((value) => {
      const part = record(value)
      const id = part?.type === "tool-result" ? string(part.toolCallId) : null
      return id ? [[id, part] as const] : []
    })
  )

  return content.flatMap((value) => {
    const part = record(value)
    if (!part) return [{ type: "raw", label: "Unknown", value }]
    if (part.type === "tool-result") {
      return calls.has(string(part.toolCallId) ?? "") ? [] : [raw(part)]
    }
    if (part.type === "tool-call") {
      const result = results.get(string(part.toolCallId) ?? "")
      return [
        {
          type: "tool",
          name: string(part.toolName) ?? "tool",
          title: definedString(part.title),
          input: part.input,
          output: result?.output,
        },
      ]
    }
    if (part.type === "reasoning" || part.type === "text") {
      const text = string(part.text)
      return text ? [{ type: part.type, text }] : []
    }
    if (part.type === "source" && string(part.url)) {
      return [
        {
          type: "source",
          title: string(part.title),
          url: string(part.url)!,
        },
      ]
    }
    return [raw(part)]
  })
}

function raw(value: unknown): AgentTraceItem {
  const part = record(value)
  return {
    type: "raw",
    label: string(part?.type) ?? "Unknown",
    value,
  }
}

function isAgentTraceResponse(
  value: unknown
): value is { agent: string; turns: AgentTraceTurn[] } {
  const response = record(value)
  return (
    typeof response?.agent === "string" &&
    Array.isArray(response.turns) &&
    response.turns.every(isAgentTraceTurn)
  )
}

function isAgentTraceTurn(value: unknown): value is AgentTraceTurn {
  const turn = record(value)
  return (
    !!turn &&
    typeof turn.callId === "string" &&
    typeof turn.startedAt === "string" &&
    (turn.endedAt === null || typeof turn.endedAt === "string") &&
    typeof turn.modelId === "string" &&
    ["running", "completed", "failed", "aborted"].includes(
      String(turn.status)
    ) &&
    Array.isArray(turn.steps) &&
    turn.steps.every(isAgentTraceStep) &&
    isAgentTraceUsage(turn.usage)
  )
}

function isAgentTraceStep(value: unknown): value is AgentTraceStep {
  const step = record(value)
  return (
    !!step &&
    typeof step.stepNumber === "number" &&
    Array.isArray(step.content) &&
    isAgentTraceUsage(step.usage)
  )
}

function isAgentTraceUsage(value: unknown): value is AgentTraceUsage {
  const usage = record(value)
  return (
    !!usage &&
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.reasoningTokens,
      usage.cacheReadTokens,
      usage.totalTokens,
    ].every((tokens) => typeof tokens === "number")
  )
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function string(value: unknown) {
  return typeof value === "string" ? value : null
}

function definedString(value: unknown) {
  const text = string(value)
  return text === "[Undefined]" ? null : text
}
