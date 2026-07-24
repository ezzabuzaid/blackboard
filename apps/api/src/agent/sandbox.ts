import { createVirtualSandbox } from "@deepagents/context"
import { defineSandbox } from "@deepagents/experimental/zukhruf"
import { InMemoryFs } from "just-bash"

export default defineSandbox(() =>
  createVirtualSandbox({ fs: new InMemoryFs() })
)
