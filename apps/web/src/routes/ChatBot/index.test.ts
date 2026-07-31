import assert from "node:assert/strict"
import test from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { LoaderFunctionArgs } from "react-router"
import { Streamdown } from "streamdown"

import { artifactRemarkPlugins, sandboxArtifactUrl } from "./artifactLinks"
import {
  initialGroupActivity,
  reduceGroupActivity,
  type GroupActivityEvent,
} from "./groupActivity"
import {
  addGroupMessage,
  groupMessageClusters,
  reduceGroupRoom,
  type GroupRoomState,
} from "./groupMessages"
import { traceItems } from "./traces/agentTrace"
import { loader } from "./loader"

test("loader adds a chat id to the URL", async () => {
  const request = new Request("http://localhost/?source=test")

  await assert.rejects(
    loader({ request } as LoaderFunctionArgs),
    (error: unknown) => {
      assert.ok(error instanceof Response)
      assert.equal(error.status, 302)

      const location = new URL(error.headers.get("location") ?? "", request.url)
      assert.equal(location.searchParams.get("source"), "test")
      assert.ok(location.searchParams.get("chatId"))
      return true
    }
  )
})

test("loader hydrates the selected chat and reports API state", async () => {
  const originalFetch = globalThis.fetch
  let online = true
  let hasHistory = true
  globalThis.fetch = async (input) => {
    if (!online) throw new Error("offline")
    const url = String(input)
    if (url.endsWith("/api/health")) {
      return Response.json({ status: "ok" })
    }
    if (url.endsWith("/api/chat/test-chat/state")) {
      return Response.json({
        messages: hasHistory
          ? [
              {
                id: "message-1",
                sequence: 1,
                author: "user",
                content: "Hello",
              },
              {
                id: "reply-1",
                sequence: 2,
                author: "Maya",
                content: "Hello back",
              },
            ]
          : [],
        participants: [{ name: "Maya", source: "Research evidence." }],
        activity: initialGroupActivity,
        cursor: hasHistory ? 2 : 0,
      })
    }
    return new Response(null, { status: 404 })
  }

  try {
    const args = {
      request: new Request("http://localhost/?chatId=test-chat"),
    } as LoaderFunctionArgs

    assert.deepEqual(await loader(args), {
      apiStatus: "ready",
      chatId: "test-chat",
      initialState: {
        messages: [
          {
            id: "message-1",
            sequence: 1,
            author: "user",
            content: "Hello",
          },
          {
            id: "reply-1",
            sequence: 2,
            author: "Maya",
            content: "Hello back",
          },
        ],
        participants: [{ name: "Maya", source: "Research evidence." }],
        activity: initialGroupActivity,
        cursor: 2,
      },
    })
    hasHistory = false
    assert.deepEqual(await loader(args), {
      apiStatus: "ready",
      chatId: "test-chat",
      initialState: {
        messages: [],
        participants: [{ name: "Maya", source: "Research evidence." }],
        activity: initialGroupActivity,
        cursor: 0,
      },
    })
    online = false
    assert.deepEqual(await loader(args), {
      apiStatus: "offline",
      chatId: "test-chat",
      initialState: {
        messages: [],
        participants: [],
        activity: initialGroupActivity,
        cursor: 0,
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("group messages cluster only consecutive messages from one author", () => {
  const maya = {
    id: "maya-1",
    sequence: 1,
    author: "Maya",
    content: "First thought",
  }
  const mayaFollowUp = {
    id: "maya-2",
    sequence: 2,
    author: "Maya",
    content: "One more thing",
  }
  const omar = {
    id: "omar-1",
    sequence: 3,
    author: "Omar",
    content: "Technical consequence",
  }
  const mayaLater = {
    id: "maya-3",
    sequence: 4,
    author: "Maya",
    content: "Returning later",
  }

  assert.deepEqual(
    groupMessageClusters([maya, mayaFollowUp, omar, mayaLater]),
    [
      { author: "Maya", messages: [maya, mayaFollowUp] },
      { author: "Omar", messages: [omar] },
      { author: "Maya", messages: [mayaLater] },
    ]
  )
})

test("room events append in order and ignore reconnect duplicates", () => {
  const hydrated: GroupRoomState = {
    messages: [
      {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "First",
      },
    ],
    participants: [{ name: "Maya", source: "Research evidence." }],
    activity: {
      phase: "active",
      notification: 1,
      messageCount: 1,
      participants: [{ name: "Maya", state: "considering", replies: 0 }],
    },
    cursor: 4,
  }
  const reply = {
    cursor: 5,
    type: "message" as const,
    message: {
      id: "reply-1",
      sequence: 2,
      author: "Maya",
      content: "Start with the evidence.",
    },
  }
  const withReply = reduceGroupRoom(hydrated, reply)

  assert.deepEqual(withReply.messages, [...hydrated.messages, reply.message])
  assert.strictEqual(reduceGroupRoom(withReply, reply), withReply)
  assert.deepEqual(
    addGroupMessage(withReply.messages, {
      id: "message-2",
      sequence: 3,
      author: "user",
      content: "What if we narrow it?",
    }).map(({ id }) => id),
    ["message-1", "reply-1", "message-2"]
  )
})

test("group activity tracks decisions, replies, and settlement", () => {
  const events: GroupActivityEvent[] = [
    { type: "started", participants: ["researcher", "critic"] },
    {
      type: "notification",
      notification: 1,
      messageCount: 1,
      recipients: ["researcher", "critic"],
    },
    {
      type: "participant",
      notification: 1,
      participant: "researcher",
      state: "considering",
    },
    {
      type: "participant",
      notification: 1,
      participant: "critic",
      state: "considering",
    },
    {
      type: "participant",
      notification: 1,
      participant: "researcher",
      state: "replied",
      replies: 1,
    },
    {
      type: "participant",
      notification: 1,
      participant: "critic",
      state: "passed",
    },
    {
      type: "notification",
      notification: 2,
      messageCount: 1,
      recipients: ["critic"],
    },
    {
      type: "participant",
      notification: 2,
      participant: "critic",
      state: "passed",
    },
    { type: "settled", notifications: 2 },
  ]

  assert.deepEqual(events.reduce(reduceGroupActivity, initialGroupActivity), {
    phase: "settled",
    notification: 2,
    messageCount: 1,
    participants: [
      { name: "researcher", state: "caught-up", replies: 1 },
      { name: "critic", state: "caught-up", replies: 0 },
    ],
  })
})

test("trace tool calls include their matching result once", () => {
  assert.deepEqual(
    traceItems([
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "readFile",
        title: "[Undefined]",
        input: { path: "/workspace/business/README.md" },
      },
      {
        type: "tool-result",
        toolCallId: "tool-1",
        toolName: "readFile",
        output: "Business profile",
      },
      { type: "tool-result", toolCallId: "orphan", output: "Kept raw" },
    ]),
    [
      {
        type: "tool",
        name: "readFile",
        title: null,
        input: { path: "/workspace/business/README.md" },
        output: "Business profile",
      },
      {
        type: "raw",
        label: "tool-result",
        value: {
          type: "tool-result",
          toolCallId: "orphan",
          output: "Kept raw",
        },
      },
    ]
  )
})

test("group activity preserves failures and cumulative reply counts", () => {
  const events: GroupActivityEvent[] = [
    { type: "started", participants: ["Maya", "Omar"] },
    {
      type: "notification",
      notification: 1,
      messageCount: 1,
      recipients: ["Maya", "Omar"],
    },
    {
      type: "participant",
      notification: 1,
      participant: "Maya",
      state: "replied",
      replies: 1,
    },
    {
      type: "participant",
      notification: 1,
      participant: "Omar",
      state: "passed",
    },
    {
      type: "notification",
      notification: 2,
      messageCount: 2,
      recipients: ["Maya", "Omar"],
    },
    {
      type: "participant",
      notification: 2,
      participant: "Maya",
      state: "replied",
      replies: 2,
    },
    {
      type: "participant",
      notification: 2,
      participant: "Omar",
      state: "failed",
    },
  ]

  const active = events.reduce(reduceGroupActivity, initialGroupActivity)
  assert.deepEqual(active.participants, [
    { name: "Maya", state: "replied", replies: 3 },
    { name: "Omar", state: "failed", replies: 0 },
  ])

  assert.deepEqual(
    reduceGroupActivity(active, { type: "settled", notifications: 2 })
      .participants,
    [
      { name: "Maya", state: "caught-up", replies: 3 },
      { name: "Omar", state: "failed", replies: 0 },
    ]
  )
})

test("group activity explains user, limit, and restart stops", () => {
  const active = reduceGroupActivity(initialGroupActivity, {
    type: "started",
    participants: ["Maya", "Omar"],
  })

  for (const stopReason of ["user", "limit", "interrupted"] as const) {
    assert.deepEqual(
      reduceGroupActivity(active, {
        type: "stopped",
        notifications: 2,
        reason: stopReason,
      }),
      {
        phase: "stopped",
        stopReason,
        notification: 2,
        messageCount: 0,
        participants: [
          { name: "Maya", state: "stopped", replies: 0 },
          { name: "Omar", state: "stopped", replies: 0 },
        ],
      }
    )
  }
})

test("assistant artifact links resolve through the chat API", () => {
  assert.equal(
    sandboxArtifactUrl(
      "sandbox:/workspace/output/reports/sample%20report.pdf",
      "chat/1"
    ),
    "http://localhost:3001/api/chat/chat%2F1/artifacts/reports/sample%20report.pdf"
  )
  assert.equal(
    sandboxArtifactUrl("file:///workspace/output/index.html", "chat-1"),
    "http://localhost:3001/api/chat/chat-1/artifacts/index.html"
  )
  assert.equal(
    sandboxArtifactUrl("sandbox:/workspace/private.txt", "chat-1"),
    null
  )

  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        remarkPlugins: artifactRemarkPlugins("chat-1"),
      },
      "[**VANTAGE // Arena Protocol**](file:///workspace/output/index.html)"
    )
  )

  assert.match(html, /data-streamdown="link"/)
  assert.doesNotMatch(html, /\[blocked\]/)
})
