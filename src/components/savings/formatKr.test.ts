import { describe, it, expect } from 'vitest';
import { formatKr } from './formatKr';

// sv-SE groups thousands with a no-break space (U+00A0), so "1 234" never wraps
// across a line break between the digit groups.
const NBSP = ' ';

describe('formatKr', () => {
  it('groups a four-digit amount', () => {
    expect(formatKr(1234)).toBe(`1${NBSP}234`);
  });

  it('groups a five-digit amount', () => {
    expect(formatKr(11483)).toBe(`11${NBSP}483`);
  });

  it('leaves a three-digit amount ungrouped', () => {
    expect(formatKr(269)).toBe('269');
  });

  it('writes zero as 0', () => {
    expect(formatKr(0)).toBe('0');
  });
});
