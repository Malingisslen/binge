import { describe, expect, it } from 'vitest';
import {
  computeNextAirFields, computeMovieReleaseFields, nextAirDelta, collectNextAirUpdates,
  buildRepairPayload,
} from './nextAirReadRepair';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

const baseItem = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  tmdbId: 1399, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'Test', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [], tmdbStatus: null, runtime: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
});

const showWith = (over: Partial<TMDBTVShow>): TMDBTVShow =>
  ({ id: 1399, name: 'Test', ...over }) as TMDBTVShow;

describe('computeNextAirFields', () => {
  it('derives date/code from next_episode_to_air and provider from SE flatrate', () => {
    const show = showWith({
      next_episode_to_air: { air_date: '2026-07-09', season_number: 2, episode_number: 3 } as TMDBTVShow['next_episode_to_air'],
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: 1899, provider_name: 'Max' }] } } } as TMDBTVShow['watch/providers'],
    });
    const f = computeNextAirFields(show);
    expect(f.nextAirDate).toBe('2026-07-09');
    expect(f.nextAirCode).toBe('S02E03');
    expect(f.nextAirProvider).toBeTruthy();
  });
  it('returns all-null for a show with nothing upcoming and no SE providers', () => {
    expect(computeNextAirFields(showWith({}))).toEqual({
      nextAirDate: null, nextAirCode: null, nextAirProvider: null,
    });
  });
});

describe('computeMovieReleaseFields', () => {
  it('picks the Swedish digital release date', () => {
    const movie = {
      id: 603, title: 'Test',
      release_dates: { results: [{ iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: '2026-08-01T00:00:00.000Z' }] }] },
    } as unknown as TMDBMovie;
    expect(computeMovieReleaseFields(movie)).toEqual({ digitalReleaseDate: '2026-08-01' });
  });
});

describe('nextAirDelta', () => {
  it('returns null when persisted values equal computed (null vs undefined is NOT a diff)', () => {
    const item = baseItem(); // next-air fields undefined on item
    expect(nextAirDelta(item, { nextAirDate: null, nextAirCode: null, nextAirProvider: null })).toBeNull();
  });
  it('returns only the changed keys', () => {
    const item = baseItem({ nextAirDate: '2026-07-02', nextAirCode: 'S02E02', nextAirProvider: 'Max' });
    const d = nextAirDelta(item, { nextAirDate: '2026-07-09', nextAirCode: 'S02E03', nextAirProvider: 'Max' });
    expect(d).toEqual({ nextAirDate: '2026-07-09', nextAirCode: 'S02E03' });
  });
  it('never contains updatedAt or nextAirUpdatedAt (stamp added only at write time)', () => {
    const item = baseItem();
    const d = nextAirDelta(item, { nextAirDate: '2026-07-09' });
    expect(d).not.toBeNull();
    expect(Object.keys(d!)).not.toContain('updatedAt');
    expect(Object.keys(d!)).not.toContain('nextAirUpdatedAt');
  });
});

describe('buildRepairPayload', () => {
  it('contains exactly the delta keys + nextAirUpdatedAt — NEVER updatedAt or tmdbFieldsRefreshedAt (spec-villkor 2)', () => {
    const stamp = Symbol('serverTimestamp');
    const payload = buildRepairPayload({ nextAirDate: '2026-07-09', nextAirCode: 'S02E03' }, stamp);
    expect(Object.keys(payload).sort()).toEqual(['nextAirCode', 'nextAirDate', 'nextAirUpdatedAt']);
    expect(payload.nextAirUpdatedAt).toBe(stamp);
    // BIN-402: this subset-only writer must NOT stamp the whole-block freshness
    // field (that would falsely mark title/providers fresh → ToS-sweep hole).
    expect('tmdbFieldsRefreshedAt' in payload).toBe(false);
    // The load-bearing invariant is unchanged: this write must NEVER bump updatedAt.
    expect('updatedAt' in payload).toBe(false);
  });
});

describe('collectNextAirUpdates', () => {
  const show = showWith({
    next_episode_to_air: { air_date: '2026-07-09', season_number: 2, episode_number: 3 } as TMDBTVShow['next_episode_to_air'],
  });
  it('emits a delta for a stale item and nothing for a fresh one', () => {
    const stale = baseItem({ tmdbId: 1399 });
    const fresh = baseItem({ tmdbId: 42, nextAirDate: null, nextAirCode: null, nextAirProvider: null });
    const freshShow = showWith({ id: 42 });
    const updates = collectNextAirUpdates([stale, fresh], [show, freshShow], []);
    expect(updates).toHaveLength(1);
    expect(updates[0].tmdbId).toBe(1399);
    expect(updates[0].delta.nextAirDate).toBe('2026-07-09');
  });
  it('ignores shows not in the library (idempotens: stabil show → noll writes)', () => {
    expect(collectNextAirUpdates([], [show], [])).toHaveLength(0);
    // Upprepad resolution av samma redan-reparerade item → noll deltas varje gång.
    const repaired = baseItem({ tmdbId: 1399, nextAirDate: '2026-07-09', nextAirCode: 'S02E03', nextAirProvider: null });
    expect(collectNextAirUpdates([repaired], [show], [])).toHaveLength(0);
    expect(collectNextAirUpdates([repaired], [show], [])).toHaveLength(0);
  });
});
