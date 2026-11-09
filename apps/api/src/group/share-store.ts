import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { Declaration } from '@zukhruf/sqlite-drift';
import { open } from '@zukhruf/sqlite-open';
import { z } from 'zod';

export interface GroupShareRecord {
  token: string;
  createdAt: string;
}

export interface GroupShareTarget {
  userId: string;
  groupId: string;
}

const shareRow = z.object({ token: z.string(), created_at: z.number() });
const targetRow = z.object({ user_id: z.string(), group_id: z.string() });

export class GroupShareStore implements Disposable {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    this.#database = open(databasePath);
    new Declaration(
      [
        `CREATE TABLE group_shares (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      ) STRICT
    `,
        `CREATE INDEX group_shares_by_group
        ON group_shares (user_id, group_id)
    `,
      ],
      { rows: 'keep' },
    ).apply(this.#database);
  }

  create(userId: string, groupId: string): GroupShareRecord {
    this.revoke(userId, groupId);

    const createdAt = Date.now();
    const token = randomUUID();
    this.#database
      .prepare(
        `INSERT INTO group_shares (token, user_id, group_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(token, userId, groupId, createdAt);
    return { token, createdAt: new Date(createdAt).toISOString() };
  }

  active(userId: string, groupId: string): GroupShareRecord | null {
    const row = this.#database
      .prepare(
        `SELECT token, created_at
         FROM group_shares
         WHERE user_id = ? AND group_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(userId, groupId);
    if (!row) return null;

    const { token, created_at } = shareRow.parse(row);
    return { token, createdAt: new Date(created_at).toISOString() };
  }

  revoke(userId: string, groupId: string) {
    return (
      this.#database
        .prepare(
          `UPDATE group_shares SET revoked_at = ?
           WHERE user_id = ? AND group_id = ? AND revoked_at IS NULL`,
        )
        .run(Date.now(), userId, groupId).changes > 0
    );
  }

  deleteForGroup(userId: string, groupId: string) {
    return (
      this.#database
        .prepare('DELETE FROM group_shares WHERE user_id = ? AND group_id = ?')
        .run(userId, groupId).changes > 0
    );
  }

  resolve(token: string): GroupShareTarget | null {
    const row = this.#database
      .prepare(
        `SELECT user_id, group_id
         FROM group_shares
         WHERE token = ? AND revoked_at IS NULL`,
      )
      .get(token);
    if (!row) return null;

    const { user_id, group_id } = targetRow.parse(row);
    return { userId: user_id, groupId: group_id };
  }

  [Symbol.dispose]() {
    this.#database.close();
  }
}
