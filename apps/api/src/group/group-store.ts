import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

export interface GroupRecord {
  id: string
  name: string
  agentIds: readonly string[]
}

export class GroupInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GroupInputError"
  }
}

export class GroupStore implements Disposable {
  readonly #database: DatabaseSync
  readonly #agentIds: ReadonlySet<string>

  constructor(databasePath: string, agentIds: Iterable<string>) {
    this.#database = new DatabaseSync(databasePath)
    this.#agentIds = new Set(agentIds)
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        user_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        agent_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      ) STRICT
    `)
  }

  create(
    userId: string,
    input: { name: string; agentIds: readonly string[] }
  ): GroupRecord {
    const name = input.name.trim()
    if (!name || name.length > 100) {
      throw new GroupInputError(
        "Group name must contain between 1 and 100 characters"
      )
    }

    const agentIds = [...new Set(input.agentIds)]
    if (agentIds.length !== input.agentIds.length) {
      throw new GroupInputError("Group agent IDs must be unique")
    }
    if (agentIds.length < 1 || agentIds.length > 8) {
      throw new GroupInputError("Groups require between 1 and 8 agents")
    }
    const unknown = agentIds.find((id) => !this.#agentIds.has(id))
    if (unknown) throw new GroupInputError(`Unknown agent ID "${unknown}"`)

    const group = { id: randomUUID(), name, agentIds }
    this.#database
      .prepare(
        `INSERT INTO groups (user_id, id, name, agent_ids, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(userId, group.id, group.name, JSON.stringify(agentIds), Date.now())
    return group
  }

  get(userId: string, id: string): GroupRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id, name, agent_ids
         FROM groups
         WHERE user_id = ? AND id = ?`
      )
      .get(userId, id) as
      { id: string; name: string; agent_ids: string } | undefined

    return row
      ? { id: row.id, name: row.name, agentIds: JSON.parse(row.agent_ids) }
      : null
  }

  [Symbol.dispose]() {
    this.#database.close()
  }
}
