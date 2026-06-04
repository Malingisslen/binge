import { describe, it, expect } from 'vitest';
import { nextCursor, hasFullPage } from './pagination';

describe('hasFullPage', () => {
  it('true when page is exactly pageSize', () => { expect(hasFullPage(new Array(50).fill(0), 50)).toBe(true); });
  it('false when page is short', () => { expect(hasFullPage(new Array(12).fill(0), 50)).toBe(false); });
  it('false for an empty page', () => { expect(hasFullPage([], 50)).toBe(false); });
});
describe('nextCursor', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('returns the last item as cursor when page is full', () => { expect(nextCursor(items, 3)).toEqual({ id: 'c' }); });
  it('returns undefined when the page is short', () => { expect(nextCursor(items, 50)).toBeUndefined(); });
  it('returns undefined for an empty page', () => { expect(nextCursor([], 50)).toBeUndefined(); });
});
