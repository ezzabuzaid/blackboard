import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"

import { loadAgentCatalog } from "./agent-catalog.js"

test("native agent catalog contains 47 complete character definitions", () => {
  const agents = loadAgentCatalog(
    resolve(import.meta.dirname, "../../../../../catalog/agents")
  )

  assert.equal(agents.length, 47)
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
