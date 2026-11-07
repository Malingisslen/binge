/**
 * BIN-69 — CSV-import från andra trackers.
 *
 * Ren parsing (ingen Firestore/TMDB här — testbar isolerat). Tar rå CSV-text,
 * detekterar format via header-raden och normaliserar till ImportRow[]. TMDB-
 * matchning + skrivning sker separat, bakom en obligatorisk dry-run.
 *
 * Format som stöds: Letterboxd (watchlist/watched/ratings-exporter), IMDb
 * (export av betyg/listor) och Trakt (JSON-filerna ur Trakts "Export data":
 * watched-*, ratings-*, watchlist-*). Okänt format → tomt resultat med en orsak,
 * så UI:t kan visa "känner inte igen filen".
 */

export type ImportFormat = 'letterboxd' | 'imdb' | 'trakt' | 'unknown';

export interface ImportRow {
  /** Råttitel som den stod i filen (för att visa i dry-run + TMDB-sökning). */
  title: string;
  year: number | null;
  /** Betyg på Binge-skalan 0.5–5 (halvsteg; visas ×2 → /10). null om inget. */
  rating: number | null;
  /** IMDb-id (tt…) om filen hade det — ger exakt matchning utan fuzzy-sök. */
  imdbId: string | null;
  /** 'movie' | 'tv' om filen anger det, annars null (matcharen får gissa). */
  mediaTypeHint: 'movie' | 'tv' | null;
  /** True när filen säger att titeln är sedd utan att ge betyg (Trakt watched/history). */
  watched?: boolean;
}

export interface ParseResult {
  format: ImportFormat;
  rows: ImportRow[];
  /** Rader som inte gick att tolka (saknar titel) — visas som "hoppade över". */
  skipped: number;
}

/**
 * Tokeniserar EN CSV-rad enligt RFC-4180: dubbelciterade fält kan innehålla
 * kommatecken och escapade citattecken (""). Hanterar inte radbrytningar inuti
 * fält (sällsynt i tracker-exporter; en sådan rad hamnar som skipped).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field); field = '';
    } else field += c;
  }
  out.push(field);
  return out.map(f => f.trim());
}

// Id:t hamnar i en TMDB-URL-sökväg: släpp inte igenom något annat än tt + siffror.
const IMDB_ID = /^tt\d{1,10}$/;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.length > 0);
}

function detectFormat(header: string[]): ImportFormat {
  const lower = header.map(h => h.toLowerCase());
  // IMDb-export har en 'Const'-kolumn (ttXXXX) + 'Title Type'.
  if (lower.includes('const') && lower.includes('title')) return 'imdb';
  // Letterboxd har 'Name' + 'Letterboxd URI' (och alltid 'Year').
  if (lower.includes('name') && lower.some(h => h.includes('letterboxd'))) return 'letterboxd';
  // Letterboxd-ratings utan URI-kolumn men med Name+Year+Rating.
  if (lower.includes('name') && lower.includes('year')) return 'letterboxd';
  return 'unknown';
}

function toYear(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.slice(0, 4), 10);
  return Number.isFinite(n) && n > 1870 && n < 2200 ? n : null;
}

function col(header: string[], row: string[], name: string): string | undefined {
  const idx = header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  return idx >= 0 ? row[idx] : undefined;
}

function parseLetterboxdRow(header: string[], row: string[], watched: boolean): ImportRow | null {
  const title = col(header, row, 'Name');
  if (!title) return null;
  // Letterboxd-betyg är 0.5–5.0 stjärnor — SAMMA skala som Binge lagrar
  // (RatingStars 0.5–5, ×2 → /10 vid visning). Lagra som-är, INGEN ×2.
  const ratingRaw = col(header, row, 'Rating');
  const stars = ratingRaw ? parseFloat(ratingRaw) : NaN;
  return {
    title,
    year: toYear(col(header, row, 'Year')),
    rating: Number.isFinite(stars) && stars >= 0.5 && stars <= 5 ? stars : null,
    imdbId: null,
    mediaTypeHint: null, // Letterboxd är film-only.
    watched,
  };
}

function parseImdbRow(header: string[], row: string[]): ImportRow | null {
  const title = col(header, row, 'Title') || col(header, row, 'Original Title');
  if (!title) return null;
  // IMDb 'Your Rating' är 1–10 → Binge lagrar 0.5–5 (÷2), visas sen ×2 → /10.
  const ratingRaw = col(header, row, 'Your Rating');
  const r = ratingRaw ? parseInt(ratingRaw, 10) : NaN;
  const rating = Number.isFinite(r) && r >= 1 && r <= 10 ? r / 2 : null;
  const titleType = (col(header, row, 'Title Type') ?? '').toLowerCase();
  const isTv = titleType.includes('series') || titleType.includes('tv');
  const constId = col(header, row, 'Const') ?? '';
  return {
    title,
    year: toYear(col(header, row, 'Year')),
    rating,
    imdbId: IMDB_ID.test(constId) ? constId : null,
    mediaTypeHint: isTv ? 'tv' : 'movie',
  };
}

interface TraktMedia { title?: unknown; year?: unknown; ids?: { imdb?: unknown } }
interface TraktEntry {
  movie?: TraktMedia; show?: TraktMedia; episode?: unknown; season?: unknown; type?: unknown;
  rating?: unknown; watched_at?: unknown; last_watched_at?: unknown; plays?: unknown;
}

function parseTraktEntry(e: TraktEntry): ImportRow | null {
  // Avsnitts- och säsongsposter bär också ett `show`; deras betyg gäller inte hela serien.
  if (e.episode || e.season || e.type === 'episode' || e.type === 'season') return null;
  const media = e.movie ?? e.show;
  if (!media || typeof media.title !== 'string' || !media.title.trim()) return null;
  // Trakt-betyg är 1–10 heltal → Binge lagrar 0.5–5 (÷2), samma regel som IMDb.
  const r = typeof e.rating === 'number' ? e.rating : NaN;
  const imdb = media.ids?.imdb;
  return {
    title: media.title.trim(),
    year: toYear(typeof media.year === 'number' ? String(media.year) : undefined),
    rating: Number.isInteger(r) && r >= 1 && r <= 10 ? r / 2 : null,
    imdbId: typeof imdb === 'string' && IMDB_ID.test(imdb) ? imdb : null,
    mediaTypeHint: e.movie ? 'movie' : 'tv',
    watched: !!(e.watched_at || e.last_watched_at || (typeof e.plays === 'number' && e.plays > 0)),
  };
}

function parseTraktJson(text: string): ParseResult | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const entries = data.filter((e): e is TraktEntry => !!e && typeof e === 'object');
  // Bara filer vars poster pekar på movie/show är Trakt; en annan JSON-array → okänd.
  if (!entries.some(e => e.movie || e.show)) return null;
  const rows: ImportRow[] = [];
  let skipped = 0;
  for (const e of entries) {
    const row = parseTraktEntry(e);
    if (row) rows.push(row); else skipped++;
  }
  return { format: 'trakt', rows, skipped };
}

function rowKey(r: ImportRow): string {
  return r.imdbId ?? `${r.mediaTypeHint ?? ''}:${r.title.toLowerCase()}:${r.year ?? ''}`;
}

/**
 * Slår ihop rader från flera filer (Trakt delar upp sedda/betyg/watchlist i
 * separata filer): samma titel blir EN rad som behåller betyget och sedd-flaggan.
 */
export function mergeImportRows(rows: ImportRow[]): ImportRow[] {
  const byKey = new Map<string, ImportRow>();
  for (const r of rows) {
    const k = rowKey(r);
    const prev = byKey.get(k);
    byKey.set(k, prev
      ? { ...prev, rating: prev.rating ?? r.rating, watched: !!(prev.watched || r.watched) }
      : r);
  }
  return [...byKey.values()];
}

// Letterboxds watched.csv (och Binges egen sedda-export) saknar betyg och sedd-markering i
// raderna; det är filnamnet som säger att titlarna är sedda. Dagboken har kolumnen Watched Date.
const WATCHED_FILE_NAME = /watched|sedda/i;

export function parseWatchlistCsv(text: string, fileName = ''): ParseResult {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) {
    return parseTraktJson(trimmed) ?? { format: 'unknown', rows: [], skipped: 0 };
  }
  const lines = splitLines(text);
  if (lines.length < 2) return { format: 'unknown', rows: [], skipped: 0 };

  const header = parseCsvLine(lines[0]);
  const format = detectFormat(header);
  if (format === 'unknown') return { format, rows: [], skipped: 0 };

  const watchedFile = WATCHED_FILE_NAME.test(fileName)
    || header.some(h => h.toLowerCase() === 'watched date');
  const rows: ImportRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const parsed = format === 'imdb' ? parseImdbRow(header, cells) : parseLetterboxdRow(header, cells, watchedFile);
    if (parsed) rows.push(parsed);
    else skipped++;
  }
  return { format, rows, skipped };
}
