import { describe, it, expect } from 'vitest';
import { rollupSavingsLedger, type LedgerInput } from './savingsLedger';

const TODAY = new Date(2026, 5, 23); // 2026

function entry(o: Partial<LedgerInput>): LedgerInput {
  return { providerId: 1, providerShortName: 'Prov', savedAmount: 100, durationDays: 30, resumedAt: '2026-01-15', ...o };
}

describe('rollupSavingsLedger', () => {
  it('returns all zeros for an empty history', () => {
    const l = rollupSavingsLedger([], { today: TODAY });
    expect(l).toEqual({ totalSaved: 0, savedThisYear: 0, rotationCount: 0, longestPauseDays: 0, byProvider: [] });
  });

  it('sums all-time vs year-to-date by resume year', () => {
    const l = rollupSavingsLedger(
      [
        entry({ savedAmount: 200, resumedAt: '2026-02-01' }),
        entry({ savedAmount: 150, resumedAt: '2026-05-10' }),
        entry({ savedAmount: 300, resumedAt: '2025-11-20' }), // last year — counts in total, not this year
      ],
      { today: TODAY },
    );
    expect(l.totalSaved).toBe(650);
    expect(l.savedThisYear).toBe(350);
    expect(l.rotationCount).toBe(3);
  });

  it('groups per provider and sorts by saved desc', () => {
    const l = rollupSavingsLedger(
      [
        entry({ providerId: 76, providerShortName: 'Viaplay', savedAmount: 100 }),
        entry({ providerId: 76, providerShortName: 'Viaplay', savedAmount: 169 }),
        entry({ providerId: 384, providerShortName: 'Max', savedAmount: 149 }),
      ],
      { today: TODAY },
    );
    expect(l.byProvider).toEqual([
      { providerId: 76, shortName: 'Viaplay', saved: 269, rotations: 2 },
      { providerId: 384, shortName: 'Max', saved: 149, rotations: 1 },
    ]);
  });

  it('tracks the longest single pause', () => {
    const l = rollupSavingsLedger(
      [entry({ durationDays: 12 }), entry({ durationDays: 47 }), entry({ durationDays: 30 })],
      { today: TODAY },
    );
    expect(l.longestPauseDays).toBe(47);
  });

  it('ignores non-finite savedAmount/durationDays defensively but still counts the rotation', () => {
    const l = rollupSavingsLedger(
      [entry({ savedAmount: Number.NaN, durationDays: Number.NaN }), entry({ savedAmount: 100, durationDays: 20 })],
      { today: TODAY },
    );
    expect(l.totalSaved).toBe(100);
    expect(l.longestPauseDays).toBe(20); // NaN duration must not corrupt the max
    expect(l.rotationCount).toBe(2); // the pause still happened, even with a corrupt amount
  });
});
