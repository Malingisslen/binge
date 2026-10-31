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
  it('cannot delete its own row (only the owner can disconnect)', async () => {
    await assertFails(deleteDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`)));
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

describe('TV is not a signed-in user (isSignedIn excludes tv)', () => {
  it('cannot read signed-in-only collections', async () => {
    await assertFails(getDoc(doc(tv(), 'publicGroups/g1')));
    await assertFails(getDocs(collection(tv(), 'publicGroups')));
  });
  it('control: a normal signed-in user may read publicGroups', async () => {
    await assertSucceeds(getDoc(doc(owner(), 'publicGroups/g1')));
  });
  it('cannot act as owner of its own tv_ uid (isOwner goes through isSignedIn)', async () => {
    await assertFails(setDoc(doc(tv(), `users/tv_${DEVICE}/watchlist/movie_603`), item()));
    await assertFails(setDoc(doc(tv(), `users/tv_${DEVICE}/notInterested/x`), { tmdbId: 1, mediaType: 'movie', addedAt: Timestamp.now() }));
  });
  it('cannot write episodeProgress under its own tv_ uid either', async () => {
    await assertFails(setDoc(doc(tv(), `users/tv_${DEVICE}/episodeProgress/tv_1`), { tmdbId: 1, seasons: {}, mediaType: 'tv' }));
  });
});

describe('TV watchlist update: allowed field set', () => {
  const ref = () => doc(tv(), `users/${OWNER}/watchlist/movie_603`);
  it('may change each listed progress field', async () => {
    await assertSucceeds(updateDoc(ref(), { lastWatchedSeason: 1, lastWatchedEpisode: 2 }));
    await assertSucceeds(updateDoc(ref(), { rewatchCount: 1 }));
    await assertSucceeds(updateDoc(ref(), { dropped: true }));
  });
  it('cannot touch fields outside the list even alongside a status change', async () => {
    await assertFails(updateDoc(ref(), { status: 'sedd', rating: 5 }));
    await assertFails(updateDoc(ref(), { status: 'sedd', providers: [1] }));
    await assertFails(updateDoc(ref(), { status: 'sedd', addedAt: serverTimestamp() }));
  });
  it('accepts each of the four statuses and rejects a near-miss', async () => {
    for (const s of ['vill_se', 'mina', 'sedd', 'avbruten']) await assertSucceeds(updateDoc(ref(), { status: s }));
    await assertFails(updateDoc(ref(), { status: 'Sedd' }));
  });
  it('cannot update a title that does not exist (no create by update-merge)', async () => {
    await assertFails(setDoc(doc(tv(), `users/${OWNER}/watchlist/movie_9`), { status: 'sedd' }, { merge: true }));
  });
});

describe('TV episodeProgress', () => {
  const path = `users/${OWNER}/episodeProgress/tv_1399`;
  const prog = { tmdbId: 1399, seasons: { 1: [1, 2] }, mediaType: 'tv' };
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), path), prog); });
  });
  it('may read and write the owners progress with the allowed keys', async () => {
    await assertSucceeds(getDoc(doc(tv(), path)));
    await assertSucceeds(setDoc(doc(tv(), path), { ...prog, seasons: { 1: [1, 2, 3] } }));
  });
  it('cannot add keys or delete', async () => {
    await assertFails(setDoc(doc(tv(), path), { ...prog, extra: 1 }));
    await assertFails(deleteDoc(doc(tv(), path)));
  });
  it('another owner is denied both read and write', async () => {
    await assertFails(getDoc(doc(tv('someone_else'), path)));
    await assertFails(setDoc(doc(tv('someone_else'), path), prog));
  });
  it('is denied straight away after the device row is deleted', async () => {
    const t = tv();
    await assertSucceeds(deleteDoc(doc(owner(), `users/${OWNER}/tvDevices/${DEVICE}`)));
    await assertFails(getDoc(doc(t, path)));
    await assertFails(setDoc(doc(t, path), prog));
  });
});

describe('TV lastSeenAt gate', () => {
  const HOUR = 3600_000;
  const seed = (id: string, ageH: number) => testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${OWNER}/tvDevices/${id}`), { name: 'x', createdAt: Timestamp.now(), lastSeenAt: Timestamp.fromMillis(Date.now() - ageH * HOUR) });
  });
  it('is refused at 19 hours and allowed at 21 hours', async () => {
    await seed(DEVICE, 19);
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`), { lastSeenAt: serverTimestamp() }));
    await seed(DEVICE, 21);
    await assertSucceeds(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`), { lastSeenAt: serverTimestamp() }));
  });
  it('cannot write a lastSeenAt in the future', async () => {
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/${DEVICE}`), { lastSeenAt: Timestamp.fromMillis(Date.now() + 2 * HOUR) }));
  });
  it('cannot touch a sibling device row that is old enough', async () => {
    await seed('other', 48);
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/tvDevices/other`), { lastSeenAt: serverTimestamp() }));
  });
  it('a TV bound to an owner without that device row is denied', async () => {
    await assertFails(getDoc(doc(tv('someone_else'), `users/someone_else/tvDevices/${DEVICE}`)));
    await assertFails(getDocs(collection(tv('someone_else'), 'users/someone_else/watchlist')));
  });
});

describe('isTvOf needs the tv claim itself', () => {
  it('a non-tv user carrying ownerUid and tvDeviceId claims is denied', async () => {
    const fake = testEnv.authenticatedContext('stranger', { ownerUid: OWNER, tvDeviceId: DEVICE }).firestore();
    await assertFails(getDoc(doc(fake, `users/${OWNER}/watchlist/movie_603`)));
    await assertFails(updateDoc(doc(fake, `users/${OWNER}/watchlist/movie_603`), { status: 'sedd' }));
    const falseClaim = testEnv.authenticatedContext('stranger', { tv: false, ownerUid: OWNER, tvDeviceId: DEVICE }).firestore();
    await assertFails(getDoc(doc(falseClaim, `users/${OWNER}/watchlist/movie_603`)));
  });
});

describe('TV watchlist update keeps the whole-document validity check', () => {
  it('is refused on a legacy doc that already fails isValidWatchlistItem (same as the owner path)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/watchlist/movie_77`), { ...item(), tmdbId: 77, rating: 9 });
    });
    await assertFails(updateDoc(doc(tv(), `users/${OWNER}/watchlist/movie_77`), { status: 'sedd' }));
  });
});

describe('owner cannot edit a tvDevices row', () => {
  it('only read and delete are open to the owner; update is closed', async () => {
    await assertFails(updateDoc(doc(owner(), `users/${OWNER}/tvDevices/${DEVICE}`), { name: 'renamed' }));
    await assertFails(updateDoc(doc(owner(), `users/${OWNER}/tvDevices/${DEVICE}`), { lastSeenAt: serverTimestamp() }));
  });
});
