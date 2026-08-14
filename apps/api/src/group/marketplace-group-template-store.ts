import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import type { GroupTemplate } from "./group-template-catalog.js"

export type MarketplaceGroupTemplateInput = Omit<GroupTemplate, "id">

export interface MarketplaceGroupTemplate {
  id: string
  sourceGroupId: string | null
  publisherName: string | null
  name: string
  category: string
  outcome: string
  agents: readonly { agentId: string; responsibility: string }[]
  published: boolean
}

type MarketplaceGroupTemplateRow = {
  id: string
  source_group_id: string | null
  publisher_name: string | null
  name: string
  category: string
  outcome: string
  agents: string
  published: number
}

export class MarketplaceGroupTemplateInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MarketplaceGroupTemplateInputError"
  }
}

export class MarketplaceGroupTemplateStore implements Disposable {
  readonly #database: DatabaseSync
  readonly #agentIds: ReadonlySet<string>

  constructor(databasePath: string, agentIds: Iterable<string>) {
    this.#database = new DatabaseSync(databasePath)
    this.#agentIds = new Set(agentIds)
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_group_templates (
        id TEXT PRIMARY KEY,
        publisher_id TEXT NOT NULL,
        publisher_name TEXT NOT NULL,
        source_group_id TEXT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        outcome TEXT NOT NULL,
        agents TEXT NOT NULL,
        published INTEGER NOT NULL CHECK (published IN (0, 1))
      ) STRICT
    `)
    const columns = new Set(
      (
        this.#database
          .prepare("PRAGMA table_info(marketplace_group_templates)")
          .all() as { name: string }[]
      ).map(({ name }) => name)
    )
    if (!columns.has("publisher_name")) {
      this.#database.exec(
        "ALTER TABLE marketplace_group_templates ADD COLUMN publisher_name TEXT"
      )
    }
    if (!columns.has("source_group_id")) {
      this.#database.exec(
        "ALTER TABLE marketplace_group_templates ADD COLUMN source_group_id TEXT"
      )
    }
    this.#database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS marketplace_group_templates_source_group
      ON marketplace_group_templates (publisher_id, source_group_id)
      WHERE source_group_id IS NOT NULL
    `)
  }

  create(
    publisherId: string,
    publisherName: string,
    input: MarketplaceGroupTemplateInput,
    sourceGroupId: string | null = null
  ): MarketplaceGroupTemplate {
    const definition = this.#normalize(input)
    const template = {
      id: randomUUID(),
      sourceGroupId,
      publisherName,
      ...definition,
      published: false,
    }
    this.#database
      .prepare(
        `INSERT INTO marketplace_group_templates
           (id, publisher_id, publisher_name, source_group_id, name, category, outcome, agents, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        template.id,
        publisherId,
        template.publisherName,
        template.sourceGroupId,
        template.name,
        template.category,
        template.outcome,
        JSON.stringify(template.agents)
      )
    return template
  }

  update(
    publisherId: string,
    id: string,
    input: MarketplaceGroupTemplateInput
  ): MarketplaceGroupTemplate | null {
    const template = this.#normalize(input)
    const result = this.#database
      .prepare(
        `UPDATE marketplace_group_templates
         SET name = ?, category = ?, outcome = ?, agents = ?
         WHERE publisher_id = ? AND id = ?`
      )
      .run(
        template.name,
        template.category,
        template.outcome,
        JSON.stringify(template.agents),
        publisherId,
        id
      )
    return result.changes ? this.#get(publisherId, id) : null
  }

  published(): readonly MarketplaceGroupTemplate[] {
    const rows = this.#database
      .prepare(
        `SELECT id, source_group_id, publisher_name, name, category, outcome, agents, published
         FROM marketplace_group_templates
         WHERE published = 1
         ORDER BY rowid`
      )
      .all() as MarketplaceGroupTemplateRow[]
    return rows.map(toMarketplaceGroupTemplate)
  }

  owns(publisherId: string, id: string) {
    return Boolean(
      this.#database
        .prepare(
          `SELECT 1
           FROM marketplace_group_templates
           WHERE publisher_id = ? AND id = ?`
        )
        .get(publisherId, id)
    )
  }

  findPublished(id: string): MarketplaceGroupTemplate | null {
    const row = this.#database
      .prepare(
        `SELECT id, source_group_id, publisher_name, name, category, outcome, agents, published
         FROM marketplace_group_templates
         WHERE id = ? AND published = 1`
      )
      .get(id) as MarketplaceGroupTemplateRow | undefined
    return row ? toMarketplaceGroupTemplate(row) : null
  }

  findBySourceGroup(
    publisherId: string,
    sourceGroupId: string
  ): MarketplaceGroupTemplate | null {
    const row = this.#database
      .prepare(
        `SELECT id, source_group_id, publisher_name, name, category, outcome, agents, published
         FROM marketplace_group_templates
         WHERE publisher_id = ? AND source_group_id = ?`
      )
      .get(publisherId, sourceGroupId) as
      MarketplaceGroupTemplateRow | undefined
    return row ? toMarketplaceGroupTemplate(row) : null
  }

  publish(publisherId: string, id: string): MarketplaceGroupTemplate | null {
    return this.#setPublished(publisherId, id, true)
  }

  unpublish(publisherId: string, id: string): MarketplaceGroupTemplate | null {
    return this.#setPublished(publisherId, id, false)
  }

  removeSourceGroup(publisherId: string, sourceGroupId: string) {
    const row = this.#database
      .prepare(
        `SELECT published
         FROM marketplace_group_templates
         WHERE publisher_id = ? AND source_group_id = ?`
      )
      .get(publisherId, sourceGroupId) as { published: number } | undefined
    if (!row) return false

    const statement = row.published
      ? `UPDATE marketplace_group_templates
         SET source_group_id = NULL
         WHERE publisher_id = ? AND source_group_id = ?`
      : `DELETE FROM marketplace_group_templates
         WHERE publisher_id = ? AND source_group_id = ?`
    this.#database.prepare(statement).run(publisherId, sourceGroupId)
    return true
  }

  delete(publisherId: string, id: string) {
    return (
      this.#database
        .prepare(
          `DELETE FROM marketplace_group_templates
           WHERE publisher_id = ? AND id = ? AND source_group_id IS NULL`
        )
        .run(publisherId, id).changes > 0
    )
  }

  #setPublished(
    publisherId: string,
    id: string,
    published: boolean
  ): MarketplaceGroupTemplate | null {
    const result = this.#database
      .prepare(
        `UPDATE marketplace_group_templates
         SET published = ?
         WHERE publisher_id = ? AND id = ?`
      )
      .run(Number(published), publisherId, id)
    return result.changes ? this.#get(publisherId, id) : null
  }

  #get(publisherId: string, id: string): MarketplaceGroupTemplate | null {
    const row = this.#database
      .prepare(
        `SELECT id, source_group_id, publisher_name, name, category, outcome, agents, published
         FROM marketplace_group_templates
         WHERE publisher_id = ? AND id = ?`
      )
      .get(publisherId, id) as MarketplaceGroupTemplateRow | undefined

    return row ? toMarketplaceGroupTemplate(row) : null
  }

  #normalize(
    input: MarketplaceGroupTemplateInput
  ): MarketplaceGroupTemplateInput {
    const name = input.name.trim()
    if (!name || name.length > 100) {
      throw new MarketplaceGroupTemplateInputError(
        "Template name must contain between 1 and 100 characters"
      )
    }

    const category = input.category.trim()
    if (!category) {
      throw new MarketplaceGroupTemplateInputError(
        "Template category is required"
      )
    }
    const outcome = input.outcome.trim()
    if (!outcome) {
      throw new MarketplaceGroupTemplateInputError(
        "Template outcome is required"
      )
    }

    const agents = input.agents.map(({ agentId, responsibility }) => ({
      agentId,
      responsibility: responsibility.trim(),
    }))
    if (agents.length < 1 || agents.length > 8) {
      throw new MarketplaceGroupTemplateInputError(
        "Templates require between 1 and 8 agents"
      )
    }
    if (new Set(agents.map(({ agentId }) => agentId)).size !== agents.length) {
      throw new MarketplaceGroupTemplateInputError(
        "Template agent IDs must be unique"
      )
    }
    const unknown = agents.find(({ agentId }) => !this.#agentIds.has(agentId))
    if (unknown) {
      throw new MarketplaceGroupTemplateInputError(
        `Unknown agent ID "${unknown.agentId}"`
      )
    }
    if (agents.some(({ responsibility }) => !responsibility)) {
      throw new MarketplaceGroupTemplateInputError(
        "Template agent responsibilities are required"
      )
    }

    return { name, category, outcome, agents }
  }

  [Symbol.dispose]() {
    this.#database.close()
  }
}

function toMarketplaceGroupTemplate(
  row: MarketplaceGroupTemplateRow
): MarketplaceGroupTemplate {
  return {
    id: row.id,
    sourceGroupId: row.source_group_id,
    publisherName: row.publisher_name,
    name: row.name,
    category: row.category,
    outcome: row.outcome,
    agents: JSON.parse(row.agents),
    published: Boolean(row.published),
  }
}
