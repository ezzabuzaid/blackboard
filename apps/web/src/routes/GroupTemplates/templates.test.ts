import assert from "node:assert/strict"
import test from "node:test"

import { groupTemplates } from "./templates"

test("group templates expose unique curated and scratch paths", () => {
  assert.equal(
    new Set(groupTemplates.map(({ id }) => id)).size,
    groupTemplates.length
  )
  assert.ok(
    groupTemplates.some(
      ({ name, agents }) =>
        name === "Customer Discovery" &&
        agents.some(({ id }) => id === "rob-fitzpatrick")
    )
  )
  assert.equal(groupTemplates.filter(({ scratch }) => scratch).length, 1)
  for (const template of groupTemplates.filter(({ scratch }) => !scratch)) {
    const expected = template.id === "capital-strategy" ? 5 : 4
    assert.equal(new Set(template.agents.map(({ id }) => id)).size, expected)
  }
})
