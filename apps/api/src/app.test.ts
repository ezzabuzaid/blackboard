import assert from "node:assert/strict"
import test from "node:test"

import type { AgentRuntime } from "@deepagents/experimental/zukhruf"

import { createApp } from "./app.js"

const unusedRuntime: Pick<AgentRuntime, "enqueue"> = {
  async enqueue() {
    throw new Error("Unexpected enqueue")
  },
}

const app = createApp(unusedRuntime)

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
  const runtime: Pick<AgentRuntime, "enqueue"> = {
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
  }
  const response = await createApp(runtime).request("/api/chat", {
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

test("development CORS accepts a local fallback port", async () => {
  const response = await app.request("/api/health", {
    headers: { Origin: "http://localhost:5174" },
  })

  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5174"
  )
})
