import { describe, it, expect } from 'vitest';
import { computePriceStats, sparklinePoints, type PricePoint } from './priceStats';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function pt(daysAgo: number, amount: number): PricePoint {
  return { at: NOW - daysAgo * DAY, amount, currency: 'SEK' };
}

describe('computePriceStats', () => {
  it('returns null for empty/missing points', () => {
    expect(computePriceStats([], 180, NOW)).toBeNull();
    expect(computePriceStats(undefined, 180, NOW)).toBeNull();
    expect(computePriceStats(null, 180, NOW)).toBeNull();
  });

  it('computes current/lowest/highest over the window with a drop %', () => {
    // 49 → 39 → 29 → 35 over the last few months
    const points = [pt(150, 49), pt(90, 39), pt(40, 29), pt(5, 35)];
    const s = computePriceStats(points, 180, NOW)!;
    expect(s.current).toBe(35);      // most recent
    expect(s.lowest).toBe(29);
    expect(s.highest).toBe(49);
    expect(s.currency).toBe('SEK');
    expect(s.dropFromHighPct).toBe(41); // round((1 - 29/49)*100) = 41
    expect(s.atLowest).toBe(false);     // current 35 != lowest 29
  });

  it('flags atLowest when the current price is the window low', () => {
    const points = [pt(60, 49), pt(2, 29)];
    const s = computePriceStats(points, 180, NOW)!;
    expect(s.current).toBe(29);
    expect(s.lowest).toBe(29);
    expect(s.atLowest).toBe(true);
  });

  it('current is always the most recent point even if it is the highest', () => {
    const points = [pt(60, 29), pt(2, 49)];
    const s = computePriceStats(points, 180, NOW)!;
    expect(s.current).toBe(49);
    expect(s.highest).toBe(49);
    expect(s.lowest).toBe(29);
    expect(s.dropFromHighPct).toBe(41); // low 29 vs high 49
    expect(s.atLowest).toBe(false);     // current 49 is the high, not the low
  });

  it('falls back to all points when none fall inside the window (windowed=false)', () => {
    // both points older than the 30-day window → use all of them, not nothing
    const points = [pt(200, 49), pt(120, 29)];
    const s = computePriceStats(points, 30, NOW)!;
    expect(s.current).toBe(29);
    expect(s.lowest).toBe(29);
    expect(s.highest).toBe(49);
    expect(s.windowed).toBe(false);
  });

  it('windowed=true uses ONLY the in-window points for lowest/highest', () => {
    // pt(200,49) is outside the 30-day window, pt(5,29) is inside → stats must
    // reflect only the 29 point (highest 29, no drop), not fall back to all.
    const s = computePriceStats([pt(200, 49), pt(5, 29)], 30, NOW)!;
    expect(s.windowed).toBe(true);
    expect(s.highest).toBe(29);
    expect(s.lowest).toBe(29);
    expect(s.dropFromHighPct).toBe(0);
  });

  it('single point: current == lowest == highest, no drop', () => {
    const s = computePriceStats([pt(3, 39)], 180, NOW)!;
    expect(s).toMatchObject({ current: 39, lowest: 39, highest: 39, dropFromHighPct: 0, atLowest: true });
  });
});

describe('sparklinePoints', () => {
  it('returns [] for <2 points', () => {
    expect(sparklinePoints([])).toEqual([]);
    expect(sparklinePoints([pt(1, 30)])).toEqual([]);
  });

  it('normalizes amounts to y in [0,1] (cheapest=0, dearest=1), x evenly spaced oldest→newest', () => {
    const pts = sparklinePoints([pt(3, 30), pt(2, 50), pt(1, 40)]);
    expect(pts).toEqual([
      { x: 0, y: 0 },    // 30 = min
      { x: 0.5, y: 1 },  // 50 = max
      { x: 1, y: 0.5 },  // 40 = midpoint
    ]);
  });

  it('flat prices map to a mid line (y=0.5)', () => {
    const pts = sparklinePoints([pt(2, 40), pt(1, 40)]);
    expect(pts).toEqual([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]);
  });
});
