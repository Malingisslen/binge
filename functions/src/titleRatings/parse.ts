import type { Ratings } from './types';

const NA = (v: unknown): v is 'N/A' => v === 'N/A';

function num(v: unknown): number | null {
  if (typeof v !== 'string' || NA(v)) return null;
  const n = Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "91%" -> 91, "82/100" -> 82, "8.4/10" -> 8.4 */
function fromRating(value: string): number | null {
  const pct = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return Number(pct[1]);
  const frac = value.match(/^(\d+(?:\.\d+)?)\/\d+$/);
  if (frac) return Number(frac[1]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseOmdbRatings(json: unknown): Ratings {
  const empty: Ratings = { imdb: null, rottenTomatoes: null, metacritic: null };
  if (!json || typeof json !== 'object') return empty;
  const o = json as Record<string, unknown>;
  if (o.Response !== 'True') return empty;

  const score = num(o.imdbRating);
  const votes = num(o.imdbVotes);
  const imdb = score != null ? { score, votes: votes ?? 0 } : null;

  let rottenTomatoes: number | null = null;
  let metacritic: number | null = num(o.Metascore);
  if (Array.isArray(o.Ratings)) {
    for (const r of o.Ratings as { Source?: string; Value?: string }[]) {
      if (r.Source === 'Rotten Tomatoes' && typeof r.Value === 'string') rottenTomatoes = fromRating(r.Value);
      if (r.Source === 'Metacritic' && typeof r.Value === 'string' && metacritic == null) metacritic = fromRating(r.Value);
    }
  }
  return { imdb, rottenTomatoes, metacritic };
}

export function isFresh(checkedAt: number, nowMs: number, ttlDays: number): boolean {
  return nowMs - checkedAt < ttlDays * 86_400_000;
}
