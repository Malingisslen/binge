import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';

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

describe('users/{uid}/watchlist/{id} field whitelist', () => {
  it('allows a valid watchlist write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
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
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
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
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { runtime: 136 }, { merge: true }));
  });
  // BIN-349: ratedAt must be whitelisted AND type-bound to a timestamp.
  it('allows a ratedAt timestamp merge write (BIN-349)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { ratedAt: serverTimestamp() }, { merge: true }));
  });
  it('rejects a non-timestamp ratedAt (type bound, BIN-349)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { ratedAt: 'igår' }, { merge: true }));
  });
  // BIN-402: the monthly TMDB-ToS sweep stamps `tmdbFieldsRefreshedAt` (Admin SDK,
  // bypasses rules) onto real watchlist docs. Because a merge-write is evaluated
  // against the FULL post-merge doc, an unlisted key would make the VERY NEXT
  // ordinary client write (rating a movie, etc.) fail hasOnly → permission-denied
  // on an unrelated action. Seed a post-sweep doc, then assert a normal owner
  // merge-write that doesn't touch the stamp still succeeds.
  it('allows a normal merge write on a post-sweep doc holding tmdbFieldsRefreshedAt (BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, { ...validWatchlist(), tmdbFieldsRefreshedAt: serverTimestamp() });
    await assertSucceeds(setDoc(ref, { rating: 4.5, updatedAt: serverTimestamp() }, { merge: true }));
  });
  it('allows a tmdbFieldsRefreshedAt timestamp merge write (BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, { tmdbFieldsRefreshedAt: serverTimestamp() }, { merge: true }));
  });
  it('rejects a non-timestamp tmdbFieldsRefreshedAt (type bound, BIN-402)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertFails(setDoc(ref, { tmdbFieldsRefreshedAt: 'igår' }, { merge: true }));
  });
});

// Instant week (2026-07): nextAirReadRepair merge-writes the denormalized
// next-air field group. Mirrors the BIN-93 runtime-backfill precedent: the
// fields must be whitelisted or every silent read-repair write is rejected.
describe('users/{uid}/watchlist/{id} next-air read-repair fields', () => {
  it('allows a next-air-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: '2026-07-09', nextAirCode: 'S2E03', nextAirProvider: 'HBO Max',
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows a digitalReleaseDate-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, {
      digitalReleaseDate: '2026-08-01', nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows clearing next-air fields with nulls', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: null, nextAirCode: null, nextAirProvider: null,
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects an oversize nextAirProvider', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, {
      nextAirProvider: 'x'.repeat(81), nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects a non-timestamp nextAirUpdatedAt', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, { nextAirUpdatedAt: 'igår' }, { merge: true }));
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

// BIN-143: the rating VALUE must be bounded 0–10, not just the key set. An owner
// can write their own watchlist doc directly, and the value feeds the public
// community aggregate — an out-of-range write would deface every title page.
describe('users/{uid}/watchlist/{id} rating value bound (BIN-143)', () => {
  // Watchlist ratings are the 0.5–5 half-star scale (×2 → /10 on display), NOT
  // 0–10 like reviews. The bound is 0–5; anything above 5 would render >10/10.
  it('allows in-range half-star ratings (0.5, 2.5, 5) and null', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 0.5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 2.5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: 5 }));
    await assertSucceeds(setDoc(ref, { ...validWatchlist(), rating: null }));
  });
  it('rejects ratings above the 0.5–5 scale (community-aggregate poisoning)', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 500 }));
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 10 })); // old display-scale value now rejected
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: 5.5 }));
  });
  it('rejects a negative rating', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: -5 }));
  });
  it('rejects a non-numeric rating', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await assertFails(setDoc(ref, { ...validWatchlist(), rating: '5' as unknown as number }));
  });
  it('rejects an over-range rating slipped in via a merge update', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
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
});

// isOwner / uid-match guard — these assert that an accidental removal of the
// owner check (so anyone could write any user's data) is caught. Each doc-shape
// is a *valid* doc, so the only thing that can fail the write is the auth guard.
describe('owner guard — unauthenticated writes are rejected', () => {
  it('rejects an unauthenticated watchlist write', async () => {
    const ref = doc(anonDb(), 'users', OWNER, 'watchlist', '603');
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
    const ref = doc(otherDb(), 'users', OWNER, 'watchlist', '603');
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
    await assertSucceeds(setDoc(doc(ownerDb(), 'users', OWNER, 'watchlist', '603'), validWatchlist()));
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

// BIN-24 — Tillsammans participant uid anti-spoof. Anonymous participation stays
// allowed (uid null), but a signed-in writer may only set their OWN uid, and an
// anonymous writer may not carry a non-null uid (identity misattribution).
describe('sessions/{id}/participants — uid anti-spoof (BIN-24)', () => {
  function validParticipant(uid: string | null) {
    return {
      uid, displayName: 'Spelare', providers: [], vetoRemaining: 1,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
    };
  }
  it('signed-in user can create a participant carrying their own uid', async () => {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', 'p1'),
      validParticipant(OWNER),
    ));
  });
  it('signed-in user cannot spoof another uid', async () => {
    await assertFails(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', 'p1'),
      validParticipant('someone_else'),
    ));
  });
  it('anonymous user can create a participant with uid null', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', 'anon1'),
      validParticipant(null),
    ));
  });
  it('anonymous user cannot carry a non-null uid', async () => {
    await assertFails(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', 'anon1'),
      validParticipant(OWNER),
    ));
  });
  it('a different signed-in user cannot update another participant doc', async () => {
    // OWNER creates their participant (uid=OWNER); other_uid then tries to touch
    // it. The merged doc's uid stays OWNER ≠ other_uid → guard denies (exercises
    // the UPDATE branch + the cross-participant-write block).
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', 'p1'),
      validParticipant(OWNER),
    ));
    await assertFails(updateDoc(
      doc(otherDb(), 'sessions', 's1', 'participants', 'p1'),
      { lastActiveAt: serverTimestamp() },
    ));
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
