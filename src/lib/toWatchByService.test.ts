import { describe, it, expect } from 'vitest';
import {
  NO_SERVICE_ID,
  costPerHourLeft,
  groupRowsByService,
  isNearlyDone,
  minutesLeft,
  tmdbRuntime,
  sortServiceColumns,
  unseenAiredEpisodes,
  type ServiceColumn,
} from './toWatchByService';
import type { ToWatchRow } from './toWatch';
import type { TMDBTVShow, WatchlistItem } from '@/types';

const mkItem = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'tv', status: 'mina', dropped: false, providers: [], subscriptionProviders: null,
  addedAt: new Date(2026, 0, 1), title: 'T', posterPath: null, lastWatchedSeason: null, lastWatchedEpisode: null,
  ...over,
}) as WatchlistItem;
const mkRow = (over: Partial<WatchlistItem>, group: ToWatchRow['group'] = 'efter'): ToWatchRow => ({
  item: mkItem(over), group, seenAt: null, newestAirDate: null,
});
const show = (seasons: [number, number][], last: [number, number] | null, extra: Partial<TMDBTVShow> = {}): TMDBTVShow => ({
  seasons: seasons.map(([season_number, episode_count]) => ({ season_number, episode_count })),
  last_episode_to_air: last ? { season_number: last[0], episode_number: last[1] } : null,
  ...extra,
}) as unknown as TMDBTVShow;

describe('unseenAiredEpisodes', () => {
  const s = show([[0, 3], [1, 10], [2, 8]], [2, 5]);

  it('counts the rest of the current season plus every aired episode after it', () => {
    expect(unseenAiredEpisodes(mkItem({ lastWatchedSeason: 1, lastWatchedEpisode: 7 }), s)).toBe(3 + 5);
  });

  it('counts the whole show for a series not started, leaving out specials', () => {
    expect(unseenAiredEpisodes(mkItem({}), s)).toBe(10 + 5);
  });

  it('counts only aired episodes in the season that is still airing', () => {
    expect(unseenAiredEpisodes(mkItem({ lastWatchedSeason: 2, lastWatchedEpisode: 2 }), s)).toBe(3);
  });

  it('is zero when the user is past the last aired episode', () => {
    expect(unseenAiredEpisodes(mkItem({ lastWatchedSeason: 2, lastWatchedEpisode: 5 }), s)).toBe(0);
  });

  it('is null when TMDB lists no aired episode', () => {
    expect(unseenAiredEpisodes(mkItem({}), show([[1, 8]], null))).toBeNull();
  });
});

describe('minutesLeft', () => {
  it('uses the runtime for a film and episodes times length for a series', () => {
    expect(minutesLeft(mkRow({ mediaType: 'movie', runtime: 120 }), undefined)).toBe(120);
    expect(minutesLeft(mkRow({ runtime: 50 }), 4)).toBe(200);
  });

  it('falls back to the length TMDB reports when the title has none saved', () => {
    expect(minutesLeft(mkRow({ mediaType: 'movie' }), undefined, 118)).toBe(118);
    expect(minutesLeft(mkRow({}), 3, 45)).toBe(135);
    expect(minutesLeft(mkRow({ runtime: 50 }), 3, 45)).toBe(150);
  });

  it('is null when the length or the episode count is unknown', () => {
    expect(minutesLeft(mkRow({ mediaType: 'movie' }), undefined)).toBeNull();
    expect(minutesLeft(mkRow({ runtime: 50 }), null)).toBeNull();
  });
});

describe('tmdbRuntime', () => {
  it('prefers a film runtime, then the usual episode length, then the latest aired episode', () => {
    expect(tmdbRuntime({ runtime: 118 })).toBe(118);
    expect(tmdbRuntime({ episode_run_time: [0, 42, 50] })).toBe(42);
    expect(tmdbRuntime({ episode_run_time: [], last_episode_to_air: { runtime: 38 } })).toBe(38);
    expect(tmdbRuntime({ episode_run_time: [] })).toBeNull();
  });
});

describe('groupRowsByService', () => {
  const minutesOf = (r: ToWatchRow) => r.item.runtime ?? null;

  it('puts a title on every service that carries it and marks the ones the user has', () => {
    const rows = [mkRow({ tmdbId: 1, runtime: 60, subscriptionProviders: [337, 8] }), mkRow({ tmdbId: 2, runtime: 30, subscriptionProviders: [337] })];
    const cols = groupRowsByService(rows, { myProviders: [337], minutesOf });
    const disney = cols.find(c => c.providerId === 337);
    const netflix = cols.find(c => c.providerId === 8);
    expect(disney).toMatchObject({ isMine: true, minutes: 90 });
    expect(disney?.rows).toHaveLength(2);
    expect(netflix).toMatchObject({ isMine: false, minutes: 60 });
  });

  it('collects titles without a streaming service in their own column', () => {
    const cols = groupRowsByService([mkRow({ runtime: 60, providers: [], subscriptionProviders: [] })], { myProviders: [], minutesOf });
    expect(cols.map(c => c.providerId)).toEqual([NO_SERVICE_ID]);
  });

  it('flags a lower-bound total when a title has no known length, and new episodes', () => {
    const rows = [mkRow({ runtime: 60, subscriptionProviders: [337] }, 'nya'), mkRow({ tmdbId: 2, subscriptionProviders: [337] })];
    const [col] = groupRowsByService(rows, { myProviders: [], minutesOf });
    expect(col).toMatchObject({ minutes: 60, minutesPartial: true, hasNew: true });
  });
});

describe('sortServiceColumns', () => {
  const col = (providerId: number, minutes: number): ServiceColumn =>
    ({ providerId, rows: [], isMine: false, minutes, minutesPartial: false, hasNew: false });
  const info = (id: number) => ({ name: ({ 1: 'Ab', 2: 'Cd', 3: 'Ef', [NO_SERVICE_ID]: 'Ingen tjänst' } as Record<number, string>)[id], monthlyCost: id * 100 });
  const cols = [col(NO_SERVICE_ID, 9999), col(1, 100), col(2, 300), col(3, 200)];
  const ids = (key: Parameters<typeof sortServiceColumns>[1]) => sortServiceColumns(cols, key, info).map(c => c.providerId);

  it('sorts by time, cost and name, with the no-service column always last', () => {
    expect(ids('time')).toEqual([2, 3, 1, NO_SERVICE_ID]);
    expect(ids('least')).toEqual([1, 3, 2, NO_SERVICE_ID]);
    expect(ids('cost')).toEqual([3, 2, 1, NO_SERVICE_ID]);
    expect(ids('name')).toEqual([1, 2, 3, NO_SERVICE_ID]);
  });

  it('does not rank a column with no known length as the one with least left', () => {
    const unmeasured: ServiceColumn = { ...col(1, 0), minutesPartial: true };
    expect(sortServiceColumns([unmeasured, col(2, 300)], 'least', info).map(c => c.providerId)).toEqual([2, 1]);
  });
});

describe('costPerHourLeft and isNearlyDone', () => {
  const col = (over: Partial<ServiceColumn>): ServiceColumn =>
    ({ providerId: 1, rows: [], isMine: true, minutes: 60, minutesPartial: false, hasNew: false, ...over });

  it('divides the monthly cost by the hours left, and gives nothing for a free or empty service', () => {
    expect(costPerHourLeft(120, 240)).toBe(30);
    expect(costPerHourLeft(0, 240)).toBeNull();
    expect(costPerHourLeft(null, 240)).toBeNull();
    expect(costPerHourLeft(120, 0)).toBeNull();
  });

  it('suggests cancelling only a paid service of the user that is nearly done and fully measured', () => {
    expect(isNearlyDone(col({}), 129)).toBe(true);
    expect(isNearlyDone(col({ minutes: 300 }), 129)).toBe(false);
    expect(isNearlyDone(col({ isMine: false }), 129)).toBe(false);
    expect(isNearlyDone(col({}), 0)).toBe(false);
    expect(isNearlyDone(col({ minutesPartial: true }), 129)).toBe(false);
  });
});
