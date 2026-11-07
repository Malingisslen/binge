/**
 * BIN-1498 — export av biblioteket till Letterboxd (CSV) och Trakt (JSON).
 *
 * Ren byggning av filinnehåll (ingen DOM/Firebase) så den är testbar. Allt
 * byggs i klienten av användarens egna titlar; inget lämnar enheten.
 * Letterboxd är film-only, så serier utelämnas där. Betyg lagras 0.5–5 i
 * Binge: Letterboxd använder samma skala, Trakt 1–10 (×2).
 */

import type { WatchlistItem } from '@/types';

type ExportItem = Pick<WatchlistItem, 'tmdbId' | 'mediaType' | 'status' | 'rating' | 'title' | 'releaseYear'>;

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  // Kalkylblad kör en cell som börjar med dessa tecken som formel; titlar kommer från TMDB.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Letterboxd-import läser kolumnerna tmdbID, Title, Year och Rating. */
export function buildLetterboxdCsv(items: readonly ExportItem[], list: 'watched' | 'watchlist'): string {
  const wanted = list === 'watched' ? 'sedd' : 'vill_se';
  const header = list === 'watched' ? ['tmdbID', 'Title', 'Year', 'Rating'] : ['tmdbID', 'Title', 'Year'];
  const lines = [header.join(',')];
  for (const it of items) {
    if (it.mediaType !== 'movie' || it.status !== wanted) continue;
    const cells: (string | number | null)[] = [it.tmdbId, it.title, it.releaseYear];
    if (list === 'watched') cells.push(it.rating);
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

interface TraktRef { ids: { tmdb: number }; rating?: number }
interface TraktGroup { movies: TraktRef[]; shows: TraktRef[] }
export interface TraktExport { history: TraktGroup; ratings: TraktGroup; watchlist: TraktGroup }

const emptyGroup = (): TraktGroup => ({ movies: [], shows: [] });

/**
 * Tre grupper i samma form som Trakts sync-API (/sync/history, /sync/ratings,
 * /sync/watchlist tar `{ movies: [...], shows: [...] }` med ids.tmdb). Serier
 * går aldrig till history: Trakt skulle markera alla avsnitt som sedda, och
 * Binge lagrar ingen "sedd"-status på serier.
 */
export function buildTraktExport(items: readonly ExportItem[]): TraktExport {
  const out: TraktExport = { history: emptyGroup(), ratings: emptyGroup(), watchlist: emptyGroup() };
  for (const it of items) {
    if (it.mediaType !== 'movie' && it.mediaType !== 'tv') continue;
    const key = it.mediaType === 'movie' ? 'movies' : 'shows';
    const ref: TraktRef = { ids: { tmdb: it.tmdbId } };
    if (it.status === 'vill_se') out.watchlist[key].push(ref);
    if (it.status === 'sedd' && it.mediaType === 'movie') out.history.movies.push(ref);
    if (it.rating != null && it.rating >= 0.5 && it.rating <= 5) {
      out.ratings[key].push({ ...ref, rating: Math.round(it.rating * 2) });
    }
  }
  return out;
}
