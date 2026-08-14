import { describe, it, expect } from 'vitest';
import { providerTally, withProviderDataCount } from './providerTally';
import type { WatchlistItem } from '@/types';

// BIN-845. The stats bars and the caption above them must count the SAME field, and
// it has to be the subscription subset: since BIN-814 the broad `providers` array
// also holds rent and buy, and Viaplay (76) is returned under rent/buy while being
// typed flatrate — so no downstream type filter can separate them again.

const VIAPLAY = 76;
const NETFLIX = 8;

const mk = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'sedd', rating: null, notes: null,
  title: 'T', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], subscriptionProviders: null, providersCheckedAt: null,
  visibility: null, genreIds: [], tmdbStatus: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
}) as WatchlistItem;

describe('providerTally (BIN-845)', () => {
  it('counts a title on the service that INCLUDES it, not the one that rents it', () => {
    const tally = providerTally([mk({ providers: [VIAPLAY, NETFLIX], subscriptionProviders: [NETFLIX] })]);
    expect(tally[NETFLIX]).toBe(1);
    expect(tally[VIAPLAY]).toBeUndefined();
  });

  it('a rent-only title contributes to no bar at all', () => {
    expect(providerTally([mk({ providers: [VIAPLAY], subscriptionProviders: [] })])).toEqual({});
  });

  it('falls back to the broad array for rows written before the split', () => {
    expect(providerTally([mk({ providers: [VIAPLAY], subscriptionProviders: null })])).toEqual({ [VIAPLAY]: 1 });
  });

  it('sums across titles', () => {
    const tally = providerTally([
      mk({ tmdbId: 1, providers: [NETFLIX], subscriptionProviders: [NETFLIX] }),
      mk({ tmdbId: 2, providers: [NETFLIX], subscriptionProviders: [NETFLIX] }),
    ]);
    expect(tally[NETFLIX]).toBe(2);
  });
});

describe('withProviderDataCount (BIN-845)', () => {
  it('does NOT count a rent-only title, so the caption cannot overstate the chart', () => {
    // The whole reason this moved: a title in the numerator that contributes to no
    // bar makes "N av M" claim more of the chart than exists.
    expect(withProviderDataCount([mk({ providers: [VIAPLAY], subscriptionProviders: [] })])).toBe(0);
  });

  it('counts a title that a subscription carries', () => {
    expect(withProviderDataCount([mk({ providers: [VIAPLAY], subscriptionProviders: [VIAPLAY] })])).toBe(1);
  });

  it('does NOT count a CHECKED rent-only title — the shape production actually writes', () => {
    // The decisive case, and the one an earlier version of this test got wrong.
    // Every writer that sets subscriptionProviders stamps providersCheckedAt in the
    // same payload, so a rent-only title is `[]` WITH a stamp. Counting anything
    // carrying a stamp therefore admitted exactly the rows that draw no bar — the
    // overcount this caption was narrowed to prevent.
    expect(withProviderDataCount([
      mk({ providers: [76], subscriptionProviders: [], providersCheckedAt: new Date(0) }),
    ])).toBe(0);
  });

  it('still counts a row that has no subscription answer yet (the add-path case)', () => {
    // What the old providersCheckedAt clause was really for: addItem writes providers
    // without stamping, and stamp-only counting reported "0 av N" while bars rendered.
    // The null-fallback in subscriptionProviderIds covers it without the disjunct.
    expect(withProviderDataCount([
      mk({ providers: [76], subscriptionProviders: null, providersCheckedAt: null }),
    ])).toBe(1);
  });

  it('counts nothing for a title never checked and on no service', () => {
    expect(withProviderDataCount([mk({})])).toBe(0);
  });
});
