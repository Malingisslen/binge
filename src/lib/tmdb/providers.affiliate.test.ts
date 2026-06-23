import { describe, it, expect } from 'vitest';
import { applyAffiliate, affiliateWrap, AFFILIATE_PROGRAMS } from './providers';
import type { AffiliateProgram } from './providers';

// A fake program table — Viaplay (76) appends a tag; nobody else is configured.
const fake: Record<number, AffiliateProgram> = {
  76: (url) => `${url}${url.includes('?') ? '&' : '?'}tag=binge-21`,
};

describe('applyAffiliate', () => {
  it('injects the affiliate tag for a configured provider', () => {
    expect(applyAffiliate(fake, 76, 'https://viaplay.se/x')).toBe('https://viaplay.se/x?tag=binge-21');
  });

  it('appends with & when the url already has a query string', () => {
    expect(applyAffiliate(fake, 76, 'https://viaplay.se/x?a=1')).toBe('https://viaplay.se/x?a=1&tag=binge-21');
  });

  it('passes the bare url through unchanged for an unconfigured provider', () => {
    expect(applyAffiliate(fake, 8, 'https://netflix.com/x')).toBe('https://netflix.com/x');
  });

  it('routes an alias id to the canonical provider program (TV4 Play 1944 → 489)', () => {
    const table: Record<number, AffiliateProgram> = { 489: (u) => `${u}#aff` };
    expect(applyAffiliate(table, 1944, 'https://tv4play.se/x')).toBe('https://tv4play.se/x#aff');
  });
});

describe('affiliateWrap (live table)', () => {
  it('is a no-op passthrough until affiliate accounts are configured', () => {
    // Guards the safe-default: prod links must be unchanged while the table is empty.
    expect(Object.keys(AFFILIATE_PROGRAMS)).toHaveLength(0);
    expect(affiliateWrap(76, 'https://viaplay.se/x')).toBe('https://viaplay.se/x');
  });
});
