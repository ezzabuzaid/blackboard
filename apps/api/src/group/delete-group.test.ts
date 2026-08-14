import assert from "node:assert/strict"
import test from "node:test"

import { createGroupDeletion } from "./delete-group.js"

test("group deletion is ordered, joined, and retryable", async () => {
  const calls: string[] = []
  let clearAttempts = 0
  let releaseClear!: () => void
  const clearStarted = Promise.withResolvers<void>()
  const deletion = createGroupDeletion({
    exists: (userId, groupId) =>
      userId === "user-1" && groupId === "group-1",
    clearRuntime: async () => {
      calls.push("runtime")
      clearAttempts++
      if (clearAttempts === 1) {
        clearStarted.resolve()
        await new Promise<void>((resolve) => {
          releaseClear = resolve
        })
        throw new Error("clear failed")
      }
    },
    deleteSandbox: async () => {
      calls.push("sandbox")
    },
    deleteShares: () => {
      calls.push("shares")
    },
    removeMarketplaceSource: () => {
      calls.push("marketplace")
    },
    deleteRecord: () => {
      calls.push("record")
      return true
    },
  })

  const first = deletion.delete("user-1", "group-1")
  await clearStarted.promise
  assert.equal(deletion.has("user-1", "group-1"), true)
  assert.equal(deletion.hasGroup("group-1"), true)
  const duplicate = deletion.delete("user-1", "group-1")
  assert.strictEqual(duplicate, first)
  releaseClear()
  await assert.rejects(first, /clear failed/)
  await assert.rejects(duplicate, /clear failed/)
  assert.equal(deletion.has("user-1", "group-1"), false)
  assert.equal(deletion.hasGroup("group-1"), false)
  assert.deepEqual(calls, ["runtime"])

  assert.equal(await deletion.delete("user-1", "group-1"), true)
  assert.deepEqual(calls, [
    "runtime",
    "runtime",
    "sandbox",
    "shares",
    "marketplace",
    "record",
  ])
  assert.equal(await deletion.delete("user-2", "group-1"), false)
})
