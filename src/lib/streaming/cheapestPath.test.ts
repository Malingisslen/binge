import { describe, it, expect } from 'vitest';
import { cheapestPath } from './cheapestPath';
import type { CheapestPathInput } from './cheapestPath';
import type { Offer } from './offers';

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
    // Prime (119, 69 kr) vs Netflix (8, 149 kr) → Prime is cheaper.
    const v = cheapestPath({ ...base, subscriptionProviderIds: [8, 119] });
    expect(v.kind).toBe('subscribe');
    expect(v.providerId).toBe(119);
  });

  it('6 — unavailable when there is no path at all', () => {
    expect(cheapestPath(base).kind).toBe('unavailable');
  });
});
