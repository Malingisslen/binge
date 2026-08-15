import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, runTransaction, setDoc, Timestamp,
  type Firestore,
} from 'firebase/firestore';

import {
  runCommunityRatingAggregate,
  aggregateDocId,
  type AggregateIo,
  type AggregateOutcome,
  type AggregateTx,
  type RatingEvent,
} from '../../../functions/src/communityRatings/runAggregate';

/**
 * BIN-727 condition 4 — the communityRatings ORCHESTRATOR against a real Firestore
 * emulator, including a FORCED write/write race.
 *
 * The condition, verbatim from the 2026-08-06 rescope: "dedup-kontrollen får aldrig
 * hamna utanför transaktionen som räknar upp. Ett test ska tvinga fram en samtidig
 * omkörning och visa att inget dubbelräknas."
 *
 * Why a real emulator and not a fake: this function's guarantee IS Firestore's
 * optimistic concurrency. A fake database can be made to agree with any theory of
 * how transactions behave, which is precisely the false comfort that bit this
 * project on 2026-08-03 and is why the rescope demanded the emulator by name.
 *
 * How it runs without firebase-admin: the decision lives in
 * functions/src/communityRatings/runAggregate.ts behind an injected `AggregateIo`
 * port whose `runTransaction` is a thin pass-through to the SDK's own transaction.
 * Prod passes the Admin one, this file passes the client-SDK one against the
 * emulator. Third use of the pattern after retentionCleanup and availableNotify.
 *
 * THE HOLE THIS SUITE EXISTS TO CLOSE, stated plainly (#27, 2026-08-15): a port
 * could satisfy `runTransaction<T>(fn): Promise<T>` with a buffered,
 * non-transactional shim — read now, collect the writes, commit at the end. It
 * would type-check and pass every sequential test below while dropping the entire
 * guarantee. Only the contention tests catch that, and only because they assert
 * the callback ran MORE THAN ONCE — a number that is impossible without a genuine
 * OCC retry.
 *
 * The emulator is opened with permissive rules on purpose: in production this
 * trigger runs as the Admin SDK, which bypasses security rules entirely. That
 * `titleRatingsAggregate` is `read: true, write: false` for clients is pinned by
 * firestore-rules.test.ts, and that rule is what makes the path-derived doc id the
 * whole anti-stuffing story.
 *
 * NOT PROVEN HERE, and it cannot be:
 *  · That `event.params.tmdbId` really is the watchlist doc's own id rather than
 *    something a user can set. That binding lives in the trigger pattern
 *    `users/{uid}/watchlist/{tmdbId}` in index.ts, which no emulator test can
 *    exercise — the tests below prove what the orchestrator does with the value it
 *    is handed, and index.ts carries the warning at the hand-off.
 *  · That production WRITES WITH `merge: true`. The orchestrator hands the port
 *    three fields and the port decides how to commit them, so "doesn't clobber
 *    fields it doesn't own" is a property of each port implementation separately.
 *    The test below pins THIS harness's merge; index.ts's own `{ merge: true }` is
 *    covered by nothing here, which is why it carries a comment saying why it is
 *    there.
 *  · That the barrier is required. Removing it leaves all 17 tests green — two
 *    `Promise.all`'d transactions on the same document contend on their own often
 *    enough (confirmed over five repeated runs). It is kept because "often enough"
 *    is a flake waiting to happen; the barrier makes the race deterministic rather
 *    than incidental. What IS proven load-bearing is the `callbackStarts`
 *    assertion: a buffered non-transactional port shim (the exact hole #27 named)
 *    turns the two concurrency tests red.
 *  · That PRODUCTION's `runTransaction` is a real pass-through. This is the
 *    sharpest gap of the four and it is named last only because it is structural:
 *    the whole suite exists to catch a buffered shim, and the one implementation
 *    that could BE a buffered shim in production — `adminIo.runTransaction` in
 *    index.ts — imports firebase-admin and therefore cannot run under this
 *    harness. It is a real Admin `db.runTransaction` by inspection, and that is
 *    all this file can say. index.ts carries the requirement in its own header.
 *    The two sibling ports shipped this week leave the identical residual.
 */

const PROJECT_ID = 'binge-ratings-orchestrator-test';
const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: OPEN_RULES, host, port: Number(port) },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

function adminLikeDb(): Firestore {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

const COLLECTION = 'titleRatingsAggregate';
const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0));

// ─────────────────────────────────────────────────────────────────────────────
// The client-SDK port
// ─────────────────────────────────────────────────────────────────────────────

interface Spy {
  /** How many times the transaction CALLBACK body started. >1 per delivery = a retry. */
  callbackStarts: number;
  /** How many times `runTransaction` was entered at all. */
  transactions: number;
  /** Aggregate doc ids written, in order. */
  writes: string[];
}

function makeSpy(): Spy {
  return { callbackStarts: 0, transactions: 0, writes: [] };
}

/**
 * The port, implemented with the client SDK's REAL transaction.
 *
 * `hooks.afterRead` is the whole contention mechanism: it runs inside the
 * transaction callback, immediately after the read and before the write, so two
 * concurrent deliveries can be held there until both have read. That produces the
 * read-read-write-write interleaving Firestore's OCC is designed to catch —
 * rather than firing two promises and hoping they overlap.
 */
function makeIo(
  db: Firestore,
  spy: Spy,
  hooks: { afterRead?: (docId: string) => Promise<void> } = {},
): AggregateIo {
  return {
    log: { info: () => {}, warn: () => {}, error: () => {} },
    runTransaction: (fn) => {
      spy.transactions += 1;
      return runTransaction(db, async (tx) => {
        spy.callbackStarts += 1;
        const handle: AggregateTx = {
          get: async (docId) => {
            const snap = await tx.get(doc(db, COLLECTION, docId));
            return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
          },
          set: (docId, data) => {
            spy.writes.push(docId);
            tx.set(doc(db, COLLECTION, docId), { ...data, updatedAt: Timestamp.fromDate(NOW) }, { merge: true });
          },
        };
        const result = await fn({
          get: async (docId) => {
            const out = await handle.get(docId);
            if (hooks.afterRead) await hooks.afterRead(docId);
            return out;
          },
          set: handle.set,
        });
        return result;
      });
    },
  };
}

/** One trigger delivery. `rating` before/after is all the decision reads. */
function event(
  eventId: string,
  watchlistDocId: string,
  before: number | null,
  after: number | null,
  extra: {
    bodyMediaType?: string;
    bodyTmdbId?: number;
    /** Override the BEFORE side's mediaType, so the two sides can disagree. */
    beforeMediaType?: string;
    /** Model a real delete: `event.data.after.data()` is undefined. */
    deleted?: boolean;
  } = {},
): RatingEvent {
  const body = (rating: number | null, mediaType: string | undefined): Record<string, unknown> => ({
    rating,
    ...(mediaType !== undefined ? { mediaType } : {}),
    ...(extra.bodyTmdbId !== undefined ? { tmdbId: extra.bodyTmdbId } : {}),
  });
  return {
    eventId,
    watchlistDocId,
    before: body(before, extra.beforeMediaType ?? extra.bodyMediaType),
    after: extra.deleted ? undefined : body(after, extra.bodyMediaType),
  };
}

async function aggregate(db: Firestore, docId: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, COLLECTION, docId));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

/** A two-party barrier: both callers block until both have arrived. */
function makeBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    // A caller that arrives AFTER the barrier opened (an OCC retry re-entering the
    // callback) must not block forever — the promise is already resolved.
    await open;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The no-op guard — the common case, and it must not cost a transaction
// ─────────────────────────────────────────────────────────────────────────────

describe('no-op-vakten', () => {
  it('en watchlist-skrivning som inte rör betyget öppnar INGEN transaktion', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    // This trigger fires on EVERY watchlist write — status changes, notes, the
    // instant-week read-repair. A transaction per write would be a read bill for
    // nothing. Asserted on the call count, not on a missing document: an absent
    // aggregate is equally consistent with the function having crashed.
    const out = await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', 4, 4));

    expect(out).toEqual({ kind: 'noop' });
    expect(spy.transactions).toBe(0);
  });

  it('ett betyg som försvinner är INTE en no-op', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    await setDoc(doc(db, COLLECTION, 'movie_603'), { count: 3, sum: 12 });

    const out = await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', 4, null));

    expect(out).toMatchObject({ kind: 'applied', count: 2, sum: 8 });
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 2, sum: 8 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The arithmetic, through a real transaction
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregatet', () => {
  it('ett nytt betyg skapar dokumentet med räknare 1', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    const out = await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', null, 4.5));

    expect(out).toMatchObject({ kind: 'applied', docId: 'movie_603', count: 1, sum: 4.5 });
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 4.5, lastEventId: 'e1' });
    // `updatedAt` is the port's duty, not the orchestrator's — this keeps the
    // contract alive in the harness at least. Nothing reads the field today.
    expect(await aggregate(db, 'movie_603')).toHaveProperty('updatedAt');
  });

  it('ett ändrat betyg flyttar summan men inte antalet', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    await setDoc(doc(db, COLLECTION, 'movie_603'), { count: 2, sum: 7 });

    await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', 3, 5));

    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 2, sum: 9 });
  });

  it('skräp i räknarna nollställs i stället för att förgifta summan', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    // A hand-edited or half-migrated doc. Plain arithmetic on a string would
    // produce NaN and freeze the aggregate forever — every later read of NaN
    // yields NaN, and no future rating could ever repair it.
    await setDoc(doc(db, COLLECTION, 'movie_603'), { count: 'nej', sum: null });

    await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', null, 4));

    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 4 });
  });

  // Honest scope: the merge lives in the PORT, so this pins the harness, not
  // production. Kept because it documents the contract the orchestrator is written
  // against — it hands over three fields and expects the other fields to survive.
  it('rör inte fält som den inte äger (porten mergar — se filhuvudet)', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    await setDoc(doc(db, COLLECTION, 'movie_603'), { count: 1, sum: 4, curatedNote: 'behåll mig' });

    await runCommunityRatingAggregate(makeIo(db, spy), event('e1', 'movie_603', null, 5));

    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 2, sum: 9, curatedNote: 'behåll mig' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The doc-id derivation — the vote-stuffing invariant
// ─────────────────────────────────────────────────────────────────────────────

describe('doc-id härleds ur sökvägen, aldrig ur kroppen', () => {
  it('en förfalskad tmdbId i kroppen flyttar inte en annan titels aggregat', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    await setDoc(doc(db, COLLECTION, 'movie_550'), { count: 100, sum: 450 });

    // The attack the invariant exists to stop: the user owns their watchlist doc
    // and rules whitelist `tmdbId` in the body without value-binding it. If the
    // aggregate key came from the body, they could create N docs under different
    // ids, each claiming to be movie 550, and each would increment it.
    await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', 'movie_603', null, 5, { bodyTmdbId: 550, bodyMediaType: 'movie' }),
    );

    expect(await aggregate(db, 'movie_550')).toMatchObject({ count: 100, sum: 450 });
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 5 });
    expect(spy.writes).toEqual(['movie_603']);
  });

  it('en förfalskad mediaType i kroppen ignoreras när doc-id:t är namngivet', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    // `tv_1399` is unrelated to `movie_1399`. The path prefix wins.
    await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', 'tv_1399', null, 4, { bodyMediaType: 'movie' }),
    );

    expect(await aggregate(db, 'tv_1399')).toMatchObject({ count: 1, sum: 4 });
    expect(await aggregate(db, 'movie_1399')).toBeNull();
  });

  it('legacy: ett bart numeriskt id tar prefixet ur kroppen men id:t ur sökvägen', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    // Defence-in-depth, not dead code — the Fork-A reset means no bare ids exist
    // in prod today, but a restore or a migration could reintroduce them. A wrong
    // body mediaType mis-buckets this one doc's single vote; it cannot stuff a
    // real aggregate, because the id part is still the unique path segment.
    await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', '603', null, 3.5, { bodyMediaType: 'movie' }),
    );

    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 3.5 });
  });

  it('legacy: när de två sidorna är oense vinner EFTER, inte FÖRE', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    // The precedence is `after?.mediaType ?? before?.mediaType`, and until now no
    // test in this file could tell the two apart — every fixture set both sides to
    // the same value, so flipping the fallback order stayed green. In practice a
    // watchlist doc's mediaType is effectively immutable, which is exactly why a
    // silent flip here would never be noticed until the day it wasn't.
    await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', '603', null, 4, { bodyMediaType: 'movie', beforeMediaType: 'tv' }),
    );

    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 4 });
    expect(await aggregate(db, 'tv_603')).toBeNull();
  });

  it('legacy: ett raderat dokument har ingen efter-sida, så FÖRE bär mediatypen', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    await setDoc(doc(db, COLLECTION, 'tv_603'), { count: 2, sum: 9 });

    // A real delete: onDocumentWritten gives `after.data() === undefined`. This is
    // the only case where the before-side is load-bearing — and it is also the
    // case where getting it wrong silently strands a vote in the wrong bucket
    // while the right bucket keeps counting a rating nobody holds any more.
    const out = await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', '603', 4, null, { beforeMediaType: 'tv', deleted: true }),
    );

    expect(out).toMatchObject({ kind: 'applied', docId: 'tv_603', count: 1, sum: 5 });
  });

  it('legacy utan användbar mediaType skrivs ingenstans alls', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();

    const out = await runCommunityRatingAggregate(
      makeIo(db, spy),
      event('e1', '603', null, 3.5, { bodyMediaType: 'film' }),
    );

    expect(out).toEqual({ kind: 'skipped-unknown-media-type' });
    // Bailing BEFORE the transaction matters: guessing a prefix here would file a
    // real vote under a title nobody rated.
    expect(spy.transactions).toBe(0);
  });

  it('härledningen är ren och kan prövas direkt', () => {
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    expect(aggregateDocId(event('e', 'movie_603', null, 4), log)).toBe('movie_603');
    expect(aggregateDocId(event('e', 'tv_1399', null, 4), log)).toBe('tv_1399');
    expect(aggregateDocId(event('e', '603', null, 4, { bodyMediaType: 'tv' }), log)).toBe('tv_603');
    expect(aggregateDocId(event('e', '603', null, 4), log)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Idempotency — sequential first, then the forced race
// ─────────────────────────────────────────────────────────────────────────────

describe('samma händelse två gånger', () => {
  it('sekventiell omleverans hoppas över utan att skriva', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    const e = event('event-A', 'movie_603', null, 4);

    const first = await runCommunityRatingAggregate(makeIo(db, spy), e);
    const second = await runCommunityRatingAggregate(makeIo(db, spy), e);

    expect(first).toMatchObject({ kind: 'applied', count: 1, sum: 4 });
    expect(second).toEqual({ kind: 'duplicate', docId: 'movie_603' });
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 4 });
    // The skip is a real skip: only the first delivery wrote.
    expect(spy.writes).toEqual(['movie_603']);
  });

  it('SAMTIDIG omleverans räknas en gång — och transaktionen gjorde faktiskt om sig', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    const e = event('event-A', 'movie_603', null, 4);
    // Both deliveries read the (absent) aggregate before either writes. That is
    // the read-read-write-write interleaving Firestore's optimistic concurrency
    // exists to catch — forced, not hoped for.
    const barrier = makeBarrier(2);
    const io = makeIo(db, spy, { afterRead: () => barrier() });

    const outcomes = await Promise.all([
      runCommunityRatingAggregate(io, e),
      runCommunityRatingAggregate(io, e),
    ]);

    // The number that matters: ONE application of the delta, from two deliveries.
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 1, sum: 4, lastEventId: 'event-A' });
    const kinds = outcomes.map((o: AggregateOutcome) => o.kind).sort();
    expect(kinds).toEqual(['applied', 'duplicate']);

    // And the mechanism, not just the arithmetic. Two deliveries entered
    // runTransaction twice; if the callback body only ever started twice, nothing
    // was ever retried — which is what a buffered non-transactional shim, or a
    // lucky non-overlap, would produce. A genuine OCC conflict re-runs the loser's
    // callback, and only on that second pass does it see lastEventId.
    expect(spy.transactions).toBe(2);
    expect(spy.callbackStarts).toBeGreaterThan(2);
  });

  it('TVÅ OLIKA händelser på samma titel landar BÅDA, även samtidigt', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    // The contrast case, and it is what makes the test above falsifiable. An
    // implementation that simply dropped one writer under any contention would
    // pass "samtidig omleverans räknas en gång" for entirely the wrong reason —
    // that is not dedup, it is data loss wearing the same green tick.
    const barrier = makeBarrier(2);
    const io = makeIo(db, spy, { afterRead: () => barrier() });

    const outcomes = await Promise.all([
      runCommunityRatingAggregate(io, event('event-A', 'movie_603', null, 4)),
      runCommunityRatingAggregate(io, event('event-B', 'movie_603', null, 5)),
    ]);

    expect(outcomes.every((o: AggregateOutcome) => o.kind === 'applied')).toBe(true);
    // Two ratings in, two ratings counted, nine points of sum. Neither was lost.
    expect(await aggregate(db, 'movie_603')).toMatchObject({ count: 2, sum: 9 });
    expect(spy.callbackStarts).toBeGreaterThan(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Failure handling
// ─────────────────────────────────────────────────────────────────────────────

describe('när transaktionen misslyckas', () => {
  it('felet sväljs och rapporteras — körningen kraschar inte', async () => {
    const db = adminLikeDb();
    const spy = makeSpy();
    const io: AggregateIo = {
      ...makeIo(db, spy),
      runTransaction: () => { throw new Error('DEADLINE_EXCEEDED'); },
    };

    const out = await runCommunityRatingAggregate(io, event('e1', 'movie_603', null, 4));

    // Deliberate, and its cost is real: this rating is now permanently missing
    // from the aggregate. It does NOT self-heal — a later 4→5 edit carries
    // countDelta 0, so the count stays one short forever. Rethrowing would not
    // help today either: `retry` is opt-in in firebase-functions v2 and this
    // trigger does not set it, so a throw changes the log line and nothing else.
    // Turning redelivery on is a cost decision on a trigger that fires on every
    // watchlist write, and it is filed separately rather than decided here.
    expect(out).toEqual({ kind: 'failed', docId: 'movie_603' });
    expect(await aggregate(db, 'movie_603')).toBeNull();
  });
});
