import { describe, it, expect } from 'vitest';
import { rerunExcludeIds, canRerun } from './rerun';

describe('rerunExcludeIds', () => {
  it('lägger sessionens nuvarande titlar till de extra nycklarna', () => {
    const out = rerunExcludeIds(
      [{ mediaType: 'movie', tmdbId: 1 }, { mediaType: 'tv', tmdbId: 2 }],
      new Set(['movie_9']),
    );
    expect([...out].sort()).toEqual(['movie_1', 'movie_9', 'tv_2']);
  });

  it('håller film 42 och serie 42 isär', () => {
    const out = rerunExcludeIds([{ mediaType: 'movie', tmdbId: 42 }], new Set());
    expect(out.has('movie_42')).toBe(true);
    expect(out.has('tv_42')).toBe(false);
  });

  it('muterar inte den medskickade mängden', () => {
    const lib = new Set<string>();
    rerunExcludeIds([{ mediaType: 'movie', tmdbId: 1 }], lib);
    expect(lib.size).toBe(0);
  });
});

describe('canRerun', () => {
  it('släpper bara värden förbi', () => {
    expect(canRerun({ hostUid: 'a' }, 'a')).toBe(true);
    expect(canRerun({ hostUid: 'a' }, 'b')).toBe(false);
    expect(canRerun({ hostUid: 'a' }, null)).toBe(false);
  });
  it('nekar när sessionen saknar värd-uid', () => {
    expect(canRerun({ hostUid: null }, null)).toBe(false);
    expect(canRerun({ hostUid: null }, undefined)).toBe(false);
  });
});
