import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

export interface GroupShareRecord {
  token: string
  createdAt: string
}

export interface GroupShareTarget {
  userId: string
  groupId: string
}

interface GroupShareRow {
  token: string
  created_at: number
}

export class GroupShareStore implements Disposable {
  readonly #database: DatabaseSync

  constructor(databasePath: string) {
    this.#database = new DatabaseSync(databasePath)
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS group_shares (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT
    `)
    this.#database.exec(`
      CREATE INDEX IF NOT EXISTS group_shares_by_group
        ON group_shares (user_id, group_id)
    `)
  }

  create(userId: string, groupId: string): GroupShareRecord {
    this.revoke(userId, groupId)

    const createdAt = Date.now()
    const token = randomUUID()
    this.#database
      .prepare(
        `INSERT INTO group_shares (token, user_id, group_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(token, userId, groupId, createdAt)
    return { token, createdAt: new Date(createdAt).toISOString() }
  }

  active(userId: string, groupId: string): GroupShareRecord | null {
    const row = this.#database
      .prepare(
        `SELECT token, created_at
         FROM group_shares
         WHERE user_id = ? AND group_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(userId, groupId) as GroupShareRow | undefined

    return row
      ? { token: row.token, createdAt: new Date(row.created_at).toISOString() }
      : null
  }

  revoke(userId: string, groupId: string) {
    return (
      this.#database
        .prepare(
          `UPDATE group_shares SET revoked_at = ?
           WHERE user_id = ? AND group_id = ? AND revoked_at IS NULL`
        )
        .run(Date.now(), userId, groupId).changes > 0
    )
  }

  resolve(token: string): GroupShareTarget | null {
    const row = this.#database
      .prepare(
        `SELECT user_id, group_id
         FROM group_shares
         WHERE token = ? AND revoked_at IS NULL`
      )
      .get(token) as { user_id: string; group_id: string } | undefined

    return row ? { userId: row.user_id, groupId: row.group_id } : null
  }

  [Symbol.dispose]() {
    this.#database.close()
  }
}
