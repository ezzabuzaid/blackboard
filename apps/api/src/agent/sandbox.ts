import common from "@rivet-dev/agent-os-common"

import {
  createAgentOsSandbox,
  type DisposableSandbox,
} from "@deepagents/context"
import {
  defineSandbox,
  type SandboxContext,
} from "@deepagents/experimental/zukhruf"

const resources = new AsyncDisposableStack()
// ponytail: process-lifetime chat pool; evict when conversation deletion exists.
const sandboxes = new Map<string, Promise<DisposableSandbox>>()

async function sandboxFor({ chatId, userId }: SandboxContext) {
  const key = JSON.stringify([userId, chatId])
  const existing = sandboxes.get(key)
  if (existing) return existing

  const pending = createAgentOsSandbox({ software: [common] })
  sandboxes.set(key, pending)

  try {
    const sandbox = await pending
    resources.use(sandbox)
    return sandbox
  } catch (error) {
    sandboxes.delete(key)
    throw error
  }
}

export async function disposeSandboxes() {
  await Promise.allSettled(sandboxes.values())
  sandboxes.clear()
  await resources.disposeAsync()
}

export default defineSandbox(sandboxFor)
