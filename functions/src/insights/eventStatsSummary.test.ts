import { describe, it, expect } from 'vitest';
import { summarizeEventStats } from './eventStatsSummary';

describe('summarizeEventStats', () => {
  it('inga dokument är "inte mätt" (null), aldrig nollor', () => {
    expect(summarizeEventStats([])).toBeNull();
  });

  it('summerar antal och egenskapsvärden över dagarna', () => {
    const out = summarizeEventStats([
      { id: '2026-10-02', data: { counts: { provider_clicked: 3, signed_up: 1 }, props: { provider_clicked: { offerType: { rent: 1, subscription: 2 } } } } },
      { id: '2026-10-01', data: { counts: { provider_clicked: 2 }, props: { provider_clicked: { offerType: { rent: 2 } } } } },
    ]);
    expect(out).not.toBeNull();
    expect(out!.counts).toEqual({ provider_clicked: 5, signed_up: 1 });
    expect(out!.props).toEqual({ provider_clicked: { offerType: { rent: 3, subscription: 2 } } });
    expect(out!.days).toBe(2);
  });

  it('daily har en rad per dag SOM HAR ett dokument, i datumordning — luckor fylls inte med noll', () => {
    const out = summarizeEventStats([
      { id: '2026-10-05', data: { counts: { signed_up: 2 } } },
      { id: '2026-10-01', data: { counts: { signed_in: 4 } } },
    ]);
    expect(out!.daily).toEqual([
      { date: '2026-10-01', counts: { signed_in: 4 } },
      { date: '2026-10-05', counts: { signed_up: 2 } },
    ]);
  });

  it('hoppar över värden som inte är icke-negativa ändliga tal', () => {
    const out = summarizeEventStats([
      { id: '2026-10-01', data: { counts: { a: 'x', b: -1, c: Number.NaN, d: 2 }, props: { e: { p: { v: null, w: 1 } }, f: 'junk' } } },
    ]);
    expect(out!.counts).toEqual({ d: 2 });
    expect(out!.props).toEqual({ e: { p: { w: 1 } } });
  });
});
