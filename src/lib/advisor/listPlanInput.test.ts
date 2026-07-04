import { describe, it, expect } from 'vitest';
import { toListTitle, type LiteDetailLike } from './listPlanInput';

const detail = (SE: NonNullable<NonNullable<LiteDetailLike['watch/providers']>['results']>['SE']): LiteDetailLike => ({
  'watch/providers': { results: { SE } },
});

describe('toListTitle (BIN-416 list optimizer input)', () => {
  it('extracts flatrate + free SE provider ids as raw (no canonicalise here)', () => {
    // 493 is TMDB's alias id for SVT (canonical 520). The mapper must pass it RAW —
    // the optimizer's subsOf() canonicalises. If the mapper canonicalised, this id
    // would already be 520 here.
    const t = toListTitle(
      { tmdbId: 1, title: 'X' },
      detail({ flatrate: [{ provider_id: 8 }], free: [{ provider_id: 493 }] }),
    );
    expect(t.subscriptionProviderIds).toEqual([8, 493]);
    expect(t.rentable).toBe(false);
  });

  it('NEVER includes ads providers in the subscription list', () => {
    // Pluto TV (300) is an ads provider with defaultMonthlyCost 0 — including it
    // would fabricate a "free" coverage win. Must be excluded.
    const t = toListTitle(
      { tmdbId: 2, title: 'Y' },
      detail({ flatrate: [{ provider_id: 8 }], ads: [{ provider_id: 300 }] }),
    );
    expect(t.subscriptionProviderIds).toEqual([8]);
  });

  it('marks rentable from a SE rent OR buy offer, independent of subscriptions', () => {
    const rentOnly = toListTitle({ tmdbId: 3, title: 'Z' }, detail({ rent: [{ provider_id: 2 }] }));
    expect(rentOnly.subscriptionProviderIds).toEqual([]);
    expect(rentOnly.rentable).toBe(true);

    const buyOnly = toListTitle({ tmdbId: 4, title: 'W' }, detail({ buy: [{ provider_id: 3 }] }));
    expect(buyOnly.rentable).toBe(true);

    // Truly independent: a title that ALSO streams on a subscription must still
    // count as rentable — guards against a bug gating rentable on an empty
    // subscription list (mutation-verified gap, test-reviewer 2026-07-04).
    const streamsAndRentable = toListTitle(
      { tmdbId: 7, title: 'V' },
      detail({ flatrate: [{ provider_id: 8 }], buy: [{ provider_id: 3 }] }),
    );
    expect(streamsAndRentable.subscriptionProviderIds).toEqual([8]);
    expect(streamsAndRentable.rentable).toBe(true);
  });

  it('treats a title with no SE offers at all as uncovered + not rentable', () => {
    const none = toListTitle({ tmdbId: 5, title: 'Q' }, detail({}));
    expect(none.subscriptionProviderIds).toEqual([]);
    expect(none.rentable).toBe(false);

    const missingBlock = toListTitle({ tmdbId: 6, title: 'R' }, {});
    expect(missingBlock.subscriptionProviderIds).toEqual([]);
    expect(missingBlock.rentable).toBe(false);
  });

  it('carries tmdbId + title through unchanged', () => {
    const t = toListTitle({ tmdbId: 42, title: 'Dune' }, detail({ flatrate: [{ provider_id: 8 }] }));
    expect(t.tmdbId).toBe(42);
    expect(t.title).toBe('Dune');
  });
});
