import assert from "node:assert/strict"
import test from "node:test"

import { GroupStore } from "./group-store.js"

test("groups persist an explicit validated agent roster", () => {
  using groups = new GroupStore(":memory:", ["annie-duke", "paul-graham"])

  const group = groups.create("user-1", {
    name: "  Founder panel  ",
    agentIds: ["annie-duke", "paul-graham"],
  })

  assert.equal(group.name, "Founder panel")
  assert.deepEqual(groups.get("user-1", group.id), group)
  assert.equal(groups.get("user-2", group.id), null)

  const newest = groups.create("user-1", {
    name: "Growth panel",
    agentIds: ["paul-graham"],
  })
  const otherUser = groups.create("user-2", {
    name: "Other panel",
    agentIds: ["annie-duke"],
  })
  assert.deepEqual(groups.list("user-1"), [newest, group])
  assert.deepEqual(groups.list("user-2"), [otherUser])

  assert.throws(
    () =>
      groups.create("user-1", {
        name: "Invalid",
        agentIds: ["missing-agent"],
      }),
    /Unknown agent ID/
  )
})
