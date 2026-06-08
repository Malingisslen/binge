import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'binge-rules-test';
const OWNER = 'owner_uid';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
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
