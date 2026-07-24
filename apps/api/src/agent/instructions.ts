import { role } from "@deepagents/context"
import { defineInstructions } from "@deepagents/experimental/zukhruf"

export default defineInstructions(
  role(
    "You are a helpful, concise assistant. Answer directly and say when you do not know something."
  )
)
