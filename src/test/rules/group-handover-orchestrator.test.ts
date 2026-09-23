import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where,
  writeBatch, deleteField, arrayRemove, serverTimestamp, Timestamp, runTransaction,
  type Firestore,
} from 'firebase/firestore';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  eraseSentInvites, runGroupHandover, runLeaverErasure, runMemberGroupErasure, runOwnerPickedHandover, runOwnerRemovalErasure,
  type HandoverIo, type HandoverNotifyIo, type LeaverIo, type MemberGroupsIo,
} from '../../../functions/src/groupHandover/runHandover';
import {
  HandoverRefusal, SENT_INVITE_BATCH_LIMIT, planClaim, refusalForHandover, HANDOVER_PARTIAL,
  chunkWrites, leaverChunkMayCommit, memberTraceWrites,
} from '../../../functions/src/groupHandover/logic';
import { rosterMismatches } from './memberTraceRoster';

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
 *
 * Nor the Admin half of `eraseLeaverTraces` (BIN-1260): `leaverIo` below is this
 * file's OWN client-SDK copy, with a real transaction. The Admin port's shape is
 * pinned by a source scan in functions/src/groupHandover/logic.test.ts.
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

    // BIN-1147. Real implementations: the describe block named for the erasure,
    // further down this file, drives this port against the emulator. The sibling
    // harnesses implement these two methods for the type and never call them,
    // and each says so where it does it.
    sentInvitePaths: async (uid) =>
      (await getDocs(query(collectionGroup(d, 'groupInvites'), where('fromUid', '==', uid))))
        .docs.map((x) => x.ref.path),
    deleteSentInvites: async (paths) => {
      const batch = writeBatch(d);
      paths.forEach((path) => batch.delete(doc(d, path)));
      await batch.commit();
    },

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
      const claim = planClaim(fresh.exists() ? {
        ownerUid: fresh.data().ownerUid,
        memberUids: fresh.data().memberUids ?? [],
      } : null, expectedOwnerUid, write);
      if (claim.kind === 'claimed') {
        await updateDoc(ref, {
          ownerUid: claim.ownerUid,
          memberUids: claim.memberUids,
          updatedAt: serverTimestamp(),
        });
      }
      return claim;
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

/**
 * BIN-1118's extra port, implemented against the emulator like the one above.
 * `sent` records what was written so a test can assert WHO was told, which is
 * the half a pure unit test cannot reach.
 */
function notifyIo(): HandoverNotifyIo & {
  sent: { uids: readonly string[]; body: string }[];
  failNotify: { on: boolean };
} {
  const d = db();
  const sent: { uids: readonly string[]; body: string }[] = [];
  const failNotify = { on: false };
  return {
    sent,
    failNotify,
    readGroupName: async (groupId) => {
      const snap = await getDoc(doc(d, 'groups', groupId));
      const name = snap.exists() ? snap.data().name : undefined;
      return typeof name === 'string' && name.length > 0 ? name : null;
    },
    readMemberName: async (groupId, uid) => {
      const snap = await getDoc(doc(d, 'groups', groupId, 'members', uid));
      const name = snap.exists() ? snap.data().displayName : undefined;
      return typeof name === 'string' && name.length > 0 ? name : null;
    },
    notifyMembers: async (uids, card) => {
      if (failNotify.on) throw new Error('notify nere');
      sent.push({ uids, body: card.body });
    },
  };
}

describe('runOwnerPickedHandover — the owner names the successor (BIN-1118)', () => {
  it('hands the group to the PICKED member, not to the longest-standing one', async () => {
    // The whole point of the new door. `sara` joined before `jonas`, so the
    // automatic election would name her; the owner picks `jonas` instead.
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [
        { uid: 'owner', joinedAtMs: 1 },
        { uid: 'sara', joinedAtMs: 2 },
        { uid: 'jonas', joinedAtMs: 9 },
      ],
    });
    await runOwnerPickedHandover({ ...clientIo(), ...notifyIo() }, 'g1', 'owner', 'jonas');

    const after = await getDoc(doc(db(), 'groups', 'g1'));
    expect(after.data()?.ownerUid).toBe('jonas');
    expect(after.data()?.memberUids).toEqual(['sara', 'jonas']);
  });

  it('erases the departing owner traces and nobody else', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [
        { uid: 'owner', joinedAtMs: 1, household: true },
        { uid: 'jonas', joinedAtMs: 2, household: true },
      ],
      items: { movie_1: 'owner', movie_2: 'jonas' },
      progressFor: ['owner', 'jonas'],
      joinAttemptsFor: ['owner'],
    });
    await runOwnerPickedHandover({ ...clientIo(), ...notifyIo() }, 'g1', 'owner', 'jonas');

    const d = db();
    expect((await getDoc(doc(d, 'groups', 'g1', 'members', 'owner'))).exists()).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g1', 'household', 'owner'))).exists()).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g1', 'joinAttempts', 'owner'))).exists()).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g1', 'members', 'jonas'))).exists()).toBe(true);
    expect((await getDoc(doc(d, 'groups', 'g1', 'household', 'jonas'))).exists()).toBe(true);

    // The title stays; the note saying who added it goes — and only on the row
    // the departing owner added.
    expect((await getDoc(doc(d, 'groups', 'g1', 'watchlist', 'movie_1'))).data()).toEqual({ title: 'movie_1' });
    expect((await getDoc(doc(d, 'groups', 'g1', 'watchlist', 'movie_2'))).data()?.addedBy).toBe('jonas');
  });

  // The order is load-bearing in the FAILING direction, exactly as it is for the
  // automatic door: a throw must leave the caller still the owner, so a retry
  // still finds the group. Had the swap run first, those rows would be stranded.
  it('leaves the group findable when the erasure fails, so a retry can finish it', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'jonas', joinedAtMs: 2 }],
    });
    const io = { ...clientIo(), ...notifyIo() };
    io.eraseMemberTraces = async () => { throw new Error('erasure nere'); };

    await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas')).rejects.toThrow('erasure nere');
    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('owner');
  });

  it('tells exactly the remaining members, and never the one who left', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [
        { uid: 'owner', joinedAtMs: 1 },
        { uid: 'jonas', joinedAtMs: 2 },
        { uid: 'sara', joinedAtMs: 3 },
      ],
    });
    const io = { ...clientIo(), ...notifyIo() };
    await runOwnerPickedHandover(io, 'g1', 'owner', 'jonas');

    expect(io.sent).toHaveLength(1);
    expect([...io.sent[0].uids].sort()).toEqual(['jonas', 'sara']);
    expect(io.sent[0].uids).not.toContain('owner');
    // The successor name is read BEFORE the erasure removes the leaver row, so
    // the card can still name them.
    expect(io.sent[0].body).toContain('namn-jonas');
  });

  // The notification is the last step and nothing depends on it. A failure there
  // must not turn a completed handover into a reported failure — the inverse of
  // the erasure case above.
  it('keeps the handover when the notification fails', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'jonas', joinedAtMs: 2 }],
    });
    const io = { ...clientIo(), ...notifyIo() };
    io.failNotify.on = true;

    await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas')).resolves.toBeUndefined();
    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('jonas');
    expect(io.errors.length).toBeGreaterThan(0);
  });

  it('refuses rather than writing when the caller is not the owner', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'jonas', joinedAtMs: 2 }],
    });
    const io = { ...clientIo(), ...notifyIo() };
    await expect(runOwnerPickedHandover(io, 'g1', 'jonas', 'owner')).rejects.toThrow();

    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('owner');
    expect((await getDoc(doc(db(), 'groups', 'g1', 'members', 'jonas'))).exists()).toBe(true);
    expect(io.sent).toHaveLength(0);
  });

  it('refuses a successor who is not a member, and erases nothing', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1, household: true }, { uid: 'jonas', joinedAtMs: 2 }],
    });
    const io = { ...clientIo(), ...notifyIo() };
    await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'stranger')).rejects.toThrow();

    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('owner');
    expect((await getDoc(doc(db(), 'groups', 'g1', 'household', 'owner'))).exists()).toBe(true);
  });

  // The optimistic guard the automatic door also uses. Reproduced by moving
  // ownership between this run's read and its write.
  it('refuses when ownership moved under it, rather than writing over it', async () => {
    await seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'jonas', joinedAtMs: 2 }],
    });
    const io = { ...clientIo(), ...notifyIo() };
    io.eraseMemberTraces = async () => {
      await updateDoc(doc(db(), 'groups', 'g1'), { ownerUid: 'someone-else' });
    };

    await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas')).rejects.toThrow();
    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('someone-else');
    expect(io.sent).toHaveLength(0);
  });

  it('refuses when the group is gone', async () => {
    const io = { ...clientIo(), ...notifyIo() };
    await expect(runOwnerPickedHandover(io, 'nope', 'owner', 'jonas')).rejects.toThrow();
    expect(io.sent).toHaveLength(0);
  });

  // The distinction the callable reads to decide which messages an owner may be
  // shown. Refusals are written for a reader; anything else carries whatever the
  // failing library said, which for a batch write is a raw gRPC string.
  //
  // Marked at the THROW site on purpose: an earlier version marked it in the
  // callable's catch, which wrapped both kinds and so marked them the same.
  describe('what kind of error each failure throws', () => {
    const seedTwo = () => seedGroup({
      id: 'g1',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'jonas', joinedAtMs: 2 }],
    });

    it.each([
      ['not the owner', 'jonas', 'owner'],
      ['successor is not a member', 'owner', 'stranger'],
      ['handing over to yourself', 'owner', 'owner'],
    ])('a refusal — %s — throws HandoverRefusal', async (_label, caller, successor) => {
      await seedTwo();
      const io = { ...clientIo(), ...notifyIo() };
      await expect(runOwnerPickedHandover(io, 'g1', caller, successor))
        .rejects.toBeInstanceOf(HandoverRefusal);
    });

    it('a missing group is a refusal', async () => {
      const io = { ...clientIo(), ...notifyIo() };
      await expect(runOwnerPickedHandover(io, 'nope', 'owner', 'jonas'))
        .rejects.toBeInstanceOf(HandoverRefusal);
    });

    it('a lost race is a refusal', async () => {
      await seedTwo();
      const io = { ...clientIo(), ...notifyIo() };
      io.eraseMemberTraces = async () => {
        await updateDoc(doc(db(), 'groups', 'g1'), { ownerUid: 'someone-else' });
      };
      await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas'))
        .rejects.toBeInstanceOf(HandoverRefusal);
    });

    // The decisive case. `eraseMemberTraces` throws for real when a watchlist row
    // is deleted between the read and the write — `adminIo.ts` says so at the
    // method. Its message is the library's, and the owner must never see it.
    it('a failed erasure is NOT a refusal', async () => {
      await seedTwo();
      const io = { ...clientIo(), ...notifyIo() };
      io.eraseMemberTraces = async () => {
        throw new Error('5 NOT_FOUND: no entity to update');
      };
      await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas'))
        .rejects.not.toBeInstanceOf(HandoverRefusal);
    });

    it('a failed read is NOT a refusal', async () => {
      await seedTwo();
      const io = { ...clientIo(), ...notifyIo() };
      io.readWatchlist = async () => { throw new Error('14 UNAVAILABLE'); };
      await expect(runOwnerPickedHandover(io, 'g1', 'owner', 'jonas'))
        .rejects.not.toBeInstanceOf(HandoverRefusal);
    });
  });
});

// BIN-1266 / BIN-1267 / BIN-1271. The windows between this function's reads and
// its claim, driven by writing to the group from inside the erasure step — the
// write lands after the reads and before the claim, exactly where a real leave
// or a real invite would.
describe('runOwnerPickedHandover — what changes while it runs (BIN-1266, BIN-1267, BIN-1271)', () => {
  const seedThree = () => seedGroup({
    id: 'g1',
    ownerUid: 'owner',
    members: [
      { uid: 'owner', joinedAtMs: 1 },
      { uid: 'jonas', joinedAtMs: 2 },
      { uid: 'sara', joinedAtMs: 3 },
    ],
  });

  it('a member who leaves mid-handover is NOT written back, and is not told', async () => {
    await seedThree();
    const io = { ...clientIo(), ...notifyIo() };
    const realErase = io.eraseMemberTraces.bind(io);
    io.eraseMemberTraces = async (groupId, leavingUid, erasure) => {
      await realErase(groupId, leavingUid, erasure);
      await updateDoc(doc(db(), 'groups', 'g1'), { memberUids: arrayRemove('sara') });
    };

    await runOwnerPickedHandover(io, 'g1', 'owner', 'jonas');

    const after = (await getDoc(doc(db(), 'groups', 'g1'))).data();
    expect(after?.ownerUid).toBe('jonas');
    expect(after?.memberUids).toEqual(['jonas']);
    expect(io.sent[0].uids).toEqual(['jonas']);
  });

  it('a successor who leaves mid-handover is refused, and nothing is claimed', async () => {
    await seedThree();
    const io = { ...clientIo(), ...notifyIo() };
    const realErase = io.eraseMemberTraces.bind(io);
    io.eraseMemberTraces = async (groupId, leavingUid, erasure) => {
      await realErase(groupId, leavingUid, erasure);
      await updateDoc(doc(db(), 'groups', 'g1'), { memberUids: arrayRemove('jonas') });
    };

    const err = await runOwnerPickedHandover(io, 'g1', 'owner', 'jonas').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandoverRefusal);
    expect((err as Error).message).toBe('Personen du valde har lämnat gruppen. Välj någon annan.');

    const after = (await getDoc(doc(db(), 'groups', 'g1'))).data();
    expect(after?.ownerUid).toBe('owner');
    expect(after?.memberUids).toEqual(['owner', 'sara']);
    expect(io.sent).toHaveLength(0);
    // BIN-1267: the erasure has run — the owner's own row is gone. What a retry
    // with a successor who is still there does about it is the next test.
    expect(await exists(['groups', 'g1', 'members', 'owner'])).toBe(false);
  });

  it('a retry with a successor who is still a member converges', async () => {
    await seedThree();
    const first = { ...clientIo(), ...notifyIo() };
    const realErase = first.eraseMemberTraces.bind(first);
    first.eraseMemberTraces = async (groupId, leavingUid, erasure) => {
      await realErase(groupId, leavingUid, erasure);
      await updateDoc(doc(db(), 'groups', 'g1'), { memberUids: arrayRemove('jonas') });
    };
    await expect(runOwnerPickedHandover(first, 'g1', 'owner', 'jonas')).rejects.toBeInstanceOf(HandoverRefusal);

    await runOwnerPickedHandover({ ...clientIo(), ...notifyIo() }, 'g1', 'owner', 'sara');

    const after = (await getDoc(doc(db(), 'groups', 'g1'))).data();
    expect(after?.ownerUid).toBe('sara');
    expect(after?.memberUids).toEqual(['sara']);
  });

  const seedInvite = (target: string, gid: string, fromUid: string) =>
    setDoc(doc(db(), 'users', target, 'groupInvites', gid), {
      groupId: gid, groupName: 'Gruppen', fromUid, fromDisplayName: 'namn', invitedAt: serverTimestamp(),
    });

  it('erases the invitations the departing owner sent for THIS group, and only those', async () => {
    await seedThree();
    await seedInvite('invitee', 'g1', 'owner');
    await seedInvite('invitee', 'annan-grupp', 'owner');
    await seedInvite('invitee2', 'g1', 'jonas');

    await runOwnerPickedHandover({ ...clientIo(), ...notifyIo() }, 'g1', 'owner', 'jonas');

    expect(await exists(['users', 'invitee', 'groupInvites', 'g1'])).toBe(false);
    expect(await exists(['users', 'invitee', 'groupInvites', 'annan-grupp'])).toBe(true);
    expect(await exists(['users', 'invitee2', 'groupInvites', 'g1'])).toBe(true);
  });

  it('keeps the handover when the invitation erasure fails', async () => {
    await seedThree();
    const io = { ...clientIo(), ...notifyIo() };
    io.sentInvitePaths = async () => { throw new Error('14 UNAVAILABLE'); };

    await runOwnerPickedHandover(io, 'g1', 'owner', 'jonas');

    expect((await getDoc(doc(db(), 'groups', 'g1'))).data()?.ownerUid).toBe('jonas');
    expect(io.errors).toHaveLength(1);
    expect(io.sent).toHaveLength(1);
  });
});

describe('runGroupHandover — a member who leaves mid-handover (BIN-1266)', () => {
  it('is not written back into memberUids', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [
        { uid: 'owner', joinedAtMs: 1 },
        { uid: 'heir', joinedAtMs: 2 },
        { uid: 'sara', joinedAtMs: 3 },
      ],
    });
    const io = clientIo();
    const realErase = io.eraseMemberTraces.bind(io);
    io.eraseMemberTraces = async (groupId, leavingUid, erasure) => {
      await realErase(groupId, leavingUid, erasure);
      await updateDoc(doc(db(), 'groups', 'g'), { memberUids: arrayRemove('sara') });
    };

    const summary = await runGroupHandover(io, 'owner');

    expect(summary).toMatchObject({ handedOver: 1, raced: 0 });
    expect((await getDoc(doc(db(), 'groups', 'g'))).data()?.memberUids).toEqual(['heir']);
  });

  it('counts a successor who left as a FAILURE, so both doors stop, and writes nothing', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'heir', joinedAtMs: 2 }, { uid: 'sara', joinedAtMs: 3 }],
    });
    const io = clientIo();
    const realErase = io.eraseMemberTraces.bind(io);
    io.eraseMemberTraces = async (groupId, leavingUid, erasure) => {
      await realErase(groupId, leavingUid, erasure);
      await updateDoc(doc(db(), 'groups', 'g'), { memberUids: arrayRemove('heir') });
    };

    const summary = await runGroupHandover(io, 'owner');

    expect(summary).toMatchObject({ handedOver: 0, raced: 0, failed: 1, attempted: 1 });
    // The account-delete door refuses on this, with the partial marker, instead of
    // going on to delete a group other people are still in.
    expect(refusalForHandover(summary)).toContain(HANDOVER_PARTIAL);
    const after = (await getDoc(doc(db(), 'groups', 'g'))).data();
    expect(after?.ownerUid).toBe('owner');
    expect(after?.memberUids).toEqual(['owner', 'sara']);
  });
});

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
    // The IDS, not just the count. They are the only signal the retention sweep
    // has that a group emptied after its plan was made, and every test on the
    // consuming side stubs this port — so without this assertion the `push` that
    // produces them can be deleted with the whole suite green.
    expect(summary.toDeleteIds).toEqual(['solo']);
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

describe('eraseSentInvites — against a live emulator (BIN-1147)', () => {
  // The unit tests prove the DECISION against a mock. This proves the write
  // half: that the query really reaches a third party's tree, and that the
  // batch really removes the documents. A mock cannot tell either apart from a
  // no-op.
  // `fromDisplayName` is deliberately the OTHER party's name, so a query written
  // against the display field instead of `fromUid` picks the wrong document.
  // A fixture where the two fields agree cannot tell the two predicates apart.
  const seedInvite = (target: string, gid: string, fromUid: string) =>
    setDoc(doc(db(), 'users', target, 'groupInvites', gid), {
      groupId: gid, groupName: 'Filmklubben', fromUid,
      fromDisplayName: fromUid === 'owner' ? 'stranger' : 'owner',
      invitedAt: serverTimestamp(),
    });

  it('erases what the leaver sent and leaves a live account invite standing', async () => {
    await seedInvite('invitee', 'g-owner', 'owner');
    await seedInvite('invitee', 'g-stranger', 'stranger');

    const result = await eraseSentInvites(clientIo(), 'owner');

    expect(result).toEqual({ found: 1 });
    expect((await getDoc(doc(db(), 'users', 'invitee', 'groupInvites', 'g-owner'))).exists()).toBe(false);
    // The sibling is protected by the fromUid predicate, not by its doc id.
    expect((await getDoc(doc(db(), 'users', 'invitee', 'groupInvites', 'g-stranger'))).exists()).toBe(true);
  });

  it('reaches invitations spread across several recipients', async () => {
    await seedInvite('a', 'g1', 'owner');
    await seedInvite('b', 'g2', 'owner');

    expect(await eraseSentInvites(clientIo(), 'owner')).toEqual({ found: 2 });
    expect((await getDoc(doc(db(), 'users', 'a', 'groupInvites', 'g1'))).exists()).toBe(false);
    expect((await getDoc(doc(db(), 'users', 'b', 'groupInvites', 'g2'))).exists()).toBe(false);
  });

  it('writes nothing when the leaver sent none', async () => {
    await seedInvite('invitee', 'g-stranger', 'stranger');
    expect(await eraseSentInvites(clientIo(), 'owner')).toEqual({ found: 0 });
    expect((await getDoc(doc(db(), 'users', 'invitee', 'groupInvites', 'g-stranger'))).exists()).toBe(true);
  });

  // BIN-1148. Above the ceiling NOTHING is deleted — not a prefix. A mock cannot tell
  // that from a run that deleted some and then threw; only a real query over more
  // documents than the ceiling can. A live account's invite rides along as the control.
  it('erases nothing at all when the leaver sent more than the ceiling', async () => {
    const over = SENT_INVITE_BATCH_LIMIT + 1;
    const d = db();
    for (let start = 0; start < over; start += 400) {
      const batch = writeBatch(d);
      for (let i = start; i < Math.min(start + 400, over); i++) {
        batch.set(doc(d, 'users', `r${i}`, 'groupInvites', 'g-owner'), {
          groupId: 'g-owner', groupName: 'Filmklubben', fromUid: 'owner', fromDisplayName: 'stranger',
        });
      }
      await batch.commit();
    }
    await seedInvite('invitee', 'g-stranger', 'stranger');
    const sentByOwner = async () =>
      (await getDocs(query(collectionGroup(db(), 'groupInvites'), where('fromUid', '==', 'owner')))).size;
    expect(await sentByOwner()).toBe(over);

    await expect(eraseSentInvites(clientIo(), 'owner')).rejects.toThrow(/Ingenting raderades/);

    expect(await sentByOwner()).toBe(over);
    expect((await getDoc(doc(db(), 'users', 'invitee', 'groupInvites', 'g-stranger'))).exists()).toBe(true);
  });
});

describe('eraseMemberTraces — held to memberTraceWrites (BIN-1123)', () => {
  it('group-handover-orchestrator port writes exactly what memberTraceWrites decides', async () => {
    expect(await rosterMismatches((fn) => fn(db()), clientIo().eraseMemberTraces)).toEqual([]);
  });

  // The roster only holds a port whose file calls it.
  it('every emulator port of eraseMemberTraces runs the roster', () => {
    const files = execFileSync('git', ['grep', '-l', 'eraseMemberTraces', '--', 'src/test'], { encoding: 'utf8' })
      .split('\n').map((f) => f.trim()).filter((f) => f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    const silent = files.filter((f) => !readFileSync(f, 'utf8').includes('rosterMismatches('));
    expect(silent, 'a port of eraseMemberTraces that the roster does not hold').toEqual([]);
  });
});

/**
 * BIN-1260 + BIN-1278 — the leaver's erasure and the delete door's member-group
 * step, against the emulator.
 *
 * `eraseLeaverTraces` here applies `memberTraceWrites` directly, in chunks, each in
 * a real client-SDK transaction that re-reads the group through
 * `leaverChunkMayCommit` — the same shape as the Admin port. `chunk` is small so a
 * test can land a rejoin between two chunks.
 */
function leaverIo(opts: { chunk?: number; afterChunk?: () => Promise<void> } = {}): LeaverIo & MemberGroupsIo {
  const d = db();
  const base = clientIo();
  return {
    log: base.log,
    readGroup: base.readGroup,
    readWatchlist: base.readWatchlist,
    readSessionHistory: base.readSessionHistory,
    memberGroups: async (uid) =>
      (await getDocs(query(collection(d, 'groups'), where('memberUids', 'array-contains', uid))))
        .docs.map((x) => ({ id: x.id, ownerUid: x.data().ownerUid as string })),
    eraseLeaverTraces: async (groupId, uid, erasure, requiredOwner) => {
      const groupRef = doc(d, 'groups', groupId);
      for (const chunk of chunkWrites(memberTraceWrites(uid, erasure), opts.chunk ?? 450)) {
        const wrote = await runTransaction(d, async (tx) => {
          const fresh = await tx.get(groupRef);
          const group = fresh.exists()
            ? { memberUids: (fresh.data().memberUids as string[]) ?? [], ownerUid: (fresh.data().ownerUid as string) ?? '' }
            : null;
          if (!leaverChunkMayCommit(group, uid, requiredOwner)) return false;
          for (const w of chunk) {
            const ref = doc(d, `groups/${groupId}/${w.collection}/${w.doc}`);
            if (w.op === 'delete') tx.delete(ref);
            else if (w.op === 'clear') tx.update(ref, { [w.field as string]: deleteField() });
            else tx.update(ref, { [w.field as string]: arrayRemove(uid) });
          }
          return true;
        });
        if (!wrote) return { kind: 'stopped' };
        await opts.afterChunk?.();
      }
      return { kind: 'done' };
    },
  };
}

/** A group `leaver` has just left the way the client does: out of memberUids, member row and household gone. */
async function seedLeftGroup() {
  await seedGroup({
    id: 'g',
    ownerUid: 'owner',
    members: [
      { uid: 'owner', joinedAtMs: 1, household: true },
      { uid: 'stayer', joinedAtMs: 2, household: true },
      { uid: 'leaver', joinedAtMs: 3, household: true },
    ],
    items: { movie_1: 'leaver', movie_2: 'stayer' },
    progressFor: ['leaver', 'stayer'],
    history: { h1: 'leaver', h2: 'stayer' },
    joinAttemptsFor: ['leaver', 'stayer'],
  });
  const d = db();
  await updateDoc(doc(d, 'groups', 'g'), { memberUids: ['owner', 'stayer'] });
  await deleteDoc(doc(d, 'groups', 'g', 'members', 'leaver'));
  await deleteDoc(doc(d, 'groups', 'g', 'household', 'leaver'));
}

describe('runLeaverErasure — after a plain leave (BIN-1260)', () => {
  it('erases the leaver traces and nobody else’s', async () => {
    await seedLeftGroup();
    await runLeaverErasure(leaverIo(), 'g', 'leaver');
    const d = db();

    expect(await exists(['groups', 'g', 'joinAttempts', 'leaver'])).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'leaver'))).exists()).toBe(false);
    const item1 = (await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1'))).data() ?? {};
    expect('addedBy' in item1, 'the title stays, the note about who added it goes').toBe(false);
    expect(item1.title).toBe('movie_1');
    const h1 = (await getDoc(doc(d, 'groups', 'g', 'sessionHistory', 'h1'))).data() ?? {};
    expect('pickedByUid' in h1).toBe(false);
    expect(h1.participantUids).toEqual(['owner', 'stayer']);

    // The stayer's, in the same collections: filtered by uid, not wiped.
    expect(await exists(['groups', 'g', 'joinAttempts', 'stayer'])).toBe(true);
    expect(await exists(['groups', 'g', 'members', 'stayer'])).toBe(true);
    expect(await exists(['groups', 'g', 'household', 'stayer'])).toBe(true);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'stayer'))).exists()).toBe(true);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_2'))).data()?.addedBy).toBe('stayer');
    expect((await getDoc(doc(d, 'groups', 'g', 'sessionHistory', 'h2'))).data()?.pickedByUid).toBe('stayer');
    // And the leave itself is not touched: memberUids is what the client wrote.
    expect((await getDoc(doc(d, 'groups', 'g'))).data()?.memberUids).toEqual(['owner', 'stayer']);
  });

  it('refuses someone still in the group and writes nothing', async () => {
    await seedLeftGroup();
    await expect(runLeaverErasure(leaverIo(), 'g', 'stayer')).rejects.toBeInstanceOf(HandoverRefusal);
    expect(await exists(['groups', 'g', 'members', 'stayer'])).toBe(true);
    expect(await exists(['groups', 'g', 'joinAttempts', 'stayer'])).toBe(true);
  });

  it('refuses the owner and writes nothing', async () => {
    await seedLeftGroup();
    await expect(runLeaverErasure(leaverIo(), 'g', 'owner')).rejects.toBeInstanceOf(HandoverRefusal);
    expect(await exists(['groups', 'g', 'members', 'owner'])).toBe(true);
  });

  it('resolves quietly for a group that does not exist', async () => {
    await expect(runLeaverErasure(leaverIo(), 'nope', 'leaver')).resolves.toBeUndefined();
  });

  // #4's condition, driven for real: the leaver rejoins after the first chunk, and
  // the chunks still queued must not touch the fresh membership.
  it('stops at the next chunk when the leaver rejoins, and the new membership survives', async () => {
    await seedLeftGroup();
    const d = db();
    let rejoined = false;
    const io = leaverIo({
      chunk: 2,
      afterChunk: async () => {
        if (rejoined) return;
        rejoined = true;
        await updateDoc(doc(d, 'groups', 'g'), { memberUids: ['owner', 'stayer', 'leaver'] });
        await setDoc(doc(d, 'groups', 'g', 'members', 'leaver'), { uid: 'leaver', joinedAt: ts(9) });
      },
    });
    await runLeaverErasure(io, 'g', 'leaver');

    expect(rejoined, 'the rejoin must have landed between chunks').toBe(true);
    // The member row is deleted in chunk 1, BEFORE the rejoin, so this holds with or
    // without the guard. It shows the rejoin landed, nothing more.
    expect(await exists(['groups', 'g', 'members', 'leaver']), 'the new member row').toBe(true);
    // This is the assertion the guard is for: the progress row is in a later chunk.
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'leaver'))).exists()).toBe(true);
  });
});

describe('runOwnerRemovalErasure — the owner removed a member (BIN-1296)', () => {
  it('erases the removed member traces and nobody else’s', async () => {
    await seedLeftGroup();
    await runOwnerRemovalErasure(leaverIo(), 'g', 'owner', 'leaver');
    const d = db();

    expect(await exists(['groups', 'g', 'joinAttempts', 'leaver'])).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'leaver'))).exists()).toBe(false);
    expect('addedBy' in ((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1'))).data() ?? {})).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g', 'sessionHistory', 'h1'))).data()?.participantUids).toEqual(['owner', 'stayer']);

    expect(await exists(['groups', 'g', 'joinAttempts', 'stayer'])).toBe(true);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_2'))).data()?.addedBy).toBe('stayer');
  });

  it('a non-owner changes nothing, and gets the same answer as for a missing group', async () => {
    await seedLeftGroup();
    await expect(runOwnerRemovalErasure(leaverIo(), 'g', 'stayer', 'leaver')).resolves.toBeUndefined();
    await expect(runOwnerRemovalErasure(leaverIo(), 'nope', 'stayer', 'leaver')).resolves.toBeUndefined();
    expect(await exists(['groups', 'g', 'joinAttempts', 'leaver'])).toBe(true);
    expect((await getDoc(doc(db(), 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'leaver'))).exists()).toBe(true);
  });

  it('refuses while the named person is still a member, and writes nothing', async () => {
    await seedLeftGroup();
    await expect(runOwnerRemovalErasure(leaverIo(), 'g', 'owner', 'stayer')).rejects.toBeInstanceOf(HandoverRefusal);
    expect(await exists(['groups', 'g', 'members', 'stayer'])).toBe(true);
    expect(await exists(['groups', 'g', 'joinAttempts', 'stayer'])).toBe(true);
  });

  // #4/#6/#27's condition, driven for real: ownership moves after the first chunk,
  // and the old owner's queued chunks must not be written.
  it('stops at the next chunk once the caller no longer owns the group', async () => {
    await seedLeftGroup();
    const d = db();
    let moved = false;
    const io = leaverIo({
      chunk: 2,
      afterChunk: async () => {
        if (moved) return;
        moved = true;
        await updateDoc(doc(d, 'groups', 'g'), { ownerUid: 'stayer' });
      },
    });
    await runOwnerRemovalErasure(io, 'g', 'owner', 'leaver');

    expect(moved, 'the handover must have landed between chunks').toBe(true);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'leaver'))).exists()).toBe(true);
  });
});

describe('runMemberGroupErasure — the delete door, groups the account only belongs to (BIN-1278)', () => {
  it('erases the traces, leaves memberUids for the cascade, and skips owned groups', async () => {
    await seedGroup({
      id: 'g',
      ownerUid: 'owner',
      members: [{ uid: 'owner', joinedAtMs: 1 }, { uid: 'me', joinedAtMs: 2, household: true }],
      items: { movie_1: 'me', movie_2: 'owner' },
      progressFor: ['me', 'owner'],
      history: { h1: 'me' },
    });
    await seedGroup({
      id: 'mine',
      ownerUid: 'me',
      members: [{ uid: 'me', joinedAtMs: 1 }, { uid: 'other', joinedAtMs: 2 }],
      items: { movie_9: 'me' },
    });
    const d = db();
    const io = { ...clientIo(), ...leaverIo() };

    await expect(runMemberGroupErasure(io, 'me', { attempted: false })).resolves.toEqual({ groups: 1 });

    const item1 = (await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1'))).data() ?? {};
    expect('addedBy' in item1).toBe(false);
    const h1 = (await getDoc(doc(d, 'groups', 'g', 'sessionHistory', 'h1'))).data() ?? {};
    expect('pickedByUid' in h1).toBe(false);
    expect(h1.participantUids).toEqual(['owner']);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'me'))).exists()).toBe(false);
    expect(await exists(['groups', 'g', 'members', 'me'])).toBe(false);
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_2'))).data()?.addedBy).toBe('owner');
    expect((await getDoc(doc(d, 'groups', 'g', 'watchlist', 'movie_1', 'progress', 'owner'))).exists()).toBe(true);
    // Not this step's job: the uid stays in memberUids until the client cascade removes it.
    expect((await getDoc(doc(d, 'groups', 'g'))).data()?.memberUids).toEqual(['owner', 'me']);
    // An owned group belongs to the handover, not to this step.
    expect((await getDoc(doc(d, 'groups', 'mine', 'watchlist', 'movie_9'))).data()?.addedBy).toBe('me');
  });
});
