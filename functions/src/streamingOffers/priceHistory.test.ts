import { describe, it, expect } from 'vitest';
import { cheapestRent, appendPricePoint, MAX_POINTS, type PricePoint } from './priceHistory';
import type { Offer } from './types';

const offer = (o: Partial<Offer>): Offer => ({
  providerId: 8, type: 'rent', link: 'x', priceAmount: 49, priceCurrency: 'SEK', leaving: null, ...o,
});

describe('cheapestRent', () => {
  it('returns the lowest-priced rent offer', () => {
    expect(cheapestRent([offer({ priceAmount: 49 }), offer({ priceAmount: 39 }), offer({ priceAmount: 59 })]))
      .toEqual({ amount: 39, currency: 'SEK' });
  });
  it('ignores buy and subscription offers', () => {
    expect(cheapestRent([offer({ type: 'buy', priceAmount: 10 }), offer({ type: 'subscription', priceAmount: null }), offer({ type: 'rent', priceAmount: 49 })]))
      .toEqual({ amount: 49, currency: 'SEK' });
  });
  it('ignores rent offers with no price', () => {
    expect(cheapestRent([offer({ type: 'rent', priceAmount: null })])).toBeNull();
  });
  it('null when nothing is rentable', () => {
    expect(cheapestRent([offer({ type: 'buy', priceAmount: 20 })])).toBeNull();
  });
});

describe('appendPricePoint', () => {
  it('appends the first point', () => {
    expect(appendPricePoint([], { amount: 49, currency: 'SEK' }, 1000))
      .toEqual([{ at: 1000, amount: 49, currency: 'SEK' }]);
  });
  it('appends when the price changed', () => {
    const points: PricePoint[] = [{ at: 1000, amount: 49, currency: 'SEK' }];
    expect(appendPricePoint(points, { amount: 39, currency: 'SEK' }, 2000))
      .toEqual([{ at: 1000, amount: 49, currency: 'SEK' }, { at: 2000, amount: 39, currency: 'SEK' }]);
  });
  it('write-on-change: returns null when the price is unchanged', () => {
    const points: PricePoint[] = [{ at: 1000, amount: 49, currency: 'SEK' }];
    expect(appendPricePoint(points, { amount: 49, currency: 'SEK' }, 2000)).toBeNull();
  });
  it('returns null when there is no current price (nothing rentable)', () => {
    expect(appendPricePoint([{ at: 1, amount: 49, currency: 'SEK' }], null, 2000)).toBeNull();
  });
  it('caps the array at MAX_POINTS (drops oldest)', () => {
    const points: PricePoint[] = Array.from({ length: MAX_POINTS }, (_, i) => ({ at: i, amount: i, currency: 'SEK' }));
    const out = appendPricePoint(points, { amount: 9999, currency: 'SEK' }, 99999)!;
    expect(out).toHaveLength(MAX_POINTS);
    expect(out[out.length - 1]).toEqual({ at: 99999, amount: 9999, currency: 'SEK' });
    expect(out[0].at).toBe(1); // index 0 (at:0) dropped
  });
});
