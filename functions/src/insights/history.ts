/**
 * Pure helpers for the dated `insights/{YYYY-MM-DD}` history the dashboard draws as
 * curves. No firebase imports so the root vitest toolchain runs the tests.
 *
 * Only the aggregate totals leave the function (#5's condition, plan 2026-10-28):
 * `toHistoryPoint` copies named fields and nothing else, so a field added to the
 * rollup later never reaches the API by accident.
 */
import type { HistoryPoint } from './types';

/** Never read more than this many dated docs per request. */
export const HISTORY_READ_LIMIT = 90;

const DATED = /^\d{4}-\d{2}-\d{2}$/;

/** The dated doc ids inside [from, to], oldest first, capped at the newest HISTORY_READ_LIMIT. */
export function historyIds(ids: readonly string[], from: string, to: string): string[] {
  const dated = ids.filter((id) => DATED.test(id) && id >= from && id <= to).sort();
  return dated.slice(Math.max(0, dated.length - HISTORY_READ_LIMIT));
}

/** One curve point from a rollup doc. Unknown or malformed fields are dropped, never passed on. */
export function toHistoryPoint(date: string, doc: unknown): HistoryPoint | null {
  if (!doc || typeof doc !== 'object') return null;
  const totals = (doc as { totals?: unknown }).totals;
  if (!totals || typeof totals !== 'object') return null;
  const t = totals as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const users = num(t.users);
  const titlesTracked = num(t.titlesTracked);
  const reviews = num(t.reviews);
  if (users === null || titlesTracked === null || reviews === null) return null;
  const point: HistoryPoint = { date, users, titlesTracked, reviews };
  const active = (doc as { activeUsers?: unknown }).activeUsers;
  if (active && typeof active === 'object') {
    const a = active as Record<string, unknown>;
    const d7 = num(a.d7);
    const d30 = num(a.d30);
    if (d7 !== null) point.activeUsers7d = d7;
    if (d30 !== null) point.activeUsers30d = d30;
  }
  return point;
}
