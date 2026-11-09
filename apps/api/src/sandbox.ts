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
import { isErrno } from '@zukhruf/fs';
import pMemoize from 'p-memoize';

import type { ParticipantMount } from './group/participants/index.js';

const COMMAND_TIMEOUT_MS = 300_000;
const SANDBOX_IMAGE = 'node:24-bookworm-slim';

interface GroupSandboxesOptions {
  dataDirectory: string;
  mountsFor: (conversation: ConversationId) => ParticipantMount[];
}

export class GroupSandboxes implements AsyncDisposable {
  readonly #dataDirectory: string;
  readonly #mountsFor: GroupSandboxesOptions['mountsFor'];
  readonly #sandboxes = new Map<string, AgentDeclaration['sandbox']>();
  readonly #backends = new Map<string, () => Promise<DisposableSandbox>>();

  constructor(options: GroupSandboxesOptions) {
    this.#dataDirectory = resolve(options.dataDirectory);
    this.#mountsFor = options.mountsFor;
  }

  sandboxFor(conversation: ConversationId): AgentDeclaration['sandbox'] {
    const name = sandboxName(conversation);
    const current = this.#sandboxes.get(name);
    if (current) return current;

    const sandbox = defineSandbox(() => this.#backend(name, conversation));
    this.#sandboxes.set(name, sandbox);
    return sandbox;
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
      if (isErrno(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async remove(conversation: ConversationId): Promise<void> {
    const name = sandboxName(conversation);
    const root = this.#root(conversation);
    const opened = this.#backends.get(name);
    this.#sandboxes.delete(name);
    this.#backends.delete(name);
    const backend = await opened?.().catch(() => undefined);
    if (!backend) {
      try {
        await stat(root);
      } catch (error) {
        if (isErrno(error, 'ENOENT')) return;
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
    const backends = [...this.#backends.values()];
    this.#sandboxes.clear();
    this.#backends.clear();
    await Promise.all(
      backends.map((backend) =>
        backend().then(
          (opened) => opened.dispose(),
          () => undefined,
        ),
      ),
    );
  }

  #backend(name: string, conversation: ConversationId) {
    const existing = this.#backends.get(name);
    if (existing) return existing();

    const backend: () => Promise<DisposableSandbox> = pMemoize(async () => {
      try {
        return await this.#create(conversation, name);
      } catch (error) {
        if (this.#backends.get(name) === backend) this.#backends.delete(name);
        throw error;
      }
    });
    this.#backends.set(name, backend);
    return backend();
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
