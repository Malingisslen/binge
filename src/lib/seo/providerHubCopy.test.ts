import { describe, it, expect } from 'vitest';
import { providerHubCopy } from './providerHubCopy';
import { getProvider, cheapestEntertainmentTierFrom, type SwedishProvider } from '@/lib/tmdb/providers';
import { SEO_PROVIDER_IDS } from '@/lib/tmdb/seoCoverage';

const paid: SwedishProvider = {
  id: 1, name: 'Testflix', shortName: 'T', color: '#000', type: 'flatrate', defaultMonthlyCost: 199,
  tiers: [{ id: 'a', name: 'A', cost: 149 }, { id: 'b', name: 'B', cost: 99 }],
};

describe('providerHubCopy (SEO-7)', () => {
  it('leads with the streaming query and quotes the cheapest tier', () => {
    const copy = providerHubCopy(paid);
    expect(copy.h1).toBe('Streama på Testflix i Sverige');
    expect(copy.standfirst).toMatch(/^Testflix kostar från 99 kr i månaden\./);
  });

  it('never quotes a price for a free or ad-funded service', () => {
    expect(providerHubCopy({ ...paid, defaultMonthlyCost: 0, tiers: undefined, isFree: true }).standfirst)
      .toMatch(/^Testflix är gratis att använda i Sverige\./);
    expect(providerHubCopy({ ...paid, defaultMonthlyCost: 0, tiers: undefined, isAds: true }).standfirst)
      .toMatch(/^Testflix är gratis med reklam i Sverige\./);
  });

  it('drops the price sentence when the catalog has none', () => {
    const copy = providerHubCopy({ ...paid, defaultMonthlyCost: undefined, tiers: undefined });
    expect(copy.standfirst).not.toMatch(/kr/);
  });

  it('every curated hub gets copy, and its price is the catalog number', () => {
    for (const pid of SEO_PROVIDER_IDS) {
      const p = getProvider(pid)!;
      const copy = providerHubCopy(p);
      expect(copy.standfirst).toContain(p.name);
      const { cost } = cheapestEntertainmentTierFrom(p);
      if (!p.isFree && !p.isAds && cost > 0) expect(copy.standfirst).toContain(`från ${cost} kr`);
    }
  });
});
