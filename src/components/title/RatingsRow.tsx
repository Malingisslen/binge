// src/components/title/RatingsRow.tsx
import type { Ratings } from '@/lib/ratings/types';

export function RatingsRow({ ratings, imdbId }: { ratings: Ratings | null; imdbId: string }) {
  if (!ratings || (!ratings.imdb && ratings.rottenTomatoes == null && ratings.metacritic == null)) {
    return null;
  }
  return (
    <>
      {ratings.imdb && (
        <span>
          <span className="k">imdb-betyg</span>
          <strong>{ratings.imdb.score.toFixed(1)} / 10</strong>
        </span>
      )}
      {ratings.rottenTomatoes != null && (
        <span>
          <span className="k">rotten</span>
          <strong>{ratings.rottenTomatoes}%</strong>
        </span>
      )}
      {ratings.metacritic != null && (
        <span>
          <span className="k">metacritic</span>
          <strong>{ratings.metacritic}</strong>
        </span>
      )}
    </>
  );
}
