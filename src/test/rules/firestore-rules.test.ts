import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAddWrite } from '@/lib/watchlistWrites';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, writeBatch, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'binge-rules-test';
const OWNER = 'owner_uid';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  // Honor FIRESTORE_EMULATOR_HOST (set automatically by `firebase emulators:exec`)
  // so the suite follows whatever port the emulator actually bound — robust when
  // 8080 is taken (another emulator/session) and in CI. Falls back to the default.
  const [emuHost, emuPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      host: emuHost, port: Number(emuPort),
    },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });
function ownerDb() { return testEnv.authenticatedContext(OWNER).firestore(); }
function anonDb() { return testEnv.unauthenticatedContext().firestore(); }
function otherDb() { return testEnv.authenticatedContext('other_uid').firestore(); }

// Valid doc-shapes reused across the auth-rejection block — identical to the
// shapes the field-whitelist tests above use, so a rejection can only come
// from the isOwner / uid-match guard, never from a schema-validation failure.
function validWatchlist() {
  return {
    tmdbId: 603, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
    title: 'The Matrix', posterPath: null, releaseYear: 1999, totalSeasons: null,
    lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false, rewatchCount: 0,
    providers: [8], providersCheckedAt: null, visibility: null, genreIds: [28, 878],
    tmdbStatus: null, effectiveVisibility: 'private', isPublic: false,
    addedAt: serverTimestamp(), updatedAt: serverTimestamp(), watchedAt: null,
  };
}
function validReview(uid: string) {
  return {
    uid, tmdbId: 603, mediaType: 'movie', text: 'Bra film.', spoiler: false,
    rating: 8, displayName: null, username: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}
function validEpisodeProgress() {
  return { tmdbId: 1399, seasons: { '1': { '1': { watched: true, watchedAt: serverTimestamp() } } } };
}
function validNotInterested() {
  return { tmdbId: 603, mediaType: 'movie', addedAt: serverTimestamp() };
}

// BIN-655 — both add entry points produce a payload firestore.rules accepts.
//
// This is condition 2 of #27 Database Administrator's critique, and it is the one
// nothing else can cover: `isValidWatchlistItem` uses a `hasOnly` allowlist, and a
// merge-write is evaluated against the WHOLE post-merge document. So a payload that
// grew one key the allowlist does not know fails the entire write with
// permission-denied — silently, in production, with no compile-time signal. That has
// already happened once, with `notes`.
//
// It runs the REAL builder against the REAL rules, rather than asserting on a
// hand-written doc shape: a hand-written shape can only ever prove that the shape
// somebody typed is legal, which is exactly the check that missed `notes`.
describe('BIN-655 — buildAddWrite payloads satisfy the hasOnly allowlist', () => {
  const OWNER_ITEM = 'movie_603';

  // The stamp fields the builder emits are Firestore sentinels in production. Here we
  // give it real values so the emulator can store them; the KEY SET is what the
  // allowlist judges, and that is identical either way.
  const clock = () => serverTimestamp();

  function payload(over: Record<string, unknown> = {}) {
    return {
      tmdbId: 603,
      mediaType: 'movie' as const,
      status: 'sedd' as const,
      title: 'The Matrix',
      posterPath: null,
      releaseYear: 1999,
      providers: [8],
      subscriptionProviders: [8],
      genreIds: [28, 878],
      rating: 5,
      ...over,
    };
  }

  function writeCtx(over: Record<string, unknown> = {}) {
    return {
      current: undefined,
      snapshotSettled: true,
      listenerFailed: false,
      visibilityFields: { effectiveVisibility: 'private' as const, isPublic: false },
      serverTimestamp: clock,
      ...over,
    };
  }

  // Every optional STAMP present — not the widest possible payload: totalSeasons,
  // lastWatchedSeason/Episode and tmdbStatus are absent from the fixture, and while
  // BIN-894's tags-in-Carryable gap is open that distinction matters. A
  // narrower one cannot fail a hasOnly allowlist that the widest one passes, so this
  // is the case worth spending an emulator round-trip on.
  for (const intent of ['bulk', 'viewing'] as const) {
    it(`CREATE: a ${intent} write of a brand-new title is accepted`, async () => {
      const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', OWNER_ITEM);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await assertSucceeds(setDoc(ref, buildAddWrite(payload() as any, intent, writeCtx() as any), { merge: true }));
    });
  }

  it('MERGE-UPDATE: a counted rewatch on top of a stored doc is accepted', async () => {
    // The path that writes the MOST fields onto an EXISTING doc — and the only one
    // that writes `rewatchCount` and overwrites `watchedAt`. A merge is judged against
    // the whole post-merge document, so this is where a stray key surfaces.
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', OWNER_ITEM);
    await assertSucceeds(setDoc(ref, validWatchlist()));
    const stored = {
      tmdbId: 603, mediaType: 'movie' as const, status: 'sedd' as const, rating: 5,
      rewatchCount: 2, watchedAt: new Date('2019-04-02'), visibility: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = buildAddWrite(payload() as any, 'viewing', writeCtx({ current: stored }) as any);
    // Guard the guard: if the rewatch did not actually happen, this test would be
    // asserting the SAME payload as the create case above and prove nothing.
    expect(body).toHaveProperty('rewatchCount');
    expect(body).toHaveProperty('watchedAt');
    await assertSucceeds(setDoc(ref, body, { merge: true }));
  });

  it('MERGE-UPDATE: a bulk re-mark on top of a stored doc is accepted', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', OWNER_ITEM);
    await assertSucceeds(setDoc(ref, validWatchlist()));
    const stored = {
      tmdbId: 603, mediaType: 'movie' as const, status: 'sedd' as const, rating: 5,
      rewatchCount: 2, watchedAt: new Date('2019-04-02'), visibility: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = buildAddWrite(payload() as any, 'bulk', writeCtx({ current: stored }) as any);
    expect(body).not.toHaveProperty('rewatchCount');
    await assertSucceeds(setDoc(ref, body, { merge: true }));
  });

  it('and the allowlist really is what accepts them — one extra key is refused', async () => {
    // The control. Without it, all four tests above would pass just as well against a
    // rule that accepted anything, and this whole block would be measuring nothing.
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', OWNER_ITEM);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = buildAddWrite(payload() as any, 'viewing', writeCtx() as any);
    await assertFails(setDoc(ref, { ...body, countsAsViewing: true }, { merge: true }));
  });
});

describe('users/{uid}/watchlist/{id} field whitelist', () => {
  it('allows a valid watchlist write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertSucceeds(setDoc(ref, {
      tmdbId: 603, mediaType: 'movie', status: 'vill_se', rating: null, notes: null,
      title: 'The Matrix', posterPath: null, releaseYear: 1999, totalSeasons: null,
      lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false, rewatchCount: 0,
      providers: [8], providersCheckedAt: null, visibility: null, genreIds: [28, 878],
      tmdbStatus: null, effectiveVisibility: 'private', isPublic: false,
      addedAt: serverTimestamp(), updatedAt: serverTimestamp(), watchedAt: null,
    }));
  });
  it('rejects a watchlist write with an unknown field', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, {
      tmdbId: 603, mediaType: 'movie', status: 'vill_se', title: 'The Matrix',
      evilField: 'pwned', addedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  // BIN-93 regression: setRuntime() merge-writes { runtime } onto an existing
  // library item. Before 'runtime' was whitelisted, hasOnly() rejected this on
  // every in-library title view → permission-denied Sentry noise + a runtime
  // filter that never received data.
  it('allows a runtime-only backfill merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { runtime: 136 }, { merge: true }));
  });
  // BIN-349: ratedAt must be whitelisted AND type-bound to a timestamp.
  it('allows a ratedAt timestamp merge write (BIN-349)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { ratedAt: serverTimestamp() }, { merge: true }));
  });
  it('rejects a non-timestamp ratedAt (type bound, BIN-349)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { ratedAt: 'igår' }, { merge: true }));
  });
  // BIN-402: the monthly TMDB-ToS sweep stamps `tmdbFieldsRefreshedAt` (Admin SDK,
  // bypasses rules) onto real watchlist docs; the client also writes it on
  // denormalization. Because a merge-write is evaluated against the FULL post-merge
  // doc, an unlisted key would make the VERY NEXT ordinary client write (rating a
  // movie, etc.) fail hasOnly → permission-denied on an unrelated action. Seed a
  // post-sweep doc, then assert a normal owner merge-write still succeeds.
  it('allows a normal merge write on a post-sweep doc holding tmdbFieldsRefreshedAt (BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, { ...validWatchlist(), tmdbFieldsRefreshedAt: serverTimestamp() });
    await assertSucceeds(setDoc(ref, { rating: 4.5, updatedAt: serverTimestamp() }, { merge: true }));
  });
  it('allows a tmdbFieldsRefreshedAt timestamp merge write (BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { tmdbFieldsRefreshedAt: serverTimestamp() }, { merge: true }));
  });
  it('rejects a non-timestamp tmdbFieldsRefreshedAt (type bound, BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { tmdbFieldsRefreshedAt: 'igår' }, { merge: true }));
  });
  // Security-panel hardening: `<= request.time` — a client can't forge a FUTURE
  // stamp to make the sweep treat the doc as perpetually fresh (skip clearing).
  it('rejects a future-dated tmdbFieldsRefreshedAt (<= request.time bind, BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    const tomorrow = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
    await assertFails(setDoc(ref, { tmdbFieldsRefreshedAt: tomorrow }, { merge: true }));
  });
});

// Instant week (2026-07): nextAirReadRepair merge-writes the denormalized
// next-air field group. Mirrors the BIN-93 runtime-backfill precedent: the
// fields must be whitelisted or every silent read-repair write is rejected.
describe('users/{uid}/watchlist/{id} next-air read-repair fields', () => {
  it('allows a next-air-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'tv_1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: '2026-07-09', nextAirCode: 'S2E03', nextAirProvider: 'HBO Max',
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows a digitalReleaseDate-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, {
      digitalReleaseDate: '2026-08-01', nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows clearing next-air fields with nulls', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'tv_1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: null, nextAirCode: null, nextAirProvider: null,
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects an oversize nextAirProvider', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'tv_1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, {
      nextAirProvider: 'x'.repeat(81), nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects a non-timestamp nextAirUpdatedAt', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'tv_1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, { nextAirUpdatedAt: 'igår' }, { merge: true }));
  });
  // BIN-468: nextAirUpdatedAt is now a per-group sweep FRESHNESS GATE (the sweep
  // trusts it to decide whether the next-air group is stale). Same forge risk as
  // tmdbFieldsRefreshedAt → same `<= request.time` ratchet.
  it('rejects a future-dated nextAirUpdatedAt (<= request.time bind, BIN-468)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'tv_1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    const tomorrow = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
    await assertFails(setDoc(ref, { nextAirUpdatedAt: tomorrow }, { merge: true }));
  });
});

// BIN-468: providersCheckedAt is now the providers-group sweep FRESHNESS GATE.
// It had NO validation before (only a hasOnly key) — a client could write any
// junk incl. a future timestamp to make the sweep skip the providers group
// forever. Add the same type-bind + `<= request.time` ratchet as the other stamps.
describe('users/{uid}/watchlist/{id} providersCheckedAt gate (BIN-468)', () => {
  it('allows a providersCheckedAt serverTimestamp merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, {
      providers: [8], providersCheckedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects a non-timestamp providersCheckedAt (type bound)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { providersCheckedAt: 'igår' }, { merge: true }));
  });
  it('rejects a future-dated providersCheckedAt (<= request.time bind)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    const tomorrow = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
    await assertFails(setDoc(ref, { providersCheckedAt: tomorrow }, { merge: true }));
  });
});

// BIN-814: `subscriptionProviders` is the flatrate/free/ads subset of `providers`.
// The hasOnly allowlist is the whole risk here, and it bites in a direction that has
// nothing to do with this field: a merge-write is evaluated against the ENTIRE
// post-merge doc, so once a doc carries the field, an allowlist that lacks it fails
// every LATER write too — a rating, a status change, anything. That is why the rules
// deploy has to precede the client, and why the second test below is the one that
// matters.
describe('users/{uid}/watchlist/{id} subscriptionProviders (BIN-814)', () => {
  it('allows writing both provider fields in one merge', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, {
      providers: [76, 8], subscriptionProviders: [8], providersCheckedAt: serverTimestamp(),
    }, { merge: true }));
  });

  it('an UNRELATED later write still succeeds on a doc that carries the field', async () => {
    // The regression the one-way ratchet guards: drop 'subscriptionProviders' from
    // hasOnly while a prod doc has it, and this rating write starts failing with
    // permission-denied for a reason the user's action has nothing to do with.
    //
    // The doc is seeded with rules DISABLED on purpose. Seeding it through the
    // client would make the seed itself the first thing an allowlist regression
    // rejects, and the test would fail one line early — passing for the right
    // reason by accident. This way the assertion below is the only thing that can
    // fail, which is what makes it a ratchet test rather than a write test.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlist', 'movie_603'), {
        ...validWatchlist(), subscriptionProviders: [8],
      });
    });
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertSucceeds(setDoc(ref, { rating: 4 }, { merge: true }));
  });

  it('rejects an unknown provider field (the allowlist is still closed)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { rentProviders: [2] }, { merge: true }));
  });
});

// BIN-766 — the watchlist doc id's FORM is bound on create.
//
// Not a tidiness rule. `communityRatingMaintain` derives the community-average key from
// this path, and since BIN-766 it CANONICALISES the numeric part (`movie_042` -> the real
// `movie_42`) instead of passing it through verbatim. Canonicalising is what stops one
// title's ratings splitting across documents nobody reads — and, in the same motion, it
// makes every alias spelling land on ONE publicly-read document. The aggregate is a
// running counter, so without this guard a single account could create movie_042,
// movie_0042, movie_00042 … and add a genuine +1 to the same title from each. #4 Security
// Architect and #27 DBA made the guard a binding condition independently; #6 DPO named
// the visible consequence (`MIN_SAMPLE = 5` — one account could conjure a badge).
//
// The 35 fixtures in this file that used to create bare-numeric watchlist ids ('603',
// '1399') were renamed to the namespaced shape in the same commit. That is not a
// concession to the guard. Two modules build a watchlist doc id for a WRITE —
// `WatchlistContext.tsx` and `nextAirReadRepair.ts:172` — and both go through
// `mediaTypeDocId()` with `tmdbId` typed `number`, so no create path in the app can
// emit a bare or padded id. `taste/backfill.ts:74` writes without building one at all
// (`updateDoc` on an id read off an existing snapshot), which is what the
// grandfathered-update case below is about. The fixtures were describing a
// pre-BIN-560 world.
describe('users/{uid}/watchlist/{id} doc-id format guard (BIN-766)', () => {
  const rawWatchlistRef = (db: ReturnType<typeof ownerDb>, id: string) =>
    doc(db, 'users', OWNER, 'watchlist', id);

  it('accepts the two shapes mediaTypeDocId() actually writes', async () => {
    await assertSucceeds(setDoc(rawWatchlistRef(ownerDb(), 'movie_42'), validWatchlist()));
    await assertSucceeds(setDoc(rawWatchlistRef(ownerDb(), 'tv_42'), {
      ...validWatchlist(), tmdbId: 42, mediaType: 'tv',
    }));
    // `movie_0` stays creatable, matching the swipes residual (BIN-797) rather than
    // quietly diverging from it. TMDB numbers titles from 1, so this names nothing —
    // and `aggregateDocId` skips it with a warning (runAggregate.test.ts pins that), so
    // the effect is a document nobody reads, not a rating that silently counts.
    await assertSucceeds(setDoc(rawWatchlistRef(ownerDb(), 'movie_0'), {
      ...validWatchlist(), tmdbId: 0,
    }));
  });

  // The same alias table the swipes guard uses (`doc-id format guard (BIN-624)` below).
  // Kept identical on purpose: two collections sharing one canonical-id helper should not
  // end up with two different spellings of "the alias set".
  it.each([
    ['movie_042', 'leading zero — the alias that re-keys onto the genuine movie_42'],
    ['042', 'bare padded alias — the legacy-shaped member of the same set'],
    ['tv_0000042', 'padded alias'],
    ['zmovie_42', 'unknown prefix'],
    ['season_42', 'wrong namespace entirely'],
    ['movie_', 'empty suffix — must not resolve as Number("") === 0'],
    ['movie_1_2', 'junk suffix'],
    ['movie_xyz', 'non-numeric suffix'],
    ['603', 'bare legacy id — creatable before this guard, not any more'],
    ['MOVIE_42', 'prefix case must match — the regex is lowercase-anchored'],
  ])('denies CREATE at %s (%s)', async (docId) => {
    await assertFails(setDoc(rawWatchlistRef(ownerDb(), docId), validWatchlist()));
  });

  // `update` is deliberately left unguarded, for the same two reasons spelled out at
  // `canonicalSwipeDocId`: create-vs-update is decided by whether the document EXISTS, so
  // an attacker cannot reach the update branch on a path with no document — and a
  // pre-existing legacy-shaped item must keep accepting ordinary edits rather than
  // freezing the moment this rule deploys.
  it('a grandfathered bare-numeric item can still be edited', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlist', '603'), validWatchlist());
    });
    await assertSucceeds(setDoc(rawWatchlistRef(ownerDb(), '603'), {
      status: 'sedd', updatedAt: serverTimestamp(),
    }, { merge: true }));
  });

  // The guard is additive: a canonical-looking path must not buy its way past the field
  // rules the blocks above pin. Without this, "the id is well-formed" could read as
  // "the write is fine".
  it('a canonical doc id does NOT excuse an invalid body', async () => {
    await assertFails(setDoc(rawWatchlistRef(ownerDb(), 'movie_42'), {
      ...validWatchlist(), notes: 'inline note',
    }));
  });
});

// BIN-185: recaps/{id} — public-read AI recap cache, written ONLY by the offline
// /recap Admin-SDK batch (bypasses rules). Clients read directly on the hot path;
// they can never write or overwrite (a forged recap would be permanent public content).
describe('recaps/{id} (BIN-185)', () => {
  const recapId = '1399_2_3';
  const recapDoc = {
    tmdbId: 1399, season: 2, episode: 3, text: 'Hittills har …', lang: 'sv',
    model: 'claude-sonnet-5',
    sources: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/x', license: 'CC BY-SA 4.0' }],
    license: 'CC BY-SA 4.0', schemaVersion: 1,
  };
  async function seedRecap() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'recaps', recapId), recapDoc);
    });
  }
  it('anyone (even unauthenticated) can read a recap', async () => {
    await seedRecap();
    await assertSucceeds(getDoc(doc(anonDb(), 'recaps', recapId)));
    await assertSucceeds(getDoc(doc(ownerDb(), 'recaps', recapId)));
  });
  it('no client can create a recap (owner or anon)', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'recaps', recapId), recapDoc));
    await assertFails(setDoc(doc(anonDb(), 'recaps', recapId), recapDoc));
  });
  it('no client can overwrite an existing recap (no poisoning a cached doc)', async () => {
    await seedRecap();
    await assertFails(setDoc(doc(ownerDb(), 'recaps', recapId), { ...recapDoc, text: 'poisoned' }));
  });
  it('no client can delete a recap (delete is a distinct write vector)', async () => {
    await seedRecap();
    await assertFails(deleteDoc(doc(ownerDb(), 'recaps', recapId)));
    await assertFails(deleteDoc(doc(anonDb(), 'recaps', recapId)));
  });
});

// BIN-164: per-title tags — owner-only, no public/friends read clause (free-text
// tags can name third parties, so they must NEVER leak like public watchlist items).
describe('users/{uid}/watchlistTags/{id} (BIN-164)', () => {
  it('allows the owner to write, read, and delete their own tags', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', '603');
    await assertSucceeds(setDoc(ref, { tags: ['mysrys', 'med mamma'] }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });
  it('rejects an unknown field (only `tags` allowed)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', '603');
    await assertFails(setDoc(ref, { tags: ['ok'], evil: 'pwned' }));
  });
  it('rejects a non-list tags value', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', '603');
    await assertFails(setDoc(ref, { tags: 'notalist' }));
  });
  it('rejects more than 15 tags (server-side cap)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', '603');
    const many = Array.from({ length: 16 }, (_, i) => `t${i}`);
    await assertFails(setDoc(ref, { tags: many }));
    await assertSucceeds(setDoc(ref, { tags: many.slice(0, 15) }));
  });
  // media-type doc-id migration: mediaType is an OPTIONAL-but-validated field.
  it('allows a tag doc carrying a valid mediaType (the post-cutover shape)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', 'movie_603');
    await assertSucceeds(setDoc(ref, { tags: ['mysrys'], mediaType: 'movie' }));
  });
  it('rejects a tag doc with a garbage mediaType value', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistTags', 'movie_603');
    await assertFails(setDoc(ref, { tags: ['mysrys'], mediaType: 'lol' }));
    // Non-string type too: `in ['movie','tv']` is type-safe, so a number can never
    // satisfy it — pin that so a future guard refactor (e.g. `==`) can't silently drift.
    await assertFails(setDoc(ref, { tags: ['mysrys'], mediaType: 42 }));
  });
  it('never lets another user read or write the tags (private-to-owner)', async () => {
    // Seed as owner via the privileged context (bypasses rules).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlistTags', '603'), { tags: ['hemlig'] });
    });
    const otherRef = doc(otherDb(), 'users', OWNER, 'watchlistTags', '603');
    await assertFails(getDoc(otherRef));
    await assertFails(setDoc(otherRef, { tags: ['hijack'] }));
    // Even on a public profile: tags have no public read clause, unlike watchlist.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER), { isPublic: true, defaultVisibility: 'public' });
    });
    await assertFails(getDoc(otherRef));
  });
});

// BIN-505: the PII-leak fix. users/{uid} is owner-locked; public/friends read a
// display-only projection publicProfiles/{uid} gated LIVE against the source; and
// free-text notes move to an owner-only watchlistNotes subcollection.
describe('BIN-505 users/{uid} read is owner-only', () => {
  async function seedProfile(fields: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER), {
        email: 'secret@example.com', hemkommun: 'Lund',
        providerCosts: { 8: 129 }, providerCampaigns: {}, ...fields,
      });
    });
  }
  it('owner can read their own profile doc', async () => {
    await seedProfile({ isPublic: false, defaultVisibility: 'private' });
    await assertSucceeds(getDoc(doc(ownerDb(), 'users', OWNER)));
  });
  it('DENIES an unauthenticated read even when the profile is public (the leak)', async () => {
    await seedProfile({ isPublic: true, defaultVisibility: 'public' });
    await assertFails(getDoc(doc(anonDb(), 'users', OWNER)));
  });
  it('DENIES another signed-in user, even a friend', async () => {
    await seedProfile({ isPublic: true, defaultVisibility: 'public' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'friends', 'other_uid'), { since: serverTimestamp() });
    });
    await assertFails(getDoc(doc(otherDb(), 'users', OWNER)));
  });
});

describe('BIN-505 publicProfiles/{uid} projection', () => {
  const card = { displayName: 'Malin', username: 'malin', photoURL: null, bio: 'hej', isPublic: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  async function seedSourceVisibility(fields: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER), fields);
    });
  }
  it('owner can write a valid card and read their own', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'publicProfiles', OWNER), card));
    await assertSucceeds(getDoc(doc(ownerDb(), 'publicProfiles', OWNER)));
  });
  it('rejects an unknown field, oversized bio/displayName, bad username', async () => {
    const ref = doc(ownerDb(), 'publicProfiles', OWNER);
    await assertFails(setDoc(ref, { ...card, providerCosts: { 8: 129 } })); // sensitive field can't ride
    await assertFails(setDoc(ref, { ...card, bio: 'x'.repeat(161) }));
    await assertFails(setDoc(ref, { ...card, displayName: 'x'.repeat(81) }));
    await assertFails(setDoc(ref, { ...card, username: 'Not Valid!' }));
    await assertFails(setDoc(ref, { ...card, isPublic: 'yes' })); // isPublic must be a bool
  });
  it('another user cannot write my projection', async () => {
    await assertFails(setDoc(doc(otherDb(), 'publicProfiles', OWNER), card));
  });
  it('public profile → readable by anon and another user; private → denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publicProfiles', OWNER), card);
    });
    await seedSourceVisibility({ isPublic: true, defaultVisibility: 'public' });
    await assertSucceeds(getDoc(doc(anonDb(), 'publicProfiles', OWNER)));
    await assertSucceeds(getDoc(doc(otherDb(), 'publicProfiles', OWNER)));

    // Flip the SOURCE to private → the live get()-gate denies immediately, with
    // NO write to the projection itself (no stale-public window).
    await seedSourceVisibility({ isPublic: false, defaultVisibility: 'private' });
    await assertFails(getDoc(doc(anonDb(), 'publicProfiles', OWNER)));
    await assertFails(getDoc(doc(otherDb(), 'publicProfiles', OWNER)));
  });
  it('friend can read a private profile projection; a non-friend cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'publicProfiles', OWNER), card);
      await setDoc(doc(ctx.firestore(), 'users', OWNER), { isPublic: false, defaultVisibility: 'private' });
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'friends', 'other_uid'), { since: serverTimestamp() });
    });
    await assertSucceeds(getDoc(doc(otherDb(), 'publicProfiles', OWNER))); // friend
    await assertFails(getDoc(doc(anonDb(), 'publicProfiles', OWNER)));     // stranger
  });
});

describe('BIN-505 users/{uid}/watchlistNotes/{id} owner-only', () => {
  it('owner can write/read/delete their own note', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistNotes', '603');
    await assertSucceeds(setDoc(ref, { note: 'privat anteckning om mamma' }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });
  it('rejects an unknown field and an over-long note', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistNotes', '603');
    await assertFails(setDoc(ref, { note: 'ok', evil: 'x' }));
    await assertFails(setDoc(ref, { note: 'x'.repeat(5001) }));
  });
  // media-type doc-id migration: mediaType is an OPTIONAL-but-validated field.
  it('allows a note doc carrying a valid mediaType (the post-cutover shape)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistNotes', 'movie_603');
    await assertSucceeds(setDoc(ref, { note: 'privat', mediaType: 'movie' }));
  });
  it('rejects a note doc with a garbage mediaType value', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlistNotes', 'movie_603');
    await assertFails(setDoc(ref, { note: 'privat', mediaType: 'lol' }));
  });
  it('never readable/writable by another user, even on a public profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlistNotes', '603'), { note: 'hemlig' });
      await setDoc(doc(ctx.firestore(), 'users', OWNER), { isPublic: true, defaultVisibility: 'public' });
    });
    const otherRef = doc(otherDb(), 'users', OWNER, 'watchlistNotes', '603');
    await assertFails(getDoc(otherRef));
    await assertFails(setDoc(otherRef, { note: 'hijack' }));
  });
});

describe('BIN-505 watchlist notes-null guard', () => {
  it('create with a non-null inline note is DENIED; null/absent is OK', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, { ...validWatchlist(), notes: 'inline leak' }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), notes: null }));
  });
  it('an unrelated edit on a legacy doc that still has a note PASSES (note unchanged)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlist', 'movie_603'), { ...validWatchlist(), notes: 'legacy' });
    });
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertSucceeds(setDoc(ref, { rating: 4.5, updatedAt: serverTimestamp() }, { merge: true }));
  });
  it('re-introducing a CHANGED note is DENIED; deleting the note is OK', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'watchlist', 'movie_603'), { ...validWatchlist(), notes: 'legacy' });
    });
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, { notes: 'a new note', updatedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(ref, { notes: deleteField(), updatedAt: serverTimestamp() }, { merge: true }));
  });
});

// BIN-143: the rating VALUE must be bounded 0–10, not just the key set. An owner
// can write their own watchlist doc directly, and the value feeds the public
// community aggregate — an out-of-range write would deface every title page.
describe('users/{uid}/watchlist/{id} rating value bound (BIN-143)', () => {
  // Watchlist ratings are the 0.5–5 half-star scale (×2 → /10 on display), NOT
  // 0–10 like reviews. The bound is 0–5; anything above 5 would render >10/10.
  it('allows in-range half-star ratings (0.5, 2.5, 5) and null', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 0.5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 2.5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: null }));
  });
  it('rejects ratings above the 0.5–5 scale (community-aggregate poisoning)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 500 }));
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 10 })); // old display-scale value now rejected
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 5.5 }));
  });
  it('rejects a negative rating', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: -5 }));
  });
  it('rejects a non-numeric rating', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: '5' as unknown as number }));
  });
  it('rejects an over-range rating slipped in via a merge update', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { rating: 999 }, { merge: true }));
  });
});

describe('reviews/{id} field whitelist', () => {
  it('allows a valid review write', async () => {
    const ref = doc(ownerDb(), 'reviews', 'r1');
    await assertSucceeds(setDoc(ref, {
      uid: OWNER, tmdbId: 603, mediaType: 'movie', text: 'Bra film.', spoiler: false,
      rating: 8, displayName: null, username: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  it('rejects a review write with an unknown field', async () => {
    const ref = doc(ownerDb(), 'reviews', 'r1');
    await assertFails(setDoc(ref, {
      uid: OWNER, tmdbId: 603, mediaType: 'movie', text: 'Bra film.', injected: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
});

describe('users/{uid}/episodeProgress/{id} field whitelist', () => {
  it('allows a valid episodeProgress write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', '1399');
    await assertSucceeds(setDoc(ref, {
      tmdbId: 1399, seasons: { '1': { '1': { watched: true, watchedAt: serverTimestamp() } } },
    }));
  });
  it('rejects an episodeProgress write with an unknown field', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', '1399');
    await assertFails(setDoc(ref, { tmdbId: 1399, seasons: {}, junk: 'x' }));
  });
  // media-type doc-id migration: mediaType is an OPTIONAL-but-validated field.
  it('allows an episodeProgress doc carrying a valid mediaType (post-cutover shape)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', 'tv_1399');
    await assertSucceeds(setDoc(ref, {
      tmdbId: 1399, mediaType: 'tv',
      seasons: { '1': { '1': { watched: true, watchedAt: serverTimestamp() } } },
    }));
  });
  it('rejects an episodeProgress doc with a garbage mediaType value', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'episodeProgress', 'tv_1399');
    await assertFails(setDoc(ref, {
      tmdbId: 1399, mediaType: 'lol',
      seasons: { '1': { '1': { watched: true, watchedAt: serverTimestamp() } } },
    }));
  });
});

describe('users/{uid}/notInterested/{id} field whitelist', () => {
  it('allows a valid notInterested write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'notInterested', '603');
    await assertSucceeds(setDoc(ref, { tmdbId: 603, mediaType: 'movie', addedAt: serverTimestamp() }));
  });
  it('rejects a notInterested write with an unknown field', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'notInterested', '603');
    await assertFails(setDoc(ref, { tmdbId: 603, mediaType: 'movie', addedAt: serverTimestamp(), spam: 1 }));
  });
  // media-type doc-id migration sibling: mediaType was allowed but never value-checked.
  it('rejects a notInterested write with a garbage mediaType value', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'notInterested', 'movie_603');
    await assertFails(setDoc(ref, { tmdbId: 603, mediaType: 'lol', addedAt: serverTimestamp() }));
  });
});

// isOwner / uid-match guard — these assert that an accidental removal of the
// owner check (so anyone could write any user's data) is caught. Each doc-shape
// is a *valid* doc, so the only thing that can fail the write is the auth guard.
describe('owner guard — unauthenticated writes are rejected', () => {
  it('rejects an unauthenticated watchlist write', async () => {
    const ref = doc(anonDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, validWatchlist()));
  });
  it('rejects an unauthenticated review write', async () => {
    const ref = doc(anonDb(), 'reviews', 'r1');
    await assertFails(setDoc(ref, validReview(OWNER)));
  });
  it('rejects an unauthenticated episodeProgress write', async () => {
    const ref = doc(anonDb(), 'users', OWNER, 'episodeProgress', '1399');
    await assertFails(setDoc(ref, validEpisodeProgress()));
  });
  it('rejects an unauthenticated notInterested write', async () => {
    const ref = doc(anonDb(), 'users', OWNER, 'notInterested', '603');
    await assertFails(setDoc(ref, validNotInterested()));
  });
});

describe('owner guard — non-owner writes are rejected', () => {
  it('rejects a non-owner writing to another user’s watchlist', async () => {
    const ref = doc(otherDb(), 'users', OWNER, 'watchlist', 'movie_603');
    await assertFails(setDoc(ref, validWatchlist()));
  });
  it('rejects a non-owner writing to another user’s episodeProgress', async () => {
    const ref = doc(otherDb(), 'users', OWNER, 'episodeProgress', '1399');
    await assertFails(setDoc(ref, validEpisodeProgress()));
  });
  it('rejects a non-owner writing to another user’s notInterested', async () => {
    const ref = doc(otherDb(), 'users', OWNER, 'notInterested', '603');
    await assertFails(setDoc(ref, validNotInterested()));
  });
  it('rejects a review whose uid is not the writer (forged authorship)', async () => {
    // Writer is 'other_uid' but the doc claims uid === OWNER. The create rule
    // requires request.resource.data.uid == request.auth.uid, so this must fail.
    const ref = doc(otherDb(), 'reviews', 'r1');
    await assertFails(setDoc(ref, validReview(OWNER)));
  });
});

// Positive control: the factory shapes used by the owner-guard tests above must
// themselves be schema-valid for the owner, so a guard-test rejection can only be
// the auth guard — not silent schema drift. If the field whitelist changes and a
// factory drifts, THIS block fails loudly rather than the guard tests passing for
// the wrong reason.
describe('owner guard — positive control (factory shapes are schema-valid)', () => {
  it('owner can write validWatchlist()', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', OWNER, 'watchlist', 'movie_603'), validWatchlist()));
  });
  it('owner can write validReview()', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'reviews', 'r1'), validReview(OWNER)));
  });
  it('owner can write validEpisodeProgress()', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', OWNER, 'episodeProgress', '1399'), validEpisodeProgress()));
  });
  it('owner can write validNotInterested()', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', OWNER, 'notInterested', '603'), validNotInterested()));
  });
});

// BIN-20 — forged friends doc must not let any user self-grant read access to
// another user's private profile + friends-tier watchlist. The friends-create
// rule now requires a real pending request between the two parties.
describe('users/{uid}/friends/{targetUid} — forged-friendship guard', () => {
  const VICTIM = 'victim_uid';
  const ATTACKER = 'attacker_uid';

  function attackerDb() { return testEnv.authenticatedContext(ATTACKER).firestore(); }
  function victimDb() { return testEnv.authenticatedContext(VICTIM).firestore(); }

  // Seed with rules disabled so the setup itself can't be blocked by the rule
  // under test.
  async function seedRequest(toUid: string, fromUid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', toUid, 'friendRequests', fromUid), {
        fromUid, fromDisplayName: 'Avsändare', sentAt: serverTimestamp(),
      });
    });
  }
  async function seedPrivateProfile(uid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), {
        displayName: 'Offer', isPublic: false, defaultVisibility: 'private',
      });
    });
  }

  it('attacker cannot forge friends/{attacker} on a victim who never requested them', async () => {
    // No pending request from VICTIM → ATTACKER exists.
    await assertFails(setDoc(
      doc(attackerDb(), 'users', VICTIM, 'friends', ATTACKER),
      { since: serverTimestamp() },
    ));
  });

  it('without a (forged) friend link, attacker cannot read victim private profile', async () => {
    await seedPrivateProfile(VICTIM);
    await assertFails(getDoc(doc(attackerDb(), 'users', VICTIM)));
  });

  it('attacker cannot forge friends/{victim} on their OWN subtree without a request', async () => {
    // Owner-branch deny: attacker owns uid but no request from VICTIM exists.
    await assertFails(setDoc(
      doc(attackerDb(), 'users', ATTACKER, 'friends', VICTIM),
      { since: serverTimestamp() },
    ));
  });

  it('requester cannot self-write the friend doc — only the acceptor can (asymmetry)', async () => {
    // Request goes ATTACKER → VICTIM, so only users/VICTIM/friendRequests/ATTACKER
    // exists. ATTACKER writing users/VICTIM/friends/ATTACKER must still fail: the
    // owner branch needs VICTIM as auth uid, and the mirror branch needs
    // users/ATTACKER/friendRequests/VICTIM (absent). Pins the by-design asymmetry.
    await seedRequest(VICTIM, ATTACKER);
    await assertFails(setDoc(
      doc(attackerDb(), 'users', VICTIM, 'friends', ATTACKER),
      { since: serverTimestamp() },
    ));
  });

  it('legit accept (both sides) succeeds when an incoming request exists', async () => {
    // VICTIM is the acceptor here; ATTACKER name reused only as the requester.
    // Incoming request lives on the acceptor's side: users/{acceptor}/friendRequests/{requester}.
    await seedRequest(VICTIM, ATTACKER);
    // Owner-side write: acceptor (VICTIM) writes their own friends/{requester}.
    await assertSucceeds(setDoc(
      doc(victimDb(), 'users', VICTIM, 'friends', ATTACKER),
      { since: serverTimestamp() },
    ));
    // Mirror write: acceptor (VICTIM) writes requester's friends/{acceptor}.
    await assertSucceeds(setDoc(
      doc(victimDb(), 'users', ATTACKER, 'friends', VICTIM),
      { since: serverTimestamp() },
    ));
  });
});

// BIN-49 — report creation is locked to the submitReport callable. The old
// BIN-25 rules throttle gated per *batch*, so a writeBatch of N report-creates +
// 1 throttle write let all N through. The create rule is now `if false`: clients
// can't write reports OR their throttle directly; only the server-authoritative
// callable (Admin SDK, which bypasses rules) can, enforcing a transactional
// per-uid cooldown the client can't pack into a batch.
describe('reports create locked to submitReport callable (BIN-49)', () => {
  function validReport() {
    return {
      reporterUid: OWNER, targetType: 'review', targetId: 'rev1',
      targetOwnerUid: 'other_uid', reason: 'spam', status: 'open',
      createdAt: serverTimestamp(),
    };
  }
  function throttleRef(db: ReturnType<typeof ownerDb>) {
    return doc(db, 'users', OWNER, 'reportMeta', 'throttle');
  }

  it('a plain client create is rejected (rule is `if false`)', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'reports', 'rep1'), validReport()));
  });

  it('the old batch-bypass (report + throttle in one batch) is rejected', async () => {
    // This is the exact vector BIN-49 closes: stamping the throttle in the same
    // batch no longer satisfies any create condition — there is none.
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'reports', 'rep1'), validReport());
    batch.set(throttleRef(db), { lastReportAt: serverTimestamp() });
    await assertFails(batch.commit());
  });

  it('a multi-report batch (the abuse case) is rejected', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'reports', 'rep1'), validReport());
    batch.set(doc(db, 'reports', 'rep2'), validReport());
    batch.set(doc(db, 'reports', 'rep3'), validReport());
    batch.set(throttleRef(db), { lastReportAt: serverTimestamp() });
    await assertFails(batch.commit());
  });
});

describe('users/{uid}/reportMeta throttle write rule (BIN-49 locked)', () => {
  it('owner can NO LONGER write their throttle directly (server-only now)', async () => {
    // Previously allowed (BIN-25). Now create/update is `if false` — only the
    // submitReport callable stamps it, so a client can't reset its own cooldown.
    await assertFails(setDoc(
      doc(ownerDb(), 'users', OWNER, 'reportMeta', 'throttle'),
      { lastReportAt: serverTimestamp() },
    ));
  });
  it('non-owner cannot write another user throttle either', async () => {
    await assertFails(setDoc(
      doc(otherDb(), 'users', OWNER, 'reportMeta', 'throttle'),
      { lastReportAt: serverTimestamp() },
    ));
  });
  it('owner can still delete their throttle (deleteAccount cascade)', async () => {
    // Seed via the admin context (bypasses rules), then delete as the owner.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'reportMeta', 'throttle'),
        { lastReportAt: serverTimestamp() });
    });
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'users', OWNER, 'reportMeta', 'throttle')));
  });
  it('non-owner cannot delete another user throttle', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'reportMeta', 'throttle'),
        { lastReportAt: serverTimestamp() });
    });
    await assertFails(deleteDoc(doc(otherDb(), 'users', OWNER, 'reportMeta', 'throttle')));
  });
});

// BIN-509: anonymous participant ids always come from generateSecureToken() →
// exactly 32 lowercase-hex chars. The rules gate anon slots to that shape (so a
// ghost slot can't be pre-planted on a real uid's path), so these tests must use
// real token-shaped ids for the anon allow-paths, and can use non-token ids
// (uid-shaped) to prove the shape guard denies pre-planting.
const ANON1 = '0123456789abcdef0123456789abcdef';
const ANON2 = 'fedcba9876543210fedcba9876543210';
const ANON_UNSEEDED = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // token-shaped, never seeded

// BIN-24 — Tillsammans participant uid anti-spoof. Anonymous participation stays
// allowed (uid null), but a signed-in writer may only set their OWN uid, and an
// anonymous writer may not carry a non-null uid (identity misattribution).
// BIN-509 tightened the contract: signed-in participants are keyed pid == uid
// (the client always writes pid = uid when authed), so these fixtures use
// pid == OWNER rather than an arbitrary 'p1'.
describe('sessions/{id}/participants — uid anti-spoof (BIN-24)', () => {
  function validParticipant(uid: string | null) {
    return {
      uid, displayName: 'Spelare', providers: [], vetoRemaining: 1,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
    };
  }
  it('signed-in user can create their participant slot (pid == uid)', async () => {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      validParticipant(OWNER),
    ));
  });
  it('signed-in user cannot spoof another uid', async () => {
    await assertFails(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      validParticipant('someone_else'),
    ));
  });
  it('anonymous user can create a participant with uid null', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(null),
    ));
  });
  it('anonymous user cannot carry a non-null uid', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(OWNER),
    ));
  });
  it('a different signed-in user cannot update another participant doc', async () => {
    // OWNER creates their slot (pid == uid == OWNER); other_uid then tries to
    // touch it. pid != other_uid AND merged uid stays OWNER → both the path
    // binding and the uid-field guard deny.
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      validParticipant(OWNER),
    ));
    await assertFails(updateDoc(
      doc(otherDb(), 'sessions', 's1', 'participants', OWNER),
      { lastActiveAt: serverTimestamp() },
    ));
  });
});

// BIN-509 — participant slot path binding. A signed-in writer's slot is bound
// to pid == auth.uid; anon slots (uid null before AND after) are writable by
// any link-holder (token-trust model, accepted deviation) but can never be
// claimed by or stripped from a signed-in identity.
describe('sessions/{id}/participants — slot hijack (BIN-509)', () => {
  function validParticipant(uid: string | null) {
    return {
      uid, displayName: 'Spelare', providers: [], vetoRemaining: 1,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
    };
  }
  it('signed-in user cannot create a slot at a foreign pid even with their own uid', async () => {
    // The BIN-509 hole: uid-field check passed (field is "honest") while the
    // PATH pointed at someone else's slot.
    await assertFails(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', 'someone_elses_pid'),
      validParticipant(OWNER),
    ));
  });
  it('signed-in user cannot take over an existing anon slot with their identity', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(null),
    ));
    await assertFails(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(OWNER),
    ));
  });
  it('anon caller cannot PRE-PLANT a ghost slot at a real uid\'s path (BIN-509 sec-review)', async () => {
    // The blocking exploit: an attacker seeds participants/{victimUid} with
    // uid:null BEFORE the victim joins (uids are enumerable via public
    // usernames/{name}); a forged vote under that key would later read as the
    // victim's own. The anonShapedPid(pid) gate blocks the ghost-slot create:
    // a real uid is 28-char base62, never 32-char hex.
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', 'victim_real_uid'),
      validParticipant(null),
    ));
    // Even a signed-in attacker can't plant an anon ghost at a foreign path.
    await assertFails(setDoc(
      doc(otherDb(), 'sessions', 's1', 'participants', 'victim_real_uid'),
      validParticipant(null),
    ));
  });
  it('anonymous caller cannot strip a signed-in slot down to uid null', async () => {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      validParticipant(OWNER),
    ));
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', OWNER),
      validParticipant(null),
    ));
  });
  it('anon slot stays writable by an anon caller (activity update)', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(null),
    ));
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { lastActiveAt: serverTimestamp(), vetoRemaining: 0 },
    ));
  });
  it('signed-in caller may update an anon slot as long as uid stays null (mid-session login)', async () => {
    // Joined logged-out (slot = random token, uid null), then logged in: their
    // stored participantId still points at the anon slot. Same trust class as
    // anon-writes-anon — allowed, as long as the slot is never claimed.
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      validParticipant(null),
    ));
    await assertSucceeds(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', ANON1),
      { lastActiveAt: serverTimestamp() },
    ));
  });
});

// BIN-540 — participant field VALUE validation. `vetoRemaining` and `isHost`
// were listed in the hasOnly() key contract but never value-checked, so any
// link-holder could grant themselves unlimited vetoes or write junk types.
describe('sessions/{id}/participants — vetoRemaining/isHost values (BIN-540)', () => {
  function participant(overrides: Record<string, unknown> = {}) {
    return {
      uid: null, displayName: 'Spelare', providers: [], vetoRemaining: 1,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
      ...overrides,
    };
  }
  it('rejects a create with vetoRemaining above the 1-veto budget', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 99 }),
    ));
  });
  it('rejects a create with negative vetoRemaining', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: -1 }),
    ));
  });
  it('rejects a non-int vetoRemaining', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 'many' }),
    ));
  });
  it('rejects a non-bool isHost', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ isHost: 'yes' }),
    ));
  });
  it('rejects re-granting a spent veto (0 → 1) on update', async () => {
    // The real abuse: veto is a once-per-session budget, spent by recordSwipe
    // writing vetoRemaining: 0. Going back up is not a legitimate flow.
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 0 }),
    ));
    // 1 is INSIDE the allowed range, so only the spend-down ratchet can stop
    // this — the range check alone lets a spent slot re-arm itself forever.
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 1 },
    ));
    // Out-of-range re-grant stays blocked too (range check).
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 5 },
    ));
    // Rewriting the spent value is still fine (heartbeats re-send the field).
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
  });
  it('rejects promoting yourself to host after create', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ isHost: false }),
    ));
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { isHost: true },
    ));
  });
  it('rejects demoting an existing host slot', async () => {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      participant({ uid: OWNER, isHost: true }),
    ));
    await assertFails(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { isHost: false },
    ));
  });
  it('still allows the real flows: join with 1 veto, then spend it', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 1 }),
    ));
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
  });

  // Security Architect panel, 2026-07-20. The two guards above are only half a
  // fix: a slot can ALREADY hold junk, because the pre-BIN-540 rule validated
  // no values at all and the anon write-gate lets any link-holder write another
  // anon participant's slot. Comparing an int against a stored string is a TYPE
  // ERROR, which fails the whole allow expression — so shipping BIN-540 without
  // these guards would let a hostile link-holder plant a value TODAY that
  // permanently bricks a victim's slot the moment the rule deploys. The seeds
  // below therefore bypass the rules (withSecurityRulesDisabled), exactly as a
  // pre-fix client could have.
  it('a slot carrying a junk vetoRemaining is still writable by its owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${ANON1}`).set({
        uid: null, displayName: 'Offer', providers: [],
        vetoRemaining: 'many', isHost: false,
      });
    });
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
  });

  it('a slot with NO isHost field is still writable by its owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${ANON1}`).set({
        uid: null, displayName: 'Offer', providers: [], vetoRemaining: 1,
      });
    });
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { isHost: false, lastActiveAt: serverTimestamp() },
    ));
  });

  it('a slot carrying a JUNK-TYPED isHost is healed to false by its owner', async () => {
    // .get('isHost', false) only defaults an ABSENT key — a present 'yes' comes
    // back as-is, so a plain equality would deny every future write and brick
    // the slot. planJoinFields writes isHost:false to heal; the rule must accept
    // that when the stored value isn't a bool.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${ANON1}`).set({
        uid: null, displayName: 'Offer', providers: [], vetoRemaining: 1, isHost: 'yes',
      });
    });
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { isHost: false, lastActiveAt: serverTimestamp() },
    ));
  });

  it('a junk-typed isHost slot may only heal to false, never true (no self-promotion)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${ANON1}`).set({
        uid: null, displayName: 'Offer', providers: [], vetoRemaining: 1, isHost: 'yes',
      });
    });
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { isHost: true, lastActiveAt: serverTimestamp() },
    ));
  });

  it('an isHost-less slot still cannot be promoted to host', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${ANON1}`).set({
        uid: null, displayName: 'Offer', providers: [], vetoRemaining: 1,
      });
    });
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { isHost: true },
    ));
  });

  // R3 (same panel): joinSession used to merge `vetoRemaining: 1` on EVERY
  // call, so re-opening a session on a second device after spending the veto
  // was denied by the ratchet and locked the user out of a session they were
  // already in. sessions.ts now omits the field on a rejoin — this pins the
  // rule side of that contract.
  it('a rejoin that omits vetoRemaining is allowed on a spent slot', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 1 }),
    ));
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { uid: null, displayName: 'Spelare', providers: [], lastActiveAt: serverTimestamp() },
      { merge: true },
    ));
  });

  it('a rejoin may NOT re-arm the veto by writing vetoRemaining back to 1', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 1 }),
    ));
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      participant({ vetoRemaining: 1 }),
      { merge: true },
    ));
  });
});

// BIN-509 — swipe vote binding. Signed-in votes are bound to the caller's own
// key (forgeable by NO ONE); anon-slot votes are add-only single-key writes
// verified against the participant doc (uid == null), so a signed-in
// participant's vote can't be forged even by an anonymous caller. Wholesale
// votes-map replacement (veto-storm / fabricated match) is impossible.
// HONESTY SCOPE: one link-holder CAN still forge another ANONYMOUS
// participant's single vote — accepted deviation (rules cannot authenticate an
// unauthenticated caller), see .claude/rules/accepted-deviations.md.
describe('sessions/{id}/swipes — vote binding (BIN-509)', () => {
  function validParticipant(uid: string | null) {
    return {
      uid, displayName: 'Spelare', providers: [], vetoRemaining: 1,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
    };
  }
  // Seed the participant slots the vote keys must resolve against.
  async function seedParticipants() {
    await setDoc(doc(ownerDb(), 'sessions', 's1', 'participants', OWNER), validParticipant(OWNER));
    await setDoc(doc(otherDb(), 'sessions', 's1', 'participants', 'other_uid'), validParticipant('other_uid'));
    await setDoc(doc(anonDb(), 'sessions', 's1', 'participants', ANON1), validParticipant(null));
    await setDoc(doc(anonDb(), 'sessions', 's1', 'participants', ANON2), validParticipant(null));
  }
  // BIN-624: create on sessions/{id}/swipes/{tmdbId} now requires the canonical
  // `movie_N`/`tv_N` doc id. These fixtures were written against BARE numeric
  // ids, which the guard denies — so the namespacing happens HERE, once, and
  // every vote-binding case below keeps testing exactly what it was written to
  // test. Do NOT "fix" a red case by loosening the rule to admit bare ids: that
  // re-opens the junk-doc hole the guard exists to close. The doc-id guard has
  // its own cases in the sibling describe block.
  /** Takes the doc id verbatim — for the doc-id guard's own cases. */
  const rawSwipeRef = (db: ReturnType<typeof ownerDb>, docId: string) =>
    doc(db, 'sessions', 's1', 'swipes', docId);
  const swipeRef = (db: ReturnType<typeof ownerDb>, tmdbId = '603') =>
    rawSwipeRef(db, `movie_${tmdbId}`);

  it('signed-in first vote on a title succeeds (CREATE branch — the diff()-on-create trap)', async () => {
    await seedParticipants();
    await assertSucceeds(setDoc(swipeRef(ownerDb()), {
      votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('signed-in user can change their OWN vote (merge update leaves other keys untouched)', async () => {
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertSucceeds(setDoc(swipeRef(ownerDb()), {
      votes: { [OWNER]: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('anonymous first vote on a fresh title succeeds (create, key resolves to an anon slot)', async () => {
    await seedParticipants();
    await assertSucceeds(setDoc(swipeRef(anonDb(), '604'), {
      votes: { [ANON1]: 'no' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('anonymous voter can ADD their key next to an existing signed-in vote', async () => {
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertSucceeds(setDoc(swipeRef(anonDb()), {
      votes: { [ANON1]: 'no' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('signed-in user cannot forge another signed-in participant\'s vote', async () => {
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertFails(setDoc(swipeRef(ownerDb()), {
      votes: { other_uid: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('anonymous caller cannot CHANGE a signed-in participant\'s existing vote', async () => {
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertFails(setDoc(swipeRef(anonDb()), {
      votes: { [OWNER]: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('anonymous caller cannot ADD a vote under a signed-in participant\'s key', async () => {
    await seedParticipants();
    await assertFails(setDoc(swipeRef(anonDb(), '605'), {
      votes: { other_uid: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('non-merge setDoc that wipes another participant\'s existing vote is denied', async () => {
    // A replacement that REMOVES someone else's key — the veto-storm/
    // fabricated-match vector. (A same-content replacement adding only your
    // own key is legitimately allowed — not asserted as a deny.)
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertFails(setDoc(swipeRef(anonDb()), {
      votes: { [ANON1]: 'yes' }, updatedAt: serverTimestamp(),
    }));
  });
  it('multi-key votes diff is denied even across anon slots', async () => {
    await seedParticipants();
    await setDoc(swipeRef(ownerDb()), { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertFails(setDoc(swipeRef(anonDb()), {
      votes: { [ANON1]: 'yes', [ANON2]: 'no' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('a token-shaped vote key with no participant doc behind it is denied (get() denies)', async () => {
    await seedParticipants();
    await assertFails(setDoc(swipeRef(anonDb(), '606'), {
      votes: { [ANON_UNSEEDED]: 'yes' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('a uid-shaped vote key is denied by the shape gate even when a ghost slot exists (defense-in-depth swipe leg)', async () => {
    // Isolate the swipes-side anonShapedPid() gate: admin-seed a uid-shaped
    // participant doc with uid:null (the participants rule would REFUSE to
    // create this — that's the primary defense — so we bypass rules to force
    // the counterfactual). Now get(participants/victim_real_uid).uid == null
    // would PASS, so the ONLY thing that can deny the forged vote is the
    // anonShapedPid() shape gate. Proves the swipe leg is independently
    // defended, not just riding on the missing-doc get() denial.
    await seedParticipants();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sessions', 's1', 'participants', 'victim_real_uid'),
        validParticipant(null));
    });
    await assertFails(setDoc(swipeRef(anonDb(), '610'), {
      votes: { victim_real_uid: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('invalid vote values are rejected', async () => {
    await seedParticipants();
    await assertFails(setDoc(swipeRef(ownerDb(), '607'), {
      votes: { [OWNER]: 'super_yes' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('add-only boundary: an anon voter cannot change even their own existing vote', async () => {
    // Honest limitation, documented: rules cannot tell an anon re-vote apart
    // from one anon forging another anon's vote, so changes to existing anon
    // keys are denied wholesale. recordSwipe only ever writes first-votes per
    // title, so no legitimate flow hits this.
    await seedParticipants();
    await setDoc(swipeRef(anonDb(), '608'), { votes: { [ANON1]: 'no' }, updatedAt: serverTimestamp() }, { merge: true });
    await assertFails(setDoc(swipeRef(anonDb(), '608'), {
      votes: { [ANON1]: 'veto' }, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('swipe doc with unknown top-level fields is still rejected (shape guard)', async () => {
    await seedParticipants();
    await assertFails(setDoc(swipeRef(ownerDb(), '609'), {
      votes: { [OWNER]: 'yes' }, evil: true, updatedAt: serverTimestamp(),
    }, { merge: true }));
  });

  // BIN-624: the doc-id format guard itself. Everything above proves WHO may
  // write a vote; this block proves WHERE a vote document may be created.
  describe('doc-id format guard (BIN-624)', () => {
    const firstVote = { votes: { [OWNER]: 'yes' }, updatedAt: serverTimestamp() };

    it('accepts the two shapes mediaTypeDocId() actually writes', async () => {
      await seedParticipants();
      await assertSucceeds(setDoc(rawSwipeRef(ownerDb(), 'movie_42'), firstVote, { merge: true }));
      await assertSucceeds(setDoc(rawSwipeRef(ownerDb(), 'tv_42'), firstVote, { merge: true }));
      // `movie_0` is still WRITABLE here, and since BIN-646 the client refuses to
      // READ it: TMDB numbers titles from 1, so no genuine title is 0, and
      // `Number.isFinite(0)` was letting a `movie_0` doc past every downstream
      // guard as if it named one. So this line no longer says "a legitimate id
      // must stay writable" — it records a KNOWN residual: the rules regex is
      // deliberately wider than the client's reader until the guard is narrowed,
      // which is a firestore.rules change with its own plan and deploy (BIN-797).
      // The effect meanwhile is a doc nobody can create by accident and nobody
      // reads — not a vote that silently counts.
      await assertSucceeds(setDoc(rawSwipeRef(ownerDb(), 'movie_0'), firstVote, { merge: true }));
    });

    // The alias set from BIN-618/636 — this list must stay a SUPERSET of
    // `ALIASES_OF_42` in src/lib/mediaTypeDocId.parity.test.ts, or the two
    // files end up with two different spellings of "the alias set". Each of
    // these used to be creatable, and none is a shape a canonical writer can
    // produce.
    it.each([
      ['movie_042', 'leading zero — the alias that re-keys onto the genuine movie_42'],
      ['042', 'bare padded alias — the legacy-shaped member of the same set'],
      ['tv_0000042', 'padded alias'],
      ['zmovie_42', 'unknown prefix'],
      ['season_42', 'wrong namespace entirely'],
      ['movie_', 'empty suffix — must not resolve as Number("") === 0'],
      ['movie_1_2', 'junk suffix'],
      ['movie_xyz', 'non-numeric suffix'],
      ['603', 'bare legacy id — creatable before this guard, not any more'],
      ['MOVIE_42', 'prefix case must match — the regex is lowercase-anchored'],
      // Not asserted: a path-traversal id like `../evil`. The Firestore SDK
      // rejects it as a malformed reference before any rule is consulted, so
      // the case would pass without the guard and prove nothing.
    ])('denies CREATE at %s (%s)', async (docId) => {
      await seedParticipants();
      await assertFails(setDoc(rawSwipeRef(ownerDb(), docId), firstVote, { merge: true }));
    });

    // The reason `update` is deliberately left unguarded: sessions that were
    // live before this rule shipped still hold bare-numeric vote documents, and
    // BIN-608 merges them per participant until the 7-day TTL reaps them.
    // Guarding update would freeze those sessions mid-vote.
    it('a grandfathered bare-numeric doc can still receive a NEW vote key', async () => {
      await seedParticipants();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'sessions', 's1', 'swipes', '603'), {
          votes: { other_uid: 'yes' }, updatedAt: serverTimestamp(),
        });
      });
      await assertSucceeds(setDoc(rawSwipeRef(ownerDb(), '603'), {
        votes: { [OWNER]: 'no' }, updatedAt: serverTimestamp(),
      }, { merge: true }));
    });

    // The guard is additive, not a replacement: an id-shaped path must not buy
    // its way past the vote-binding rules the block above pins.
    it('a canonical doc id does NOT excuse forging another participant\'s vote', async () => {
      await seedParticipants();
      await assertFails(setDoc(rawSwipeRef(anonDb(), 'movie_99'), {
        votes: { other_uid: 'veto' }, updatedAt: serverTimestamp(),
      }, { merge: true }));
    });
  });
});

// BIN-95: episode reactions — public read, own-write, non-forgeable identity.
function validReaction(uid: string) {
  return {
    uid, tmdbId: 1399, mediaType: 'tv', seasonNumber: 1, episodeNumber: 3,
    text: 'Vilket avsnitt!', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}
describe('episodeReactions/{key}/reactions/{id} (BIN-95)', () => {
  const path = ['episodeReactions', '1399_1_3', 'reactions'] as const;
  it('is publicly readable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...path, 'r1'), validReaction(OWNER));
    });
    await assertSucceeds(getDoc(doc(anonDb(), ...path, 'r1')));
  });
  it('owner can post a valid reaction', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), ...path, 'r2'), validReaction(OWNER)));
  });
  it('cannot post under another uid (anti-spoof)', async () => {
    await assertFails(setDoc(doc(ownerDb(), ...path, 'r3'), validReaction('other_uid')));
  });
  it('rejects extra fields', async () => {
    await assertFails(setDoc(doc(ownerDb(), ...path, 'r4'), { ...validReaction(OWNER), junk: 1 }));
  });
  it('rejects empty text', async () => {
    await assertFails(setDoc(doc(ownerDb(), ...path, 'r5'), { ...validReaction(OWNER), text: '' }));
  });
  it('unauthenticated cannot post', async () => {
    await assertFails(setDoc(doc(anonDb(), ...path, 'r6'), validReaction(OWNER)));
  });
  it('owner can delete own; non-owner cannot', async () => {
    await setDoc(doc(ownerDb(), ...path, 'r7'), validReaction(OWNER));
    await assertFails(deleteDoc(doc(otherDb(), ...path, 'r7')));
    await assertSucceeds(deleteDoc(doc(ownerDb(), ...path, 'r7')));
  });
  it('rejects text over 2000 chars', async () => {
    await assertFails(setDoc(doc(ownerDb(), ...path, 'r8'), { ...validReaction(OWNER), text: 'x'.repeat(2001) }));
  });
  it('non-owner cannot update a reaction', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...path, 'ru1'), validReaction(OWNER));
    });
    await assertFails(updateDoc(doc(otherDb(), ...path, 'ru1'), { text: 'hijack' }));
  });
  it('owner cannot change uid on update (no ownership transfer)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...path, 'ru2'), validReaction(OWNER));
    });
    await assertFails(updateDoc(doc(ownerDb(), ...path, 'ru2'), { uid: 'other_uid' }));
  });
});

// BIN-279 — deny-path coverage for two guards that fail SILENTLY if a future
// rules edit breaks them: matchesOwnIdentity (a user must not author a review or
// reaction wearing another user's displayName/username) and reports read
// (admin-only). Each deny is paired with a positive twin so a rejection can only
// come from the guard under test, never from schema drift / a whitelist failure.
describe('BIN-279 — review/reaction identity forgery (matchesOwnIdentity)', () => {
  // matchesOwnIdentity reads users/{auth.uid}; seed the writer's OWN profile with
  // a known identity so a mismatching displayName/username on the doc is the only
  // thing that can fail the write. Without this seed both sides are null and the
  // guard short-circuits — the test would pass for the wrong reason.
  async function seedOwnerIdentity() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER), {
        displayName: 'Äkta Ägaren', username: 'owner',
        isPublic: true, defaultVisibility: 'public',
      });
    });
  }

  it('rejects a review carrying a displayName that is not the writer’s own', async () => {
    await seedOwnerIdentity();
    await assertFails(setDoc(doc(ownerDb(), 'reviews', 'r1'), {
      ...validReview(OWNER), displayName: 'Någon Annan',
    }));
  });
  it('rejects a review carrying a username that is not the writer’s own', async () => {
    await seedOwnerIdentity();
    await assertFails(setDoc(doc(ownerDb(), 'reviews', 'r1'), {
      ...validReview(OWNER), username: 'impostor',
    }));
  });
  it('allows a review whose displayName/username match the writer’s profile (positive control)', async () => {
    await seedOwnerIdentity();
    await assertSucceeds(setDoc(doc(ownerDb(), 'reviews', 'r1'), {
      ...validReview(OWNER), displayName: 'Äkta Ägaren', username: 'owner',
    }));
  });
  it('rejects a reaction carrying a forged displayName', async () => {
    await seedOwnerIdentity();
    await assertFails(setDoc(doc(ownerDb(), 'episodeReactions', '1399_1_3', 'reactions', 'rx1'), {
      ...validReaction(OWNER), displayName: 'Någon Annan',
    }));
  });
  it('rejects a reaction carrying a username that is not the writer’s own', async () => {
    // isValidReaction calls matchesOwnIdentity independently of isValidReview, so
    // a rules fork that patched only the reaction path would slip past the review
    // username test — keep the reaction block's coverage symmetric.
    await seedOwnerIdentity();
    await assertFails(setDoc(doc(ownerDb(), 'episodeReactions', '1399_1_3', 'reactions', 'rx3'), {
      ...validReaction(OWNER), username: 'impostor',
    }));
  });
  it('allows a reaction whose identity matches the writer’s profile (positive control)', async () => {
    await seedOwnerIdentity();
    await assertSucceeds(setDoc(doc(ownerDb(), 'episodeReactions', '1399_1_3', 'reactions', 'rx2'), {
      ...validReaction(OWNER), displayName: 'Äkta Ägaren', username: 'owner',
    }));
  });
});

describe('BIN-279 — reports read is admin-only', () => {
  const ADMIN = 'admin_uid';
  function adminDb() { return testEnv.authenticatedContext(ADMIN).firestore(); }
  async function seedReport() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', 'rep1'), {
        reporterUid: 'someone_uid', targetType: 'review', targetId: 'rev1',
        targetOwnerUid: 'victim_uid', reason: 'spam', status: 'open',
        createdAt: serverTimestamp(),
      });
    });
  }
  async function makeAdmin() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ADMIN), { isAdmin: true });
    });
  }

  it('denies a signed-in non-admin reading a report', async () => {
    await seedReport();
    await assertFails(getDoc(doc(ownerDb(), 'reports', 'rep1')));
  });
  it('denies an unauthenticated user reading a report', async () => {
    await seedReport();
    await assertFails(getDoc(doc(anonDb(), 'reports', 'rep1')));
  });
  it('allows an admin (users/{uid}.isAdmin == true) to read a report', async () => {
    await seedReport();
    await makeAdmin();
    await assertSucceeds(getDoc(doc(adminDb(), 'reports', 'rep1')));
  });
});

// BIN-357: an admin updating a report may only stamp actionedByUid with THEIR
// OWN uid. The sole update path (updateReportStatus) always writes the acting
// admin's auth uid, so legit updates pass; this blocks a (future multi-admin)
// actor from framing another admin in the audit trail.
describe('reports admin-update actionedByUid pin (BIN-357)', () => {
  const ADMIN = 'admin_uid';
  function adminDb() { return testEnv.authenticatedContext(ADMIN).firestore(); }
  async function seedOpenReport() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reports', 'rep1'), {
        reporterUid: 'someone_uid', targetType: 'review', targetId: 'rev1',
        targetOwnerUid: 'victim_uid', reason: 'spam', status: 'open',
        createdAt: serverTimestamp(),
      });
    });
  }
  async function makeAdmin() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', ADMIN), { isAdmin: true });
    });
  }

  it('admin can action a report stamping their OWN uid (the real updateReportStatus flow)', async () => {
    await seedOpenReport();
    await makeAdmin();
    await assertSucceeds(updateDoc(doc(adminDb(), 'reports', 'rep1'), {
      status: 'actioned', actionedByUid: ADMIN, updatedAt: serverTimestamp(),
    }));
  });
  it('admin cannot attribute an action to a DIFFERENT admin uid (anti-framing)', async () => {
    await seedOpenReport();
    await makeAdmin();
    await assertFails(updateDoc(doc(adminDb(), 'reports', 'rep1'), {
      status: 'actioned', actionedByUid: 'other_admin_uid', updatedAt: serverTimestamp(),
    }));
  });
});

// BIN-276 / BIN-327 — groups owner-update hardening + memberUids growth caps.
// The group permission block (two-step hash-verified token join, consent-based
// invite-accept, owner-can-only-shrink guard, self-leave, sessionHistory
// anti-forge) is the highest-complexity surface in the file and previously had
// ZERO rule tests. Each deny is paired with a positive twin. sha256Hex mirrors
// the rules' hashing.sha256(token).toHexString().lower() exactly.
const GROUP = 'grp1';
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

async function seedGroup(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'groups', GROUP), {
      ownerUid: OWNER, memberUids: [OWNER], name: 'Filmklubben',
      defaults: { region: 'SE' }, inviteTokenHash: null, inviteTokenRotatedAt: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
    });
  });
}
// The group-update join branch only checks that joinAttempts/{uid} EXISTS — the
// hash gate lives on the joinAttempts CREATE rule (tested separately). Seal one
// directly so the membership-add tests isolate the group-update branch.
async function sealJoinAttempt(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'groups', GROUP, 'joinAttempts', uid), {
      token: 'plain', createdAt: serverTimestamp(),
    });
  });
}
async function seedInvite(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid, 'groupInvites', GROUP), {
      groupId: GROUP, createdAt: serverTimestamp(),
    });
  });
}

describe('groups/{id} owner-update hardening (BIN-276)', () => {
  it('owner can remove a member (shrink memberUids)', async () => {
    await seedGroup({ memberUids: [OWNER, 'm2'] });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'groups', GROUP), { memberUids: [OWNER] }));
  });
  it('owner can still rename — name/defaults stay mutable (carve-out)', async () => {
    await seedGroup();
    await assertSucceeds(updateDoc(doc(ownerDb(), 'groups', GROUP), { name: 'Nya namnet', defaults: { region: 'NO' } }));
  });
  it('owner cannot force-transfer ownership onto another uid', async () => {
    await seedGroup({ memberUids: [OWNER, 'm2'] });
    await assertFails(updateDoc(doc(ownerDb(), 'groups', GROUP), { ownerUid: 'victim_uid' }));
  });
  it('owner cannot rewrite inviteTokenHash on a member-edit write', async () => {
    await seedGroup({ inviteTokenHash: 'aaa', memberUids: [OWNER, 'm2'] });
    await assertFails(updateDoc(doc(ownerDb(), 'groups', GROUP), { memberUids: [OWNER], inviteTokenHash: 'bbb' }));
  });
  it('owner cannot add an arbitrary member uid (hasAll = shrink-only)', async () => {
    await seedGroup();
    await assertFails(updateDoc(doc(ownerDb(), 'groups', GROUP), { memberUids: [OWNER, 'stranger'] }));
  });
  // The owner branch pins inviteTokenHash, so rotation/disable need their own
  // branch — these prove the legit owner flows (rotateInviteToken/disableInviteToken)
  // still work while membership/ownership stay pinned.
  it('owner can rotate the invite token (hash + rotatedAt change)', async () => {
    await seedGroup({ inviteTokenHash: 'oldhash' });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'groups', GROUP), {
      inviteTokenHash: 'newhash', inviteTokenRotatedAt: serverTimestamp(),
    }));
  });
  it('owner can disable the invite token (hash → null)', async () => {
    await seedGroup({ inviteTokenHash: 'oldhash' });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'groups', GROUP), { inviteTokenHash: null }));
  });
  it('a non-owner member cannot rotate the invite token', async () => {
    await seedGroup({ inviteTokenHash: 'oldhash', memberUids: [OWNER, 'other_uid'] });
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), { inviteTokenHash: 'newhash' }));
  });
});

describe('groups/{id} leave branch — shrink-only (BIN-327)', () => {
  it('a member can leave (removes only themselves)', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'] });
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER] }));
  });
  it('a leaving member cannot inject a new uid as they exit (cap-bypass guard)', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'] });
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER, 'stranger'] }));
  });
});

// BIN-365: exact-self-leave + inviteTokenRotatedAt forge-pin. hasAll (BIN-327)
// confines a leave to a subset; these add "exactly one removed" so a leaving
// member cannot also drop a bystander, and switch the rotatedAt pin to the
// request-doc idiom so it cannot be forged on a group where it was never set.
describe('groups/{id} exact-self-leave + rotatedAt forge-pin (BIN-365)', () => {
  it('a leaving member cannot ALSO remove a third party in the same write', async () => {
    // Pre-BIN-365 this PASSED: [OWNER,other,third] → [OWNER] satisfies hasAll +
    // self-absence, silently removing the bystander. size()==old-1 now denies it.
    await seedGroup({ memberUids: [OWNER, 'other_uid', 'third_uid'] });
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER] }));
  });
  it('exact self-leave with a bystander present succeeds (also the erasure write shape)', async () => {
    // accountDeletion writes a LITERAL filtered array (size-1) as the leaving
    // user — identical shape to this; proves erasure still passes the predicate.
    await seedGroup({ memberUids: [OWNER, 'other_uid', 'third_uid'] });
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER, 'third_uid'] }));
  });
  it('owner can bulk-remove several members in one write (owner branch, no size cap)', async () => {
    await seedGroup({ memberUids: [OWNER, 'm2', 'm3'] });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'groups', GROUP), { memberUids: [OWNER] }));
  });
  it('a leave write that OMITS inviteTokenRotatedAt succeeds (delta-write safety)', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'], inviteTokenRotatedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER] }));
  });
  it('a leave write cannot CHANGE inviteTokenRotatedAt', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'], inviteTokenRotatedAt: new Date('2020-01-01') });
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), {
      memberUids: [OWNER], inviteTokenRotatedAt: new Date('2099-01-01'),
    }));
  });
  it('owner cannot FORGE inviteTokenRotatedAt on a group where it was never set', async () => {
    // Custom seed omitting the field entirely (seedGroup always sets it to null).
    // Pre-BIN-365 the stored-doc idiom short-circuited true here → forgeable.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GROUP), {
        ownerUid: OWNER, memberUids: [OWNER, 'm2'], name: 'Filmklubben',
        defaults: { region: 'SE' }, inviteTokenHash: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await assertFails(updateDoc(doc(ownerDb(), 'groups', GROUP), {
      memberUids: [OWNER], inviteTokenRotatedAt: serverTimestamp(),
    }));
  });
  it('a join write cannot FORGE inviteTokenRotatedAt on a group where it was never set', async () => {
    // Same forge vector on the join branch (the idiom fix touches all 4 branches).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GROUP), {
        ownerUid: OWNER, memberUids: [OWNER], name: 'Filmklubben',
        defaults: { region: 'SE' }, inviteTokenHash: sha256Hex('secret'),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await sealJoinAttempt('other_uid');
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), {
      memberUids: [OWNER, 'other_uid'], inviteTokenRotatedAt: serverTimestamp(),
    }));
  });
  it('an accept write cannot FORGE inviteTokenRotatedAt on a group where it was never set', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GROUP), {
        ownerUid: OWNER, memberUids: [OWNER], name: 'Filmklubben',
        defaults: { region: 'SE' }, inviteTokenHash: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await seedInvite('other_uid');
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), {
      memberUids: [OWNER, 'other_uid'], inviteTokenRotatedAt: serverTimestamp(),
    }));
  });
});

describe('groups joinAttempts hash gate (BIN-327)', () => {
  const TOKEN = 'secret-token-123';
  it('accepts a joinAttempt whose token hashes to inviteTokenHash', async () => {
    await seedGroup({ inviteTokenHash: sha256Hex(TOKEN) });
    await assertSucceeds(setDoc(doc(otherDb(), 'groups', GROUP, 'joinAttempts', 'other_uid'), {
      token: TOKEN, createdAt: serverTimestamp(),
    }));
  });
  it('rejects a joinAttempt with the wrong token', async () => {
    await seedGroup({ inviteTokenHash: sha256Hex(TOKEN) });
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'joinAttempts', 'other_uid'), {
      token: 'wrong-token', createdAt: serverTimestamp(),
    }));
  });
  // BIN-480: createdAt must be request.time so retentionCleanup can reap it.
  // A hand-crafted non-timestamp or forged date would otherwise be retained
  // forever (Art. 17 backstop gap).
  it('rejects a joinAttempt created with no createdAt field at all', async () => {
    await seedGroup({ inviteTokenHash: sha256Hex(TOKEN) });
    // The exact undateable-doc scenario the rule guards against: a hand-crafted
    // create that omits createdAt entirely. retentionCleanup can never reap it,
    // so without this pin it would be retained forever (Art. 17 backstop gap).
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'joinAttempts', 'other_uid'), {
      token: TOKEN,
    }));
  });
  it('rejects a joinAttempt whose createdAt is not a timestamp', async () => {
    await seedGroup({ inviteTokenHash: sha256Hex(TOKEN) });
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'joinAttempts', 'other_uid'), {
      token: TOKEN, createdAt: 'not-a-timestamp',
    }));
  });
  it('rejects a joinAttempt whose createdAt is a forged (non-request.time) date', async () => {
    await seedGroup({ inviteTokenHash: sha256Hex(TOKEN) });
    const future = Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'joinAttempts', 'other_uid'), {
      token: TOKEN, createdAt: future,
    }));
  });
});

describe('groups token-join membership add + size cap (BIN-327)', () => {
  it('a joiner with a sealed joinAttempt can add themselves', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await sealJoinAttempt('other_uid');
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] }));
  });
  it('the 100th member can join', async () => {
    const base99 = [OWNER, ...Array.from({ length: 98 }, (_, i) => `u${i}`)];
    await seedGroup({ memberUids: base99 });
    await sealJoinAttempt('other_uid');
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [...base99, 'other_uid'] }));
  });
  it('a join that would make memberUids exceed 100 is denied', async () => {
    const base100 = [OWNER, ...Array.from({ length: 99 }, (_, i) => `v${i}`)];
    await seedGroup({ memberUids: base100 });
    await sealJoinAttempt('other_uid');
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [...base100, 'other_uid'] }));
  });
});

describe('groups invite-accept (BIN-327)', () => {
  it('an invitee with a groupInvite can accept (add self)', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await seedInvite('other_uid');
    await assertSucceeds(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] }));
  });
  it('without a groupInvite, accept is denied', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await assertFails(updateDoc(doc(otherDb(), 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] }));
  });
});

// BIN-532/BIN-533: members/{memberUid} create rule (firestore.rules) gates on
// `request.auth.uid in get(groups/{groupId}).data.memberUids` — a get() that
// resolves against the database state BEFORE the whole batch/transaction,
// never a sibling write queued in the SAME commit. Direct proof (against the
// real emulator, not a mock) that a client writeBatch combining "add uid to
// memberUids" + "create members/{uid}" in one commit is permission-denied,
// while the same two writes done as separate awaited operations succeed —
// this is exactly the class of bug that broke createGroup's short-lived
// atomic-batch version and would have broken joinGroupViaToken/
// acceptGroupInvite identically had they been batched the same way.
// groups.ts's own suite mocks firebase/firestore and is structurally blind
// to this; only a real-rules test can catch it.
describe('groups members/{memberUid} create — batch vs sequential (BIN-532/BIN-533)', () => {
  it('CANNOT create in one batch: group-doc CREATE (owner self-add) + owner member-doc CREATE together', async () => {
    // Mirrors createGroup's pre-fix shape: brand-new group + owner's member
    // doc, both queued in a single client batch.
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, 'groups', 'newgrp'), {
      ownerUid: OWNER, memberUids: [OWNER], name: 'Ny grupp',
      defaults: { region: 'SE' }, inviteTokenHash: null, inviteTokenRotatedAt: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'groups', 'newgrp', 'members', OWNER), {
      uid: OWNER, role: 'owner', notifications: true, joinedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('CAN create sequentially: group-doc CREATE (owner self-add), THEN (separate awaited write) owner member-doc CREATE', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, 'groups', 'newgrp2'), {
      ownerUid: OWNER, memberUids: [OWNER], name: 'Ny grupp', defaults: { region: 'SE' },
      inviteTokenHash: null, inviteTokenRotatedAt: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(db, 'groups', 'newgrp2', 'members', OWNER), {
      uid: OWNER, role: 'owner', notifications: true, joinedAt: serverTimestamp(),
    }));
  });

  it('CANNOT join in one batch: group-doc UPDATE (add self via sealed joinAttempt) + member-doc CREATE together', async () => {
    // Mirrors joinGroupViaToken step 2's pre-fix shape.
    await seedGroup({ memberUids: [OWNER] });
    await sealJoinAttempt('other_uid');
    const db = otherDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] });
    batch.set(doc(db, 'groups', GROUP, 'members', 'other_uid'), {
      uid: 'other_uid', role: 'member', notifications: true, joinedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('CAN join sequentially: group-doc UPDATE, THEN (separate awaited write) member-doc CREATE', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await sealJoinAttempt('other_uid');
    const db = otherDb();
    await assertSucceeds(updateDoc(doc(db, 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] }));
    await assertSucceeds(setDoc(doc(db, 'groups', GROUP, 'members', 'other_uid'), {
      uid: 'other_uid', role: 'member', notifications: true, joinedAt: serverTimestamp(),
    }));
  });

  it('CANNOT accept-invite in one batch: group-doc UPDATE (add self via invite) + member-doc CREATE together', async () => {
    // Mirrors acceptGroupInvite's pre-fix shape (invite-delete omitted — not
    // the mechanism under test here).
    await seedGroup({ memberUids: [OWNER] });
    await seedInvite('other_uid');
    const db = otherDb();
    const batch = writeBatch(db);
    batch.update(doc(db, 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] });
    batch.set(doc(db, 'groups', GROUP, 'members', 'other_uid'), {
      uid: 'other_uid', role: 'member', notifications: true, joinedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('CAN accept-invite sequentially: group-doc UPDATE, THEN (separate awaited write) member-doc CREATE', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await seedInvite('other_uid');
    const db = otherDb();
    await assertSucceeds(updateDoc(doc(db, 'groups', GROUP), { memberUids: [OWNER, 'other_uid'] }));
    await assertSucceeds(setDoc(doc(db, 'groups', GROUP, 'members', 'other_uid'), {
      uid: 'other_uid', role: 'member', notifications: true, joinedAt: serverTimestamp(),
    }));
  });
});

describe('groups sessionHistory pickedByUid anti-forge', () => {
  const validPick = {
    sessionId: 's1', pickedByUid: 'other_uid', pickedTmdbId: 603, mediaType: 'movie',
    mediaTitle: 'The Matrix', posterPath: null, participantUids: ['owner_uid', 'other_uid'],
    pickedAt: serverTimestamp(),
  };
  it('a member can log a pick attributed to themselves', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'] });
    await assertSucceeds(setDoc(doc(otherDb(), 'groups', GROUP, 'sessionHistory', 's1'), validPick));
  });
  it('a member cannot forge a pick as another user', async () => {
    await seedGroup({ memberUids: [OWNER, 'other_uid'] });
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'sessionHistory', 's2'), {
      ...validPick, sessionId: 's2', pickedByUid: OWNER,
    }));
  });
});

// BIN-100: collaborative lists — owner manages editors[], editors edit items only.
async function seedCollabList(listId: string, opts: { isPublic: boolean; editors: string[] }) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'lists', listId), {
      uid: OWNER, title: 'Delad lista', description: '', isPublic: opts.isPublic,
      items: [], editors: opts.editors, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
}

describe('lists collaborative editing (BIN-100)', () => {
  it('owner can add an editor', async () => {
    await seedCollabList('cl1', { isPublic: true, editors: [] });
    await assertSucceeds(updateDoc(doc(ownerDb(), 'lists', 'cl1'),
      { editors: ['other_uid'], updatedAt: serverTimestamp() }));
  });
  it('editor can add items (items-only update)', async () => {
    await seedCollabList('cl2', { isPublic: true, editors: ['other_uid'] });
    await assertSucceeds(updateDoc(doc(otherDb(), 'lists', 'cl2'),
      { items: [{ tmdbId: 1, mediaType: 'movie' }], updatedAt: serverTimestamp() }));
  });
  it('editor may omit updatedAt (hasOnly is a ceiling, not a floor)', async () => {
    await seedCollabList('cl2b', { isPublic: true, editors: ['other_uid'] });
    await assertSucceeds(updateDoc(doc(otherDb(), 'lists', 'cl2b'), { items: [{ tmdbId: 2 }] }));
  });
  it('editor CANNOT change isPublic', async () => {
    await seedCollabList('cl3', { isPublic: false, editors: ['other_uid'] });
    await assertFails(updateDoc(doc(otherDb(), 'lists', 'cl3'), { isPublic: true }));
  });
  it('editor CANNOT change the editors list (no escalation)', async () => {
    await seedCollabList('cl4', { isPublic: true, editors: ['other_uid'] });
    await assertFails(updateDoc(doc(otherDb(), 'lists', 'cl4'), { editors: ['other_uid', 'sneaky'] }));
  });
  it('non-editor non-owner cannot update', async () => {
    await seedCollabList('cl5', { isPublic: true, editors: [] });
    await assertFails(updateDoc(doc(otherDb(), 'lists', 'cl5'), { items: [], updatedAt: serverTimestamp() }));
  });
  it('editor can read a private list they edit', async () => {
    await seedCollabList('cl6', { isPublic: false, editors: ['other_uid'] });
    await assertSucceeds(getDoc(doc(otherDb(), 'lists', 'cl6')));
  });
  it('non-editor cannot read a private list', async () => {
    await seedCollabList('cl7', { isPublic: false, editors: [] });
    await assertFails(getDoc(doc(otherDb(), 'lists', 'cl7')));
  });
  it('editor CAN remove ONLY themselves from editors[] (BIN-149 deletion cascade)', async () => {
    await seedCollabList('cl8', { isPublic: true, editors: ['other_uid', 'third_uid'] });
    await assertSucceeds(updateDoc(doc(otherDb(), 'lists', 'cl8'),
      { editors: ['third_uid'], updatedAt: serverTimestamp() }));
  });
  it('editor CANNOT drop another editor while leaving (self-leave is exact, BIN-149)', async () => {
    await seedCollabList('cl9', { isPublic: true, editors: ['other_uid', 'third_uid'] });
    // other_uid removes self AND third_uid → not equal to old.removeAll([self]) → denied
    await assertFails(updateDoc(doc(otherDb(), 'lists', 'cl9'),
      { editors: [], updatedAt: serverTimestamp() }));
  });
  it('non-editor cannot invoke the self-leave branch (BIN-149)', async () => {
    await seedCollabList('cl10', { isPublic: true, editors: ['third_uid'] });
    // other_uid is not in editors[] → the `uid in editors` guard blocks the branch
    await assertFails(updateDoc(doc(otherDb(), 'lists', 'cl10'),
      { editors: [], updatedAt: serverTimestamp() }));
  });
});

// BIN-96: list following — users/{uid}/listFollows/{listId}.
// Seed a real list via the rules-bypass context so the create rule's
// exists(/lists/{listId}) guard can pass.
async function seedList(listId: string, ownerUid = 'list_owner') {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'lists', listId), {
      uid: ownerUid, title: 'Bästa deckarna', description: '', isPublic: true,
      items: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
}
function validListFollow() {
  return { listOwnerUid: 'list_owner', followedAt: serverTimestamp() };
}

describe('users/{uid}/listFollows/{listId} (BIN-96)', () => {
  it('owner can follow an existing list', async () => {
    await seedList('l1');
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'l1'), validListFollow()));
  });
  it('cannot follow a list that does not exist', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'missing'), validListFollow()));
  });
  it('rejects extra fields (field whitelist)', async () => {
    await seedList('l2');
    await assertFails(setDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'l2'), { ...validListFollow(), spam: 1 }));
  });
  it('non-owner cannot write to another user\'s listFollows', async () => {
    await seedList('l3');
    await assertFails(setDoc(doc(otherDb(), 'users', OWNER, 'listFollows', 'l3'), validListFollow()));
  });
  it('unauthenticated cannot follow', async () => {
    await seedList('l4');
    await assertFails(setDoc(doc(anonDb(), 'users', OWNER, 'listFollows', 'l4'), validListFollow()));
  });
  it('owner can unfollow (delete)', async () => {
    await seedList('l5');
    await setDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'l5'), validListFollow());
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'l5')));
  });
  it('non-owner cannot unfollow another user\'s follow', async () => {
    await seedList('l6');
    await setDoc(doc(ownerDb(), 'users', OWNER, 'listFollows', 'l6'), validListFollow());
    await assertFails(deleteDoc(doc(otherDb(), 'users', OWNER, 'listFollows', 'l6')));
  });
});

// BIN-104: community rating aggregate — public read, Admin-only write.
describe('titleRatingsAggregate/{titleId} (BIN-104)', () => {
  it('is publicly readable (Binge-snitt på titelsidor)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'titleRatingsAggregate', 'movie_603'), { count: 10, sum: 80 });
    });
    await assertSucceeds(getDoc(doc(anonDb(), 'titleRatingsAggregate', 'movie_603')));
  });
  it('cannot be written by clients (no vote-stuffing)', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'titleRatingsAggregate', 'movie_603'), { count: 1, sum: 8 }));
    await assertFails(setDoc(doc(anonDb(), 'titleRatingsAggregate', 'tv_1399'), { count: 1, sum: 8 }));
  });
});

// BIN-180: price history — public read, function-only write (Admin SDK).
describe('priceHistory/{tmdbId} (BIN-180)', () => {
  it('is publicly readable (price graph på titelsidor)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'priceHistory', '603'), { tmdbId: 603, points: [{ at: 1, amount: 49, currency: 'SEK' }] });
    });
    await assertSucceeds(getDoc(doc(anonDb(), 'priceHistory', '603')));
  });
  it('cannot be written by clients (cron-only history asset)', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'priceHistory', '603'), { points: [] }));
    await assertFails(setDoc(doc(anonDb(), 'priceHistory', '1399'), { points: [] }));
  });
});

// BIN-184: Hushåll — opt-in delade prenumerationsbidrag. Self-write med hård
// form/storleks-validering, share-to-see-reciprocitet på läs (ADR 0010),
// delete av self eller ägare. Varje deny paras med en positiv tvilling
// (samma disciplin som BIN-276-sviten).
describe('groups household — opt-in delade kostnadsdata (BIN-184)', () => {
  const MEMBER = 'member_uid';
  function memberDb() { return testEnv.authenticatedContext(MEMBER).firestore(); }

  function validContent() {
    return {
      providerIds: [8, 337],
      providerCosts: { 8: 169, 337: 109 },
      providerCampaigns: { 8: { monthlyCost: 29, endDate: '2026-10-01' } },
      activeProviderIds: [8],
      updatedAt: serverTimestamp(),
    };
  }

  async function seedContribution(uid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'groups', GROUP, 'household', uid), {
        providerIds: [], providerCosts: {}, providerCampaigns: {},
        activeProviderIds: [], updatedAt: serverTimestamp(),
      });
    });
  }

  it('a member can opt in — create own contribution with the exact shape', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertSucceeds(setDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER), validContent()));
  });

  it("a member cannot write ANOTHER member's contribution", async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertFails(setDoc(doc(ownerDb(), 'groups', GROUP, 'household', MEMBER), validContent()));
  });

  it('a non-member can neither create nor read a contribution', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await seedContribution(OWNER);
    await assertFails(setDoc(doc(otherDb(), 'groups', GROUP, 'household', 'other_uid'), validContent()));
    await assertFails(getDoc(doc(otherDb(), 'groups', GROUP, 'household', OWNER)));
  });

  it('an extra field is rejected (hasOnly whitelist)', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertFails(setDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER), {
      ...validContent(), tierNames: { 8: 'premium' },
    }));
  });

  it('a missing field is rejected (hasAll — full shape required)', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    const partial: Record<string, unknown> = { ...validContent() };
    delete partial.providerCampaigns;
    await assertFails(setDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER), partial));
  });

  it('a forged (non-server) updatedAt is rejected — åldersstämpeln kan inte fejkas', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertFails(setDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER), {
      ...validContent(), updatedAt: new Date('2099-01-01'),
    }));
  });

  it('an oversized providerIds list (101) is rejected — attacker-sized docs stoppas', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertFails(setDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER), {
      ...validContent(), providerIds: Array.from({ length: 101 }, (_, i) => i),
    }));
  });

  it("share-to-see: a member WITH own contribution can read another's", async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await seedContribution(OWNER);
    await seedContribution(MEMBER);
    await assertSucceeds(getDoc(doc(memberDb(), 'groups', GROUP, 'household', OWNER)));
  });

  it('share-to-see: a member WITHOUT own contribution cannot read others (reciprocity)', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await seedContribution(OWNER);
    await assertFails(getDoc(doc(memberDb(), 'groups', GROUP, 'household', OWNER)));
  });

  it("a departed member cannot read OTHERS' household docs, but can still GET their own stale one", async () => {
    await seedGroup({ memberUids: [OWNER] }); // MEMBER already removed
    await seedContribution(OWNER);
    await seedContribution(MEMBER); // stale leftover
    await assertFails(getDoc(doc(memberDb(), 'groups', GROUP, 'household', OWNER)));
    // Own doc stays self-GET-able post-departure (export + self-cleanup path).
    await assertSucceeds(getDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER)));
  });

  it('a member who has NOT opted in can GET their own MISSING doc (exists=false, never denied)', async () => {
    // GDPR-flödena (export/radering) läser eget doc per grupp — ett nekande här
    // kraschade hela exporten (xhigh-review 2026-07-05). Rules är inte filter.
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await assertSucceeds(getDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER)));
  });

  it('LIST stays share-to-see: a non-sharing member cannot list; a sharing member can', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await seedContribution(OWNER);
    await assertFails(getDocs(collection(memberDb(), 'groups', GROUP, 'household')));
    await seedContribution(MEMBER);
    await assertSucceeds(getDocs(collection(memberDb(), 'groups', GROUP, 'household')));
  });

  it('self-delete (opt-out) and owner-delete (removeMember-städning) both succeed', async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await seedContribution(MEMBER);
    await assertSucceeds(deleteDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER)));
    await seedContribution(MEMBER);
    await assertSucceeds(deleteDoc(doc(ownerDb(), 'groups', GROUP, 'household', MEMBER)));
  });

  it("a non-owner member cannot delete someone else's contribution", async () => {
    await seedGroup({ memberUids: [OWNER, MEMBER] });
    await seedContribution(OWNER);
    await assertFails(deleteDoc(doc(memberDb(), 'groups', GROUP, 'household', OWNER)));
  });

  it('a departed member can still self-delete their leftover doc (orphan-städning)', async () => {
    await seedGroup({ memberUids: [OWNER] });
    await seedContribution(MEMBER);
    await assertSucceeds(deleteDoc(doc(memberDb(), 'groups', GROUP, 'household', MEMBER)));
  });
});
