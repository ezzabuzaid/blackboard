import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import { fragment } from "@deepagents/context"
import { MockLanguageModelV4 } from "ai/test"

import { AgentDirectory } from "./agent-directory.js"
import type { WhatsAppParticipant } from "../whatsapp.js"

const model = new MockLanguageModelV4({
  doStream: async () => {
    throw new Error("unused")
  },
})

async function executeTool(
  participant: WhatsAppParticipant,
  name: string,
  input: unknown
) {
  const tool = participant.tools?.[name] as
    | {
        execute?: (
          input: unknown,
          options: {
            toolCallId: string
            messages: never[]
            abortSignal: AbortSignal
          }
        ) => unknown
      }
    | undefined
  if (!tool?.execute) assert.fail(`Tool ${name} is not executable`)
  return tool.execute(input, {
    toolCallId: `test-${name}`,
    messages: [],
    abortSignal: new AbortController().signal,
  })
}

test("a missing agents directory produces only the built-in Factory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseera-agents-"))
  let defaultsLoaded = false

  try {
    const agents = new AgentDirectory(directory, async () => {
      defaultsLoaded = true
      return { model, tools: {} }
    })

    const participants = await agents.participants("user-1")
    assert.deepEqual(
      participants.map(({ name }) => name),
      ["Factory"]
    )
    assert.equal(defaultsLoaded, true)
    assert.match(
      JSON.stringify(participants[0]?.instructions),
      /explicit human request.*create or update an agent/i
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("identity files become a deterministic roster without injecting agent workspace files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseera-agents-"))
  const tools = {}
  let defaultsLoaded = 0

  try {
    await Promise.all([
      mkdir(resolve(directory, "agents", "Omar"), { recursive: true }),
      mkdir(resolve(directory, "agents", "Maya"), { recursive: true }),
    ])
    await Promise.all([
      writeFile(
        resolve(directory, "agents", "Omar", "identity.json"),
        JSON.stringify({ name: "Omar" })
      ),
      writeFile(
        resolve(directory, "agents", "Maya", "identity.json"),
        JSON.stringify({ name: "Maya" })
      ),
      writeFile(
        resolve(directory, "agents", "Maya", "SOUL.md"),
        "Be candid and concise.\n"
      ),
      writeFile(
        resolve(directory, "agents", "Maya", "AGENTS.md"),
        "Own the business profile.\n"
      ),
      writeFile(
        resolve(directory, "agents", "Maya", "MEMORY.md"),
        "The product serves founders.\n"
      ),
    ])

    const agents = new AgentDirectory(directory, async () => {
      defaultsLoaded++
      return { model, tools }
    })
    const participants = await agents.participants("user-1")

    assert.deepEqual(
      participants.map(({ name }) => name),
      ["Maya", "Omar", "Factory"]
    )
    assert.deepEqual(participants[0]?.instructions, [
      fragment(
        "agent-bootstrap",
        'At the start of every turn, use bash to inspect "/workspace/agents/Maya". Read SOUL.md for persona and voice, AGENTS.md for operating instructions, and MEMORY.md for durable knowledge. Follow them for that turn. When durable knowledge changes, use update_memory with the complete new MEMORY.md content; the mounted agent files are read-only.'
      ),
    ])
    assert.doesNotMatch(
      JSON.stringify(participants[0]?.instructions),
      /Be candid|Own the business|serves founders/
    )
    assert.equal(participants[0]?.model, model)
    assert.equal(typeof participants[0]?.tools?.update_memory, "object")
    assert.equal(
      participants[0]?.tracePath,
      resolve(directory, "group-telemetry", "Maya.jsonl")
    )
    await agents.participants("user-1")
    assert.equal(defaultsLoaded, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Factory safely creates and updates file-based agents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseera-agents-"))

  try {
    const agents = new AgentDirectory(directory, async () => ({
      model,
      tools: {},
    }))
    const [factory] = await agents.participants("user-1")
    assert.equal(factory?.name, "Factory")

    await executeTool(factory!, "save_agent", {
      directory: "researcher",
      name: "Maya",
      soul: "Be candid and concise.",
      instructions: "Own customer-research evidence.",
    })

    const agentPath = resolve(directory, "agents", "researcher")
    assert.deepEqual(
      JSON.parse(await readFile(resolve(agentPath, "identity.json"), "utf8")),
      { name: "Maya" }
    )
    assert.equal(
      await readFile(resolve(agentPath, "SOUL.md"), "utf8"),
      "Be candid and concise.\n"
    )
    assert.equal(
      await readFile(resolve(agentPath, "AGENTS.md"), "utf8"),
      "Own customer-research evidence.\n"
    )
    assert.equal(
      await readFile(resolve(agentPath, "MEMORY.md"), "utf8"),
      "# Memory\n"
    )

    const [maya, nextFactory] = await agents.participants("user-1")
    assert.equal(maya?.name, "Maya")
    assert.equal(nextFactory?.name, "Factory")
    await executeTool(maya!, "update_memory", {
      content: "The user values direct evidence.",
    })

    await executeTool(nextFactory!, "save_agent", {
      directory: "researcher",
      name: "Maya",
      soul: "Stay skeptical.",
      instructions: "Own customer evidence and challenge weak claims.",
    })
    assert.equal(
      await readFile(resolve(agentPath, "MEMORY.md"), "utf8"),
      "The user values direct evidence.\n"
    )
    assert.equal(
      await readFile(resolve(agentPath, "SOUL.md"), "utf8"),
      "Stay skeptical.\n"
    )

    await assert.rejects(
      executeTool(nextFactory!, "save_agent", {
        directory: "../outside",
        name: "Unsafe",
        soul: "Unsafe.",
        instructions: "Unsafe.",
      }),
      /valid agent directory/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("an agent folder requires a valid identity but the host does not read its workspace files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baseera-agents-"))
  const agentDirectory = resolve(directory, "agents", "Maya")

  try {
    await mkdir(agentDirectory, { recursive: true })
    const agents = new AgentDirectory(directory, async () => ({
      model,
      tools: {},
    }))

    await assert.rejects(
      agents.participants("user-1"),
      /Maya.*requires identity\.json/
    )
    await writeFile(resolve(agentDirectory, "identity.json"), "not json")
    await assert.rejects(
      agents.participants("user-1"),
      /Maya.*invalid identity\.json/
    )
    await writeFile(resolve(agentDirectory, "identity.json"), "{}")
    await assert.rejects(
      agents.participants("user-1"),
      /identity\.json.*non-empty name/
    )
    await writeFile(
      resolve(agentDirectory, "identity.json"),
      JSON.stringify({ name: "Maya" })
    )
    assert.equal((await agents.participants("user-1"))[0]?.name, "Maya")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
