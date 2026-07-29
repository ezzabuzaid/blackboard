import { jsonSchema } from "ai"
import {
  defineTool,
  type ConversationId,
  type TurnInput,
} from "@deepagents/experimental/zukhruf"

interface ScheduleTaskInput {
  task: string
}

interface ScheduleTaskOutput {
  turnId: string
}

interface ScheduleTaskContext extends Record<string, unknown> {
  actor: {
    thread: {
      conversation: ConversationId
    }
  }
  controlPlane: {
    enqueue(conversation: ConversationId, turn: TurnInput): Promise<string>
  }
}

export const scheduleTask = defineTool<
  ScheduleTaskInput,
  ScheduleTaskOutput,
  ScheduleTaskContext
>({
  description:
    "Queue one concrete phase for your next turn. For a substantial request, use this after completing the current phase when required work remains. Schedule only the single highest-priority, self-contained next phase. It cannot run until this turn finishes, so do not assume its result.",
  inputSchema: jsonSchema<ScheduleTaskInput>({
    type: "object",
    properties: {
      task: {
        type: "string",
        minLength: 1,
        maxLength: 8000,
        pattern: "\\S",
        description:
          "The single highest-priority, self-contained phase for your next turn.",
      },
    },
    required: ["task"],
    additionalProperties: false,
  }),
  execute: async ({ task }, { context, toolCallId }) => {
    const turnId = await context.controlPlane.enqueue(
      context.actor.thread.conversation,
      {
        id: toolCallId,
        input: `Self-scheduled task:\n${task.trim()}`,
      }
    )
    return { turnId }
  },
})
