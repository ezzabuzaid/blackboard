import { resolve } from "node:path"

import {
  defineSandbox,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"
import type { IFileSystem } from "just-bash"

import { createPersistentVirtualSandbox, userDataRoot } from "../sandbox.js"

export function createWhatsAppSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string,
  participantsFilesystem: (conversation: ConversationId) => IFileSystem
) {
  return (conversation: ConversationId) => {
    const userDirectory = userDataRoot(dataDirectory, conversation.userId)
    return shareSandboxInstance(
      defineSandbox(() =>
        createPersistentVirtualSandbox(resources, dataDirectory, conversation, [
          {
            path: "/workspace/participants",
            filesystem: participantsFilesystem(conversation),
          },
          {
            path: "/workspace/business",
            root: resolve(userDirectory, "business-profile"),
          },
          {
            path: "/workspace/backlog",
            root: resolve(userDirectory, "gtm-backlog"),
          },
          {
            path: "/workspace/product",
            root: resolve(userDirectory, "product-signals"),
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
