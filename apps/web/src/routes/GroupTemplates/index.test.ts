import assert from "node:assert/strict"
import test from "node:test"

import { toggleAgentSelection } from "./selection"

test("character selection toggles without exceeding the group limit", () => {
  assert.deepEqual(toggleAgentSelection(["annie-duke"], "paul-graham"), [
    "annie-duke",
    "paul-graham",
  ])
  assert.deepEqual(toggleAgentSelection(["annie-duke"], "annie-duke"), [])
  assert.deepEqual(toggleAgentSelection(["one", "two"], "three", 2), [
    "one",
    "two",
  ])
})
