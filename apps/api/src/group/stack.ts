import { hash } from 'node:crypto';
import { join } from 'node:path';

import {
  type AgentPluginBinding,
  EmbeddedAgentStorage,
  defineStack,
} from '@deepagents/experimental/zukhruf';
import {
  PgBossWakeScheduler,
  type SchedulingWake,
  conversationSchedulingCapabilities,
} from '@deepagents/experimental/zukhruf/conversation-scheduling';

/** Each participant runs on its own storage, whose turns and wakes only its runtime consumes. */
export function openParticipantStorage(
  groupDirectory: string,
  participantName: string,
) {
  return EmbeddedAgentStorage.open({
    directory: join(groupDirectory, storageSlug(participantName)),
  });
}

export function createStack(
  storage: EmbeddedAgentStorage,
  bindings: readonly AgentPluginBinding[],
) {
  return defineStack(async () => {
    const wakes = new PgBossWakeScheduler<SchedulingWake>(storage.boss, {
      queue: 'zukhruf-whatsapp-wakes',
      pollingIntervalSeconds: 0.5,
    });
    await wakes.initialize();

    return {
      storage,
      bindings: [
        ...bindings,
        conversationSchedulingCapabilities.scheduler.bind(wakes),
        conversationSchedulingCapabilities.timezone.bind(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
        conversationSchedulingCapabilities.clock.bind(globalThis),
      ],
    };
  });
}

/** Storage directories must be stable per participant identity: drifting names would hand one participant another's conversations, pending turns and wakes. */
function storageSlug(name: string) {
  const base = name
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const digest = hash('sha256', name).slice(0, 8);
  return base ? `${base}-${digest}` : digest;
}
