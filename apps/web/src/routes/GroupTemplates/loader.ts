import type { LoaderFunctionArgs } from "react-router"

import { hasIdentity } from "../../auth"
import { api } from "../ChatBot/api"

export interface GroupAgent {
  id: string
  name: string
  responsibility: string
}

export interface CatalogAgent {
  id: string
  name: string
  category: string
  headline: string
  tags: readonly string[]
}

interface GroupTemplateBase {
  id: string
  name: string
  category: string
  outcome: string
  agents: readonly GroupAgent[]
}

export type GroupTemplate = GroupTemplateBase &
  (
    | { source: "prebuilt" }
    | { source: "marketplace"; publisherName: string | null }
    | { source: "custom" }
  )

const buildOwnTemplate: GroupTemplate = {
  id: "custom",
  name: "Build your own",
  category: "Custom",
  outcome: "Choose up to eight characters from the catalog.",
  source: "custom",
  agents: [],
}

export async function loader(args: LoaderFunctionArgs) {
  const [session, { templates }, catalog] = await Promise.all([
    api.request(
      "GET /auth/get-session",
      {},
      { signal: args.request.signal }
    ),
    api.request("GET /group-templates", {}, { signal: args.request.signal }),
    api.request("GET /agents", {}, { signal: args.request.signal }) as Promise<{
      agents: readonly CatalogAgent[]
    }>,
  ])
  const groupTemplates: readonly GroupTemplate[] = [
    ...templates,
    buildOwnTemplate,
  ]
  const requestedTemplateId = new URL(args.request.url).searchParams.get(
    "template"
  )
  return {
    signedIn: hasIdentity(session),
    initialSelectedId: groupTemplates.some(
      ({ id }) => id === requestedTemplateId
    )
      ? requestedTemplateId
      : null,
    catalogAgents: catalog.agents,
    groupTemplates,
  }
}
