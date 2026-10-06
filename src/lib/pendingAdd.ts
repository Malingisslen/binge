/**
 * BIN-1442 — the title a signed-out visitor tapped "Lägg till" on survives the
 * trip through `/login` (and onboarding, for a new account) and lands in the
 * library afterwards, instead of the visitor having to find it again.
 *
 * Carried in `sessionStorage` beside the return path (`nextPath.ts`), for the
 * same reasons: it never travels in a URL, and nothing outside our origin can
 * write it. The value still came from our own page, so it is validated on read
 * like the return path is — a planted value never passed the writer.
 *
 * Single-use and short-lived: a tap the visitor abandoned should not resurface
 * as an add on some later sign-in in the same tab. On a shared computer that later
 * sign-in can be a different person, so the value is also bound to the trip it was
 * made for: the login page drops it on arrival unless the tap was moments ago
 * (`dropStalePendingAdd`). The 30-minute limit then only has to cover the sign-in
 * itself and onboarding. What that does NOT cover: a login form left open in the
 * same tab and used by the next person within the 30 minutes. Same residual as
 * the return path in `nextPath.ts`.
 *
 * Per tab on purpose. A sign-in finished in another tab simply loses the add; do
 * not move this to localStorage, which would widen the shared-computer case.
 */
import type { MediaType } from '@/types';

const KEY = 'binge:pendingAdd';
export const PENDING_ADD_MAX_AGE_MS = 30 * 60 * 1000;
/** How fresh the tap must be when the login page opens for it to count as this trip. */
export const PENDING_ADD_LOGIN_ARRIVAL_MS = 60 * 1000;

export interface PendingAdd {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  providers?: number[];
  subscriptionProviders?: number[];
  genreIds?: number[];
  tmdbStatus?: string | null;
  totalSeasons?: number | null;
}

interface Stored extends PendingAdd {
  savedAt: number;
}

export function rememberPendingAdd(add: PendingAdd, now = Date.now()): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ ...add, savedAt: now })); } catch { /* no-op */ }
}

export function clearPendingAdd(): void {
  try { window.sessionStorage.removeItem(KEY); } catch { /* no-op */ }
}

const POSTER_PATH = /^\/[A-Za-z0-9._-]{1,100}$/;
const inRange = (v: unknown, lo: number, hi: number): boolean =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

const isIntArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length <= 200 && v.every(n => Number.isInteger(n) && n > 0);

/** Exported for its test. */
export function parsePendingAdd(raw: string | null, now: number): PendingAdd | null {
  if (!raw) return null;
  let v: Partial<Stored>;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  if (typeof v.savedAt !== 'number' || now - v.savedAt > PENDING_ADD_MAX_AGE_MS || v.savedAt > now) return null;
  if (!Number.isInteger(v.tmdbId) || (v.tmdbId as number) <= 0) return null;
  if (v.mediaType !== 'tv' && v.mediaType !== 'movie') return null;
  if (typeof v.title !== 'string' || v.title.length === 0 || v.title.length > 300) return null;
  if (v.posterPath !== null && (typeof v.posterPath !== 'string' || !POSTER_PATH.test(v.posterPath))) return null;
  if (v.releaseYear !== null && !inRange(v.releaseYear, 1870, 2200)) return null;
  const add: PendingAdd = {
    tmdbId: v.tmdbId as number,
    mediaType: v.mediaType,
    title: v.title,
    posterPath: v.posterPath ?? null,
    releaseYear: v.releaseYear ?? null,
  };
  if (v.providers !== undefined) { if (!isIntArray(v.providers)) return null; add.providers = v.providers; }
  if (v.subscriptionProviders !== undefined) {
    if (!isIntArray(v.subscriptionProviders)) return null;
    add.subscriptionProviders = v.subscriptionProviders;
  }
  if (v.genreIds !== undefined) { if (!isIntArray(v.genreIds)) return null; add.genreIds = v.genreIds; }
  if (v.tmdbStatus !== undefined && v.tmdbStatus !== null) {
    if (typeof v.tmdbStatus !== 'string' || v.tmdbStatus.length > 50) return null;
    add.tmdbStatus = v.tmdbStatus;
  }
  if (v.totalSeasons !== undefined && v.totalSeasons !== null) {
    if (!inRange(v.totalSeasons, 0, 200)) return null;
    add.totalSeasons = v.totalSeasons;
  }
  return add;
}

/** Read and CONSUME the pending add. */
export function takePendingAdd(now = Date.now()): PendingAdd | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return parsePendingAdd(raw, now);
  } catch {
    return null;
  }
}

/**
 * Called by the login page as it opens. A tap made moments ago is the one that
 * sent this visitor here; anything older was left by an abandoned trip — possibly
 * by someone else on the same computer — and is dropped.
 */
export function dropStalePendingAdd(now = Date.now()): void {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw == null) return;
    const add = parsePendingAdd(raw, now);
    const savedAt = add ? (JSON.parse(raw) as Stored).savedAt : null;
    if (savedAt == null || now - savedAt > PENDING_ADD_LOGIN_ARRIVAL_MS) window.sessionStorage.removeItem(KEY);
  } catch { /* no-op */ }
}
