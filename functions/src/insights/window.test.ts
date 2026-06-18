import { describe, it, expect } from 'vitest';
import { computeWindowDeltas } from './window';
import type { RollupData } from './types';

function rollup(users: number, titlesTracked: number): RollupData {
  return {
    computedAt: '', readsUsed: 0, partial: false,
    totals: { users, titlesTracked, reviews: 0, activeSessions: 0, groups: 0 },
    statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
    mediaTypeSplit: { movie: 0, tv: 0 },
    ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
  };
}

describe('computeWindowDeltas', () => {
  it('returns null when there is no baseline', () => {
    expect(computeWindowDeltas(rollup(3, 320), null, null, '2026-06-11')).toBeNull();
  });

  it('computes net change from baseline to today', () => {
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-11', '2026-06-11');
    expect(v).toEqual({
      basisDate: '2026-06-11',
      truncated: false,
      deltas: { users: 0, titlesTracked: 19 },
    });
  });

  it('keeps a negative net delta raw (clamping is the frontend\'s job)', () => {
    const v = computeWindowDeltas(rollup(3, 300), rollup(3, 302), '2026-06-11', '2026-06-11');
    expect(v?.deltas.titlesTracked).toBe(-2);
  });

  it('flags truncated when baseline is newer than the requested start', () => {
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-10', '2026-05-19');
    expect(v?.truncated).toBe(true);
    expect(v?.basisDate).toBe('2026-06-10');
  });

  it('is not truncated when baseline is at or before the requested start', () => {
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-09', '2026-06-11');
    expect(v?.truncated).toBe(false);
  });
});
