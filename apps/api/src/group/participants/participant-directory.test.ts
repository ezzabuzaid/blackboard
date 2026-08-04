import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import { fragment } from "@deepagents/context"
import { MockLanguageModelV4 } from "ai/test"

import { ParticipantDirectory } from "./participant-directory.js"

const model = new MockLanguageModelV4({
  doStream: async () => {
    throw new Error("unused")
  },
})

async function writeBuiltinFactory(directory: string) {
  const factory = resolve(directory, "factory")
  await mkdir(factory, { recursive: true })
  await Promise.all([
    writeFile(resolve(factory, "identity.json"), '{"name":"Factory"}\n'),
    writeFile(resolve(factory, "SOUL.md"), "Build useful participants.\n"),
    writeFile(
      resolve(factory, "AGENTS.md"),
      "Create participants with bash.\n"
    ),
    writeFile(resolve(factory, "MEMORY.md"), "# Memory\n"),
  ])
}

function createDirectory(
  root: string,
  builtinsDirectory: string,
  loadDefaults: (userId: string) => Promise<{ model: typeof model; tools: {} }>
) {
  return new ParticipantDirectory({
    databasePath: resolve(root, "participants.sqlite"),
    builtinsDirectory,
    telemetryDirectory: resolve(root, "group-telemetry"),
    loadDefaults,
  })
}

async function writeParticipant(
  directory: ParticipantDirectory,
  userId: string,
  folder: string,
  name: string
) {
  const filesystem = directory.filesystem(userId)
  await filesystem.mkdir(`/${folder}`, { recursive: true })
  await Promise.all([
    filesystem.writeFile(`/${folder}/identity.json`, JSON.stringify({ name })),
    filesystem.writeFile(`/${folder}/SOUL.md`, "Be candid and concise.\n"),
    filesystem.writeFile(`/${folder}/AGENTS.md`, "Own customer evidence.\n"),
    filesystem.writeFile(`/${folder}/MEMORY.md`, "# Memory\n"),
  ])
}

test("repository and SQLite files form one participant roster", async () => {
  const root = await mkdtemp(join(tmpdir(), "baseera-participants-"))
  const builtins = resolve(root, "builtins")
  let defaultsLoaded = 0

  try {
    await writeBuiltinFactory(builtins)
    const directory = createDirectory(root, builtins, async () => {
      defaultsLoaded++
      return { model, tools: {} }
    })
    await writeParticipant(directory, "user-1", "maya", "Maya")

    const participants = await directory.participants("user-1")

    assert.deepEqual(
      participants.map(({ name }) => name),
      ["Maya", "Factory"]
    )
    assert.deepEqual(participants[0]?.instructions, [
      fragment(
        "participant-bootstrap",
        'At the start of every turn, use bash to inspect "/workspace/participants/maya". Read SOUL.md for persona and voice, AGENTS.md for operating instructions, and MEMORY.md for durable knowledge. Follow them for that turn. Participant files are writable; use bash to edit them directly when your role calls for it.'
      ),
    ])
    assert.doesNotMatch(
      JSON.stringify(participants[0]?.instructions),
      /Be candid|customer evidence/
    )
    assert.equal(participants[0]?.tools?.save_agent, undefined)
    assert.equal(participants[0]?.tools?.update_memory, undefined)
    assert.equal(participants[1]?.tools?.save_agent, undefined)

    await directory.participants("user-1")
    assert.equal(defaultsLoaded, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("SQLite participant roots isolate users and their model defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "baseera-participants-"))
  const builtins = resolve(root, "builtins")
  const defaultsLoaded: string[] = []

  try {
    await writeBuiltinFactory(builtins)
    const directory = createDirectory(root, builtins, async (userId) => {
      defaultsLoaded.push(userId)
      return { model, tools: {} }
    })
    await writeParticipant(directory, "user-1", "maya", "Maya")

    const first = await directory.participants("user-1")
    const second = await directory.participants("user-2")

    assert.deepEqual(
      first.map(({ name }) => name),
      ["Maya", "Factory"]
    )
    assert.deepEqual(
      second.map(({ name }) => name),
      ["Factory"]
    )
    assert.notEqual(first.at(-1)?.tracePath, second.at(-1)?.tracePath)
    assert.deepEqual(defaultsLoaded, ["user-1", "user-2"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a participant folder requires a valid identity file", async () => {
  const root = await mkdtemp(join(tmpdir(), "baseera-participants-"))
  const builtins = resolve(root, "builtins")

  try {
    await writeBuiltinFactory(builtins)
    const directory = createDirectory(root, builtins, async () => ({
      model,
      tools: {},
    }))
    const filesystem = directory.filesystem("user-1")
    await filesystem.mkdir("/maya")

    await assert.rejects(
      directory.participants("user-1"),
      /maya.*requires identity\.json/
    )
    await filesystem.writeFile("/maya/identity.json", "not json")
    await assert.rejects(
      directory.participants("user-1"),
      /maya.*invalid identity\.json/
    )
    await filesystem.writeFile("/maya/identity.json", "{}")
    await assert.rejects(
      directory.participants("user-1"),
      /identity\.json.*non-empty name/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("catalog selection mounts only the requested read-only participants", async () => {
  const root = await mkdtemp(join(tmpdir(), "baseera-participants-"))
  const builtins = resolve(root, "builtins")
  const catalog = resolve(root, "catalog")

  try {
    await writeBuiltinFactory(builtins)
    await writeCatalogAgent(catalog, "annie-duke", "Annie Duke")
    await writeCatalogAgent(catalog, "paul-graham", "Paul Graham")
    const directory = new ParticipantDirectory({
      databasePath: resolve(root, "participants.sqlite"),
      builtinsDirectory: builtins,
      catalogDirectory: catalog,
      telemetryDirectory: resolve(root, "group-telemetry"),
      loadDefaults: async () => ({ model, tools: {} }),
    })

    const filesystem = directory.filesystem("user-1", ["paul-graham"])
    const participants = await directory.participants("user-1", ["paul-graham"])

    assert.deepEqual(await filesystem.readdir("/"), ["paul-graham"])
    assert.deepEqual(
      participants.map(({ name }) => name),
      ["Paul Graham"]
    )
    assert.match(
      JSON.stringify(participants[0]?.instructions),
      /catalog definition is read-only/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeCatalogAgent(
  root: string,
  directory: string,
  name: string
) {
  const agent = resolve(root, directory)
  await mkdir(agent, { recursive: true })
  await Promise.all([
    writeFile(resolve(agent, "identity.json"), JSON.stringify({ name })),
    writeFile(resolve(agent, "SOUL.md"), "Give useful advice.\n"),
    writeFile(resolve(agent, "AGENTS.md"), "Stay in your domain.\n"),
    writeFile(resolve(agent, "MEMORY.md"), "# Memory\n"),
  ])
}
