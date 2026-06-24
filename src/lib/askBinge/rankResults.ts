// BIN-176 — final client-side ordering of Fråga Binge results.
//
// Default: a popularity score (rating weighted by log vote count) — the same
// blend used across recommendation rows, so a well-loved title beats an obscure
// one with a fluke-high average.
//
// When the user explicitly asked to rank by rating ("de bästa", "högst betyg" →
// sortBy: 'vote_average.desc'), honor that instead — otherwise the "Högst betyg
// först" chip would promise one thing while the grid showed another. Ties break
// on vote count so a thinly-voted 9.0 can't leapfrog a well-voted 9.0. (The
// discover query already applies a vote_count floor, so single-vote flukes are
// excluded upstream; this is the secondary safeguard.)

import { scorePopularity } from '@/lib/recommendations/rowComposition';
import type { AskSort } from './types';
import type { RowTitle } from '@/types';

export function rankAskResults(items: RowTitle[], sortBy?: AskSort): RowTitle[] {
  const sorted = [...items];
  if (sortBy === 'vote_average.desc') {
    sorted.sort((a, b) => {
      const byRating = (b.vote_average ?? 0) - (a.vote_average ?? 0);
      if (byRating !== 0) return byRating;
      return (b.vote_count ?? 0) - (a.vote_count ?? 0);
    });
  } else {
    sorted.sort((a, b) => scorePopularity(b) - scorePopularity(a));
  }
  return sorted;
}
