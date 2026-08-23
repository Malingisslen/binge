import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeNextAirFields, computeMovieReleaseFields, nextAirDelta, collectNextAirUpdates,
  buildRepairPayload, nextAirStampStale, NEXTAIR_RESTAMP_INTERVAL_MS, flushNextAirWrites,
} from './nextAirReadRepair';
import type { NextAirUpdate } from './nextAirReadRepair';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

// BIN-518: flushNextAirWrites needs Firebase (the pure functions above don't).
// Mock fsdb so we can force a chunk's commit to REJECT and assert failed-chunk
// items are rolled back (retryable) while committed-chunk items stay deduped.
// The dynamic import inside flush resolves to this mock; the pure-function tests
// never reach it, so they're unaffected.
let commitOutcomes: Array<'ok' | 'fail'> = [];
let commitIndex = 0;
const attemptedChunks: number[][] = [];
// BIN-957: the OTHER catch site — nothing was written at all because the import or fsdb()
// itself fell over. It reports a different `kind` than a rejected chunk, so the two are
// distinguishable in Sentry, and this flag is the only way to reach it from a test.
let fsdbFails = false;
// BIN-957: the failures are reported now, not merely logged. Mocked here because the
// module gained a real dependency on it; the pure-function tests never reach the calls.
const captureError = vi.fn();
vi.mock('@/lib/sentry', () => ({
  captureError: (...args: unknown[]) => captureError(...args),
}));
vi.mock('@/lib/firebase/db', () => ({
  fsdb: async () => (fsdbFails ? Promise.reject(new Error('fsdb down')) : {
    db: {},
    doc: (_db: unknown, ..._path: string[]) => ({ id: _path[_path.length - 1] }),
    writeBatch: () => {
      const ids: number[] = [];
      return {
        // BIN-560 Phase 4: doc ids are now namespaced (tv_451) — recover the numeric
        // tmdbId so the chunk assertions still read the tmdbIds attempted per batch.
        set: (ref: { id: string }) => { ids.push(Number(ref.id.split('_').pop())); },
        commit: async () => {
          attemptedChunks.push([...ids]);
          const outcome = commitOutcomes[commitIndex++] ?? 'ok';
          if (outcome === 'fail') throw new Error('forced batch rejection');
        },
      };
    },
    serverTimestamp: () => 'STAMP',
  }),
}));

const NOW = Date.UTC(2026, 6, 11); // 2026-07-11

const baseItem = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  tmdbId: 1399, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'Test', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], subscriptionProviders: null, providersCheckedAt: null, visibility: null,
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

// BIN-468 A3: nextAirUpdatedAt must not FREEZE on a stable item. A settled
// digitalReleaseDate (or an ended show's air fields) never changes → its stamp
// would freeze → sweep clears at 5mo → next visit re-writes → a recurring
// clear-then-repair cycle. Fix: re-stamp when the stamp is older than the
// re-stamp interval (~90d) even if no value changed — but only for items that
// actually hold next-air data (nothing to attest otherwise).
describe('nextAirStampStale', () => {
  it('stale when the stamp is absent (legacy has-data doc, never stamped)', () => {
    expect(nextAirStampStale(null, NOW)).toBe(true);
    expect(nextAirStampStale(undefined, NOW)).toBe(true);
  });
  it('fresh within the interval, stale once past it', () => {
    expect(nextAirStampStale(new Date(NOW - (NEXTAIR_RESTAMP_INTERVAL_MS - 86_400_000)), NOW)).toBe(false);
    expect(nextAirStampStale(new Date(NOW - (NEXTAIR_RESTAMP_INTERVAL_MS + 86_400_000)), NOW)).toBe(true);
  });
  it('exact boundary: stale AT the interval (>= — guards a >= → > regression)', () => {
    expect(nextAirStampStale(new Date(NOW - NEXTAIR_RESTAMP_INTERVAL_MS), NOW)).toBe(true);
    expect(nextAirStampStale(new Date(NOW - NEXTAIR_RESTAMP_INTERVAL_MS + 1), NOW)).toBe(false);
  });
  it('interval stays under the 5-month sweep threshold', () => {
    expect(NEXTAIR_RESTAMP_INTERVAL_MS).toBeLessThan(5 * 30 * 24 * 60 * 60 * 1000);
  });
});

describe('collectNextAirUpdates', () => {
  const show = showWith({
    next_episode_to_air: { air_date: '2026-07-09', season_number: 2, episode_number: 3 } as TMDBTVShow['next_episode_to_air'],
  });
  const freshStamp = new Date(NOW - 86_400_000); // 1 day old — within re-stamp interval
  const staleStamp = new Date(NOW - (NEXTAIR_RESTAMP_INTERVAL_MS + 86_400_000)); // past interval

  it('emits a value delta for a changed item and nothing for a fresh, dataless one', () => {
    const stale = baseItem({ tmdbId: 1399 });
    const fresh = baseItem({ tmdbId: 42, nextAirDate: null, nextAirCode: null, nextAirProvider: null });
    const freshShow = showWith({ id: 42 });
    const updates = collectNextAirUpdates([stale, fresh], [show, freshShow], [], NOW);
    expect(updates).toHaveLength(1);
    expect(updates[0].tmdbId).toBe(1399);
    expect(updates[0].delta.nextAirDate).toBe('2026-07-09');
  });

  it('a stable item that is already stamped-fresh produces no write (idempotent)', () => {
    const repaired = baseItem({
      tmdbId: 1399, nextAirDate: '2026-07-09', nextAirCode: 'S02E03', nextAirProvider: null,
      nextAirUpdatedAt: freshStamp,
    });
    expect(collectNextAirUpdates([repaired], [show], [], NOW)).toHaveLength(0);
    expect(collectNextAirUpdates([repaired], [show], [], NOW)).toHaveLength(0);
  });

  it('re-stamps a stable item whose stamp is stale — no value delta, just the stamp (A3)', () => {
    const stableButStale = baseItem({
      tmdbId: 1399, nextAirDate: '2026-07-09', nextAirCode: 'S02E03', nextAirProvider: null,
      nextAirUpdatedAt: staleStamp,
    });
    const updates = collectNextAirUpdates([stableButStale], [show], [], NOW);
    expect(updates).toHaveLength(1);
    expect(updates[0].delta).toEqual({}); // stamp-only — buildRepairPayload adds nextAirUpdatedAt
  });

  it('re-stamps a has-data item with an absent stamp (legacy doc)', () => {
    const legacy = baseItem({
      tmdbId: 1399, nextAirDate: '2026-07-09', nextAirCode: 'S02E03', nextAirProvider: null,
      // nextAirUpdatedAt undefined
    });
    expect(collectNextAirUpdates([legacy], [show], [], NOW)).toHaveLength(1);
  });

  it('does NOT re-stamp an item that holds no next-air data (nothing to attest)', () => {
    // a TV show with nothing upcoming: computed all-null == stored all-null, no data → no stamp churn
    const empty = baseItem({ tmdbId: 42, nextAirUpdatedAt: undefined });
    const emptyShow = showWith({ id: 42 });
    expect(collectNextAirUpdates([empty], [emptyShow], [], NOW)).toHaveLength(0);
  });

  it('ignores shows not in the library', () => {
    expect(collectNextAirUpdates([], [show], [], NOW)).toHaveLength(0);
  });
});

describe('flushNextAirWrites — a rejected chunk rolls back its dedupe marks (BIN-518)', () => {
  beforeEach(() => {
    commitOutcomes = [];
    commitIndex = 0;
    attemptedChunks.length = 0;
    fsdbFails = false;
    captureError.mockClear();
  });

  const mkUpdate = (tmdbId: number): NextAirUpdate => ({
    mediaType: 'tv', tmdbId, delta: { nextAirDate: '2026-08-01' },
  });

  it("a failed chunk's items retry on the next flush; a committed chunk's items don't", async () => {
    // 451 updates → two chunks (450 + 1). First chunk's commit REJECTS, second commits.
    const uid = 'bin518';
    const updates = Array.from({ length: 451 }, (_, i) => mkUpdate(i + 1));
    commitOutcomes = ['fail', 'ok'];
    await flushNextAirWrites(uid, updates);

    // Both chunks were attempted; chunk 1 = 450 ids, chunk 2 = [451].
    expect(attemptedChunks).toHaveLength(2);
    expect(attemptedChunks[0]).toHaveLength(450);
    expect(attemptedChunks[1]).toEqual([451]);

    // Second flush, same updates: id 451 (committed) is deduped out; the 450
    // items from the rejected chunk retry because their marks were rolled back.
    commitOutcomes = ['ok'];
    commitIndex = 0;
    attemptedChunks.length = 0;
    await flushNextAirWrites(uid, updates);
    expect(attemptedChunks).toHaveLength(1);
    expect(attemptedChunks[0]).toHaveLength(450);
    expect(attemptedChunks[0]).not.toContain(451);
  });
});

// BIN-957: `console.warn` on these two catch sites was invisible to Sentry — its default
// globalHandlers integration reports an unhandled rejection but never a console line, so
// catching and warning made the failure LESS visible than not catching at all. Both sites
// now report with their own `kind`, and both must still SWALLOW: the caller is the calendar
// effect and a throw from there is an unhandled rejection the user cannot act on.
describe('flushNextAirWrites — a failed repair is reported to Sentry and still swallowed (BIN-957)', () => {
  beforeEach(() => {
    commitOutcomes = [];
    commitIndex = 0;
    attemptedChunks.length = 0;
    fsdbFails = false;
    captureError.mockClear();
  });

  const mkUpdate = (tmdbId: number): NextAirUpdate => ({
    mediaType: 'tv', tmdbId, delta: { nextAirDate: '2026-08-01' },
  });

  it('a rejected chunk reports kind flushNextAirWrites-chunk without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      commitOutcomes = ['fail'];
      await expect(flushNextAirWrites('bin957-chunk', [mkUpdate(1)])).resolves.toBeUndefined();
      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        { scope: 'watchlist', kind: 'flushNextAirWrites-chunk' },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('a failed fsdb() reports the OTHER kind — nothing was written, not one chunk refused', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fsdbFails = true;
      await expect(flushNextAirWrites('bin957-setup', [mkUpdate(2)])).resolves.toBeUndefined();
      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        { scope: 'watchlist', kind: 'flushNextAirWrites-setup' },
      );
      // Nothing was attempted, and the dedupe marks were rolled back — so a later flush
      // for the same uid retries rather than skipping the item forever.
      expect(attemptedChunks).toHaveLength(0);
      fsdbFails = false;
      commitOutcomes = ['ok'];
      await flushNextAirWrites('bin957-setup', [mkUpdate(2)]);
      expect(attemptedChunks).toEqual([[2]]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
