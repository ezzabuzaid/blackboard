import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import { groupTemplates } from "../group-template-catalog.js"
import { loadAgentCatalog } from "./agent-catalog.js"

test("native agent catalog contains 51 complete character definitions", () => {
  const agents = loadAgentCatalog(
    resolve(import.meta.dirname, "../../../../../catalog/agents")
  )

  assert.equal(agents.length, 51)
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
