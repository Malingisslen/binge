import { describe, it, expect } from 'vitest';
import { seProviderIdsForRefresh, seSubscriptionProviderIdsForRefresh } from './seProviderIds';

// BIN-468 item 3 + BIN-814. Two helpers, two questions, ONE shared absent-vs-empty
// contract: a detail fetch with no SE block must never blank a saved provider list.

// 1944 is TMDB's current primary id for TV4 Play; 489 is our canonical id for it.
const TV4_VARIANT = 1944;
const TV4_CANONICAL = 489;
const NETFLIX = 8;

describe('seProviderIdsForRefresh — absent means "I learned nothing", empty means "nowhere"', () => {
  it('returns undefined when the detail carries no watch/providers at all', () => {
    // undefined is what makes planTmdbFieldsRefresh skip the providers group.
    expect(seProviderIdsForRefresh({})).toBeUndefined();
  });

  it('returns undefined when watch/providers exists but has no SE block', () => {
    expect(seProviderIdsForRefresh({ 'watch/providers': { results: {} } })).toBeUndefined();
  });

  it('returns [] for a present-but-empty SE block — TMDB genuinely says "nowhere in Sweden"', () => {
    // Distinct from the two cases above: this IS an answer, and it must be written
    // so a title that left every Swedish service stops claiming it is streamable.
    expect(seProviderIdsForRefresh({ 'watch/providers': { results: { SE: {} } } })).toEqual([]);
  });
});

describe('seProviderIdsForRefresh — which offers count', () => {
  it('merges all five offer kinds, including rent and buy', () => {
    const ids = seProviderIdsForRefresh({
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: 8 }],
            free: [{ provider_id: 520 }],
            ads: [{ provider_id: 613 }],
            rent: [{ provider_id: 2 }],
            buy: [{ provider_id: 3 }],
          },
        },
      },
    });

    // rent/buy are the half the subscription helper deliberately drops; this array
    // answers "watchable at all", so they belong here.
    expect(ids).toEqual([8, 520, 613, 2, 3]);
  });

  it('rent-only availability still produces a non-empty list', () => {
    expect(seProviderIdsForRefresh({
      'watch/providers': { results: { SE: { rent: [{ provider_id: 2 }] } } },
    })).toEqual([2]);
  });

  it('canonicalises variant ids and de-duplicates across offer kinds', () => {
    const ids = seProviderIdsForRefresh({
      'watch/providers': {
        results: {
          SE: {
            flatrate: [{ provider_id: NETFLIX }, { provider_id: TV4_VARIANT }],
            // Same two services again, listed under rent — one entry each survives.
            rent: [{ provider_id: TV4_CANONICAL }, { provider_id: NETFLIX }],
          },
        },
      },
    });

    expect(ids).toEqual([NETFLIX, TV4_CANONICAL]);
  });
});

// BIN-814. The subscription helper is what the advisor's keep-or-pause reasoning
// reads. It shares the absent-vs-empty contract with its broad sibling — the OLD
// narrow extractor did not, which is exactly how a backfill run could blank a good
// array — and it drops rent/buy, which is the whole point of it existing.
describe('seSubscriptionProviderIdsForRefresh — same contract, narrower question', () => {
  it('returns undefined for an absent SE block, like its sibling', () => {
    // The old extractSEProviders returned [] here. That is the clobbering value.
    expect(seSubscriptionProviderIdsForRefresh({})).toBeUndefined();
    expect(seSubscriptionProviderIdsForRefresh({ 'watch/providers': { results: {} } })).toBeUndefined();
  });

  it('returns [] for a present-but-empty SE block — a real "no subscription covers this"', () => {
    expect(seSubscriptionProviderIdsForRefresh({ 'watch/providers': { results: { SE: {} } } })).toEqual([]);
  });

  it('keeps flatrate, free and ads', () => {
    expect(seSubscriptionProviderIdsForRefresh({
      'watch/providers': {
        results: { SE: { flatrate: [{ provider_id: 8 }], free: [{ provider_id: 520 }], ads: [{ provider_id: 613 }] } },
      },
    })).toEqual([8, 520, 613]);
  });

  it('canonicalises variant ids the same way', () => {
    expect(seSubscriptionProviderIdsForRefresh({
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: TV4_VARIANT }, { provider_id: TV4_CANONICAL }] } } },
    })).toEqual([TV4_CANONICAL]);
  });
});

describe('the two helpers disagree exactly where the advisor needs them to (BIN-814)', () => {
  // The decisive case, verified against live TMDB SE data on 2026-08-09: Viaplay (76)
  // is returned under rent/buy while being typed `flatrate` in SWEDISH_PROVIDERS. A
  // single broad field cannot express "rentable there, not included" — which is why
  // this pair must stay two fields, and why merging the helpers is not a cleanup.
  const VIAPLAY = 76;
  const rentOnlyOnViaplay = {
    'watch/providers': { results: { SE: { rent: [{ provider_id: VIAPLAY }], buy: [{ provider_id: VIAPLAY }] } } },
  };

  it('a rent-only Viaplay title is availability, but NOT a subscription reason', () => {
    expect(seProviderIdsForRefresh(rentOnlyOnViaplay)).toEqual([VIAPLAY]);
    expect(seSubscriptionProviderIdsForRefresh(rentOnlyOnViaplay)).toEqual([]);
  });

  it('the same title INCLUDED in Viaplay lands in both', () => {
    const included = {
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: VIAPLAY }], rent: [{ provider_id: VIAPLAY }] } } },
    };
    expect(seProviderIdsForRefresh(included)).toEqual([VIAPLAY]);
    expect(seSubscriptionProviderIdsForRefresh(included)).toEqual([VIAPLAY]);
  });

  it('Amazon needs no special case — TMDB SE splits the SVOD and TVOD ids', () => {
    // 119 Amazon Prime Video (flatrate) vs 10 Amazon Video (rent/buy). Confirmed
    // against live SE data; if TMDB ever collapses them, this test is the tripwire.
    const amazon = {
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: 119 }], rent: [{ provider_id: 10 }] } } },
    };
    expect(seProviderIdsForRefresh(amazon)).toEqual([119, 10]);
    expect(seSubscriptionProviderIdsForRefresh(amazon)).toEqual([119]);
  });
});
