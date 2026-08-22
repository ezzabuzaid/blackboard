import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  PollingChangeSource,
  SqliteContextStore,
  SqliteStreamStore,
  StreamManager,
  createVirtualSandbox,
} from '@deepagents/context';
import {
  SqliteMailboxStore,
  defineSandbox,
} from '@deepagents/experimental/zukhruf';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { DrainContext } from 'evlog';
import { InMemoryFs } from 'just-bash';

import { type AppDependencies, createApp } from './app.js';
import { createAuthentication } from './auth.js';
import { WhatsAppChatRuntime } from './group/chat-runtime.js';
import type { GroupRecord } from './group/group-store.js';
import { groupTemplates } from './group/group-template-catalog.js';
import {
  type MarketplaceGroupTemplate,
  MarketplaceGroupTemplateStore,
} from './group/marketplace-group-template-store.js';
import { ParticipantDirectory } from './group/participants/index.js';
import {
  createWhatsAppSandbox,
  shareSandboxInstance,
} from './group/sandbox.js';
import {
  type WhatsAppChatEvent,
  WhatsAppGroup,
  WhatsAppGroupLimitError,
  type WhatsAppParticipant,
  WhatsAppReplyTargetError,
} from './group/whatsapp.js';
import { createParticipantDefaults } from './participant-defaults.js';
import type { OpenArtifact } from './routes/chat.route.js';
import { openArtifact } from './sandbox.js';
import { readAgentTraces } from './traces/agent-traces.js';
import { createOpenRouterTranscriber } from './transcription.js';

type ChatRuntime = AppDependencies['runtime'];

const testGroupSandbox = shareSandboxInstance(
  defineSandbox(() => createVirtualSandbox({ fs: new InMemoryFs() })),
);
const testDataDirectory = '/test/zukhruf';
const testGroupConversation = { chatId: 'test-chat', userId: 'user-1' };
const testGroupLimits = {
  notifications: 25,
  agentMessages: 100,
  transcriptMessages: 500,
};
const testCreatedAt = '2026-08-04T00:00:00.000Z';

function testGroupRecord(
  id: string,
  name: string,
  agentIds: readonly string[],
): GroupRecord {
  return {
    id,
    name,
    agentIds,
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
  };
}

function testGroupDependencies(resources: AsyncDisposableStack) {
  const database = new DatabaseSync(':memory:');
  resources.defer(() => database.close());
  const streamStore = new SqliteStreamStore(database);
  return {
    store: new SqliteContextStore(database),
    streams: new StreamManager({
      store: streamStore,
      changeSource: new PollingChangeSource({ reads: streamStore }),
    }),
    mailboxStore: resources.use(new SqliteMailboxStore(':memory:')),
    events: [],
    limits: testGroupLimits,
    persist: async () => {},
  };
}

// Each PGlite queue is a full Postgres data directory (~39MB), so the root is
// wiped once per run rather than accumulating across runs.
const testQueueRoot = join(tmpdir(), 'zukhruf-test-queues');
rmSync(testQueueRoot, { recursive: true, force: true });
let testQueueSeq = 0;
const testQueueDirectory = () =>
  join(testQueueRoot, `runtime-${++testQueueSeq}`);

function memoryRuntime(participants: WhatsAppParticipant[]) {
  return new WhatsAppChatRuntime({
    loadParticipants: async () => participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ':memory:',
    mailboxPath: ':memory:',
    queueDirectory: testQueueDirectory(),
  });
}

function durableRuntime(
  participants: WhatsAppParticipant[],
  directory: string,
) {
  return new WhatsAppChatRuntime({
    loadParticipants: async () => participants,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: join(directory, 'group.sqlite'),
    mailboxPath: join(directory, 'mailbox.sqlite'),
    queueDirectory: join(directory, 'queues'),
  });
}

const unusedRuntime: ChatRuntime = {
  info: { root: 'test', agents: [] },
  async createSession() {
    throw new Error('Unexpected session creation');
  },
  async sessionExists() {
    return false;
  },
  async enqueue() {
    throw new Error('Unexpected enqueue');
  },
  observe() {
    return {
      async status() {
        throw new Error('Unexpected status lookup');
      },
      async cancel() {
        throw new Error('Unexpected cancellation');
      },
      async resume() {
        throw new Error('Unexpected resume');
      },
    };
  },
  async post() {
    throw new Error('Unexpected post');
  },
  async snapshot() {
    throw new Error('Unexpected snapshot');
  },
  async stop() {
    throw new Error('Unexpected stop');
  },
  async traces() {
    throw new Error('Unexpected traces');
  },
  async transcript() {
    throw new Error('Unexpected transcript');
  },
  async clear() {
    throw new Error('Unexpected clear');
  },
};

const unusedShares: AppDependencies['shares'] = {
  create() {
    throw new Error('Unexpected share creation');
  },
  active() {
    throw new Error('Unexpected share lookup');
  },
  revoke() {
    throw new Error('Unexpected share revocation');
  },
  resolve() {
    throw new Error('Unexpected share resolution');
  },
  deleteForGroup() {
    throw new Error('Unexpected share deletion');
  },
};

const noArtifact: OpenArtifact = async () => null;
const unusedMarketplaceTemplates: AppDependencies['marketplaceTemplates'] = {
  create() {
    throw new Error('Unexpected marketplace template creation');
  },
  update() {
    throw new Error('Unexpected marketplace template update');
  },
  publish() {
    throw new Error('Unexpected marketplace template publication');
  },
  unpublish() {
    throw new Error('Unexpected marketplace template withdrawal');
  },
  published() {
    return [];
  },
  owns() {
    return false;
  },
  findPublished() {
    return null;
  },
  findBySourceGroup() {
    return null;
  },
  removeSourceGroup() {
    throw new Error('Unexpected marketplace source removal');
  },
  delete() {
    throw new Error('Unexpected marketplace template deletion');
  },
};
const authenticatedAuth: AppDependencies['auth'] = {
  handler: async () => new Response(null, { status: 404 }),
  getSession: async () => ({
    user: { id: 'local-user', name: 'Local User' },
  }),
  getSessionResponse: async () =>
    Response.json({ user: { id: 'local-user', name: 'Local User' } }),
};

function testApp({
  structuredLogDrain,
  agents = [],
  auth = authenticatedAuth,
  createGroup = () => {
    throw new Error('Unexpected group creation');
  },
  listGroups = async () => [],
  getGroup = (_userId, groupId) => testGroupRecord(groupId, 'Test group', []),
  groupOwner = () => null,
  groupDeleting = () => false,
  markGroupRead = () => false,
  setGroupPinned = () => true,
  setGroupArchived = () => true,
  clearGroupChat = async () => {
    throw new Error('Unexpected chat clear');
  },
  deleteGroup = async () => {
    throw new Error('Unexpected group deletion');
  },
  marketplaceTemplates = unusedMarketplaceTemplates,
  shares = unusedShares,
  runtime = unusedRuntime,
  transcribeAudio = async () => {
    throw new Error('Unexpected transcription');
  },
  openArtifact = noArtifact,
}: {
  structuredLogDrain?: AppDependencies['structuredLogDrain'];
  agents?: AppDependencies['agents'];
  auth?: AppDependencies['auth'];
  createGroup?: AppDependencies['createGroup'];
  listGroups?: AppDependencies['listGroups'];
  getGroup?: AppDependencies['getGroup'];
  groupOwner?: AppDependencies['groupOwner'];
  groupDeleting?: AppDependencies['groupDeleting'];
  markGroupRead?: AppDependencies['markGroupRead'];
  setGroupPinned?: AppDependencies['setGroupPinned'];
  setGroupArchived?: AppDependencies['setGroupArchived'];
  clearGroupChat?: AppDependencies['clearGroupChat'];
  deleteGroup?: AppDependencies['deleteGroup'];
  marketplaceTemplates?: AppDependencies['marketplaceTemplates'];
  shares?: AppDependencies['shares'];
  runtime?: ChatRuntime;
  transcribeAudio?: AppDependencies['transcribeAudio'];
  openArtifact?: OpenArtifact;
} = {}) {
  return createApp({
    structuredLogDrain,
    agents,
    auth,
    createGroup,
    listGroups,
    getGroup,
    groupOwner,
    groupDeleting,
    markGroupRead,
    setGroupPinned,
    setGroupArchived,
    clearGroupChat,
    deleteGroup,
    marketplaceTemplates,
    shares,
    runtime,
    transcribeAudio,
    openArtifact,
  });
}

function responseCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

const app = testApp();

test('passkey registration requires only a name', async () => {
  await using authentication = await createAuthentication({
    databasePath: ':memory:',
    baseURL: 'http://localhost:3001',
    secret: 'test-secret-that-is-at-least-32-characters',
    trustedOrigins: ['http://localhost:5173'],
  });
  const headers = {
    Origin: 'http://localhost:5173',
  };
  const registration = await authentication.auth.handler(
    new Request(
      'http://localhost:3001/api/auth/passkey/generate-register-options?context=Test%20Person',
      { headers },
    ),
  );
  assert.equal(registration.status, 200);

  const body = (await registration.json()) as {
    user?: { id?: unknown; name?: unknown; displayName?: unknown };
    authenticatorSelection?: {
      residentKey?: unknown;
      userVerification?: unknown;
    };
  };
  assert.equal(typeof body.user?.id, 'string');
  assert.deepEqual(body.user, {
    id: body.user?.id,
    name: 'Test Person',
    displayName: 'Test Person',
  });
  assert.equal(body.authenticatorSelection?.residentKey, 'required');
  assert.equal(body.authenticatorSelection?.userVerification, 'required');

  const session = await authentication.auth.handler(
    new Request('http://localhost:3001/api/auth/get-session', {
      headers: { Cookie: responseCookies(registration) },
    }),
  );
  assert.equal(await session.json(), null);

  const missingName = await authentication.auth.handler(
    new Request(
      'http://localhost:3001/api/auth/passkey/generate-register-options',
      { headers },
    ),
  );
  assert.equal(missingName.status, 400);
});

test('participant defaults use the configured OpenRouter key', () => {
  const defaults = createParticipantDefaults({ apiKey: 'openrouter-key-1' });
  assert.equal(defaults.model.provider, 'openrouter');
  assert.equal(defaults.model.modelId, 'openai/gpt-5.6-luna');
  assert.equal(defaults.tools.web_search?.type, 'provider');
});

test('health reports the WhatsApp group service', async () => {
  const response = await app.request('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('structured logging records request failures without authorization headers', async () => {
  const events: DrainContext[] = [];
  const response = await testApp({
    structuredLogDrain: (event) => {
      events.push(event);
    },
    createGroup: () => {
      throw new Error('controlled failure');
    },
  }).request('/api/groups', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer secret-marker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ templateId: 'scratch' }),
  });

  assert.equal(response.status, 500);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event.level, 'error');
  assert.equal(events[0]?.event.path, '/api/groups');
  assert.equal(events[0]?.event.status, 500);
  assert.match(JSON.stringify(events[0]?.event.error), /controlled failure/);
  assert.equal(events[0]?.headers?.authorization, undefined);
});

test('agent catalog exposes native character metadata', async () => {
  const response = await testApp({
    agents: [
      {
        id: 'paul-graham',
        name: 'Paul Graham',
        category: 'Fund',
        headline: "YC's essayist-in-chief",
        tags: ['strategy', 'fundraising'],
      },
    ],
  }).request('/api/agents');

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    agents: [
      {
        id: 'paul-graham',
        name: 'Paul Graham',
        category: 'Fund',
        headline: "YC's essayist-in-chief",
        tags: ['strategy', 'fundraising'],
      },
    ],
  });
});

test('group template catalog resolves agent names', async () => {
  const response = await testApp({
    agents: groupTemplates.flatMap(({ agents }) =>
      agents.map(({ agentId }) => ({
        id: agentId,
        name: `Name for ${agentId}`,
        category: 'Test',
        headline: 'Test agent',
        tags: ['test'],
      })),
    ),
  }).request('/api/group-templates');

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    templates: { agents: unknown[] }[];
  };
  assert.equal(body.templates.length, groupTemplates.length);
  assert.deepEqual(body.templates[0]?.agents[0], {
    id: 'rob-fitzpatrick',
    name: 'Name for rob-fitzpatrick',
    responsibility: 'Keeps interviews grounded in real past behavior.',
  });
});

test('a publisher owns the marketplace template lifecycle', async () => {
  using marketplaceTemplates = new MarketplaceGroupTemplateStore(':memory:', [
    'annie-duke',
    'paul-graham',
  ]);
  let userId = 'publisher-1';
  const application = testApp({
    marketplaceTemplates,
    auth: {
      ...authenticatedAuth,
      getSession: async () => ({
        user: { id: userId, name: 'Publisher One' },
      }),
    },
  });
  const input = {
    name: 'Founder Panel',
    category: 'Strategy',
    outcome: 'Pressure-test a company decision.',
    agents: [
      {
        agentId: 'paul-graham',
        responsibility: 'Keeps the company focused on users.',
      },
    ],
  };

  const createResponse = await application.request('/api/group-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as MarketplaceGroupTemplate;
  assert.equal(created.publisherName, 'Publisher One');
  assert.equal(created.published, false);

  const invalidResponse = await application.request('/api/group-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      agents: [{ agentId: 'missing', responsibility: 'Unknown agent.' }],
    }),
  });
  assert.equal(invalidResponse.status, 400);

  const publishResponse = await application.request(
    `/api/group-templates/${created.id}/publish`,
    { method: 'POST' },
  );
  assert.equal(publishResponse.status, 200);
  assert.equal(
    ((await publishResponse.json()) as MarketplaceGroupTemplate).published,
    true,
  );
  let listing = (await (
    await application.request('/api/group-templates')
  ).json()) as {
    templates: Array<{ id: string; owned: boolean; detached: boolean }>;
  };
  let listed = listing.templates.find(({ id }) => id === created.id);
  assert.equal(listed?.owned, true);
  assert.equal(listed?.detached, true);

  const updateResponse = await application.request(
    `/api/group-templates/${created.id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        outcome: 'Pressure-test the next company decision.',
      }),
    },
  );
  assert.equal(updateResponse.status, 200);
  assert.deepEqual(await updateResponse.json(), {
    ...created,
    outcome: 'Pressure-test the next company decision.',
    published: true,
  });

  userId = 'publisher-2';
  listing = (await (
    await application.request('/api/group-templates')
  ).json()) as typeof listing;
  listed = listing.templates.find(({ id }) => id === created.id);
  assert.equal(listed?.owned, false);
  const foreignResponse = await application.request(
    `/api/group-templates/${created.id}/unpublish`,
    { method: 'POST' },
  );
  assert.equal(foreignResponse.status, 404);
  assert.equal(
    (
      await application.request(`/api/group-templates/${created.id}`, {
        method: 'DELETE',
      })
    ).status,
    404,
  );

  userId = 'publisher-1';
  const deleteResponse = await application.request(
    `/api/group-templates/${created.id}`,
    { method: 'DELETE' },
  );
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await deleteResponse.json(), { deleted: true });
  assert.equal(
    (
      await application.request(`/api/group-templates/${created.id}`, {
        method: 'DELETE',
      })
    ).status,
    404,
  );
});

test('an owned group saves one marketplace template from its roster', async () => {
  using marketplaceTemplates = new MarketplaceGroupTemplateStore(':memory:', [
    'annie-duke',
    'paul-graham',
  ]);
  let userId = 'publisher-1';
  const group = testGroupRecord('group-1', 'Founder Board', [
    'annie-duke',
    'paul-graham',
  ]);
  const application = testApp({
    agents: [
      {
        id: 'annie-duke',
        name: 'Annie Duke',
        category: 'Decide',
        headline: 'thinking in bets',
        tags: ['decision-making'],
      },
      {
        id: 'paul-graham',
        name: 'Paul Graham',
        category: 'Fund',
        headline: "YC's essayist-in-chief",
        tags: ['strategy'],
      },
    ],
    auth: {
      ...authenticatedAuth,
      getSession: async () => ({
        user: { id: userId, name: 'Publisher One' },
      }),
    },
    getGroup: (requestedUserId, groupId) =>
      requestedUserId === 'publisher-1' && groupId === group.id ? group : null,
    marketplaceTemplates,
  });

  const initial = await application.request(
    '/api/groups/group-1/marketplace-template',
  );
  assert.equal(initial.status, 200);
  assert.deepEqual(await initial.json(), {
    template: null,
    group: { id: 'group-1', name: 'Founder Board' },
    agents: [
      {
        id: 'annie-duke',
        name: 'Annie Duke',
        headline: 'thinking in bets',
        responsibility: 'thinking in bets',
      },
      {
        id: 'paul-graham',
        name: 'Paul Graham',
        headline: "YC's essayist-in-chief",
        responsibility: "YC's essayist-in-chief",
      },
    ],
  });

  const input = {
    category: 'Strategy',
    outcome: 'Challenge the next company decision.',
    agents: [
      {
        agentId: 'annie-duke',
        responsibility: 'Calibrates uncertain decisions.',
      },
      {
        agentId: 'paul-graham',
        responsibility: 'Keeps the company focused on users.',
      },
    ],
  };
  const createdResponse = await application.request(
    '/api/groups/group-1/marketplace-template',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()) as MarketplaceGroupTemplate;
  assert.deepEqual(created, {
    id: created.id,
    sourceGroupId: 'group-1',
    publisherName: 'Publisher One',
    name: 'Founder Board',
    ...input,
    published: false,
  });

  const updatedResponse = await application.request(
    '/api/groups/group-1/marketplace-template',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, outcome: 'Make one clear decision.' }),
    },
  );
  assert.equal(updatedResponse.status, 200);
  assert.equal(
    ((await updatedResponse.json()) as MarketplaceGroupTemplate).id,
    created.id,
  );

  const wrongRoster = await application.request(
    '/api/groups/group-1/marketplace-template',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, agents: input.agents.slice(0, 1) }),
    },
  );
  assert.equal(wrongRoster.status, 400);

  userId = 'publisher-2';
  assert.equal(
    (await application.request('/api/groups/group-1/marketplace-template'))
      .status,
    404,
  );
});

test('legacy marketplace listings remain readable when attribution is added', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'marketplace-migration-'));
  const databasePath = join(directory, 'group-templates.sqlite');
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE marketplace_group_templates (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        outcome TEXT NOT NULL,
        agents TEXT NOT NULL,
        published INTEGER NOT NULL CHECK (published IN (0, 1))
      ) STRICT
    `);
    database
      .prepare(
        `INSERT INTO marketplace_group_templates
           (id, publisher_id, name, category, outcome, agents, published)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        'legacy-template',
        'publisher-1',
        'Legacy Board',
        'Strategy',
        'Preserve this published group.',
        JSON.stringify([
          {
            agentId: 'paul-graham',
            responsibility: 'Keeps the company focused on users.',
          },
        ]),
      );
    database.close();

    using marketplaceTemplates = new MarketplaceGroupTemplateStore(
      databasePath,
      ['paul-graham'],
    );
    assert.equal(
      marketplaceTemplates.create('publisher-1', 'Publisher One', {
        name: 'Founder Board',
        category: 'Strategy',
        outcome: 'Challenge the next company decision.',
        agents: [
          {
            agentId: 'paul-graham',
            responsibility: 'Keeps the company focused on users.',
          },
        ],
      }).publisherName,
      'Publisher One',
    );
    assert.deepEqual(
      marketplaceTemplates
        .published()
        .find(({ id }) => id === 'legacy-template'),
      {
        id: 'legacy-template',
        sourceGroupId: null,
        publisherName: null,
        name: 'Legacy Board',
        category: 'Strategy',
        outcome: 'Preserve this published group.',
        agents: [
          {
            agentId: 'paul-graham',
            responsibility: 'Keeps the company focused on users.',
          },
        ],
        published: true,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('published marketplace templates create ordinary groups', async () => {
  using marketplaceTemplates = new MarketplaceGroupTemplateStore(':memory:', [
    'paul-graham',
  ]);
  const template = marketplaceTemplates.create('publisher-1', 'Publisher One', {
    name: 'Founder Board',
    category: 'Strategy',
    outcome: 'Challenge the next company decision.',
    agents: [
      {
        agentId: 'paul-graham',
        responsibility: 'Keeps the company focused on users.',
      },
    ],
  });
  marketplaceTemplates.publish('publisher-1', template.id);

  const calls: unknown[] = [];
  const application = testApp({
    agents: groupTemplates.flatMap(({ agents }) =>
      agents.map(({ agentId }) => ({
        id: agentId,
        name: `Name for ${agentId}`,
        category: 'Test',
        headline: 'Test agent',
        tags: ['test'],
      })),
    ),
    marketplaceTemplates,
    createGroup: (userId, input) => {
      calls.push({ userId, input });
      return testGroupRecord('group-2', input.name, input.agentIds);
    },
  });

  const listResponse = await application.request('/api/group-templates');
  const list = (await listResponse.json()) as {
    templates: Array<{ id: string } & Record<string, unknown>>;
  };
  assert.deepEqual(
    list.templates.find(({ id }) => id === template.id),
    {
      id: template.id,
      publisherName: 'Publisher One',
      name: 'Founder Board',
      category: 'Strategy',
      outcome: 'Challenge the next company decision.',
      source: 'marketplace',
      owned: false,
      detached: true,
      agents: [
        {
          id: 'paul-graham',
          name: 'Name for paul-graham',
          responsibility: 'Keeps the company focused on users.',
        },
      ],
    },
  );

  const createResponse = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: template.id }),
  });
  assert.equal(createResponse.status, 201);
  assert.deepEqual(calls, [
    {
      userId: 'local-user',
      input: { name: 'Founder Board', agentIds: ['paul-graham'] },
    },
  ]);
  assert.deepEqual(await createResponse.json(), {
    id: 'group-2',
    name: 'Founder Board',
    agentIds: ['paul-graham'],
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
  });

  marketplaceTemplates.unpublish('publisher-1', template.id);
  const withdrawnResponse = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: template.id }),
  });
  assert.equal(withdrawnResponse.status, 400);
});

test('group template selection creates a normal group roster', async () => {
  const calls: unknown[] = [];
  const application = testApp({
    createGroup: (userId, input) => {
      calls.push({ userId, input });
      return testGroupRecord('group-1', input.name, input.agentIds);
    },
  });
  const response = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'customer-discovery' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    {
      userId: 'local-user',
      input: {
        name: 'Customer Discovery',
        agentIds: [
          'rob-fitzpatrick',
          'april-dunford',
          'elena-verna',
          'andrew-chen',
        ],
      },
    },
  ]);
  assert.deepEqual(await response.json(), {
    id: 'group-1',
    name: 'Customer Discovery',
    agentIds: [
      'rob-fitzpatrick',
      'april-dunford',
      'elena-verna',
      'andrew-chen',
    ],
    createdAt: testCreatedAt,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
  });

  const unknown = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'missing' }),
  });
  assert.equal(unknown.status, 400);
});

test('custom character selection creates an explicit group roster', async () => {
  const calls: unknown[] = [];
  const application = testApp({
    createGroup: (userId, input) => {
      calls.push({ userId, input });
      return testGroupRecord('group-2', input.name, input.agentIds);
    },
  });
  const response = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'My advisors',
      agentIds: ['paul-graham', 'annie-duke'],
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    {
      userId: 'local-user',
      input: {
        name: 'My advisors',
        agentIds: ['paul-graham', 'annie-duke'],
      },
    },
  ]);

  const mixed = await application.request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: 'customer-discovery',
      name: 'Mixed input',
      agentIds: ['paul-graham'],
    }),
  });
  assert.equal(mixed.status, 400);
  assert.equal(calls.length, 1);
});

test('group listing is scoped to the authenticated user', async () => {
  const userIds: string[] = [];
  const groups = [testGroupRecord('group-1', 'Founder panel', ['paul-graham'])];
  const response = await testApp({
    listGroups: async (userId) => {
      userIds.push(userId);
      return groups;
    },
  }).request('/api/groups');

  assert.equal(response.status, 200);
  assert.deepEqual(userIds, ['local-user']);
  assert.deepEqual(await response.json(), { groups });
});

test('Factory workshop groups are persisted and can be marked read', async () => {
  const calls: unknown[] = [];
  const response = await testApp({
    createGroup: (userId, input) => {
      calls.push({ userId, input });
      return testGroupRecord('scratch-1', input.name, input.agentIds);
    },
  }).request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId: 'scratch' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    {
      userId: 'local-user',
      input: { name: 'Character Workshop', agentIds: [] },
    },
  ]);

  const readCalls: unknown[] = [];
  const read = await testApp({
    markGroupRead: (userId, groupId) => {
      readCalls.push({ userId, groupId });
      return true;
    },
  }).request('/api/groups/scratch-1/read', { method: 'POST' });
  assert.equal(read.status, 200);
  assert.deepEqual(readCalls, [{ userId: 'local-user', groupId: 'scratch-1' }]);
  assert.deepEqual(await read.json(), { read: true });
});

test('group share links are created, read, and revoked by their owner', async () => {
  const calls: unknown[] = [];
  const share = { token: 'share-token-1', createdAt: testCreatedAt };
  const shares: AppDependencies['shares'] = {
    ...unusedShares,
    create: (userId, groupId) => {
      calls.push({ method: 'create', userId, groupId });
      return share;
    },
    active: (userId, groupId) => {
      calls.push({ method: 'active', userId, groupId });
      return share;
    },
    revoke: (userId, groupId) => {
      calls.push({ method: 'revoke', userId, groupId });
      return true;
    },
  };
  const app = testApp({ shares });

  const created = await app.request('/api/groups/group-1/share', {
    method: 'POST',
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), share);

  const read = await app.request('/api/groups/group-1/share');
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { share });

  const revoked = await app.request('/api/groups/group-1/share', {
    method: 'DELETE',
  });
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { revoked: true });

  assert.deepEqual(calls, [
    { method: 'create', userId: 'local-user', groupId: 'group-1' },
    { method: 'active', userId: 'local-user', groupId: 'group-1' },
    { method: 'revoke', userId: 'local-user', groupId: 'group-1' },
  ]);
});

test('group share links reject callers who do not own the group', async () => {
  const app = testApp({ getGroup: () => null, shares: unusedShares });

  for (const [path, init] of [
    ['/api/groups/group-1/share', {}],
    ['/api/groups/group-1/share', { method: 'POST' }],
    ['/api/groups/group-1/share', { method: 'DELETE' }],
  ] as const) {
    const response = await app.request(path, init);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Group not found.' });
  }

  const unauthenticated = await testApp({
    auth: { ...authenticatedAuth, getSession: async () => null },
    shares: unusedShares,
  }).request('/api/groups/group-1/share', { method: 'POST' });
  assert.equal(unauthenticated.status, 401);
});

test('shared conversations are readable without a session', async () => {
  const messages = [
    {
      id: 'message-1',
      sequence: 1,
      author: 'user',
      content: 'How should we price this?',
      sentAt: testCreatedAt,
      replyToMessageId: null,
      annotations: [],
    },
  ];
  const transcripts: unknown[] = [];
  const app = testApp({
    auth: { ...authenticatedAuth, getSession: async () => null },
    getGroup: (userId, groupId) =>
      userId === 'owner-user' && groupId === 'group-1'
        ? testGroupRecord('group-1', 'Founder panel', ['annie-duke'])
        : null,
    shares: {
      ...unusedShares,
      resolve: (token) =>
        token === 'share-token-1'
          ? { userId: 'owner-user', groupId: 'group-1' }
          : null,
    },
    runtime: {
      ...unusedRuntime,
      transcript: async (conversation) => {
        transcripts.push(conversation);
        return { messages, participants: [{ name: 'Annie Duke' }] };
      },
    },
  });

  const response = await app.request('/api/shares/share-token-1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    name: 'Founder panel',
    participants: [{ name: 'Annie Duke' }],
    messages,
  });
  assert.deepEqual(transcripts, [{ chatId: 'group-1', userId: 'owner-user' }]);

  const revoked = await app.request('/api/shares/revoked-token');
  assert.equal(revoked.status, 404);
  assert.deepEqual(await revoked.json(), { error: 'Share not found.' });
});

test('chat routes reject chats the caller does not own', async () => {
  const app = testApp({ getGroup: () => null, runtime: unusedRuntime });

  for (const [path, init] of [
    ['/api/chat/group-1/state', {}],
    ['/api/chat/group-1/stop', { method: 'POST' }],
    ['/api/chat/group-1/agents/Annie%20Duke/traces', {}],
    ['/api/chat/group-1/artifacts/report.md', {}],
  ] as const) {
    const response = await app.request(path, init);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Chat not found.' });
  }
});

test('chat streams reject sessions owned by another user', async () => {
  const resumed: unknown[] = [];
  const app = testApp({
    groupOwner: () => 'owner-user',
    runtime: {
      ...unusedRuntime,
      async sessionExists() {
        resumed.push('sessionExists');
        return true;
      },
      observe() {
        resumed.push('observe');
        return {
          async status() {
            throw new Error('Unexpected status lookup');
          },
          async cancel() {},
          async resume() {
            throw new Error('Unexpected resume');
          },
        };
      },
    },
  });

  const response = await app.request(
    '/api/zukhruf/v1/session/00000000-0000-4000-8000-000000000001/stream',
  );

  assert.equal(response.status, 404);
  assert.deepEqual(resumed, []);
});

test('groups can be pinned and archived by their owner', async () => {
  const calls: unknown[] = [];
  const app = testApp({
    setGroupPinned: (userId, groupId, pinned) => {
      calls.push({ method: 'pin', userId, groupId, pinned });
      return true;
    },
    setGroupArchived: (userId, groupId, archived) => {
      calls.push({ method: 'archive', userId, groupId, archived });
      return true;
    },
  });

  for (const [path, method, expected] of [
    ['/api/groups/group-1/pin', 'POST', { pinned: true }],
    ['/api/groups/group-1/pin', 'DELETE', { pinned: false }],
    ['/api/groups/group-1/archive', 'POST', { archived: true }],
    ['/api/groups/group-1/archive', 'DELETE', { archived: false }],
  ] as const) {
    const response = await app.request(path, { method });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }

  assert.deepEqual(calls, [
    { method: 'pin', userId: 'local-user', groupId: 'group-1', pinned: true },
    { method: 'pin', userId: 'local-user', groupId: 'group-1', pinned: false },
    {
      method: 'archive',
      userId: 'local-user',
      groupId: 'group-1',
      archived: true,
    },
    {
      method: 'archive',
      userId: 'local-user',
      groupId: 'group-1',
      archived: false,
    },
  ]);
});

test('clearing a group chat is owner-scoped', async () => {
  const cleared: unknown[] = [];
  const app = testApp({
    clearGroupChat: async (userId, groupId) => {
      cleared.push({ userId, groupId });
    },
  });

  const response = await app.request('/api/groups/group-1/clear', {
    method: 'POST',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cleared: true });
  assert.deepEqual(cleared, [{ userId: 'local-user', groupId: 'group-1' }]);

  const foreign = testApp({ getGroup: () => null });
  for (const [path, method] of [
    ['/api/groups/group-1/clear', 'POST'],
    ['/api/groups/group-1/pin', 'POST'],
    ['/api/groups/group-1/pin', 'DELETE'],
    ['/api/groups/group-1/archive', 'POST'],
    ['/api/groups/group-1/archive', 'DELETE'],
  ] as const) {
    const denied = await foreign.request(path, { method });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'Group not found.' });
  }
});

test('permanently deleting a group is owner-scoped', async () => {
  const deleted: unknown[] = [];
  const application = testApp({
    deleteGroup: async (userId, groupId) => {
      deleted.push({ userId, groupId });
      return true;
    },
  });

  const response = await application.request('/api/groups/group-1', {
    method: 'DELETE',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(deleted, [{ userId: 'local-user', groupId: 'group-1' }]);

  const unauthenticated = await testApp({
    auth: { ...authenticatedAuth, getSession: async () => null },
    deleteGroup: async () => {
      throw new Error('Unexpected group deletion');
    },
  }).request('/api/groups/group-1', { method: 'DELETE' });
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), { error: 'Unauthorized.' });

  const missing = await testApp({
    deleteGroup: async () => false,
  }).request('/api/groups/group-1', { method: 'DELETE' });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Group not found.' });
});

test('SDK auth routes preserve Better Auth response headers', async () => {
  const response = await testApp({
    auth: {
      ...authenticatedAuth,
      getSessionResponse: async () =>
        Response.json(null, {
          headers: {
            'Set-Cookie': 'session=test-session; HttpOnly; Path=/',
            'X-Auth-Result': 'checked',
          },
        }),
    },
  }).request('/api/auth/get-session');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Auth-Result'), 'checked');
  assert.deepEqual(response.headers.getSetCookie(), [
    'session=test-session; HttpOnly; Path=/',
  ]);
  assert.equal(await response.json(), null);
});

test('chat routes require a Better Auth session', async () => {
  const unauthenticatedApp = testApp({
    auth: {
      ...authenticatedAuth,
      getSession: async () => null,
    },
  });
  const response = await unauthenticatedApp.request('/api/chat/chat-1/state');

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
  assert.equal(
    (
      await unauthenticatedApp.request(
        '/api/zukhruf/v1/session/00000000-0000-4000-8000-000000000001/stream',
      )
    ).status,
    401,
  );
});

test('chat transcription sends browser audio through the configured transcriber', async () => {
  let received: Parameters<AppDependencies['transcribeAudio']>[0] | undefined;
  const transcriptionApp = testApp({
    transcribeAudio: async (audio) => {
      received = audio;
      return 'Hello from the microphone';
    },
  });
  const form = new FormData();
  form.set('audio', new Blob(['voice'], { type: 'audio/webm' }));

  const response = await transcriptionApp.request(
    '/api/chat/chat-1/transcription',
    { method: 'POST', body: form },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: 'Hello from the microphone',
  });
  assert.equal(received?.format, 'webm');
  assert.deepEqual(received?.bytes, new TextEncoder().encode('voice'));
});

test('chat transcription rejects empty and unsupported recordings', async () => {
  const empty = new FormData();
  empty.set('audio', new Blob([], { type: 'audio/webm' }));
  const emptyResponse = await app.request('/api/chat/chat-1/transcription', {
    method: 'POST',
    body: empty,
  });
  assert.equal(emptyResponse.status, 400);

  const unsupported = new FormData();
  unsupported.set('audio', new Blob(['voice'], { type: 'text/plain' }));
  const unsupportedResponse = await app.request(
    '/api/chat/chat-1/transcription',
    { method: 'POST', body: unsupported },
  );
  assert.equal(unsupportedResponse.status, 415);
});

test('OpenRouter transcription uses the dedicated speech-to-text endpoint', async () => {
  let outbound: Request | undefined;
  const transcribe = createOpenRouterTranscriber({
    apiKey: 'openrouter-test-key',
    model: 'openai/gpt-4o-mini-transcribe',
    appUrl: 'https://baseera.test',
    fetch: async (input, init) => {
      outbound = new Request(input, init);
      return Response.json({ text: 'Transcribed' });
    },
  });

  assert.equal(
    await transcribe({
      bytes: new TextEncoder().encode('voice'),
      format: 'webm',
    }),
    'Transcribed',
  );
  assert.ok(outbound);
  assert.equal(
    outbound.url,
    'https://openrouter.ai/api/v1/audio/transcriptions',
  );
  assert.equal(
    outbound.headers.get('Authorization'),
    'Bearer openrouter-test-key',
  );
  assert.equal(outbound.headers.get('HTTP-Referer'), 'https://baseera.test');
  assert.equal(outbound.headers.get('X-OpenRouter-Title'), 'Baseera');
  assert.deepEqual(JSON.parse(await outbound.text()), {
    model: 'openai/gpt-4o-mini-transcribe',
    input_audio: {
      data: Buffer.from('voice').toString('base64'),
      format: 'webm',
    },
  });
});

test('a user with no participants gets an empty group', async () => {
  await using runtime = memoryRuntime([]);
  const groupApp = testApp({ runtime });

  const stateResponse = await groupApp.request('/api/chat/chat-1/state');
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    messages: [],
    participants: [],
    activity: {
      phase: 'idle',
      notification: 0,
      messageCount: 0,
      participants: [],
      presence: [],
    },
    cursor: 0,
    streamPath: '/zukhruf/v1/session/chat-1/stream',
  });

  const messageResponse = await groupApp.request('/api/chat/chat-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'message-1', content: 'Anyone here?' }),
  });
  assert.equal(messageResponse.status, 201);
  const body = (await messageResponse.json()) as {
    message?: { content?: unknown };
  };
  assert.equal(body.message?.content, 'Anyone here?');
});

test('chat messages retain multiple excerpt annotations', async () => {
  await using runtime = memoryRuntime([]);
  const groupApp = testApp({ runtime });
  const post = (body: object) =>
    groupApp.request('/api/chat/chat-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  await post({ id: 'message-1', content: 'Validate one market first.' });
  await post({ id: 'message-2', content: 'Then measure activation.' });
  const response = await post({
    id: 'message-3',
    content: 'These two points belong together.',
    replyToMessageId: 'message-2',
    annotations: [
      { messageId: 'message-1', excerpt: 'one market' },
      { messageId: 'message-2', excerpt: 'measure activation' },
    ],
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as { message: { sentAt: string } };
  assert.match(body.message.sentAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(body.message, {
    id: 'message-3',
    sequence: 3,
    author: 'user',
    content: 'These two points belong together.',
    sentAt: body.message.sentAt,
    replyToMessageId: 'message-2',
    annotations: [
      { messageId: 'message-1', excerpt: 'one market' },
      { messageId: 'message-2', excerpt: 'measure activation' },
    ],
  });
});

test('chat accepts annotation-only messages with per-selection comments', async () => {
  await using runtime = memoryRuntime([]);
  const groupApp = testApp({ runtime });
  const post = (body: object) =>
    groupApp.request('/api/chat/chat-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  await post({ id: 'message-1', content: 'Validate one market first.' });
  const response = await post({
    id: 'message-2',
    content: '',
    annotations: [
      {
        messageId: 'message-1',
        excerpt: 'one market',
        comment: 'Why only one?',
      },
    ],
  });

  assert.equal(response.status, 201);
  const body = (await response.json()) as { message: { sentAt: string } };
  assert.deepEqual(body.message, {
    id: 'message-2',
    sequence: 2,
    author: 'user',
    content: '',
    sentAt: body.message.sentAt,
    replyToMessageId: null,
    annotations: [
      {
        messageId: 'message-1',
        excerpt: 'one market',
        comment: 'Why only one?',
      },
    ],
  });
});

test('chat runtime reports new messages to the group summary sink', async () => {
  const seen: unknown[] = [];
  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => [],
    onMessage: (conversation, message, cursor) => {
      seen.push({ conversation, message, cursor });
    },
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ':memory:',
    mailboxPath: ':memory:',
    queueDirectory: testQueueDirectory(),
  });

  const message = await runtime.post(testGroupConversation, {
    id: 'summary-message',
    content: 'Keep this in the sidebar.',
  });

  assert.deepEqual(seen, [
    { conversation: testGroupConversation, message, cursor: 1 },
  ]);
});

test('chat runtime rebuilds message projections from the durable log', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zukhruf-projection-'));
  const conversation = { chatId: 'projection-chat', userId: 'local-user' };
  const seen: unknown[] = [];
  const runtime = () =>
    new WhatsAppChatRuntime({
      loadParticipants: async () => [],
      onMessage: (projectedConversation, message, cursor) => {
        seen.push({ conversation: projectedConversation, message, cursor });
      },
      limits: testGroupLimits,
      sandboxForChat: () => testGroupSandbox,
      databasePath: join(directory, 'group.sqlite'),
      mailboxPath: join(directory, 'mailbox.sqlite'),
      queueDirectory: join(directory, 'queues'),
    });

  try {
    let message: Awaited<ReturnType<WhatsAppChatRuntime['post']>>;
    {
      await using first = runtime();
      message = await first.post(conversation, {
        id: 'projected-message',
        content: 'Rebuild this sidebar state.',
      });
      await waitForChat(first, conversation, 'settled');
    }

    seen.length = 0;
    await using second = runtime();
    await second.replayMessages(conversation);
    assert.deepEqual(seen, [{ conversation, message, cursor: 1 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snapshots reuse the active chat roster', async () => {
  let loads = 0;
  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => {
      loads++;
      return [];
    },
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ':memory:',
    mailboxPath: ':memory:',
    queueDirectory: testQueueDirectory(),
  });

  await runtime.snapshot({ userId: 'user-1', chatId: 'chat-1' });
  await runtime.snapshot({ userId: 'user-1', chatId: 'chat-1' });
  await runtime.snapshot({ userId: 'user-1', chatId: 'chat-2' });

  assert.equal(loads, 2);
});

test('new participants join an active chat, read its transcript, and greet once', async () => {
  const conversation = { userId: 'user-1', chatId: 'active-roster' };
  const joinReminder =
    'You just joined an ongoing group chat. Read the full public conversation included in this notification, then greet the group once with a brief, natural introduction.';
  const newcomerPrompts: unknown[] = [];
  let greeted = false;
  const newcomer: WhatsAppParticipant = {
    name: 'Researcher',
    model: new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        newcomerPrompts.push(prompt);
        const context = JSON.stringify(prompt);
        if (!greeted && context.includes(joinReminder)) {
          greeted = true;
          return groupToolResponse('reply_to_group', 'newcomer-greeting', {
            message: 'Hi everyone—Researcher here.',
          });
        }
        return groupTextResponse('Nothing distinct to add.');
      },
    }),
  };
  const roster: WhatsAppParticipant[] = [];
  let created = false;
  roster.push({
    name: 'Factory',
    model: new MockLanguageModelV4({
      doStream: async () => {
        if (!created) {
          created = true;
          roster.push(newcomer);
        }
        return groupTextResponse('Nothing distinct to add.');
      },
    }),
  });

  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => roster,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ':memory:',
    mailboxPath: ':memory:',
    queueDirectory: testQueueDirectory(),
  });

  await runtime.post(conversation, {
    id: 'message-1',
    content: 'Factory, create a researcher for this conversation.',
  });
  let snapshot = await waitForChat(runtime, conversation, 'settled');

  assert.deepEqual(snapshot.participants, [
    { name: 'Factory' },
    { name: 'Researcher' },
  ]);
  assert.deepEqual(
    snapshot.messages.map(({ author, content }) => ({ author, content })),
    [
      {
        author: 'user',
        content: 'Factory, create a researcher for this conversation.',
      },
      { author: 'Researcher', content: 'Hi everyone—Researcher here.' },
    ],
  );
  assert.match(
    JSON.stringify(newcomerPrompts[0]),
    /Factory, create a researcher for this conversation\./,
  );

  await runtime.post(conversation, {
    id: 'message-2',
    content: 'Thanks.',
  });
  snapshot = await waitForChat(runtime, conversation, 'settled');

  assert.equal(
    snapshot.messages.filter(({ author }) => author === 'Researcher').length,
    1,
  );
});

test('a chat stops instead of freezing when the pump throws', async () => {
  const conversation = { userId: 'user-1', chatId: 'pump-failure' };
  const roster: WhatsAppParticipant[] = [];
  let collided = false;
  roster.push({
    name: 'Factory',
    model: new MockLanguageModelV4({
      doStream: async () => {
        if (!collided) {
          collided = true;
          roster.push({
            name: 'factory',
            model: new MockLanguageModelV4({
              doStream: async () => groupTextResponse('Nothing to add.'),
            }),
          });
        }
        return groupTextResponse('Nothing to add.');
      },
    }),
  });

  await using runtime = new WhatsAppChatRuntime({
    loadParticipants: async () => roster,
    limits: testGroupLimits,
    sandboxForChat: () => testGroupSandbox,
    databasePath: ':memory:',
    mailboxPath: ':memory:',
    queueDirectory: testQueueDirectory(),
  });

  await runtime.post(conversation, { id: 'message-1', content: 'Hello.' });
  const snapshot = await waitForChat(runtime, conversation, 'stopped');

  assert.equal(snapshot.activity.stopReason, 'interrupted');
});

test('agent telemetry is grouped into complete chat-scoped turns', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-traces-'));
  const path = join(directory, 'maya.jsonl');
  const functionId = 'chat-1:Maya';
  const entry = (event: string, timestamp: string, data: object) =>
    JSON.stringify({ event, timestamp, data: { functionId, ...data } });

  try {
    await writeFile(
      path,
      [
        'not json',
        entry('onStart', '2026-07-31T10:00:00.000Z', {
          callId: 'call-1',
          modelId: 'gpt-5.6-sol',
          messages: [{ role: 'user', content: 'New group message' }],
        }),
        JSON.stringify({
          event: 'onEnd',
          timestamp: '2026-07-31T10:00:01.000Z',
          data: { functionId: 'other-chat:Maya', callId: 'ignored' },
        }),
        entry('onEnd', '2026-07-31T10:00:02.000Z', {
          callId: 'call-1',
          model: 'gpt-5.6-sol',
          finishReason: 'stop',
          totalUsage: {
            inputTokens: 100,
            inputTokenDetails: { cacheReadTokens: 64 },
            outputTokens: 10,
            outputTokenDetails: { reasoningTokens: 4 },
            totalTokens: 110,
          },
          steps: [
            {
              stepNumber: 0,
              finishReason: 'stop',
              performance: { responseTimeMs: 123 },
              usage: { totalTokens: 110 },
              content: [{ type: 'reasoning', text: 'Checked context' }],
            },
          ],
        }),
      ].join('\n'),
    );

    assert.deepEqual(await readAgentTraces(path, functionId), [
      {
        callId: 'call-1',
        startedAt: '2026-07-31T10:00:00.000Z',
        endedAt: '2026-07-31T10:00:02.000Z',
        modelId: 'gpt-5.6-sol',
        notification: 'New group message',
        status: 'completed',
        finishReason: 'stop',
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          reasoningTokens: 4,
          cacheReadTokens: 64,
          totalTokens: 110,
        },
        steps: [
          {
            stepNumber: 0,
            finishReason: 'stop',
            responseTimeMs: 123,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 110,
            },
            content: [{ type: 'reasoning', text: 'Checked context' }],
          },
        ],
        error: null,
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('group members share one sandbox instance', async () => {
  const maya = {
    chatId: 'chat-1:participant:0',
    userId: 'user-1',
  };
  const omar = {
    chatId: 'chat-1:participant:1',
    userId: 'user-1',
  };
  const lina = {
    chatId: 'chat-1:participant:2',
    userId: 'user-1',
  };
  const paul = {
    chatId: 'chat-1:participant:3',
    userId: 'user-1',
  };
  const [mayaSandbox, omarSandbox, linaSandbox, paulSandbox] =
    await Promise.all([
      testGroupSandbox(maya),
      testGroupSandbox(omar),
      testGroupSandbox(lina),
      testGroupSandbox(paul),
    ]);

  assert.equal(mayaSandbox, omarSandbox);
  assert.equal(mayaSandbox, linaSandbox);
  assert.equal(mayaSandbox, paulSandbox);
  assert.equal(mayaSandbox.sandbox, omarSandbox.sandbox);
  assert.equal(mayaSandbox.sandbox, linaSandbox.sandbox);
  assert.equal(mayaSandbox.sandbox, paulSandbox.sandbox);
});

test('group chats share writable per-user participants and isolate other users', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whatsapp-sandbox-'));
  const firstChat = { chatId: 'chat-1', userId: 'local-user' };
  const secondChat = { chatId: 'chat-2', userId: 'local-user' };
  const otherUserChat = { chatId: 'chat-1', userId: 'other-user' };

  try {
    const builtins = resolve(directory, 'builtins', 'factory');
    await mkdir(builtins, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(builtins, 'identity.json'),
        JSON.stringify({ name: 'Factory' }),
      ),
      writeFile(resolve(builtins, 'SOUL.md'), 'Build useful participants.'),
      writeFile(resolve(builtins, 'AGENTS.md'), 'Create them with bash.'),
      writeFile(resolve(builtins, 'MEMORY.md'), '# Memory'),
    ]);
    await using resources = new AsyncDisposableStack();
    const participants = new ParticipantDirectory({
      databasePath: resolve(directory, 'participants.sqlite'),
      builtinsDirectory: resolve(directory, 'builtins'),
      telemetryDirectory: resolve(directory, 'group-telemetry'),
      loadDefaults: async () => ({
        model: new MockLanguageModelV4({
          doStream: async () => groupTextResponse('unused'),
        }),
        tools: {},
      }),
    });
    const sandboxForChat = createWhatsAppSandbox(
      resources,
      directory,
      (conversation) => participants.filesystem(conversation.userId),
    );
    const sandboxForFirstChat = sandboxForChat(firstChat);
    const first = await sandboxForFirstChat({
      chatId: 'chat-1:participant:0',
      userId: firstChat.userId,
    });
    const firstPeer = await sandboxForFirstChat({
      chatId: 'chat-1:participant:1',
      userId: firstChat.userId,
    });
    assert.equal(first.sandbox, firstPeer.sandbox);
    assert.equal(
      await first.sandbox.readFile(
        '/workspace/participants/factory/identity.json',
      ),
      JSON.stringify({ name: 'Factory' }),
    );

    const created = await first.sandbox.executeCommand(
      [
        'mkdir -p /workspace/participants/maya',
        `printf '%s' '{"name":"Maya"}' > /workspace/participants/maya/identity.json`,
        `printf '%s' 'Be candid and concise.' > /workspace/participants/maya/SOUL.md`,
        `printf '%s' 'Own the business profile.' > /workspace/participants/maya/AGENTS.md`,
        `printf '%s' 'No durable knowledge yet.' > /workspace/participants/maya/MEMORY.md`,
      ].join(' && '),
    );
    assert.equal(created.exitCode, 0);
    assert.deepEqual(
      (await participants.participants(firstChat.userId)).map(
        ({ name }) => name,
      ),
      ['Maya', 'Factory'],
    );

    const updated = await firstPeer.sandbox.executeCommand(
      `printf '%s' 'The user prefers concise answers.' > /workspace/participants/maya/MEMORY.md`,
    );
    assert.equal(updated.exitCode, 0);

    await first.sandbox.writeFiles([
      { path: '/workspace/private.txt', content: 'first chat' },
      { path: '/workspace/output/sample.txt', content: 'artifact' },
    ]);

    const second = await sandboxForChat(secondChat)({
      chatId: 'chat-2:participant:0',
      userId: secondChat.userId,
    });
    assert.equal(
      await second.sandbox.readFile('/workspace/participants/maya/MEMORY.md'),
      'The user prefers concise answers.',
    );
    assert.equal(
      (await second.sandbox.executeCommand('cat /workspace/private.txt'))
        .exitCode,
      1,
    );

    const otherUser = await sandboxForChat(otherUserChat)({
      chatId: 'chat-1:participant:0',
      userId: otherUserChat.userId,
    });
    assert.equal(
      (
        await otherUser.sandbox.executeCommand(
          'cat /workspace/participants/maya/MEMORY.md',
        )
      ).exitCode,
      1,
    );
    assert.equal(
      (await otherUser.sandbox.executeCommand('cat /workspace/private.txt'))
        .exitCode,
      1,
    );

    const sandboxApp = testApp({
      openArtifact: (conversation, path) =>
        openArtifact(directory, conversation, path),
    });
    const artifact = await sandboxApp.request(
      '/api/chat/chat-1/artifacts/sample.txt',
    );
    assert.equal(artifact.status, 200);
    assert.equal(
      artifact.headers.get('content-type'),
      'text/plain; charset=utf-8',
    );
    assert.equal(
      artifact.headers.get('content-disposition'),
      "inline; filename*=UTF-8''sample.txt",
    );
    assert.equal(await artifact.text(), 'artifact');
    assert.equal(
      (await sandboxApp.request('/api/chat/chat-2/artifacts/sample.txt'))
        .status,
      404,
    );
    assert.equal(
      (
        await sandboxApp.request(
          '/api/chat/chat-1/artifacts/%2E%2E%2Fprivate.txt',
        )
      ).status,
      400,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('chat message POST returns before active participants settle', async () => {
  const chatId = '00000000-0000-4000-8000-000000000001';
  const conversation = { chatId, userId: 'local-user' };
  const participantStarted = Promise.withResolvers<void>();
  const releaseParticipant = Promise.withResolvers<void>();
  const participant = new MockLanguageModelV4({
    doStream: async () => {
      participantStarted.resolve();
      await releaseParticipant.promise;
      return groupTextResponse('Nothing distinct to add.');
    },
  });
  await using runtime = memoryRuntime([
    {
      name: 'Maya',
      model: participant,
    },
  ]);

  try {
    const groupApp = testApp({ runtime });
    const request = () =>
      groupApp.request(`/api/chat/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'message-1',
          content: 'What should we do first?',
        }),
      });
    const response = await Promise.race([
      request(),
      sleep(2_000).then(() => {
        throw new Error('message POST waited for the participant');
      }),
    ]);

    assert.equal(response.status, 201);
    const posted = (await response.json()) as {
      message: ReturnType<WhatsAppGroup['snapshot']>['messages'][number];
    };
    assert.match(posted.message.sentAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(posted, {
      message: {
        id: 'message-1',
        sequence: 1,
        author: 'user',
        content: 'What should we do first?',
        sentAt: posted.message.sentAt,
        replyToMessageId: null,
        annotations: [],
      },
    });
    assert.deepEqual(await (await request()).json(), {
      message: {
        id: 'message-1',
        sequence: 1,
        author: 'user',
        content: 'What should we do first?',
        sentAt: posted.message.sentAt,
        replyToMessageId: null,
        annotations: [],
      },
    });
    await participantStarted.promise;

    const state = (await (
      await groupApp.request(`/api/chat/${chatId}/state`)
    ).json()) as ReturnType<WhatsAppGroup['snapshot']>;
    assert.deepEqual(state, {
      messages: [
        {
          id: 'message-1',
          sequence: 1,
          author: 'user',
          content: 'What should we do first?',
          sentAt: posted.message.sentAt,
          replyToMessageId: null,
          annotations: [],
        },
      ],
      participants: [{ name: 'Maya' }],
      activity: {
        phase: 'active',
        notification: 1,
        messageCount: 1,
        participants: [{ name: 'Maya', state: 'considering', replies: 0 }],
        presence: [{ name: 'Maya', state: 'reading' }],
      },
      cursor: 5,
      streamPath: `/zukhruf/v1/session/${chatId}/stream`,
    });

    releaseParticipant.resolve();
    await waitForChat(runtime, conversation, 'settled');

    async function readEvents() {
      const controller = new AbortController();
      const response = await groupApp.request(
        `/api/zukhruf/v1/session/${chatId}/stream`,
        { signal: controller.signal },
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get('content-type') ?? '',
        /text\/event-stream/,
      );
      assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
      const reader = response.body!.getReader();
      let events = '';
      while (!events.includes('"type":"settled"')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        events += new TextDecoder().decode(chunk.value, { stream: true });
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      return events;
    }

    const events = await readEvents();
    assert.match(events, /"type":"data-whatsapp-chat-event"/);
    assert.match(events, /"cursor":1/);
    assert.match(events, /"type":"settled"/);

    const reconnected = await readEvents();
    assert.equal(reconnected, events);
  } finally {
    releaseParticipant.resolve();
  }
});

test('activity subscribers do not wait for persistence', async () => {
  const persistenceStarted = Promise.withResolvers<void>();
  const releasePersistence = Promise.withResolvers<void>();
  let delivered = false;

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Maya',
          model: new MockLanguageModelV4({
            doStream: groupTextResponse('Nothing to add.'),
          }),
        },
      ],
      persist: async (event) => {
        if (event.type !== 'activity' || event.activity.type !== 'started') {
          return;
        }
        persistenceStarted.resolve();
        await releasePersistence.promise;
      },
    }),
  );
  using subscription = group.subscribe({
    onEvent(event) {
      if (event.type === 'activity' && event.activity.type === 'started') {
        delivered = true;
      }
    },
  });

  const posting = group.post('Hello');
  await persistenceStarted.promise;

  const deliveredBeforePersistence = delivered;
  releasePersistence.resolve();
  await posting;
  assert.equal(deliveredBeforePersistence, true);
});

test('chat messages and Zukhruf session ids are validated at the boundary', async () => {
  for (const body of [
    null,
    {},
    { id: '', content: 'Hello' },
    { id: 'message-1', content: '   ' },
    { id: 'message-1', content: 'Hello', replyToMessageId: '' },
    {
      id: 'message-1',
      content: 'Hello',
      annotations: [{ messageId: '', excerpt: 'Hello' }],
    },
    {
      id: 'message-1',
      content: 'Hello',
      annotations: [{ messageId: 'message-0', excerpt: '' }],
    },
  ]) {
    const response = await app.request('/api/chat/chat-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }

  assert.equal(
    (await app.request('/api/zukhruf/v1/session/not-a-session-id/stream'))
      .status,
    400,
  );
  assert.equal((await app.request('/api/chat/chat-1/events')).status, 404);
  assert.equal((await app.request('/api/chat/chat-1/stream')).status, 404);
  assert.equal((await app.request('/api/chat/chat-1/turns')).status, 404);
  assert.equal(
    (
      await app.request('/api/chat', {
        method: 'POST',
      })
    ).status,
    404,
  );

  const oversized = await app.request('/api/chat/chat-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'message-1', content: 'x'.repeat(24_000) }),
  });
  assert.equal(oversized.status, 413);

  const limited = await testApp({
    runtime: {
      ...unusedRuntime,
      async post() {
        throw new WhatsAppGroupLimitError('Chat is full');
      },
    },
  }).request('/api/chat/chat-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'message-1', content: 'One more message' }),
  });
  assert.equal(limited.status, 409);
  assert.deepEqual(await limited.json(), { error: 'Chat is full' });

  const missingReply = await testApp({
    runtime: {
      ...unusedRuntime,
      async post() {
        throw new WhatsAppReplyTargetError('Reply target was not found');
      },
    },
  }).request('/api/chat/chat-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'message-2',
      content: 'Reply',
      replyToMessageId: 'missing',
    }),
  });
  assert.equal(missingReply.status, 400);
});

test('development CORS accepts a local fallback port', async () => {
  const response = await app.request('/api/health', {
    headers: { Origin: 'http://localhost:5174' },
  });

  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    'http://localhost:5174',
  );
  assert.equal(
    response.headers.get('Access-Control-Allow-Credentials'),
    'true',
  );
});

test('publishes a group reply before slower members finish', async () => {
  const releaseSlowMember = Promise.withResolvers<void>();
  const fastMemberContinued = Promise.withResolvers<void>();

  let fastCalls = 0;
  const fast = new MockLanguageModelV4({
    doStream: async () => {
      fastCalls++;
      if (fastCalls === 1) {
        return groupToolResponse('reply_to_group', 'fast-reply', {
          message: 'I can answer this now.',
        });
      }
      fastMemberContinued.resolve();
      return groupTextResponse('Reply posted.');
    },
  });

  let slowCalls = 0;
  const slow = new MockLanguageModelV4({
    doStream: async () => {
      slowCalls++;
      if (slowCalls === 1) await releaseSlowMember.promise;
      return groupTextResponse('I have nothing useful to add.');
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: 'fast', model: fast },
        { name: 'slow', model: slow },
      ],
    }),
  );

  const published: { author: string; content: string }[] = [];
  const sending = group.send('Can anyone answer?', ({ author, content }) => {
    published.push({ author, content });
  });
  const fastFinished = await Promise.race([
    fastMemberContinued.promise.then(() => true),
    sleep(2_000).then(() => false),
  ]);
  const replyWasAlreadyPublic = published.some(
    ({ author }) => author === 'fast',
  );

  releaseSlowMember.resolve();
  await sending;

  assert.equal(fastFinished, true, 'the fast member did not finish in time');
  assert.equal(
    replyWasAlreadyPublic,
    true,
    'the fast reply waited for the slower member',
  );
});

test('reconsiders a stale first-wave reply before publishing it', async () => {
  const bothMembersStarted = Promise.withResolvers<void>();
  const earlyReplyPublished = Promise.withResolvers<void>();
  let startedMembers = 0;

  const startTogether = async () => {
    startedMembers++;
    if (startedMembers === 2) bothMembersStarted.resolve();
    await bothMembersStarted.promise;
  };

  let earlyCalls = 0;
  const early = new MockLanguageModelV4({
    doStream: async () => {
      earlyCalls++;
      if (earlyCalls === 1) {
        await startTogether();
        return groupToolResponse('reply_to_group', 'early-reply', {
          message: 'The answer is already covered.',
        });
      }
      return groupTextResponse('Reply posted.');
    },
  });

  let lateCalls = 0;
  const latePrompts: unknown[] = [];
  const late = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      lateCalls++;
      latePrompts.push(prompt);
      if (lateCalls === 1) {
        await startTogether();
        await earlyReplyPublished.promise;
        return groupToolResponse('reply_to_group', 'late-reply', {
          message: 'The answer is already covered.',
        });
      }
      return groupTextResponse('Nothing non-duplicative to add.');
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: 'early', model: early },
        { name: 'late', model: late },
      ],
    }),
  );

  const messages = await group.send('What is the answer?', (message) => {
    if (message.author === 'early') earlyReplyPublished.resolve();
  });

  assert.equal(lateCalls, 2);
  assert.match(
    JSON.stringify(latePrompts[1]),
    /The answer is already covered\./,
  );
  assert.deepEqual(
    messages
      .filter(({ author }) => author !== 'user')
      .map(({ author, content }) => ({ author, content })),
    [{ author: 'early', content: 'The answer is already covered.' }],
  );
});

test('an active member sees a peer reply before its next model step', async () => {
  const lateMemberStarted = Promise.withResolvers<void>();
  const earlyReplyPublished = Promise.withResolvers<void>();
  const latePrompts: unknown[] = [];

  let earlyCalls = 0;
  const early = new MockLanguageModelV4({
    doStream: async () => {
      earlyCalls++;
      if (earlyCalls === 1) {
        await lateMemberStarted.promise;
        return groupToolResponse('reply_to_group', 'early-reply', {
          message: 'The answer is already covered.',
        });
      }
      return groupTextResponse('Reply posted.');
    },
  });

  let lateCalls = 0;
  const late = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      lateCalls++;
      latePrompts.push(prompt);
      if (lateCalls === 1) {
        lateMemberStarted.resolve();
        await earlyReplyPublished.promise;
        return groupToolResponse('bash', 'late-boundary', {
          command: 'printf boundary',
          reasoning: 'Create a safe model-step boundary.',
        });
      }
      if (JSON.stringify(prompt).includes('The answer is already covered.')) {
        return groupTextResponse('Nothing non-duplicative to add.');
      }
      return groupToolResponse('reply_to_group', 'late-duplicate', {
        message: 'The answer is already covered.',
      });
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: 'early', model: early },
        { name: 'late', model: late },
      ],
    }),
  );

  const messages = await group.send('What is the answer?', (message) => {
    if (message.author === 'early') earlyReplyPublished.resolve();
  });

  assert.equal(lateCalls, 2);
  assert.match(JSON.stringify(latePrompts[1]), /Sender: early/);
  assert.match(
    JSON.stringify(latePrompts[1]),
    /The answer is already covered\./,
  );
  assert.deepEqual(
    messages
      .filter(({ author }) => author !== 'user')
      .map(({ author, content }) => ({ author, content })),
    [{ author: 'early', content: 'The answer is already covered.' }],
  );
});

test('agents can publish multiple excerpt annotations', async () => {
  const prompts: unknown[] = [];
  let calls = 0;
  const participant = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      calls++;
      if (calls === 1) {
        const messageId = JSON.stringify(prompt).match(
          /\[([\da-f-]{36})\] user:/u,
        )?.[1];
        assert.ok(messageId);
        return groupToolResponse('reply_to_group', 'reply-1', {
          message: 'Start with the evidence.',
          replyToMessageId: messageId,
          annotations: [
            { messageId, excerpt: 'What should' },
            { messageId, excerpt: 'do first' },
          ],
        });
      }
      return groupTextResponse('Nothing else to add.');
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'Maya', model: participant }],
    }),
  );

  const activity: string[] = [];
  const messages = await group.send(
    'What should we do first?',
    undefined,
    (event) => {
      if (event.type === 'presence') activity.push(event.state);
    },
  );
  const original = messages.find(({ author }) => author === 'user')!;
  const reply = messages.find(({ author }) => author === 'Maya');
  assert.ok(reply, JSON.stringify({ messages, activity, prompts }));

  assert.equal(reply.replyToMessageId, original.id);
  assert.deepEqual(reply.annotations, [
    { messageId: original.id, excerpt: 'What should' },
    { messageId: original.id, excerpt: 'do first' },
  ]);
  assert.match(reply.sentAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(activity, ['reading', 'typing', 'reading', 'seen']);
  await assert.rejects(
    group.post('That is not a quote.', 'invalid-annotation', original.id, [
      { messageId: original.id, excerpt: 'missing' },
    ]),
    /Annotation excerpt was not found/u,
  );

  const settled = Promise.withResolvers<void>();
  using subscription = group.subscribe({
    onActivity(event) {
      if (event.type === 'settled') settled.resolve();
    },
  });
  await group.post('Can you clarify that?', 'follow-up', reply.id, [
    { messageId: reply.id, excerpt: 'the evidence' },
  ]);
  await settled.promise;

  assert.ok(
    JSON.stringify(prompts.at(-1)).includes(
      `\\"text\\":\\"the evidence\\",\\"annotation\\":\\"\\"`,
    ),
  );
});

test('annotation notifications use the Codex protocol and bind directives to replies', async () => {
  const prompts: unknown[] = [];
  let calls = 0;
  const participant = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      prompts.push(prompt);
      calls++;
      if (calls === 1) return groupTextResponse('Nothing to add.');
      return calls === 2
        ? groupToolResponse('reply_to_group', 'annotated-reply', {
            message: 'The scope is deliberate. :codex-annotation{index="1"}',
          })
        : groupTextResponse('Nothing else to add.');
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'Maya', model: participant }],
    }),
  );

  await group.send('Validate one market first.');
  const source = group.snapshot().messages[0]!;
  const settled = Promise.withResolvers<void>();
  using subscription = group.subscribe({
    onActivity(event) {
      if (event.type === 'settled') settled.resolve();
    },
  });
  await group.post('', 'annotation-message', undefined, [
    {
      messageId: source.id,
      excerpt: 'one market',
      comment: 'Why only one?',
    },
  ]);
  await settled.promise;

  const prompt = JSON.stringify(prompts[1]);
  assert.match(prompt, /# Response annotations:/u);
  assert.match(
    prompt,
    /\\"text\\":\\"one market\\",\\"annotation\\":\\"Why only one\?\\"/u,
  );
  assert.match(prompt, /:codex-annotation\{index=\\"N\\"\}/u);

  const reply = group
    .snapshot()
    .messages.find(({ author }) => author === 'Maya');
  assert.deepEqual(reply?.responseAnnotations, [
    {
      messageId: source.id,
      excerpt: 'one market',
      comment: 'Why only one?',
    },
  ]);
});

test('ordinary agent contributions do not quote their triggering message', async () => {
  let calls = 0;
  let systemInstructions: string | undefined;
  const participant = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      calls++;
      if (calls > 1) return groupTextResponse('Nothing else to add.');

      const notification = JSON.stringify(prompt);
      const messageId = notification.match(/\[([\da-f-]{36})\] user:/u)?.[1];
      assert.ok(messageId);
      systemInstructions = prompt
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n');

      return groupToolResponse('reply_to_group', 'introduction', {
        message: "I'm Maya. I own the research evidence.",
        replyToMessageId: 'not-a-message',
      });
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'Maya', model: participant }],
    }),
  );

  const messages = await group.send('Introduce yourself.');
  const reply = messages.find(({ author }) => author === 'Maya');
  assert.ok(reply);
  assert.match(
    systemInstructions ?? '',
    /replyToMessageId is an optional UI pointer, not the message you are answering/u,
  );
  assert.match(
    systemInstructions ?? '',
    /Omit replyToMessageId for ordinary responses to the latest user message or current discussion/u,
  );
  assert.match(
    systemInstructions ?? '',
    /Set it only to emphasize a particular earlier message or directly reply to another participant/u,
  );
  assert.equal(reply.replyToMessageId, null);
  assert.deepEqual(reply.annotations, []);
});

test('each group member uses its own telemetry', async () => {
  const firstStarts: unknown[] = [];
  const secondStarts: unknown[] = [];
  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'first',
          model: new MockLanguageModelV4({
            doStream: groupTextResponse('Nothing to add.'),
          }),
          telemetry: {
            functionId: 'parent-chat:first',
            integrations: {
              onStart(event) {
                firstStarts.push(event);
              },
            },
          },
        },
        {
          name: 'second',
          model: new MockLanguageModelV4({
            doStream: groupTextResponse('Nothing to add.'),
          }),
          telemetry: {
            functionId: 'parent-chat:second',
            integrations: {
              onStart(event) {
                secondStarts.push(event);
              },
            },
          },
        },
      ],
    }),
  );

  await group.send('Review this.');

  assert.match(JSON.stringify(firstStarts), /"functionId":"parent-chat:first"/);
  assert.doesNotMatch(JSON.stringify(firstStarts), /parent-chat:second/);
  assert.match(
    JSON.stringify(secondStarts),
    /"functionId":"parent-chat:second"/,
  );
  assert.doesNotMatch(JSON.stringify(secondStarts), /parent-chat:first/);
});

test('coalesces human interventions posted while a batch is running', async () => {
  const firstNotificationStarted = Promise.withResolvers<void>();
  const releaseFirstNotification = Promise.withResolvers<void>();
  const prompts: unknown[] = [];
  let calls = 0;
  const member = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      calls++;
      prompts.push(prompt);
      if (calls === 1) {
        firstNotificationStarted.resolve();
        await releaseFirstNotification.promise;
      }
      return groupTextResponse('I have nothing useful to add.');
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'member', model: member }],
    }),
  );

  const published: { author: string; content: string }[] = [];
  const sending = group.send(
    'Review the launch plan.',
    ({ author, content }) => {
      published.push({ author, content });
    },
  );
  const started = await Promise.race([
    firstNotificationStarted.promise.then(() => true),
    sleep(2_000).then(() => false),
  ]);

  await Promise.all([
    group.post('Also consider accessibility.'),
    group.post('Also consider offline use.'),
  ]);
  const interventionsWereAlreadyPublic = [
    'Also consider accessibility.',
    'Also consider offline use.',
  ].every((expected) =>
    published.some(
      ({ author, content }) => author === 'user' && content === expected,
    ),
  );

  releaseFirstNotification.resolve();
  await sending;

  assert.equal(started, true, 'the first notification did not start in time');
  assert.equal(
    interventionsWereAlreadyPublic,
    true,
    'the interventions waited for the active member',
  );
  assert.equal(calls, 2, 'overlapping interventions created multiple batches');
  for (const intervention of [
    'Also consider accessibility.',
    'Also consider offline use.',
  ]) {
    assert.equal(
      prompts.filter((prompt) => JSON.stringify(prompt).includes(intervention))
        .length,
      1,
      `"${intervention}" was not delivered exactly once`,
    );
  }
});

test('each logical participant consumes every group message once', async () => {
  const prompts = new Map<string, unknown[]>();
  const participant = (name: string) =>
    new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.set(name, [...(prompts.get(name) ?? []), prompt]);
        return groupTextResponse('Nothing distinct to add.');
      },
    });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: 'Maya', model: participant('Maya') },
        { name: 'Omar', model: participant('Omar') },
      ],
    }),
  );
  const settled = Promise.withResolvers<void>();
  using subscription = group.subscribe({
    onActivity(activity) {
      if (activity.type === 'settled') settled.resolve();
    },
  });

  await Promise.all([
    group.post('Review this once.', 'logical-message'),
    group.post('Review this once.', 'logical-message'),
  ]);
  await settled.promise;

  assert.deepEqual(
    [...prompts]
      .map(([name, seen]) => ({
        name,
        calls: seen.length,
        received: JSON.stringify(seen).includes('Review this once.'),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'Maya', calls: 1, received: true },
      { name: 'Omar', calls: 1, received: true },
    ],
  );
});

test('every group member answers a greeting addressed to the whole group', async () => {
  const wholeGroupGreetingRule =
    'When the human greets or addresses the whole group, every participant must reply once with a brief, natural acknowledgment, even if another participant has already acknowledged.';
  const firstNotificationStarted = Promise.withResolvers<void>();
  const firstParticipants = new Set<string>();
  let activeParticipationChecks = 0;
  let maxActiveParticipationChecks = 0;

  const enterFirstNotification = async (name: string) => {
    firstParticipants.add(name);
    activeParticipationChecks++;
    maxActiveParticipationChecks = Math.max(
      maxActiveParticipationChecks,
      activeParticipationChecks,
    );
    if (firstParticipants.size === 2) firstNotificationStarted.resolve();
    await Promise.race([
      firstNotificationStarted.promise,
      sleep(2_000).then(() => {
        throw new Error(
          'members did not receive the notification concurrently',
        );
      }),
    ]);
    activeParticipationChecks--;
  };

  let researcherTools: unknown;
  const participant = (name: string, message: string) => {
    let firstCall = true;
    let replied = false;
    return new MockLanguageModelV4({
      doStream: async ({ prompt, tools }) => {
        if (name === 'researcher') researcherTools = tools;
        if (firstCall) {
          firstCall = false;
          await enterFirstNotification(name);
        }

        const context = JSON.stringify(prompt);
        if (!context.includes(wholeGroupGreetingRule)) {
          return groupTextResponse('Greetings are outside my role.');
        }
        if (context.includes('"posted":true')) replied = true;
        if (replied) return groupTextResponse('Reply posted.');
        return groupToolResponse('reply_to_group', `${name}-greeting`, {
          message,
        });
      },
    });
  };

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'researcher',
          model: participant('researcher', 'Researcher here!'),
          tools: createParticipantDefaults({ apiKey: 'test-key' }).tools,
        },
        {
          name: 'critic',
          model: participant('critic', 'Critic here!'),
        },
      ],
    }),
  );

  const messages = await group.send('Hi everyone!');

  assert.equal(maxActiveParticipationChecks, 2);
  assert.match(JSON.stringify(researcherTools), /openrouter\.web_search/);
  assert.deepEqual(
    messages
      .filter(({ author }) => author !== 'user')
      .map(({ author, content }) => ({ author, content }))
      .sort((left, right) => left.author.localeCompare(right.author)),
    [
      {
        author: 'critic',
        content: 'Critic here!',
      },
      {
        author: 'researcher',
        content: 'Researcher here!',
      },
    ],
  );
});

test('only Factory replies when the user greets Factory naturally', async () => {
  const directAddressRule =
    'When the human clearly addresses one participant, only that participant may call reply_to_group.';
  let factoryReplied = false;
  const factory = new MockLanguageModelV4({
    doStream: async () => {
      if (factoryReplied) return groupTextResponse('Reply posted.');
      factoryReplied = true;
      return groupToolResponse('reply_to_group', 'factory-reply', {
        message: 'Yep—I’m here.',
      });
    },
  });
  let paulReplied = false;
  const paul = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      if (JSON.stringify(prompt).includes(directAddressRule)) {
        return groupTextResponse('The user addressed Factory.');
      }
      if (paulReplied) return groupTextResponse('Reply posted.');
      paulReplied = true;
      return groupToolResponse('reply_to_group', 'paul-reply', {
        message: 'Yep—I’m here.',
      });
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Paul Graham',
          model: paul,
        },
        {
          name: 'Factory',
          model: factory,
        },
      ],
    }),
  );

  const messages = await group.send('Hey Factory. can you hear me?');

  assert.deepEqual(
    messages
      .filter(({ author }) => author !== 'user')
      .map(({ author }) => author),
    ['Factory'],
  );
});

test('the sole participant treats the first human message as direct', async () => {
  const rosterReminder =
    'use bash to list all participant directories under /workspace/participants';
  let inspectedRoster = false;
  let replied = false;
  const factory = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      if (!JSON.stringify(prompt).includes(rosterReminder)) {
        return groupTextResponse('The greeting was not addressed to me.');
      }
      if (!inspectedRoster) {
        inspectedRoster = true;
        return groupToolResponse('bash', 'inspect-participants', {
          command:
            'find /workspace/participants -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null',
          reasoning: 'Check who else is participating in this group.',
        });
      }
      if (replied) return groupTextResponse('Reply posted.');
      replied = true;
      return groupToolResponse('reply_to_group', 'factory-reply', {
        message: 'Hey brother!',
      });
    },
  });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'Factory', model: factory }],
    }),
  );

  const activity: string[] = [];
  const messages = await group.send('Hey brother', undefined, (event) => {
    if (event.type === 'presence') activity.push(event.state);
  });

  assert.equal(inspectedRoster, true);
  assert.deepEqual(activity, [
    'reading',
    'working-with-files',
    'reading',
    'typing',
    'reading',
    'seen',
  ]);
  assert.deepEqual(
    messages.map(({ author, content }) => ({ author, content })),
    [
      { author: 'user', content: 'Hey brother' },
      { author: 'Factory', content: 'Hey brother!' },
    ],
  );
});

test('group prompt selects one responder for an explicitly single-answer request', async () => {
  const participant = (name: string) => {
    let replied = false;
    return new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        if (replied) return groupTextResponse('Nothing else to add.');
        const instructions = JSON.stringify(prompt);
        const hasSingleResponderRule = instructions.includes(
          'When the user explicitly asks for exactly one answer',
        );
        if (hasSingleResponderRule && name !== 'Maya') {
          return groupTextResponse('Maya owns this answer.');
        }
        replied = true;
        return groupToolResponse('reply_to_group', `${name}-reply`, {
          message: `${name} answered.`,
        });
      },
    });
  };

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Maya',
          model: participant('Maya'),
        },
        {
          name: 'Omar',
          model: participant('Omar'),
        },
      ],
    }),
  );

  const messages = await group.send('Can exactly one of you answer this?');

  assert.deepEqual(
    messages
      .filter(({ author }) => author !== 'user')
      .map(({ author }) => author),
    ['Maya'],
  );
});

test('the previous responder answers an ambiguous short follow-up', async () => {
  const followUpRule =
    'A short, unaddressed user follow-up or acknowledgment belongs to the participant who authored the immediately preceding public reply.';
  const followUpOwnerRule =
    'If that was you, reply briefly; if the intent is unclear, ask one concise clarifying question.';
  const participant = (name: 'Maya' | 'Omar') => {
    let initialReplyPosted = false;
    let followUpHandled = false;
    return new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        const instructions = JSON.stringify(prompt);
        if (instructions.includes('So?') && !followUpHandled) {
          followUpHandled = true;
          if (instructions.includes(followUpRule) && name !== 'Omar') {
            return groupTextResponse('The follow-up belongs to Omar.');
          }
          if (!instructions.includes(followUpOwnerRule)) {
            return groupTextResponse(
              'The follow-up does not require an answer.',
            );
          }
          return groupToolResponse('reply_to_group', `${name}-thanks`, {
            message: `${name} asked what needs clarification.`,
          });
        }
        if (name === 'Omar' && !initialReplyPosted) {
          initialReplyPosted = true;
          return groupToolResponse('reply_to_group', 'omar-initial', {
            message: 'Omar answered the question.',
          });
        }
        return groupTextResponse('Nothing else to add.');
      },
    });
  };

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Maya',
          model: participant('Maya'),
        },
        {
          name: 'Omar',
          model: participant('Omar'),
        },
      ],
    }),
  );

  await group.send('Omar, what do you think?');
  const beforeFollowUp = group.snapshot().messages.length;
  const messages = await group.send('So?');

  assert.deepEqual(
    messages
      .slice(beforeFollowUp)
      .filter(({ author }) => author !== 'user')
      .map(({ author }) => author),
    ['Omar'],
  );
});

test('a chat survives a runtime restart and replays persisted events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zukhruf-chat-'));
  const conversation = { chatId: 'durable-chat', userId: 'local-user' };
  const liveEvents: WhatsAppChatEvent[] = [];
  const participants = [
    {
      name: 'Maya',
      model: new MockLanguageModelV4({
        doStream: groupTextResponse('Nothing distinct to add.'),
      }),
    },
  ];

  try {
    {
      await using runtime = durableRuntime(participants, directory);
      await runtime.createSession(conversation);
      const stream = await runtime.observe(conversation).resume();
      assert.ok(stream);
      const reader = stream.getReader();
      await runtime.post(conversation, {
        id: 'message-1',
        content: 'Keep this after restart.',
      });
      await waitForChat(runtime, conversation, 'settled');
      while (
        !liveEvents.some(
          (event) =>
            event.type === 'activity' && event.activity.type === 'settled',
        )
      ) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === 'data-whatsapp-chat-event') {
          liveEvents.push(value.data as WhatsAppChatEvent);
        }
      }
      await reader.cancel();
    }

    assert.equal(
      liveEvents.some(
        (event) =>
          event.type === 'activity' && event.activity.type === 'presence',
      ),
      true,
    );

    await using runtime = durableRuntime(participants, directory);
    const snapshot = await runtime.snapshot(conversation);
    assert.deepEqual(
      snapshot.messages.map(({ id, author, content }) => ({
        id,
        author,
        content,
      })),
      [
        {
          id: 'message-1',
          author: 'user',
          content: 'Keep this after restart.',
        },
      ],
    );
    assert.deepEqual(snapshot.participants, [{ name: 'Maya' }]);
    assert.equal(snapshot.activity.phase, 'settled');

    const stream = await runtime.observe(conversation).resume();
    assert.ok(stream);
    const reader = stream.getReader();
    const replayed: WhatsAppChatEvent[] = [];
    while (
      !replayed.some(
        (event) =>
          event.type === 'activity' && event.activity.type === 'settled',
      )
    ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.type === 'data-whatsapp-chat-event') {
        replayed.push(value.data as WhatsAppChatEvent);
      }
    }
    await reader.cancel();
    assert.equal(
      replayed.some(
        (event) =>
          event.type === 'activity' && event.activity.type === 'presence',
      ),
      false,
    );
    assert.deepEqual(
      replayed.map(({ cursor }) => cursor),
      liveEvents
        .filter(
          (event) =>
            event.type !== 'activity' || event.activity.type !== 'presence',
        )
        .map(({ cursor }) => cursor),
    );
    assert.equal(replayed.at(-1)?.cursor, snapshot.cursor);
    assert.equal(
      replayed.some(
        ({ cursor }, index) =>
          index > 0 && cursor > replayed[index - 1]!.cursor + 1,
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('participant conversations stay attached to their identity when the roster changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zukhruf-roster-'));
  const conversation = { chatId: 'roster-chat', userId: 'local-user' };
  const factoryPrompts: unknown[] = [];
  const asymmetryPrompts: unknown[] = [];
  const model = (prompts: unknown[]) =>
    new MockLanguageModelV4({
      doStream: async ({ prompt }) => {
        prompts.push(prompt);
        return groupTextResponse('Nothing distinct to add.');
      },
    });
  const factory = model(factoryPrompts);

  try {
    {
      await using runtime = durableRuntime(
        [{ name: 'Factory', model: factory }],
        directory,
      );
      await runtime.post(conversation, {
        id: 'message-1',
        content: 'Factory should remember this.',
      });
      await waitForChat(runtime, conversation, 'settled');
    }

    await using runtime = durableRuntime(
      [
        { name: 'Asymmetry', model: model(asymmetryPrompts) },
        { name: 'Factory', model: factory },
      ],
      directory,
    );
    await runtime.post(conversation, {
      id: 'message-2',
      content: 'The roster changed.',
    });
    await waitForChat(runtime, conversation, 'settled');

    assert.equal(asymmetryPrompts.length, 1);
    assert.equal(factoryPrompts.length, 2);
    assert.doesNotMatch(
      JSON.stringify(asymmetryPrompts.at(-1)),
      /Factory should remember this\./,
    );
    assert.match(
      JSON.stringify(factoryPrompts.at(-1)),
      /Factory should remember this\./,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime shutdown persists interrupted participant work as stopped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zukhruf-interrupted-chat-'));
  const conversation = { chatId: 'interrupted-chat', userId: 'local-user' };
  const participantStarted = Promise.withResolvers<void>();
  const releaseParticipant = Promise.withResolvers<void>();
  const participants = [
    {
      name: 'Maya',
      model: new MockLanguageModelV4({
        doStream: async ({ abortSignal }) => {
          participantStarted.resolve();
          await Promise.race([
            releaseParticipant.promise,
            new Promise<void>((resolve) =>
              abortSignal?.addEventListener('abort', () => resolve(), {
                once: true,
              }),
            ),
          ]);
          return groupTextResponse('Nothing distinct to add.');
        },
      }),
    },
  ];

  try {
    const firstRuntime = durableRuntime(participants, directory);
    await firstRuntime.post(conversation, {
      id: 'message-1',
      content: 'This work will be interrupted.',
    });
    await participantStarted.promise;
    await firstRuntime[Symbol.asyncDispose]();

    await using secondRuntime = durableRuntime(participants, directory);
    const snapshot = await secondRuntime.snapshot(conversation);
    assert.equal(snapshot.activity.phase, 'stopped');
    assert.equal(snapshot.activity.stopReason, 'interrupted');
    assert.deepEqual(
      snapshot.messages.map(({ id, content }) => ({ id, content })),
      [
        {
          id: 'message-1',
          content: 'This work will be interrupted.',
        },
      ],
    );
  } finally {
    releaseParticipant.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test('chat stop cancels active participant work', async () => {
  const participantStarted = Promise.withResolvers<void>();
  const releaseParticipant = Promise.withResolvers<void>();
  let aborted = false;
  const participant = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      participantStarted.resolve();
      await Promise.race([
        releaseParticipant.promise,
        new Promise<void>((resolve) =>
          abortSignal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        ),
      ]);
      return groupTextResponse('Nothing distinct to add.');
    },
  });
  await using runtime = memoryRuntime([
    {
      name: 'Maya',
      model: participant,
    },
  ]);

  try {
    const groupApp = testApp({ runtime });
    await groupApp.request('/api/chat/chat-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'message-1', content: 'Keep working.' }),
    });
    await participantStarted.promise;

    const response = await groupApp.request('/api/chat/chat-1/stop', {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    const state = (await response.json()) as ReturnType<
      WhatsAppGroup['snapshot']
    >;
    assert.equal(state.activity.phase, 'stopped');
    assert.equal(state.activity.stopReason, 'user');
    assert.equal(aborted, true);
  } finally {
    releaseParticipant.resolve();
  }
});

test('the chat stops at its public reply ceiling', async () => {
  let replies = 0;
  const alwaysReplies = (name: string) =>
    new MockLanguageModelV4({
      doStream: async () =>
        groupToolResponse('reply_to_group', `${name}-${++replies}`, {
          message: `${name} reply ${replies}`,
        }),
    });

  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Maya',
          model: alwaysReplies('Maya'),
        },
        {
          name: 'Omar',
          model: alwaysReplies('Omar'),
        },
      ],
      limits: {
        ...testGroupLimits,
        notifications: 10,
        agentMessages: 2,
      },
    }),
  );

  const messages = await group.send('Debate forever.');
  assert.equal(messages.filter(({ author }) => author !== 'user').length, 2);
  assert.equal(group.snapshot().activity.phase, 'stopped');
  assert.equal(group.snapshot().activity.stopReason, 'limit');
});

test('one participant failure does not erase successful replies', async () => {
  let usefulCalls = 0;
  await using resources = new AsyncDisposableStack();
  const group = resources.use(
    await WhatsAppGroup.create({
      ...testGroupDependencies(resources),
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        {
          name: 'Maya',
          model: new MockLanguageModelV4({
            doStream: async () => {
              usefulCalls++;
              return usefulCalls === 1
                ? groupToolResponse('reply_to_group', 'useful-reply', {
                    message: 'Here is the useful result.',
                  })
                : groupTextResponse('Nothing else to add.');
            },
          }),
        },
        {
          name: 'Omar',
          model: new MockLanguageModelV4({
            doStream: async () => {
              throw new Error('participant unavailable');
            },
          }),
        },
      ],
    }),
  );

  const messages = await group.send('Please investigate.');
  assert.equal(
    messages.some(
      ({ author, content }) =>
        author === 'Maya' && content === 'Here is the useful result.',
    ),
    true,
  );
  assert.equal(group.snapshot().activity.phase, 'settled');
  assert.equal(
    group.snapshot().activity.participants.find(({ name }) => name === 'Omar')
      ?.state,
    'failed',
  );
});

test('shared transcripts are read from storage without starting the group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'share-transcript-'));
  try {
    const conversation = { chatId: 'shared-chat', userId: 'owner-user' };
    let replies = 0;
    const participants = [
      {
        name: 'Annie Duke',
        model: new MockLanguageModelV4({
          doStream: async () =>
            replies++ === 0
              ? groupToolResponse('reply_to_group', 'annie-reply', {
                  message: 'Separate the decision from the outcome.',
                })
              : groupTextResponse('Reply posted.'),
        }),
      },
    ];
    await using runtime = durableRuntime(participants, directory);
    await runtime.post(conversation, {
      id: 'message-1',
      content: 'How should we price this?',
    });
    await waitForChat(runtime, conversation, 'settled');

    await using reader = durableRuntime(participants, directory);
    const transcript = await reader.transcript(conversation);

    assert.deepEqual(
      transcript.messages.map(({ author, content }) => ({ author, content })),
      [
        { author: 'user', content: 'How should we price this?' },
        {
          author: 'Annie Duke',
          content: 'Separate the decision from the outcome.',
        },
      ],
    );
    assert.deepEqual(transcript.participants, [{ name: 'Annie Duke' }]);

    const untouched = { chatId: 'never-opened-chat', userId: 'owner-user' };
    assert.deepEqual(await reader.transcript(untouched), {
      messages: [],
      participants: [{ name: 'Annie Duke' }],
    });
    assert.equal(await reader.sessionExists(untouched), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('clearing a chat erases the stored transcript for every runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clear-chat-'));
  try {
    const conversation = { chatId: 'cleared-chat', userId: 'owner-user' };
    let replies = 0;
    const participants = [
      {
        name: 'Annie Duke',
        model: new MockLanguageModelV4({
          doStream: async () =>
            replies++ === 0
              ? groupToolResponse('reply_to_group', 'annie-reply', {
                  message: 'Separate the decision from the outcome.',
                })
              : groupTextResponse('Reply posted.'),
        }),
      },
    ];

    await using runtime = durableRuntime(participants, directory);
    await runtime.post(conversation, {
      id: 'message-1',
      content: 'How should we price this?',
    });
    await waitForChat(runtime, conversation, 'settled');
    assert.equal((await runtime.transcript(conversation)).messages.length, 2);

    await runtime.clear(conversation);

    assert.deepEqual((await runtime.transcript(conversation)).messages, []);
    assert.equal(await runtime.sessionExists(conversation), false);

    await using reader = durableRuntime(participants, directory);
    assert.deepEqual((await reader.transcript(conversation)).messages, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('participant identities cannot collide with the human author', async () => {
  const model = new MockLanguageModelV4({
    doStream: groupTextResponse('Nothing to add.'),
  });
  await using resources = new AsyncDisposableStack();
  const dependencies = testGroupDependencies(resources);

  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'USER', model }],
    }),
    /reserved/,
  );
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [
        { name: 'Maya', model },
        { name: 'maya', model },
      ],
    }),
    /duplicated/,
  );
  await assert.rejects(
    WhatsAppGroup.create({
      ...dependencies,
      conversation: testGroupConversation,
      sandbox: testGroupSandbox,
      participants: [{ name: 'Maya\nAdmin', model }],
    }),
    /valid/,
  );
});

async function waitForChat(
  runtime: WhatsAppChatRuntime,
  conversation: { chatId: string; userId: string },
  phase: 'settled' | 'stopped',
  attempts = 500,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const snapshot = await runtime.snapshot(conversation);
    if (snapshot.activity.phase === phase) return snapshot;
    await sleep(10);
  }
  throw new Error(`Chat did not become ${phase}`);
}

const groupUsage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const;

function groupTextResponse(text: string) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start' as const, id: 'text-1' },
        { type: 'text-delta' as const, id: 'text-1', delta: text },
        { type: 'text-end' as const, id: 'text-1' },
        {
          type: 'finish' as const,
          finishReason: { unified: 'stop' as const, raw: '' },
          usage: groupUsage,
        },
      ],
    }),
  };
}

function groupToolResponse(
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
) {
  return {
    stream: simulateReadableStream({
      chunks: [
        {
          type: 'tool-call' as const,
          toolCallId,
          toolName,
          input: JSON.stringify(input),
        },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: '' },
          usage: groupUsage,
        },
      ],
    }),
  };
}
