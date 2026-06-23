import { describe, it, expect } from 'vitest';
import { filmographyCompletion } from './filmographyCompletion';

describe('filmographyCompletion', () => {
  const seenSet = new Set([1, 2, 3, 4, 5, 6, 7]); // 7 of Tarantino's seen
  const isSeen = (id: number) => seenSet.has(id);

  it('counts seen vs total and rounds the percentage (7 of 9)', () => {
    const m = filmographyCompletion([1, 2, 3, 4, 5, 6, 7, 8, 9], isSeen);
    expect(m.seen).toBe(7);
    expect(m.total).toBe(9);
    expect(m.pct).toBe(78); // round(7/9*100)
  });

  it('dedupes repeated title ids (a director credited twice on one film)', () => {
    const m = filmographyCompletion([1, 1, 2, 2, 8], isSeen);
    expect(m.total).toBe(3); // {1,2,8}
    expect(m.seen).toBe(2); // 1,2 seen; 8 not
  });

  it('100% when all seen', () => {
    expect(filmographyCompletion([1, 2, 3], isSeen).pct).toBe(100);
  });

  it('0% and no divide-by-zero on an empty set', () => {
    const m = filmographyCompletion([], isSeen);
    expect(m).toEqual({ seen: 0, total: 0, pct: 0 });
  });
});
