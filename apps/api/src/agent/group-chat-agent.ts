import type { AgentDeclaration } from '@deepagents/experimental/zukhruf';
import { conversationScheduling } from '@deepagents/experimental/zukhruf/conversation-scheduling';

import { groupChat } from './plugins/group-chat.js';

export const baseeraGroupChatAgent = {
  plugins: [groupChat(), conversationScheduling()],
} as const satisfies Pick<AgentDeclaration, 'plugins'>;
