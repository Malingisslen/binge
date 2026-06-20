// functions/src/streamingOffers/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseStreamingOptions, MOTN_TO_TMDB_PROVIDER } from './parse';

describe('MOTN_TO_TMDB_PROVIDER', () => {
  it('maps the major SE services to TMDB provider ids', () => {
    expect(MOTN_TO_TMDB_PROVIDER.netflix).toBe(8);
    expect(MOTN_TO_TMDB_PROVIDER.disney).toBe(337);
    expect(MOTN_TO_TMDB_PROVIDER.prime).toBe(119);
  });
});

describe('parseStreamingOptions', () => {
  it('returns [] for non-array input', () => {
    expect(parseStreamingOptions(undefined)).toEqual([]);
    expect(parseStreamingOptions(null)).toEqual([]);
  });

  it('parses a subscription offer with a leaving date', () => {
    const out = parseStreamingOptions([
      { service: { id: 'netflix' }, type: 'subscription', link: 'https://nf/x', expiresSoon: true, expiresOn: 1781913600 },
    ]);
    expect(out).toEqual([
      { providerId: 8, type: 'subscription', link: 'https://nf/x', priceAmount: null, priceCurrency: null, leaving: '2026-06-20' },
    ]);
  });

  it('parses a rent offer with a price', () => {
    const out = parseStreamingOptions([
      { service: { id: 'appletv' }, type: 'rent', link: 'https://a/x', price: { amount: '49', currency: 'SEK' }, expiresSoon: false },
    ]);
    expect(out[0].type).toBe('rent');
    expect(out[0].priceAmount).toBe(49);
    expect(out[0].priceCurrency).toBe('SEK');
    expect(out[0].leaving).toBeNull();
  });

  it('normalizes addon -> subscription', () => {
    const out = parseStreamingOptions([{ service: { id: 'max' }, type: 'addon', link: 'https://m/x', expiresSoon: false }]);
    expect(out[0].type).toBe('subscription');
  });

  it('skips options for unmapped services', () => {
    const out = parseStreamingOptions([{ service: { id: 'unknown-service' }, type: 'subscription', link: 'x', expiresSoon: false }]);
    expect(out).toEqual([]);
  });
});
