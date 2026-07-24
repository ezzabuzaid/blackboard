import assert from "node:assert/strict"
import test from "node:test"

import type { LoaderFunctionArgs } from "react-router"

import { loader } from "./index"

test("health loader reports ready and offline states", async () => {
  const originalFetch = globalThis.fetch
  let online = true
  globalThis.fetch = async () => {
    if (!online) throw new Error("offline")
    return new Response(null, { status: 200 })
  }

  try {
    const args = {
      request: new Request("http://localhost/"),
    } as LoaderFunctionArgs

    assert.deepEqual(await loader(args), { apiStatus: "ready" })
    online = false
    assert.deepEqual(await loader(args), { apiStatus: "offline" })
  } finally {
    globalThis.fetch = originalFetch
  }
})
