import type { TextDirective } from "mdast-util-directive"
import { AnnotationReference } from "@genui/annotation"
import type { ReactNode } from "react"
import remarkDirective from "remark-directive"
import {
  defaultRemarkPlugins,
  type Components,
  type ExtraProps,
} from "streamdown"

import { artifactRemarkPlugins } from "./artifactLinks"
import type { GroupMessageAnnotation } from "./groupMessages"

interface MarkdownNode {
  attributes?: Record<string, string | null | undefined> | null
  children?: MarkdownNode[]
  data?: TextDirective["data"]
  name?: string
  type: string
  value?: string
}

const mentionLeft = /[\p{L}\p{N}_@]/u
const mentionRight = /[\p{L}\p{N}_-]/u

export function messageRemarkPlugins(
  chatId: string | undefined,
  participantNames: readonly string[]
) {
  return [
    ...(chatId
      ? artifactRemarkPlugins(chatId)
      : Object.values(defaultRemarkPlugins)),
    remarkDirective,
    responseAnnotationDirective,
    participantMentionDirective(participantNames),
  ]
}

export function messageComponents(
  annotations: readonly GroupMessageAnnotation[]
): Components {
  return {
    "codex-annotation": ({ index }) => (
      <ResponseAnnotationReference
        index={Number(index)}
        annotations={annotations}
      />
    ),
    "participant-mention": ParticipantMention,
  }
}

export function ParticipantMention({
  children,
  persistedSource,
}: Record<string, unknown> & ExtraProps) {
  return (
    <span
      data-token="mention"
      data-persisted-source={
        typeof persistedSource === "string" ? persistedSource : undefined
      }
      className="rounded-sm bg-foreground/10 px-0.5 font-medium"
    >
      {children as ReactNode}
    </span>
  )
}

function responseAnnotationDirective() {
  return (tree: MarkdownNode) => {
    visitMarkdown(tree, (node) => {
      if (node.type === "textDirective" && node.name === "codex-annotation") {
        const index = node.attributes?.index
        node.data = {
          ...node.data,
          hName: "codex-annotation",
          hProperties: { index },
        }
      }
    })
  }
}

function participantMentionDirective(participantNames: readonly string[]) {
  const labels = [...new Set(participantNames.map((name) => `@${name}`))]
    .toSorted((left, right) => right.length - left.length)

  return () => (tree: MarkdownNode) => {
    rewriteParticipantMentions(tree, labels)
  }
}

function rewriteParticipantMentions(
  node: MarkdownNode,
  labels: readonly string[]
) {
  if (
    node.type === "code" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "linkReference" ||
    (node.type === "textDirective" && node.name === "participant-mention")
  ) {
    return
  }
  if (!node.children) return

  node.children = node.children.flatMap((child) =>
    child.type === "text" && child.value
      ? participantMentionNodes(child.value, labels)
      : child
  )
  node.children.forEach((child) => rewriteParticipantMentions(child, labels))
}

function participantMentionNodes(
  text: string,
  labels: readonly string[]
): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let outputCursor = 0
  let scanCursor = 0

  while (scanCursor < text.length) {
    const start = text.indexOf("@", scanCursor)
    if (start === -1) break

    const label = labels.find(
      (candidate) =>
        text.startsWith(candidate, start) &&
        !mentionLeft.test(text[start - 1] ?? "") &&
        !mentionRight.test(text[start + candidate.length] ?? "")
    )
    if (!label) {
      scanCursor = start + 1
      continue
    }

    if (start > outputCursor) {
      nodes.push({ type: "text", value: text.slice(outputCursor, start) })
    }
    nodes.push({
      type: "textDirective",
      name: "participant-mention",
      children: [{ type: "text", value: label }],
      data: { hName: "participant-mention" },
    })
    outputCursor = start + label.length
    scanCursor = outputCursor
  }

  if (nodes.length === 0) return [{ type: "text", value: text }]
  if (outputCursor < text.length) {
    nodes.push({ type: "text", value: text.slice(outputCursor) })
  }
  return nodes
}

function visitMarkdown(
  node: MarkdownNode,
  visitor: (node: MarkdownNode) => void
) {
  visitor(node)
  node.children?.forEach((child) => visitMarkdown(child, visitor))
}

function ResponseAnnotationReference({
  annotations,
  index,
}: {
  annotations: readonly GroupMessageAnnotation[]
  index: number
}) {
  const annotation = annotations[index - 1]
  if (!annotation || !Number.isSafeInteger(index) || index < 1) return null

  return (
    <AnnotationReference.Root>
      <AnnotationReference.Trigger
        aria-label={`Annotation ${index}: ${annotation.excerpt}`}
      >
        Annotation {index}
      </AnnotationReference.Trigger>
      <AnnotationReference.Content
        side="top"
        sideOffset={8}
        className="bg-popover text-popover-foreground ring-foreground/10 z-50 flex w-64 flex-col gap-2 rounded-lg p-3 text-start text-xs shadow-md ring-1 outline-hidden"
      >
        <AnnotationReference.Excerpt>
          {annotation.excerpt}
        </AnnotationReference.Excerpt>
        {annotation.comment && (
          <AnnotationReference.Comment>
            {annotation.comment}
          </AnnotationReference.Comment>
        )}
      </AnnotationReference.Content>
    </AnnotationReference.Root>
  )
}
