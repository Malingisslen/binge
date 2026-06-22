import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';

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
