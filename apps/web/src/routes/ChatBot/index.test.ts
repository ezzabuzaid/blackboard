import assert from "node:assert/strict"
import test from "node:test"

import type { LoaderFunctionArgs } from "react-router"

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
