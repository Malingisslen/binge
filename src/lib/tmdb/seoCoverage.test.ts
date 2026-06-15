import { describe, it, expect } from 'vitest';
import { cappedTitleIds, SEO_TITLE_TARGET_IDS } from './seoCoverage';

describe('cappedTitleIds', () => {
  it('dedupar ids som finns i båda inputlistorna', () => {
    const result = cappedTitleIds([1, 2, 3], [3, 4, 5]);
    expect(result).toEqual([1, 2, 3, 4, 5]);
    // Inga dubbletter kvar
    expect(new Set(result).size).toBe(result.length);
  });

  it('bevarar ordningen: popular före topRated', () => {
    const result = cappedTitleIds([10, 20, 30], [40, 50]);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('behåller första förekomsten när en topRated-id redan setts i popular', () => {
    // 20 finns i båda — ska behålla sin position från popular, inte flyttas
    const result = cappedTitleIds([10, 20, 30], [20, 40]);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it('cappar till SEO_TITLE_TARGET_IDS', () => {
    const popular = Array.from({ length: SEO_TITLE_TARGET_IDS + 500 }, (_, i) => i);
    const topRated = Array.from({ length: 500 }, (_, i) => 1_000_000 + i);
    const result = cappedTitleIds(popular, topRated);
    expect(result.length).toBe(SEO_TITLE_TARGET_IDS);
    // Tar de första target-st unika från popular i ordning
    expect(result[0]).toBe(0);
    expect(result[SEO_TITLE_TARGET_IDS - 1]).toBe(SEO_TITLE_TARGET_IDS - 1);
  });

  it('producerar aldrig fler än cap', () => {
    const result = cappedTitleIds([1, 2, 3], [4, 5, 6]);
    expect(result.length).toBeLessThanOrEqual(SEO_TITLE_TARGET_IDS);
  });

  it('hanterar tomma inputlistor', () => {
    expect(cappedTitleIds([], [])).toEqual([]);
    expect(cappedTitleIds([1, 2], [])).toEqual([1, 2]);
    expect(cappedTitleIds([], [3, 4])).toEqual([3, 4]);
  });
});
