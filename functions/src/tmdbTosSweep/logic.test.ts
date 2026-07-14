import { describe, it, expect } from 'vitest';
import {
  isTmdbFieldsStale,
  groupIsStale,
  groupHasData,
  groupsToClear,
  buildClearedPayload,
  isUserWatchlistDocPath,
  tsToMillis,
  resolveMutateEnabled,
  resolveStartCursor,
  cursorFieldFor,
  budgetExhausted,
  deadlineReached,
  shouldResetCursor,
  buildLastRunAudit,
  errorToMessage,
  TMDB_FIELDS_MAX_AGE_MS,
  FIELD_GROUPS,
  STATIC_GROUP,
  PROVIDERS_GROUP,
  NEXTAIR_GROUP,
  ALL_CLEARABLE_KEYS,
  ALL_SELECT_KEYS,
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

// --------------------------------------------------------------------------
// Per-group freshness model (BIN-468) — three independently-gated field groups
// --------------------------------------------------------------------------

describe('FIELD_GROUPS definition', () => {
  it('has exactly the three groups, each gated by its own stamp', () => {
    expect(FIELD_GROUPS.map((g) => g.name)).toEqual(['static', 'providers', 'nextair']);
    expect(STATIC_GROUP.stamp).toBe('tmdbFieldsRefreshedAt');
    expect(PROVIDERS_GROUP.stamp).toBe('providersCheckedAt');
    expect(NEXTAIR_GROUP.stamp).toBe('nextAirUpdatedAt');
  });

  it('static group = the fields the title-page lazy-refresh owns', () => {
    expect([...STATIC_GROUP.fields].sort()).toEqual(
      ['title', 'posterPath', 'genreIds', 'tmdbStatus', 'runtime'].sort(),
    );
  });

  it('providers group = just providers (gated by providersCheckedAt)', () => {
    expect([...PROVIDERS_GROUP.fields]).toEqual(['providers']);
  });

  it('nextair group = next-air trio + digitalReleaseDate (calendar read-repair lane)', () => {
    expect([...NEXTAIR_GROUP.fields].sort()).toEqual(
      ['nextAirDate', 'nextAirCode', 'nextAirProvider', 'digitalReleaseDate'].sort(),
    );
  });

  it("a group's own stamp is never also one of its clearable data fields", () => {
    for (const g of FIELD_GROUPS) {
      expect((g.fields as readonly string[]).includes(g.stamp)).toBe(false);
    }
  });

  it('groups are field-disjoint (no field clearable under two stamps)', () => {
    const seen = new Set<string>();
    for (const g of FIELD_GROUPS) {
      for (const f of g.fields) {
        expect(seen.has(f)).toBe(false);
        seen.add(f);
      }
    }
  });

  it('ALL_CLEARABLE_KEYS is every data field ∪ every stamp — the total clearing scope', () => {
    const expected = [
      ...FIELD_GROUPS.flatMap((g) => g.fields),
      ...FIELD_GROUPS.map((g) => g.stamp),
    ].sort();
    expect([...ALL_CLEARABLE_KEYS].sort()).toEqual(expected);
  });

  it('ALL_SELECT_KEYS covers everything the loop reads to judge staleness + presence', () => {
    // must include every stamp (to read freshness) and every data field (to test presence)
    for (const g of FIELD_GROUPS) {
      expect(ALL_SELECT_KEYS).toContain(g.stamp);
      for (const f of g.fields) expect(ALL_SELECT_KEYS).toContain(f);
    }
  });
});

describe('groupIsStale (per-group, against the group\'s own stamp)', () => {
  it('a group with a fresh stamp is not stale', () => {
    expect(groupIsStale(PROVIDERS_GROUP, { providersCheckedAt: fresh }, now)).toBe(false);
  });

  it('a group with a stale stamp is stale', () => {
    expect(groupIsStale(PROVIDERS_GROUP, { providersCheckedAt: stale }, now)).toBe(true);
  });

  it('a group with an ABSENT stamp is stale (safe default)', () => {
    expect(groupIsStale(NEXTAIR_GROUP, {}, now)).toBe(true);
    // a fresh sibling stamp does not rescue a different group
    expect(groupIsStale(PROVIDERS_GROUP, { tmdbFieldsRefreshedAt: fresh }, now)).toBe(true);
  });
});

describe('groupHasData (is there anything to clear in this group)', () => {
  it('true when any of the group\'s data fields is present (incl. null / empty array)', () => {
    expect(groupHasData(PROVIDERS_GROUP, { providers: [] })).toBe(true);
    expect(groupHasData(STATIC_GROUP, { posterPath: null })).toBe(true);
    expect(groupHasData(NEXTAIR_GROUP, { digitalReleaseDate: '2026-01-01' })).toBe(true);
  });

  it('false when none of the group\'s data fields is present', () => {
    expect(groupHasData(PROVIDERS_GROUP, { providersCheckedAt: stale })).toBe(false); // stamp is not data
    expect(groupHasData(STATIC_GROUP, { providers: [8] })).toBe(false); // other group's field
    expect(groupHasData(NEXTAIR_GROUP, {})).toBe(false);
  });
});

describe('groupsToClear (which groups this doc needs swept)', () => {
  it('a group that is stale AND holds data is selected', () => {
    const groups = groupsToClear({ providersCheckedAt: stale, providers: [8] }, now);
    expect(groups.map((g) => g.name)).toEqual(['providers']);
  });

  it('a stale-but-empty group is NOT selected (idempotent — no wasted write)', () => {
    expect(groupsToClear({ providersCheckedAt: stale }, now)).toEqual([]);
  });

  it('a fresh group holding data is NOT selected', () => {
    expect(groupsToClear({ providersCheckedAt: fresh, providers: [8] }, now)).toEqual([]);
  });

  it('selects ONLY the stale groups on a mixed doc — fresh groups are left untouched', () => {
    const data = {
      // static: fresh, holds data → keep
      tmdbFieldsRefreshedAt: fresh,
      title: 'Dune',
      // providers: stale, holds data → clear
      providersCheckedAt: stale,
      providers: [8],
      // nextair: stale, holds data → clear
      nextAirUpdatedAt: stale,
      nextAirDate: '2026-01-01',
    };
    expect(groupsToClear(data, now).map((g) => g.name)).toEqual(['providers', 'nextair']);
  });

  it('a legacy doc with no stamps at all clears every group that holds data', () => {
    const data = { title: 'Dune', providers: [8], nextAirDate: '2026-01-01' };
    expect(groupsToClear(data, now).map((g) => g.name)).toEqual(['static', 'providers', 'nextair']);
  });
});

describe('buildClearedPayload (per-group, DPO hard field-allowlist)', () => {
  const DELETE = Symbol('delete');

  it('clears exactly one group: its data fields + its own stamp, nothing else', () => {
    const payload = buildClearedPayload([PROVIDERS_GROUP], DELETE);
    expect(Object.keys(payload).sort()).toEqual(['providers', 'providersCheckedAt'].sort());
    expect(payload.providers).toBe(DELETE);
    expect(payload.providersCheckedAt).toBe(DELETE);
  });

  it('per-group key sets are exact — one independent assertion per group (no cross-leak)', () => {
    for (const g of FIELD_GROUPS) {
      const payload = buildClearedPayload([g], DELETE);
      expect(Object.keys(payload).sort()).toEqual([...g.fields, g.stamp].sort());
      for (const f of g.fields) expect(payload[f]).toBe(DELETE);
      expect(payload[g.stamp]).toBe(DELETE);
    }
  });

  it('clears the union when multiple groups are passed — still a single flat payload (one write)', () => {
    const payload = buildClearedPayload([PROVIDERS_GROUP, NEXTAIR_GROUP], DELETE);
    expect(Object.keys(payload).sort()).toEqual(
      ['providers', 'providersCheckedAt', 'nextAirDate', 'nextAirCode', 'nextAirProvider', 'digitalReleaseDate', 'nextAirUpdatedAt'].sort(),
    );
  });

  it('DELETES each cleared group\'s stamp too (absent stamp → that group\'s repair path repopulates it)', () => {
    // a doc whose only stale group is static → static stamp deleted, providers/nextair stamps untouched
    const payload = buildClearedPayload([STATIC_GROUP], DELETE);
    expect(payload).toHaveProperty('tmdbFieldsRefreshedAt', DELETE);
    expect(payload).not.toHaveProperty('providersCheckedAt');
    expect(payload).not.toHaveProperty('nextAirUpdatedAt');
  });

  it('never contains updatedAt or any user-authored field, for any group combination', () => {
    const payload = buildClearedPayload([...FIELD_GROUPS], DELETE);
    for (const forbidden of FORBIDDEN_FIELDS) expect(payload).not.toHaveProperty(forbidden);
    expect(payload).not.toHaveProperty('updatedAt');
  });
});

describe('scope integrity', () => {
  it('no clearable key (data field or stamp) is a forbidden/user-authored field', () => {
    const forbidden = new Set<string>(FORBIDDEN_FIELDS);
    for (const key of ALL_CLEARABLE_KEYS) expect(forbidden.has(key)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Collection-group scope guard (BIN-504) — never touch groups/{id}/watchlist
// --------------------------------------------------------------------------

describe('isUserWatchlistDocPath (only users/{uid}/watchlist docs are in scope)', () => {
  it('accepts a users/{uid}/watchlist/{tmdbId} doc path', () => {
    expect(isUserWatchlistDocPath('users/u1/watchlist/1396')).toBe(true);
  });

  it('REJECTS a groups/{id}/watchlist/{tmdbId} doc path (the bug BIN-504 fixes)', () => {
    expect(isUserWatchlistDocPath('groups/g1/watchlist/1396')).toBe(false);
  });

  it('rejects any path whose grandparent collection is not users, and wrong depths', () => {
    expect(isUserWatchlistDocPath('sessions/s1/watchlist/1396')).toBe(false);
    expect(isUserWatchlistDocPath('users/u1/episodeProgress/1396')).toBe(false); // not watchlist
    expect(isUserWatchlistDocPath('users/u1/watchlist')).toBe(false); // collection, not doc
    expect(isUserWatchlistDocPath('users/u1/watchlist/1396/extra/deep')).toBe(false); // too deep
    expect(isUserWatchlistDocPath('watchlist/1396')).toBe(false); // no user parent
    expect(isUserWatchlistDocPath('')).toBe(false);
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

describe('cursorFieldFor (mutate and dry-run keep separate cursors — BIN-507)', () => {
  it('mutate mode → `cursor`, dry-run → `dryRunCursor`', () => {
    expect(cursorFieldFor(true)).toBe('cursor');
    expect(cursorFieldFor(false)).toBe('dryRunCursor');
  });
});

describe('resolveStartCursor (each mode resumes its OWN cursor — BIN-507)', () => {
  it('mutate resumes `cursor`; dry-run resumes `dryRunCursor`', () => {
    expect(resolveStartCursor({ cursor: 'users/u1/watchlist/42' }, true)).toBe('users/u1/watchlist/42');
    expect(resolveStartCursor({ dryRunCursor: 'users/u9/watchlist/7' }, false)).toBe('users/u9/watchlist/7');
  });

  it('a mode never resumes the OTHER mode\'s cursor', () => {
    // dry-run ignores a leftover mutate cursor (no dryRunCursor stored → doc 0)
    expect(resolveStartCursor({ cursor: 'users/u1/watchlist/42' }, false)).toBe(null);
    // mutate ignores a dry-run cursor
    expect(resolveStartCursor({ dryRunCursor: 'users/u9/watchlist/7' }, true)).toBe(null);
  });

  it('null when the mode has no usable stored cursor', () => {
    expect(resolveStartCursor({}, true)).toBe(null);
    expect(resolveStartCursor(undefined, true)).toBe(null);
    expect(resolveStartCursor({ cursor: null }, true)).toBe(null);
    expect(resolveStartCursor({ cursor: 123 }, true)).toBe(null); // non-string
    expect(resolveStartCursor({ dryRunCursor: null }, false)).toBe(null);
    expect(resolveStartCursor({ dryRunCursor: 99 }, false)).toBe(null); // non-string
  });
});

describe('budgetExhausted (per-run scan/clear ceilings)', () => {
  it('each ceiling stays within Firestore\'s daily free-tier quota (BIN-507)', () => {
    // The doc says a single run can never blow the cap because each ceiling is
    // held at/under the free tier: 50k reads / 20k writes per day. A 100k scan
    // ceiling (the pre-BIN-507 value) would bill reads past the free tier.
    expect(MAX_DOCS_PER_RUN).toBeLessThanOrEqual(50_000);
    expect(MAX_CLEARS_PER_RUN).toBeLessThan(20_000);
  });

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

describe('shouldResetCursor (reset the mode\'s cursor on a completed full pass — BIN-507)', () => {
  it('resets when the pass completed (both modes now own a cursor)', () => {
    expect(shouldResetCursor(true)).toBe(true);
  });

  it('never resets on an incomplete pass — the cursor must persist to resume', () => {
    expect(shouldResetCursor(false)).toBe(false);
  });
});

describe('buildLastRunAudit (honest dry-run vs mutate counts + per-group breakdown)', () => {
  const AT = Symbol('serverTimestamp');
  const tally = {
    scanned: 500,
    clearable: 12,
    skipped: 488,
    budgetAbort: false,
    fullPassCompleted: true,
    wouldClearByGroup: { static: 3, providers: 7, nextair: 9 },
  };

  it('dry-run: docsCleared is 0 (nothing written) but docsWouldClear previews the real run', () => {
    const rec = buildLastRunAudit({ ...tally, mutateEnabled: false }, AT);
    expect(rec).toEqual({
      at: AT,
      dryRun: true,
      docsScanned: 500,
      docsCleared: 0,
      docsWouldClear: 12,
      docsWouldClearByGroup: { static: 3, providers: 7, nextair: 9 },
      docsSkipped: 488,
      budgetAbort: false,
      fullPassCompleted: true,
    });
  });

  it('mutate: docsCleared reports docs actually written; per-group counts still reported', () => {
    const rec = buildLastRunAudit({ ...tally, mutateEnabled: true }, AT);
    expect(rec.dryRun).toBe(false);
    expect(rec.docsCleared).toBe(12);
    expect(rec.docsWouldClear).toBe(12);
    expect(rec.docsWouldClearByGroup).toEqual({ static: 3, providers: 7, nextair: 9 });
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

  it('no error passed → the record has NO error fields (clean-run shape unchanged) — BIN-507', () => {
    const rec = buildLastRunAudit({ ...tally, mutateEnabled: false }, AT);
    expect(rec).not.toHaveProperty('error');
    expect(rec).not.toHaveProperty('errorMessage');
    // omitting the arg and passing null are equivalent (both mean "no error")
    expect(buildLastRunAudit({ ...tally, mutateEnabled: false }, AT, null)).not.toHaveProperty('error');
  });

  it('a thrown run flags the record with error + errorMessage and keeps partial counts — BIN-507', () => {
    const rec = buildLastRunAudit(
      { ...tally, mutateEnabled: true, scanned: 120, clearable: 3, fullPassCompleted: false },
      AT,
      new Error('Firestore unavailable'),
    );
    expect(rec.error).toBe(true);
    expect(rec.errorMessage).toBe('Firestore unavailable');
    expect(rec.docsScanned).toBe(120); // counts accumulated before the throw survive
    expect(rec.fullPassCompleted).toBe(false);
  });
});

describe('errorToMessage (BIN-507 audit error string)', () => {
  it('reads an Error\'s message', () => {
    expect(errorToMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error throw', () => {
    expect(errorToMessage('plain string throw')).toBe('plain string throw');
    expect(errorToMessage(42)).toBe('42');
  });

  it('bounds a pathologically long message so it can\'t bloat the state doc', () => {
    const long = 'x'.repeat(1000);
    const out = errorToMessage(new Error(long));
    expect(out.length).toBeLessThanOrEqual(501); // 500 chars + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });
});
