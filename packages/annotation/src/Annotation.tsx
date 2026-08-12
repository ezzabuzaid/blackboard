import { Slot } from "radix-ui"
import * as React from "react"

function AnnotationRoot({
  asChild,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "div"
  return <Component data-slot="annotation" {...props} />
}

function AnnotationContent(props: React.ComponentProps<"div">) {
  return <div data-slot="annotation-content" {...props} />
}

function AnnotationLabel(props: React.ComponentProps<"p">) {
  return <p data-slot="annotation-label" {...props} />
}

function AnnotationExcerpt({
  dir = "auto",
  ...props
}: React.ComponentProps<"p">) {
  return <p data-slot="annotation-excerpt" dir={dir} {...props} />
}

function AnnotationComment(props: React.ComponentProps<"input">) {
  return <input data-slot="annotation-comment" {...props} />
}

export const Annotation = {
  Root: AnnotationRoot,
  Content: AnnotationContent,
  Label: AnnotationLabel,
  Excerpt: AnnotationExcerpt,
  Comment: AnnotationComment,
  Remove: Slot.Root,
  Selection: Slot.Root,
} as const
