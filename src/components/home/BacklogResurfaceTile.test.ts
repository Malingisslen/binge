import { describe, it, expect } from 'vitest';
import { matchedProvider } from './BacklogResurfaceTile';
import type { WatchlistItem } from '@/types';

// BIN-814. This tile renders "finns på {tjänst}" under a title, which is the most
// literal subscription claim in the app. The label must therefore be derived from the
// SUBSCRIPTION subset: the SE catalogue returns Viaplay (76) and TV4 Play (489) under
// rent/buy while both are typed flatrate, so the broad `providers` array would put
// "finns på Viaplay" under a film you would have to pay again to watch.
//
// The component had no test file before this ticket, which is exactly why the rule it
// applies could drift without anything failing.

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
  title: 'T', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], subscriptionProviders: null, providersCheckedAt: null,
  visibility: null, genreIds: [], tmdbStatus: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
}) as WatchlistItem;

const VIAPLAY = 76;

describe('BacklogResurfaceTile — matchedProvider (BIN-814)', () => {
  it('names no service for a title that is only RENTABLE on one you pay for', () => {
    const rentOnly = mk({ providers: [VIAPLAY], subscriptionProviders: [] });
    expect(matchedProvider(rentOnly, new Set([VIAPLAY]))).toBeUndefined();
  });

  it('names the service when the subscription actually carries the title', () => {
    const included = mk({ providers: [VIAPLAY], subscriptionProviders: [VIAPLAY] });
    expect(matchedProvider(included, new Set([VIAPLAY]))?.id).toBe(VIAPLAY);
  });

  it('falls back to the broad list for a row written before the split', () => {
    // null = never backfilled. Losing the label here would be a worse regression
    // than the over-generous one, so the fallback is deliberate.
    const notBackfilled = mk({ providers: [VIAPLAY], subscriptionProviders: null });
    expect(matchedProvider(notBackfilled, new Set([VIAPLAY]))?.id).toBe(VIAPLAY);
  });

  it('names nothing when the user does not pay for the carrying service', () => {
    const elsewhere = mk({ providers: [8], subscriptionProviders: [8] });
    expect(matchedProvider(elsewhere, new Set([VIAPLAY]))).toBeUndefined();
  });
});
