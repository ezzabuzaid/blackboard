import assert from "node:assert/strict"
import test from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { LoaderFunctionArgs } from "react-router"
import { Streamdown } from "streamdown"

import { artifactRemarkPlugins, sandboxArtifactUrl } from "./artifactLinks"
import {
  readChatReferenceDraft,
  writeChatReferenceDraft,
} from "./chatReferenceDraft"
import {
  groupActivityIndicator,
  initialGroupActivity,
  reduceGroupActivity,
  type GroupActivityEvent,
} from "./groupActivity"
import {
  addGroupMessage,
  addGroupMessageAnnotation,
  groupChatEventFromStreamPart,
  groupMessageClusters,
  reduceGroupChat,
  updateGroupMessageAnnotationComment,
  type GroupChatState,
} from "./groupMessages"
import {
  messageComponents,
  messageRemarkPlugins,
} from "./messageMarkdown"
import { serializeMentionPromptLink } from "@genui/input"

import { messageDisplayText, messageSegments } from "./mentions"
import { traceItems } from "./traces/agentTrace"
import { loader } from "./loader"

const sentAt = "2026-07-31T12:00:00.000Z"
const groupSummary = {
  id: "test-chat",
  name: "Test group",
  agentIds: ["maya"],
  createdAt: sentAt,
  lastMessage: null,
  unreadCount: 0,
  pinned: false,
}

test("extracts group events from the Zukhruf stream", () => {
  const event = {
    cursor: 1,
    type: "activity" as const,
    activity: { type: "started" as const, participants: ["Maya"] },
  }
  assert.deepEqual(
    groupChatEventFromStreamPart({
      type: "data-whatsapp-chat-event",
      data: event,
    }),
    event
  )
  const toolEvent = {
    cursor: 2,
    type: "activity" as const,
    activity: {
      type: "presence" as const,
      notification: 1,
      participant: "Maya",
      state: "working-with-files" as const,
    },
  }
  assert.deepEqual(
    groupChatEventFromStreamPart({
      type: "data-whatsapp-chat-event",
      data: toolEvent,
    }),
    toolEvent
  )
  assert.equal(groupChatEventFromStreamPart({ type: "text-delta" }), null)
})

test("loader sends users without groups to group creation", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith("/api/auth/get-session")) {
      return Response.json({ user: { id: "user-1" } })
    }
    if (url.endsWith("/api/groups")) return Response.json({ groups: [] })
    return new Response(null, { status: 404 })
  }
  const request = new Request("http://localhost/?source=test")

  try {
    await assert.rejects(
      loader({ request } as LoaderFunctionArgs),
      (error: unknown) => {
        assert.ok(error instanceof Response)
        assert.equal(error.status, 302)

        assert.equal(error.headers.get("location"), "/groups/new")
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("loader selects the most recent group", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith("/api/auth/get-session")) {
      return Response.json({ user: { id: "user-1" } })
    }
    if (url.endsWith("/api/groups")) {
      return Response.json({ groups: [groupSummary] })
    }
    return new Response(null, { status: 404 })
  }

  const request = new Request("http://localhost/?source=test")
  try {
    await assert.rejects(
      loader({ request } as LoaderFunctionArgs),
      (error: unknown) => {
        assert.ok(error instanceof Response)
        const location = new URL(
          error.headers.get("location") ?? "",
          request.url
        )
        assert.equal(location.searchParams.get("source"), "test")
        assert.equal(location.searchParams.get("chatId"), "test-chat")
        return true
      }
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("loader sends unauthenticated users to login", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push(url)
    if (url.endsWith("/api/auth/get-session")) return Response.json(null)
    return new Response(null, { status: 500 })
  }

  const request = new Request("http://localhost/?source=test")
  try {
    await assert.rejects(
      loader({ request } as LoaderFunctionArgs),
      (error: unknown) => {
        assert.ok(error instanceof Response)
        const location = new URL(
          error.headers.get("location") ?? "",
          request.url
        )
        assert.equal(location.pathname, "/login")
        assert.equal(location.searchParams.get("redirect"), "/?source=test")
        return true
      }
    )
    assert.deepEqual(requests, ["http://localhost:3001/api/auth/get-session"])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("loader hydrates the selected chat and reports API state", async () => {
  const originalFetch = globalThis.fetch
  let online = true
  let hasHistory = true
  globalThis.fetch = async (input) => {
    if (!online) throw new Error("offline")
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith("/api/auth/get-session")) {
      return Response.json({ user: { id: "user-1" } })
    }
    if (url.endsWith("/api/health")) {
      return Response.json({ status: "ok" })
    }
    if (url.endsWith("/api/groups")) {
      return Response.json({ groups: [groupSummary] })
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
                sentAt,
                replyToMessageId: null,
                annotations: [],
              },
              {
                id: "reply-1",
                sequence: 2,
                author: "Maya",
                content: "Hello back",
                sentAt,
                replyToMessageId: "message-1",
                annotations: [],
              },
            ]
          : [],
        participants: [{ name: "Maya" }],
        activity: initialGroupActivity,
        cursor: hasHistory ? 2 : 0,
        streamPath: "/zukhruf/v1/session/test-chat/stream",
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
      groups: [groupSummary],
      streamPath: "/zukhruf/v1/session/test-chat/stream",
      initialState: {
        messages: [
          {
            id: "message-1",
            sequence: 1,
            author: "user",
            content: "Hello",
            sentAt,
            replyToMessageId: null,
            annotations: [],
          },
          {
            id: "reply-1",
            sequence: 2,
            author: "Maya",
            content: "Hello back",
            sentAt,
            replyToMessageId: "message-1",
            annotations: [],
          },
        ],
        participants: [{ name: "Maya" }],
        activity: initialGroupActivity,
        cursor: 2,
      },
    })
    hasHistory = false
    assert.deepEqual(await loader(args), {
      apiStatus: "ready",
      chatId: "test-chat",
      groups: [groupSummary],
      streamPath: "/zukhruf/v1/session/test-chat/stream",
      initialState: {
        messages: [],
        participants: [{ name: "Maya" }],
        activity: initialGroupActivity,
        cursor: 0,
      },
    })
    online = false
    await assert.rejects(loader(args), /offline/)
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
    sentAt,
    replyToMessageId: null,
    annotations: [],
  }
  const mayaFollowUp = {
    id: "maya-2",
    sequence: 2,
    author: "Maya",
    content: "One more thing",
    sentAt,
    replyToMessageId: null,
    annotations: [],
  }
  const omar = {
    id: "omar-1",
    sequence: 3,
    author: "Omar",
    content: "Technical consequence",
    sentAt,
    replyToMessageId: "maya-2",
    annotations: [{ messageId: "maya-2", excerpt: "One more thing" }],
  }
  const mayaLater = {
    id: "maya-3",
    sequence: 4,
    author: "Maya",
    content: "Returning later",
    sentAt,
    replyToMessageId: null,
    annotations: [],
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

test("annotations append without duplicating an existing excerpt", () => {
  const first = addGroupMessageAnnotation([], {
    messageId: "message-1",
    excerpt: " first point ",
  })
  const second = addGroupMessageAnnotation(first, {
    messageId: "message-2",
    excerpt: "second point",
  })

  assert.deepEqual(second, [
    { messageId: "message-1", excerpt: "first point" },
    { messageId: "message-2", excerpt: "second point" },
  ])
  assert.strictEqual(addGroupMessageAnnotation(second, second[0]!), second)
})

test("annotation comments update in place without changing selection order", () => {
  const annotations = [
    { messageId: "message-1", excerpt: "first" },
    { messageId: "message-2", excerpt: "second" },
  ]

  assert.deepEqual(
    updateGroupMessageAnnotationComment(annotations, annotations[0]!, "why?"),
    [
      { messageId: "message-1", excerpt: "first", comment: "why?" },
      { messageId: "message-2", excerpt: "second" },
    ]
  )
})

test("annotation-only drafts retain ordered comments", () => {
  try {
    localStorage.clear()
    const draft = {
      replyToMessageId: null,
      annotations: [
        {
          messageId: "message-1",
          excerpt: "first",
          comment: "Why?",
        },
        { messageId: "message-2", excerpt: "second" },
      ],
    }

    writeChatReferenceDraft("chat-1", draft)

    assert.deepEqual(readChatReferenceDraft("chat-1"), draft)
    assert.deepEqual(readChatReferenceDraft("chat-2"), {
      replyToMessageId: null,
      annotations: [],
    })
  } finally {
    localStorage.clear()
  }
})

test("chat events append in order and ignore reconnect duplicates", () => {
  const hydrated: GroupChatState = {
    messages: [
      {
        id: "message-1",
        sequence: 1,
        author: "user",
        content: "First",
        sentAt,
        replyToMessageId: null,
        annotations: [],
      },
    ],
    participants: [{ name: "Maya" }],
    activity: {
      phase: "active",
      notification: 1,
      messageCount: 1,
      participants: [{ name: "Maya", state: "considering", replies: 0 }],
      presence: [{ name: "Maya", state: "reading" }],
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
      sentAt,
      replyToMessageId: "message-1",
      annotations: [{ messageId: "message-1", excerpt: "First" }],
    },
  }
  const withReply = reduceGroupChat(hydrated, reply)

  assert.deepEqual(withReply.messages, [...hydrated.messages, reply.message])
  assert.strictEqual(reduceGroupChat(withReply, reply), withReply)
  assert.deepEqual(
    addGroupMessage(withReply.messages, {
      id: "message-2",
      sequence: 3,
      author: "user",
      content: "What if we narrow it?",
      sentAt,
      replyToMessageId: "reply-1",
      annotations: [{ messageId: "reply-1", excerpt: "the evidence" }],
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
    presence: [
      { name: "researcher", state: "seen" },
      { name: "critic", state: "seen" },
    ],
  })
})

test("group activity stays visible while agents think and type", () => {
  const started = reduceGroupActivity(initialGroupActivity, {
    type: "started",
    participants: ["Maya", "Omar"],
  })
  assert.deepEqual(groupActivityIndicator(started), {
    participants: ["Maya", "Omar"],
    label: "2 agents are thinking…",
  })

  const reading = reduceGroupActivity(started, {
    type: "presence",
    notification: 1,
    participant: "Maya",
    state: "reading",
  })
  assert.deepEqual(groupActivityIndicator(reading), {
    participants: ["Maya", "Omar"],
    label: "2 agents are thinking…",
  })

  const usingTool = reduceGroupActivity(reading, {
    type: "presence",
    notification: 1,
    participant: "Maya",
    state: "working-with-files",
  })
  assert.deepEqual(groupActivityIndicator(usingTool), {
    participants: ["Maya"],
    label: "Maya is working with group files…",
  })

  const typing = reduceGroupActivity(usingTool, {
    type: "presence",
    notification: 1,
    participant: "Omar",
    state: "typing",
  })
  assert.deepEqual(groupActivityIndicator(typing), {
    participants: ["Omar"],
    label: "Omar is typing…",
  })
  assert.deepEqual(
    groupActivityIndicator(
      reduceGroupActivity(typing, { type: "settled", notifications: 1 })
    ),
    null
  )
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
        presence: [
          { name: "Maya", state: "idle" },
          { name: "Omar", state: "idle" },
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

test("assistant annotation directives render as numbered inline controls", () => {
  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        allowedTags: { "codex-annotation": ["index"] },
        components: messageComponents([
          {
            messageId: "message-1",
            excerpt: "one market",
            comment: "Why only one?",
          },
        ]),
        remarkPlugins: messageRemarkPlugins(undefined, []),
      },
      'That scope is deliberate. :codex-annotation{index="1"}'
    )
  )

  assert.match(html, /<button[^>]+aria-label="Annotation 1: one market"/u)
  assert.match(html, />Annotation 1<\/button>/u)
  assert.doesNotMatch(html, /:codex-annotation/u)
})

test("assistant prose renders known participants as mentions", () => {
  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        allowedTags: {
          "codex-annotation": ["index"],
          "participant-mention": [],
        },
        components: messageComponents([]),
        remarkPlugins: messageRemarkPlugins(undefined, ["Maya", "Paul Graham"]),
      },
      "Ask @Paul Graham and @Maya, not `@Maya`, [@Maya](https://example.com), or ezz@Maya.com."
    )
  )

  assert.equal(html.match(/data-token="mention"/gu)?.length, 2)
  assert.match(html, /<span[^>]+data-token="mention"[^>]*>@Paul Graham<\/span>/u)
  assert.match(html, /<span[^>]+data-token="mention"[^>]*>@Maya<\/span>/u)
  assert.match(html, /<code[^>]*>@Maya<\/code>/u)
  assert.match(html, /ezz@Maya\.com/u)
})

test("persisted mention links render as tokens carrying their source", () => {
  const persisted = serializeMentionPromptLink("Paul Graham")

  assert.deepEqual(messageSegments(`hey ${persisted} ship it`), [
    { text: "hey ", mention: false },
    { text: "@Paul Graham", source: persisted, mention: true },
    { text: " ship it", mention: false },
  ])
})

test("a bare @name is not a mention", () => {
  assert.deepEqual(messageSegments("hey @Maya, mail ezz@Maya.com"), [
    { text: "hey @Maya, mail ezz@Maya.com", mention: false },
  ])
})

test("user messages keep rendering markdown literally", () => {
  const content = "see [docs](https://example.com) and `code`"
  const segments = messageSegments(content)

  assert.equal(segments.map(({ text }) => text).join(""), content)
  assert.equal(
    segments.some(({ mention }) => mention),
    false
  )
})

test("previews and quotes read a persisted mention as its label", () => {
  const persisted = serializeMentionPromptLink("Maya")

  assert.equal(
    messageDisplayText(`hey ${persisted}, can you look?`),
    "hey @Maya, can you look?"
  )
})
