import { describe, it, expect } from 'vitest';
import {
  needsTmdbFieldsRefresh,
  needsProvidersRefresh,
  planTmdbFieldsRefresh,
  shouldStampProvidersAtAdd,
  stampOlderThan,
  TMDB_FIELDS_REFRESH_INTERVAL_MS,
  PROVIDERS_REFRESH_INTERVAL_MS,
} from './tmdbFieldsRefresh';

const NOW = Date.UTC(2026, 6, 11); // 2026-07-11
const STAMP = Symbol('serverTimestamp'); // sentinel — the real serverTimestamp() in prod

// Shared freshness predicate underlying all three group gates (BIN-468 code-review #2).
describe('stampOlderThan', () => {
  it('absent stamp is always older-than', () => {
    expect(stampOlderThan(null, NOW, 1000)).toBe(true);
    expect(stampOlderThan(undefined, NOW, 1000)).toBe(true);
  });
  it('inclusive boundary: true AT the interval, false just inside', () => {
    expect(stampOlderThan(new Date(NOW - 1000), NOW, 1000)).toBe(true);
    expect(stampOlderThan(new Date(NOW - 999), NOW, 1000)).toBe(false);
  });
});

describe('needsTmdbFieldsRefresh', () => {
  it('refreshes when the stamp is absent (never stamped, or swept clean)', () => {
    expect(needsTmdbFieldsRefresh(null, NOW)).toBe(true);
    expect(needsTmdbFieldsRefresh(undefined, NOW)).toBe(true);
  });

  it('skips a freshly-stamped title (no write per view)', () => {
    const justNow = new Date(NOW - 60_000);
    expect(needsTmdbFieldsRefresh(justNow, NOW)).toBe(false);
  });

  it('skips a title stamped within the interval', () => {
    const stamp = new Date(NOW - (TMDB_FIELDS_REFRESH_INTERVAL_MS - 24 * 60 * 60 * 1000)); // 1 day inside
    expect(needsTmdbFieldsRefresh(stamp, NOW)).toBe(false);
  });

  it('refreshes once the stamp crosses the interval', () => {
    const stamp = new Date(NOW - (TMDB_FIELDS_REFRESH_INTERVAL_MS + 24 * 60 * 60 * 1000)); // 1 day past
    expect(needsTmdbFieldsRefresh(stamp, NOW)).toBe(true);
  });

  it('interval stays well under the 5-month sweep threshold (viewed titles are never swept)', () => {
    const SWEEP_THRESHOLD_MS = 5 * 30 * 24 * 60 * 60 * 1000;
    expect(TMDB_FIELDS_REFRESH_INTERVAL_MS).toBeLessThan(SWEEP_THRESHOLD_MS);
  });
});

// BIN-468 A2 — the title page writes providers only as a FALLBACK, gated by the
// providers group's own stamp (providersCheckedAt), so it never clobbers a fresher
// advisor/backfill value. The interval matches the advisor's re-check window (60d).
describe('needsProvidersRefresh (providers-group fallback gate)', () => {
  it('refreshes when providersCheckedAt is absent (never checked / swept clean)', () => {
    expect(needsProvidersRefresh(null, NOW)).toBe(true);
    expect(needsProvidersRefresh(undefined, NOW)).toBe(true);
  });

  it('skips when providers were checked within the advisor re-check window (do NOT clobber fresher data)', () => {
    const recent = new Date(NOW - (PROVIDERS_REFRESH_INTERVAL_MS - 24 * 60 * 60 * 1000)); // 1 day inside
    expect(needsProvidersRefresh(recent, NOW)).toBe(false);
  });

  it('refreshes once providersCheckedAt crosses the window', () => {
    const old = new Date(NOW - (PROVIDERS_REFRESH_INTERVAL_MS + 24 * 60 * 60 * 1000)); // 1 day past
    expect(needsProvidersRefresh(old, NOW)).toBe(true);
  });

  it('exact boundary: refreshes AT the interval (>= — guards a >= → > regression)', () => {
    expect(needsProvidersRefresh(new Date(NOW - PROVIDERS_REFRESH_INTERVAL_MS), NOW)).toBe(true);
    expect(needsProvidersRefresh(new Date(NOW - PROVIDERS_REFRESH_INTERVAL_MS + 1), NOW)).toBe(false);
  });

  it('window stays under the 5-month sweep threshold', () => {
    expect(PROVIDERS_REFRESH_INTERVAL_MS).toBeLessThan(5 * 30 * 24 * 60 * 60 * 1000);
  });
});

// BIN-468 (code-review MEDIUM): addItem is overloaded (new add + useMarkSeen re-mark).
// providersCheckedAt must be stamped ONLY on a genuine new add carrying real providers —
// a re-mark reuses cached/[] providers and would falsely re-certify + suppress backfill.
describe('shouldStampProvidersAtAdd', () => {
  it('stamps on a genuine new add with real providers', () => {
    // BIN-814 widened the contract: "real providers" now means the PAIR. The third
    // argument is not padding — see the dedicated describe below for why an add that
    // knows only the broad list must leave the stamp absent.
    expect(shouldStampProvidersAtAdd(true, [8, 76], [8])).toBe(true);
  });
  it('does NOT stamp on a re-mark of an existing item (even with providers)', () => {
    expect(shouldStampProvidersAtAdd(false, [8, 76], [8])).toBe(false);
  });
  it('does NOT stamp a new add that carries no provider data (let backfill own it)', () => {
    expect(shouldStampProvidersAtAdd(true, [], [])).toBe(false);
    expect(shouldStampProvidersAtAdd(true, undefined, undefined)).toBe(false);
  });
});

describe('planTmdbFieldsRefresh (decoupled per-group write plan)', () => {
  const fields = { title: 'Dune', posterPath: '/d.jpg', providers: [8], genreIds: [878], tmdbStatus: 'Released', runtime: 155 };

  // BIN-814: the providers GROUP is two fields now. They are gated by one stamp and
  // must be written together — a plan that emitted only the broad one would leave the
  // advisor reading a subscription answer derived from an older fetch, which is the
  // drift the ticket ended.
  const pairFields = { ...fields, providers: [8, 76], subscriptionProviders: [8] };

  it('writes BOTH provider fields when the providers group is stale', () => {
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, pairFields, NOW, STAMP)!;
    expect(p.providers).toEqual([8, 76]);
    expect(p.subscriptionProviders).toEqual([8]);
    expect(p.providersCheckedAt).toBe(STAMP);
  });

  it('writes an EMPTY subset — "no subscription covers this" is a real answer', () => {
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, { ...fields, providers: [76], subscriptionProviders: [] }, NOW, STAMP)!;
    expect(p.subscriptionProviders).toEqual([]);
  });

  it('writes NEITHER when the providers group is fresh', () => {
    const current = { tmdbFieldsRefreshedAt: null, providersCheckedAt: new Date(NOW - 1000) };
    const p = planTmdbFieldsRefresh(current, pairFields, NOW, STAMP)!;
    expect('providers' in p).toBe(false);
    expect('subscriptionProviders' in p).toBe(false);
  });

  it('omits the subset when the caller did not supply one, rather than clearing it', () => {
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, fields, NOW, STAMP)!;
    expect(p.providers).toEqual([8]);
    expect('subscriptionProviders' in p).toBe(false);
  });

  it('returns null when neither group needs a write (both stamps fresh)', () => {
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: new Date(NOW - 1000) };
    expect(planTmdbFieldsRefresh(current, fields, NOW, STAMP)).toBeNull();
  });

  it('writes the static group + its stamp when only the static stamp is stale — NOT providers', () => {
    // static stale, providers fresh → providers must be left untouched (no clobber)
    const current = { tmdbFieldsRefreshedAt: null, providersCheckedAt: new Date(NOW - 1000) };
    const p = planTmdbFieldsRefresh(current, fields, NOW, STAMP)!;
    expect(p).not.toBeNull();
    expect(p.tmdbFieldsRefreshedAt).toBe(STAMP);
    expect(p.title).toBe('Dune');
    expect(p.runtime).toBe(155);
    expect('providers' in p).toBe(false);
    expect('providersCheckedAt' in p).toBe(false);
  });

  it('writes providers + providersCheckedAt when only providers is stale — decoupled from the static stamp', () => {
    // static FRESH but providers stale → must still repair providers (DBA decoupling condition)
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, fields, NOW, STAMP)!;
    expect(p.providers).toEqual([8]);
    expect(p.providersCheckedAt).toBe(STAMP);
    expect('tmdbFieldsRefreshedAt' in p).toBe(false);
    expect('title' in p).toBe(false);
  });

  it('regression (A2): a fresher providersCheckedAt is NEVER overwritten by a build-stale title page', () => {
    const current = { tmdbFieldsRefreshedAt: new Date(NOW - 1000), providersCheckedAt: new Date(NOW - 1000) };
    const p = planTmdbFieldsRefresh(current, fields, NOW, STAMP);
    expect(p).toBeNull(); // nothing to write — advisor's fresh providers stand
  });

  it('never writes updatedAt', () => {
    const current = { tmdbFieldsRefreshedAt: null, providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, fields, NOW, STAMP)!;
    expect('updatedAt' in p).toBe(false);
  });

  it('omits providers from the plan when the caller has none, even if the group is stale', () => {
    const current = { tmdbFieldsRefreshedAt: null, providersCheckedAt: null };
    const p = planTmdbFieldsRefresh(current, { title: 'Dune' }, NOW, STAMP)!;
    expect('providers' in p).toBe(false);
    expect('providersCheckedAt' in p).toBe(false);
    expect(p.title).toBe('Dune');
  });
});

// BIN-814. The stamp certifies the whole providers GROUP, and the group is two
// fields now. An add that carries only the broad list must leave the stamp absent —
// absent reads as stale and the title-page repair refills both, whereas a stamp
// would lock the subset out for 60 days on a title the user just added.
describe('shouldStampProvidersAtAdd — the stamp needs the whole pair (BIN-814)', () => {
  it('stamps when both fields are supplied', () => {
    expect(shouldStampProvidersAtAdd(true, [76, 8], [8])).toBe(true);
  });

  it('stamps when the subset is supplied and genuinely EMPTY', () => {
    // Rent-only on Viaplay: [] is a real answer, not a missing one.
    expect(shouldStampProvidersAtAdd(true, [76], [])).toBe(true);
  });

  it('does NOT stamp when only the broad list was supplied', () => {
    // The self-correcting direction: no stamp → the group reads stale → the next
    // title-page view writes both fields.
    expect(shouldStampProvidersAtAdd(true, [76, 8], undefined)).toBe(false);
  });

  it('still refuses on a re-mark, and on an empty broad list', () => {
    expect(shouldStampProvidersAtAdd(false, [76], [76])).toBe(false);
    expect(shouldStampProvidersAtAdd(true, [], [])).toBe(false);
  });
});
