// Matches characters from non-Latin scripts: CJK, Cyrillic, Thai, Arabic, Hebrew,
// Devanagari, Bengali, Tamil, Korean (Hangul), Japanese (Hiragana/Katakana), etc.
const NON_LATIN_RE = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

function isNonLatin(s: string | undefined): boolean {
  if (!s) return false;
  return NON_LATIN_RE.test(s);
}

// Checks both the display title and original title — TMDB may return
// an English display title while the original is in a non-Latin script.
export function hasNonLatinTitle(title: string | undefined, originalTitle?: string): boolean {
  return isNonLatin(title) || isNonLatin(originalTitle);
}

export function isFromHiddenCountry(
  originCountry: string[] | undefined,
  hiddenCountries: string[]
): boolean {
  if (!originCountry?.length || !hiddenCountries.length) return false;
  return originCountry.every(c => hiddenCountries.includes(c));
}
