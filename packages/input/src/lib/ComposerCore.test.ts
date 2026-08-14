import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { serializeMentionPromptLink } from '../persisted-prompt.ts';
import { createDraftFromPersistedText } from './ComposerCore';
import type { ComposerItemEntry } from './ComposerTypes';

const maya: ComposerItemEntry = {
  id: 'agent:Maya',
  trigger: '@',
  value: 'Maya',
  label: 'Maya',
  detail: '',
  atomic: true,
  persistsAs: serializeMentionPromptLink('Maya'),
};

describe('persisted mention drafts', () => {
  it('restores a serialized mention link as a mention, not literal text', () => {
    const draft = createDraftFromPersistedText({
      text: `ask ${serializeMentionPromptLink('Maya')} today`,
      mentionCandidates: [maya],
    });

    assert.equal(draft.text, 'ask @Maya today');
    assert.deepEqual(
      draft.elements?.map(({ kind, label }) => ({ kind, label })),
      [{ kind: 'mention', label: '@Maya' }],
    );
    assert.equal(draft.mentionBindings?.[0]?.value, 'Maya');
  });
});
