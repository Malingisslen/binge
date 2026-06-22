/**
 * BIN-69 — CSV-import från andra trackers.
 *
 * Ren parsing (ingen Firestore/TMDB här — testbar isolerat). Tar rå CSV-text,
 * detekterar format via header-raden och normaliserar till ImportRow[]. TMDB-
 * matchning + skrivning sker separat, bakom en obligatorisk dry-run.
 *
 * Format som stöds: Letterboxd (watchlist/watched/ratings-exporter) och IMDb
 * (export av betyg/listor). Trakt har ingen inbyggd CSV-export (API/JSON, eller
 * via tredjeparts-verktyg) — lämnas till en framtida JSON-importör. Okänt
 * format → tomt resultat med en orsak, så UI:t kan visa "känner inte igen filen".
 */

export type ImportFormat = 'letterboxd' | 'imdb' | 'unknown';

export interface ImportRow {
  /** Råttitel som den stod i filen (för att visa i dry-run + TMDB-sökning). */
  title: string;
  year: number | null;
  /** Betyg normaliserat till Binge-skalan 1–10 (null om inget). */
  rating: number | null;
  /** IMDb-id (tt…) om filen hade det — ger exakt matchning utan fuzzy-sök. */
  imdbId: string | null;
  /** 'movie' | 'tv' om filen anger det, annars null (matcharen får gissa). */
  mediaTypeHint: 'movie' | 'tv' | null;
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

function parseLetterboxdRow(header: string[], row: string[]): ImportRow | null {
  const title = col(header, row, 'Name');
  if (!title) return null;
  // Letterboxd-betyg är 0.5–5.0 stjärnor → Binge 1–10 (×2).
  const ratingRaw = col(header, row, 'Rating');
  const stars = ratingRaw ? parseFloat(ratingRaw) : NaN;
  const rating = Number.isFinite(stars) ? Math.round(stars * 2) : null;
  return {
    title,
    year: toYear(col(header, row, 'Year')),
    rating: rating && rating >= 1 && rating <= 10 ? rating : null,
    imdbId: null,
    mediaTypeHint: null, // Letterboxd är film-only.
  };
}

function parseImdbRow(header: string[], row: string[]): ImportRow | null {
  const title = col(header, row, 'Title') || col(header, row, 'Original Title');
  if (!title) return null;
  // IMDb 'Your Rating' är redan 1–10.
  const ratingRaw = col(header, row, 'Your Rating');
  const r = ratingRaw ? parseInt(ratingRaw, 10) : NaN;
  const titleType = (col(header, row, 'Title Type') ?? '').toLowerCase();
  const isTv = titleType.includes('series') || titleType.includes('tv');
  const constId = col(header, row, 'Const') ?? '';
  return {
    title,
    year: toYear(col(header, row, 'Year')),
    rating: Number.isFinite(r) && r >= 1 && r <= 10 ? r : null,
    imdbId: constId.startsWith('tt') ? constId : null,
    mediaTypeHint: isTv ? 'tv' : 'movie',
  };
}

export function parseWatchlistCsv(text: string): ParseResult {
  const lines = splitLines(text);
  if (lines.length < 2) return { format: 'unknown', rows: [], skipped: 0 };

  const header = parseCsvLine(lines[0]);
  const format = detectFormat(header);
  if (format === 'unknown') return { format, rows: [], skipped: 0 };

  const rows: ImportRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const parsed = format === 'imdb' ? parseImdbRow(header, cells) : parseLetterboxdRow(header, cells);
    if (parsed) rows.push(parsed);
    else skipped++;
  }
  return { format, rows, skipped };
}
