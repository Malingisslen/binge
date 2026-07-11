import { describe, it, expect } from 'vitest';
import {
  isTmdbFieldsStale,
  allTargetFieldsAbsent,
  buildClearedPayload,
  tsToMillis,
  classifyWatchlistDoc,
  resolveMutateEnabled,
  resolveStartCursor,
  budgetExhausted,
  deadlineReached,
  shouldResetCursor,
  buildLastRunAudit,
  TMDB_FIELDS_MAX_AGE_MS,
  TMDB_DERIVED_FIELDS,
  TMDB_FIELDS_STAMP,
  FORBIDDEN_FIELDS,
  MAX_DOCS_PER_RUN,
  MAX_CLEARS_PER_RUN,
  SOFT_DEADLINE_MS,
} from './logic';

const now = 1_000_000_000_000; // fixed "now" for deterministic boundaries

/** A Timestamp-like stamp field at a given epoch ms (what tsToMillis reads). */
const stampAt = (ms: number) => ({ toMillis: () => ms });
const fresh = stampAt(now); // within threshold
const stale = stampAt(now - TMDB_FIELDS_MAX_AGE_MS - 1); // older than 5 months

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

// --------------------------------------------------------------------------
// Orchestration decisions (BIN-452)
// --------------------------------------------------------------------------

describe('resolveMutateEnabled (dry-run gate default)', () => {
  it('dry-run (false) unless the control flag is the boolean true', () => {
    expect(resolveMutateEnabled({ mutateEnabled: true })).toBe(true);
  });

  it('stays dry-run for every non-true value — the whole-DB write gate never fires by accident', () => {
    expect(resolveMutateEnabled(undefined)).toBe(false);
    expect(resolveMutateEnabled(null)).toBe(false);
    expect(resolveMutateEnabled({})).toBe(false); // missing field
    expect(resolveMutateEnabled({ mutateEnabled: false })).toBe(false);
    expect(resolveMutateEnabled({ mutateEnabled: 'true' })).toBe(false); // string, not bool
    expect(resolveMutateEnabled({ mutateEnabled: 1 })).toBe(false);
    expect(resolveMutateEnabled({ mutateEnabled: {} })).toBe(false); // truthy object
  });
});

describe('resolveStartCursor (resume ONLY in mutate mode)', () => {
  it('resumes a string cursor when mutating', () => {
    expect(resolveStartCursor({ cursor: 'users/u1/watchlist/42' }, true)).toBe('users/u1/watchlist/42');
  });

  it('ignores the cursor entirely in dry-run — always scans from doc 0 for a clean full count', () => {
    expect(resolveStartCursor({ cursor: 'users/u1/watchlist/42' }, false)).toBe(null);
  });

  it('null when no usable cursor is stored, even in mutate mode', () => {
    expect(resolveStartCursor({}, true)).toBe(null);
    expect(resolveStartCursor(undefined, true)).toBe(null);
    expect(resolveStartCursor({ cursor: null }, true)).toBe(null);
    expect(resolveStartCursor({ cursor: 123 }, true)).toBe(null); // non-string
  });
});

describe('classifyWatchlistDoc (idempotent per-doc verdict)', () => {
  it('skip-fresh when the stamp is within the staleness threshold', () => {
    expect(classifyWatchlistDoc({ [TMDB_FIELDS_STAMP]: fresh, title: 'Dune' }, now)).toBe('skip-fresh');
  });

  it('skip-empty when stale/absent stamp but no clearable field remains (idempotent — no wasted write)', () => {
    expect(classifyWatchlistDoc({ [TMDB_FIELDS_STAMP]: stale }, now)).toBe('skip-empty');
    // absent stamp = stale, but nothing left to clear (only user-authored fields)
    expect(classifyWatchlistDoc({ rating: 4, status: 'sedd' }, now)).toBe('skip-empty');
  });

  it('clear when stale AND at least one TMDB-derived field is still present', () => {
    expect(classifyWatchlistDoc({ [TMDB_FIELDS_STAMP]: stale, title: 'Dune' }, now)).toBe('clear');
    // missing stamp counts as stale, so a stamp-less legacy doc with TMDB data clears
    expect(classifyWatchlistDoc({ providers: [] }, now)).toBe('clear');
    expect(classifyWatchlistDoc({ posterPath: null }, now)).toBe('clear'); // present-but-null still clears
  });
});

describe('budgetExhausted (per-run scan/clear ceilings)', () => {
  it('false below both ceilings', () => {
    expect(budgetExhausted(0, 0)).toBe(false);
    expect(budgetExhausted(MAX_DOCS_PER_RUN - 1, MAX_CLEARS_PER_RUN - 1)).toBe(false);
  });

  it('true at or above either ceiling (inclusive)', () => {
    expect(budgetExhausted(MAX_DOCS_PER_RUN, 0)).toBe(true);
    expect(budgetExhausted(0, MAX_CLEARS_PER_RUN)).toBe(true);
    expect(budgetExhausted(MAX_DOCS_PER_RUN + 1, 0)).toBe(true);
  });
});

describe('deadlineReached (soft wall-clock guard)', () => {
  it('false before the soft deadline', () => {
    expect(deadlineReached(now, now)).toBe(false);
    expect(deadlineReached(now, now + SOFT_DEADLINE_MS - 1)).toBe(false);
  });

  it('true at or after the soft deadline (inclusive) — leaves room to write the audit before the 300s kill', () => {
    expect(deadlineReached(now, now + SOFT_DEADLINE_MS)).toBe(true);
    expect(deadlineReached(now, now + SOFT_DEADLINE_MS + 1)).toBe(true);
    expect(SOFT_DEADLINE_MS).toBeLessThan(300_000);
  });
});

describe('shouldResetCursor (full-pass cursor reset, mutate-only)', () => {
  it('resets only when mutating AND the pass completed', () => {
    expect(shouldResetCursor(true, true)).toBe(true);
  });

  it('never resets in dry-run (a dry-run owns no cursor) or on an incomplete pass', () => {
    expect(shouldResetCursor(false, true)).toBe(false);
    expect(shouldResetCursor(true, false)).toBe(false);
    expect(shouldResetCursor(false, false)).toBe(false);
  });
});

describe('buildLastRunAudit (honest dry-run vs mutate counts)', () => {
  const AT = Symbol('serverTimestamp');
  const tally = {
    scanned: 500,
    clearable: 12,
    skipped: 488,
    budgetAbort: false,
    fullPassCompleted: true,
  };

  it('dry-run: docsCleared is 0 (nothing written) but docsWouldClear previews the real run', () => {
    const rec = buildLastRunAudit({ ...tally, mutateEnabled: false }, AT);
    expect(rec).toEqual({
      at: AT,
      dryRun: true,
      docsScanned: 500,
      docsCleared: 0,
      docsWouldClear: 12,
      docsSkipped: 488,
      budgetAbort: false,
      fullPassCompleted: true,
    });
  });

  it('mutate: docsCleared reports what was actually written', () => {
    const rec = buildLastRunAudit({ ...tally, mutateEnabled: true }, AT);
    expect(rec.dryRun).toBe(false);
    expect(rec.docsCleared).toBe(12);
    expect(rec.docsWouldClear).toBe(12);
    expect(rec.at).toBe(AT);
  });

  it('carries the incomplete-run flags through so a budget abort is never a silent no-op', () => {
    const rec = buildLastRunAudit(
      { ...tally, mutateEnabled: true, budgetAbort: true, fullPassCompleted: false },
      AT,
    );
    expect(rec.budgetAbort).toBe(true);
    expect(rec.fullPassCompleted).toBe(false);
  });
});
