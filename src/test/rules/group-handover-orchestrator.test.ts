import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
  writeBatch, deleteField, arrayRemove, serverTimestamp, Timestamp,
  type Firestore,
} from 'firebase/firestore';

import { runGroupHandover, type HandoverIo } from '../../../functions/src/groupHandover/runHandover';

/**
 * BIN-1063 steg 3 — the group-handover ORCHESTRATOR against a real Firestore
 * emulator.
 *
 * The decision (`pickGroupSuccessor`, `buildHandoverUpdate`) is unit-tested next
 * to itself. This drives the loop around it: which groups it opens, what it
 * writes, what it leaves alone, and whether a retry is a no-op or a second
 * election.
 *
 * How it runs without firebase-admin, which the root toolchain cannot resolve:
 * the loop lives behind an injected `HandoverIo` port. Production implements it
 * with the Admin SDK; here the SAME port is implemented with the client SDK
 * against the emulator. The loop under test is the real one.
 *
 * The emulator runs with permissive rules on purpose — in production this runs
 * on the Admin SDK, which bypasses rules entirely. What the RULES permit a
 * client to do is `firestore-rules.test.ts`'s job, and the point
 * of the callable is precisely that the client may not do this write at all.
 *
 * NOT proven here: the transactional half of `claimOwnership`. The port's
 * contract says the ownership re-read and the write are one atomic unit, and the
 * Admin port implements that with `runTransaction`; this harness implements the
 * same check non-atomically, so it pins the DECISION the check makes, not its
 * atomicity. The Admin implementation carries that warning at the transaction.
 */

const PROJECT_ID = 'binge-group-handover-test';
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

function db(): Firestore {
  return testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
}

/** The port, implemented with the client SDK. One operation per method. */
function clientIo(): HandoverIo & { errors: unknown[] } {
  const d = db();
  const errors: unknown[] = [];
  return {
    errors,
    log: { info: () => {}, error: (_m, data) => { errors.push(data); } },

    ownedGroupIds: async (uid) => {
      const snap = await getDocs(query(collection(d, 'groups'), where('ownerUid', '==', uid)));
      return snap.docs.map((x) => x.id);
    },

    readGroup: async (groupId) => {
      const snap = await getDoc(doc(d, 'groups', groupId));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        ownerUid: (data.ownerUid as string | undefined) ?? '',
        memberUids: (data.memberUids as string[] | undefined) ?? [],
      };
    },

    readMembers: async (groupId) => {
      const snap = await getDocs(collection(d, 'groups', groupId, 'members'));
      return snap.docs.map((x) => {
        const raw = x.data().joinedAt;
        return { uid: x.id, joinedAtMs: raw instanceof Timestamp ? raw.toMillis() : null };
      });
    },

    readWatchlist: async (groupId) => {
      const snap = await getDocs(collection(d, 'groups', groupId, 'watchlist'));
      return snap.docs.map((x) => ({ id: x.id, addedBy: x.data().addedBy }));
    },

    readSessionHistory: async (groupId) => {
      const snap = await getDocs(collection(d, 'groups', groupId, 'sessionHistory'));
      return snap.docs.map((x) => ({
        id: x.id,
        pickedByUid: x.data().pickedByUid,
        participantUids: (x.data().participantUids as string[] | undefined) ?? [],
      }));
    },

    claimOwnership: async (groupId, expectedOwnerUid, write) => {
      const ref = doc(d, 'groups', groupId);
      const fresh = await getDoc(ref);
      if (!fresh.exists() || fresh.data().ownerUid !== expectedOwnerUid) return false;
      await updateDoc(ref, {
        ownerUid: write.ownerUid,
        memberUids: write.memberUids,
        updatedAt: serverTimestamp(),
      });
      return true;
    },

    eraseMemberTraces: async (groupId, leavingUid, erasure) => {
      const batch = writeBatch(d);
      batch.delete(doc(d, 'groups', groupId, 'members', leavingUid));
      batch.delete(doc(d, 'groups', groupId, 'household', leavingUid));
      batch.delete(doc(d, 'groups', groupId, 'joinAttempts', leavingUid));
      for (const itemId of erasure.itemIds) {
        batch.delete(doc(d, 'groups', groupId, 'watchlist', itemId, 'progress', leavingUid));
      }
      for (const itemId of erasure.clearAddedByIds) {
        batch.update(doc(d, 'groups', groupId, 'watchlist', itemId), { addedBy: deleteField() });
      }
      for (const rowId of erasure.clearPickedByIds) {
        batch.update(doc(d, 'groups', groupId, 'sessionHistory', rowId), { pickedByUid: deleteField() });
      }
      for (const rowId of erasure.dropParticipantIds) {
        batch.update(doc(d, 'groups', groupId, 'sessionHistory', rowId), {
          participantUids: arrayRemove(leavingUid),
        });
      }
      await batch.commit();
    },
  };
}

const ts = (ms: number) => Timestamp.fromMillis(ms);

interface SeedMember {
  uid: string;
  /** Omit for a GHOST — in memberUids, no member row. */
  joinedAtMs?: number;
  household?: boolean;
}

async function seedGroup(opts: {
  id: string;
  ownerUid: string;
  members: SeedMember[];
  /** Watchlist rows, as id → the uid that added them. */
  items?: Record<string, string>;
  /** Which uids have a progress row under every item. */
  progressFor?: string[];
  /** Session-history rows, as id → the uid that picked them. */
  history?: Record<string, string>;
  /** Which uids have a joinAttempts row holding a plaintext token. */
  joinAttemptsFor?: string[];
}) {
  const d = db();
  await setDoc(doc(d, 'groups', opts.id), {
    ownerUid: opts.ownerUid,
    memberUids: opts.members.map((m) => m.uid),
    name: 'Gruppen',
    defaults: {},
  });
  for (const m of opts.members) {
    if (m.joinedAtMs !== undefined) {
      await setDoc(doc(d, 'groups', opts.id, 'members', m.uid), {
        uid: m.uid,
        joinedAt: ts(m.joinedAtMs),
        displayName: `namn-${m.uid}`,
      });
    }
    if (m.household) {
      await setDoc(doc(d, 'groups', opts.id, 'household', m.uid), { providerIds: ['x'] });
    }
  }
  for (const [itemId, addedBy] of Object.entries(opts.items ?? {})) {
    await setDoc(doc(d, 'groups', opts.id, 'watchlist', itemId), { addedBy, title: itemId });
    for (const uid of opts.progressFor ?? []) {
      await setDoc(doc(d, 'groups', opts.id, 'watchlist', itemId, 'progress', uid), { season: 1 });
    }
  }
  for (const [rowId, pickedByUid] of Object.entries(opts.history ?? {})) {
    await setDoc(doc(d, 'groups', opts.id, 'sessionHistory', rowId), {
      pickedByUid,
      tmdbId: 1,
      participantUids: opts.members.map((m) => m.uid),
    });
  }
  for (const uid of opts.joinAttemptsFor ?? []) {
    await setDoc(doc(d, 'groups', opts.id, 'joinAttempts', uid), { token: 'plaintext' });
  }
}

const exists = async (path: string[]) => (await getDoc(doc(db(), ...(path as [string, string])))).exists();

describe('runGroupHandover — the loop', () => {
  it('hands the group to the longest-standing REMAINING member', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      // The owner joined first, as createGroup always makes them.
      members: [{ uid: 'owner', joinedAtMs: 1000 }, { uid: 'heir', joinedAtMs: 2000 }, { uid: 'late', joinedAtMs: 3000 }],
    });

    const summary = await runGroupHandover(clientIo(), 'owner');

    expect(summary).toMatchObject({ ownedGroups: 1, handedOver: 1, toDelete: 0, noop: 0, raced: 0, failed: 0 });
    const group = await getDoc(doc(db(), 'groups', 'g1'));
    expect(group.data()?.ownerUid).toBe('heir');
    expect(group.data()?.memberUids).toEqual(['heir', 'late']);
  });

  // A LIVE sibling group the leaver does not own must come through untouched. A
  // test that only checks the target changed cannot tell "queried by ownerUid"
  // from "walked every group".
  it('leaves a group it does not own completely alone', async () => {
    await seedGroup({ id: 'mine', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }] });
    await seedGroup({ id: 'theirs', ownerUid: 'stranger', members: [{ uid: 'stranger', joinedAtMs: 1 }, { uid: 'owner', joinedAtMs: 5 }] });

    const summary = await runGroupHandover(clientIo(), 'owner');

    expect(summary.ownedGroups).toBe(1);
    const theirs = await getDoc(doc(db(), 'groups', 'theirs'));
    expect(theirs.data()?.ownerUid).toBe('stranger');
    expect(theirs.data()?.memberUids).toEqual(['stranger', 'owner']);
    // The leaver's own member row in a group they merely belong to is NOT this
    // function's to erase — the deletion cascade's member branch does that.
    expect(await exists(['groups', 'theirs', 'members', 'owner'])).toBe(true);
  });

  it('reports toDelete and writes nothing when nobody else remains', async () => {
    await seedGroup({ id: 'solo', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }] });

    const summary = await runGroupHandover(clientIo(), 'owner');

    expect(summary).toMatchObject({ handedOver: 0, toDelete: 1 });
    const group = await getDoc(doc(db(), 'groups', 'solo'));
    expect(group.data()?.ownerUid).toBe('owner');
    expect(group.data()?.memberUids).toEqual(['owner']);
  });

  // The join is three separate writes and can die between them, leaving a uid in
  // memberUids with no member row. The rules count them in full, so deleting the
  // group out from under them is the worse of the two failures.
  it('hands the group to a ghost rather than deleting it', async () => {
    await seedGroup({ id: 'g', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'ghost' }] });

    const summary = await runGroupHandover(clientIo(), 'owner');

    expect(summary).toMatchObject({ handedOver: 1, toDelete: 0 });
    expect((await getDoc(doc(db(), 'groups', 'g'))).data()?.ownerUid).toBe('ghost');
  });

  it('erases the departing member’s own traces and nobody else’s', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1, household: true }, { uid: 'heir', joinedAtMs: 2, household: true }],
      items: { 'movie_1': 'owner', 'movie_2': 'heir' },
      progressFor: ['owner', 'heir'],
      joinAttemptsFor: ['owner', 'heir'],
    });

    await runGroupHandover(clientIo(), 'owner');

    // BIN-329: a joinAttempts row holds a plaintext invite token.
    expect(await exists(['groups', 'g', 'joinAttempts', 'owner'])).toBe(false);
    expect(await exists(['groups', 'g', 'joinAttempts', 'heir'])).toBe(true);

    // Gone: the departing member's row, household contribution and progress.
    expect(await exists(['groups', 'g', 'members', 'owner'])).toBe(false);
    expect(await exists(['groups', 'g', 'household', 'owner'])).toBe(false);
    expect(await getDoc(doc(db(), 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'owner'))
      .then((s) => s.exists())).toBe(false);

    // Untouched: the successor's. Erasing a live third party's data would be the
    // worst outcome available to this function.
    expect(await exists(['groups', 'g', 'members', 'heir'])).toBe(true);
    expect(await exists(['groups', 'g', 'household', 'heir'])).toBe(true);
    expect(await getDoc(doc(db(), 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'heir'))
      .then((s) => s.exists())).toBe(true);
  });

  it('clears addedBy only on the rows the departing member added, and keeps the titles', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }],
      items: { 'movie_1': 'owner', 'movie_2': 'heir' },
    });

    await runGroupHandover(clientIo(), 'owner');

    const mine = await getDoc(doc(db(), 'groups', 'g', 'watchlist', 'movie_1'));
    expect(mine.exists()).toBe(true);
    expect(mine.data()?.title).toBe('movie_1');
    expect('addedBy' in (mine.data() ?? {})).toBe(false);

    const theirs = await getDoc(doc(db(), 'groups', 'g', 'watchlist', 'movie_2'));
    expect(theirs.data()?.addedBy).toBe('heir');
  });

  // `addedBy` was the field Malin's decision named. Without this the handed-over
  // group would keep pointing at an erased account.
  it('clears pickedByUid the same way, and keeps the history row', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }],
      history: { 'sh1': 'owner', 'sh2': 'heir' },
    });

    await runGroupHandover(clientIo(), 'owner');

    const mine = await getDoc(doc(db(), 'groups', 'g', 'sessionHistory', 'sh1'));
    expect(mine.exists()).toBe(true);
    expect(mine.data()?.tmdbId).toBe(1);
    expect('pickedByUid' in (mine.data() ?? {})).toBe(false);

    const theirRow = await getDoc(doc(db(), 'groups', 'g', 'sessionHistory', 'sh2'));
    expect(theirRow.data()?.pickedByUid).toBe('heir');
  });

  // `participantUids` is the third uid-bearing field on the same document, and
  // the one an enumeration that stopped at the obvious two would miss. Before
  // this change the whole sessionHistory row was deleted with the group; now the
  // group survives, so an erased account's uid would sit on a document every
  // remaining member reads.
  it('drops the departing member from participantUids and leaves the others', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }],
      history: { 'sh1': 'heir' },
    });

    await runGroupHandover(clientIo(), 'owner');

    const row = await getDoc(doc(db(), 'groups', 'g', 'sessionHistory', 'sh1'));
    expect(row.data()?.participantUids).toEqual(['heir']);
    // The row itself and its other fields survive — the group's own record of
    // what it watched is not the departing member's to erase.
    expect(row.data()?.pickedByUid).toBe('heir');
  });

  // The ordering defect this test exists for: both doors find a group by
  // `ownerUid` or by `memberUids array-contains`, and the swap changes both at
  // once. Erasing AFTER the swap would strand the departing member's rows the
  // instant the erasure failed — unreachable by any retry, and outside the
  // retention sweep. Erasing first inverts it: the caller is still the owner, so
  // the retry finds the group again.
  it('leaves the group findable when the erasure fails, so a retry can finish it', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1, household: true }, { uid: 'heir', joinedAtMs: 2 }],
      items: { 'movie_1': 'owner' },
      progressFor: ['owner'],
    });

    const failing = clientIo();
    failing.eraseMemberTraces = async () => { throw new Error('erase failed'); };
    const first = await runGroupHandover(failing, 'owner');

    // `attempted` is counted BEFORE the write, not after it: a chunked erasure
    // can commit some rows and then throw, and this counter is what stops the
    // client reporting that as "nothing has been deleted". Counted after, it
    // would read 0 on exactly the run where it matters.
    expect(first).toMatchObject({ handedOver: 0, failed: 1, attempted: 1 });
    // Ownership did NOT move, which is the whole point: the group is still
    // reachable by the ownerUid query the next run makes.
    expect((await getDoc(doc(db(), 'groups', 'g'))).data()?.ownerUid).toBe('owner');

    const second = await runGroupHandover(clientIo(), 'owner');

    expect(second).toMatchObject({ ownedGroups: 1, handedOver: 1, failed: 0 });
    expect((await getDoc(doc(db(), 'groups', 'g'))).data()?.ownerUid).toBe('heir');
    expect(await exists(['groups', 'g', 'members', 'owner'])).toBe(false);
    expect(await exists(['groups', 'g', 'household', 'owner'])).toBe(false);
  });

  // The idempotency guard, driven rather than asserted about: run it twice. The
  // second run must find its own earlier handover and touch nothing — never hold
  // a second election, which could name a different member.
  it('is a no-op on a second run rather than a second election', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }, { uid: 'late', joinedAtMs: 3 }],
    });

    await runGroupHandover(clientIo(), 'owner');
    const afterFirst = (await getDoc(doc(db(), 'groups', 'g'))).data();
    const second = await runGroupHandover(clientIo(), 'owner');

    // The group no longer matches the ownerUid query at all, which is the first
    // line of defence; the outcome check behind it is unit-tested.
    expect(second).toMatchObject({ ownedGroups: 0, handedOver: 0, noop: 0 });
    const afterSecond = (await getDoc(doc(db(), 'groups', 'g'))).data();
    expect(afterSecond?.ownerUid).toBe(afterFirst?.ownerUid);
    expect(afterSecond?.memberUids).toEqual(afterFirst?.memberUids);
  });

  it('counts a failed group and still hands over the others', async () => {
    await seedGroup({ id: 'ok', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }] });
    await seedGroup({ id: 'boom', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir2', joinedAtMs: 2 }] });

    const io = clientIo();
    const realRead = io.readMembers.bind(io);
    io.readMembers = async (groupId) => {
      if (groupId === 'boom') throw new Error('read failed');
      return realRead(groupId);
    };

    const summary = await runGroupHandover(io, 'owner');

    expect(summary).toMatchObject({ ownedGroups: 2, handedOver: 1, failed: 1 });
    expect(io.errors.length).toBe(1);
    expect((await getDoc(doc(db(), 'groups', 'ok'))).data()?.ownerUid).toBe('heir');
    expect((await getDoc(doc(db(), 'groups', 'boom'))).data()?.ownerUid).toBe('owner');
  });

  it('counts a race rather than writing over a handover that already happened', async () => {
    await seedGroup({ id: 'g', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }] });

    const io = clientIo();
    const realClaim = io.claimOwnership.bind(io);
    io.claimOwnership = async (groupId, expectedOwnerUid, write) => {
      // Somebody else moves ownership between the read and the claim.
      await updateDoc(doc(db(), 'groups', groupId), { ownerUid: 'someone-else' });
      return realClaim(groupId, expectedOwnerUid, write);
    };

    const summary = await runGroupHandover(io, 'owner');

    expect(summary).toMatchObject({ handedOver: 0, raced: 1, failed: 0 });
    expect((await getDoc(doc(db(), 'groups', 'g'))).data()?.ownerUid).toBe('someone-else');
    // The traces ARE gone, because the erasure runs before the claim. That is the
    // right way round: they are the departing member's own data, owed to them
    // whoever ends up owning the group, and the alternative ordering strands them
    // permanently the moment an erasure fails after a committed swap.
    expect(await exists(['groups', 'g', 'members', 'owner'])).toBe(false);
  });

  it('skips a group that vanished between the query and the read', async () => {
    await seedGroup({ id: 'g', ownerUid: 'owner', members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }] });

    const io = clientIo();
    const realGroup = io.readGroup.bind(io);
    io.readGroup = async (groupId) => {
      await deleteDoc(doc(db(), 'groups', groupId));
      return realGroup(groupId);
    };

    const summary = await runGroupHandover(io, 'owner');

    expect(summary).toMatchObject({ ownedGroups: 1, handedOver: 0, toDelete: 0, noop: 0, raced: 0, failed: 0 });
  });
});
