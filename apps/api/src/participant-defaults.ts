import { openai } from '@ai-sdk/openai';
import { codex } from '@deepagents/experimental/providers/codex';
import { defaultSettingsMiddleware, wrapLanguageModel } from 'ai';

export function createParticipantDefaults(
  options: {
    modelId?: string;
  } = {},
) {
  const modelId = options.modelId || 'gpt-6.1-sol';

  return {
    model: wrapLanguageModel({
      model: codex.languageModel(modelId),
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions: { openai: { reasoningEffort: 'high' } } },
      }),
    }),
    tools: {
      web_search: openai.tools.webSearch(),
    },
  };
}
