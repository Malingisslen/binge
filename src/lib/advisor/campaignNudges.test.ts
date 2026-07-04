import { describe, it, expect } from 'vitest';
import { computeCampaignNudges } from './campaignNudges';

// Netflix (8) ordinary 169. now well before the fixture end dates.
const NOW = new Date(2026, 8, 28); // 2026-09-28

describe('computeCampaignNudges (BIN-417 Phase B)', () => {
  it('returns a nudge for a campaign ending within the window with a real rise', () => {
    const rows = computeCampaignNudges(
      { 8: { monthlyCost: 29, endDate: '2026-10-01' } }, // ends in 3 days, +140 kr
      {},
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].providerId).toBe(8);
    expect(rows[0].providerName).toBe('Netflix');
    expect(rows[0].nudge.daysUntilEnd).toBe(3);
    expect(rows[0].nudge.ordinaryMonthlyCost).toBe(169);
    expect(rows[0].nudge.increaseKr).toBe(140);
  });

  it('is silent when the campaign ends outside the warn window', () => {
    const rows = computeCampaignNudges(
      { 8: { monthlyCost: 29, endDate: '2026-12-01' } }, // far off
      {},
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('is silent when the campaign has already lapsed (no more nudge, price already reverted)', () => {
    const rows = computeCampaignNudges(
      { 8: { monthlyCost: 29, endDate: '2026-09-01' } }, // past
      {},
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('is silent when the price does not actually rise (campaign ≥ ordinary)', () => {
    // Custom ordinary 25 < campaign 29 → no rise → no nag.
    const rows = computeCampaignNudges(
      { 8: { monthlyCost: 29, endDate: '2026-10-01' } },
      { providerCosts: { 8: 25 } },
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it('sorts multiple nudges most-urgent (soonest expiry) first', () => {
    const rows = computeCampaignNudges(
      {
        8: { monthlyCost: 29, endDate: '2026-10-02' },   // 4 days
        337: { monthlyCost: 19, endDate: '2026-09-30' }, // 2 days (Disney+ ordinary 109)
      },
      {},
      NOW,
    );
    expect(rows.map(r => r.providerId)).toEqual([337, 8]);
  });

  it('returns nothing for no campaigns or an unknown provider', () => {
    expect(computeCampaignNudges(undefined, {}, NOW)).toEqual([]);
    expect(computeCampaignNudges({ 999999: { monthlyCost: 29, endDate: '2026-10-01' } }, {}, NOW)).toEqual([]);
  });
});
