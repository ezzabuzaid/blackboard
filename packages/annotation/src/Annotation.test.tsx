import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Annotation, AnnotationReference } from "./index"

describe("annotation composition", () => {
  it("composes an editable annotation card from independent parts", async () => {
    const user = userEvent.setup()
    const remove = vi.fn()

    function Scenario() {
      const [comment, setComment] = useState("")
      return (
        <Annotation.Root>
          <Annotation.Content>
            <Annotation.Label>1 · Selected from Maya</Annotation.Label>
            <Annotation.Excerpt>one market</Annotation.Excerpt>
            <Annotation.Comment
              aria-label="Comment on annotation 1"
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
            />
          </Annotation.Content>
          <Annotation.Remove>
            <button
              type="button"
              aria-label="Remove annotation"
              onClick={remove}
            >
              Remove
            </button>
          </Annotation.Remove>
        </Annotation.Root>
      )
    }

    render(<Scenario />)
    await user.type(
      screen.getByRole("textbox", { name: "Comment on annotation 1" }),
      "Why only one?"
    )
    await user.click(screen.getByRole("button", { name: "Remove annotation" }))

    expect(
      screen.getByRole("textbox", { name: "Comment on annotation 1" })
    ).toHaveValue("Why only one?")
    expect(remove).toHaveBeenCalledOnce()
  })

  it("composes an accessible inline annotation reference", async () => {
    const user = userEvent.setup()
    render(
      <AnnotationReference.Root>
        <AnnotationReference.Trigger aria-label="Annotation 1: one market">
          Annotation 1
        </AnnotationReference.Trigger>
        <AnnotationReference.Content side="top" sideOffset={8}>
          <AnnotationReference.Excerpt>one market</AnnotationReference.Excerpt>
          <AnnotationReference.Comment>
            Why only one?
          </AnnotationReference.Comment>
        </AnnotationReference.Content>
      </AnnotationReference.Root>
    )

    const trigger = screen.getByRole("button", {
      name: "Annotation 1: one market",
    })
    await user.click(trigger)

    expect(trigger).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("one market")).toBeVisible()
    expect(screen.getByText("Why only one?")).toBeVisible()

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByText("one market")).toBeNull())
  })
})
