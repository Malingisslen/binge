import { describe, it, expect } from 'vitest';
import {
  isTmdbFieldsStale,
  allTargetFieldsAbsent,
  buildClearedPayload,
  tsToMillis,
  TMDB_FIELDS_MAX_AGE_MS,
  TMDB_DERIVED_FIELDS,
  TMDB_FIELDS_STAMP,
  FORBIDDEN_FIELDS,
} from './logic';

const now = 1_000_000_000_000; // fixed "now" for deterministic boundaries

describe('TMDB_FIELDS_MAX_AGE_MS', () => {
  it('is 5 months (150 days) — under the §1.C 6-month ceiling with slack', () => {
    expect(TMDB_FIELDS_MAX_AGE_MS).toBe(5 * 30 * 24 * 60 * 60 * 1000);
    const sixMonthsMs = 6 * 30 * 24 * 60 * 60 * 1000;
    expect(TMDB_FIELDS_MAX_AGE_MS).toBeLessThan(sixMonthsMs);
  });
});

describe('tsToMillis', () => {
  it('reads epoch ms from a Timestamp-like object (has toMillis)', () => {
    expect(tsToMillis({ toMillis: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it('returns null for missing / legacy / non-timestamp shapes', () => {
    expect(tsToMillis(undefined)).toBe(null);
    expect(tsToMillis(null)).toBe(null);
    expect(tsToMillis(1_700_000_000_000)).toBe(null); // a raw number, not a Timestamp
    expect(tsToMillis('2026-01-01')).toBe(null);
    expect(tsToMillis({})).toBe(null);
  });

  it('returns null when toMillis yields a non-finite value', () => {
    expect(tsToMillis({ toMillis: () => NaN })).toBe(null);
    expect(tsToMillis({ toMillis: () => Infinity })).toBe(null);
  });
});

describe('isTmdbFieldsStale', () => {
  it('treats a MISSING stamp as stale (safe default — retain-risk inverts)', () => {
    expect(isTmdbFieldsStale(null, now)).toBe(true);
  });

  it('clears once older than 5 months', () => {
    expect(isTmdbFieldsStale(now - TMDB_FIELDS_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it('keeps when within 5 months (exact boundary = kept)', () => {
    expect(isTmdbFieldsStale(now - TMDB_FIELDS_MAX_AGE_MS + 1, now)).toBe(false);
    expect(isTmdbFieldsStale(now - TMDB_FIELDS_MAX_AGE_MS, now)).toBe(false);
    expect(isTmdbFieldsStale(now, now)).toBe(false);
  });
});

describe('allTargetFieldsAbsent', () => {
  it('true when none of the clearable fields is present', () => {
    expect(allTargetFieldsAbsent({})).toBe(true);
    expect(allTargetFieldsAbsent({ rating: 4, status: 'sedd', updatedAt: {} })).toBe(true);
  });

  it('false when any clearable field is present — including an explicit null or empty array', () => {
    expect(allTargetFieldsAbsent({ title: 'Dune' })).toBe(false);
    expect(allTargetFieldsAbsent({ posterPath: null })).toBe(false); // present-but-null still needs clearing
    expect(allTargetFieldsAbsent({ providers: [] })).toBe(false);
    expect(allTargetFieldsAbsent({ genreIds: [878] })).toBe(false);
  });
});

describe('buildClearedPayload (DPO hard field-allowlist)', () => {
  const DELETE = Symbol('delete');
  const payload = buildClearedPayload(DELETE);
  const keys = Object.keys(payload).sort();

  it('key set is EXACTLY the TMDB-derived fields plus the freshness stamp', () => {
    const expected = [...TMDB_DERIVED_FIELDS, TMDB_FIELDS_STAMP].sort();
    expect(keys).toEqual(expected);
  });

  it('every clearable field maps to the delete sentinel', () => {
    for (const f of TMDB_DERIVED_FIELDS) expect(payload[f]).toBe(DELETE);
  });

  it('DELETES the freshness stamp too (absent stamp → lazy-refresh repopulates the swept doc)', () => {
    // BIN-402: must NOT leave a fresh stamp — that would make needsTmdbFieldsRefresh
    // return false and the swept doc would render blank until the stamp aged out.
    expect(payload[TMDB_FIELDS_STAMP]).toBe(DELETE);
  });

  it('never contains updatedAt or any user-authored field', () => {
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    // updatedAt is the load-bearing one (drives continueWatching sort).
    expect(payload).not.toHaveProperty('updatedAt');
  });
});

describe('scope integrity', () => {
  it('TMDB_DERIVED_FIELDS and FORBIDDEN_FIELDS are disjoint', () => {
    const derived = new Set<string>(TMDB_DERIVED_FIELDS);
    for (const f of FORBIDDEN_FIELDS) expect(derived.has(f)).toBe(false);
  });

  it('the freshness stamp is not itself a clearable field', () => {
    expect((TMDB_DERIVED_FIELDS as readonly string[]).includes(TMDB_FIELDS_STAMP)).toBe(false);
  });
});
