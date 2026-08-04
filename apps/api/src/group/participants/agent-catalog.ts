import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const REQUIRED_AGENT_FILES = [
  "identity.json",
  "SOUL.md",
  "AGENTS.md",
  "MEMORY.md",
] as const

export interface AgentTemplate {
  id: string
  name: string
  category: string
  headline: string
  tags: readonly string[]
}

export function loadAgentCatalog(directory: string): readonly AgentTemplate[] {
  const root = resolve(directory)
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map(({ name: id }) => readAgent(root, id))
    .toSorted(
      (left, right) =>
        left.category.localeCompare(right.category, "en") ||
        left.name.localeCompare(right.name, "en")
    )
}

function readAgent(root: string, id: string): AgentTemplate {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`Agent catalog directory "${id}" requires a slug name`)
  }

  const directory = resolve(root, id)
  for (const file of REQUIRED_AGENT_FILES) {
    if (!existsSync(resolve(directory, file))) {
      throw new Error(`Agent catalog entry "${id}" requires ${file}`)
    }
  }

  let identity: unknown
  try {
    identity = JSON.parse(
      readFileSync(resolve(directory, "identity.json"), "utf8")
    )
  } catch (error) {
    throw new Error(`Agent catalog entry "${id}" has invalid identity.json`, {
      cause: error,
    })
  }
  if (!isAgentIdentity(identity)) {
    throw new Error(`Agent catalog entry "${id}" has an invalid identity`)
  }

  return { id, ...identity }
}

function isAgentIdentity(value: unknown): value is Omit<AgentTemplate, "id"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim() === value.name &&
    value.name.length > 0 &&
    "category" in value &&
    typeof value.category === "string" &&
    value.category.trim() === value.category &&
    value.category.length > 0 &&
    "headline" in value &&
    typeof value.headline === "string" &&
    value.headline.trim() === value.headline &&
    value.headline.length > 0 &&
    "tags" in value &&
    Array.isArray(value.tags) &&
    value.tags.length > 0 &&
    value.tags.every(
      (tag) => typeof tag === "string" && tag.trim() === tag && tag.length > 0
    )
  )
}
