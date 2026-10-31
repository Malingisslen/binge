import { describe, expect, it } from 'vitest';
import { countUnseen, parseSeen, toWatchSeenKey } from './toWatchSeen';

const row = (mediaType: 'tv' | 'movie', tmdbId: number) => ({ item: { mediaType, tmdbId } }) as never;

describe('toWatchSeen', () => {
  it('counts only titles not yet seen', () => {
    const rows = [row('tv', 1), row('movie', 1), row('tv', 2)];
    expect(countUnseen(rows, new Set([toWatchSeenKey(rows[0])]))).toBe(2);
    expect(countUnseen(rows, new Set())).toBe(3);
  });

  it('reads a broken or foreign stored value as nothing seen', () => {
    expect(parseSeen(null).size).toBe(0);
    expect(parseSeen('{oops').size).toBe(0);
    expect(parseSeen('{"a":1}').size).toBe(0);
    expect([...parseSeen('["tv:1",5]')]).toEqual(['tv:1']);
  });
});
