import { describe, it, expect } from 'vitest';
import {
  statusDistribution,
  mediaTypeSplit,
  ratingsHistogram,
  tallyTop,
} from './aggregate';

describe('statusDistribution', () => {
  it('counts each watch status, ignoring unknown values', () => {
    const items = [
      { status: 'vill_se' },
      { status: 'vill_se' },
      { status: 'mina' },
      { status: 'sedd' },
      { status: 'avbruten' },
      { status: 'följer' }, // legacy/unknown — ignored
    ];
    expect(statusDistribution(items)).toEqual({
      vill_se: 2,
      mina: 1,
      sedd: 1,
      avbruten: 1,
    });
  });

  it('returns all-zero for an empty list', () => {
    expect(statusDistribution([])).toEqual({
      vill_se: 0,
      mina: 0,
      sedd: 0,
      avbruten: 0,
    });
  });
});

describe('mediaTypeSplit', () => {
  it('counts movies and tv separately', () => {
    const items = [
      { mediaType: 'movie' },
      { mediaType: 'tv' },
      { mediaType: 'tv' },
      { mediaType: 'other' as unknown as string }, // ignored
    ];
    expect(mediaTypeSplit(items)).toEqual({ movie: 1, tv: 2 });
  });
});

describe('ratingsHistogram', () => {
  it('buckets ratings 1..10 by rounded value and skips null/out-of-range', () => {
    const items = [
      { rating: 1 },
      { rating: 7 },
      { rating: 7.4 }, // rounds to 7
      { rating: 7.5 }, // rounds to 8
      { rating: 10 },
      { rating: null },
      { rating: 0 }, // out of range (below 1)
      { rating: 11 }, // out of range
    ];
    const hist = ratingsHistogram(items);
    expect(hist).toHaveLength(10);
    // index 0 => rating 1, index 6 => rating 7, index 7 => rating 8, index 9 => rating 10
    expect(hist[0]).toBe(1);
    expect(hist[6]).toBe(2);
    expect(hist[7]).toBe(1);
    expect(hist[9]).toBe(1);
    // total counted = 5 valid ratings
    expect(hist.reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe('tallyTop', () => {
  it('counts occurrences and returns the top N sorted descending', () => {
    const values = ['a', 'b', 'a', 'c', 'a', 'b'];
    expect(tallyTop(values, 2)).toEqual([
      { value: 'a', count: 3 },
      { value: 'b', count: 2 },
    ]);
  });

  it('works with numeric values and a stable order for ties', () => {
    const values = [10, 20, 10, 30];
    expect(tallyTop(values, 10)).toEqual([
      { value: 10, count: 2 },
      { value: 20, count: 1 },
      { value: 30, count: 1 },
    ]);
  });

  it('returns an empty array for no values', () => {
    expect(tallyTop([], 5)).toEqual([]);
  });
});
