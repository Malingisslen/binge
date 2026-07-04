import { describe, it, expect } from 'vitest';
import { cheapestListPlan, type ListTitle } from './listOptimizer';

// Real provider ids/costs from SWEDISH_PROVIDERS: Netflix 8 (169), Prime 119
// (69), Disney+ 337 (109), Max 384 (149, alias 1899), Viaplay 76 (169),
// SVT 520 (0, isFree), TV4 489 (169, alias 1944), Apple TV+ 350 (119),
// Pluto TV 300 (0, isAds — NOT isFree).
const title = (
  tmdbId: number,
  subs: number[],
  rentable = false,
): ListTitle => ({ tmdbId, title: `Title ${tmdbId}`, subscriptionProviderIds: subs, rentable });

describe('cheapestListPlan — BIN-417 campaign-aware cost', () => {
  it('uses the campaign price while active, then reverts to ordinary past its end date', () => {
    const titles = [title(1, [8]), title(2, [8])]; // both on Netflix (ordinary 169)
    const user = { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } };
    const during = cheapestListPlan(titles, user, new Date(2026, 8, 1)); // 2026-09-01
    expect(during.bestSingle.providerId).toBe(8);
    expect(during.bestSingle.monthlyKr).toBe(29); // campaign price flows into the plan
    expect(during.fullPlan.monthlyKr).toBe(29);
    const after = cheapestListPlan(titles, user, new Date(2026, 9, 2)); // 2026-10-02
    expect(after.bestSingle.monthlyKr).toBe(169); // auto-reverted to ordinary
  });
});

describe('cheapestListPlan — best single subscription', () => {
  it('picks the single subscription that covers the most of the list', () => {
    const plan = cheapestListPlan([
      ...Array.from({ length: 8 }, (_, i) => title(i + 1, [76])), // 8 on Viaplay
      title(9, [8]),                                              // Netflix
      title(10, [337]),                                           // Disney+
      title(11, [], true),                                        // rent only
      title(12, [], false),                                       // nowhere
    ]);
    expect(plan.totalTitles).toBe(12);
    expect(plan.bestSingle.providerId).toBe(76);
    expect(plan.bestSingle.providerName).toBe('Viaplay');
    expect(plan.bestSingle.monthlyKr).toBe(169); // Viaplay live cost — NOT inflated by the rentable remainder
    expect(plan.bestSingle.coveredCount).toBe(8);
    expect(plan.bestSingle.remainder.map((r) => r.tmdbId)).toEqual([9, 10, 11, 12]);
    expect(plan.bestSingle.rentCount).toBe(1);       // title 11
    expect(plan.bestSingle.unavailableCount).toBe(3); // 9, 10 (other subs), 12
  });

  it('breaks a coverage tie toward the free public service (isFree), not a 0-kr ads service', () => {
    // SVT (520, isFree) and Pluto (300, isAds, 0 kr) each cover 2. Netflix covers 2.
    const plan = cheapestListPlan([
      title(1, [520]), title(2, [520]),
      title(3, [300]), title(4, [300]),
      title(5, [8]), title(6, [8]),
    ]);
    expect(plan.bestSingle.providerId).toBe(520); // free wins the tie
    expect(plan.bestSingle.monthlyKr).toBe(0);
  });

  it('does NOT treat a 0-kr ads service as free — Pluto loses a tie to a paid service on the cost rung only when coverage ties', () => {
    // Pluto (300, 0 kr, ads) vs Prime (119, 69 kr): equal coverage. Free gating is
    // on isFree, so Pluto is not "free"; but on the *cost* rung 0 < 69, so Pluto
    // still wins by raw incremental cost. The point of this test: it must NOT win
    // via the isFree rung (which would wrongly rank it ABOVE an actually-free SVT).
    const plan = cheapestListPlan([
      title(1, [300]), title(2, [520]), // Pluto covers 1, SVT covers 1 — tie
    ]);
    // SVT is isFree → wins the isFree rung over Pluto despite equal 0 cost.
    expect(plan.bestSingle.providerId).toBe(520);
  });

  it('breaks a coverage tie (no free option) toward the cheapest live monthly cost', () => {
    const plan = cheapestListPlan([
      title(1, [8]), title(2, [8]),     // Netflix 169
      title(3, [119]), title(4, [119]), // Prime 69
    ]);
    expect(plan.bestSingle.providerId).toBe(119);
  });

  it('uses the user\'s own cost (chosen tier / custom) and treats an owned service as 0 kr incremental', () => {
    // User already owns Viaplay (76). It should read as 0 kr incremental and win.
    const plan = cheapestListPlan(
      [title(1, [76]), title(2, [76]), title(3, [8])],
      { ownedProviderIds: [76] },
    );
    expect(plan.bestSingle.providerId).toBe(76);
    expect(plan.bestSingle.monthlyKr).toBe(0); // already paid for
  });

  it('canonicalises aliased provider ids before counting (Max 1899 -> 384)', () => {
    const plan = cheapestListPlan([title(1, [1899]), title(2, [384])]);
    expect(plan.bestSingle.providerId).toBe(384);
    expect(plan.bestSingle.coveredCount).toBe(2);
  });

  it('drops an uncatalogued provider id — never treats an unpriceable service as a 0-kr free win', () => {
    // 999999 is not in SWEDISH_PROVIDERS. A title only on it is not a streamable,
    // priceable path: it must fall to rent/unavailable, not win "cheapest" at 0 kr.
    const plan = cheapestListPlan([
      title(1, [8]),            // Netflix (catalogued)
      title(2, [999999], false), // only on an uncatalogued service, not rentable
    ]);
    expect(plan.bestSingle.providerId).toBe(8); // Netflix, never the phantom 999999
    expect(plan.streamableCount).toBe(1);
    expect(plan.bestSingle.remainder.map((r) => r.tmdbId)).toEqual([2]);
    expect(plan.bestSingle.unavailableCount).toBe(1);
    expect(plan.fullPlan.serviceIds).toEqual([8]);
    expect(plan.fullPlan.unavailableCount).toBe(1);
  });
});

describe('cheapestListPlan — full coverage plan (set cover)', () => {
  it('finds the cheapest set of subscriptions covering every streamable title', () => {
    // Prime (69) covers 1,2; Netflix (169) covers 3. Cheapest full cover = both.
    const plan = cheapestListPlan([
      title(1, [119]), title(2, [119]), title(3, [8]),
    ]);
    expect(plan.fullPlan.serviceIds.sort((a, b) => a - b)).toEqual([8, 119]);
    expect(plan.fullPlan.monthlyKr).toBe(169 + 69);
    expect(plan.fullPlan.streamableCovered).toBe(3);
  });

  it('prefers a free service in the set cover when it covers uniquely', () => {
    const plan = cheapestListPlan([
      title(1, [520]), // only on SVT (free)
      title(2, [119]), // only on Prime
    ]);
    expect(plan.fullPlan.serviceIds.sort((a, b) => a - b)).toEqual([119, 520]);
    expect(plan.fullPlan.monthlyKr).toBe(69); // SVT is 0
  });

  it('computes saving vs subscribing to every distinct service (naive), never negative', () => {
    // Titles: two both on Prime+Netflix, one only Netflix. Naive = Prime+Netflix.
    // Cheapest full cover = Netflix alone (covers all three).
    const plan = cheapestListPlan([
      title(1, [8, 119]), title(2, [8, 119]), title(3, [8]),
    ]);
    expect(plan.naiveMonthlyKr).toBe(169 + 69);
    expect(plan.fullPlan.serviceIds).toEqual([8]);
    expect(plan.fullPlan.monthlyKr).toBe(169);
    expect(plan.savingKr).toBe(69);
    expect(plan.savingKr).toBeGreaterThanOrEqual(0);
  });

  it('never fabricates a rent/buy price — remainder is only counted', () => {
    const plan = cheapestListPlan([
      title(1, [8]),          // streamable
      title(2, [], true),     // rent only
      title(3, [], false),    // unavailable
    ]);
    expect(plan.fullPlan.serviceIds).toEqual([8]);
    expect(plan.fullPlan.monthlyKr).toBe(169);
    expect(plan.fullPlan.rentCount).toBe(1);
    expect(plan.fullPlan.unavailableCount).toBe(1);
    expect(plan.streamableCount).toBe(1);
  });
});

describe('cheapestListPlan — edge cases', () => {
  it('handles an empty list without dividing by zero', () => {
    const plan = cheapestListPlan([]);
    expect(plan).toMatchObject({
      totalTitles: 0,
      streamableCount: 0,
      naiveMonthlyKr: 0,
      savingKr: 0,
    });
    expect(plan.bestSingle.providerId).toBeNull();
    expect(plan.bestSingle.coveredCount).toBe(0);
    expect(plan.fullPlan.serviceIds).toEqual([]);
    expect(plan.fullPlan.monthlyKr).toBe(0);
  });

  it('handles an all-rent list (nothing streams anywhere)', () => {
    const plan = cheapestListPlan([title(1, [], true), title(2, [], true)]);
    expect(plan.bestSingle.providerId).toBeNull();
    expect(plan.fullPlan.serviceIds).toEqual([]);
    expect(plan.fullPlan.rentCount).toBe(2);
    expect(plan.fullPlan.unavailableCount).toBe(0);
    expect(plan.streamableCount).toBe(0);
  });

  it('is deterministic on a three-way single-title tie (lowest id wins the single pick)', () => {
    const plan = cheapestListPlan([title(1, [337]), title(2, [384]), title(3, [8])]);
    // Each covers exactly 1; costs Disney+ 109, Max 149, Netflix 169. Cheapest = Disney+ (337).
    expect(plan.bestSingle.providerId).toBe(337);
  });
});
