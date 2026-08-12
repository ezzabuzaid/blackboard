import assert from "node:assert/strict"
import test from "node:test"
import type { LoaderFunctionArgs } from "react-router"

import { loader } from "./loader"
import {
  loginPathForTemplate,
  matchesTemplateFilter,
  toggleAgentSelection,
} from "./selection"

test("character selection toggles without exceeding the group limit", () => {
  assert.deepEqual(toggleAgentSelection(["annie-duke"], "paul-graham"), [
    "annie-duke",
    "paul-graham",
  ])
  assert.deepEqual(toggleAgentSelection(["annie-duke"], "annie-duke"), [])
  assert.deepEqual(toggleAgentSelection(["one", "two"], "three", 2), [
    "one",
    "two",
  ])
})

test("anonymous visitors can load the public marketplace catalog", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith("/api/auth/get-session")) return Response.json(null)
    if (url.endsWith("/api/group-templates")) {
      return Response.json({
        templates: [
          {
            id: "founder-board",
            name: "Founder Board",
            category: "Strategy",
            outcome: "Challenge the next company decision.",
            source: "marketplace",
            publisherName: "Publisher One",
            agents: [],
          },
        ],
      })
    }
    if (url.endsWith("/api/agents")) return Response.json({ agents: [] })
    return new Response(null, { status: 404 })
  }

  try {
    const result = await loader({
      request: new Request(
        "http://localhost/groups/new?template=founder-board"
      ),
    } as LoaderFunctionArgs)
    assert.equal(result.signedIn, false)
    assert.equal(result.initialSelectedId, "founder-board")
    const marketplace = result.groupTemplates.find(
      ({ source }) => source === "marketplace"
    )
    assert.equal(marketplace?.source, "marketplace")
    if (marketplace?.source === "marketplace") {
      assert.equal(marketplace.publisherName, "Publisher One")
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("starting a public template returns through login to that template", () => {
  assert.equal(
    loginPathForTemplate("founder-board"),
    "/login?redirect=%2Fgroups%2Fnew%3Ftemplate%3Dfounder-board"
  )
})

test("marketplace filter excludes prebuilt and custom groups", () => {
  assert.equal(
    matchesTemplateFilter(
      { source: "marketplace", category: "Strategy" },
      "source:marketplace"
    ),
    true
  )
  assert.equal(
    matchesTemplateFilter(
      { source: "prebuilt", category: "Strategy" },
      "source:marketplace"
    ),
    false
  )
})
