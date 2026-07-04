import { describe, it, expect } from 'vitest';
import { computePriceStats, sparklinePoints, priceChartGeometry, type PricePoint } from './priceStats';

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

describe('priceChartGeometry (BIN-359)', () => {
  it('returns null for <2 points (a single dot is not a trend)', () => {
    expect(priceChartGeometry([])).toBeNull();
    expect(priceChartGeometry(undefined)).toBeNull();
    expect(priceChartGeometry([pt(3, 39)])).toBeNull();
  });

  it('maps oldest→plotLeft, newest→plotRight, dearest→plotTop, cheapest→plotBottom', () => {
    // 49 (oldest) → 39 → 29 (cheapest) → 35 (newest). Default 320x132 plot.
    const g = priceChartGeometry([pt(150, 49), pt(90, 39), pt(40, 29), pt(5, 35)])!;
    expect(g.points).toHaveLength(4);
    // oldest point sits on the left edge; being the dearest (49) it's at the top.
    expect(g.points[0].cx).toBe(g.plotLeft);
    expect(g.points[0].cy).toBe(g.plotTop);
    expect(g.points[0].amount).toBe(49);
    // newest point sits on the right edge.
    expect(g.points[3].cx).toBe(g.plotRight);
    expect(g.points[3].amount).toBe(35);
    // the cheapest price (29) hits the plot floor.
    const cheapest = g.points.find(p => p.amount === 29)!;
    expect(cheapest.cy).toBe(g.plotBottom);
    // line path starts with a Move to the first dot.
    expect(g.linePath.startsWith(`M${g.plotLeft.toFixed(1)},${g.plotTop.toFixed(1)}`)).toBe(true);
    // area path is closed back to the baseline.
    expect(g.areaPath.endsWith('Z')).toBe(true);
  });

  it('sorts out-of-order points chronologically (a late write cannot tangle the path)', () => {
    const g = priceChartGeometry([pt(5, 35), pt(150, 49), pt(40, 29)])!; // shuffled
    // points come out oldest→newest regardless of input order.
    expect(g.points.map(p => p.amount)).toEqual([49, 29, 35]);
    expect(g.points[0].cx).toBe(g.plotLeft);
    expect(g.points[2].cx).toBe(g.plotRight);
  });

  it('gives 3 price ticks (dearest/mid/cheapest) for a varied history', () => {
    const g = priceChartGeometry([pt(150, 49), pt(40, 29), pt(5, 35)])!;
    expect(g.priceTicks.map(t => t.amount)).toEqual([49, 39, 29]); // mid = round((29+49)/2)
  });

  it('collapses a flat history to one centred line + one price tick (no divide-by-zero)', () => {
    const g = priceChartGeometry([pt(3, 40), pt(2, 40), pt(1, 40)])!;
    const midY = (g.plotTop + g.plotBottom) / 2;
    expect(g.points.every(p => p.cy === midY)).toBe(true);
    expect(g.priceTicks).toHaveLength(1);
    expect(g.priceTicks[0].amount).toBe(40);
  });

  it('uses 2 date ticks up to 3 points, 3 ticks at >=4 (pins the >=4 threshold, not >=3)', () => {
    expect(priceChartGeometry([pt(3, 30), pt(1, 40)])!.dateTicks).toHaveLength(2);
    // 3 points must STILL give 2 ticks — this is the boundary a >=3 regression would break.
    expect(priceChartGeometry([pt(3, 30), pt(2, 35), pt(1, 40)])!.dateTicks).toHaveLength(2);
    expect(priceChartGeometry([pt(4, 30), pt(3, 40), pt(2, 35), pt(1, 39)])!.dateTicks).toHaveLength(3);
  });

  it('centres x when every point shares a timestamp (atSpan === 0, no divide-by-zero)', () => {
    const sameAt: PricePoint = { at: NOW, amount: 30, currency: 'SEK' };
    const g = priceChartGeometry([sameAt, { ...sameAt, amount: 50 }])!;
    const midX = (g.plotLeft + g.plotRight) / 2;
    expect(g.points.every(p => p.cx === midX)).toBe(true);
  });

  it('honours custom dimensions', () => {
    const g = priceChartGeometry([pt(2, 30), pt(1, 40)], { width: 500, height: 200, padRight: 20, padBottom: 30 })!;
    expect(g.width).toBe(500);
    expect(g.height).toBe(200);
    expect(g.plotRight).toBe(480); // 500 - 20
    expect(g.plotBottom).toBe(170); // 200 - 30
    expect(g.points[1].cx).toBe(480); // newest on the right edge
  });
});
