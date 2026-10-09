// src/components/title/RatingsRow.tsx
import type { Ratings } from '@/lib/ratings/types';
import { cardClass } from '@/components/ui/Card';
import { eyebrowClass } from '@/components/ui/Eyebrow';
import { formatDecimal } from '@/lib/formatDecimal';

// External + TMDB ratings as polished per-source cards: source label + saffron
// value + muted scale. The IMDb card links to IMDb. Returns null when there is
// no TMDB score and no external ratings.
export function RatingsRow({
  ratings,
  imdbId,
  tmdb,
}: {
  ratings: Ratings | null;
  imdbId: string;
  tmdb?: number | null;
}) {
  const hasTmdb = tmdb != null && tmdb > 0;
  const hasExternal =
    !!ratings && (!!ratings.imdb || ratings.rottenTomatoes != null || ratings.metacritic != null);
  if (!hasTmdb && !hasExternal) return null;

  const card = cardClass('flex flex-col gap-0.5 px-3 py-1.5 min-w-[78px]');
  const src = eyebrowClass({ size: 'xs' });
  const val = 'text-xl font-medium text-acc-deep leading-none';
  const scale = 'text-sm font-normal text-ink-3';

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {hasTmdb && (
        <div className={card}>
          <span className={src}>TMDB</span>
          <span className={val}>{formatDecimal(tmdb!)}<span className={scale}> /10</span></span>
        </div>
      )}
      {ratings?.imdb && (
        imdbId ? (
          <a
            href={`https://www.imdb.com/title/${imdbId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={card}
            style={{ textDecoration: 'none' }}
            aria-label={`IMDb-betyg ${formatDecimal(ratings.imdb.score)} av 10, öppnas på IMDb`}
          >
            <span className={src}>IMDb</span>
            <span className={val}>{formatDecimal(ratings.imdb.score)}<span className={scale}> /10</span></span>
          </a>
        ) : (
          <div className={card}>
            <span className={src}>IMDb</span>
            <span className={val}>{formatDecimal(ratings.imdb.score)}<span className={scale}> /10</span></span>
          </div>
        )
      )}
      {ratings?.rottenTomatoes != null && (
        <div className={card}>
          <span className={src}>Rotten<span className="sr-only"> Tomatoes</span></span>
          <span className={val}>{ratings.rottenTomatoes}<span className={scale}>%</span></span>
        </div>
      )}
      {ratings?.metacritic != null && (
        <div className={card}>
          <span className={src}>Metacritic</span>
          <span className={val}>{ratings.metacritic}<span className={scale}> /100</span></span>
        </div>
      )}
    </div>
  );
}
