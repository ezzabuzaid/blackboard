import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import {
  type AgentStack,
  PgBossTurnQueue,
  defineStack,
} from '@deepagents/experimental/zukhruf';
import {
  PgBossWakeScheduler,
  type SchedulingWake,
  conversationSchedulingCapabilities,
} from '@deepagents/experimental/zukhruf/conversation-scheduling';
import { PGlite } from '@electric-sql/pglite';
import { PgBoss, fromPglite } from 'pg-boss';

export async function createGroupQueue(
  resources: AsyncDisposableStack,
  queuePath: string | undefined,
) {
  if (queuePath) mkdirSync(queuePath, { recursive: true });
  const database = resources.use(new PGlite(queuePath));
  const boss = new PgBoss({ db: fromPglite(database), backend: 'pglite' });
  boss.on('error', (error) => console.error('[queue error]', error));
  resources.defer(() => boss.stop({ close: false, graceful: true }));
  await boss.start();
  return boss;
}

export function createStack(
  boss: PgBoss,
  participantName: string,
  options: Required<
    Pick<
      Awaited<ReturnType<AgentStack>>,
      'store' | 'streams' | 'mailboxStore' | 'bindings'
    >
  >,
) {
  const participantSlug = queueSlug(participantName);
  return defineStack(async () => {
    const queue = new PgBossTurnQueue(boss, {
      queue: `zukhruf-whatsapp-${participantSlug}`,
      schema: 'pgboss',
      pollingIntervalSeconds: 0.5,
    });
    await queue.initialize();
    const wakes = new PgBossWakeScheduler<SchedulingWake>(boss, {
      queue: `zukhruf-whatsapp-wakes-${participantSlug}`,
      pollingIntervalSeconds: 0.5,
    });
    await wakes.initialize();

    return {
      store: options.store,
      streams: options.streams,
      queue,
      mailboxStore: options.mailboxStore,
      bindings: [
        ...options.bindings,
        conversationSchedulingCapabilities.scheduler.bind(wakes),
        conversationSchedulingCapabilities.timezone.bind(
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        ),
      ],
    };
  });
}

/** Queue names must be stable per participant identity: with a durable queue database, drifting names would hand one participant another's pending turns and wakes. */
function queueSlug(name: string) {
  const base = name
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return base ? `${base}-${digest}` : digest;
}
