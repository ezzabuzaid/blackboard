import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { ToolSet } from "ai"

export function createParticipantDefaults(options: {
  apiKey: string
  modelId?: string
  appUrl?: string
}) {
  const modelId = options.modelId || "openrouter/auto"
  const openrouter = createOpenRouter({
    apiKey: options.apiKey,
    compatibility: "strict",
    appName: "Baseera",
    appUrl: options.appUrl,
  })

  console.log(`Using OpenRouter model ${modelId}`)
  return {
    model: openrouter(modelId),
    tools: {
      web_search: openrouter.tools.webSearch({}) as unknown as ToolSet[string],
    },
  }
}
