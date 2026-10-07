import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  type DisposableSandbox,
  createDockerSandbox,
} from '@deepagents/context';
import {
  type AgentDeclaration,
  type ConversationId,
  defineSandbox,
} from '@deepagents/experimental/zukhruf';

import type { ParticipantMount } from './group/participants/index.js';

const COMMAND_TIMEOUT_MS = 300_000;
const SANDBOX_IMAGE = 'node:24-bookworm-slim';

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
    const root = this.#root(conversation);
    const entry = this.#sandboxes.get(name);
    this.#sandboxes.delete(name);
    const backend = await entry?.backend?.catch(() => undefined);
    if (!backend) {
      try {
        await stat(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
    await (
      backend ??
      (await createDockerSandbox({
        name,
        image: SANDBOX_IMAGE,
        network: { mode: 'none' },
      }))
    ).dispose();
    await rm(root, { recursive: true, force: true });
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

    return createDockerSandbox({
      name,
      image: SANDBOX_IMAGE,
      commandTimeout: COMMAND_TIMEOUT_MS,
      network: { mode: 'none' },
      security:
        process.getuid && process.getgid
          ? { user: `${process.getuid()}:${process.getgid()}` }
          : undefined,
      volumes: [
        {
          type: 'bind',
          hostPath: canonicalWorkspace,
          containerPath: '/workspace',
          readOnly: false,
        },
        ...canonicalMounts.map((mount) => ({
          type: 'bind' as const,
          hostPath: mount.hostPath,
          containerPath: mount.guestPath,
          readOnly: mount.readOnly,
        })),
      ],
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
