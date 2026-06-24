/**
 * Fråga Binge usage/error counters — pure validation + increment planning.
 *
 * The recordAskBinge callable (index.ts) is the ONLY writer of askBingeStats/{date};
 * clients can't touch that collection (firestore.rules). Everything a client sends
 * is validated here against a FIXED vocabulary before it becomes a Firestore field
 * path — so a malicious caller can never inject arbitrary map keys (which would let
 * the daily doc grow unboundedly / drive write cost). No raw search text ever
 * reaches Firestore: only bucketed counts and fixed filter-type names.
 */

// Filter-TYPE names, mirrors src/lib/askBinge/telemetry.ts FILTER_TYPES.
const FILTER_NAMES = new Set([
  'genre', 'mood', 'runtime', 'provider', 'myProviders', 'excludeSeen', 'rating', 'decade', 'language', 'sort',
]);

// AskFilter keys — the only chips that can be removed (src/lib/askBinge/types.ts).
const CHIP_KEYS = new Set([
  'mediaType', 'genreIds', 'mood', 'runtimeMax', 'providerIds', 'myProvidersOnly',
  'excludeSeen', 'voteAverageMin', 'decade', 'originalLanguage', 'sortBy',
]);

const RESULT_BUCKETS = new Set(['0', '1-9', '10-29', '30+']);

export type RecordInput =
  | { type: 'search'; resultBucket: string; filters: string }
  | { type: 'low_confidence' }
  | { type: 'chip_removed'; key: string };

/** Reduce a client-sent filter combo to a canonical, known-tokens-only key. */
export function canonicalizeFilters(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'none';
  const tokens = raw
    .split('+')
    .filter((t) => FILTER_NAMES.has(t));
  if (tokens.length === 0) return 'none';
  return [...new Set(tokens)].sort().join('+');
}

type ValidationResult =
  | { ok: true; value: RecordInput }
  | { ok: false; error: string };

export function validateRecordInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Ogiltig payload.' };
  const data = raw as Record<string, unknown>;

  switch (data.type) {
    case 'search': {
      const resultBucket = String(data.resultBucket ?? '');
      if (!RESULT_BUCKETS.has(resultBucket)) return { ok: false, error: 'Ogiltig resultBucket.' };
      return { ok: true, value: { type: 'search', resultBucket, filters: canonicalizeFilters(data.filters) } };
    }
    case 'low_confidence':
      return { ok: true, value: { type: 'low_confidence' } };
    case 'chip_removed': {
      const key = String(data.key ?? '');
      if (!CHIP_KEYS.has(key)) return { ok: false, error: 'Ogiltig chip-key.' };
      return { ok: true, value: { type: 'chip_removed', key } };
    }
    default:
      return { ok: false, error: 'Ogiltig event-typ.' };
  }
}

export interface Increment {
  path: string[];
  delta: number;
}

/** Translate a validated event into the counter increments it should apply. */
export function buildIncrements(value: RecordInput): Increment[] {
  switch (value.type) {
    case 'search': {
      const isZero = value.resultBucket === '0';
      const incs: Increment[] = [
        { path: ['searches'], delta: 1 },
        { path: ['resultBuckets', value.resultBucket], delta: 1 },
        { path: ['filterCombos', value.filters, 'searches'], delta: 1 },
      ];
      if (isZero) {
        incs.push({ path: ['zeroResults'], delta: 1 });
        incs.push({ path: ['filterCombos', value.filters, 'zero'], delta: 1 });
      }
      return incs;
    }
    case 'low_confidence':
      return [{ path: ['lowConfidence'], delta: 1 }];
    case 'chip_removed':
      return [
        { path: ['chipRemovals'], delta: 1 },
        { path: ['removedChips', value.key], delta: 1 },
      ];
  }
}
