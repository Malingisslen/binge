import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

// Ångra veto (BIN-1490): participants/{pid} against the real rules. Lives in its own file
// so firestore-rules.test.ts, which is too large to open whole, stays unchanged.

const PROJECT_ID = 'binge-rules-test-veto-undo';
const OWNER = 'owner_uid';
const ANON1 = '0123456789abcdef0123456789abcdef';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
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

// BIN-1490 "Ångra veto": a signed-in participant on their OWN slot may restore
// a spent veto (0 → 1). Anonymous slots keep the count-down-only ratchet,
// because an anon caller cannot change the vote the veto was spent on.
describe('sessions/{id}/participants — ångra veto restores the budget (BIN-1490)', () => {
  function spentSignedInSlot(uid: string) {
    return {
      uid, displayName: 'Spelare', providers: [], vetoRemaining: 0,
      isHost: false, joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp(),
    };
  }
  async function seedSpentOwnerSlot() {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      spentSignedInSlot(OWNER),
    ));
  }

  it('a signed-in participant may restore their own spent veto (0 → 1)', async () => {
    await seedSpentOwnerSlot();
    await assertSucceeds(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 1, lastActiveAt: serverTimestamp() },
    ));
  });

  it('an anonymous slot may NOT restore a spent veto', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { ...spentSignedInSlot(OWNER), uid: null },
    ));
    await assertFails(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 1, lastActiveAt: serverTimestamp() },
    ));
  });

  it('a signed-in caller on an anonymous slot (mid-session login) may NOT restore it', async () => {
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { ...spentSignedInSlot(OWNER), uid: null },
    ));
    await assertFails(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 1, lastActiveAt: serverTimestamp() },
    ));
  });

  it('a signed-in user may NOT restore the veto on someone else\'s slot', async () => {
    await seedSpentOwnerSlot();
    await assertFails(updateDoc(
      doc(otherDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 1, lastActiveAt: serverTimestamp() },
    ));
  });

  it('the restore is capped at 1 (vetoRemaining 2 is denied)', async () => {
    await seedSpentOwnerSlot();
    await assertFails(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 2, lastActiveAt: serverTimestamp() },
    ));
  });

  it('the restore may not also promote the slot to host', async () => {
    await seedSpentOwnerSlot();
    await assertFails(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 1, isHost: true },
    ));
  });

  it('the restore may not add a key outside the participant contract', async () => {
    await seedSpentOwnerSlot();
    await assertFails(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 1, lastVetoKey: 'movie_42' },
    ));
  });

  it('a signed-in slot whose stored vetoRemaining is junk can still be restored to 1', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`sessions/s1/participants/${OWNER}`).set({
        uid: OWNER, displayName: 'Spelare', providers: [],
        vetoRemaining: 'many', isHost: false,
      });
    });
    await assertSucceeds(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 1, lastActiveAt: serverTimestamp() },
    ));
  });

  it('spending the veto (1 → 0) still works for both slot kinds', async () => {
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { ...spentSignedInSlot(OWNER), vetoRemaining: 1 },
    ));
    await assertSucceeds(updateDoc(
      doc(ownerDb(), 'sessions', 's1', 'participants', OWNER),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
    await assertSucceeds(setDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { ...spentSignedInSlot(OWNER), uid: null, vetoRemaining: 1 },
    ));
    await assertSucceeds(updateDoc(
      doc(anonDb(), 'sessions', 's1', 'participants', ANON1),
      { vetoRemaining: 0, lastActiveAt: serverTimestamp() },
    ));
  });
});
