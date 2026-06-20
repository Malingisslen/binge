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
