import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';

// BIN-1471: en TV loggar in som tv_<enhet> med claims {tv, ownerUid, tvDeviceId}.
// Den ska nekas allt utom det som uttryckligen släpps in, och nekas direkt när
// enhetens rad i tvDevices är borta.
const OWNER = 'owner_uid';
const DEVICE = 'dev1';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-binge-tv',
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${OWNER}/tvDevices/${DEVICE}`), { name: 'Google TV', createdAt: Timestamp.now(), lastSeenAt: Timestamp.fromMillis(Date.now() - 48 * 3600_000) });
    await setDoc(doc(db, `users/${OWNER}/watchlist/movie_603`), item());
    await setDoc(doc(db, `users/${OWNER}/profileProbe/x`), { a: 1 });
    await setDoc(doc(db, `users/${OWNER}`), { email: 'a@b.se', isAdmin: true });
  });
});

function item() {
  return {
    tmdbId: 603, mediaType: 'movie', status: 'vill_se', rating: null, notes: null, title: 'The Matrix',
    posterPath: null, releaseYear: 1999, totalSeasons: null, lastWatchedSeason: null, lastWatchedEpisode: null,
    dropped: false, rewatchCount: 0, providers: [8], providersCheckedAt: null, visibility: null, genreIds: [28],
    tmdbStatus: null, effectiveVisibility: 'private', isPublic: false, addedAt: Timestamp.now(), updatedAt: Timestamp.now(), watchedAt: null,
  };
}
const tv = (owner = OWNER, device = DEVICE) =>
  testEnv.authenticatedContext(`tv_${device}`, { tv: true, ownerUid: owner, tvDeviceId: device }).firestore();
const owner = () => testEnv.authenticatedContext(OWNER).firestore();

describe('TV reads', () => {
  it('may read the owner watchlist', async () => {
    await assertSucceeds(getDoc(doc(tv(), `users/${OWNER}/watchlist/movie_603`)));
    await assertSucceeds(getDocs(collection(tv(), `users/${OWNER}/watchlist`)));
  });
  it('may read its own device row, not a sibling', async () => {
    await assertSucceeds(getDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`)));
    await assertFails(getDoc(doc(tv(), `users/${OWNER}/tvDevices/other`)));
  });
  it('cannot list the device collection', async () => {
    await assertFails(getDocs(collection(tv(), `users/${OWNER}/tvDevices`)));
  });
  it('is denied the profile, which holds email and admin flag', async () => {
    await assertFails(getDoc(doc(tv(), `users/${OWNER}`)));
  });
  it('is denied another users watchlist even with the same device id', async () => {
    await assertFails(getDoc(doc(tv('someone_else'), `users/${OWNER}/watchlist/movie_603`)));
  });
});

describe('TV writes', () => {
  it('may change status on an existing title', async () => {
    await assertSucceeds(updateDoc(doc(tv(), `users/${OWNER}/watchlist/movie_603`), { status: 'sedd', watchedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  });
  it('cannot change other fields (rating, visibility, title)', async () => {
    const ref = doc(tv(), `users/${OWNER}/watchlist/movie_603`);
    await assertFails(updateDoc(ref, { rating: 5 }));
    await assertFails(updateDoc(ref, { effectiveVisibility: 'public' }));
    await assertFails(updateDoc(ref, { title: 'x' }));
  });
  it('cannot set an invalid status', async () => {
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/watchlist/movie_603`), { status: 'admin' }));
  });
  it('cannot create or delete titles', async () => {
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/watchlist/movie_1`), { ...item(), tmdbId: 1 }));
    await assertFails(deleteDoc(doc(tv(), `users/${OWNER}/watchlist/movie_603`)));
  });
  it('cannot write the profile, friends, or a new tvDevices row', async () => {
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}`), { isAdmin: true }));
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/friends/x`), { a: 1 }));
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/tvDevices/new`), { name: 'x' }));
    await assertFails(deleteDoc(doc(tv(), `users/${OWNER}`)));
  });
  it('may write lastSeenAt once it is older than 20 hours, and nothing else on the row', async () => {
    const ref = doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`);
    await assertFails(updateDoc(ref, { name: 'renamed' }));
    await assertSucceeds(updateDoc(ref, { lastSeenAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { lastSeenAt: serverTimestamp() })); // just written
  });
  it('cannot set lastSeenAt in the future or backwards', async () => {
    const ref = doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`);
    await assertFails(updateDoc(ref, { lastSeenAt: Timestamp.fromMillis(Date.now() + 86_400_000) }));
    await assertFails(updateDoc(ref, { lastSeenAt: Timestamp.fromMillis(1) }));
  });
  it('cannot touch a sibling device row, even an old one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/tvDevices/other`), { name: 'x', createdAt: Timestamp.now(), lastSeenAt: Timestamp.fromMillis(Date.now() - 48 * 3600_000) });
    });
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/other`), { lastSeenAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`), { lastSeenAt: serverTimestamp() }));
  });
  it('cannot delete its own row (only the owner can disconnect)', async () => {
    await assertFails(deleteDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`)));
  });
});

describe('TV is denied everything the plan does not list', () => {
  it('episodeProgress: readable, never writable', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/episodeProgress/tv_1`), { tmdbId: 1, seasons: {}, mediaType: 'tv' });
    });
    await assertSucceeds(getDoc(doc(tv(), `users/${OWNER}/episodeProgress/tv_1`)));
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/episodeProgress/tv_1`), { tmdbId: 1, seasons: {}, mediaType: 'tv' }));
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/episodeProgress/tv_2`), { tmdbId: 2, seasons: {}, mediaType: 'tv' }));
  });
  it('friends, settings, notes and friend requests: no reads', async () => {
    await assertFails(getDoc(doc(tv(), `users/${OWNER}/friends/x`)));
    await assertFails(getDocs(collection(tv(), `users/${OWNER}/friends`)));
    await assertFails(getDoc(doc(tv(), `users/${OWNER}/settings/x`)));
    await assertFails(getDoc(doc(tv(), `users/${OWNER}/watchlistNotes/movie_603`)));
    await assertFails(getDoc(doc(tv(), `users/${OWNER}/friendRequests/x`)));
  });
  it('household and admin reports: no reads or writes', async () => {
    await assertFails(getDoc(doc(tv(), `groups/g1/household/${OWNER}`)));
    await assertFails(setDoc(doc(tv(), `groups/g1/household/${OWNER}`), { a: 1 }));
    await assertFails(getDoc(doc(tv(), 'reports/x')));
    await assertFails(updateDoc(doc(tv(), 'reports/x'), { status: 'done' }));
  });
  it('a TV with its own live row at another owner is still denied at this owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/other/tvDevices/${DEVICE}`), { name: 'x', createdAt: Timestamp.now(), lastSeenAt: Timestamp.now() });
    });
    await assertSucceeds(getDoc(doc(tv('other'), `users/other/tvDevices/${DEVICE}`)));
    await assertFails(getDoc(doc(tv('other'), `users/${OWNER}/watchlist/movie_603`)));
  });
});

describe('public paths a signed-in user may use', () => {
  it('are closed to a TV (isSignedIn excludes tv)', async () => {
    await assertFails(setDoc(doc(tv(), 'reports/x'), { reporterUid: `tv_${DEVICE}` }));
    await assertFails(setDoc(doc(tv(), 'users/tv_dev1'), { displayName: 'x' }));
  });
});

describe('disconnecting', () => {
  it('denies the TV straight away when the owner deletes the row', async () => {
    const t = tv();
    await assertSucceeds(getDoc(doc(t, `users/${OWNER}/watchlist/movie_603`)));
    await assertSucceeds(deleteDoc(doc(owner(), `users/${OWNER}/tvDevices/${DEVICE}`)));
    await assertFails(getDoc(doc(t, `users/${OWNER}/watchlist/movie_603`)));
    await assertFails(updateDoc(doc(t, `users/${OWNER}/watchlist/movie_603`), { status: 'sedd' }));
  });
});

describe('owner and server-only collections', () => {
  it('owner lists and cannot create tvDevices rows (only the function can)', async () => {
    await assertSucceeds(getDocs(collection(owner(), `users/${OWNER}/tvDevices`)));
    await assertFails(setDoc(doc(owner(), `users/${OWNER}/tvDevices/mine`), { name: 'x' }));
  });
  it('tvPairings and tvRate are closed to every client', async () => {
    await assertFails(getDoc(doc(owner(), 'tvPairings/abc')));
    await assertFails(setDoc(doc(owner(), 'tvPairings/abc'), { status: 'approved', approvedBy: OWNER }));
    await assertFails(setDoc(doc(owner(), 'tvRate/abc'), { count: 0 }));
    await assertFails(getDoc(doc(tv(), 'tvPairings/abc')));
  });
  it('an unsigned user gets nothing', async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), `users/${OWNER}/tvDevices/${DEVICE}`)));
  });
});
