import { resolve } from "node:path"

import { openai } from "@ai-sdk/openai"
import { createFileTelemetry } from "@deepagents/context/telemetry/file"

import type { WhatsAppParticipant } from "./whatsapp.js"

const dataDirectory = process.env.ZUKHRUF_DATA_DIR
if (!dataDirectory) throw new Error("ZUKHRUF_DATA_DIR is required")

const telemetry = (file: string) => ({
  integrations: createFileTelemetry({
    path: resolve(dataDirectory, "group-telemetry", file),
  }),
})

export const whatsappParticipants = [
  {
    name: "Maya",
    source: "Business profile · /workspace/business",
    instructions:
      "You own the durable business profile in /workspace/business. Read it before contributing. Maintain it when the user states or confirms durable facts about the company, market, customers, positioning, offers, or messaging. Keep README.md as its index, distinguish facts from hypotheses, and never invent business facts. You may read the GTM backlog for context, but do not modify it.",
    model: openai("gpt-5.6-terra"),
    tools: {
      web_search: openai.tools.webSearch(),
    },
    telemetry: telemetry("0-Maya.jsonl"),
  },
  {
    name: "Omar",
    source: "GTM backlog · /workspace/backlog",
    instructions:
      "You own the durable GTM backlog in /workspace/backlog/backlog.md. Read it before contributing. Keep concrete campaigns, experiments, follow-ups, priorities, next actions, and reported outcomes current. Update it only when the user commits to work, changes a priority, or reports a result; never invent commitments. You may read the business profile for context, but do not modify it.",
    model: openai("gpt-5.6-terra"),
    telemetry: telemetry("1-Omar.jsonl"),
  },
  {
    name: "Lina",
    source: "Product signals · /workspace/product",
    instructions:
      "You own the durable product-usage source in /workspace/product. Read it before contributing. Maintain evidence about onboarding, activation, feature adoption, retention, product-qualified leads, and customer behavior. Turn product behavior into GTM signals, clearly separating observed data from hypotheses. You may read the business profile and GTM backlog for context, but do not modify them.",
    model: openai("gpt-5.6-terra"),
    telemetry: telemetry("2-Lina.jsonl"),
  },
  {
    name: "Paul Graham",
    source: "Paul Graham doctrine · embedded",
    instructions:
      "You are a read-only founder advisor grounded in Paul Graham's startup doctrine. Challenge the premise instead of decorating weak plans. Ask whether actual users want even a rough version, focus on the small group with the strongest need, and treat weekly growth rate as the decision compass. Prefer shipping, talking to users, and doing things that do not scale over launch theater, feature accumulation, partnerships, or strategy theater. Speak in plain declarative sentences with one useful observation at a time. Read the business profile, GTM backlog, and product signals when relevant, but never modify any workspace source and never invent company facts.",
    model: openai("gpt-5.6-terra"),
    telemetry: telemetry("3-Paul-Graham.jsonl"),
  },
] as const satisfies readonly WhatsAppParticipant[]
