import { describe, it, expect } from 'vitest';
import { computeBingeStats } from './bingeStats';

const ep = (iso: string) => ({ watchedAt: new Date(iso) });

describe('computeBingeStats (BIN-102)', () => {
  it('counts the biggest single-day episode binge', () => {
    const episodes = [
      ep('2026-06-10T20:00:00'), ep('2026-06-10T20:40:00'), ep('2026-06-10T21:20:00'), // 3 in one day
      ep('2026-06-12T19:00:00'), ep('2026-06-12T19:45:00'),                              // 2 in another
    ];
    const s = computeBingeStats(episodes, [], new Date('2026-06-20T12:00:00'));
    expect(s.biggestDayEpisodes).toBe(3);
    expect(s.biggestDay?.getFullYear()).toBe(2026);
    expect(s.biggestDay?.getMonth()).toBe(5); // June (0-indexed) — pins year+month, not just day-of-month
    expect(s.biggestDay?.getDate()).toBe(10);
  });

  it('counts episodes in the last 30 days, inclusive of the exact boundary', () => {
    const now = new Date('2026-06-20T12:00:00');
    const cutoff = now.getTime() - 30 * 86_400_000;
    const episodes = [
      { watchedAt: new Date(cutoff) },      // exactly 30d ago → counts (>=)
      { watchedAt: new Date(cutoff - 1) },  // 1 ms older → excluded
      ep('2026-06-19T20:00:00'),            // clearly recent → counts
    ];
    expect(computeBingeStats(episodes, [], now).episodesLast30).toBe(2);
  });

  it('computes a current streak ending today across episodes and films', () => {
    const now = new Date('2026-06-20T12:00:00');
    const episodes = [ep('2026-06-20T09:00:00'), ep('2026-06-19T21:00:00')];
    const films = [{ watchedAt: new Date('2026-06-18T22:00:00') }]; // film keeps the chain alive
    // 18,19,20 consecutive → streak 3
    expect(computeBingeStats(episodes, films, now).currentStreakDays).toBe(3);
  });

  it('counts unique calendar days in the streak, not raw episode count', () => {
    const now = new Date('2026-06-20T12:00:00');
    const episodes = [
      ep('2026-06-20T09:00:00'), ep('2026-06-20T10:00:00'), ep('2026-06-20T11:00:00'), // 3 episodes, one day
      ep('2026-06-19T21:00:00'),
      ep('2026-06-18T21:00:00'),
    ];
    expect(computeBingeStats(episodes, [], now).currentStreakDays).toBe(3); // 3 days, not 5 episodes
  });

  it('keeps the streak when today is empty but yesterday is active', () => {
    const now = new Date('2026-06-20T08:00:00'); // nothing watched today yet
    const episodes = [ep('2026-06-19T21:00:00'), ep('2026-06-18T21:00:00')];
    expect(computeBingeStats(episodes, [], now).currentStreakDays).toBe(2);
  });

  it('reports a zero streak when the last activity was 2+ days ago', () => {
    const now = new Date('2026-06-20T12:00:00');
    const episodes = [ep('2026-06-17T21:00:00')]; // gap → broken
    expect(computeBingeStats(episodes, [], now).currentStreakDays).toBe(0);
  });

  it('handles an empty history', () => {
    const s = computeBingeStats([], [], new Date('2026-06-20T12:00:00'));
    expect(s).toEqual({ currentStreakDays: 0, biggestDayEpisodes: 0, biggestDay: null, episodesLast30: 0 });
  });
});
