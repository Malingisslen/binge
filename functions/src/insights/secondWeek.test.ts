import { describe, it, expect } from 'vitest';
import { cohortCreatedRange, secondWeekReturn, MIN_COHORT } from './secondWeek';

const now = new Date('2026-11-20T10:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

describe('secondWeekReturn (BIN-1442)', () => {
  it('counts closed cohorts only, and only visits inside the window', () => {
    const c20 = daysAgo(20);
    const rows = [
      { createdAt: c20, secondWeekVisitAt: plus(c20, 8) },  // returned
      { createdAt: c20, secondWeekVisitAt: plus(c20, 3) },  // forged/early: not counted
      { createdAt: c20 },                                   // did not return
      { createdAt: daysAgo(10), secondWeekVisitAt: plus(daysAgo(10), 8) }, // window still open
      { createdAt: daysAgo(50) },                           // older than the span
      { secondWeekVisitAt: now },                           // no createdAt: excluded
      { createdAt: 'yesterday' },                           // malformed: excluded
    ];
    expect(secondWeekReturn(rows, now)).toEqual({ returned: 1, cohort: 3 });
  });

  it('includes day 14 and day 43, the edges of the 30-day span', () => {
    expect(secondWeekReturn([{ createdAt: daysAgo(14) }, { createdAt: daysAgo(43) }], now).cohort).toBe(2);
    expect(secondWeekReturn([{ createdAt: daysAgo(13) }, { createdAt: daysAgo(44) }], now).cohort).toBe(0);
  });

  it('reads Firestore Timestamps', () => {
    const ts = (d: Date) => ({ toDate: () => d });
    const c = daysAgo(20);
    expect(secondWeekReturn([{ createdAt: ts(c), secondWeekVisitAt: ts(plus(c, 7)) }], now)).toEqual({ returned: 1, cohort: 1 });
  });

  it('has a floor below which no figure is shown', () => {
    expect(MIN_COHORT).toBe(5);
  });
});

describe('cohortCreatedRange', () => {
  it('covers every account the per-row check can count', () => {
    const { start, end } = cohortCreatedRange(now);
    for (const n of [14, 20, 43]) {
      const d = daysAgo(n);
      expect(d >= start && d < end, `day ${n}`).toBe(true);
    }
  });
});
