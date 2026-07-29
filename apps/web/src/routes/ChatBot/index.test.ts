import assert from "node:assert/strict"
import test from "node:test"

import type { UIMessage } from "ai"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { LoaderFunctionArgs } from "react-router"
import { Streamdown } from "streamdown"

import { AgentTrajectory } from "./AgentTrajectory"
import { artifactRemarkPlugins, sandboxArtifactUrl } from "./artifactLinks"
import { scheduledTurnId, waitForStream } from "./ChatSession"
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
                role: "user",
                parts: [{ type: "text", text: "Hello" }],
              },
            ]
          : [],
        resume: hasHistory,
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
      initialMessages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
      resume: true,
    })
    hasHistory = false
    assert.deepEqual(await loader(args), {
      apiStatus: "ready",
      chatId: "test-chat",
      initialMessages: [],
      resume: false,
    })
    online = false
    assert.deepEqual(await loader(args), {
      apiStatus: "offline",
      chatId: "test-chat",
      initialMessages: [],
      resume: false,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("scheduled turns hydrate history before resuming their stream", async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  const messages: UIMessage[] = [
    {
      id: "scheduled-user",
      role: "user",
      parts: [{ type: "text", text: "Self-scheduled task:\nContinue" }],
    },
  ]
  globalThis.fetch = async () =>
    Response.json({
      streamId: ++requests === 1 ? "stream-1" : "stream-2",
      messages,
    })

  try {
    assert.equal(
      scheduledTurnId({
        id: "stream-1",
        role: "assistant",
        parts: [
          {
            type: "tool-schedule_task",
            toolCallId: "call-1",
            state: "output-available",
            input: { task: "Continue" },
            output: { turnId: "stream-2" },
          },
        ],
      }),
      "stream-2"
    )
    assert.deepEqual(
      await waitForStream(
        "test-chat",
        "stream-2",
        new AbortController().signal
      ),
      { streamId: "stream-2", messages }
    )
    assert.equal(requests, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("agent trajectory renders AI SDK message parts", () => {
  const parts: UIMessage["parts"] = [
    { type: "step-start" },
    {
      type: "dynamic-tool",
      toolCallId: "tool-1",
      toolName: "writeFile",
      state: "output-available",
      input: { path: "/workspace/sample.pdf" },
      output: { success: true },
    },
    { type: "step-start" },
  ]
  const html = renderToStaticMarkup(
    AgentTrajectory({
      active: false,
      parts,
    })
  )

  assert.match(html, /Activity/)
  assert.match(html, /2 steps · 1 tool/)
  assert.doesNotMatch(html, /Step 1/)
  assert.doesNotMatch(html, /Step 2/)
  assert.match(html, /Write file/)
  assert.match(html, /Completed/)
  assert.match(html, /sample\.pdf/)
  assert.match(html, /success/)
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
