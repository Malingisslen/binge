import { describe, it, expect } from 'vitest';
import { resolveEffectiveMonthlyCost } from './effectiveCost';

// Netflix (id 8): Standard tier 169, defaultMonthlyCost 169. SkyShowtime canonical
// 431, alias 531 (defunct Paramount+). Unknown provider 999999.
const NOW = new Date(2026, 6, 4); // 2026-07-04 local (Stockholm under test TZ)

describe('resolveEffectiveMonthlyCost (BIN-417 campaign-aware cost)', () => {
  it('returns the ordinary price when there is no campaign', () => {
    expect(resolveEffectiveMonthlyCost(8, {}, NOW)).toBe(169);
    expect(
      resolveEffectiveMonthlyCost(8, { providerCosts: { 8: 120 } }, NOW),
    ).toBe(120); // custom ordinary respected
  });

  it('returns the campaign price while the campaign is active', () => {
    const cost = resolveEffectiveMonthlyCost(
      8,
      { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } },
      NOW,
    );
    expect(cost).toBe(29);
  });

  it('AUTO-REVERTS to the ordinary price the day after the campaign ends', () => {
    const dayAfter = new Date(2026, 9, 2); // 2026-10-02, campaign ended 2026-10-01
    const cost = resolveEffectiveMonthlyCost(
      8,
      { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } },
      dayAfter,
    );
    expect(cost).toBe(169); // ordinary, no manual cleanup
  });

  it('counts the last campaign day as still active (inclusive endDate)', () => {
    const lastDay = new Date(2026, 9, 1); // 2026-10-01 exactly
    const cost = resolveEffectiveMonthlyCost(
      8,
      { providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } } },
      lastDay,
    );
    expect(cost).toBe(29);
  });

  it('fail-safes to ordinary on an invalid campaign (never free / never stale-cheap)', () => {
    const settings = { providerCosts: { 8: 150 } };
    // 0 / negative / NaN cost, and a malformed date — all revert to ordinary 150.
    expect(resolveEffectiveMonthlyCost(8, { ...settings, providerCampaigns: { 8: { monthlyCost: 0, endDate: '2026-10-01' } } }, NOW)).toBe(150);
    expect(resolveEffectiveMonthlyCost(8, { ...settings, providerCampaigns: { 8: { monthlyCost: -5, endDate: '2026-10-01' } } }, NOW)).toBe(150);
    expect(resolveEffectiveMonthlyCost(8, { ...settings, providerCampaigns: { 8: { monthlyCost: 29, endDate: 'not-a-date' } } }, NOW)).toBe(150);
  });

  it('resolves an alias-keyed provider against a canonical-keyed campaign', () => {
    // SkyShowtime canonical 431; look up via alias 531. Campaign stored under 431.
    const cost = resolveEffectiveMonthlyCost(
      531,
      { providerCampaigns: { 431: { monthlyCost: 39, endDate: '2026-10-01' } } },
      NOW,
    );
    expect(cost).toBe(39);
  });

  it('returns null for an unknown provider (a campaign cannot invent a cost)', () => {
    expect(
      resolveEffectiveMonthlyCost(999999, { providerCampaigns: { 999999: { monthlyCost: 29, endDate: '2026-10-01' } } }, NOW),
    ).toBeNull();
  });

  it('applies the campaign over a chosen tier while active, then reverts to that tier price', () => {
    const user = {
      providerTiers: { 8: 'premium' }, // Netflix Premium = 219 ordinary
      providerCampaigns: { 8: { monthlyCost: 99, endDate: '2026-10-01' } },
    };
    expect(resolveEffectiveMonthlyCost(8, user, NOW)).toBe(99); // active → campaign
    const dayAfter = new Date(2026, 9, 2);
    expect(resolveEffectiveMonthlyCost(8, user, dayAfter)).toBe(219); // reverted → tier
  });
});
