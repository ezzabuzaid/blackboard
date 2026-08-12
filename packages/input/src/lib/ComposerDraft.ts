import { useRef, useState } from 'react';

import type { ComposerSubmitContext } from './Composer';
import {
  type ComposerPreparedPayload,
  createComposerDraftSource,
  createDraftFromSource,
} from './ComposerCore';
import type {
  ComposerDraftSource,
  ComposerInitialDraft,
  ComposerItemEntry,
  ComposerState,
} from './ComposerTypes';

const STORAGE_KEY_PREFIX = 'composer-draft:v1:';

export type UseComposerDraftOptions = {
  key: string;
  slashCommands?: ComposerItemEntry[];
  mentionCandidates?: ComposerItemEntry[];
};

export type ComposerDraftSession = {
  composerKey: string;
  initialDraft: ComposerInitialDraft | undefined;
  restored: boolean;
  onStateChange: (
    state: ComposerState,
    prepared: ComposerPreparedPayload,
  ) => void;
  trackSend: (send: Promise<unknown>, context: ComposerSubmitContext) => void;
};

export function useComposerDraft({
  key,
  slashCommands = [],
  mentionCandidates = [],
}: UseComposerDraftOptions): ComposerDraftSession {
  const [session, setSession] = useState(() =>
    hydrateSession(key, slashCommands, mentionCandidates),
  );
  const pendingSendsRef = useRef(0);

  if (session.key !== key) {
    setSession(hydrateSession(key, slashCommands, mentionCandidates));
  }

  function onStateChange(
    state: ComposerState,
    prepared: ComposerPreparedPayload,
  ) {
    if (prepared) {
      writeStoredDraft(
        key,
        createComposerDraftSource(state, prepared.persistedPrompt),
      );
    } else if (pendingSendsRef.current === 0) {
      // Submit clears the editor before the send settles; keep the stored
      // draft until the outcome is known so a mid-flight reload loses nothing.
      writeStoredDraft(key, null);
    }
  }

  function trackSend(send: Promise<unknown>, context: ComposerSubmitContext) {
    const sendKey = key;
    pendingSendsRef.current += 1;
    send
      .then(() => writeStoredDraft(sendKey, null))
      .catch(() => {
        writeStoredDraft(sendKey, context.editableSource);
        setSession((current) =>
          current.key === sendKey
            ? {
                key: current.key,
                restores: current.restores + 1,
                initialDraft: createDraftFromSource({
                  source: context.editableSource,
                  slashCommands,
                  mentionCandidates,
                }),
              }
            : current,
        );
      })
      .finally(() => {
        pendingSendsRef.current -= 1;
      });
  }

  return {
    composerKey: `${session.key}#${session.restores}`,
    initialDraft: session.initialDraft,
    restored: session.restores > 0,
    onStateChange,
    trackSend,
  };
}

function hydrateSession(
  key: string,
  slashCommands: ComposerItemEntry[],
  mentionCandidates: ComposerItemEntry[],
) {
  const source = readStoredDraft(key);
  return {
    key,
    restores: 0,
    initialDraft: source
      ? createDraftFromSource({ source, slashCommands, mentionCandidates })
      : undefined,
  };
}

function readStoredDraft(key: string): ComposerDraftSource | null {
  const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${key}`);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isComposerDraftSource(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredDraft(key: string, source: ComposerDraftSource | null) {
  const storageKey = `${STORAGE_KEY_PREFIX}${key}`;
  if (!source || isEmptyDraftSource(source)) {
    localStorage.removeItem(storageKey);
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(source));
  } catch {
    // Quota exhaustion or privacy mode: the draft just won't survive a reload.
  }
}

function isEmptyDraftSource(source: ComposerDraftSource) {
  return (
    !source.persistedPrompt.trim() &&
    source.localImages.length === 0 &&
    source.remoteImages.length === 0 &&
    source.pendingPastes.length === 0
  );
}

function isComposerDraftSource(value: unknown): value is ComposerDraftSource {
  return (
    isRecord(value) &&
    typeof value.persistedPrompt === 'string' &&
    Array.isArray(value.localImages) &&
    Array.isArray(value.remoteImages) &&
    Array.isArray(value.pendingPastes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
