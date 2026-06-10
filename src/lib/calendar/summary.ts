import type { CalendarEntry } from './types';

export interface CalendarCounts {
  episodes: number;
  movies: number;
  /** Avsnitt med isPremiere — en DELMÄNGD av `episodes`, ingen egen kategori. */
  premieres: number;
  /** Avsnitt med isFinale — också en delmängd av `episodes`. */
  finales: number;
  /** Avsnitt som är BÅDE premiär och final (enavsnittssäsong eller seedat
   *  next_episode_to_air som är E1 = säsongsmax). Behövs för att copy ska
   *  kunna räkna sådana avsnitt i exakt en kategori (K2). */
  premiereFinales: number;
  total: number;
}

/** Räknar händelser per kind + premiär/final. Delas av kalendersidans rubrik,
 *  WeekBoard-kolumnerna och MonthStrip. OBS: premieres/finales överlappar
 *  episodes (delmängder) och kan överlappa varandra — använd premiereFinales
 *  för disjunkt aritmetik i copy. */
export function countEntries(entries: readonly CalendarEntry[]): CalendarCounts {
  let episodes = 0;
  let movies = 0;
  let premieres = 0;
  let finales = 0;
  let premiereFinales = 0;
  for (const e of entries) {
    if (e.kind === 'movie') {
      movies++;
    } else {
      episodes++;
      if (e.isPremiere) premieres++;
      if (e.isFinale) finales++;
      if (e.isPremiere && e.isFinale) premiereFinales++;
    }
  }
  return { episodes, movies, premieres, finales, premiereFinales, total: entries.length };
}

/** Kompakt etikett, t.ex. "3 avsnitt", "1 film", "2 avsnitt · 1 film".
 *  Tom lista → "—". */
export function summarizeCounts(entries: readonly CalendarEntry[]): string {
  const { episodes, movies } = countEntries(entries);
  if (episodes === 0 && movies === 0) return '—';
  const parts: string[] = [];
  if (episodes > 0) parts.push(`${episodes} avsnitt`); // "avsnitt" är invariant sing/plur
  if (movies > 0) parts.push(`${movies} ${movies === 1 ? 'film' : 'filmer'}`);
  return parts.join(' · ');
}
