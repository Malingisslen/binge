import { describe, it, expect } from 'vitest';
import { isValidBillingDay, nextRenewalDate, daysUntilRenewal, MAX_BILLING_DAY } from './renewal';

describe('isValidBillingDay', () => {
  it('accepts 1–28, rejects out-of-range and non-integers', () => {
    expect(isValidBillingDay(1)).toBe(true);
    expect(isValidBillingDay(28)).toBe(true);
    expect(isValidBillingDay(0)).toBe(false);
    expect(isValidBillingDay(29)).toBe(false);
    expect(isValidBillingDay(31)).toBe(false);
    expect(isValidBillingDay(15.5)).toBe(false);
    expect(isValidBillingDay(NaN)).toBe(false);
  });
  it('MAX_BILLING_DAY is 28 (avoids month-length edge cases)', () => {
    expect(MAX_BILLING_DAY).toBe(28);
    expect(isValidBillingDay(MAX_BILLING_DAY)).toBe(true);
  });
});

describe('nextRenewalDate', () => {
  it('returns this month when the billing day is still ahead', () => {
    const from = new Date(2026, 5, 10); // 10 Jun 2026
    expect(nextRenewalDate(20, from)).toEqual(new Date(2026, 5, 20));
  });
  it('returns next month when the billing day has passed', () => {
    const from = new Date(2026, 5, 25); // 25 Jun
    expect(nextRenewalDate(20, from)).toEqual(new Date(2026, 6, 20)); // 20 Jul
  });
  it('treats today as this-month (not passed)', () => {
    const from = new Date(2026, 5, 20);
    expect(nextRenewalDate(20, from)).toEqual(new Date(2026, 5, 20));
  });
  it('rolls a December billing day into next year', () => {
    const from = new Date(2026, 11, 25); // 25 Dec
    expect(nextRenewalDate(10, from)).toEqual(new Date(2027, 0, 10)); // 10 Jan 2027
  });
  it('day 28 lands on Feb 28 — pins that the 28-cap is safe in the short month', () => {
    // The cap exists so the billing day always exists; 28 is valid even in Feb.
    expect(nextRenewalDate(28, new Date(2027, 1, 1))).toEqual(new Date(2027, 1, 28));
  });
});

describe('daysUntilRenewal', () => {
  it('0 when today is the billing day', () => {
    expect(daysUntilRenewal(20, new Date(2026, 5, 20))).toBe(0);
  });
  it('counts forward within the month', () => {
    expect(daysUntilRenewal(20, new Date(2026, 5, 10))).toBe(10);
  });
  it('counts into next month when passed', () => {
    // 25 Jun → next is 1 Jul = 6 days (Jun has 30 days: 26,27,28,29,30,1)
    expect(daysUntilRenewal(1, new Date(2026, 5, 25))).toBe(6);
  });
  it('counts across the year boundary (Dec→Jan)', () => {
    // 25 Dec → next 10 Jan: 6 remaining Dec days (26..31) + 10 = 16.
    expect(daysUntilRenewal(10, new Date(2026, 11, 25))).toBe(16);
  });
});
