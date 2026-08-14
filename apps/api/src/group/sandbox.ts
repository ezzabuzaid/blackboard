import {
  defineSandbox,
  type AgentDeclaration,
  type ConversationId,
} from "@deepagents/experimental/zukhruf"
import type { IFileSystem } from "just-bash"

import { createPersistentVirtualSandbox } from "../sandbox.js"

export function createWhatsAppSandbox(
  resources: AsyncDisposableStack,
  dataDirectory: string,
  participantsFilesystem: (conversation: ConversationId) => IFileSystem
) {
  return (conversation: ConversationId) => {
    return shareSandboxInstance(
      defineSandbox(() =>
        createPersistentVirtualSandbox(resources, dataDirectory, conversation, [
          {
            path: "/workspace/participants",
            filesystem: participantsFilesystem(conversation),
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
