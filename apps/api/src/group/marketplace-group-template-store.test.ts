import assert from "node:assert/strict"
import test from "node:test"

import { MarketplaceGroupTemplateStore } from "./marketplace-group-template-store.js"

const definition = {
  name: "Founder Board",
  category: "Strategy",
  outcome: "Challenge the next company decision.",
  agents: [
    {
      agentId: "paul-graham",
      responsibility: "Keeps the company focused on users.",
    },
  ],
}

test("source group deletion detaches published templates and deletes drafts", () => {
  using templates = new MarketplaceGroupTemplateStore(":memory:", [
    "paul-graham",
  ])
  const published = templates.create(
    "publisher-1",
    "Publisher One",
    definition,
    "group-1"
  )
  templates.publish("publisher-1", published.id)
  const draft = templates.create(
    "publisher-1",
    "Publisher One",
    definition,
    "group-2"
  )

  assert.equal(templates.removeSourceGroup("publisher-1", "group-1"), true)
  assert.equal(templates.findBySourceGroup("publisher-1", "group-1"), null)
  assert.equal(
    templates.findPublished(published.id)?.sourceGroupId,
    null
  )

  assert.equal(templates.removeSourceGroup("publisher-1", "group-2"), true)
  assert.equal(templates.publish("publisher-1", draft.id), null)
  assert.equal(templates.removeSourceGroup("publisher-1", "group-2"), false)
})

test("only the publisher can permanently withdraw a detached template", () => {
  using templates = new MarketplaceGroupTemplateStore(":memory:", [
    "paul-graham",
  ])
  const template = templates.create(
    "publisher-1",
    "Publisher One",
    definition
  )
  templates.publish("publisher-1", template.id)

  assert.equal(templates.delete("publisher-2", template.id), false)
  assert.notEqual(templates.findPublished(template.id), null)
  assert.equal(templates.delete("publisher-1", template.id), true)
  assert.equal(templates.findPublished(template.id), null)
})
