import { resolve } from "node:path"

import {
  defineSandbox,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"

import { createPersistentVirtualSandbox } from "../sandbox.js"

export function createWhatsAppSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string
) {
  return (conversation: ConversationId) => {
    return shareSandboxInstance(
      defineSandbox(() =>
        createPersistentVirtualSandbox(resources, dataDirectory, conversation, [
          {
            path: "/workspace/agents",
            root: resolve(dataDirectory, "agents"),
            readOnly: true,
          },
          {
            path: "/workspace/business",
            root: resolve(dataDirectory, "business-profile"),
          },
          {
            path: "/workspace/backlog",
            root: resolve(dataDirectory, "gtm-backlog"),
          },
          {
            path: "/workspace/product",
            root: resolve(dataDirectory, "product-signals"),
          },
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
