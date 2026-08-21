import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import { groupTemplates } from "../group-template-catalog.js"
import { loadAgentCatalog } from "./agent-catalog.js"

function writeAgent(root: string, id: string, name: string) {
  const directory = resolve(root, id)
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    resolve(directory, "identity.json"),
    JSON.stringify({
      name,
      category: "Fund",
      headline: "A headline",
      tags: ["strategy"],
    })
  )
  for (const file of ["SOUL.md", "AGENTS.md", "MEMORY.md"]) {
    writeFileSync(resolve(directory, file), "seed")
  }
}

test("native agent catalog contains 57 complete character definitions", () => {
  const agents = loadAgentCatalog(
    resolve(import.meta.dirname, "../../../../../catalog/agents")
  )

  assert.equal(agents.length, 57)
  assert.equal(new Set(agents.map(({ id }) => id)).size, agents.length)
  assert.deepEqual(
    agents.find(({ id }) => id === "paul-graham"),
    {
      id: "paul-graham",
      name: "Paul Graham",
      category: "Fund",
      headline: "YC's essayist-in-chief",
      tags: ["strategy", "fundraising", "growth", "product"],
    }
  )
})

test("catalog entries cannot share a display name", () => {
  const root = mkdtempSync(resolve(tmpdir(), "agent-catalog-"))
  try {
    writeAgent(root, "paul-graham", "Paul Graham")
    writeAgent(root, "paul-graham-essays", "paul graham")

    assert.throws(
      () => loadAgentCatalog(root),
      (error: unknown) =>
        error instanceof Error &&
        /share the display name/.test(error.message) &&
        error.message.includes('"paul-graham"') &&
        error.message.includes('"paul-graham-essays"')
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("catalog entries cannot claim the reserved user name", () => {
  const root = mkdtempSync(resolve(tmpdir(), "agent-catalog-"))
  try {
    writeAgent(root, "impostor", "User")

    assert.throws(
      () => loadAgentCatalog(root),
      /cannot use the reserved display name "user"/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Personal Wealth uses complete native agents and valid workspace seeds", () => {
  const catalogRoot = resolve(
    import.meta.dirname,
    "../../../../../catalog/agents"
  )
  const agents = loadAgentCatalog(catalogRoot)
  const template = groupTemplates.find(({ id }) => id === "personal-wealth")

  assert.ok(template)
  assert.deepEqual(
    template.agents.map(({ agentId }) => agentId),
    [
      "net-worth-keeper",
      "investment-analyst",
      "real-assets-analyst",
      "wealth-risk-planner",
    ]
  )
  assert.ok(
    template.agents.every(({ agentId }) =>
      agents.some(({ id }) => id === agentId)
    )
  )

  const workspaceTemplate = resolve(
    catalogRoot,
    "net-worth-keeper/workspace-template"
  )
  for (const file of ["profile.json", "ledger.json", "cash-flow.json"]) {
    assert.doesNotThrow(() =>
      JSON.parse(readFileSync(resolve(workspaceTemplate, file), "utf8"))
    )
  }
})

test("The 1M Committee opens with the keeper and uses complete native agents", () => {
  const catalogRoot = resolve(
    import.meta.dirname,
    "../../../../../catalog/agents"
  )
  const agents = loadAgentCatalog(catalogRoot)
  const template = groupTemplates.find(({ id }) => id === "million-committee")

  assert.ok(template)
  // The first roster entry becomes the group's default sole responder, so the
  // keeper has to stay at index 0 or an adversary answers single-answer asks.
  assert.deepEqual(
    template.agents.map(({ agentId }) => agentId),
    [
      "cash-goal-keeper",
      "eliyahu-goldratt",
      "naval-ravikant",
      "chris-voss",
      "charlie-munger",
      "thomas-sowell",
      "nassim-taleb",
    ]
  )
  assert.ok(
    template.agents.every(({ agentId }) =>
      agents.some(({ id }) => id === agentId)
    )
  )

  const workspaceTemplate = resolve(
    catalogRoot,
    "cash-goal-keeper/workspace-template"
  )
  for (const file of [
    "goal.json",
    "position.json",
    "plan.json",
    "commitments.json",
  ]) {
    assert.doesNotThrow(() =>
      JSON.parse(readFileSync(resolve(workspaceTemplate, file), "utf8"))
    )
  }
})

test("Game Squad opens with its director and uses five complete specialists", () => {
  const agents = loadAgentCatalog(
    resolve(import.meta.dirname, "../../../../../catalog/agents")
  )
  const template = groupTemplates.find(({ id }) => id === "game-squad")

  assert.ok(template)
  assert.deepEqual(
    template.agents.map(({ agentId }) => agentId),
    [
      "game-director",
      "story-architect",
      "player-arc-designer",
      "game-feel-director",
      "gameplay-engineer",
    ]
  )
  assert.ok(
    template.agents.every(({ agentId }) =>
      agents.some(({ id }) => id === agentId)
    )
  )
})
