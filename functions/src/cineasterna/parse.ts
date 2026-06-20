import type { CineasternaTitle } from './types';

const IMDB_RE = /^tt\d{6,}$/;

export function parseTitles(json: unknown): CineasternaTitle[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as { success?: unknown; titles?: unknown };
  if (o.success !== true || !Array.isArray(o.titles)) return [];
  const out: CineasternaTitle[] = [];
  for (const t of o.titles as Record<string, unknown>[]) {
    const imdbId = typeof t.imdb_id === 'string' ? t.imdb_id : '';
    if (!IMDB_RE.test(imdbId)) continue;
    const amount = t.rental_price_amount;
    out.push({
      imdbId,
      name: typeof t.name === 'string' ? t.name : '',
      rentable: t.is_rentable === true,
      rentalAmount: typeof amount === 'number' ? amount : null,
      rentalCurrency: typeof t.rental_price_currency === 'string' ? t.rental_price_currency : null,
    });
  }
  return out;
}

export function dedupeByImdb(titles: CineasternaTitle[]): CineasternaTitle[] {
  const seen = new Map<string, CineasternaTitle>();
  for (const t of titles) if (!seen.has(t.imdbId)) seen.set(t.imdbId, t);
  return [...seen.values()];
}

/** True = suspected scraper rot; caller must refuse to overwrite the catalog. */
export function detectRot(prevCount: number, newCount: number): boolean {
  if (prevCount <= 0) return false;        // first run / no baseline
  if (newCount === 0) return true;
  return newCount < prevCount * 0.5;       // >50% drop is implausible
}
