import { Popover, PopoverContent, PopoverTrigger } from "@zukhruf/shadcn"
import * as React from "react"

function AnnotationReferenceTrigger(
  props: React.ComponentProps<typeof PopoverTrigger>
) {
  return <PopoverTrigger data-slot="annotation-reference-trigger" {...props} />
}

function AnnotationReferenceExcerpt(props: React.ComponentProps<"span">) {
  return <span data-slot="annotation-reference-excerpt" {...props} />
}

function AnnotationReferenceComment(props: React.ComponentProps<"span">) {
  return <span data-slot="annotation-reference-comment" {...props} />
}

export const AnnotationReference = {
  Root: Popover,
  Trigger: AnnotationReferenceTrigger,
  Content: PopoverContent,
  Excerpt: AnnotationReferenceExcerpt,
  Comment: AnnotationReferenceComment,
} as const
