import catalog from "../../../../catalog/group-templates.json" with { type: "json" }

export type GroupTemplate = {
  id: string
  name: string
  category: string
  outcome: string
  agents: readonly { agentId: string; responsibility: string }[]
}

export const groupTemplates: readonly GroupTemplate[] = catalog
