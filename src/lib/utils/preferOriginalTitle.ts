// Matches non-Latin scripts (same as titleFilter.ts).
const NON_LATIN_RE = /[\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

function isLatin(s: string | undefined | null): boolean {
  if (!s) return false;
  return !NON_LATIN_RE.test(s);
}

/**
 * Returns the original title when it's in a Latin script (typically English),
 * otherwise falls back to the localized Swedish title.
 * This matches the user preference for English original titles in mockup 5.
 */
export function preferOriginalTitle(
  localized: string | undefined | null,
  original: string | undefined | null
): string {
  if (original && isLatin(original)) return original;
  return localized ?? original ?? '';
}
