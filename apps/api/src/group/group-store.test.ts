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

  assert.equal(
    groups.recordMessage("user-1", group.id, {
      author: "Annie Duke",
      content: "Challenge the assumption.",
      sentAt: "2026-08-04T12:00:00.000Z",
    }),
    true
  )
  assert.deepEqual(groups.get("user-1", group.id), {
    ...group,
    lastMessage: {
      author: "Annie Duke",
      content: "Challenge the assumption.",
      sentAt: "2026-08-04T12:00:00.000Z",
    },
    unreadCount: 1,
  })
  assert.deepEqual(
    groups.list("user-1").map(({ id }) => id),
    [group.id, newest.id]
  )
  assert.equal(groups.markRead("user-1", group.id), true)
  assert.equal(groups.get("user-1", group.id)?.unreadCount, 0)
  assert.equal(groups.markRead("user-2", group.id), false)

  const scratch = groups.create("user-1", { name: "New group", agentIds: [] })
  assert.deepEqual(scratch.agentIds, [])

  assert.throws(
    () =>
      groups.create("user-1", {
        name: "Invalid",
        agentIds: ["missing-agent"],
      }),
    /Unknown agent ID/
  )
})
