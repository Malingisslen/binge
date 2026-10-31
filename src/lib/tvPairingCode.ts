// The TV shows an 8-character code; the alphabet leaves out look-alikes (0/O, 1/I).
// Kept in step with functions/src/tvPair/logic.ts, which is the server's judge.
export const TV_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TV_CODE_LENGTH = 8;

/** Strips spaces and dashes and upper-cases, so a code typed from the TV screen compares cleanly. */
export function cleanTvCode(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

/** The normalised code, or null when it cannot be one the TV handed out. */
export function parseTvCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = cleanTvCode(raw);
  if (code.length !== TV_CODE_LENGTH) return null;
  for (const ch of code) if (!TV_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** "K7M29QXH" as "K7M2 9QXH", the way it is read off the screen. */
export function groupTvCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
