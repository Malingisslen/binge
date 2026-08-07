import { describe, it, expect } from 'vitest';
import { seProviderIdsForRefresh } from './seProviderIds';
import { extractSEProviders } from './providers';

// BIN-468 item 3. The absent-vs-empty distinction below is the whole reason this
// helper exists separately from extractSEProviders — collapsing the two would let
// a detail fetch with no SE block blank every user's saved provider list on the
// next title-page view.

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

    // rent/buy are the half extractSEProviders deliberately drops; the
    // denormalized array answers "watchable at all", so they belong here.
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

describe('seProviderIdsForRefresh vs extractSEProviders — they answer different questions', () => {
  // Pinned so a future "these look identical, merge them" cleanup fails loudly
  // rather than silently swapping in the clobbering return value.
  it('disagrees on an absent SE block: undefined here, [] there', () => {
    expect(seProviderIdsForRefresh({})).toBeUndefined();
    expect(extractSEProviders({})).toEqual([]);
  });

  it('disagrees on rent-only availability: [2] here, [] there', () => {
    // The explicit empty `flatrate` is only there so the one fixture types against
    // both signatures; the point is the rent offer and how differently it lands.
    const detail = { 'watch/providers': { results: { SE: { flatrate: [], rent: [{ provider_id: 2 }] } } } };
    expect(seProviderIdsForRefresh(detail)).toEqual([2]);
    expect(extractSEProviders(detail)).toEqual([]);
  });
});
