import { describe, it, expect } from 'vitest';
import { ratingDelta, isNoOp } from './logic';

describe('ratingDelta (BIN-104)', () => {
  it('no-op when the rating is unchanged (null→null and X→X)', () => {
    expect(ratingDelta(null, null)).toEqual({ countDelta: 0, sumDelta: 0 });
    expect(ratingDelta(8, 8)).toEqual({ countDelta: 0, sumDelta: 0 });
  });
  it('newly rated: +1 count, +rating sum', () => {
    expect(ratingDelta(null, 7)).toEqual({ countDelta: 1, sumDelta: 7 });
  });
  it('rating removed: -1 count, -rating sum', () => {
    expect(ratingDelta(9, null)).toEqual({ countDelta: -1, sumDelta: -9 });
  });
  it('rating changed: count unchanged, sum by the difference', () => {
    expect(ratingDelta(6, 9)).toEqual({ countDelta: 0, sumDelta: 3 });
    expect(ratingDelta(9, 6)).toEqual({ countDelta: 0, sumDelta: -3 });
  });
  it('handles the real 5-star half-step scale (0.5–5)', () => {
    expect(ratingDelta(null, 0.5)).toEqual({ countDelta: 1, sumDelta: 0.5 }); // min star
    expect(ratingDelta(3, 4.5)).toEqual({ countDelta: 0, sumDelta: 1.5 });    // half-step change
    expect(ratingDelta(5, null)).toEqual({ countDelta: -1, sumDelta: -5 });   // max removed
  });
  it('treats non-numeric / missing as unrated', () => {
    expect(ratingDelta(undefined, 5)).toEqual({ countDelta: 1, sumDelta: 5 });
    expect(ratingDelta('8', 5)).toEqual({ countDelta: 1, sumDelta: 5 }); // string is not a rating
  });
  it('isNoOp detects a zero delta', () => {
    expect(isNoOp({ countDelta: 0, sumDelta: 0 })).toBe(true);
    expect(isNoOp({ countDelta: 0, sumDelta: 3 })).toBe(false);
    expect(isNoOp({ countDelta: 1, sumDelta: 7 })).toBe(false);
  });
});
