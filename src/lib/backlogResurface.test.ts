import { describe, it, expect } from 'vitest';
import { pickBacklogResurface } from './backlogResurface';
import type { WatchlistItem } from '@/types';

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', dropped: false,
  providers: [], addedAt: new Date(2026, 0, 1), title: 'T', posterPath: null,
  ...over,
}) as WatchlistItem;

describe('pickBacklogResurface', () => {
  it('returns [] when the user has no services selected', () => {
    expect(pickBacklogResurface([mk({ providers: [8] })], [])).toEqual([]);
  });

  it('keeps only vill_se items whose providers intersect myProviders, oldest first', () => {
    const a = mk({ tmdbId: 1, providers: [8], addedAt: new Date(2026, 0, 3) });
    const b = mk({ tmdbId: 2, providers: [8], addedAt: new Date(2026, 0, 1) }); // oldest match
    const c = mk({ tmdbId: 3, providers: [337], addedAt: new Date(2026, 0, 2) }); // provider not mine
    const sedd = mk({ tmdbId: 4, providers: [8], status: 'sedd' });             // not vill_se
    const dropped = mk({ tmdbId: 5, providers: [8], dropped: true });           // abandoned
    const noProv = mk({ tmdbId: 6, providers: [], addedAt: new Date(2025, 0, 1) }); // no providers
    const res = pickBacklogResurface([a, b, c, sedd, dropped, noProv], [8]);
    expect(res.map(i => i.tmdbId)).toEqual([2, 1]); // oldest-first, only the matches
  });

  it('caps at the limit (default 3)', () => {
    const items = [1, 2, 3, 4, 5].map(n => mk({ tmdbId: n, providers: [8], addedAt: new Date(2026, 0, n) }));
    expect(pickBacklogResurface(items, [8]).map(i => i.tmdbId)).toEqual([1, 2, 3]);
    expect(pickBacklogResurface(items, [8], 2).map(i => i.tmdbId)).toEqual([1, 2]);
  });
});

// BIN-814. This tile makes the app's most literal subscription claim — "finns nu på
// din tjänst", with a per-title "finns på Viaplay". It must therefore read the
// SUBSCRIPTION subset. The broad `providers` array cannot distinguish "included" from
// "rentable there", because the SE catalogue returns Viaplay (76) and TV4 Play (489)
// under rent/buy while both are typed flatrate — so reading it tells the user that a
// title they would pay extra for is already covered.
describe('pickBacklogResurface — a rentable title is not "finns på din tjänst" (BIN-814)', () => {
  it('excludes a title that is only RENTABLE on a service the user pays for', () => {
    const rentOnly = mk({ tmdbId: 1, providers: [76], subscriptionProviders: [] });
    expect(pickBacklogResurface([rentOnly], [76])).toEqual([]);
  });

  it('includes the same title when the subscription actually carries it', () => {
    const included = mk({ tmdbId: 1, providers: [76], subscriptionProviders: [76] });
    expect(pickBacklogResurface([included], [76]).map(i => i.tmdbId)).toEqual([1]);
  });

  it('a row written before the split (null) keeps todays behaviour via the fallback', () => {
    const notBackfilled = mk({ tmdbId: 1, providers: [76], subscriptionProviders: null });
    expect(pickBacklogResurface([notBackfilled], [76]).map(i => i.tmdbId)).toEqual([1]);
  });
});
