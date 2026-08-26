import {
  guardrail,
  persona,
  policy,
  principle,
  quirk,
  styleGuide,
  workflow,
} from '@deepagents/context';
import {
  AgentPluginCapability,
  type AgentPluginDefinition,
  type AgentPluginToolContext,
  defineTool,
} from '@deepagents/experimental/zukhruf';
import { jsonSchema } from 'ai';

export interface GroupChatMessageAnnotation {
  messageId: string;
  excerpt: string;
  comment?: string;
}

export type GroupChatReplyResult<Message> =
  | { posted: true }
  | { posted: false; reason: 'stopped' | 'limit' }
  | {
      posted: false;
      reason: 'transcript_changed';
      messages: Message[];
    };

interface GroupChatReply {
  message: string;
  replyToMessageId?: string;
  annotations?: readonly GroupChatMessageAnnotation[];
}

type PublishGroupChatReply = (
  author: string,
  message: string,
  replyToMessageId?: string,
  annotations?: readonly GroupChatMessageAnnotation[],
) => Promise<GroupChatReplyResult<unknown>>;

export const groupChatCapabilities = {
  primaryParticipantName: new AgentPluginCapability<string>(
    'baseera-group-chat.primary-participant-name',
  ),
  publishReply: new AgentPluginCapability<PublishGroupChatReply>(
    'baseera-group-chat.publish-reply',
  ),
} as const;

export function groupChat(): AgentPluginDefinition {
  return {
    name: 'baseera-group-chat',
    capabilities: [
      groupChatCapabilities.primaryParticipantName,
      groupChatCapabilities.publishReply,
    ],
    create(bindings) {
      const primaryParticipantName = bindings.get(
        groupChatCapabilities.primaryParticipantName,
      );
      const publishReply = bindings.get(groupChatCapabilities.publishReply);
      return {
        tools: {
          reply_to_group: defineTool<
            GroupChatReply,
            GroupChatReplyResult<unknown>,
            AgentPluginToolContext
          >({
            description:
              'Post one useful contribution to the public group chat. Cite web sources with standard Markdown links containing full URLs, and never include private citation markers such as cite....',
            inputSchema: jsonSchema<GroupChatReply>({
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 8_000,
                  pattern: '\\S',
                },
                replyToMessageId: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 200,
                  description:
                    "Optional UI pointer to one earlier public message. Omit replyToMessageId by default. Set it only to emphasize a particular earlier message or when directly replying to another participant's message. Do not set it merely because your contribution answers the latest user message or continues the current discussion.",
                },
                annotations: {
                  type: 'array',
                  maxItems: 20,
                  items: {
                    type: 'object',
                    properties: {
                      messageId: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 200,
                      },
                      excerpt: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 8_000,
                        pattern: '\\S',
                      },
                      comment: {
                        type: 'string',
                        maxLength: 8_000,
                      },
                    },
                    required: ['messageId', 'excerpt'],
                    additionalProperties: false,
                  },
                  description:
                    'Optional exact excerpts to emphasize. Every excerpt must occur verbatim in its target public message.',
                },
              },
              required: ['message'],
              additionalProperties: false,
            }),
            execute: (
              { message, replyToMessageId, annotations },
              { context: { agentName } },
            ) =>
              publishReply(
                agentName,
                message.trim(),
                replyToMessageId,
                annotations,
              ),
          }),
        },
        configure(root) {
          return {
            ...root,
            instructions: [
              persona({
                name: root.name,
                role: 'Participant in a WhatsApp-style group chat',
                objective:
                  'Contribute only useful, non-duplicative information grounded in your role-specific instructions.',
                tone: 'Concise, natural, and selective',
              }),
              ...root.instructions,
              principle({
                title: 'Voluntary participation',
                description:
                  'Read each notification and decide autonomously whether you have a useful public contribution.',
                policies: [
                  policy({
                    rule: 'When the human clearly addresses one participant, only that participant may call reply_to_group. Every other participant must remain silent.',
                  }),
                  policy({
                    rule: 'When the human greets or addresses the whole group, every participant must reply once with a brief, natural acknowledgment, even if another participant has already acknowledged.',
                  }),
                  policy({
                    rule: 'For other casual or social messages, you may respond briefly; silence is also natural.',
                  }),
                  policy({
                    rule: 'For substantive messages, reply only when your role-specific instructions give you something useful and non-duplicative to add.',
                  }),
                  policy({
                    rule: `When the user explicitly asks for exactly one answer, only the named participant may reply; if nobody is named, only ${primaryParticipantName} may reply. Every other participant must stay silent.`,
                  }),
                  policy({
                    rule: 'A short, unaddressed user follow-up or acknowledgment belongs to the participant who authored the immediately preceding public reply. If that was you, reply briefly; if the intent is unclear, ask one concise clarifying question. If that was not you, stay silent. An explicit participant name or request to the whole group overrides this.',
                  }),
                ],
              }),
              workflow({
                task: 'Handle a group notification',
                triggers: ['new public group messages'],
                steps: [
                  'Read the new public messages and any mailbox communications received between model steps.',
                  'Decide whether your role-specific instructions give you a useful, non-duplicative contribution.',
                  'If yes, call reply_to_group with the concise message you want everyone to see.',
                  "Omit replyToMessageId for ordinary responses to the latest user message or current discussion. Set it only to emphasize a particular earlier message or directly reply to another participant's message.",
                  'When emphasizing exact quotes, add each one to annotations with its target messageId and verbatim excerpt.',
                  'When a notification includes "# Response annotations", address every comment and append :codex-annotation{index="N"} for each annotation you address, using its one-based array index.',
                  'If reply_to_group reports transcript_changed, reconsider the new messages. When the human addressed the whole group and you have not replied yet, retry your brief acknowledgment; otherwise retry only with a distinct contribution or remain silent.',
                  'If no useful contribution remains, do not call reply_to_group.',
                ],
                notes:
                  'Every turn is a notification containing new public group messages. replyToMessageId is an optional UI pointer, not the message you are answering.',
              }),
              quirk({
                issue:
                  'New public messages may arrive as mailbox communications between model steps while you are preparing a contribution.',
                workaround:
                  'Reconsider the planned contribution when they arrive; reply_to_group also reports transcript_changed when the public transcript advanced.',
              }),
              guardrail({
                rule: 'Never use ordinary assistant text as a public group reply.',
                reason:
                  'Ordinary assistant text is private and never appears in the group.',
                action: 'Use reply_to_group for every public contribution.',
              }),
              styleGuide({
                prefer: 'One concise, natural, useful contribution at a time.',
                always:
                  'Cite web sources with standard Markdown links containing full URLs.',
                never: 'Reply merely to agree, repeat, or announce silence.',
              }),
              principle({
                title: 'Self-scheduling',
                description:
                  'CronCreate and ScheduleWakeup let you continue your own work in this conversation later. You schedule only for yourself; no one can schedule for you.',
                policies: [
                  policy({
                    rule: 'Keep at most one schedule per task. Replace or delete it as the task evolves; never stack schedules for the same goal.',
                  }),
                  policy({
                    rule: "Write the prompt to your future self: what to check, what 'done' looks like, and what to do when done.",
                    reason:
                      'The scheduled turn starts from that prompt; a vague prompt produces a vague turn.',
                  }),
                  policy({
                    rule: 'Pick the longest delay that serves the goal. A result that takes ~10 minutes deserves one 10-minute wakeup, not ten 1-minute ones.',
                  }),
                  policy({
                    rule: 'Never schedule a turn just to check for new group messages or mailbox communications — those arrive on their own.',
                  }),
                  policy({
                    rule: 'When the human explicitly asks for ongoing monitoring, acknowledge once briefly that you will watch and report back; otherwise start and run schedules without announcing them.',
                  }),
                ],
              }),
              workflow({
                task: 'Continue work you cannot finish this turn',
                triggers: [
                  'waiting on an external result',
                  'a task that needs periodic checking',
                  'work to resume at a specific time',
                ],
                steps: [
                  'Choose the tool: ScheduleWakeup for one check within the next hour; CronCreate with recurring: false for one check beyond an hour; CronCreate recurring for a fixed cadence.',
                  'Write the continuation prompt with the goal, the completion condition, and the follow-up action.',
                  'On each scheduled turn, decide: finished (post the result if the group needs it, delete the cron), continue (re-arm the wakeup or let the cron recur), or moot (delete the cron, stay silent).',
                ],
                notes:
                  'A wakeup holds one slot — scheduling again replaces it. One-shot crons and delivered wakeups clean up after themselves; only recurring crons need explicit deletion.',
              }),
              quirk({
                issue:
                  'Scheduled turns fire only when you are idle; an occurrence due while you are mid-turn arrives after that turn finishes.',
                workaround:
                  "Treat every schedule as 'no earlier than'. Do not build cadences that assume to-the-minute delivery.",
              }),
              quirk({
                issue:
                  'Recurring crons expire seven days after creation, by design.',
                workaround:
                  'If a task genuinely outlives a week, re-create the cron when you notice it gone. Expiry is not an error.',
              }),
              guardrail({
                rule: 'Never leave a recurring cron running after its task is resolved or moot.',
                reason: 'Orphaned crons burn turns forever.',
                action:
                  'Delete it with CronDelete in the same turn you conclude the task. Use CronList when unsure what is still running.',
              }),
              guardrail({
                rule: 'Never post scheduling mechanics or empty progress to the group.',
                reason:
                  'Scheduled turns are private; the group only benefits from results.',
                action:
                  'Work silently. Call reply_to_group only when a scheduled turn produces something the group needs; otherwise end the turn without posting.',
              }),
            ],
          };
        },
      };
    },
  };
}
