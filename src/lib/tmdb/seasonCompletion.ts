// BIN-187 — "Samla klart" (seasons leg): a completion meter over a show's own
// seasons. Sibling to filmographyCompletion (directors) and CollectionSection
// (collections) — same bounded-set "X av Y" pull, here scoped to one series.
//
// A season counts as "seen" when every episode TMDB lists for it is watched
// (watchedCount >= episode_count). Seasons still airing can't reach 100% until
// their last episode airs — which is correct: you haven't *completed* a season
// that isn't fully out yet. Specials (season_number 0) and placeholder seasons
// with no episodes (episode_count 0, e.g. an announced-but-unaired season) are
// excluded from the denominator so the meter never reads a misleading total.

import type { CompletionMeter } from './filmographyCompletion';

export interface SeasonMeterInput {
  season_number: number;
  episode_count: number;
}

export function seasonCompletion(
  seasons: readonly SeasonMeterInput[],
  watchedCount: (seasonNumber: number, episodeCount: number) => number,
): CompletionMeter {
  const real = seasons.filter(s => s.season_number > 0 && s.episode_count > 0);
  const total = real.length;
  const seen = real.filter(s => watchedCount(s.season_number, s.episode_count) >= s.episode_count).length;
  const pct = total > 0 ? Math.round((seen / total) * 100) : 0;
  return { seen, total, pct };
}
