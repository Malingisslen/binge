import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collectionGroup, deleteField, doc, documentId, getDoc, getDocs, limit,
  orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, writeBatch,
  type Firestore,
} from 'firebase/firestore';

import {
  runTmdbFieldsSweep, type SweepIo, type SweepScanDoc, type SweepClearTarget,
} from '../../../functions/src/tmdbTosSweep/runSweep';
import { SOFT_DEADLINE_MS, TMDB_FIELDS_MAX_AGE_MS } from '../../../functions/src/tmdbTosSweep/logic';

/**
 * BIN-566 — the tmdbFieldsSweep ORCHESTRATOR against a real Firestore emulator.
 *
 * This closes the gap the accepted-deviations file names as the gate on ever
 * flipping `mutateEnabled`: BIN-507's criteria #1 (a thrown get/commit still
 * writes the `lastRun` audit, then re-throws) and #2 (a second invocation resumes
 * its cursor) were proven only at the pure-helper layer — no test drove the loop.
 *
 * How it runs without firebase-admin: the loop lives in functions/src/tmdbTosSweep/
 * runSweep.ts behind an injected `SweepIo` port (see that file's header). Prod
 * implements the port with the Admin SDK; here we implement the SAME port with the
 * client SDK against the emulator, because CI's rules job installs root deps only
 * and firebase-admin is not resolvable there. The loop under test is the real one —
 * only the Firestore primitives underneath it are swapped.
 *
 * The emulator is opened with permissive rules on purpose: in production this
 * sweep runs as the Admin SDK, which bypasses security rules entirely. Pinning
 * rule behaviour is firestore-rules.test.ts's job, not this file's.
 */

const PROJECT_ID = 'binge-sweep-orchestrator-test';
const STATE_PATH = ['sweepState', 'tmdbFieldsSweep'] as const;
/**
 * Prod batches at 450; here 2 keeps the fixtures small while still forcing a page
 * to span SEVERAL commits, which is the only way the per-chunk `docsCleared`
 * accounting can be exercised at all.
 */
const TEST_BATCH_SIZE = 2;
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

/** A fixed "now" plus stamps either side of the 5-month staleness threshold. */
const NOW = Date.UTC(2026, 6, 24);
const freshStamp = () => Timestamp.fromMillis(NOW - 1000);
const staleStamp = () => Timestamp.fromMillis(NOW - TMDB_FIELDS_MAX_AGE_MS - 1000);

/**
 * The client-SDK implementation of the production port. Every method mirrors what
 * index.ts does with the Admin SDK; the one unavoidable difference is `.select()`,
 * which the client SDK has no equivalent for — so `data` here is the FULL doc
 * rather than the narrowed projection. That is a superset of the fields the loop
 * reads (it only ever touches the allowlisted stamps/fields), so the verdicts are
 * identical; it just means this harness cannot catch a wrong `.select()` list.
 */
function makeIo(db: Firestore, overrides: Partial<SweepIo> = {}): SweepIo {
  const stateRef = doc(db, ...STATE_PATH);
  return {
    pageSize: 5,
    deleteSentinel: deleteField(),
    serverTimestamp: serverTimestamp(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    now: () => NOW,

    readState: async () => {
      const snap = await getDoc(stateRef);
      return snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
    },
    mergeState: async (patch) => { await setDoc(stateRef, patch, { merge: true }); },

    scanPage: async (cursor, pageSize): Promise<SweepScanDoc[]> => {
      let q = query(collectionGroup(db, 'watchlist'), orderBy(documentId()), limit(pageSize));
      if (cursor) q = query(q, startAfter(cursor));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ path: d.ref.path, data: d.data() as Record<string, unknown> }));
    },

    // Mirrors index.ts's Admin-SDK port: chunk, commit, then report the chunk as
    // committed. TEST_BATCH_SIZE is deliberately tiny so a page spans several
    // commits and the per-chunk accounting is actually exercised.
    commitClears: async (
      targets: readonly SweepClearTarget[],
      onCommitted: (count: number) => void,
    ) => {
      for (let i = 0; i < targets.length; i += TEST_BATCH_SIZE) {
        const chunk = targets.slice(i, i + TEST_BATCH_SIZE);
        const batch = writeBatch(db);
        for (const { path, payload } of chunk) batch.update(doc(db, path), payload);
        await batch.commit();
        onCommitted(chunk.length);
      }
    },

    ...overrides,
  };
}

/** A watchlist doc with the user-authored fields the sweep must never touch. */
function watchlistDoc(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    tmdbId: 1, mediaType: 'movie', status: 'sedd', rating: 4,
    title: 'En titel', posterPath: '/p.jpg', genreIds: [28],
    providers: [8], nextAirDate: '2026-09-01',
    ...extra,
  };
}

async function seedUserTitles(db: Firestore, uid: string, ids: readonly string[], extra: Record<string, unknown>) {
  for (const id of ids) {
    await setDoc(doc(db, 'users', uid, 'watchlist', id), watchlistDoc(extra));
  }
}

async function readState(db: Firestore): Promise<Record<string, unknown>> {
  const snap = await getDoc(doc(db, ...STATE_PATH));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : {};
}

async function readLastRun(db: Firestore): Promise<Record<string, unknown>> {
  const state = await readState(db);
  return (state.lastRun ?? {}) as Record<string, unknown>;
}

describe('tmdbFieldsSweep orchestrator — dry-run default (BIN-566)', () => {
  it('counts stale docs and writes the audit without touching any watchlist doc', async () => {
    const db = adminLikeDb();
    await seedUserTitles(db, 'u1', ['movie_1', 'movie_2'], { tmdbFieldsRefreshedAt: staleStamp() });

    const lastRun = await runTmdbFieldsSweep(makeIo(db));

    expect(lastRun.dryRun).toBe(true);
    expect(lastRun.docsScanned).toBe(2);
    expect(lastRun.docsWouldClear).toBe(2);
    expect(lastRun.docsCleared).toBe(0); // dry-run wrote nothing
    expect(lastRun.fullPassCompleted).toBe(true);
    // Explicitly FALSE, not absent: the audit is merge-written, so a clean run has
    // to overwrite a previous run's error flag rather than leave it standing.
    expect(lastRun.error).toBe(false);
    expect(lastRun.errorMessage).toBeNull();

    // The titles are untouched — this is the whole point of the default gate.
    const survivor = await getDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_1'));
    expect(survivor.data()?.title).toBe('En titel');
    expect(survivor.data()?.providers).toEqual([8]);

    // …and the audit landed on the state doc, not just in the return value.
    expect((await readLastRun(db)).docsWouldClear).toBe(2);
  });
});

describe('tmdbFieldsSweep orchestrator — error path writes the audit then re-throws (BIN-507 #1)', () => {
  it('a thrown clear-commit still records lastRun with error + the partial counts', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    await seedUserTitles(db, 'u1', ['movie_1', 'movie_2'], { tmdbFieldsRefreshedAt: staleStamp() });

    const boom = new Error('commit exploded');
    const io = makeIo(db, { commitClears: async () => { throw boom; } });

    await expect(runTmdbFieldsSweep(io)).rejects.toBe(boom);

    const lastRun = await readLastRun(db);
    expect(lastRun.error).toBe(true);
    expect(lastRun.errorMessage).toBe('commit exploded');
    expect(lastRun.dryRun).toBe(false);
    // Counts accumulated BEFORE the throw survive into the record: both docs were
    // scanned, none counted as cleared (the tally is bumped after the commit).
    expect(lastRun.docsScanned).toBe(2);
    expect(lastRun.docsCleared).toBe(0);
    expect(lastRun.fullPassCompleted).toBe(false);

    // The throw aborted before any clear landed — the titles are intact.
    const survivor = await getDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_1'));
    expect(survivor.data()?.title).toBe('En titel');
  });

  it('counts the chunks that ALREADY committed when a later chunk throws', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    // 5 stale docs on one page → 3 commits at TEST_BATCH_SIZE=2 (2 + 2 + 1).
    await seedUserTitles(
      db,
      'u1',
      ['movie_1', 'movie_2', 'movie_3', 'movie_4', 'movie_5'],
      { tmdbFieldsRefreshedAt: staleStamp() },
    );

    const boom = new Error('third batch exploded');
    const io = makeIo(db, {
      // Commit the first two chunks for real, then blow up on the third — the
      // shape of a mid-page Firestore failure. The first four clears are now
      // PERMANENT, so an audit reporting docsCleared: 0 would understate the
      // blast radius on a function that writes to every user's watchlist.
      commitClears: async (targets, onCommitted) => {
        let committed = 0;
        for (let i = 0; i < targets.length; i += TEST_BATCH_SIZE) {
          const chunk = targets.slice(i, i + TEST_BATCH_SIZE);
          if (committed >= 2 * TEST_BATCH_SIZE) throw boom;
          const batch = writeBatch(db);
          for (const { path, payload } of chunk) batch.update(doc(db, path), payload);
          await batch.commit();
          committed += chunk.length;
          onCommitted(chunk.length);
        }
      },
    });

    await expect(runTmdbFieldsSweep(io)).rejects.toBe(boom);

    const lastRun = await readLastRun(db);
    expect(lastRun.error).toBe(true);
    // The four clears that LANDED are counted; the fifth, which never committed,
    // is not. Before the per-chunk callback this read 0.
    expect(lastRun.docsCleared).toBe(4);
    // …but the VERDICT count stays 5 — all five were judged stale, and
    // docsWouldClearByGroup counted all five. The two numbers are allowed to
    // diverge exactly here, and conflating them made the audit self-contradictory.
    expect(lastRun.docsWouldClear).toBe(5);
    // Assert the breakdown rather than just claiming it: it must agree with the
    // VERDICT count, not with what committed. (Each seeded doc is stale in all
    // three groups — one stale stamp per group, all data present.)
    expect(lastRun.docsWouldClearByGroup).toEqual({ static: 5, providers: 5, nextair: 5 });

    // Firestore agrees with the audit: exactly the first four lost their fields.
    const cleared = await getDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_4'));
    expect(cleared.data()?.title).toBeUndefined();
    const untouched = await getDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_5'));
    expect(untouched.data()?.title).toBe('En titel');
  });

  it('a later CLEAN run clears the previous failure flag from the persisted audit', async () => {
    // The deep-merge trap, proven against a real emulator instead of inferred from
    // the code's shape: `lastRun` is merge-written and Firestore deep-merges nested
    // maps, so omitting `error` on success does NOT clear a previous `error: true`.
    // Before the fix this record stayed stuck at true forever — on the exact audit
    // BIN-454's runbook reads before enabling whole-database clearing.
    const db = adminLikeDb();
    await seedUserTitles(db, 'u1', ['movie_1'], { tmdbFieldsRefreshedAt: staleStamp() });

    // Run 1 throws.
    const boom = new Error('scan exploded');
    await expect(runTmdbFieldsSweep(makeIo(db, { scanPage: async () => { throw boom; } })))
      .rejects.toBe(boom);
    const failed = await readLastRun(db);
    expect(failed.error).toBe(true);
    expect(failed.errorMessage).toBe('scan exploded');

    // Run 2 is clean — and must overwrite BOTH keys on the persisted doc.
    await runTmdbFieldsSweep(makeIo(db));
    const recovered = await readLastRun(db);
    expect(recovered.error).toBe(false);
    expect(recovered.errorMessage).toBeNull();
  });

  it('a thrown scan-get still records lastRun with error and re-throws', async () => {
    const db = adminLikeDb();
    await seedUserTitles(db, 'u1', ['movie_1'], { tmdbFieldsRefreshedAt: staleStamp() });

    const boom = new Error('scan exploded');
    const io = makeIo(db, { scanPage: async () => { throw boom; } });

    await expect(runTmdbFieldsSweep(io)).rejects.toBe(boom);

    const lastRun = await readLastRun(db);
    expect(lastRun.error).toBe(true);
    expect(lastRun.errorMessage).toBe('scan exploded');
    expect(lastRun.docsScanned).toBe(0);
    expect(lastRun.fullPassCompleted).toBe(false);
  });
});

describe('tmdbFieldsSweep orchestrator — cursor resume across invocations (BIN-507 #2)', () => {
  it('a second invocation resumes past the first run\'s cursor instead of rescanning', async () => {
    const db = adminLikeDb();
    await seedUserTitles(
      db, 'u1',
      ['movie_1', 'movie_2', 'movie_3', 'movie_4', 'movie_5'],
      { tmdbFieldsRefreshedAt: freshStamp(), providersCheckedAt: freshStamp(), nextAirUpdatedAt: freshStamp() },
    );

    // Run 1: page size 2, and a clock that jumps past the soft deadline as soon as
    // the first page is done — the realistic way a run stops mid-collection.
    let tick = 0;
    const run1 = await runTmdbFieldsSweep(makeIo(db, {
      pageSize: 2,
      now: () => (tick++ === 0 ? NOW : NOW + SOFT_DEADLINE_MS),
    }));

    expect(run1.docsScanned).toBe(2);
    expect(run1.budgetAbort).toBe(true);
    expect(run1.fullPassCompleted).toBe(false);
    // Dry-run persists its OWN cursor (BIN-507) and leaves the mutate cursor alone.
    const midState = await readState(db);
    expect(midState.dryRunCursor).toBe('users/u1/watchlist/movie_2');
    expect(midState.cursor).toBeUndefined();

    // Run 2: same collection, no deadline pressure. It must pick up at doc 3.
    const run2 = await runTmdbFieldsSweep(makeIo(db, { pageSize: 2 }));

    expect(run2.docsScanned).toBe(3); // 3 remaining, NOT all 5 again
    expect(run2.fullPassCompleted).toBe(true);
    // A completed pass clears the mode's cursor so the next run starts from doc 0.
    expect((await readState(db)).dryRunCursor).toBe(null);
  });

  it('mutate mode resumes its OWN `cursor` field, not the dry-run one', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    await seedUserTitles(
      db, 'u1',
      ['movie_1', 'movie_2', 'movie_3', 'movie_4'],
      { tmdbFieldsRefreshedAt: freshStamp(), providersCheckedAt: freshStamp(), nextAirUpdatedAt: freshStamp() },
    );

    let tick = 0;
    const run1 = await runTmdbFieldsSweep(makeIo(db, {
      pageSize: 2,
      now: () => (tick++ === 0 ? NOW : NOW + SOFT_DEADLINE_MS),
    }));
    expect(run1.dryRun).toBe(false);
    expect(run1.budgetAbort).toBe(true);

    const midState = await readState(db);
    expect(midState.cursor).toBe('users/u1/watchlist/movie_2');
    expect(midState.dryRunCursor).toBeUndefined(); // the other mode is untouched

    const run2 = await runTmdbFieldsSweep(makeIo(db, { pageSize: 2 }));
    expect(run2.docsScanned).toBe(2); // docs 3 + 4 only
    expect(run2.fullPassCompleted).toBe(true);
    expect((await readState(db)).cursor).toBe(null);
  });
});

describe('tmdbFieldsSweep orchestrator — mutating clear (the mutateEnabled gate)', () => {
  it('deletes only the stale group\'s fields + its own stamp, sparing fresh siblings and user data', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    // Static block stale; providers group FRESH; nextair has no stamp at all
    // (absent = stale, so it must be cleared too).
    await setDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_1'), watchlistDoc({
      tmdbFieldsRefreshedAt: staleStamp(),
      providersCheckedAt: freshStamp(),
    }));

    const lastRun = await runTmdbFieldsSweep(makeIo(db));

    expect(lastRun.dryRun).toBe(false);
    expect(lastRun.docsCleared).toBe(1);
    expect(lastRun.docsWouldClearByGroup).toEqual({ static: 1, providers: 0, nextair: 1 });

    const after = (await getDoc(doc(db, 'users', 'u1', 'watchlist', 'movie_1'))).data() ?? {};
    // Stale static group: fields AND its stamp gone, so its repair path refills it.
    expect(after.title).toBeUndefined();
    expect(after.posterPath).toBeUndefined();
    expect(after.genreIds).toBeUndefined();
    expect(after.tmdbFieldsRefreshedAt).toBeUndefined();
    // Stale-by-absence nextair group: cleared.
    expect(after.nextAirDate).toBeUndefined();
    // FRESH providers group: completely untouched, stamp included.
    expect(after.providers).toEqual([8]);
    expect(after.providersCheckedAt).toBeDefined();
    // User-authored fields: never in the allowlist, never written.
    expect(after.status).toBe('sedd');
    expect(after.rating).toBe(4);
    expect(after.tmdbId).toBe(1);
  });

  it('re-running after a clear is idempotent — the already-clear doc becomes a skip', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    await seedUserTitles(db, 'u1', ['movie_1'], { tmdbFieldsRefreshedAt: staleStamp() });

    await runTmdbFieldsSweep(makeIo(db));
    const second = await runTmdbFieldsSweep(makeIo(db));

    expect(second.docsScanned).toBe(1);
    expect(second.docsCleared).toBe(0);
    expect(second.docsSkipped).toBe(1);
  });

  it('never clears a groups/{id}/watchlist doc, but still counts it as a billed read (BIN-504)', async () => {
    const db = adminLikeDb();
    await setDoc(doc(db, ...STATE_PATH), { mutateEnabled: true });
    // Same shape, same staleness — the ONLY difference is the parent collection.
    await setDoc(doc(db, 'groups', 'g1', 'watchlist', 'movie_9'), watchlistDoc({
      tmdbFieldsRefreshedAt: staleStamp(),
    }));
    await seedUserTitles(db, 'u1', ['movie_1'], { tmdbFieldsRefreshedAt: staleStamp() });

    const lastRun = await runTmdbFieldsSweep(makeIo(db));

    // Both docs were read (the budget must see the group doc), only the user doc
    // was classified: 1 cleared, 0 skipped — the group doc is neither.
    expect(lastRun.docsScanned).toBe(2);
    expect(lastRun.docsCleared).toBe(1);
    expect(lastRun.docsSkipped).toBe(0);

    const groupDoc = (await getDoc(doc(db, 'groups', 'g1', 'watchlist', 'movie_9'))).data() ?? {};
    expect(groupDoc.title).toBe('En titel');
    expect(groupDoc.posterPath).toBe('/p.jpg');
    expect(groupDoc.tmdbFieldsRefreshedAt).toBeDefined();
  });
});
