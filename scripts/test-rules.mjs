// Firestore security-rules-test mot emulatorn. Körs via:
//   firebase emulators:exec --only firestore "node scripts/test-rules.mjs"
// Verifierar de säkerhetskritiska reglerna från granskningen (H1/M1/H2).
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'binge-nu-rulestest';
let passed = 0;
let failed = 0;

async function check(name, promise) {
  try {
    await promise;
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${err.message}`);
    failed++;
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
    host: '127.0.0.1',
    port: 8080,
  },
});

const alice = testEnv.authenticatedContext('alice').firestore();
const bob = testEnv.authenticatedContext('bob').firestore();
const mallory = testEnv.authenticatedContext('mallory').firestore();
const anon = testEnv.unauthenticatedContext().firestore();

// ---- seed ----
const GID = 'group1';
async function seedGroup(memberUids) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'groups', GID), {
      name: 'Filmklubben',
      ownerUid: 'alice',
      memberUids,
      defaults: { providerMode: 'intersect' },
      inviteTokenHash: 'abc123',
      inviteTokenRotatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

console.log('\n[H1] Grupp-medlemskap kräver samtycke');
await testEnv.clearFirestore();
await seedGroup(['alice']);

// Ägaren får INTE lägga till bob direkt (utan inbjudan).
await check('ägare kan inte tysta lägga till annan uid',
  assertFails(updateDoc(doc(alice, 'groups', GID), {
    memberUids: ['alice', 'bob'], updatedAt: 2,
  })));

// Ägaren får byta namn (memberUids oförändrad).
await check('ägare kan byta namn (memberUids oförändrad)',
  assertSucceeds(updateDoc(doc(alice, 'groups', GID), {
    name: 'Nytt namn', updatedAt: 2,
  })));

// Ägaren skapar en inbjudan till bob.
await check('ägare kan skapa inbjudan till bob',
  assertSucceeds(setDoc(doc(alice, 'users', 'bob', 'groupInvites', GID), {
    groupId: GID, groupName: 'Filmklubben', fromUid: 'alice',
    fromDisplayName: 'Alice', invitedAt: 1,
  })));

// En icke-ägare kan INTE skapa inbjudan.
await check('icke-ägare kan inte skapa inbjudan',
  assertFails(setDoc(doc(mallory, 'users', 'bob', 'groupInvites', GID), {
    groupId: GID, groupName: 'Filmklubben', fromUid: 'mallory',
    fromDisplayName: 'Mallory', invitedAt: 1,
  })));

// Bob accepterar (lägger till sig själv) — inbjudan finns.
await check('bob kan acceptera (self-add med inbjudan)',
  assertSucceeds(updateDoc(doc(bob, 'groups', GID), {
    memberUids: ['alice', 'bob'], updatedAt: 3,
  })));

// Bob utan inbjudan kan inte self-adda.
await testEnv.clearFirestore();
await seedGroup(['alice']);
await check('bob utan inbjudan kan inte self-adda',
  assertFails(updateDoc(doc(bob, 'groups', GID), {
    memberUids: ['alice', 'bob'], updatedAt: 2,
  })));

console.log('\n[M1] Följar-spegel kan inte forgas');
await testEnv.clearFirestore();
// Bob skriver followers-spegel på alice UTAN att följa → nekas.
await check('forgad följare nekas (ingen following-doc)',
  assertFails(setDoc(doc(bob, 'users', 'alice', 'followers', 'bob'), { followedAt: 1 })));

// Riktig follow: batch som skriver både following + followers → tillåts.
await check('riktig follow-batch tillåts (existsAfter)',
  assertSucceeds((async () => {
    const { writeBatch } = await import('firebase/firestore');
    const batch = writeBatch(bob);
    batch.set(doc(bob, 'users', 'bob', 'following', 'alice'), { followedAt: 1 });
    batch.set(doc(bob, 'users', 'alice', 'followers', 'bob'), { followedAt: 1 });
    await batch.commit();
  })()));

console.log('\n[H2] Session-skrivningar valideras (anonymt tillåtet)');
await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async ctx => {
  await setDoc(doc(ctx.firestore(), 'sessions', 's1'), {
    hostUid: 'alice', hostName: 'Alice', status: 'active', candidates: [],
  });
});

// Giltig anonym deltagar-create.
await check('anonym deltagare med giltiga fält tillåts',
  assertSucceeds(setDoc(doc(anon, 'sessions', 's1', 'participants', 'p1'), {
    uid: null, displayName: 'Gäst', providers: [8, 337],
    vetoRemaining: 1, isHost: false, joinedAt: 1, lastActiveAt: 1,
  })));

// Skräpfält nekas.
await check('deltagare med okänt fält nekas',
  assertFails(setDoc(doc(anon, 'sessions', 's1', 'participants', 'p2'), {
    uid: null, displayName: 'Gäst', providers: [8],
    vetoRemaining: 1, isHost: false, joinedAt: 1, lastActiveAt: 1,
    evil: 'x'.repeat(10000),
  })));

// För långt displayName nekas.
await check('deltagare med för långt displayName nekas',
  assertFails(setDoc(doc(anon, 'sessions', 's1', 'participants', 'p3'), {
    uid: null, displayName: 'x'.repeat(200), providers: [8],
    vetoRemaining: 1, isHost: false, joinedAt: 1, lastActiveAt: 1,
  })));

await testEnv.cleanup();

console.log(`\n${failed === 0 ? '✓ ALLA' : '✗'} ${passed} passerade, ${failed} misslyckades\n`);
process.exit(failed === 0 ? 0 : 1);
