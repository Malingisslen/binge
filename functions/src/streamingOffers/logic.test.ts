// functions/src/streamingOffers/logic.test.ts
import { describe, it, expect } from 'vitest';
import {
  isIntentTitle, dedupeIntent, selectRefreshBatch, computeHealth, streamingOffersDocId,
  classifyRunOutcome, nextRunsWithoutSuccess, feedStatusFor, worstStatus,
} from './logic';
import type { IntentItem, ExistingOffer, WorkItem, DeliveryState } from './types';

/** A feed that has always delivered — the state before anything went wrong. */
const healthy: DeliveryState = { runsWithoutSuccess: 0, lastSuccessAt: 1, lastFailureReason: null };

/** Terse ExistingOffer builder — mediaType defaults to movie (BIN-523). */
const existing = (o: Partial<ExistingOffer>): ExistingOffer => ({
  tmdbId: 1, mediaType: 'movie', checkedAt: 0, nextLeaving: null, ...o,
});
const ids = (out: WorkItem[]): number[] => out.map((w) => w.tmdbId);

const item = (o: Partial<IntentItem>): IntentItem => ({
  tmdbId: 1, mediaType: 'movie', status: 'vill_se', providers: [8], ...o,
});

describe('isIntentTitle', () => {
  it('includes films in vill_se that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'movie', status: 'vill_se', providers: [8] }))).toBe(true);
  });
  it('includes TV in mina that are on a provider', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'mina', providers: [337] }))).toBe(true);
  });
  it('excludes titles not currently on any provider', () => {
    expect(isIntentTitle(item({ providers: [] }))).toBe(false);
  });
  it('excludes watched films and dropped titles', () => {
    expect(isIntentTitle(item({ status: 'sedd' }))).toBe(false);
    expect(isIntentTitle(item({ status: 'avbruten' }))).toBe(false);
  });
  it('excludes TV in vill_se (legacy/unmigrated) — only mina counts for TV', () => {
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'vill_se', providers: [8] }))).toBe(false);
  });

  // BIN-856 quota protection. resolveTmdbId returns NaN when the watchlist
  // doc's `tmdbId` is non-numeric AND its doc id has no digits-only suffix —
  // a shape a client can write, since the rules whitelist the key without
  // binding its type. Such an item can never be fetched, and readExisting
  // skips it too, so it never gains a `checkedAt` and never leaves tier 0
  // ("never checked", always sorted first). Without this guard it is
  // re-selected on EVERY run forever, spending one reserved vendor call each
  // time against a 300-call monthly cap. Otherwise-perfect item, so the id is
  // the only thing under test here.
  it('excludes a title whose id could not be resolved, however valid it looks', () => {
    expect(isIntentTitle(item({ mediaType: 'movie', status: 'vill_se', providers: [8], tmdbId: NaN }))).toBe(false);
    expect(isIntentTitle(item({ mediaType: 'tv', status: 'mina', providers: [337], tmdbId: NaN }))).toBe(false);
  });

  it('excludes non-finite ids generally, not just NaN', () => {
    expect(isIntentTitle(item({ providers: [8], tmdbId: Infinity }))).toBe(false);
    expect(isIntentTitle(item({ providers: [8], tmdbId: -Infinity }))).toBe(false);
  });
});

describe('streamingOffersDocId (BIN-523)', () => {
  it('namespaces the offers doc by media type', () => {
    expect(streamingOffersDocId('movie', 42)).toBe('movie_42');
    expect(streamingOffersDocId('tv', 42)).toBe('tv_42');
  });
});

describe('dedupeIntent', () => {
  it('collapses the same tmdbId tracked by multiple users to one entry', () => {
    const out = dedupeIntent([item({ tmdbId: 5 }), item({ tmdbId: 5 }), item({ tmdbId: 6 })]);
    expect(out.map((x) => x.tmdbId).sort()).toEqual([5, 6]);
  });
  it('normalizes mediaType to movie|tv', () => {
    expect(dedupeIntent([item({ tmdbId: 9, mediaType: 'tv' })])[0].mediaType).toBe('tv');
  });

  // BIN-545 discriminating oracle: under the old bare-tmdbId Map the TV entry
  // won (first occurrence) and the movie was dropped from the work set for good.
  it('keeps movie N and TV N as SEPARATE entries', () => {
    const out = dedupeIntent([
      item({ tmdbId: 7, mediaType: 'tv', status: 'mina' }),
      item({ tmdbId: 7, mediaType: 'movie', status: 'vill_se' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.mediaType).sort()).toEqual(['movie', 'tv']);
    expect(out.every((x) => x.tmdbId === 7)).toBe(true);
  });

  it('still collapses duplicates WITHIN one media type', () => {
    const out = dedupeIntent([
      item({ tmdbId: 7, mediaType: 'tv', status: 'mina' }),
      item({ tmdbId: 7, mediaType: 'tv', status: 'mina' }),
      item({ tmdbId: 7, mediaType: 'movie', status: 'vill_se' }),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('selectRefreshBatch', () => {
  const work: WorkItem[] = [{ tmdbId: 1, mediaType: 'movie' }, { tmdbId: 2, mediaType: 'movie' }, { tmdbId: 3, mediaType: 'movie' }];
  const now = Date.parse('2026-06-20T00:00:00Z');

  it('prioritizes never-checked titles first', () => {
    // 2 and 3 have no existing doc -> they come before 1
    const out = ids(selectRefreshBatch(work, [existing({ tmdbId: 1, checkedAt: now - 1000 })], now, 2));
    expect(out).toContain(2);
    expect(out).toContain(3);
    expect(out).not.toContain(1);
  });

  it('then prioritizes titles leaving within 5 days (re-confirm)', () => {
    const rows: ExistingOffer[] = [
      existing({ tmdbId: 1, checkedAt: now, nextLeaving: '2026-06-22' }), // leaves in 2 days
      existing({ tmdbId: 2, checkedAt: now - 10_000 }),
      existing({ tmdbId: 3, checkedAt: now - 5_000 }),
    ];
    expect(ids(selectRefreshBatch(work, rows, now, 1))).toEqual([1]); // near-expiry beats merely-stale
  });

  it('then falls back to stalest checkedAt', () => {
    const rows: ExistingOffer[] = [
      existing({ tmdbId: 1, checkedAt: now - 1_000 }),
      existing({ tmdbId: 2, checkedAt: now - 9_000 }),
      existing({ tmdbId: 3, checkedAt: now - 5_000 }),
    ];
    expect(ids(selectRefreshBatch(work, rows, now, 2))).toEqual([2, 3]); // oldest first
  });

  it('never returns more than the budget', () => {
    expect(selectRefreshBatch(work, [], now, 2)).toHaveLength(2);
  });

  it('carries mediaType through to the batch (BIN-545 — the caller no longer re-derives it)', () => {
    const out = selectRefreshBatch([{ tmdbId: 4, mediaType: 'tv' }], [], now, 1);
    expect(out).toEqual([{ tmdbId: 4, mediaType: 'tv' }]);
  });

  it('already-expired titles (negative delta) are NOT promoted to tier-1 over never-checked titles', () => {
    // tmdbId 1 has nextLeaving 3 days in the PAST — negative delta, already expired
    // tmdbId 2 has never been checked — should be prioritized over the expired one
    const rows = [existing({ tmdbId: 1, checkedAt: now - 2_000, nextLeaving: '2026-06-17' })];
    // tmdbId 2 (never-checked, tier-0) beats tmdbId 1 (expired, tier-2)
    expect(ids(selectRefreshBatch(work, rows, now, 1))).toEqual([2]);
  });

  it('already-expired titles lose to stale-but-checked titles (discriminating oracle for delta>=0 fix)', () => {
    // Under old code: expired nextLeaving had no lower-bound, so expired title = tier-1 → wins
    // Under fix: expired (negative delta) falls to tier-2 → stalest checkedAt wins → tmdbId 2
    const rows: ExistingOffer[] = [
      existing({ tmdbId: 1, checkedAt: now - 2_000, nextLeaving: '2026-06-17' }), // expired 3 days ago → was tier-1 (bug), now tier-2
      existing({ tmdbId: 2, checkedAt: now - 9_000 }),                            // never-leaving, stale → tier-2
      existing({ tmdbId: 3, checkedAt: now - 5_000 }),                            // never-leaving, less stale → tier-2
    ];
    // Both tmdbId 1 and 2 are tier-2; stalest checkedAt (9000ms ago) is tmdbId 2
    // Old bug: tmdbId 1 was tier-1 and would have won → [1]; Fix: → [2]
    expect(ids(selectRefreshBatch(work, rows, now, 1))).toEqual([2]);
  });

  // BIN-523 discriminating oracle: keyed on bare tmdbId, TV 1's fresh doc made
  // movie 1 look freshly-checked, so the movie never got refreshed.
  // Discriminating oracle: movie 1 must COMPETE to prove the keying matters. With a
  // single work item and budget 1 the item comes back whatever the tier, so that shape
  // passes even under bare-tmdbId keying (found by test review 2026-07-20). Here movie 1
  // has no doc of its own (tier-0, never checked) and must beat the genuinely-stale
  // movie 2; under the old keying TV 1's fresh doc would satisfy movie 1 and 2 would win.
  it('does not let TV N\'s existing doc satisfy movie N', () => {
    const rows = [
      existing({ tmdbId: 1, mediaType: 'tv', checkedAt: now }),
      existing({ tmdbId: 2, mediaType: 'movie', checkedAt: now - 9_000 }),
    ];
    const out = selectRefreshBatch(
      [{ tmdbId: 1, mediaType: 'movie' }, { tmdbId: 2, mediaType: 'movie' }],
      rows, now, 1,
    );
    expect(out).toEqual([{ tmdbId: 1, mediaType: 'movie' }]); // tier-0, never checked
  });

  it('prefers the freshest doc when a legacy bare-id and a namespaced doc both exist', () => {
    // Both rows describe movie 1; the stale leftover must not win the checkedAt
    // used for ordering, or a just-refreshed title jumps the queue forever.
    const rows: ExistingOffer[] = [
      existing({ tmdbId: 1, checkedAt: now - 90_000 }), // legacy leftover
      existing({ tmdbId: 1, checkedAt: now }),          // namespaced, fresh
      existing({ tmdbId: 2, checkedAt: now - 9_000 }),
      existing({ tmdbId: 3, checkedAt: now - 5_000 }),
    ];
    expect(ids(selectRefreshBatch(work, rows, now, 1))).toEqual([2]);
  });
});

// BIN-541 code review (2026-07-17): thresholds recalibrated 14/21 → 31/62
// (one/two billing cycles) after PER_RUN_SELECT dropped from ~95 to 9 — see
// logic.ts's WARN_DAYS/CRITICAL_DAYS comment. `budget` stays an arbitrary
// generic test value (95) since computeHealth is a pure function independent
// of the production constant; only the day-boundary math below changed.
describe('computeHealth', () => {
  it('ok when interval is short', () => {
    const h = computeHealth(700, 95, '2026-06-20T00:00:00Z', healthy);
    expect(h.refreshIntervalDays).toBe(8); // ceil(700/95)
    expect(h.status).toBe('ok');
  });
  it('warns past 31 days', () => {
    expect(computeHealth(3000, 95, '2026-06-20T00:00:00Z', healthy).status).toBe('warn'); // ceil(3000/95) = 32
  });
  it('critical past 62 days', () => {
    expect(computeHealth(6000, 95, '2026-06-20T00:00:00Z', healthy).status).toBe('critical'); // ceil(6000/95) = 64
  });
  it('exactly 31 days is still ok (boundary)', () => {
    // ceil(2945/95) = 31
    expect(computeHealth(2945, 95, '2026-06-20T00:00:00Z', healthy).status).toBe('ok');
  });
  it('exactly 62 days is still warn not critical (boundary)', () => {
    // ceil(5890/95) = 62
    expect(computeHealth(5890, 95, '2026-06-20T00:00:00Z', healthy).status).toBe('warn');
  });
  it('zero budget returns MAX_SAFE_INTEGER interval (not Infinity) and status critical', () => {
    const h = computeHealth(100, 0, '2026-06-20T00:00:00Z', healthy);
    expect(h.refreshIntervalDays).toBe(Number.MAX_SAFE_INTEGER);
    expect(h.status).toBe('critical');
    expect(isFinite(h.refreshIntervalDays)).toBe(true);
  });

  // BIN-856. THE regression this whole section exists for: for a month the doc
  // read `status: "ok"` while not a single vendor call had succeeded, because
  // the calculation is a pure function of library size and a constant and can
  // never observe the outcome. Malin chose option B — one status, the worse of
  // capacity and delivery.
  it('is NOT ok when the feed has delivered nothing, however comfortable the capacity', () => {
    const starved: DeliveryState = { runsWithoutSuccess: 2, lastSuccessAt: 1, lastFailureReason: 'request-rejected' };
    const h = computeHealth(24, 9, '2026-08-12T00:00:00Z', starved);
    // Capacity is genuinely fine — ceil(24/9) = 3 days, well inside the green.
    expect(h.refreshIntervalDays).toBe(3);
    expect(h.capacityStatus).toBe('ok');
    // ...and the doc must still refuse to say "ok".
    expect(h.feedStatus).toBe('warn');
    expect(h.status).toBe('warn');
  });

  it('reports the worse of the two, whichever side is worse', () => {
    const dead: DeliveryState = { runsWithoutSuccess: 4, lastSuccessAt: null, lastFailureReason: 'request-rejected' };
    // Feed critical, capacity ok -> critical.
    expect(computeHealth(24, 9, '2026-08-12T00:00:00Z', dead).status).toBe('critical');
    // Capacity critical, feed ok -> critical (the pre-existing behaviour, unchanged).
    expect(computeHealth(6000, 95, '2026-08-12T00:00:00Z', healthy).status).toBe('critical');
  });

  it('carries the diagnosis so "why is it red" is answerable', () => {
    const starved: DeliveryState = { runsWithoutSuccess: 3, lastSuccessAt: 1786476543035, lastFailureReason: 'request-rejected' };
    const h = computeHealth(24, 9, '2026-08-12T00:00:00Z', starved);
    expect(h.runsWithoutSuccess).toBe(3);
    expect(h.lastSuccessAt).toBe(1786476543035);
    expect(h.lastFailureReason).toBe('request-rejected');
  });
});

/**
 * BIN-856. The old per-run signal collapsed "we made no calls" and "we made
 * nine calls and every one failed" into the same `no_signal`. The second is
 * what ran for a month unnoticed, so the two must be told apart.
 */
describe('classifyRunOutcome', () => {
  it('counts a run that got real data as delivered', () => {
    expect(classifyRunOutcome(9, true, false)).toBe('delivered');
  });

  it('counts a run that spent calls and got nothing usable as a non-delivery', () => {
    // Exactly the BIN-856 shape: nine reserved slots spent, nine 400s, no 429.
    expect(classifyRunOutcome(9, false, false)).toBe('no-delivery');
  });

  it('treats a run that never called the vendor as inconclusive, not a failure', () => {
    // Empty batch, or the budget denied before the first call. Proves nothing
    // either way — must not accuse a healthy feed.
    expect(classifyRunOutcome(0, false, false)).toBe('inconclusive');
  });

  it('treats being rate-limited as inconclusive, not a broken feed', () => {
    // Quota exhaustion is a normal, expected state with its own separate
    // alarm. Folding it in here would cry wolf every cycle end.
    expect(classifyRunOutcome(9, false, true)).toBe('inconclusive');
  });

  it('counts data that arrived before a 429 as delivered', () => {
    // Some titles succeeded, then the quota ran out. Data DID arrive.
    expect(classifyRunOutcome(9, true, true)).toBe('delivered');
  });
});

describe('nextRunsWithoutSuccess', () => {
  it('clears the streak only on real delivery', () => {
    expect(nextRunsWithoutSuccess(3, 'delivered')).toBe(0);
  });
  it('extends the streak on a non-delivery', () => {
    expect(nextRunsWithoutSuccess(1, 'no-delivery')).toBe(2);
  });
  it('leaves an in-progress streak untouched when the run proved nothing', () => {
    // The trap: letting an inconclusive run reset the counter means a feed
    // that alternates "broken" and "nothing to do" never reaches the alarm.
    expect(nextRunsWithoutSuccess(3, 'inconclusive')).toBe(3);
  });
});

describe('feedStatusFor', () => {
  it('forgives a single empty run — one network blip is not an outage', () => {
    expect(feedStatusFor(0)).toBe('ok');
    expect(feedStatusFor(1)).toBe('ok');
  });
  it('warns on the second consecutive empty run', () => {
    expect(feedStatusFor(2)).toBe('warn');
    expect(feedStatusFor(3)).toBe('warn');
  });
  it('goes critical on the fourth', () => {
    expect(feedStatusFor(4)).toBe('critical');
    expect(feedStatusFor(40)).toBe('critical');
  });
  it('would have caught BIN-856 within two days instead of a month', () => {
    // The job runs daily and the outage began ~2026-07-11. Two runs in is
    // 2026-07-13 — the day this should have reached her.
    expect(feedStatusFor(2)).not.toBe('ok');
  });
});

describe('worstStatus', () => {
  it('picks the more severe of the two, in either argument order', () => {
    expect(worstStatus('ok', 'warn')).toBe('warn');
    expect(worstStatus('warn', 'ok')).toBe('warn');
    expect(worstStatus('warn', 'critical')).toBe('critical');
    expect(worstStatus('critical', 'warn')).toBe('critical');
  });
  it('is ok only when both sides are ok', () => {
    expect(worstStatus('ok', 'ok')).toBe('ok');
  });
});
