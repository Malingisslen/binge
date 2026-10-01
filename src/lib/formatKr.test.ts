import { describe, it, expect } from 'vitest';
import { formatKr } from './formatKr';

// Either no-break space, whichever the runtime's sv-SE ICU data uses, so the
// digit groups never wrap apart. A plain space would let them.
const NO_BREAK = '[\u00A0\u202F]';
const grouped = (a: string, b: string) => new RegExp(`^${a}${NO_BREAK}${b}$`);

describe('formatKr', () => {
  it('groups a four-digit amount', () => {
    expect(formatKr(1234)).toMatch(grouped('1', '234'));
  });

  it('groups a five-digit amount', () => {
    expect(formatKr(11483)).toMatch(grouped('11', '483'));
  });

  it('leaves a three-digit amount ungrouped', () => {
    expect(formatKr(269)).toBe('269');
  });

  it('writes zero as 0', () => {
    expect(formatKr(0)).toBe('0');
  });
});
