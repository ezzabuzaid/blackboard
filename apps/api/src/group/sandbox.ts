import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

import { createMicrosandboxSandbox } from "@deepagents/context"
import {
  defineSandbox,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"
import { NetworkPolicy } from "microsandbox"

const hash = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)

export const businessProfilePath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "business-profiles", hash(userId))

export const gtmBacklogPath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "gtm-backlogs", hash(userId))

export const productSignalsPath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "product-signals", hash(userId))

export const whatsappSandboxName = (
  dataDirectory: string,
  { chatId, userId }: ConversationId
) =>
  `self-delegate-whatsapp-${hash(
    "gtm-sources-v1",
    userId,
    chatId,
    businessProfilePath(dataDirectory, userId),
    gtmBacklogPath(dataDirectory, userId),
    productSignalsPath(dataDirectory, userId)
  )}`

export function createWhatsAppSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string
) {
  // ponytail: serialize VM acquisition until Microsandbox supports concurrent first boots.
  let acquisition = Promise.resolve()

  return (conversation: ConversationId) => {
    const profilePath = businessProfilePath(dataDirectory, conversation.userId)
    const backlogPath = gtmBacklogPath(dataDirectory, conversation.userId)
    const productPath = productSignalsPath(dataDirectory, conversation.userId)
    return shareSandboxInstance(
      defineSandbox(async () => {
        await Promise.all(
          [profilePath, backlogPath, productPath].map((path) =>
            mkdir(path, { recursive: true, mode: 0o700 })
          )
        )
        const creation = acquisition.then(() =>
          createMicrosandboxSandbox({
            name: whatsappSandboxName(dataDirectory, conversation),
            memory: 512,
            configure: (builder) =>
              builder
                .volume("/workspace/business", (mount) =>
                  mount.bind(profilePath).noexec().nosuid().nodev()
                )
                .volume("/workspace/backlog", (mount) =>
                  mount.bind(backlogPath).noexec().nosuid().nodev()
                )
                .volume("/workspace/product", (mount) =>
                  mount.bind(productPath).noexec().nosuid().nodev()
                )
                .network((network) => network.policy(NetworkPolicy.none())),
          })
        )
        acquisition = creation.then(
          () => undefined,
          () => undefined
        )
        const sandbox = await creation
        resources.use(sandbox)
        return sandbox
      })
    )
  }
}

export function shareSandboxInstance(
  create: AgentDeclaration["sandbox"]
): AgentDeclaration["sandbox"] {
  let instance: ReturnType<AgentDeclaration["sandbox"]> | undefined

  return (context) => {
    if (instance) return instance
    const creating = create(context)
    instance = creating
    void creating.catch(() => {
      if (instance === creating) instance = undefined
    })
    return creating
  }
}
