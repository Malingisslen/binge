import type { CalendarEntry } from './types';

export interface CalendarCounts {
  episodes: number;
  movies: number;
  premieres: number;
  finales: number;
  total: number;
}

/** Räknar händelser per kind + premiär/final. Delas av kalendersidans rubrik,
 *  WeekBoard-kolumnerna och MonthStrip. */
export function countEntries(entries: readonly CalendarEntry[]): CalendarCounts {
  let episodes = 0;
  let movies = 0;
  let premieres = 0;
  let finales = 0;
  for (const e of entries) {
    if (e.kind === 'movie') {
      movies++;
    } else {
      episodes++;
      if (e.isPremiere) premieres++;
      if (e.isFinale) finales++;
    }
  }
  return { episodes, movies, premieres, finales, total: entries.length };
}

/** Kompakt etikett, t.ex. "3 avsnitt", "1 film", "2 avsnitt · 1 film".
 *  Tom lista → "—". */
export function summarizeCounts(entries: readonly CalendarEntry[]): string {
  const { episodes, movies } = countEntries(entries);
  if (episodes === 0 && movies === 0) return '—';
  const parts: string[] = [];
  if (episodes > 0) parts.push(`${episodes} ${episodes === 1 ? 'avsnitt' : 'avsnitt'}`);
  if (movies > 0) parts.push(`${movies} ${movies === 1 ? 'film' : 'filmer'}`);
  return parts.join(' · ');
}
