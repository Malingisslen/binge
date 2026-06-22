// src/components/title/RatingsRow.tsx
import type { Ratings } from '@/lib/ratings/types';

// External ratings as polished per-source cards: source label + saffron value
// + muted scale. The IMDb card links to IMDb (so the page can drop its separate
// "öppna" link). Returns null when there are no external ratings.
export function RatingsRow({ ratings, imdbId }: { ratings: Ratings | null; imdbId: string }) {
  if (!ratings || (!ratings.imdb && ratings.rottenTomatoes == null && ratings.metacritic == null)) {
    return null;
  }
  const card = 'flex flex-col gap-0.5 rounded border border-rule bg-surface px-3 py-1.5 min-w-[78px]';
  const src = 'text-[11px] uppercase tracking-wide text-ink-3';
  const val = 'text-[17px] font-medium text-acc-deep leading-none';
  const scale = 'text-[12px] font-normal text-ink-3';
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {ratings.imdb && (
        imdbId ? (
          <a
            href={`https://www.imdb.com/title/${imdbId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={card}
            style={{ textDecoration: 'none' }}
          >
            <span className={src}>IMDb</span>
            <span className={val}>{ratings.imdb.score.toFixed(1)}<span className={scale}> /10</span></span>
          </a>
        ) : (
          <div className={card}>
            <span className={src}>IMDb</span>
            <span className={val}>{ratings.imdb.score.toFixed(1)}<span className={scale}> /10</span></span>
          </div>
        )
      )}
      {ratings.rottenTomatoes != null && (
        <div className={card}>
          <span className={src}>Rotten</span>
          <span className={val}>{ratings.rottenTomatoes}<span className={scale}>%</span></span>
        </div>
      )}
      {ratings.metacritic != null && (
        <div className={card}>
          <span className={src}>Metacritic</span>
          <span className={val}>{ratings.metacritic}<span className={scale}> /100</span></span>
        </div>
      )}
    </div>
  );
}
