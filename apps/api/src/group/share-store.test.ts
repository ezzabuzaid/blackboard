import assert from "node:assert/strict"
import test from "node:test"

import { GroupShareStore } from "./share-store.js"

test("group shares resolve until they are revoked", () => {
  using shares = new GroupShareStore(":memory:")

  assert.equal(shares.active("user-1", "group-1"), null)
  assert.equal(shares.resolve("missing-token"), null)

  const share = shares.create("user-1", "group-1")
  assert.deepEqual(shares.resolve(share.token), {
    userId: "user-1",
    groupId: "group-1",
  })
  assert.deepEqual(shares.active("user-1", "group-1"), share)
  assert.equal(shares.active("user-2", "group-1"), null)

  assert.equal(shares.revoke("user-1", "group-1"), true)
  assert.equal(shares.resolve(share.token), null)
  assert.equal(shares.active("user-1", "group-1"), null)
  assert.equal(shares.revoke("user-1", "group-1"), false)

  const reshared = shares.create("user-1", "group-1")
  assert.notEqual(reshared.token, share.token)
  assert.equal(shares.resolve(share.token), null)
  assert.deepEqual(shares.resolve(reshared.token), {
    userId: "user-1",
    groupId: "group-1",
  })

  const replacement = shares.create("user-1", "group-1")
  assert.equal(shares.resolve(reshared.token), null)
  assert.deepEqual(shares.active("user-1", "group-1"), replacement)

  const otherGroup = shares.create("user-1", "group-2")
  assert.equal(shares.revoke("user-1", "group-1"), true)
  assert.deepEqual(shares.resolve(otherGroup.token), {
    userId: "user-1",
    groupId: "group-2",
  })
})
