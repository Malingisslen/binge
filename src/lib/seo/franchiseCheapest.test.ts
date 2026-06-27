import { describe, it, expect } from 'vitest';
import { franchisePlan, type FranchiseFilm } from './franchiseCheapest';

// Real provider ids/costs from SWEDISH_PROVIDERS: Netflix 8 (149), Prime 119
// (69), Disney+ 337 (109), Max 384 (149), SVT 520 (0, free). Max alias 1899.
const film = (
  tmdbId: number,
  subs: number[],
  rentable = false,
  title = `Film ${tmdbId}`,
): FranchiseFilm => ({ tmdbId, title, year: '2010', subscriptionProviderIds: subs, rentable });

describe('franchisePlan', () => {
  it('picks the subscription covering the most films', () => {
    const plan = franchisePlan([
      film(1, [337]), film(2, [337]), film(3, [337]), // Disney+ covers 3
      film(4, [8]),                                    // Netflix covers 1
    ]);
    expect(plan.bestProviderId).toBe(337);
    expect(plan.bestProviderName).toBe('Disney+');
    expect(plan.bestProviderMonthlyCost).toBe(109);
    expect(plan.coveredCount).toBe(3);
    expect(plan.totalFilms).toBe(4);
  });

  it('breaks a coverage tie toward the free public service', () => {
    const plan = franchisePlan([
      film(1, [520]), film(2, [520]), // SVT (free) covers 2
      film(3, [8]), film(4, [8]),     // Netflix covers 2
    ]);
    expect(plan.bestProviderId).toBe(520);
    expect(plan.bestProviderMonthlyCost).toBe(0);
  });

  it('breaks a coverage tie (no free option) toward the cheapest monthly cost', () => {
    const plan = franchisePlan([
      film(1, [8]), film(2, [8]),     // Netflix 149 covers 2
      film(3, [119]), film(4, [119]), // Prime 69 covers 2
    ]);
    expect(plan.bestProviderId).toBe(119); // cheaper
  });

  it('reports remainder, rent count, and unavailable count', () => {
    const plan = franchisePlan([
      film(1, [337]), film(2, [337]),   // covered by Disney+
      film(3, [], true),                // not streaming, but rentable
      film(4, [], false),               // nowhere in SE
    ]);
    expect(plan.bestProviderId).toBe(337);
    expect(plan.coveredCount).toBe(2);
    expect(plan.remainder.map((r) => r.tmdbId)).toEqual([3, 4]);
    expect(plan.rentCount).toBe(1);
    expect(plan.unavailableCount).toBe(1);
  });

  it('counts a film on a different subscription than the plan as not-on-plan', () => {
    const plan = franchisePlan([
      film(1, [337]), film(2, [337]), // Disney+ wins (2)
      film(3, [8], false),            // on Netflix only, not rentable → unavailable via this plan
    ]);
    expect(plan.bestProviderId).toBe(337);
    expect(plan.coveredCount).toBe(2);
    expect(plan.remainder.map((r) => r.tmdbId)).toEqual([3]);
    expect(plan.rentCount).toBe(0);
    expect(plan.unavailableCount).toBe(1);
  });

  it('canonicalises aliased provider ids (Max 1899 -> 384)', () => {
    const plan = franchisePlan([film(1, [1899]), film(2, [384])]);
    expect(plan.bestProviderId).toBe(384);
    expect(plan.coveredCount).toBe(2);
  });

  it('handles an all-rent franchise (no streaming anywhere)', () => {
    const plan = franchisePlan([film(1, [], true), film(2, [], true)]);
    expect(plan.bestProviderId).toBeNull();
    expect(plan.bestProviderName).toBeNull();
    expect(plan.coveredCount).toBe(0);
    expect(plan.rentCount).toBe(2);
    expect(plan.unavailableCount).toBe(0);
  });

  it('handles an empty collection', () => {
    const plan = franchisePlan([]);
    expect(plan).toMatchObject({
      totalFilms: 0, bestProviderId: null, coveredCount: 0, rentCount: 0, unavailableCount: 0,
    });
    expect(plan.remainder).toEqual([]);
  });
});
