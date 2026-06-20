import { describe, it, expect } from 'vitest';
import { offerForProvider, isLeavingSoon, daysUntilLeaving, formatLeaving } from './offers';
import type { Offer } from './offers';

const sub = (o: Partial<Offer>): Offer => ({
  providerId: 8, type: 'subscription', link: 'x', priceAmount: null, priceCurrency: null, leaving: null, ...o,
});
const now = Date.parse('2026-06-20T00:00:00Z');

describe('offerForProvider', () => {
  it('matches by providerId', () => {
    const offers = [sub({ providerId: 8 }), sub({ providerId: 337 })];
    expect(offerForProvider(offers, 337)?.providerId).toBe(337);
  });
  it('returns undefined when no match', () => {
    expect(offerForProvider([sub({ providerId: 8 })], 999)).toBeUndefined();
  });
});

describe('isLeavingSoon', () => {
  it('true when leaving within the window', () => {
    expect(isLeavingSoon(sub({ leaving: '2026-06-28' }), now, 14)).toBe(true);
  });
  it('false when no leaving date', () => {
    expect(isLeavingSoon(sub({ leaving: null }), now, 14)).toBe(false);
  });
  it('false when leaving is far away', () => {
    expect(isLeavingSoon(sub({ leaving: '2026-09-01' }), now, 14)).toBe(false);
  });
  it('false for undefined offer', () => {
    expect(isLeavingSoon(undefined, now, 14)).toBe(false);
  });
});

describe('daysUntilLeaving', () => {
  it('counts whole days', () => {
    expect(daysUntilLeaving(sub({ leaving: '2026-06-25' }), now)).toBe(5);
  });
  it('null when no date', () => {
    expect(daysUntilLeaving(sub({ leaving: null }), now)).toBeNull();
  });
});

describe('formatLeaving', () => {
  it('formats a Swedish short date', () => {
    expect(formatLeaving(sub({ leaving: '2026-06-30' }))).toMatch(/lämnar/i);
  });
});
