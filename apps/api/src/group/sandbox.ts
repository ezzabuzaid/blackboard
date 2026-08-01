import { createHash } from "node:crypto"
import { resolve } from "node:path"

import {
  defineSandbox,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"

import { createPersistentVirtualSandbox } from "../sandbox.js"

const hash = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)

const businessProfilePath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "business-profiles", hash(userId))

const gtmBacklogPath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "gtm-backlogs", hash(userId))

const productSignalsPath = (dataDirectory: string, userId: string) =>
  resolve(dataDirectory, "product-signals", hash(userId))

export function createWhatsAppSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string
) {
  return (conversation: ConversationId) => {
    const profilePath = businessProfilePath(dataDirectory, conversation.userId)
    const backlogPath = gtmBacklogPath(dataDirectory, conversation.userId)
    const productPath = productSignalsPath(dataDirectory, conversation.userId)
    return shareSandboxInstance(
      defineSandbox(() =>
        createPersistentVirtualSandbox(resources, dataDirectory, conversation, [
          { path: "/workspace/business", root: profilePath },
          { path: "/workspace/backlog", root: backlogPath },
          { path: "/workspace/product", root: productPath },
        ])
      )
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
