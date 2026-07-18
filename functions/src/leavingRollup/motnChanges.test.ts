import { describe, it, expect } from 'vitest';
import { MAX_PAGES, LEAVING_HARD_CYCLE_CAP, CADENCE_HOURS } from './config';

// BIN-543: pins the safety-margin proof from index.ts's LEAVING_HARD_CYCLE_CAP
// comment as an actual assertion, not just a comment nobody re-checks on a
// future edit. Test review (2026-07-18): a first version hand-duplicated
// CADENCE_HOURS/LEAVING_HARD_CYCLE_CAP as local literals — that only caught a
// MAX_PAGES regression, not a cadence/cap regression, since the literals
// never actually tracked the real constants. All three now live-imported
// from ./config.ts (admin-free AND firebase-functions-free — importing
// MAX_PAGES from motnChanges.ts directly broke CI, see MAX_PAGES's doc
// comment in config.ts).
describe('MAX_PAGES safety margin (BIN-543: must survive a full ~31-day cycle)', () => {
  const CYCLE_DAYS = 31; // MOTN's own /changes window ceiling, worst-case cycle length

  it('worst case (every run maxes out MAX_PAGES) never exceeds the cycle budget', () => {
    const runsPerCycle = Math.ceil((CYCLE_DAYS * 24) / CADENCE_HOURS);
    expect(runsPerCycle).toBe(8); // pins the arithmetic index.ts's comment states (18 × 8 = 144)
    expect(runsPerCycle * MAX_PAGES).toBeLessThanOrEqual(LEAVING_HARD_CYCLE_CAP);
  });
});
