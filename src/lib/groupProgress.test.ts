import { describe, it, expect } from 'vitest';
import { computeMaskBoundary, isEpisodeMasked } from './groupProgress';
import type { MemberProgress } from '@/hooks/useGroupMemberProgress';

function progressMap(entries: Array<[uid: string, tmdbId: number, season: number | null, episode: number | null]>) {
  const outer = new Map<string, Map<number, MemberProgress>>();
  for (const [uid, tmdbId, season, episode] of entries) {
    const inner = outer.get(uid) ?? new Map<number, MemberProgress>();
    inner.set(tmdbId, { lastWatchedSeason: season, lastWatchedEpisode: episode, status: null });
    outer.set(uid, inner);
  }
  return outer;
}

describe('computeMaskBoundary', () => {
  it('returnerar null när medlemslistan är tom', () => {
    expect(computeMaskBoundary(new Map(), 1, [])).toBeNull();
  });

  it('returnerar null när alla ligger på samma position', () => {
    const progress = progressMap([
      ['a', 100, 2, 5],
      ['b', 100, 2, 5],
    ]);
    expect(computeMaskBoundary(progress, 100, ['a', 'b'])).toBeNull();
  });

  it('returnerar null när alla saknar progress (alla på 0/0)', () => {
    expect(computeMaskBoundary(new Map(), 100, ['a', 'b'])).toBeNull();
  });

  it('boundary = en medlems mindre position (en framme, en på 0)', () => {
    const progress = progressMap([
      ['a', 100, 1, 5],
      // b saknar progress-doc → räknas som 0/0
    ]);
    const boundary = computeMaskBoundary(progress, 100, ['a', 'b']);
    expect(boundary).toEqual({
      season: 0,
      episode: 0,
      trailingMemberUids: ['b'],
    });
  });

  it('asymmetri S2E5 vs S2E3 vs S1E10 → boundary S1E10', () => {
    const progress = progressMap([
      ['a', 100, 2, 5],
      ['b', 100, 2, 3],
      ['c', 100, 1, 10],
    ]);
    const boundary = computeMaskBoundary(progress, 100, ['a', 'b', 'c']);
    expect(boundary).toEqual({
      season: 1,
      episode: 10,
      trailingMemberUids: ['c'],
    });
  });

  it('flera medlemmar på samma minsta-position listas alla', () => {
    const progress = progressMap([
      ['a', 100, 2, 5],
      ['b', 100, 1, 3],
      ['c', 100, 1, 3],
    ]);
    const boundary = computeMaskBoundary(progress, 100, ['a', 'b', 'c']);
    expect(boundary?.season).toBe(1);
    expect(boundary?.episode).toBe(3);
    expect(boundary?.trailingMemberUids.sort()).toEqual(['b', 'c']);
  });

  it('progress för andra titlar påverkar inte', () => {
    const progress = progressMap([
      ['a', 100, 2, 5],
      ['a', 200, 1, 1],   // helt annan titel
      ['b', 100, 2, 5],
    ]);
    expect(computeMaskBoundary(progress, 100, ['a', 'b'])).toBeNull();
  });
});

describe('isEpisodeMasked', () => {
  it('returnerar false när boundary är null', () => {
    expect(isEpisodeMasked(null, 5, 5)).toBe(false);
  });

  it('avsnitt utöver boundary maskeras', () => {
    const boundary = { season: 1, episode: 5, trailingMemberUids: ['a'] };
    expect(isEpisodeMasked(boundary, 1, 6)).toBe(true);
    expect(isEpisodeMasked(boundary, 2, 1)).toBe(true);
    expect(isEpisodeMasked(boundary, 3, 10)).toBe(true);
  });

  it('avsnitt på exakt boundary maskeras INTE (det är sett)', () => {
    const boundary = { season: 1, episode: 5, trailingMemberUids: ['a'] };
    expect(isEpisodeMasked(boundary, 1, 5)).toBe(false);
  });

  it('avsnitt under boundary maskeras inte', () => {
    const boundary = { season: 2, episode: 3, trailingMemberUids: ['a'] };
    expect(isEpisodeMasked(boundary, 1, 1)).toBe(false);
    expect(isEpisodeMasked(boundary, 2, 1)).toBe(false);
    expect(isEpisodeMasked(boundary, 2, 2)).toBe(false);
  });
});
