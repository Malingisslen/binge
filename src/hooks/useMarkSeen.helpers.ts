import type { WatchStatus } from '@/types';

/**
 * Gate for the "rate right now" prompt. We nudge a rating only on the
 * seen-transition AND only when the title has no rating yet — re-marking an
 * already-rated title as seen must never nag. The seen-transition is the
 * 'sedd' menu choice for both film (terminal) and TV ("alla avsnitt sedda",
 * which is stored as 'mina' downstream — the menu value is still 'sedd').
 */
export function shouldPromptRating(status: WatchStatus, currentRating: number | null): boolean {
  return currentRating == null && status === 'sedd';
}
