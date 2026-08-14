import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

export interface GroupRecord {
  id: string
  name: string
  agentIds: readonly string[]
  createdAt: string
  lastMessage: {
    author: string
    content: string
    sentAt: string
  } | null
  unreadCount: number
  pinned: boolean
}

interface GroupRow {
  id: string
  name: string
  agent_ids: string
  created_at: number
  last_message_author: string | null
  last_message_content: string | null
  last_message_at: number | null
  unread_count: number
  pinned_at: number | null
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
        last_message_author TEXT,
        last_message_content TEXT,
        last_message_at INTEGER,
        unread_count INTEGER NOT NULL DEFAULT 0,
        pinned_at INTEGER,
        archived_at INTEGER,
        PRIMARY KEY (user_id, id)
      ) STRICT
    `)
    const columns = new Set(
      (
        this.#database.prepare("PRAGMA table_info(groups)").all() as {
          name: string
        }[]
      ).map(({ name }) => name)
    )
    for (const [name, definition] of [
      ["last_message_author", "TEXT"],
      ["last_message_content", "TEXT"],
      ["last_message_at", "INTEGER"],
      ["unread_count", "INTEGER NOT NULL DEFAULT 0"],
      ["pinned_at", "INTEGER"],
      ["archived_at", "INTEGER"],
    ] as const) {
      if (!columns.has(name)) {
        this.#database.exec(
          `ALTER TABLE groups ADD COLUMN ${name} ${definition}`
        )
      }
    }
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
    if (agentIds.length > 8) {
      throw new GroupInputError("Groups support up to 8 agents")
    }
    const unknown = agentIds.find((id) => !this.#agentIds.has(id))
    if (unknown) throw new GroupInputError(`Unknown agent ID "${unknown}"`)

    const createdAt = Date.now()
    const group: GroupRecord = {
      id: randomUUID(),
      name,
      agentIds,
      createdAt: new Date(createdAt).toISOString(),
      lastMessage: null,
      unreadCount: 0,
      pinned: false,
    }
    this.#database
      .prepare(
        `INSERT INTO groups (user_id, id, name, agent_ids, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(userId, group.id, group.name, JSON.stringify(agentIds), createdAt)
    return group
  }

  get(userId: string, id: string): GroupRecord | null {
    const row = this.#database
      .prepare(
        `SELECT ${groupColumns}
         FROM groups
         WHERE user_id = ? AND id = ?`
      )
      .get(userId, id) as GroupRow | undefined

    return row ? groupRecord(row) : null
  }

  ownerOf(id: string): string | null {
    const row = this.#database
      .prepare(`SELECT user_id FROM groups WHERE id = ? LIMIT 1`)
      .get(id) as { user_id: string } | undefined

    return row?.user_id ?? null
  }

  list(
    userId: string,
    options: { includeArchived?: boolean } = {}
  ): GroupRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT ${groupColumns}
         FROM groups
         WHERE user_id = ?${options.includeArchived ? "" : " AND archived_at IS NULL"}
         ORDER BY COALESCE(last_message_at, created_at) DESC, rowid DESC`
      )
      .all(userId) as unknown as GroupRow[]

    return rows.map(groupRecord)
  }

  recordMessage(
    userId: string,
    id: string,
    message: { author: string; content: string; sentAt: string }
  ) {
    const sentAt = Date.parse(message.sentAt)
    if (!Number.isFinite(sentAt)) return false

    const result = this.#database
      .prepare(
        `UPDATE groups
         SET last_message_author = ?, last_message_content = ?,
             last_message_at = ?,
             unread_count = unread_count + CASE WHEN ? = 'user' THEN 0 ELSE 1 END
         WHERE user_id = ? AND id = ?`
      )
      .run(message.author, message.content, sentAt, message.author, userId, id)
    return result.changes > 0
  }

  markRead(userId: string, id: string) {
    return (
      this.#database
        .prepare(
          `UPDATE groups SET unread_count = 0 WHERE user_id = ? AND id = ?`
        )
        .run(userId, id).changes > 0
    )
  }

  setPinned(userId: string, id: string, pinned: boolean) {
    return this.#setTimestamp("pinned_at", userId, id, pinned)
  }

  setArchived(userId: string, id: string, archived: boolean) {
    return this.#setTimestamp("archived_at", userId, id, archived)
  }

  clearMessages(userId: string, id: string) {
    return (
      this.#database
        .prepare(
          `UPDATE groups
           SET last_message_author = NULL, last_message_content = NULL,
               last_message_at = NULL, unread_count = 0
           WHERE user_id = ? AND id = ?`
        )
        .run(userId, id).changes > 0
    )
  }

  delete(userId: string, id: string) {
    return (
      this.#database
        .prepare("DELETE FROM groups WHERE user_id = ? AND id = ?")
        .run(userId, id).changes > 0
    )
  }

  #setTimestamp(
    column: "pinned_at" | "archived_at",
    userId: string,
    id: string,
    set: boolean
  ) {
    return (
      this.#database
        .prepare(
          `UPDATE groups SET ${column} = ? WHERE user_id = ? AND id = ?`
        )
        .run(set ? Date.now() : null, userId, id).changes > 0
    )
  }

  [Symbol.dispose]() {
    this.#database.close()
  }
}

const groupColumns = `id, name, agent_ids, created_at, last_message_author,
                      last_message_content, last_message_at, unread_count,
                      pinned_at`

function groupRecord(row: GroupRow): GroupRecord {
  return {
    id: row.id,
    name: row.name,
    agentIds: JSON.parse(row.agent_ids),
    createdAt: new Date(row.created_at).toISOString(),
    lastMessage:
      row.last_message_author === null ||
      row.last_message_content === null ||
      row.last_message_at === null
        ? null
        : {
            author: row.last_message_author,
            content: row.last_message_content,
            sentAt: new Date(row.last_message_at).toISOString(),
          },
    unreadCount: row.unread_count,
    pinned: row.pinned_at !== null,
  }
}
