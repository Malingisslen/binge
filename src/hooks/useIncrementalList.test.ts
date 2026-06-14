import { describe, it, expect } from 'vitest';
import { incrementalSlice } from './useIncrementalList';

describe('incrementalSlice', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  it('kapar visible till count och flaggar hasMore', () => {
    const r = incrementalSlice(items, 100);
    expect(r.visible).toHaveLength(100);
    expect(r.visible[0]).toBe(0);
    expect(r.visible[99]).toBe(99);
    expect(r.hasMore).toBe(true);
  });
  it('hasMore=false när count täcker hela listan', () => {
    const r = incrementalSlice(items, 250);
    expect(r.visible).toHaveLength(250);
    expect(r.hasMore).toBe(false);
  });
  it('hanterar count > length utan att spilla', () => {
    const r = incrementalSlice([1, 2, 3], 100);
    expect(r.visible).toEqual([1, 2, 3]);
    expect(r.hasMore).toBe(false);
  });
});
