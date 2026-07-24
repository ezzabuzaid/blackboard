import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

import { SqliteContextStore, SqliteStreamStore } from "@deepagents/context"
import {
  AgentRuntime,
  PgBossTurnQueue,
  SqliteMailboxStore,
} from "@deepagents/experimental/zukhruf"
import { PGlite } from "@electric-sql/pglite"
import { PgBoss, fromPglite } from "pg-boss"

import { assistant } from "./agent.js"

export async function createZukhrufHost() {
  const resources = new AsyncDisposableStack()

  try {
    const dataDir = resolve(process.env.ZUKHRUF_DATA_DIR ?? ".data/zukhruf")
    await mkdir(dataDir, { recursive: true })

    const database = new PGlite(join(dataDir, "queue"))
    resources.defer(() => database.close())

    const streamStore = new SqliteStreamStore(join(dataDir, "streams.sqlite"))
    resources.defer(() => streamStore.close())

    const mailboxStore = new SqliteMailboxStore(join(dataDir, "mailbox.sqlite"))
    resources.defer(() => mailboxStore.close())

    const boss = new PgBoss({
      db: fromPglite(database),
      backend: "pglite",
    })
    boss.on("error", (error) => console.error("[queue error]", error))
    await boss.start()
    resources.defer(() => boss.stop({ graceful: false }))

    const queue = new PgBossTurnQueue(boss, { schema: "pgboss" })
    await queue.initialize()

    const runtime = new AgentRuntime(assistant, {
      store: new SqliteContextStore(join(dataDir, "context.sqlite")),
      streamStore,
      queue,
      mailboxStore,
    })
    resources.use(await runtime.work())

    return {
      runtime,
      close: () => resources.disposeAsync(),
    }
  } catch (error) {
    await resources.disposeAsync()
    throw error
  }
}
