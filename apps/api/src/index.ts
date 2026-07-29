import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"

import { SqliteContextStore, SqliteStreamStore } from "@deepagents/context"
import {
  AgentRuntime,
  PgBossTurnQueue,
  SqliteApprovalMutex,
  SqliteMailboxStore,
  type ConversationId,
  type TurnRef,
} from "@deepagents/experimental/zukhruf"
import { PGlite } from "@electric-sql/pglite"
import { createTerminus } from "@godaddy/terminus"
import { serve } from "@hono/node-server"
import { PgBoss, fromPglite } from "pg-boss"

import { assistant } from "./agent/agent.js"
import { disposeSandboxes } from "./agent/sandbox.js"
import { createApp } from "./app.js"

await using resources = new AsyncDisposableStack()

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

const queue = new PgBossTurnQueue(boss)
await queue.initialize()

const runtime = new AgentRuntime(assistant, {
  store: new SqliteContextStore(join(dataDir, "context.sqlite")),
  streamStore,
  queue,
  mailboxStore,
  approvalMutex: resources.use(
    new SqliteApprovalMutex(join(dataDir, "approval.sqlite"))
  ),
})
resources.defer(disposeSandboxes)
resources.use(await runtime.work())

const app = createApp({
  runtime,
  streams: streamStore,
  listQueuedTurns: async (conversation: ConversationId) => {
    const jobs = await boss.findJobs<TurnRef>(queue.queue, {
      key: conversation.chatId,
      queued: true,
    })

    return jobs
      .filter((job) => job.data.userId === conversation.userId)
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          +new Date(left.createdOn) - +new Date(right.createdOn) ||
          left.id.localeCompare(right.id)
      )
      .map((job) => ({
        id: job.data.streamId,
        kind: job.data.kind,
        input: job.data.kind === "ask" ? job.data.input : null,
      }))
  },
})

await using server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3001),
  },
  ({ port }) => console.log(`API listening on http://localhost:${port}`)
)

createTerminus(server, {
  signals: ["SIGINT", "SIGTERM"],
  useExit0: true,
  onSignal: () => resources.disposeAsync(),
  logger: (message, error) => console.error(message, error),
})

await new Promise<never>(() => {})
