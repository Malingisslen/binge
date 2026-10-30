// Pure helpers för "Nytt för dig"-vyn: serier du följer men inte är ikapp på, plus filmer du vill se.
// Allt härleds ur redan inläst data (watchlist, avsnittsmarkeringar, Streamingrådgivarens
// behind-set, kalenderposter). Kalendern och rådgivaren delar TMDB-cache med startsidan.

import { librarySubState } from '@/lib/libraryView';
import { compareTitles } from '@/lib/titleSort';
import type { WatchlistItem } from '@/types';

export type ToWatchGroup = 'nya' | 'efter' | 'ej_paborjad' | 'film';

export const TO_WATCH_GROUP_ORDER: ToWatchGroup[] = ['nya', 'efter', 'ej_paborjad', 'film'];

export const TO_WATCH_GROUP_LABELS: Record<ToWatchGroup, string> = {
  nya: 'Nya avsnitt väntar',
  efter: 'Ligger efter',
  ej_paborjad: 'Ej påbörjade',
  film: 'Filmer att se',
};

/** An episode counts as new for this long after it aired. */
export const NEW_EPISODE_DAYS = 14;

export interface ToWatchRow {
  item: WatchlistItem;
  group: ToWatchGroup;
  /** When an episode was last marked seen; null for films and series not started. */
  seenAt: Date | null;
  /** yyyy-mm-dd of the latest aired episode, when the calendar knows it. */
  newestAirDate: string | null;
}

function daysBetween(airDate: string, now: Date): number {
  // Rounded so the autumn clock change (a 25-hour day) does not push 14 days to 14.04.
  return Math.round((now.getTime() - new Date(`${airDate}T00:00:00`).getTime()) / 86_400_000);
}

/**
 * Which group a title belongs to, or null when it does not belong in the view.
 * A series started but not provably behind (librarySubState 'paborjad') is left out:
 * the library never claims "ligger efter" without aired-episode data.
 */
export function toWatchGroup(
  item: WatchlistItem,
  ctx: { behindIds: ReadonlySet<number>; newestAirDate: string | null; now: Date },
): ToWatchGroup | null {
  if (item.dropped) return null;
  if (item.mediaType === 'movie') return item.status === 'vill_se' ? 'film' : null;
  if (item.status !== 'mina') return null;
  const sub = librarySubState(item, ctx.behindIds.has(item.tmdbId));
  if (sub === 'ej_paborjad') return 'ej_paborjad';
  if (sub !== 'ligger_efter') return null;
  const fresh = ctx.newestAirDate != null && daysBetween(ctx.newestAirDate, ctx.now) <= NEW_EPISODE_DAYS;
  return fresh ? 'nya' : 'efter';
}

/** Latest watchedAt per show, from the flat episode list the diary already reads. */
export function lastSeenByShow(episodes: readonly { tmdbId: number; watchedAt: Date }[]): Map<number, Date> {
  const out = new Map<number, Date>();
  for (const e of episodes) {
    const cur = out.get(e.tmdbId);
    if (!cur || e.watchedAt > cur) out.set(e.tmdbId, e.watchedAt);
  }
  return out;
}

/** Latest air date (yyyy-mm-dd) of an already aired episode per show, from calendar entries. */
export function newestAiredDateByShow(
  entries: readonly { kind: string; tmdbId: number; airDate: string }[],
  now: Date,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of entries) {
    if (e.kind !== 'episode' || new Date(`${e.airDate}T00:00:00`) > now) continue;
    const cur = out.get(e.tmdbId);
    if (!cur || e.airDate > cur) out.set(e.tmdbId, e.airDate);
  }
  return out;
}

export function buildToWatchRows(
  items: readonly WatchlistItem[],
  ctx: {
    behindIds: ReadonlySet<number>;
    lastSeen: ReadonlyMap<number, Date>;
    newestAired: ReadonlyMap<number, string>;
    now: Date;
  },
): ToWatchRow[] {
  const rows: ToWatchRow[] = [];
  for (const item of items) {
    const newestAirDate = item.mediaType === 'tv' ? ctx.newestAired.get(item.tmdbId) ?? null : null;
    const group = toWatchGroup(item, { behindIds: ctx.behindIds, newestAirDate, now: ctx.now });
    if (!group) continue;
    rows.push({
      item,
      group,
      seenAt: item.mediaType === 'tv' ? ctx.lastSeen.get(item.tmdbId) ?? null : null,
      newestAirDate,
    });
  }
  return rows;
}

export type ToWatchSortKey = 'seen' | 'newest' | 'runtime' | 'added' | 'title';

export const TO_WATCH_SORT_LABELS: Record<ToWatchSortKey, string> = {
  seen: 'Senast sett',
  newest: 'Senaste nya avsnitt',
  runtime: 'Kortast först',
  added: 'Tillagd',
  title: 'Titel',
};

// Rows missing the sorted value always go last, whichever way the value itself runs.
function byOptional(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir * (a - b);
}

export function compareToWatchRows(key: ToWatchSortKey): (a: ToWatchRow, b: ToWatchRow) => number {
  const cmp = (a: ToWatchRow, b: ToWatchRow): number => {
    switch (key) {
      case 'seen': return byOptional(a.seenAt?.getTime() ?? null, b.seenAt?.getTime() ?? null, -1);
      case 'newest': return byOptional(
        a.newestAirDate ? Date.parse(a.newestAirDate) : null,
        b.newestAirDate ? Date.parse(b.newestAirDate) : null,
        -1,
      );
      case 'runtime': return byOptional(a.item.runtime ?? null, b.item.runtime ?? null, 1);
      case 'added': return b.item.addedAt.getTime() - a.item.addedAt.getTime();
      case 'title': return compareTitles(a.item.title, b.item.title);
    }
  };
  return (a, b) => cmp(a, b) || compareTitles(a.item.title, b.item.title);
}
