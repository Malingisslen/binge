// Matches characters from non-Latin scripts: CJK, Cyrillic, Thai, Arabic, Hebrew,
// Devanagari, Bengali, Tamil, Korean (Hangul), Japanese (Hiragana/Katakana), etc.
const NON_LATIN_RE = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

export function hasNonLatinTitle(title: string | undefined): boolean {
  if (!title) return false;
  return NON_LATIN_RE.test(title);
}
