// BIN-187 — "Samla klart": a completion meter over a bounded set of titles
// (here, the films a person directed). Pure derivation over the watchlist — no
// new write paths. The meter UI lives on the person page; this is the testable
// core. An unclosed "7 av 9" bar is the pull that nudges logging the last few.
//
// Scope decision: the meter counts films the person *directed* (TMDB crew job
// "Director", media_type "movie"), with "seen" = the film is in the library as
// 'sedd'. Films have a clean terminal watched state; TV has no 'sedd' (its life
// lives under 'mina' with a derived sub-state), so TV-creator completion is a
// separate, messier follow-up and is deliberately left out here.

export interface CompletionMeter {
  seen: number;
  total: number;
  pct: number; // 0–100, rounded
}

export function filmographyCompletion(
  titleIds: readonly number[],
  isSeen: (tmdbId: number) => boolean,
): CompletionMeter {
  // Dedupe — a director can appear on the same film under multiple credits.
  const unique = Array.from(new Set(titleIds));
  const total = unique.length;
  const seen = unique.filter(isSeen).length;
  const pct = total > 0 ? Math.round((seen / total) * 100) : 0;
  return { seen, total, pct };
}
