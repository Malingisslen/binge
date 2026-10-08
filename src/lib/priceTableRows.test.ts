import { describe, it, expect } from 'vitest';
import { buildPriceRows, sortPriceRows, priceChangesNewestFirst } from './priceTableRows';
import { GUEST_PRICED_PROVIDERS } from './guestProviders';
import type { PriceChange } from '@/lib/tmdb/providers';

describe('buildPriceRows', () => {
  const rows = buildPriceRows();

  it('has one row per tier, or one row for an untiered provider', () => {
    const expected = GUEST_PRICED_PROVIDERS.reduce((n, p) => n + Math.max(1, p.tiers?.length ?? 0), 0);
    expect(rows).toHaveLength(expected);
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length);
  });

  it('marks sport tiers and only those', () => {
    const viaplayTotal = rows.find(r => r.key === '76:total');
    expect(viaplayTotal?.sport).toBe(true);
    expect(rows.find(r => r.key === '76:standard')?.sport).toBe(false);
  });

  it('an untiered provider shows its list price under its plan name', () => {
    const prime = rows.find(r => r.providerId === 119);
    expect(prime?.tierName).toBe('Prime-medlemskap');
    expect(prime?.kr).toBe(GUEST_PRICED_PROVIDERS.find(p => p.id === 119)?.defaultMonthlyCost);
  });

  it('every untiered row has a plan name, so the tier column never shows a bare dash', () => {
    const untiered = rows.filter(r => !r.key.includes(':'));
    expect(untiered.length).toBeGreaterThan(0);
    expect(untiered.filter(r => !r.tierName).map(r => r.providerName)).toEqual([]);
  });

  it('carries no free or ad-funded provider', () => {
    expect(rows.some(r => r.providerId === 520 || r.providerId === 300)).toBe(false);
  });
});

describe('sortPriceRows', () => {
  const rows = buildPriceRows();

  it("'provider' keeps catalog order", () => {
    expect(sortPriceRows(rows, 'provider').map(r => r.key)).toEqual(rows.map(r => r.key));
  });

  it("'cheapest' is ascending by price", () => {
    const sorted = sortPriceRows(rows, 'cheapest');
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].kr).toBeGreaterThanOrEqual(sorted[i - 1].kr);
    expect(sorted.map(r => r.key)).not.toEqual(rows.map(r => r.key));
  });
});

describe('priceChangesNewestFirst', () => {
  it('orders newest first and resolves names', () => {
    const changes: PriceChange[] = [
      { date: '2026-05', dateKind: 'effective', providerId: 8, tierId: 'basic', fromKr: 1, toKr: 2, source: 'a' },
      { date: '2026-09-03', dateKind: 'noticed', providerId: 431, tierId: 'ads', fromKr: 1, toKr: 2, source: 'b' },
      { date: '2026-09-02', dateKind: 'noticed', providerId: 76, tierId: 'medium', fromKr: 1, toKr: 2, source: 'c' },
    ];
    const out = priceChangesNewestFirst(changes);
    expect(out.map(c => c.source)).toEqual(['b', 'c', 'a']);
    expect(out[0].providerName).toBe('SkyShowtime');
    expect(out[0].tierName).toBe('Standard med annonser');
  });
});
