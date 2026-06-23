import { describe, it, expect } from 'vitest';
import { NORDIC_LANGUAGES, nordicLanguageParam, swedishLanguageParam, NORDIC_NOIR_GENRES } from './nordic';

describe('nordic discovery lens params', () => {
  it('builds a pipe-joined OR list of valid TMDB Nordic language codes', () => {
    const param = nordicLanguageParam();
    // 'nb'/'nn' dropped (BIN-202): not valid TMDB discover original_language codes.
    expect(param).toBe('sv|da|no|fi|is');
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
