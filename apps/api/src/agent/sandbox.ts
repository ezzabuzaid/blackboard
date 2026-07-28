import { createHash } from "node:crypto"

import { createMicrosandboxSandbox } from "@deepagents/context"
import {
  defineSandbox,
  type SandboxContext,
} from "@deepagents/experimental/zukhruf"
import {
  NetworkPolicy,
  Sandbox,
  Volume,
  VolumeNotFoundError,
} from "microsandbox"

const resources = new AsyncDisposableStack()
const sandboxImage = "self-delegate-agent-browser:0.26.0-r2"
const sandboxName = ({ chatId, userId }: SandboxContext) =>
  `self-delegate-${createHash("sha256")
    .update(JSON.stringify([userId, chatId]))
    .digest("hex")
    .slice(0, 32)}`
const artifactVolumeName = (context: SandboxContext) =>
  `${sandboxName(context)}-artifacts`

export default defineSandbox(async (context) => {
  const sandbox = await createMicrosandboxSandbox({
    name: sandboxName(context),
    image: sandboxImage,
    memory: 1024,
    env: {
      AGENT_BROWSER_CONTENT_BOUNDARIES: "1",
      AGENT_BROWSER_IDLE_TIMEOUT_MS: "60000",
      AGENT_BROWSER_SCREENSHOT_DIR: "/workspace/output",
    },
    readiness: async (sandbox) => {
      const result = await sandbox.executeCommand(
        "start-agent-browser-chromium"
      )
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to start Chromium")
      }
    },
    commandTimeout: 30_000,
    configure: (builder) =>
      builder
        .volume("/workspace/output", (mount) =>
          mount
            .namedWith(
              artifactVolumeName(context),
              "ensure-exists",
              "dir",
              undefined,
              100
            )
            .noexec()
            .nosuid()
            .nodev()
        )
        .network((network) => network.policy(NetworkPolicy.none())),
  })
  resources.use(sandbox)
  return sandbox
})

export async function openArtifact(context: SandboxContext, path: string) {
  let volume
  try {
    volume = await Volume.get(artifactVolumeName(context))
  } catch (error) {
    if (error instanceof VolumeNotFoundError) return null
    throw error
  }

  const files = volume.fs()
  if (!(await files.exists(path))) return null

  const metadata = await files.stat(path)
  if (metadata.kind !== "file") return null

  return {
    body: await files.readStream(path),
    size: metadata.size,
  }
}

export async function disposeSandboxes() {
  await resources.disposeAsync()
}

export async function removeSandbox(context: SandboxContext) {
  await Sandbox.remove(sandboxName(context))
  await Volume.remove(artifactVolumeName(context))
}
