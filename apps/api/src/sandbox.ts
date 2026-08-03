import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

import { createVirtualSandbox } from "@deepagents/context"
import type { ConversationId } from "@deepagents/experimental/zukhruf"
import {
  MountableFs,
  OverlayFs,
  ReadWriteFs,
  type IFileSystem,
} from "just-bash"

interface RealWorkspaceMount {
  path: string
  root: string
  readOnly?: boolean
}

interface VirtualWorkspaceMount {
  path: string
  filesystem: IFileSystem
}

type WorkspaceMount = RealWorkspaceMount | VirtualWorkspaceMount

function mountFilesystem(mount: WorkspaceMount) {
  if ("filesystem" in mount) return mount.filesystem
  if (mount.readOnly) {
    return new OverlayFs({
      root: mount.root,
      mountPoint: "/",
      readOnly: true,
    })
  }
  return new ReadWriteFs({ root: mount.root })
}

const workspaceId = ({ chatId }: ConversationId) =>
  createHash("sha256").update(chatId).digest("hex").slice(0, 32)

export const userDataRoot = (dataDirectory: string, userId: string) =>
  resolve(
    dataDirectory,
    "users",
    createHash("sha256").update(userId).digest("hex")
  )

const sandboxRoot = (dataDirectory: string, conversation: ConversationId) =>
  resolve(
    userDataRoot(dataDirectory, conversation.userId),
    "sandboxes",
    workspaceId(conversation)
  )

const artifactRoot = (dataDirectory: string, conversation: ConversationId) =>
  resolve(sandboxRoot(dataDirectory, conversation), "workspace", "output")

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
      ...mounts.flatMap((mount) => ("root" in mount ? [mount.root] : [])),
    ].map((path) => mkdir(path, { recursive: true, mode: 0o700 }))
  )

  const filesystem = new MountableFs({
    base: new ReadWriteFs({ root }),
    mounts: mounts.map((mount) => ({
      mountPoint: mount.path,
      filesystem: mountFilesystem(mount),
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
