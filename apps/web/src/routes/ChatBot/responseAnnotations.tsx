import type { TextDirective } from "mdast-util-directive"
import { AnnotationReference } from "@genui/annotation"
import remarkDirective from "remark-directive"
import { defaultRemarkPlugins, type Components } from "streamdown"

import { artifactRemarkPlugins } from "./artifactLinks"
import type { GroupMessageAnnotation } from "./groupMessages"

interface MarkdownNode {
  attributes?: Record<string, string | null | undefined> | null
  children?: MarkdownNode[]
  data?: TextDirective["data"]
  name?: string
  type: string
}

export function responseAnnotationRemarkPlugins(chatId?: string) {
  return [
    ...(chatId
      ? artifactRemarkPlugins(chatId)
      : Object.values(defaultRemarkPlugins)),
    remarkDirective,
    responseAnnotationDirective,
  ]
}

export function responseAnnotationComponents(
  annotations: readonly GroupMessageAnnotation[]
): Components {
  return {
    "codex-annotation": ({ index }) => (
      <ResponseAnnotationReference
        index={Number(index)}
        annotations={annotations}
      />
    ),
  }
}

function responseAnnotationDirective() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "textDirective" && node.name === "codex-annotation") {
        const index = node.attributes?.index
        node.data = {
          ...node.data,
          hName: "codex-annotation",
          hProperties: { index },
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
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
        className="z-50 flex w-64 flex-col gap-2 rounded-lg bg-popover p-3 text-start text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden"
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
