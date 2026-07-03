import { describe, it, expect } from 'vitest';
import { resolveCampaignCost, campaignExpiryNudge, type ProviderCampaign } from './campaignPricing';

// endDate is inclusive ("t.o.m."): the campaign price applies through that local
// day. Construct Dates from numeric components (local time) so the tests are
// timezone-stable regardless of where they run.
const campaign = (monthlyCost: number, endDate: string): ProviderCampaign => ({ monthlyCost, endDate });
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0); // local noon

describe('resolveCampaignCost — auto-revert', () => {
  it('returns the campaign price while active (before end date)', () => {
    const r = resolveCampaignCost(campaign(29, '2026-10-01'), 149, at(2026, 9, 24));
    expect(r.isCampaignActive).toBe(true);
    expect(r.effectiveMonthlyCost).toBe(29);
    expect(r.daysUntilEnd).toBe(7);
  });

  it('counts the last day (t.o.m.) as still active — daysUntilEnd 0', () => {
    const r = resolveCampaignCost(campaign(29, '2026-10-01'), 149, at(2026, 10, 1));
    expect(r.isCampaignActive).toBe(true);
    expect(r.effectiveMonthlyCost).toBe(29);
    expect(r.daysUntilEnd).toBe(0);
  });

  it('auto-reverts to the ordinary price the day after end date (no manual cleanup)', () => {
    const r = resolveCampaignCost(campaign(29, '2026-10-01'), 149, at(2026, 10, 2));
    expect(r.isCampaignActive).toBe(false);
    expect(r.effectiveMonthlyCost).toBe(149);
    expect(r.daysUntilEnd).toBeNull();
  });
});

describe('resolveCampaignCost — fail-safe to ordinary (never free, never stale-cheap)', () => {
  it('fails safe when monthlyCost is 0 — must NOT read as a free subscription', () => {
    const r = resolveCampaignCost(campaign(0, '2026-10-01'), 149, at(2026, 9, 24));
    expect(r.isCampaignActive).toBe(false);
    expect(r.effectiveMonthlyCost).toBe(149);
  });

  it('fails safe on a negative or NaN monthlyCost', () => {
    expect(resolveCampaignCost(campaign(-5, '2026-10-01'), 149, at(2026, 9, 24)).effectiveMonthlyCost).toBe(149);
    expect(resolveCampaignCost(campaign(NaN, '2026-10-01'), 149, at(2026, 9, 24)).effectiveMonthlyCost).toBe(149);
  });

  it('fails safe on a malformed end date', () => {
    const r = resolveCampaignCost(campaign(29, 'inte-ett-datum'), 149, at(2026, 9, 24));
    expect(r.isCampaignActive).toBe(false);
    expect(r.effectiveMonthlyCost).toBe(149);
    expect(r.daysUntilEnd).toBeNull();
  });

  it('fails safe on a null / undefined campaign', () => {
    expect(resolveCampaignCost(null, 149, at(2026, 9, 24)).effectiveMonthlyCost).toBe(149);
    expect(resolveCampaignCost(undefined, 149, at(2026, 9, 24)).effectiveMonthlyCost).toBe(149);
    expect(resolveCampaignCost(null, 149, at(2026, 9, 24)).isCampaignActive).toBe(false);
  });
});

describe('resolveCampaignCost — invariant: inactive ⟺ effective === ordinary', () => {
  it('holds across a full date sweep around the boundary (no third path)', () => {
    const c = campaign(29, '2026-10-01');
    // Sweep Sep 20 .. Oct 12 (JS Date normalises day overflow).
    for (let day = 20; day <= 42; day++) {
      const now = new Date(2026, 8, day, 12);
      const r = resolveCampaignCost(c, 149, now);
      expect(r.isCampaignActive === false).toBe(r.effectiveMonthlyCost === 149);
      expect(r.effectiveMonthlyCost).toBe(r.isCampaignActive ? 29 : 149);
    }
  });
});

describe('campaignExpiryNudge', () => {
  it('fires inside the warn window when the price will actually rise', () => {
    const n = campaignExpiryNudge(campaign(29, '2026-10-01'), 149, at(2026, 9, 26), 7);
    expect(n).not.toBeNull();
    expect(n!.daysUntilEnd).toBe(5);
    expect(n!.increaseKr).toBe(120);
    expect(n!.campaignMonthlyCost).toBe(29);
    expect(n!.ordinaryMonthlyCost).toBe(149);
  });

  it('fires on the last day (daysUntilEnd 0 ≤ warnWithinDays)', () => {
    expect(campaignExpiryNudge(campaign(29, '2026-10-01'), 149, at(2026, 10, 1), 7)).not.toBeNull();
  });

  it('stays silent when the end is beyond the warn window', () => {
    expect(campaignExpiryNudge(campaign(29, '2026-10-01'), 149, at(2026, 9, 1), 7)).toBeNull();
  });

  it('stays silent after the campaign has expired', () => {
    expect(campaignExpiryNudge(campaign(29, '2026-10-01'), 149, at(2026, 10, 5), 7)).toBeNull();
  });

  it('stays silent when the ordinary price is not genuinely higher (equal, priced-above, or sub-krona)', () => {
    expect(campaignExpiryNudge(campaign(149, '2026-10-01'), 149, at(2026, 9, 28), 7)).toBeNull(); // equal
    expect(campaignExpiryNudge(campaign(149.001, '2026-10-01'), 149, at(2026, 9, 28), 7)).toBeNull(); // priced above ordinary
    // a genuine but sub-krona increase (+0.6 kr) is below the 1-kr threshold → no nag
    expect(campaignExpiryNudge(campaign(148.4, '2026-10-01'), 149, at(2026, 9, 28), 7)).toBeNull();
  });

  it('rounds the displayed increase to whole kr on a genuine ≥1 kr rise', () => {
    // +120.6 kr: fires (≥1 kr), and increaseKr is round(120.6) = 121 — remove the
    // Math.round and this reads 120.6, so this pins the display rounding.
    const n = campaignExpiryNudge(campaign(28.4, '2026-10-01'), 149, at(2026, 9, 28), 7);
    expect(n).not.toBeNull();
    expect(n!.increaseKr).toBe(121);
  });

  it('stays silent on a fail-safe (invalid) campaign', () => {
    expect(campaignExpiryNudge(campaign(0, '2026-10-01'), 149, at(2026, 9, 28), 7)).toBeNull();
  });
});
