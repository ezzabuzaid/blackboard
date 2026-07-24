import assert from "node:assert/strict"
import test from "node:test"

import type { AgentRuntime } from "@deepagents/experimental/zukhruf"
import type { UIMessage } from "ai"

import agentSandbox, { disposeSandboxes } from "./agent/sandbox.js"
import { scheduleTask } from "./agent/tools/schedule-task.js"
import { createApp } from "./app.js"
import type {
  ChatRuntime,
  ChatStreamStore,
} from "./chat/chat-service.js"
import type { ListQueuedTurns, QueuedTurn } from "./chat/routes.js"

const unusedRuntime: ChatRuntime = {
  async enqueue() {
    throw new Error("Unexpected enqueue")
  },
  observe() {
    throw new Error("Unexpected observe")
  },
}

const noQueuedTurns = async (): Promise<QueuedTurn[]> => []
const noStreams: ChatStreamStore = {
  async getStreamStatus() {
    return null
  },
}

function testApp({
  runtime = unusedRuntime,
  streams = noStreams,
  listQueuedTurns = noQueuedTurns,
}: {
  runtime?: ChatRuntime
  streams?: ChatStreamStore
  listQueuedTurns?: ListQueuedTurns
} = {}) {
  return createApp({ runtime, streams, listQueuedTurns })
}

const app = testApp()

test("health reports the linked agent", async () => {
  const response = await app.request("/api/health")

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    status: "ok",
    agent: "zukhruf",
  })
})

test("chat rejects an invalid UI message", async () => {
  const response = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "chat-1",
      messages: [{ role: "user", content: "not a UI message" }],
    }),
  })

  assert.equal(response.status, 400)
})

test("chat enqueues the latest UI message as a Zukhruf turn", async () => {
  let received: Parameters<AgentRuntime["enqueue"]> | undefined
  const runtime: ChatRuntime = {
    async enqueue(...input) {
      received = input
      return {
        id: "stream-1",
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "start", messageId: "stream-1" })
            controller.enqueue({ type: "text-start", id: "text-1" })
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: "Hello",
            })
            controller.enqueue({ type: "text-end", id: "text-1" })
            controller.enqueue({ type: "finish", finishReason: "stop" })
            controller.close()
          },
        }),
      }
    },
    observe: unusedRuntime.observe,
  }
  const response = await testApp({ runtime }).request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "chat-1",
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: " Hello " }],
          },
        ],
      }),
    })

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  assert.deepEqual(received, [
    { chatId: "chat-1", userId: "local-user" },
    { id: "message-1", input: "Hello" },
  ])
  assert.match(await response.text(), /"type":"text-delta"/)
})

test("queued turns endpoint uses the requested chat", async () => {
  let received: { chatId: string; userId: string } | undefined
  const response = await testApp({
    listQueuedTurns: async (conversation) => {
      received = conversation
      return [
        {
          id: "turn-2",
          kind: "ask",
          input: "Self-scheduled task:\nResearch the side lead.",
        },
      ]
    },
  }).request("/api/chat/chat-1/turns")

  assert.equal(response.status, 200)
  assert.deepEqual(received, { chatId: "chat-1", userId: "local-user" })
  assert.deepEqual(await response.json(), {
    turns: [
      {
        id: "turn-2",
        kind: "ask",
        input: "Self-scheduled task:\nResearch the side lead.",
      },
    ],
  })
})

test("chat state hydrates history without duplicating the replayable head", async () => {
  const messages: UIMessage[] = [
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    },
    {
      id: "stream-1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello back" }],
    },
  ]
  let received: { chatId: string; userId: string } | undefined
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe(conversation) {
      received = conversation
      return {
        engine: {
          async getMessages() {
            return messages
          },
          async headMessage() {
            return { id: "stream-1", name: "assistant" }
          },
        },
        async resume() {
          return null
        },
      }
    },
  }
  const streams: ChatStreamStore = {
    async getStreamStatus(id) {
      assert.equal(id, "stream-1")
      return "completed"
    },
  }

  const response = await testApp({ runtime, streams }).request(
    "/api/chat/chat-1/state"
  )

  assert.equal(response.status, 200)
  assert.deepEqual(received, { chatId: "chat-1", userId: "local-user" })
  assert.deepEqual(await response.json(), {
    messages: [messages[0]],
    resume: true,
  })
})

test("chat stream endpoint replays the durable head stream", async () => {
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe() {
      return {
        engine: {
          async getMessages() {
            return []
          },
          async headMessage() {
            return undefined
          },
        },
        async resume() {
          return new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "start", messageId: "stream-1" })
              controller.enqueue({ type: "text-start", id: "text-1" })
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: "Resumed",
              })
              controller.enqueue({ type: "text-end", id: "text-1" })
              controller.enqueue({ type: "finish", finishReason: "stop" })
              controller.close()
            },
          })
        },
      }
    },
  }

  const response = await testApp({ runtime }).request(
    "/api/chat/chat-1/stream"
  )

  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/)
  assert.match(await response.text(), /"delta":"Resumed"/)
})

test("chat stream endpoint returns no content before a turn exists", async () => {
  const runtime: ChatRuntime = {
    enqueue: unusedRuntime.enqueue,
    observe() {
      return {
        engine: {
          async getMessages() {
            return []
          },
          async headMessage() {
            return undefined
          },
        },
        async resume() {
          return null
        },
      }
    },
  }

  const response = await testApp({ runtime }).request(
    "/api/chat/chat-1/stream"
  )

  assert.equal(response.status, 204)
})

test("development CORS accepts a local fallback port", async () => {
  const response = await app.request("/api/health", {
    headers: { Origin: "http://localhost:5174" },
  })

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5174"
  )
})

test("schedule_task enqueues work for the same conversation", async () => {
  let received:
    | [{ chatId: string; userId: string }, { id: string; input: string }]
    | undefined
  const executeOptions = {
    toolCallId: "tool-call-1",
    messages: [],
    abortSignal: new AbortController().signal,
    context: {
      actor: {
        thread: {
          conversation: { chatId: "chat-1", userId: "local-user" },
        },
      },
      controlPlane: {
        async enqueue(
          conversation: { chatId: string; userId: string },
          turn: { id: string; input: string }
        ) {
          received = [conversation, turn]
          return "turn-2"
        },
      },
    },
  } as Parameters<typeof scheduleTask.execute>[1]

  const result = await scheduleTask.execute(
    { task: " Research the side lead. " },
    executeOptions
  )

  assert.deepEqual(received, [
    { chatId: "chat-1", userId: "local-user" },
    {
      id: "tool-call-1",
      input: "Self-scheduled task:\nResearch the side lead.",
    },
  ])
  assert.deepEqual(result, { turnId: "turn-2" })
})

test("Agent OS sandbox persists files across turns in one chat", async () => {
  const conversation = { chatId: "chat-1", userId: "local-user" }

  try {
    const firstTurn = await agentSandbox(conversation)
    await firstTurn.sandbox.writeFiles([
      { path: "/workspace/probe.txt", content: "agent-os" },
    ])

    const secondTurn = await agentSandbox(conversation)
    assert.equal(
      await secondTurn.sandbox.readFile("/workspace/probe.txt"),
      "agent-os"
    )
    const result = await secondTurn.sandbox.executeCommand(
      "printf sandbox-ready"
    )
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, "sandbox-ready")
  } finally {
    await disposeSandboxes()
  }
})
