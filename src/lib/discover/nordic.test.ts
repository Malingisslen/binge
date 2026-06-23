import { describe, it, expect } from 'vitest';
import { NORDIC_LANGUAGES, nordicLanguageParam, swedishLanguageParam, NORDIC_NOIR_GENRES } from './nordic';

describe('nordic discovery lens params', () => {
  it('builds a pipe-joined OR list of Nordic language codes', () => {
    const param = nordicLanguageParam();
    expect(param).toBe('sv|da|no|nb|nn|fi|is');
    // every declared language is present
    for (const lang of NORDIC_LANGUAGES) {
      expect(param.split('|')).toContain(lang);
    }
  });

  it('swedish-only lens is just sv', () => {
    expect(swedishLanguageParam()).toBe('sv');
  });

  it('nordisk noir is crime OR thriller genre ids', () => {
    expect(NORDIC_NOIR_GENRES).toBe('80|53');
  });
});
