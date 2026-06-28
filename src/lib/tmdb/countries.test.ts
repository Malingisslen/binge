import { describe, it, expect } from 'vitest';
import { getCountryName } from './countries';

describe('getCountryName', () => {
  it('resolves Swedish country names for known codes', () => {
    expect(getCountryName('SE')).toBe('Sverige');
    expect(getCountryName('US')).toBe('USA');
  });

  it('resolves Kosovo (XK) — TMDB uses XK in SE-region data (BIN-295)', () => {
    expect(getCountryName('XK')).toBe('Kosovo');
  });

  it('falls back to the raw code for an unknown country', () => {
    expect(getCountryName('ZZ')).toBe('ZZ');
  });
});
