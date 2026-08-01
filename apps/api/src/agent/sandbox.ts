import {
  defineSandbox,
  type SandboxContext,
} from "@deepagents/experimental/zukhruf"

import {
  createPersistentVirtualSandbox,
  removeVirtualSandbox,
} from "../sandbox.js"

const resources = new AsyncDisposableStack()
const dataDirectory = process.env.ZUKHRUF_DATA_DIR ?? ".data/zukhruf"

export default defineSandbox((context) =>
  createPersistentVirtualSandbox(resources, dataDirectory, context)
)

export async function disposeSandboxes() {
  await resources.disposeAsync()
}

export async function removeSandbox(context: SandboxContext) {
  await removeVirtualSandbox(dataDirectory, context)
}
