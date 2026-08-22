import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type AgentModel, fragment } from '@deepagents/context';
import { createFileTelemetry } from '@deepagents/context/telemetry/file';
import type { ToolSet } from 'ai';

import type { WhatsAppParticipant } from '../whatsapp.js';

const IDENTITY_FILE = 'identity.json';

interface ParticipantDefaults {
  model: AgentModel;
  tools: ToolSet;
}

interface ParticipantDefinition {
  directory: string;
  name: string;
  readOnly: boolean;
}

interface ParticipantSource {
  directory: string;
  hostPath: string;
  readOnly: boolean;
}

export interface ParticipantMount {
  guestPath: string;
  hostPath: string;
  readOnly: boolean;
}

export interface ParticipantDirectoryOptions {
  directory: string;
  builtinsDirectory: string;
  catalogDirectory?: string;
  telemetryDirectory: string;
  loadDefaults: (userId: string) => Promise<ParticipantDefaults>;
}

export class ParticipantDirectory {
  readonly #builtinDirectories: string[];
  readonly #catalogDirectories: readonly string[];
  readonly #catalogDirectory?: string;
  readonly #directory: string;
  readonly #defaults = new Map<string, Promise<ParticipantDefaults>>();
  readonly #builtinsDirectory: string;
  readonly #telemetryDirectory: string;
  readonly #loadDefaults: ParticipantDirectoryOptions['loadDefaults'];

  constructor(options: ParticipantDirectoryOptions) {
    this.#directory = resolve(options.directory);
    this.#builtinsDirectory = resolve(options.builtinsDirectory);
    this.#catalogDirectory = options.catalogDirectory
      ? resolve(options.catalogDirectory)
      : undefined;
    this.#telemetryDirectory = resolve(options.telemetryDirectory);
    this.#loadDefaults = options.loadDefaults;
    this.#builtinDirectories = this.#loadBuiltinDirectories();
    this.#catalogDirectories = this.#catalogDirectory
      ? directoryNames(this.#catalogDirectory)
      : [];
  }

  mounts(userId: string, catalogIds?: readonly string[]): ParticipantMount[] {
    if (catalogIds) {
      return this.#catalogSelection(catalogIds).map((directory) => ({
        guestPath: `/workspace/participants/${directory}`,
        hostPath: resolve(this.#catalogDirectory!, directory),
        readOnly: true,
      }));
    }

    return [
      {
        guestPath: '/workspace/participants',
        hostPath: this.#userDirectory(userId),
        readOnly: false,
      },
      ...this.#builtinDirectories.map((directory) => ({
        guestPath: `/workspace/participants/${directory}`,
        hostPath: resolve(this.#builtinsDirectory, directory),
        readOnly: true,
      })),
    ];
  }

  async participants(
    userId: string,
    catalogIds?: readonly string[],
  ): Promise<readonly WhatsAppParticipant[]> {
    const defaults = await this.#defaultsFor(userId);
    const definitions = await Promise.all(
      this.#sources(userId, catalogIds).map((source) =>
        this.#readIdentity(source),
      ),
    );
    return definitions.map((definition) =>
      this.#participant(userId, definition, defaults),
    );
  }

  #loadBuiltinDirectories() {
    return directoryNames(this.#builtinsDirectory);
  }

  #catalogSelection(ids: readonly string[]) {
    if (!this.#catalogDirectory) {
      throw new Error('Participant catalog is not configured');
    }
    const available = new Set(this.#catalogDirectories);
    const unknown = ids.find((id) => !available.has(id));
    if (unknown) throw new Error(`Unknown catalog participant "${unknown}"`);
    return ids;
  }

  #sources(
    userId: string,
    catalogIds?: readonly string[],
  ): ParticipantSource[] {
    if (catalogIds) {
      return this.#catalogSelection(catalogIds).map((directory) => ({
        directory,
        hostPath: resolve(this.#catalogDirectory!, directory),
        readOnly: true,
      }));
    }

    const builtinSet = new Set(this.#builtinDirectories);
    const userDirectory = this.#userDirectory(userId);
    return [
      ...directoryNames(userDirectory)
        .filter((directory) => !builtinSet.has(directory))
        .map((directory) => ({
          directory,
          hostPath: resolve(userDirectory, directory),
          readOnly: false,
        })),
      ...this.#builtinDirectories.map((directory) => ({
        directory,
        hostPath: resolve(this.#builtinsDirectory, directory),
        readOnly: true,
      })),
    ];
  }

  async #readIdentity(
    source: ParticipantSource,
  ): Promise<ParticipantDefinition> {
    let identity: unknown;
    try {
      identity = JSON.parse(
        await readFile(resolve(source.hostPath, IDENTITY_FILE), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Participant "${source.directory}" requires ${IDENTITY_FILE}`,
          { cause: error },
        );
      }
      throw new Error(
        `Participant "${source.directory}" has an invalid ${IDENTITY_FILE}`,
        { cause: error },
      );
    }
    if (!isIdentity(identity)) {
      throw new Error(
        `Participant "${source.directory}" ${IDENTITY_FILE} requires a non-empty name string`,
      );
    }

    return {
      directory: source.directory,
      name: identity.name,
      readOnly: source.readOnly,
    };
  }

  #participant(
    userId: string,
    definition: ParticipantDefinition,
    defaults: ParticipantDefaults,
  ): WhatsAppParticipant {
    const tracePath = resolve(
      this.#telemetryDirectory,
      userNamespace(userId),
      `${definition.directory}.jsonl`,
    );
    return {
      name: definition.name,
      instructions: [
        fragment(
          'participant-bootstrap',
          `At the start of every turn, use bash to inspect ${JSON.stringify(
            `/workspace/participants/${definition.directory}`,
          )}. Read SOUL.md for persona and voice, AGENTS.md for operating instructions, and MEMORY.md for durable knowledge. Follow them for that turn. ${definition.readOnly ? 'This catalog definition is read-only.' : 'Participant files are writable; use bash to edit them directly when your role calls for it.'}`,
        ),
      ],
      model: defaults.model,
      tools: defaults.tools,
      tracePath,
      telemetry: {
        integrations: createFileTelemetry({ path: tracePath }),
      },
    };
  }

  #defaultsFor(userId: string) {
    let defaults = this.#defaults.get(userId);
    if (!defaults) {
      defaults = this.#loadDefaults(userId).catch((error: unknown) => {
        this.#defaults.delete(userId);
        throw error;
      });
      this.#defaults.set(userId, defaults);
    }
    return defaults;
  }

  #userDirectory(userId: string) {
    const directory = resolve(this.#directory, userNamespace(userId));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
}

function directoryNames(directory: string) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(({ name }) => name)
    .toSorted((left, right) => left.localeCompare(right, 'en'));
}

function userNamespace(userId: string) {
  return createHash('sha256').update(userId).digest('hex');
}

function isIdentity(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name === value.name.trim()
  );
}
