import { describe, it, expect } from 'vitest';
import { filterByMood, MOODS } from './moodLens';

const it_ = (tmdbId: number, genreIds: number[]) => ({ tmdbId, genreIds });

describe('filterByMood (BIN-93 mood lens)', () => {
  it('returns everything when no mood is selected', () => {
    const items = [it_(1, [35]), it_(2, [27])];
    expect(filterByMood(items, null)).toBe(items);
  });

  it('keeps only items whose genres intersect the mood', () => {
    const items = [
      it_(1, [35]),        // komedi → mysig + skratta
      it_(2, [27]),        // skräck
      it_(3, [18, 53]),    // drama + thriller → spänning + tänkvärd
    ];
    expect(filterByMood(items, 'spanning').map(i => i.tmdbId)).toEqual([3]); // thriller 53
    expect(filterByMood(items, 'skrack').map(i => i.tmdbId)).toEqual([2]);
    expect(filterByMood(items, 'skratta').map(i => i.tmdbId)).toEqual([1]);
  });

  it('matches an item if ANY of its genres is in the mood', () => {
    const items = [it_(1, [99, 28])]; // dokumentär (tänkvärd) + action (spänning)
    expect(filterByMood(items, 'tankvard').map(i => i.tmdbId)).toEqual([1]);
    expect(filterByMood(items, 'spanning').map(i => i.tmdbId)).toEqual([1]);
  });

  it('excludes items with empty genreIds from any mood (some, not every)', () => {
    const items = [it_(1, []), it_(2, [35])];
    expect(filterByMood(items, 'skratta').map(i => i.tmdbId)).toEqual([2]);
  });

  it('returns everything for an unknown mood id (safe fallback)', () => {
    const items = [it_(1, [35])];
    expect(filterByMood(items, 'nonsense')).toBe(items);
  });

  it('every mood maps to at least one genre', () => {
    for (const m of MOODS) expect(m.genreIds.length).toBeGreaterThan(0);
  });
});
