import { describe, it, expect } from 'vitest';
import { historyIds, toHistoryPoint, HISTORY_READ_LIMIT } from './history';

describe('historyIds', () => {
  it('keeps only dated ids inside the range, oldest first', () => {
    const ids = ['daily', '2026-10-03', '2026-09-30', '2026-10-01', 'notes', '2026-10-09'];
    expect(historyIds(ids, '2026-10-01', '2026-10-08')).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('drops a non-date id even when the range would admit it by string order', () => {
    // `from`/`to` come from the request on a custom range, so the shape check is the
    // only thing keeping `daily` (and any stray id) out of the curve.
    const ids = ['2026-10-01', '2026-10-05-backup', '2026-10-02x', 'daily', '2026-10-08'];
    expect(historyIds(ids, '2026-10-01', '2026-10-08')).toEqual(['2026-10-01', '2026-10-08']);
    expect(historyIds(ids, '2026-01-01', 'zzzz')).toEqual(['2026-10-01', '2026-10-08']);
  });

  it('includes both boundary days', () => {
    expect(historyIds(['2026-10-01', '2026-10-08'], '2026-10-01', '2026-10-08')).toEqual(['2026-10-01', '2026-10-08']);
  });

  it('spreads HISTORY_READ_LIMIT picks evenly over a longer range: first and last day kept, same picks every time', () => {
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const ids = Array.from({ length: 2 * HISTORY_READ_LIMIT + 1 }, (_, i) => day(i));
    const out = historyIds(ids, '2026-01-01', '2026-12-31');
    expect(out).toHaveLength(HISTORY_READ_LIMIT);
    expect(out[0]).toBe(day(0));
    expect(out[out.length - 1]).toBe(day(2 * HISTORY_READ_LIMIT));
    expect(new Set(out).size).toBe(HISTORY_READ_LIMIT);
    expect(out).toEqual([...out].sort());
    expect(historyIds([...ids].reverse(), '2026-01-01', '2026-12-31')).toEqual(out);
    // Every other day, not the newest 90.
    expect(out[1]).toBe(day(2));
  });

  it('caps at HISTORY_READ_LIMIT ids', () => {
    const ids = Array.from({ length: HISTORY_READ_LIMIT + 5 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    // not real calendar days past 31, but lexicographic order is what the helper sorts on
    const out = historyIds(ids, '2026-01-01', '2026-01-99');
    expect(out).toHaveLength(HISTORY_READ_LIMIT);
    expect(out[out.length - 1]).toBe(ids[ids.length - 1]);
  });
});

describe('toHistoryPoint', () => {
  const doc = {
    computedAt: 'x',
    totals: { users: 4, titlesTracked: 419, reviews: 0, activeSessions: 2, groups: 1 },
    activeUsers: { d7: 1, d30: 2 },
    secondWeekReturn: { returned: 1, cohort: 3 },
    topTitles: [{ tmdbId: 1, mediaType: 'movie', title: 'X', count: 1 }],
  };

  it('copies only the named aggregate fields — nothing else from the rollup doc', () => {
    expect(toHistoryPoint('2026-10-28', doc)).toEqual({
      date: '2026-10-28', users: 4, titlesTracked: 419, reviews: 0, activeUsers7d: 1, activeUsers30d: 2,
    });
    expect(Object.keys(toHistoryPoint('2026-10-28', doc)!).sort()).toEqual(
      ['activeUsers30d', 'activeUsers7d', 'date', 'reviews', 'titlesTracked', 'users'],
    );
  });

  it('omits active users on an older doc without the field', () => {
    const { activeUsers: _a, ...older } = doc;
    expect(toHistoryPoint('2026-06-01', older)).toEqual({ date: '2026-06-01', users: 4, titlesTracked: 419, reviews: 0 });
  });

  it('returns null for a doc without numeric totals', () => {
    expect(toHistoryPoint('2026-06-01', null)).toBeNull();
    expect(toHistoryPoint('2026-06-01', { totals: { users: 'four' } })).toBeNull();
  });
});
