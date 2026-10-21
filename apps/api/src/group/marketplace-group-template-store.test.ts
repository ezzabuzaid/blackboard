import assert from "node:assert/strict"
import { mkdtempDisposable } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { createAuthentication } from "../auth.js"
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
  using templates = new MarketplaceGroupTemplateStore(":memory:", ":memory:", [
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
  using templates = new MarketplaceGroupTemplateStore(":memory:", ":memory:", [
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

test("templates made before attribution take their publisher's name, and templates of removed publishers are deleted", async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "marketplace-upgrade-")
  )
  const databasePath = join(directory.path, "group-templates.sqlite")
  const authDatabasePath = join(directory.path, "auth.sqlite")
  await using authentication = await createAuthentication({
    databasePath: authDatabasePath,
    baseURL: "http://localhost:3001",
    secret: "test-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://localhost:5173"],
  })
  await (await authentication.auth.$context).internalAdapter.createUser({
    id: "publisher-1",
    name: "Publisher One",
    email: "passkey-publisher-1@users.invalid",
    emailVerified: false,
  })
  {
    // The first marketplace made the table without attribution.
    using database = new DatabaseSync(databasePath)
    database.exec(`
      CREATE TABLE marketplace_group_templates (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        outcome TEXT NOT NULL,
        agents TEXT NOT NULL,
        published INTEGER NOT NULL CHECK (published IN (0, 1))
      ) STRICT
    `)
    const insert = database.prepare(
      "INSERT INTO marketplace_group_templates VALUES (?, ?, ?, ?, ?, ?, 1)"
    )
    for (const [id, publisherId] of [
      ["kept-template", "publisher-1"],
      ["orphan-template", "publisher-gone"],
    ]) {
      insert.run(
        id,
        publisherId,
        definition.name,
        definition.category,
        definition.outcome,
        JSON.stringify(definition.agents)
      )
    }
  }

  using templates = new MarketplaceGroupTemplateStore(
    databasePath,
    authDatabasePath,
    ["paul-graham"]
  )

  assert.deepEqual(templates.published(), [
    {
      id: "kept-template",
      sourceGroupId: null,
      publisherName: "Publisher One",
      ...definition,
      published: true,
    },
  ])
})

test("attributed templates keep their stored names and the table refuses a template without a publisher name", async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "marketplace-upgrade-")
  )
  const databasePath = join(directory.path, "group-templates.sqlite")
  const authDatabasePath = join(directory.path, "auth.sqlite")
  await using authentication = await createAuthentication({
    databasePath: authDatabasePath,
    baseURL: "http://localhost:3001",
    secret: "test-secret-that-is-at-least-32-characters",
    trustedOrigins: ["http://localhost:5173"],
  })
  await (await authentication.auth.$context).internalAdapter.createUser({
    id: "publisher-1",
    name: "Publisher One",
    email: "passkey-publisher-1@users.invalid",
    emailVerified: false,
  })
  {
    // The layout that earlier versions gave a first-marketplace table: they
    // added attribution with ALTER TABLE, so publisher_name accepts NULL.
    using database = new DatabaseSync(databasePath)
    database.exec(`
      CREATE TABLE marketplace_group_templates (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        outcome TEXT NOT NULL,
        agents TEXT NOT NULL,
        published INTEGER NOT NULL CHECK (published IN (0, 1))
      ) STRICT;
      ALTER TABLE marketplace_group_templates ADD COLUMN publisher_name TEXT;
      ALTER TABLE marketplace_group_templates ADD COLUMN source_group_id TEXT;
      CREATE UNIQUE INDEX marketplace_group_templates_source_group
      ON marketplace_group_templates (publisher_id, source_group_id)
      WHERE source_group_id IS NOT NULL;
    `)
    const insert = database.prepare(
      "INSERT INTO marketplace_group_templates VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL)"
    )
    for (const [id, publisherId, publisherName] of [
      ["unattributed-template", "publisher-1", null],
      ["renamed-publisher-template", "publisher-1", "Earlier Name"],
      ["removed-publisher-template", "publisher-gone", "Gone Publisher"],
    ]) {
      insert.run(
        id,
        publisherId,
        definition.name,
        definition.category,
        definition.outcome,
        JSON.stringify(definition.agents),
        publisherName
      )
    }
  }

  using templates = new MarketplaceGroupTemplateStore(
    databasePath,
    authDatabasePath,
    ["paul-graham"]
  )

  assert.deepEqual(
    templates.published().map(({ id, publisherName }) => ({
      id,
      publisherName,
    })),
    [
      { id: "unattributed-template", publisherName: "Publisher One" },
      { id: "renamed-publisher-template", publisherName: "Earlier Name" },
      { id: "removed-publisher-template", publisherName: "Gone Publisher" },
    ]
  )
  using database = new DatabaseSync(databasePath)
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO marketplace_group_templates
             (id, publisher_id, publisher_name, name, category, outcome, agents, published)
           VALUES ('null-name', 'publisher-1', NULL, 'n', 'c', 'o', '[]', 0)`
        )
        .run(),
    /NOT NULL constraint failed: marketplace_group_templates.publisher_name/
  )
})
