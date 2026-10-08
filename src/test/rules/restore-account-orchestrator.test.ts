import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where,
  type Firestore,
} from 'firebase/firestore';

import { runRestore, optionsFrom, OWNED_SUBCOLLECTIONS, RELATION_SUBCOLLECTIONS, NEVER_COPIED_SUBCOLLECTIONS } from '../../../functions/scripts/restore-account.helpers.mjs';

/**
 * BIN-1422 del 2 — the account-restore loop against a real Firestore emulator.
 *
 * What it proves: given a source copy and a live target, which documents land where, that
 * the other person's mirror is written, that a blocked or vanished counterpart is skipped,
 * that consent is not carried over, and that a rerun after an interruption finishes the job
 * without overwriting anything.
 *
 * How: the two databases are two emulator PROJECTS, since the client SDK cannot open a
 * named database here. The loop is the real one; only its port is the client SDK instead
 * of the Admin SDK. Permissive rules on purpose, as in the other orchestrator suites: the
 * script runs on the Admin SDK, which bypasses rules.
 *
 * NOT proven here: the Admin port itself (listing subcollections, `create()`'s
 * ALREADY_EXISTS code, Auth). Subcollection listing is stood in for by probing the decided
 * names, so the unknown-subcollection refusal is proven only by the unit suite next to the
 * helpers. A live rehearsal against restored databases is a RUNBOOK §5b step.
 */

const OPEN_RULES = `
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

let sourceEnv: RulesTestEnvironment;
let targetEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  sourceEnv = await initializeTestEnvironment({
    projectId: 'binge-restore-source-test',
    firestore: { rules: OPEN_RULES, host, port: Number(port) },
  });
  targetEnv = await initializeTestEnvironment({
    projectId: 'binge-restore-target-test',
    firestore: { rules: OPEN_RULES, host, port: Number(port) },
  });
});
afterAll(async () => {
  await sourceEnv.cleanup();
  await targetEnv.cleanup();
});
beforeEach(async () => {
  await sourceEnv.clearFirestore();
  await targetEnv.clearFirestore();
});

const src = () => sourceEnv.unauthenticatedContext().firestore() as unknown as Firestore;
const dst = () => targetEnv.unauthenticatedContext().firestore() as unknown as Firestore;

type Created = 'created' | 'existed';

function clientIo(opts: { failCreateAfter?: number } = {}) {
  const s = src();
  const t = dst();
  const authUsers = new Map<string, string>();
  let creates = 0;
  const read = (d: Firestore) => async (path: string) => {
    const snap = await getDoc(doc(d, path));
    return snap.exists() ? snap.data() : null;
  };
  return {
    authUsers,
    io: {
      log: () => {},
      serverTimestamp: () => serverTimestamp(),
      source: {
        get: read(s),
        list: async (path: string) =>
          (await getDocs(collection(s, path))).docs.map(d => ({ id: d.id, data: d.data() })),
        listSubcollections: async (path: string) => {
          const names = [...OWNED_SUBCOLLECTIONS, ...RELATION_SUBCOLLECTIONS, ...NEVER_COPIED_SUBCOLLECTIONS] as string[];
          const found: string[] = [];
          for (const name of names) {
            if (!(await getDocs(collection(s, `${path}/${name}`))).empty) found.push(name);
          }
          return found;
        },
      },
      target: {
        get: read(t),
        // Not atomic like the Admin `create()`: a read then a write. Nothing else writes to
        // the emulator during a test, so the decision it makes is the same.
        create: async (path: string, data: Record<string, unknown>): Promise<Created> => {
          creates += 1;
          if (opts.failCreateAfter !== undefined && creates > opts.failCreateAfter) {
            throw new Error('simulated interruption');
          }
          if ((await getDoc(doc(t, path))).exists()) return 'existed';
          await setDoc(doc(t, path), data);
          return 'created';
        },
        merge: (path: string, data: Record<string, unknown>) => setDoc(doc(t, path), data, { merge: true }),
        delete: (path: string) => deleteDoc(doc(t, path)),
        listExpired: async (c: string, now: Date) =>
          (await getDocs(query(collection(t, c), where('expireAt', '<', now)))).docs.map(d => d.ref.path),
      },
      auth: {
        getUidByEmail: async (email: string) => {
          for (const [uid, e] of authUsers) if (e === email) return uid;
          return null;
        },
        ensureUser: async ({ uid, email }: { uid: string; email: string }): Promise<Created> => {
          if (authUsers.has(uid)) return 'existed';
          authUsers.set(uid, email);
          return 'created';
        },
      },
    },
  };
}

const ARGV = [
  '--project', 'binge-test', '--source-db', 'restore-copy', '--uid', 'anna',
  '--basis', 'owner-request', '--requested-by', 'anna@example.se',
  '--evidence', 'mejl', '--reason', 'raderade av misstag', '--operator', 'malin',
  '--apply', '--i-understand-default',
];
const OPTS = optionsFrom(ARGV);
const SINCE = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

/** A source copy where Anna still exists, with one friend, one follow each way, and noise. */
async function seedSource() {
  const s = src();
  await setDoc(doc(s, 'users/anna'), {
    displayName: 'Anna', email: 'anna@example.se', username: 'anna', bio: 'hej',
    providerCosts: { 8: 99 }, isAdmin: true,
    termsAcceptedAt: SINCE, ageConfirmedAt: SINCE, termsVersion: '2026-01',
  });
  await setDoc(doc(s, 'users/anna/watchlist/movie_1'), { status: 'sedd', tmdbId: 1 });
  await setDoc(doc(s, 'users/anna/episodeProgress/tv_2'), { lastWatchedSeason: 1 });
  await setDoc(doc(s, 'users/anna/watchlistNotes/1'), { text: 'bra' });
  await setDoc(doc(s, 'users/anna/fcmTokens/t1'), { token: 'old-device' });
  await setDoc(doc(s, 'users/anna/notifications/n1'), { kind: 'system' });
  await setDoc(doc(s, 'users/anna/friendRequests/someone'), { fromUid: 'someone' });
  await setDoc(doc(s, 'publicProfiles/anna'), { displayName: 'Anna', username: 'anna', email: 'anna@example.se' });

  // Bertil: friends both ways in the copy.
  await setDoc(doc(s, 'users/anna/friends/bertil'), { uid: 'bertil', since: SINCE });
  await setDoc(doc(s, 'users/bertil/friends/anna'), { uid: 'anna', since: SINCE, stray: 1 });
  // Cecilia: Anna follows her.
  await setDoc(doc(s, 'users/anna/following/cecilia'), { followedAt: SINCE });
  await setDoc(doc(s, 'users/cecilia/followers/anna'), { followedAt: SINCE });
  // David: follows Anna, but has since blocked her in the live database.
  await setDoc(doc(s, 'users/anna/followers/david'), { followedAt: SINCE });
  await setDoc(doc(s, 'users/david/following/anna'), { followedAt: SINCE });
  // Erik: a friend whose account is gone from the live database.
  await setDoc(doc(s, 'users/anna/friends/erik'), { uid: 'erik', since: SINCE });
  await setDoc(doc(s, 'users/erik/friends/anna'), { uid: 'anna', since: SINCE });
  // Gustav: follows Anna, both halves in the copy.
  await setDoc(doc(s, 'users/anna/followers/gustav'), { followedAt: SINCE });
  await setDoc(doc(s, 'users/gustav/following/anna'), { followedAt: SINCE });
  // Frida: only half a pair in the copy.
  await setDoc(doc(s, 'users/anna/following/frida'), { followedAt: SINCE });
}

async function seedTarget() {
  const t = dst();
  for (const uid of ['bertil', 'cecilia', 'david', 'frida', 'gustav']) {
    await setDoc(doc(t, `users/${uid}`), { displayName: uid, email: `${uid}@example.se` });
  }
  await setDoc(doc(t, 'users/david/blocked/anna'), { blockedAt: SINCE });
}

const exists = async (path: string) => (await getDoc(doc(dst(), path))).exists();
const data = async (path: string) => (await getDoc(doc(dst(), path))).data();

describe('restore — the account comes back from the copy (BIN-1422 del 2)', () => {
  it('copies the person\'s own data and leaves server state and pending requests behind', async () => {
    await seedSource();
    await seedTarget();
    const { io, authUsers } = clientIo();

    const report = await runRestore(io, OPTS);

    expect(report.ok).toBe(true);
    expect(await data('users/anna/watchlist/movie_1')).toEqual({ status: 'sedd', tmdbId: 1 });
    expect(await exists('users/anna/episodeProgress/tv_2')).toBe(true);
    expect(await exists('users/anna/watchlistNotes/1')).toBe(true);
    // World-readable: only the keys isValidPublicProfile allows come back.
    expect(await data('publicProfiles/anna')).toEqual({ displayName: 'Anna', username: 'anna' });
    expect(await data('usernames/anna')).toMatchObject({ uid: 'anna' });
    expect(await exists('users/anna/fcmTokens/t1')).toBe(false);
    expect(await exists('users/anna/notifications/n1')).toBe(false);
    expect(await exists('users/anna/friendRequests/someone')).toBe(false);
    expect(authUsers.get('anna')).toBe('anna@example.se');
  });

  it('brings the profile back without consent stamps or admin rights, marked as restored (decision 2)', async () => {
    await seedSource();
    await seedTarget();
    const { io } = clientIo();

    await runRestore(io, OPTS);

    const profile = await data('users/anna');
    expect(profile).toMatchObject({ displayName: 'Anna', username: 'anna', providerCosts: { 8: 99 }, restoreBasis: 'owner-request', restoreRequestedBy: 'anna@example.se', restoreSourceDb: 'restore-copy' });
    expect(profile?.restoredAt).toBeInstanceOf(Timestamp);
    for (const key of ['termsAcceptedAt', 'ageConfirmedAt', 'termsVersion', 'isAdmin']) {
      expect(profile, key).not.toHaveProperty(key);
    }
  });

  it('writes the relation on both sides with the keys firestore.rules lists (shape only, rules not evaluated here), and notifies the other person (decision 4)', async () => {
    await seedSource();
    await seedTarget();
    const { io } = clientIo();

    expect((await runRestore(io, OPTS)).ok).toBe(true);

    expect(await data('users/anna/friends/bertil')).toEqual({ uid: 'bertil', since: SINCE });
    expect(await data('users/bertil/friends/anna')).toEqual({ uid: 'anna', since: SINCE });
    expect(await data('users/anna/following/cecilia')).toEqual({ followedAt: SINCE });
    expect(await data('users/cecilia/followers/anna')).toEqual({ followedAt: SINCE });
    expect(await data('users/anna/followers/gustav')).toEqual({ followedAt: SINCE });
    expect(await data('users/gustav/following/anna')).toEqual({ followedAt: SINCE });

    const note = await data('users/bertil/notifications/restored-anna');
    expect(note).toMatchObject({ kind: 'system', title: 'Anna är tillbaka på Binge', actionUrl: '/user/anna/', read: false });
    expect(note?.createdAt).toBeInstanceOf(Timestamp);
    expect(await exists('users/cecilia/notifications/restored-anna')).toBe(true);
  });

  it('skips a relation when either side blocked the other, the other account is gone, or the copy has only half of it', async () => {
    await seedSource();
    await seedTarget();
    const { io } = clientIo();

    const report = await runRestore(io, OPTS);

    expect(report.skipped).toEqual({ unpaired: 1, counterpartGone: 1, blocked: 1 });
    // David blocked Anna: neither side, and no notification.
    expect(await exists('users/anna/followers/david')).toBe(false);
    expect(await exists('users/david/following/anna')).toBe(false);
    expect(await exists('users/david/notifications/restored-anna')).toBe(false);
    // Erik is gone: nothing is written under his uid.
    expect(await exists('users/anna/friends/erik')).toBe(false);
    expect(await exists('users/erik/friends/anna')).toBe(false);
    // Frida was half a pair.
    expect(await exists('users/anna/following/frida')).toBe(false);
    expect(await exists('users/frida/followers/anna')).toBe(false);
  });

  it('a block Anna herself had in the copy also stops the relation', async () => {
    await seedSource();
    await seedTarget();
    await setDoc(doc(src(), 'users/anna/blocked/bertil'), { blockedAt: SINCE });
    const { io } = clientIo();

    await runRestore(io, OPTS);

    expect(await exists('users/bertil/friends/anna')).toBe(false);
    expect(await exists('users/anna/blocked/bertil')).toBe(true);
  });

  it('writes the log outside users/, with counterparts as uids only and an expiry a year out', async () => {
    await seedSource();
    await seedTarget();
    const { io } = clientIo();
    const now = new Date('2026-10-07T12:00:00Z');

    const report = await runRestore(io, OPTS, now);

    const log = await data(`restoreLog/${report.runId}`);
    expect(log).toMatchObject({
      uid: 'anna', basis: 'owner-request', requestedBy: 'anna@example.se', evidence: 'mejl',
      reason: 'raderade av misstag', operator: 'malin', sourceDb: 'restore-copy',
      counterpartUids: ['bertil', 'cecilia', 'gustav'],
    });
    expect(log?.finishedAt).toBeInstanceOf(Timestamp);
    // Uids and counts only: no one else's name or address goes into the log.
    expect(JSON.stringify(log)).not.toMatch(/Bertil|bertil@|cecilia@|displayName|email/);
    expect((log?.expireAt as Timestamp).toDate().toISOString()).toBe('2027-10-07T12:00:00.000Z');
  });

  it('an interrupted run finishes on a rerun the same day, and overwrites nothing', async () => {
    await seedSource();
    await seedTarget();
    const first = clientIo({ failCreateAfter: 3 });
    await expect(runRestore(first.io, OPTS)).rejects.toThrow('simulated interruption');
    // The profile is written last, so the account is not usable halfway.
    expect(await exists('users/anna')).toBe(false);

    // Something the person did not get back yet must not be overwritten when it is there.
    await setDoc(doc(dst(), 'users/anna/watchlist/movie_1'), { status: 'sedd', tmdbId: 1, note: 'already here' });

    const second = clientIo();
    second.authUsers.set('anna', 'anna@example.se');
    const report = await runRestore(second.io, OPTS);

    expect(report.ok).toBe(true);
    expect(report.tally?.existed).toBeGreaterThan(0);
    expect(await data('users/anna/watchlist/movie_1')).toMatchObject({ note: 'already here' });
    expect(await exists('users/anna')).toBe(true);
    expect(await exists('users/bertil/friends/anna')).toBe(true);
  });

  it('a third run after a finished one is refused and changes nothing', async () => {
    await seedSource();
    await seedTarget();
    const { io } = clientIo();
    await runRestore(io, OPTS);
    const before = await data('users/anna');

    const again = await runRestore(clientIo().io, OPTS);

    expect(again.ok).toBe(false);
    expect(await data('users/anna')).toEqual(before);
  });
});
