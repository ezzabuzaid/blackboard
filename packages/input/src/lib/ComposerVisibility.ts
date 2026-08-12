import type { ComposerVisibility } from './ComposerTypes';

export function isVisibleInPhase(
  visibility: ComposerVisibility | undefined,
  hasInteracted: boolean,
) {
  if (visibility === 'hidden') {
    return false;
  }
  if (visibility === 'before-interaction') {
    return !hasInteracted;
  }
  if (visibility === 'after-interaction') {
    return hasInteracted;
  }
  return true;
}
