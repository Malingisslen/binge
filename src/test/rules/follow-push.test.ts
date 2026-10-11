import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

// "Någon följer dig nu" — followPushes/{recipient}_{follower} and followPushes/{recipient}
// are the notice brake onFollowCreate stamps through the Admin SDK. Against the real
// rules: no client, not even the recipient or the follower the marker names, may read
// or write one. Every denial runs against a seeded document, so a denied get is the rule
// and not a missing doc.

const PROJECT_ID = 'binge-rules-test-follow-push';
// No underscores: a real Firebase uid has none, and the pair id joins on '_'.
const RECIPIENT = 'recipientuid';
const FOLLOWER = 'followeruid';
const PAIR_ID = `${RECIPIENT}_${FOLLOWER}`;

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
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'followPushes', PAIR_ID), { lastPushedAt: Timestamp.now() });
    await setDoc(doc(db, 'followPushes', RECIPIENT), {
      windowStartedAt: Timestamp.now(), count: 1, lastPushedAt: Timestamp.now(),
    });
  });
});

const CLIENTS = [
  ['the recipient', () => testEnv.authenticatedContext(RECIPIENT).firestore()],
  ['the follower', () => testEnv.authenticatedContext(FOLLOWER).firestore()],
  ['an anonymous visitor', () => testEnv.unauthenticatedContext().firestore()],
] as const;

describe('followPushes is sealed to clients (emulator)', () => {
  it('the rules block for followPushes is exactly a deny-all', () => {
    const rules = readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const block = rules.match(/match \/followPushes\/\{id\} \{([^}]*)\}/);
    expect(block, 'match /followPushes/{id} saknas i firestore.rules').not.toBeNull();
    const statements = block![1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    expect(statements).toEqual(['allow read, write: if false;']);
  });

  it.each(CLIENTS)('%s cannot read the pair marker or the cap marker', async (_who, db) => {
    await assertFails(getDoc(doc(db(), 'followPushes', PAIR_ID)));
    await assertFails(getDoc(doc(db(), 'followPushes', RECIPIENT)));
  });

  it.each(CLIENTS)('%s cannot list the collection', async (_who, db) => {
    await assertFails(getDocs(collection(db(), 'followPushes')));
  });

  // Rewinding the stamp would let a follow loop notify again; pushing it forward would
  // silence a real notice.
  it.each(CLIENTS)('%s cannot overwrite a marker', async (_who, db) => {
    await assertFails(setDoc(doc(db(), 'followPushes', PAIR_ID), { lastPushedAt: Timestamp.fromMillis(0) }));
    await assertFails(setDoc(doc(db(), 'followPushes', RECIPIENT), { count: 0 }, { merge: true }));
  });

  it.each(CLIENTS)('%s cannot delete a marker', async (_who, db) => {
    await assertFails(deleteDoc(doc(db(), 'followPushes', PAIR_ID)));
  });

  it('a client cannot create a marker that does not exist yet', async () => {
    const db = testEnv.authenticatedContext(FOLLOWER).firestore();
    await assertFails(setDoc(doc(db, 'followPushes', `othername_${FOLLOWER}`), { lastPushedAt: Timestamp.now() }));
  });

  it('the seeded markers exist — the denials above are the rule, not a missing doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      expect((await getDoc(doc(db, 'followPushes', PAIR_ID))).exists()).toBe(true);
      expect((await getDoc(doc(db, 'followPushes', RECIPIENT))).exists()).toBe(true);
    });
  });
});
