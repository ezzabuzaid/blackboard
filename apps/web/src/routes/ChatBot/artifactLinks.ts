import { defaultRemarkPlugins } from "streamdown"

import { apiUrl } from "./chatTransport"

interface MarkdownNode {
  children?: MarkdownNode[]
  type: string
  url?: string
}

const sandboxArtifactPrefixes = [
  "sandbox:/workspace/output/",
  "file:///workspace/output/",
]

export const artifactBaseUrl = (chatId: string) =>
  `${apiUrl}/api/chat/${encodeURIComponent(chatId)}/artifacts/`

export const artifactRemarkPlugins = (chatId: string) => [
  ...Object.values(defaultRemarkPlugins),
  () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "link" && node.url) {
        node.url = sandboxArtifactUrl(node.url, chatId) ?? node.url
      }
      node.children?.forEach(visit)
    }

    visit(tree)
  },
]

export function sandboxArtifactUrl(url: string, chatId: string) {
  const prefix = sandboxArtifactPrefixes.find((prefix) =>
    url.startsWith(prefix)
  )
  if (!prefix) return null

  try {
    const segments = url.slice(prefix.length).split("/")
    const encodedPath = segments
      .map((segment) => {
        const decoded = decodeURIComponent(segment)
        if (
          !decoded ||
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("\0")
        ) {
          throw new URIError("Invalid artifact path")
        }
        return encodeURIComponent(decoded)
      })
      .join("/")

    return `${artifactBaseUrl(chatId)}${encodedPath}`
  } catch {
    return null
  }
}
