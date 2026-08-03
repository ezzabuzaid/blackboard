import { createHash } from "node:crypto"
import { readdirSync } from "node:fs"
import { resolve } from "node:path"

import { fragment, type AgentModel } from "@deepagents/context"
import { createFileTelemetry } from "@deepagents/context/telemetry/file"
import { SqliteFs } from "@deepagents/text2sql"
import type { ToolSet } from "ai"
import { MountableFs, OverlayFs, type IFileSystem } from "just-bash"

import type { WhatsAppParticipant } from "../whatsapp.js"

const IDENTITY_FILE = "identity.json"

interface ParticipantDefaults {
  model: AgentModel
  tools: ToolSet
}

interface ParticipantDefinition {
  directory: string
  name: string
}

export interface ParticipantDirectoryOptions {
  databasePath: string
  builtinsDirectory: string
  telemetryDirectory: string
  loadDefaults: (userId: string) => Promise<ParticipantDefaults>
}

export class ParticipantDirectory {
  readonly #builtinDirectories: string[]
  readonly #databasePath: string
  readonly #defaults = new Map<string, Promise<ParticipantDefaults>>()
  readonly #builtinsDirectory: string
  readonly #telemetryDirectory: string
  readonly #loadDefaults: ParticipantDirectoryOptions["loadDefaults"]

  constructor(options: ParticipantDirectoryOptions) {
    this.#databasePath = resolve(options.databasePath)
    this.#builtinsDirectory = resolve(options.builtinsDirectory)
    this.#telemetryDirectory = resolve(options.telemetryDirectory)
    this.#loadDefaults = options.loadDefaults
    this.#builtinDirectories = this.#loadBuiltinDirectories()
  }

  filesystem(userId: string): IFileSystem {
    return new MountableFs({
      base: new SqliteFs({
        dbPath: this.#databasePath,
        root: `/users/${userNamespace(userId)}/participants`,
      }),
      mounts: this.#builtinDirectories.map((directory) => ({
        mountPoint: `/${directory}`,
        filesystem: new OverlayFs({
          root: resolve(this.#builtinsDirectory, directory),
          mountPoint: "/",
          readOnly: true,
        }),
      })),
    })
  }

  async participants(userId: string): Promise<readonly WhatsAppParticipant[]> {
    const filesystem = this.filesystem(userId)
    const defaults = await this.#defaultsFor(userId)
    const directories = await this.#participantDirectories(filesystem)
    const builtinSet = new Set(this.#builtinDirectories)
    const orderedDirectories = [
      ...directories.filter((directory) => !builtinSet.has(directory)),
      ...this.#builtinDirectories.filter((directory) =>
        directories.includes(directory)
      ),
    ]
    const definitions = await Promise.all(
      orderedDirectories.map((directory) =>
        this.#readIdentity(filesystem, directory)
      )
    )
    return definitions.map((definition) =>
      this.#participant(userId, definition, defaults)
    )
  }

  #loadBuiltinDirectories() {
    const entries = readdirSync(this.#builtinsDirectory, {
      withFileTypes: true,
    })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map(({ name }) => name)
      .sort((left, right) => left.localeCompare(right, "en"))
  }

  async #participantDirectories(filesystem: IFileSystem) {
    const entries = await filesystem.readdir("/")
    const directories = await Promise.all(
      entries
        .filter((entry) => !entry.startsWith("."))
        .map(async (entry) => ({
          entry,
          metadata: await filesystem.stat(`/${entry}`),
        }))
    )
    return directories
      .filter(({ metadata }) => metadata.isDirectory)
      .map(({ entry }) => entry)
      .sort((left, right) => left.localeCompare(right, "en"))
  }

  async #readIdentity(
    filesystem: IFileSystem,
    directory: string
  ): Promise<ParticipantDefinition> {
    const identityPath = `/${directory}/${IDENTITY_FILE}`
    if (!(await filesystem.exists(identityPath))) {
      throw new Error(`Participant "${directory}" requires ${IDENTITY_FILE}`)
    }

    let identity: unknown
    try {
      identity = JSON.parse(await filesystem.readFile(identityPath))
    } catch (error) {
      throw new Error(
        `Participant "${directory}" has an invalid ${IDENTITY_FILE}`,
        { cause: error }
      )
    }
    if (!isIdentity(identity)) {
      throw new Error(
        `Participant "${directory}" ${IDENTITY_FILE} requires a non-empty name string`
      )
    }

    return { directory, name: identity.name }
  }

  #participant(
    userId: string,
    definition: ParticipantDefinition,
    defaults: ParticipantDefaults
  ): WhatsAppParticipant {
    const tracePath = resolve(
      this.#telemetryDirectory,
      userNamespace(userId),
      `${definition.directory}.jsonl`
    )
    return {
      name: definition.name,
      instructions: [
        fragment(
          "participant-bootstrap",
          `At the start of every turn, use bash to inspect ${JSON.stringify(
            `/workspace/participants/${definition.directory}`
          )}. Read SOUL.md for persona and voice, AGENTS.md for operating instructions, and MEMORY.md for durable knowledge. Follow them for that turn. Participant files are writable; use bash to edit them directly when your role calls for it.`
        ),
      ],
      model: defaults.model,
      tools: defaults.tools,
      tracePath,
      telemetry: {
        integrations: createFileTelemetry({ path: tracePath }),
      },
    }
  }

  #defaultsFor(userId: string) {
    let defaults = this.#defaults.get(userId)
    if (!defaults) {
      defaults = this.#loadDefaults(userId).catch((error: unknown) => {
        this.#defaults.delete(userId)
        throw error
      })
      this.#defaults.set(userId, defaults)
    }
    return defaults
  }
}

function userNamespace(userId: string) {
  return createHash("sha256").update(userId).digest("hex")
}

function isIdentity(value: unknown): value is { name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name === value.name.trim()
  )
}
