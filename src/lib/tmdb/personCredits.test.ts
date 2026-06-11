import { describe, it, expect } from 'vitest';
import { isSelfCredit, splitSelfCredits } from './personCredits';

describe('isSelfCredit', () => {
  it('detects plain Self variants', () => {
    expect(isSelfCredit('Self')).toBe(true);
    expect(isSelfCredit('Himself')).toBe(true);
    expect(isSelfCredit('Herself')).toBe(true);
    expect(isSelfCredit('Themselves')).toBe(true);
  });

  it('detects qualified Self credits', () => {
    expect(isSelfCredit('Self - Guest')).toBe(true);
    expect(isSelfCredit('Self (archive footage)')).toBe(true);
    expect(isSelfCredit('Himself - Host')).toBe(true);
  });

  it('does not flag played characters', () => {
    expect(isSelfCredit('Wednesday Addams')).toBe(false);
    expect(isSelfCredit('Selfridge')).toBe(false);
    expect(isSelfCredit('Dr. Selfin')).toBe(false);
    expect(isSelfCredit('')).toBe(false);
    expect(isSelfCredit(null)).toBe(false);
    expect(isSelfCredit(undefined)).toBe(false);
  });

  it('does not flag roles that merely START with a self-keyword (review-fynd WP8)', () => {
    // Spelade roller — "Self" följt av vanligt ord utan kvalificerar-separator.
    expect(isSelfCredit('Self Made')).toBe(false);
    expect(isSelfCredit('Self Portrait')).toBe(false);
    expect(isSelfCredit('Herself Alone')).toBe(false);
  });

  it('still detects qualified variants with slash/comma and stray whitespace', () => {
    expect(isSelfCredit('Self / Narrator')).toBe(true);
    expect(isSelfCredit('Self, Guest')).toBe(true);
    expect(isSelfCredit('  Self  ')).toBe(true);
  });

  it('does not flag crew jobs', () => {
    expect(isSelfCredit('Director')).toBe(false);
    expect(isSelfCredit('Creator')).toBe(false);
  });
});

describe('splitSelfCredits', () => {
  it('splits into roles and self credits, preserving order', () => {
    const credits = [
      { id: 1, role: 'Pilot' },
      { id: 2, role: 'Self - Guest' },
      { id: 3, role: 'Director' },
      { id: 4, role: 'Herself' },
    ];
    const { roles, selfCredits } = splitSelfCredits(credits);
    expect(roles.map(c => c.id)).toEqual([1, 3]);
    expect(selfCredits.map(c => c.id)).toEqual([2, 4]);
  });
});
