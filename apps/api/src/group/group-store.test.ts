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

  const sentAt = new Date(Date.parse(newest.createdAt) + 1).toISOString()
  assert.equal(
    groups.recordMessage("user-1", group.id, {
      author: "Annie Duke",
      content: "Challenge the assumption.",
      sentAt,
    }),
    true
  )
  assert.deepEqual(groups.get("user-1", group.id), {
    ...group,
    lastMessage: {
      author: "Annie Duke",
      content: "Challenge the assumption.",
      sentAt,
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

test("groups can be pinned, archived, and cleared per user", () => {
  using groups = new GroupStore(":memory:", ["annie-duke"])

  const first = groups.create("user-1", {
    name: "Pricing",
    agentIds: ["annie-duke"],
  })
  const second = groups.create("user-1", {
    name: "Hiring",
    agentIds: ["annie-duke"],
  })

  assert.equal(first.pinned, false)
  assert.equal(groups.setPinned("user-1", first.id, true), true)
  assert.equal(groups.get("user-1", first.id)?.pinned, true)
  assert.equal(groups.setPinned("user-2", first.id, true), false)
  assert.equal(groups.setPinned("user-1", first.id, false), true)
  assert.equal(groups.get("user-1", first.id)?.pinned, false)

  assert.equal(groups.setArchived("user-1", second.id, true), true)
  assert.deepEqual(
    groups.list("user-1").map(({ id }) => id),
    [first.id]
  )
  assert.deepEqual(
    groups.list("user-1", { includeArchived: true }).map(({ id }) => id),
    [second.id, first.id]
  )
  assert.notEqual(groups.get("user-1", second.id), null)

  assert.equal(groups.setArchived("user-1", second.id, false), true)
  assert.equal(groups.list("user-1").length, 2)

  const sentAt = new Date(Date.parse(first.createdAt) + 1).toISOString()
  groups.recordMessage("user-1", first.id, {
    author: "Annie Duke",
    content: "Separate the decision from the outcome.",
    sentAt,
  })
  assert.equal(groups.get("user-1", first.id)?.unreadCount, 1)

  assert.equal(groups.clearMessages("user-2", first.id), false)
  assert.equal(groups.clearMessages("user-1", first.id), true)
  assert.deepEqual(groups.get("user-1", first.id), {
    ...first,
    lastMessage: null,
    unreadCount: 0,
  })
})
