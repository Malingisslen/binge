/**
 * Recap coverage-gap counter (BIN-544) — pure validation.
 *
 * The logRecapMiss callable (index.ts) is the ONLY writer of
 * recapCoverageGaps/{tmdbId}; clients can't touch that collection directly
 * (firestore.rules — sealed, same pattern as askBingeStats). `tmdbId` is the
 * only input, validated as a positive integer so a malicious caller can't
 * write an arbitrary doc id or field shape.
 */

export interface ValidatedMiss {
  tmdbId: number;
}

type ValidationResult =
  | { ok: true; value: ValidatedMiss }
  | { ok: false; error: string };

export function validateMissInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Ogiltig payload.' };
  const data = raw as Record<string, unknown>;
  // Test review (2026-07-18): only coerce from number/string — `Number(true)`
  // silently resolves to 1, which would otherwise pass every check below.
  if (typeof data.tmdbId !== 'number' && typeof data.tmdbId !== 'string') {
    return { ok: false, error: 'Ogiltigt tmdbId.' };
  }
  const tmdbId = Number(data.tmdbId);
  // isSafeInteger, not isInteger: past MAX_SAFE_INTEGER, distinct raw inputs
  // can round to the same IEEE-754 float, letting a caller collide onto a doc
  // id it didn't literally send.
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return { ok: false, error: 'Ogiltigt tmdbId.' };
  return { ok: true, value: { tmdbId } };
}
