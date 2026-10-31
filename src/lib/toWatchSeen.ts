import type { ToWatchRow } from '@/lib/toWatch';

/** One title in "Nytt för dig", identified the same way wherever the counter is shown. */
export function toWatchSeenKey(row: Pick<ToWatchRow, 'item'>): string {
  return `${row.item.mediaType}:${row.item.tmdbId}`;
}

/** The counter works like an inbox: only titles Malin has not yet seen on the page count. */
export function countUnseen(rows: readonly Pick<ToWatchRow, 'item'>[], seen: ReadonlySet<string>): number {
  return rows.filter(r => !seen.has(toWatchSeenKey(r))).length;
}

export function parseSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}
