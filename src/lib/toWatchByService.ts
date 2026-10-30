// Pure helpers för "Kvar per tjänst" i Streamingrådgivaren: Nytt för dig-raderna grupperade
// per streamingtjänst, med tid kvar och kostnad. Raderna kommer från toWatch.ts.

import { streamingProvidersOf } from '@/lib/libraryView';
import { canonicalUniqueProviders } from '@/lib/tmdb/providers';
import type { ToWatchRow } from '@/lib/toWatch';
import type { TMDBTVShow, WatchlistItem } from '@/types';

/** Under this many minutes left on a service you pay for, the view suggests cancelling it. */
export const NEARLY_DONE_MINUTES = 120;

/** Column for titles that no Swedish streaming service carries. */
export const NO_SERVICE_ID = 0;

/**
 * Aired episodes the user has not seen, from the show's season list and its last aired episode.
 * Specials (season 0) are not counted. Null when TMDB gives no aired episode to count against.
 */
export function unseenAiredEpisodes(item: WatchlistItem, show: TMDBTVShow): number | null {
  const last = show.last_episode_to_air;
  if (!last || last.season_number < 1) return null;
  const userS = item.lastWatchedSeason ?? 0;
  const userE = item.lastWatchedEpisode ?? 0;
  let unseen = 0;
  for (const season of show.seasons) {
    const s = season.season_number;
    if (s < 1 || s > last.season_number) continue;
    const aired = s === last.season_number ? last.episode_number : season.episode_count;
    const seen = s < userS ? aired : s === userS ? Math.min(userE, aired) : 0;
    unseen += Math.max(0, aired - seen);
  }
  return unseen;
}

/** Minutes left on one row, or null when the episode count or the length is unknown. */
export function minutesLeft(row: ToWatchRow, unseenEpisodes: number | null | undefined): number | null {
  const { item } = row;
  if (!item.runtime) return null;
  if (item.mediaType === 'movie') return item.runtime;
  return unseenEpisodes == null ? null : unseenEpisodes * item.runtime;
}

export interface ServiceColumn {
  /** Canonical provider id, or NO_SERVICE_ID for titles without a streaming service. */
  providerId: number;
  rows: ToWatchRow[];
  isMine: boolean;
  /** Minutes left over the rows whose length is known. */
  minutes: number;
  /** True when some rows have no known length, so `minutes` is a lower bound. */
  minutesPartial: boolean;
  hasNew: boolean;
}

export function groupRowsByService(
  rows: readonly ToWatchRow[],
  ctx: { myProviders: readonly number[]; minutesOf: (row: ToWatchRow) => number | null },
): ServiceColumn[] {
  const columns = new Map<number, ServiceColumn>();
  for (const row of rows) {
    const ids = canonicalUniqueProviders(streamingProvidersOf(row.item));
    const minutes = ctx.minutesOf(row);
    for (const providerId of ids.length > 0 ? ids : [NO_SERVICE_ID]) {
      const col = columns.get(providerId) ?? {
        providerId, rows: [], isMine: ctx.myProviders.includes(providerId), minutes: 0, minutesPartial: false, hasNew: false,
      };
      col.rows.push(row);
      if (minutes == null) col.minutesPartial = true;
      else col.minutes += minutes;
      if (row.group === 'nya') col.hasNew = true;
      columns.set(providerId, col);
    }
  }
  return [...columns.values()];
}

export type ServiceSortKey = 'time' | 'least' | 'cost' | 'name';

export const SERVICE_SORT_LABELS: Record<ServiceSortKey, string> = {
  time: 'Mest tid kvar',
  least: 'Minst tid kvar',
  cost: 'Dyrast per månad',
  name: 'Namn',
};

export function sortServiceColumns(
  columns: readonly ServiceColumn[],
  key: ServiceSortKey,
  info: (providerId: number) => { name: string; monthlyCost: number | null },
): ServiceColumn[] {
  const byName = (a: ServiceColumn, b: ServiceColumn) => info(a.providerId).name.localeCompare(info(b.providerId).name, 'sv');
  const cost = (c: ServiceColumn) => info(c.providerId).monthlyCost ?? 0;
  const cmp = (a: ServiceColumn, b: ServiceColumn): number => {
    switch (key) {
      case 'time': return b.minutes - a.minutes;
      // A column with no known length at all has nothing measured, so it is not the one with least left.
      case 'least': return Number(a.minutesPartial && a.minutes === 0) - Number(b.minutesPartial && b.minutes === 0) || a.minutes - b.minutes;
      case 'cost': return cost(b) - cost(a);
      case 'name': return byName(a, b);
    }
  };
  // The column for titles without a service always goes last: it is not a service to act on.
  return [...columns].sort((a, b) => {
    const aNone = a.providerId === NO_SERVICE_ID;
    const bNone = b.providerId === NO_SERVICE_ID;
    if (aNone !== bNone) return aNone ? 1 : -1;
    return cmp(a, b) || byName(a, b);
  });
}

/** Kronor per hour left, rounded; null when the service is free, the cost unknown, or nothing is left. */
export function costPerHourLeft(monthlyCost: number | null, minutes: number): number | null {
  if (!monthlyCost || monthlyCost <= 0 || minutes <= 0) return null;
  return Math.round(monthlyCost / (minutes / 60));
}

/** A service you pay for with little left to watch: the one to consider cancelling. */
export function isNearlyDone(col: ServiceColumn, monthlyCost: number | null): boolean {
  return col.isMine && !!monthlyCost && monthlyCost > 0 && !col.minutesPartial && col.minutes < NEARLY_DONE_MINUTES;
}
