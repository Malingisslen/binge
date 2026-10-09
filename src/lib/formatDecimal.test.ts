import { describe, it, expect } from 'vitest';
import { formatDecimal } from './formatDecimal';

describe('formatDecimal', () => {
  it('writes a Swedish decimal comma, never a point', () => {
    expect(formatDecimal(3.8)).toBe('3,8');
    expect(formatDecimal(8.25)).not.toContain('.');
  });
  it('keeps one decimal on whole numbers', () => {
    expect(formatDecimal(5)).toBe('5,0');
  });
});
