import type { TMDBSearchResult } from '@/types';
import { isAddableMediaType } from '@/lib/tmdb/client';

// Below this a title is too new or too obscure for a new user to have a view on.
const MIN_VOTES = 50;

// A title with no Latin letters at all (Chinese, Cyrillic ...) cannot be judged
// by the Swedish reader this screen is for.
const LATIN = /\p{Script=Latin}/u;

function isReleased(item: TMDBSearchResult, today: string): boolean {
  const date = item.release_date || item.first_air_date;
  return !!date && date <= today;
}

/** Trending titles a new user could actually have seen and has something to read about. */
export function pickCalibrationCandidates(
  results: readonly TMDBSearchResult[],
  size: number,
  now: Date = new Date(),
): TMDBSearchResult[] {
  const today = now.toISOString().slice(0, 10);
  const seen = new Set<string>();
  return results
    .filter(r =>
      isAddableMediaType(r)
      && r.poster_path
      && (r.genre_ids?.length ?? 0) > 0
      && r.overview?.trim()
      && (r.vote_count ?? 0) >= MIN_VOTES
      && isReleased(r, today)
      && LATIN.test(r.title ?? r.name ?? ''),
    )
    .filter(r => {
      const key = `${r.media_type}-${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, size);
}
