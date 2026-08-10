import { describe, it, expect } from 'vitest';
import { orderVillSePicks, type LensedPick } from './villSeOrder';
import type { WatchlistItem } from '@/types';

// BIN-814. /my/vill-se answers "what can I watch tonight". Ranking a title you would
// have to RENT into that slot promises a free evening that costs money — and the broad
// `providers` array cannot tell the two apart, because Viaplay (76) and TV4 Play (489)
// are returned under rent/buy while both are typed flatrate in SWEDISH_PROVIDERS.
// The page's poster dots read the same rule, and its caption says they agree.

const VIAPLAY = 76;
const NETFLIX = 8;

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
  title: 'T', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], subscriptionProviders: null, providersCheckedAt: null,
  visibility: null, genreIds: [], tmdbStatus: null,
  addedAt: new Date(2026, 0, 1), updatedAt: new Date(0), watchedAt: null,
  ...over,
}) as WatchlistItem;

const pick = (item: WatchlistItem, unknownRuntime = false): LensedPick => ({ item, unknownRuntime });

describe('orderVillSePicks — "kan ses direkt" means covered by a subscription (BIN-814)', () => {
  it('ranks an INCLUDED title above one that is only rentable on the same service', () => {
    const rentOnly = mk({ tmdbId: 1, providers: [VIAPLAY], subscriptionProviders: [], addedAt: new Date(2026, 0, 9) });
    const included = mk({ tmdbId: 2, providers: [VIAPLAY], subscriptionProviders: [VIAPLAY], addedAt: new Date(2026, 0, 1) });

    // The rent-only title is NEWER, so a broad-array ranking would put it first on
    // the added-at tiebreak alone. Only the subscription rule reorders them.
    const out = orderVillSePicks([pick(rentOnly), pick(included)], new Set([VIAPLAY]));
    expect(out.map(p => p.item.tmdbId)).toEqual([2, 1]);
  });

  it('a row written before the split still ranks as available (fallback preserved)', () => {
    const notBackfilled = mk({ tmdbId: 1, providers: [VIAPLAY], subscriptionProviders: null });
    const elsewhere = mk({ tmdbId: 2, providers: [NETFLIX], subscriptionProviders: [NETFLIX] });
    const out = orderVillSePicks([pick(elsewhere), pick(notBackfilled)], new Set([VIAPLAY]));
    expect(out[0].item.tmdbId).toBe(1);
  });

  it('unknown runtime still sinks to the bottom, even when covered', () => {
    // BIN-167's rule outranks the availability one — pinned so the new sort key
    // cannot be slipped above it.
    const coveredButUnknown = mk({ tmdbId: 1, providers: [VIAPLAY], subscriptionProviders: [VIAPLAY] });
    const uncoveredKnown = mk({ tmdbId: 2, providers: [], subscriptionProviders: [] });
    const out = orderVillSePicks([pick(coveredButUnknown, true), pick(uncoveredKnown)], new Set([VIAPLAY]));
    expect(out.map(p => p.item.tmdbId)).toEqual([2, 1]);
  });

  it('falls back to most-recently-added when availability is equal', () => {
    const older = mk({ tmdbId: 1, addedAt: new Date(2026, 0, 1) });
    const newer = mk({ tmdbId: 2, addedAt: new Date(2026, 0, 5) });
    const out = orderVillSePicks([pick(older), pick(newer)], new Set([VIAPLAY]));
    expect(out.map(p => p.item.tmdbId)).toEqual([2, 1]);
  });

  it('does not mutate the input array', () => {
    const a = pick(mk({ tmdbId: 1, providers: [VIAPLAY], subscriptionProviders: [] }));
    const b = pick(mk({ tmdbId: 2, providers: [VIAPLAY], subscriptionProviders: [VIAPLAY] }));
    const input = [a, b];
    orderVillSePicks(input, new Set([VIAPLAY]));
    expect(input.map(p => p.item.tmdbId)).toEqual([1, 2]);
  });
});
