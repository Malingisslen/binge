import { describe, it, expect } from 'vitest';
import { cheapestPath } from './cheapestPath';
import type { CheapestPathInput } from './cheapestPath';
import type { Offer } from './offers';
import { cheapestEntertainmentTier, cheapestEntertainmentTierFrom } from '@/lib/tmdb/providers';
import type { SwedishProvider } from '@/lib/tmdb/providers';

const rent = (providerId: number, priceAmount: number): Offer => ({
  providerId, type: 'rent', link: 'x', priceAmount, priceCurrency: 'SEK', leaving: null,
});

const base: CheapestPathInput = {
  subscriptionProviderIds: [],
  ownedProviderIds: [],
  offers: [],
  library: null,
};

describe('cheapestPath cascade', () => {
  it('1 — free public service (SVT, id 520) wins over everything, even an owned paid service', () => {
    const v = cheapestPath({ ...base, subscriptionProviderIds: [520, 384], ownedProviderIds: [384] });
    expect(v.kind).toBe('free_public');
    expect(v.providerId).toBe(520);
  });

  it('routes SVT alias 493 to the canonical free verdict', () => {
    const v = cheapestPath({ ...base, subscriptionProviderIds: [493] });
    expect(v.kind).toBe('free_public');
    expect(v.providerId).toBe(520);
  });

  it('2 — owned subscription wins over library and rent', () => {
    const v = cheapestPath({
      ...base,
      subscriptionProviderIds: [384],
      ownedProviderIds: [384],
      library: { loansLeft: 1 },
      offers: [rent(2, 49)],
    });
    expect(v.kind).toBe('owned');
    expect(v.providerId).toBe(384);
  });

  it('matches owned via an alias id (HBO Max legacy 1899 → 384)', () => {
    const v = cheapestPath({ ...base, subscriptionProviderIds: [384], ownedProviderIds: [1899] });
    expect(v.kind).toBe('owned');
    expect(v.providerId).toBe(384);
  });

  it('3 — free via library when not owned, above rent', () => {
    const v = cheapestPath({
      ...base,
      subscriptionProviderIds: [384],
      ownedProviderIds: [76],
      library: { loansLeft: 2 },
      offers: [rent(2, 49)],
    });
    expect(v.kind).toBe('free_library');
    expect(v.loansLeft).toBe(2);
  });

  it('3b — loansLeft:0 (exhausted quota) falls through to rent, not free_library (BIN-201)', () => {
    const v = cheapestPath({
      ...base,
      ownedProviderIds: [76],
      library: { loansLeft: 0 },
      offers: [rent(2, 39)],
    });
    expect(v.kind).toBe('rent');
    expect(v.priceAmount).toBe(39);
  });

  it('3c — loansLeft:null (unknown quota) still shows free_library (BIN-201)', () => {
    const v = cheapestPath({
      ...base,
      ownedProviderIds: [76],
      library: { loansLeft: null },
      offers: [rent(2, 39)],
    });
    expect(v.kind).toBe('free_library');
    expect(v.loansLeft).toBeNull();
  });

  it('4 — cheapest rent when no owned/free/library path; ties break on lowest provider id', () => {
    const v = cheapestPath({
      ...base,
      offers: [rent(2, 49), rent(3, 39), rent(35, 39)],
    });
    expect(v.kind).toBe('rent');
    expect(v.priceAmount).toBe(39);
    expect(v.providerId).toBe(3); // 3 < 35 on the 39-kr tie
    expect(v.priceCurrency).toBe('SEK');
  });

  it('ignores rent offers with no price', () => {
    const noPrice: Offer = { providerId: 2, type: 'rent', link: 'x', priceAmount: null, priceCurrency: null, leaving: null };
    const v = cheapestPath({ ...base, offers: [noPrice] });
    expect(v.kind).toBe('unavailable');
  });

  it('5 — suggest the cheapest subscription when streamable but none owned/free', () => {
    // Prime (119, 69 kr) vs Netflix (8, cheapest tier 109 kr) → Prime is cheaper.
    const v = cheapestPath({ ...base, subscriptionProviderIds: [8, 119] });
    expect(v.kind).toBe('subscribe');
    expect(v.providerId).toBe(119);
    expect(v.priceAmount).toBe(69);
    expect(v.tierLabel).toBeNull(); // Prime has no tiers → no label
  });

  it('5b — BIN-322: ranks by cheapest ad-tier, flipping the winner vs list price', () => {
    // Apple TV+ (350) list 119, no tiers → 119. Max (384) list 149 but ads tier 89.
    // Old defaultMonthlyCost ranking would pick Apple TV+ (119 < 149); the tier-aware
    // ranking correctly picks Max (89 < 119) and surfaces the ad-tier price + label.
    const v = cheapestPath({ ...base, subscriptionProviderIds: [350, 384] });
    expect(v.kind).toBe('subscribe');
    expect(v.providerId).toBe(384);
    expect(v.priceAmount).toBe(89);
    expect(v.tierLabel).toBe('Basic med reklam');
  });

  it('5c — BIN-322: surfaces the ad-tier price + label for a sub-list-price tier', () => {
    // Disney+ (337) list 109, ads tier 69 → "från 69 kr (Standard med reklam)".
    const v = cheapestPath({ ...base, subscriptionProviderIds: [337] });
    expect(v.kind).toBe('subscribe'); // self-documenting: no owned/free/rent path
    expect(v.providerId).toBe(337);
    expect(v.priceAmount).toBe(69);
    expect(v.tierLabel).toBe('Standard med reklam');
  });

  it('6 — unavailable when there is no path at all', () => {
    expect(cheapestPath(base).kind).toBe('unavailable');
  });
});

describe('cheapestEntertainmentTier — excludes sport/bundle tiers (BIN-322)', () => {
  it('picks the cheapest NON-sport tier for Viaplay (reklam 79, not sport 399/699)', () => {
    const { cost, tier } = cheapestEntertainmentTier(76);
    expect(cost).toBe(79);
    expect(tier?.kind).not.toBe('sport');
  });

  it('picks TV4 plus-ads (69), never the 699 Sport Total tier', () => {
    const { cost, tier } = cheapestEntertainmentTier(489);
    expect(cost).toBe(69);
    expect(tier?.kind).not.toBe('sport');
  });

  it('falls back to defaultMonthlyCost for a provider with no tiers (Prime)', () => {
    expect(cheapestEntertainmentTier(119)).toEqual({ cost: 69, tier: null });
  });

  it('returns Infinity for an unknown provider so it sorts last', () => {
    expect(cheapestEntertainmentTier(999999).cost).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('cheapestEntertainmentTierFrom — falsifiable sport exclusion (BIN-353)', () => {
  const synthetic = (tiers: SwedishProvider['tiers']): SwedishProvider => ({
    id: 999001, name: 'Synthetic', shortName: 'SYN', color: '#000',
    type: 'flatrate', defaultMonthlyCost: 200, tiers,
  });

  it('skips a sport tier even when it is the CHEAPEST tier (guard would be invisible otherwise)', () => {
    // The 50-kr sport tier is the cheapest of the lot; the entertainment pick
    // must still return the 120-kr non-sport tier. Delete the kind!=='sport'
    // filter and this returns 50 → the test fails. That's the whole point.
    const { cost, tier } = cheapestEntertainmentTierFrom(synthetic([
      { id: 'sport', name: 'Sport', cost: 50, kind: 'sport' },
      { id: 'std', name: 'Standard', cost: 120 },
    ]));
    expect(cost).toBe(120);
    expect(tier?.id).toBe('std');
    expect(tier?.kind).not.toBe('sport');
  });

  it('falls back to defaultMonthlyCost when every tier is sport', () => {
    const { cost, tier } = cheapestEntertainmentTierFrom(synthetic([
      { id: 'sport', name: 'Sport', cost: 50, kind: 'sport' },
      { id: 'total', name: 'Total', cost: 80, kind: 'sport' },
    ]));
    expect(cost).toBe(200); // no usable entertainment tier → list price
    expect(tier).toBeNull();
  });

  it('falls back to defaultMonthlyCost when the provider has no tiers at all', () => {
    expect(cheapestEntertainmentTierFrom(synthetic(undefined))).toEqual({ cost: 200, tier: null });
  });
});
