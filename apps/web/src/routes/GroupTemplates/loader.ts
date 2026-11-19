import type { LoaderFunctionArgs } from 'react-router';

import { authClient } from '../../auth-client.ts';
import { api } from '../ChatBot/api.ts';

export interface GroupAgent {
  id: string;
  name: string;
  responsibility: string;
}

export interface CatalogAgent {
  id: string;
  name: string;
  category: string;
  headline: string;
  tags: readonly string[];
}

interface GroupTemplateBase {
  id: string;
  name: string;
  category: string;
  outcome: string;
  agents: readonly GroupAgent[];
}

export type GroupTemplate = GroupTemplateBase &
  (
    | { source: 'prebuilt' }
    | {
        source: 'marketplace';
        publisherName: string;
        owned: boolean;
        detached: boolean;
      }
    | { source: 'custom' }
  );

const buildOwnTemplate: GroupTemplate = {
  id: 'custom',
  name: 'Build your own',
  category: 'Custom',
  outcome: 'Choose up to eight characters from the catalog.',
  source: 'custom',
  agents: [],
};

export async function loader(args: LoaderFunctionArgs) {
  const [session, { templates }, catalog] = await Promise.all([
    authClient.getSession({
      fetchOptions: { signal: args.request.signal, throw: true },
    }),
    api.request('GET /group-templates', {}, { signal: args.request.signal }),
    api.request('GET /agents', {}, { signal: args.request.signal }),
  ]);
  const catalogAgents: readonly CatalogAgent[] = catalog.agents;
  const groupTemplates: readonly GroupTemplate[] = [
    ...templates,
    buildOwnTemplate,
  ];
  const requestedTemplateId = new URL(args.request.url).searchParams.get(
    'template',
  );
  return {
    signedIn: session !== null,
    initialSelectedId: groupTemplates.some(
      ({ id }) => id === requestedTemplateId,
    )
      ? requestedTemplateId
      : null,
    catalogAgents,
    groupTemplates,
  };
}
