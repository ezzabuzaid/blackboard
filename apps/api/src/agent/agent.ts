import { resolve } from "node:path"

import { openai } from "@ai-sdk/openai"
import { createFileTelemetry } from "@deepagents/context/telemetry/file"
import { defineAgent } from "@deepagents/experimental/zukhruf"

import instructions from "./instructions.js"
import sandbox from "./sandbox.js"

export const assistant = defineAgent({
  name: "LocalAssistant",
  model: openai("gpt-5.6-luna"),
  sandbox,
  instructions,
  telemetry: {
    integrations: createFileTelemetry({
      path: resolve(
        process.env.ZUKHRUF_DATA_DIR ?? ".data/zukhruf",
        "telemetry.jsonl"
      ),
    }),
  },
})
