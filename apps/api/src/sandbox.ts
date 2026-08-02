import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

import { createVirtualSandbox } from "@deepagents/context"
import type { ConversationId } from "@deepagents/experimental/zukhruf"
import { MountableFs, ReadWriteFs } from "just-bash"

interface WorkspaceMount {
  path: string
  root: string
}

const workspaceId = ({ chatId, userId }: ConversationId) =>
  createHash("sha256")
    .update(JSON.stringify([userId, chatId]))
    .digest("hex")
    .slice(0, 32)

const sandboxRoot = (
  dataDirectory: string,
  conversation: ConversationId
) => resolve(dataDirectory, "sandboxes", workspaceId(conversation))

const artifactRoot = (
  dataDirectory: string,
  conversation: ConversationId
) => resolve(sandboxRoot(dataDirectory, conversation), "workspace", "output")

export async function createPersistentVirtualSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string,
  conversation: ConversationId,
  mounts: WorkspaceMount[] = []
) {
  const root = sandboxRoot(dataDirectory, conversation)
  await Promise.all(
    [
      resolve(root, "workspace"),
      artifactRoot(dataDirectory, conversation),
      ...mounts.map(({ root }) => root),
    ].map((path) => mkdir(path, { recursive: true, mode: 0o700 }))
  )

  const filesystem = new MountableFs({
    base: new ReadWriteFs({ root }),
    mounts: mounts.map(({ path, root }) => ({
      mountPoint: path,
      filesystem: new ReadWriteFs({ root }),
    })),
  })
  const sandbox = await createVirtualSandbox({
    fs: filesystem,
    cwd: "/workspace",
  })
  resources.use(sandbox)
  return sandbox
}

export async function openArtifact(
  dataDirectory: string,
  conversation: ConversationId,
  path: string
) {
  try {
    const filesystem = new ReadWriteFs({
      root: artifactRoot(dataDirectory, conversation),
    })
    if (!(await filesystem.exists(path))) return null

    const metadata = await filesystem.stat(path)
    if (!metadata.isFile) return null

    return {
      body: new Uint8Array(await filesystem.readFileBuffer(path)),
      size: metadata.size,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
