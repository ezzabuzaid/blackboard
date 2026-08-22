import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  type DisposableSandbox,
  createMicrosandboxSandbox,
} from '@deepagents/context';
import {
  type AgentDeclaration,
  type ConversationId,
  defineSandbox,
} from '@deepagents/experimental/zukhruf';
import { NetworkPolicy, Sandbox, SandboxNotFoundError } from 'microsandbox';

import type { ParticipantMount } from './group/participants/index.js';

interface GroupSandboxesOptions {
  dataDirectory: string;
  mountsFor: (conversation: ConversationId) => ParticipantMount[];
}

interface GroupSandbox {
  conversation: ConversationId;
  sandbox: AgentDeclaration['sandbox'];
  backend?: Promise<DisposableSandbox>;
}

export class GroupSandboxes implements AsyncDisposable {
  readonly #dataDirectory: string;
  readonly #mountsFor: GroupSandboxesOptions['mountsFor'];
  readonly #sandboxes = new Map<string, GroupSandbox>();

  constructor(options: GroupSandboxesOptions) {
    this.#dataDirectory = resolve(options.dataDirectory);
    this.#mountsFor = options.mountsFor;
  }

  sandboxFor(conversation: ConversationId): AgentDeclaration['sandbox'] {
    const name = sandboxName(conversation);
    const current = this.#sandboxes.get(name);
    if (current) return current.sandbox;

    const entry = { conversation } as GroupSandbox;
    entry.sandbox = defineSandbox(() => this.#backend(name, entry));
    this.#sandboxes.set(name, entry);
    return entry.sandbox;
  }

  async openArtifact(conversation: ConversationId, path: string) {
    const root = this.#artifactDirectory(conversation);
    const file = resolve(root, path);
    const withinRoot = relative(root, file);
    if (withinRoot.startsWith('..') || isAbsolute(withinRoot)) return null;

    try {
      const metadata = await stat(file);
      if (!metadata.isFile()) return null;
      return { body: await readFile(file), size: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(conversation: ConversationId): Promise<void> {
    const name = sandboxName(conversation);
    const entry = this.#sandboxes.get(name);
    this.#sandboxes.delete(name);
    await entry?.backend?.then(
      (backend) => backend.dispose(),
      () => undefined,
    );
    await removePersistedSandbox(name);
    await rm(this.#root(conversation), { recursive: true, force: true });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const entries = [...this.#sandboxes.values()];
    this.#sandboxes.clear();
    await Promise.all(
      entries.map((entry) =>
        entry.backend?.then(
          (backend) => backend.dispose(),
          () => undefined,
        ),
      ),
    );
  }

  #backend(name: string, entry: GroupSandbox) {
    if (entry.backend) return entry.backend;
    const creating = this.#create(entry.conversation, name);
    entry.backend = creating;
    void creating.catch(() => {
      if (entry.backend === creating) entry.backend = undefined;
    });
    return creating;
  }

  async #create(conversation: ConversationId, name: string) {
    const workspace = this.#workspaceDirectory(conversation);
    const mounts = this.#mountsFor(conversation);
    const mountPoints = mounts.flatMap((mount) => {
      const writableParent = mounts.find(
        (candidate) =>
          !candidate.readOnly &&
          mount.guestPath.startsWith(`${candidate.guestPath}/`),
      );
      return [
        resolve(workspace, relative('/workspace', mount.guestPath)),
        ...(writableParent
          ? [
              resolve(
                writableParent.hostPath,
                relative(writableParent.guestPath, mount.guestPath),
              ),
            ]
          : []),
      ];
    });
    await Promise.all(
      [
        workspace,
        resolve(workspace, 'participants'),
        this.#artifactDirectory(conversation),
        ...mountPoints,
      ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
    );
    const [canonicalWorkspace, canonicalMounts] = await Promise.all([
      realpath(workspace),
      Promise.all(
        mounts.map(async (mount) => ({
          ...mount,
          hostPath: await realpath(mount.hostPath),
        })),
      ),
    ]);

    return createMicrosandboxSandbox({
      name,
      image: 'node:24-bookworm-slim',
      commandTimeout: 300_000,
      configure: (builder) => {
        let configured = builder
          .volume('/workspace', (mount) =>
            mount.bind(canonicalWorkspace).nosuid().nodev(),
          )
          .network((network) => network.policy(NetworkPolicy.none()));
        for (const mount of canonicalMounts) {
          configured = configured.volume(mount.guestPath, (volume) => {
            const bound = volume.bind(mount.hostPath).noexec().nosuid().nodev();
            return mount.readOnly ? bound.readonly() : bound;
          });
        }
        return configured;
      },
    });
  }

  #root(conversation: ConversationId) {
    return resolve(this.#dataDirectory, 'sandboxes', sandboxId(conversation));
  }

  #workspaceDirectory(conversation: ConversationId) {
    return resolve(this.#root(conversation), 'workspace');
  }

  #artifactDirectory(conversation: ConversationId) {
    return resolve(this.#workspaceDirectory(conversation), 'output');
  }
}

async function removePersistedSandbox(name: string) {
  try {
    const sandbox = await Sandbox.get(name);
    if (sandbox.status === 'running') await sandbox.stop();
    else if (sandbox.status === 'draining') await sandbox.waitUntilStopped();
    await sandbox.remove();
  } catch (error) {
    if (!(error instanceof SandboxNotFoundError)) throw error;
  }
}

function sandboxName(conversation: ConversationId) {
  return `baseera-${sandboxId(conversation)}`;
}

function sandboxId({ userId, chatId }: ConversationId) {
  return createHash('sha256')
    .update(userId)
    .update('\0')
    .update(chatId)
    .digest('hex')
    .slice(0, 32);
}
