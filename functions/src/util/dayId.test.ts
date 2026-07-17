import { describe, it, expect } from 'vitest';
import { stockholmDayId, motnBillingCycleId } from './dayId';

// BIN-350: the shared day-id is the single source of truth for product-facing
// daily/period buckets across scheduled functions. These cases pin the exact
// behavior the migration relies on: late-night UTC instants roll into the next
// Stockholm day, and the offset is DST-aware (CET +1 winter, CEST +2 summer).
describe('stockholmDayId — shared Stockholm-local day-id (BIN-350)', () => {
  it('rolls a late-evening winter (CET, +1) UTC instant into the next Stockholm day', () => {
    // 23:30Z in January is 00:30 the next day in Stockholm.
    expect(stockholmDayId(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('rolls a late-evening summer (CEST, +2) UTC instant into the next Stockholm day', () => {
    // 22:30Z in July is 00:30 the next day in Stockholm.
    expect(stockholmDayId(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-16');
  });

  it('keeps a midday UTC instant on the same Stockholm day', () => {
    expect(stockholmDayId(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15');
  });

  it('formats as YYYY-MM-DD (lexicographically chronological, matches doc-id shape)', () => {
    expect(stockholmDayId(new Date('2026-07-15T22:30:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('early-morning summer instant stays on its Stockholm day (just after local midnight)', () => {
    // 00:30Z in July is 02:30 Stockholm — same date, no rollback.
    expect(stockholmDayId(new Date('2026-07-16T00:30:00Z'))).toBe('2026-07-16');
  });
});

// BIN-541: MOTN's real Basic plan is 500/MONTH (verified on the RapidAPI dashboard
// 2026-07-17), not the 100/day BIN-320 assumed. The subscription was created on the
// 21st, so the billing cycle is anchored there (default anchorDay=21) rather than
// resetting on the UTC calendar month.
describe('motnBillingCycleId — MOTN billing-cycle anchor (BIN-541)', () => {
  it('stays in the prior cycle on the anchor day itself and after it', () => {
    expect(motnBillingCycleId(new Date('2026-07-21T00:00:00Z'))).toBe('2026-07-21');
    expect(motnBillingCycleId(new Date('2026-07-25T12:00:00Z'))).toBe('2026-07-21');
  });

  it('stays in the prior cycle through the day before the next anchor', () => {
    expect(motnBillingCycleId(new Date('2026-08-20T23:59:59Z'))).toBe('2026-07-21');
  });

  it('rolls into the new cycle exactly on the next anchor day', () => {
    expect(motnBillingCycleId(new Date('2026-08-21T00:00:00Z'))).toBe('2026-08-21');
  });

  it('rolls the year over when the anchor falls in December/January', () => {
    expect(motnBillingCycleId(new Date('2026-12-25T00:00:00Z'))).toBe('2026-12-21');
    expect(motnBillingCycleId(new Date('2027-01-05T00:00:00Z'))).toBe('2026-12-21');
    expect(motnBillingCycleId(new Date('2027-01-21T00:00:00Z'))).toBe('2027-01-21');
  });

  it('handles a short month (Feb) with a custom anchor beyond its last day gracefully', () => {
    // anchorDay=30: Feb never reaches day 30, so early-Feb dates stay in Jan's cycle.
    expect(motnBillingCycleId(new Date('2027-02-15T00:00:00Z'), 30)).toBe('2027-01-30');
  });

  // BIN-541 code review (2026-07-17): the naive version of this function used the
  // UNCLAMPED anchorDay to decide the return year/month, producing "2027-02-30" —
  // a cycle id for a date that never occurred — for every day in March up to the
  // 29th. That silently started an extra, unintended cycle a month early (never
  // reached the vendor's real 30th), resetting the Firestore quota counter and
  // re-granting fresh MOTN budget before the vendor's quota had actually refilled.
  // These cases trace a FULL month-by-month rollover with anchorDay=30 to prove
  // exactly one cycle boundary exists per calendar month, none skipped or doubled.
  describe('anchorDay beyond a short month does not fabricate a nonexistent cycle boundary', () => {
    const ANCHOR = 30;

    it('Jan 30 itself starts its own cycle (Jan has a 30th)', () => {
      expect(motnBillingCycleId(new Date('2027-01-30T00:00:00Z'), ANCHOR)).toBe('2027-01-30');
    });

    it('Feb 28 (last day of a non-leap Feb) rolls onto ITS OWN new cycle, clamped to Feb 28 — not still Jan\'s', () => {
      expect(motnBillingCycleId(new Date('2027-02-28T00:00:00Z'), ANCHOR)).toBe('2027-02-28');
    });

    it('March 1-29 stay in the SAME cycle Feb 28 started (not a fabricated "Feb 30")', () => {
      expect(motnBillingCycleId(new Date('2027-03-01T00:00:00Z'), ANCHOR)).toBe('2027-02-28');
      expect(motnBillingCycleId(new Date('2027-03-29T23:59:59Z'), ANCHOR)).toBe('2027-02-28');
    });

    it('March 30 rolls into its own new cycle (March has a real 30th)', () => {
      expect(motnBillingCycleId(new Date('2027-03-30T00:00:00Z'), ANCHOR)).toBe('2027-03-30');
    });

    it('a leap-year Feb 29 is its own cycle start, distinct from Feb 28 the year before', () => {
      expect(motnBillingCycleId(new Date('2028-02-29T00:00:00Z'), ANCHOR)).toBe('2028-02-29');
      expect(motnBillingCycleId(new Date('2028-03-01T00:00:00Z'), ANCHOR)).toBe('2028-02-29');
    });
  });

  it('is UTC-based, not Stockholm-local (a vendor-quota window, per dayId.ts convention)', () => {
    // 23:30Z on the 20th is already the 21st in Stockholm (CEST, +2) — but the
    // vendor's own clock is UTC, so this must NOT roll into the new cycle yet.
    expect(motnBillingCycleId(new Date('2026-07-20T23:30:00Z'))).toBe('2026-06-21');
  });
});
