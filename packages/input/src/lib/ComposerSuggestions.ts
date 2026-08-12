import { slashCommandMatches } from './ComposerSlashCommands';
import { itemToken } from './ComposerTriggers';
import type {
  ActivePopup,
  ComposerItemEntry,
  ComposerSuggestion,
} from './ComposerTypes';
import { isVisibleInPhase } from './ComposerVisibility';

export function popupSuggestionMatches(
  popup: ActivePopup,
  slashCommands: ComposerItemEntry[],
  mentionCandidates: ComposerItemEntry[],
  hasInteracted: boolean,
): ComposerSuggestion[] {
  return [
    ...slashCommandMatches(
      popup.query,
      slashCommands.filter((command) => command.trigger === popup.trigger),
      hasInteracted,
    ),
    ...candidateMatches(
      popup.query,
      mentionCandidates.filter(
        (candidate) => candidate.trigger === popup.trigger,
      ),
      hasInteracted,
    ),
  ];
}

function candidateMatches(
  query: string,
  mentionCandidates: ComposerItemEntry[],
  hasInteracted: boolean,
) {
  const normalized = query.slice(1).toLowerCase();
  return mentionCandidates
    .filter(
      (candidate) =>
        isVisibleInPhase(candidate.visibility, hasInteracted) &&
        (candidate.label.toLowerCase().includes(normalized) ||
          itemToken(candidate).slice(1).toLowerCase().includes(normalized)),
    )
    .slice(0, 10);
}
