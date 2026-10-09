import type { TMDBSearchResult } from '@/types';

/** Hur många personer sökningen visar. */
export const MAX_PEOPLE_SHOWN = 3;

/**
 * Personträffarna i en /search/multi-svarslista, mest kända först. TMDB har ofta
 * flera personer med samma namn; en person utan bild och utan känd yrkesroll är
 * nästan alltid en namne ingen letar efter, så de sorteras bort.
 */
export function rankPeople(results: readonly TMDBSearchResult[]): TMDBSearchResult[] {
  return results
    .filter(r => r.media_type === 'person' && (r.profile_path || r.known_for_department))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, MAX_PEOPLE_SHOWN);
}

export function departmentLabel(dept: string | undefined): string {
  if (dept === 'Acting') return 'Skådespelare';
  if (dept === 'Directing') return 'Regissör';
  if (dept === 'Writing') return 'Manusförfattare';
  return 'Person';
}
