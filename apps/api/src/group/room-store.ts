import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { ConversationId } from "@deepagents/experimental/zukhruf"

import type {
  WhatsAppGroupHydration,
  WhatsAppGroupSnapshot,
  WhatsAppRoomEvent,
} from "./whatsapp.js"

const MAX_STORED_ROOM_BYTES = 5 * 1024 * 1024

export class WhatsAppRoomStore implements Disposable {
  readonly #database: DatabaseSync

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true })
    this.#database = new DatabaseSync(path)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS rooms (
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        PRIMARY KEY (user_id, chat_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS room_events (
        user_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        cursor INTEGER NOT NULL,
        event TEXT NOT NULL,
        PRIMARY KEY (user_id, chat_id, cursor)
      ) STRICT;
    `)
  }

  load({ userId, chatId }: ConversationId): WhatsAppGroupHydration | null {
    const room = this.#database
      .prepare("SELECT snapshot FROM rooms WHERE user_id = ? AND chat_id = ?")
      .get(userId, chatId) as { snapshot: string } | undefined
    if (!room) return null

    const events = this.#database
      .prepare(
        "SELECT event FROM room_events WHERE user_id = ? AND chat_id = ? ORDER BY cursor"
      )
      .all(userId, chatId) as { event: string }[]
    return {
      snapshot: JSON.parse(room.snapshot) as WhatsAppGroupSnapshot,
      events: events.map(({ event }) => JSON.parse(event) as WhatsAppRoomEvent),
    }
  }

  save(
    { userId, chatId }: ConversationId,
    snapshot: WhatsAppGroupSnapshot,
    event?: WhatsAppRoomEvent
  ) {
    // ponytail: full snapshots are bounded at 500 messages; normalize only if
    // measured write latency justifies the extra schema and joins.
    const serializedSnapshot = JSON.stringify(snapshot)
    if (Buffer.byteLength(serializedSnapshot) > MAX_STORED_ROOM_BYTES) {
      throw new Error("WhatsApp room exceeds the durable storage limit")
    }

    this.#database.exec("BEGIN IMMEDIATE")
    try {
      this.#database
        .prepare(
          `INSERT INTO rooms (user_id, chat_id, snapshot)
           VALUES (?, ?, ?)
           ON CONFLICT (user_id, chat_id)
           DO UPDATE SET snapshot = excluded.snapshot`
        )
        .run(userId, chatId, serializedSnapshot)
      if (event) {
        this.#database
          .prepare(
            `INSERT INTO room_events (user_id, chat_id, cursor, event)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (user_id, chat_id, cursor)
             DO UPDATE SET event = excluded.event`
          )
          .run(userId, chatId, event.cursor, JSON.stringify(event))
      }
      this.#database.exec("COMMIT")
    } catch (error) {
      this.#database.exec("ROLLBACK")
      throw error
    }
  }

  [Symbol.dispose]() {
    this.#database.close()
  }
}
