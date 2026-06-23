import { describe, it, expect } from 'vitest';
import {
  MUNICIPALITIES,
  MUNICIPALITY_NAMES,
  findMunicipality,
  isValidMunicipality,
} from './municipalities';

describe('Swedish municipalities catalog', () => {
  it('contains exactly the 290 SCB municipalities', () => {
    expect(MUNICIPALITIES).toHaveLength(290);
  });

  it('has unique 4-digit codes and unique names', () => {
    const codes = new Set(MUNICIPALITIES.map((m) => m.code));
    const names = new Set(MUNICIPALITIES.map((m) => m.name));
    expect(codes.size).toBe(290);
    expect(names.size).toBe(290);
    for (const m of MUNICIPALITIES) {
      expect(m.code).toMatch(/^\d{4}$/);
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it('exposes all names sorted by the Swedish alphabet (å/ä/ö last)', () => {
    expect(MUNICIPALITY_NAMES).toHaveLength(290);
    expect(MUNICIPALITY_NAMES[0]).toBe('Ale');
    expect(MUNICIPALITY_NAMES[MUNICIPALITY_NAMES.length - 1]).toBe('Övertorneå');
    // monotonic per sv-locale collation
    const resorted = [...MUNICIPALITY_NAMES].sort((a, b) => a.localeCompare(b, 'sv'));
    expect(MUNICIPALITY_NAMES).toEqual(resorted);
  });

  it('looks up municipalities case-insensitively, trimming whitespace', () => {
    expect(findMunicipality('Stockholm')?.code).toBe('0180');
    expect(findMunicipality('  göteborg ')?.code).toBe('1480');
    expect(findMunicipality('MALMÖ')?.code).toBe('1280');
    expect(findMunicipality('Östra Göinge')?.code).toBe('1256');
  });

  it('rejects unknown / empty names', () => {
    expect(findMunicipality('Köpenhamn')).toBeNull();
    expect(findMunicipality('')).toBeNull();
    expect(findMunicipality(null)).toBeNull();
    expect(findMunicipality(undefined)).toBeNull();
    expect(isValidMunicipality('Oslo')).toBe(false);
    expect(isValidMunicipality('Uppsala')).toBe(true);
  });
});
