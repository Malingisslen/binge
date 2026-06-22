// src/components/title/RatingsRow.tsx
import type { Ratings } from '@/lib/ratings/types';

// "Betyg"-strip (design B+C): ratings live on their own surface, set apart from
// the år/längd/tmdb metadata, with the values in saffran (acc) — the
// "decisive info" accent. Returns null when there are no external ratings.
export function RatingsRow({ ratings }: { ratings: Ratings | null; imdbId: string }) {
  if (!ratings || (!ratings.imdb && ratings.rottenTomatoes == null && ratings.metacritic == null)) {
    return null;
  }
  return (
    <div className="mt-2 inline-flex items-center gap-3 rounded bg-bg-2 px-3 py-2 text-[13px]">
      <span className="border-r border-rule pr-3 text-[11px] uppercase tracking-wide text-ink-3">betyg</span>
      {ratings.imdb && (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[11px] text-ink-3">imdb</span>
          <strong className="text-[15px] font-medium text-acc-deep">{ratings.imdb.score.toFixed(1)}</strong>
        </span>
      )}
      {ratings.rottenTomatoes != null && (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[11px] text-ink-3">rotten</span>
          <strong className="text-[15px] font-medium text-acc-deep">{ratings.rottenTomatoes}%</strong>
        </span>
      )}
      {ratings.metacritic != null && (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-[11px] text-ink-3">metacritic</span>
          <strong className="text-[15px] font-medium text-acc-deep">{ratings.metacritic}</strong>
        </span>
      )}
    </div>
  );
}
