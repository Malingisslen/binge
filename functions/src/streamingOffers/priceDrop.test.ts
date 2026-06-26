import { describe, it, expect } from 'vitest';
import { detectPriceDrop } from './priceDrop';
import type { PricePoint } from './priceHistory';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function p(daysAgo: number, amount: number, currency = 'SEK'): PricePoint {
  return { at: NOW - daysAgo * DAY, amount, currency };
}

describe('detectPriceDrop', () => {
  it('returns null with fewer than two points', () => {
    expect(detectPriceDrop([p(0, 49)], { nowMs: NOW })).toBeNull();
    expect(detectPriceDrop([], { nowMs: NOW })).toBeNull();
  });

  it('flags a fresh drop (last < prev) and reports both prices + multi-month-low', () => {
    const signal = detectPriceDrop([p(10, 79), p(0, 39)], { nowMs: NOW });
    expect(signal).not.toBeNull();
    expect(signal!.amount).toBe(39);
    expect(signal!.previousAmount).toBe(79);
    expect(signal!.currency).toBe('SEK');
    expect(signal!.isMultiMonthLow).toBe(true); // 39 beats the only prior in-window point (79)
  });

  it('ignores a price increase', () => {
    expect(detectPriceDrop([p(10, 39), p(0, 79)], { nowMs: NOW })).toBeNull();
  });

  it('ignores a stale drop older than the freshness window', () => {
    // Drop happened 5 days ago; default freshness is 2 days.
    expect(detectPriceDrop([p(20, 79), p(5, 39)], { nowMs: NOW })).toBeNull();
  });

  it('honours the freshness boundary (exactly at the window = fresh)', () => {
    // last.at is exactly freshnessMs old → nowMs - last.at == freshnessMs, guard is strict >, so still fresh.
    const atBoundary = detectPriceDrop([p(20, 79), { at: NOW - 2 * DAY, amount: 39, currency: 'SEK' }], { nowMs: NOW, freshnessMs: 2 * DAY });
    expect(atBoundary).not.toBeNull();
    // one ms past the boundary → stale → null
    const pastBoundary = detectPriceDrop([p(20, 79), { at: NOW - 2 * DAY - 1, amount: 39, currency: 'SEK' }], { nowMs: NOW, freshnessMs: 2 * DAY });
    expect(pastBoundary).toBeNull();
  });

  it('marks a multi-month low when the new price beats every point in the window', () => {
    const signal = detectPriceDrop([p(150, 59), p(60, 49), p(0, 39)], { nowMs: NOW });
    expect(signal!.isMultiMonthLow).toBe(true);
  });

  it('is not a multi-month low when an earlier in-window point was cheaper', () => {
    const signal = detectPriceDrop([p(60, 29), p(10, 79), p(0, 39)], { nowMs: NOW });
    expect(signal).not.toBeNull();
    expect(signal!.isMultiMonthLow).toBe(false); // 29 < 39 within the window
  });

  it('excludes out-of-window points from the multi-month-low comparison', () => {
    // 200-day-old point at 9 is OUTSIDE the 180-day window → ignored → still a low.
    const signal = detectPriceDrop([p(200, 9), p(10, 59), p(0, 39)], { nowMs: NOW });
    expect(signal).not.toBeNull();
    expect(signal!.isMultiMonthLow).toBe(true);
  });

  it('does not compare across differing currencies', () => {
    expect(detectPriceDrop([{ at: NOW - DAY, amount: 79, currency: 'EUR' }, p(0, 39)], { nowMs: NOW })).toBeNull();
  });
});
