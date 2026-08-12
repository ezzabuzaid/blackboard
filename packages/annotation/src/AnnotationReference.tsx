import { Popover } from "radix-ui"
import * as React from "react"

function AnnotationReferenceTrigger(
  props: React.ComponentProps<typeof Popover.Trigger>
) {
  return <Popover.Trigger data-slot="annotation-reference-trigger" {...props} />
}

function AnnotationReferenceContent(
  props: React.ComponentProps<typeof Popover.Content>
) {
  return (
    <Popover.Portal>
      <Popover.Content {...props} />
    </Popover.Portal>
  )
}

function AnnotationReferenceExcerpt(props: React.ComponentProps<"span">) {
  return <span data-slot="annotation-reference-excerpt" {...props} />
}

function AnnotationReferenceComment(props: React.ComponentProps<"span">) {
  return <span data-slot="annotation-reference-comment" {...props} />
}

export const AnnotationReference = {
  Root: Popover.Root,
  Trigger: AnnotationReferenceTrigger,
  Content: AnnotationReferenceContent,
  Excerpt: AnnotationReferenceExcerpt,
  Comment: AnnotationReferenceComment,
} as const
