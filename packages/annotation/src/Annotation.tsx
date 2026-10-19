import { useRender } from "@base-ui/react/use-render"
import * as React from "react"

function AnnotationRoot({
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    render,
    props: { "data-slot": "annotation", ...props },
  })
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

function AnnotationControl({
  render,
  ...props
}: useRender.ComponentProps<"button"> & { render: useRender.RenderProp }) {
  return useRender({ render, props })
}

export const Annotation = {
  Root: AnnotationRoot,
  Content: AnnotationContent,
  Label: AnnotationLabel,
  Excerpt: AnnotationExcerpt,
  Comment: AnnotationComment,
  Remove: AnnotationControl,
  Selection: AnnotationControl,
} as const
