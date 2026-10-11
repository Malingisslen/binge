import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, serverTimestamp, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { buildTipFields, tipDocId } from '@/lib/tips';

// Tipsa en vän — users/{recipient}/tips/{fromUid}_{mediaType}_{tmdbId} against the real
// rules. The payloads come from `buildTipFields`, the builder the app writes with, so an
// allowed case proves the app's own write passes.
//
// Every denial below starts from a fixture where every OTHER clause holds (friendship,
// no block, a recipient profile for the `acceptTips` get()), so the clause the test
// names is the one that refuses.

const PROJECT_ID = 'binge-rules-test-tips';
// No underscores: a real Firebase uid has none, and the doc id joins on '_'.
const SENDER = 'senderuid';
const RECIPIENT = 'recipientuid';
const STRANGER = 'strangeruid';

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
  await seed(async (db) => {
    await setDoc(doc(db, 'users', RECIPIENT), { displayName: 'R' });
    await setDoc(doc(db, 'users', RECIPIENT, 'friends', SENDER), { uid: SENDER, since: Timestamp.now() });
    await setDoc(doc(db, 'users', SENDER, 'friends', RECIPIENT), { uid: RECIPIENT, since: Timestamp.now() });
  });
});

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore() as unknown as Firestore); });
}

function dbAs(uid: string) { return testEnv.authenticatedContext(uid).firestore(); }

const ID = tipDocId(SENDER, 'movie', 603);

function payload(over: Record<string, unknown> = {}) {
  return {
    ...buildTipFields({ fromUid: SENDER, mediaType: 'movie', tmdbId: 603, title: 'The Matrix', note: 'Se den!' }),
    createdAt: serverTimestamp(),
    ...over,
  };
}

function tipRef(asUid: string, id = ID, recipient = RECIPIENT) {
  return doc(dbAs(asUid), 'users', recipient, 'tips', id);
}

async function seedTip() {
  await seed(async (db) => {
    await setDoc(doc(db, 'users', RECIPIENT, 'tips', ID), { ...payload(), createdAt: Timestamp.now() });
  });
}

describe('tips — who may write (Tipsa en vän)', () => {
  it('a confirmed friend can tip', async () => {
    await assertSucceeds(setDoc(tipRef(SENDER), payload()));
  });

  it('a tip without a note is allowed', async () => {
    const fields = buildTipFields({ fromUid: SENDER, mediaType: 'movie', tmdbId: 603, title: 'The Matrix', note: '   ' });
    await assertSucceeds(setDoc(tipRef(SENDER), { ...fields, createdAt: serverTimestamp() }));
  });

  it('a signed-in non-friend is denied', async () => {
    const id = tipDocId(STRANGER, 'movie', 603);
    await assertFails(setDoc(tipRef(STRANGER, id), payload({ fromUid: STRANGER })));
  });

  it('a friendship only in the SENDER\'s tree is not enough', async () => {
    await seed(async (db) => { await deleteDoc(doc(db, 'users', RECIPIENT, 'friends', SENDER)); });
    await assertFails(setDoc(tipRef(SENDER), payload()));
  });

  it('a friend the recipient has blocked is denied', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'blocked', SENDER), { blockedAt: Timestamp.now() });
    });
    await assertFails(setDoc(tipRef(SENDER), payload()));
  });

  it('a block on somebody else does not stop this friend', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'blocked', STRANGER), { blockedAt: Timestamp.now() });
    });
    await assertSucceeds(setDoc(tipRef(SENDER), payload()));
  });

  it('a recipient who turned tips off is not tipped', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { acceptTips: false } }, { merge: true });
    });
    await assertFails(setDoc(tipRef(SENDER), payload()));
  });

  it('a recipient with acceptTips true, or other settings but no acceptTips key, is tipped', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { pushEnabled: true } }, { merge: true });
    });
    await assertSucceeds(setDoc(tipRef(SENDER), payload()));
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { acceptTips: true } }, { merge: true });
    });
    await assertSucceeds(setDoc(tipRef(SENDER, tipDocId(SENDER, 'tv', 1399)), payload({ mediaType: 'tv', tmdbId: 1399 })));
  });

  it('a signed-out client is denied', async () => {
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users', RECIPIENT, 'tips', ID), payload()));
  });

  it('nobody can tip themselves', async () => {
    const id = tipDocId(RECIPIENT, 'movie', 603);
    await assertFails(setDoc(tipRef(RECIPIENT, id), payload({ fromUid: RECIPIENT })));
  });
});

describe('tips — identity binding', () => {
  it('a forged fromUid is denied', async () => {
    // The stranger is also a friend here, so only the forged field can refuse.
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'friends', STRANGER), { uid: STRANGER, since: Timestamp.now() });
    });
    await assertFails(setDoc(tipRef(STRANGER, ID), payload()));
    await assertFails(setDoc(tipRef(STRANGER, tipDocId(STRANGER, 'movie', 603)), payload()));
  });

  it('a doc id that names another sender is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER, tipDocId(STRANGER, 'movie', 603)), payload()));
  });

  it('a doc id that does not match the title fields is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER, tipDocId(SENDER, 'movie', 604)), payload()));
    await assertFails(setDoc(tipRef(SENDER, tipDocId(SENDER, 'tv', 603)), payload()));
    await assertFails(setDoc(tipRef(SENDER, 'free-form-id'), payload()));
  });
});

describe('tips — field whitelist and bounds', () => {
  it('an extra field is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ fromDisplayName: 'Malin' })));
  });

  it('a missing required field is denied', async () => {
    const rest: Record<string, unknown> = payload();
    delete rest.title;
    await assertFails(setDoc(tipRef(SENDER), rest));
  });

  it('a title over 200 characters is denied, and one at 200 is allowed', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ title: 'x'.repeat(201) })));
    await assertSucceeds(setDoc(tipRef(SENDER), payload({ title: 'x'.repeat(200) })));
  });

  it('an empty title is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ title: '' })));
  });

  it('a note over 140 characters is denied, and one at 140 is allowed', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ note: 'x'.repeat(141) })));
    await assertSucceeds(setDoc(tipRef(SENDER), payload({ note: 'x'.repeat(140) })));
  });

  it('a non-string note is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ note: null })));
    await assertFails(setDoc(tipRef(SENDER), payload({ note: { text: 'hej' } })));
  });

  it('a bad mediaType or tmdbId is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER, `${SENDER}_person_603`), payload({ mediaType: 'person' })));
    await assertFails(setDoc(tipRef(SENDER, `${SENDER}_movie_0`), payload({ tmdbId: 0 })));
    await assertFails(setDoc(tipRef(SENDER, `${SENDER}_movie_603`), payload({ tmdbId: '603' })));
  });

  // A fraction passes `> 0` and a matching id, so only `is int` can deny it.
  it('a fractional tmdbId is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER, `${SENDER}_movie_603.5`), payload({ tmdbId: 603.5 })));
  });

  // A list passes `.size() > 0` and `<= 200`, so only `is string` can deny it.
  it('a title that is not a string is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ title: ['x'] })));
  });

  it('a client-chosen createdAt is denied', async () => {
    await assertFails(setDoc(tipRef(SENDER), payload({ createdAt: Timestamp.fromMillis(Date.UTC(2020, 0, 1)) })));
  });
});

describe('tips — re-tip, delete and read', () => {
  it('the same friend re-tipping the same title overwrites it', async () => {
    await seedTip();
    await assertSucceeds(setDoc(tipRef(SENDER), payload({ note: 'Ny hälsning' })));
  });

  it('a re-tip after the friendship ended is denied', async () => {
    await seedTip();
    await seed(async (db) => { await deleteDoc(doc(db, 'users', RECIPIENT, 'friends', SENDER)); });
    await assertFails(setDoc(tipRef(SENDER), payload()));
  });

  it('a different sender cannot write over an existing tip', async () => {
    await seedTip();
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'friends', STRANGER), { uid: STRANGER, since: Timestamp.now() });
    });
    await assertFails(setDoc(tipRef(STRANGER), payload({ fromUid: STRANGER })));
    await assertFails(setDoc(tipRef(STRANGER), payload()));
  });

  it('the recipient can delete a tip', async () => {
    await seedTip();
    await assertSucceeds(deleteDoc(tipRef(RECIPIENT)));
  });

  it('neither the sender nor a stranger can delete a tip', async () => {
    await seedTip();
    await assertFails(deleteDoc(tipRef(STRANGER)));
    await assertFails(deleteDoc(tipRef(SENDER)));
  });

  it('the recipient can read and list their tips', async () => {
    await seedTip();
    await assertSucceeds(getDoc(tipRef(RECIPIENT)));
    await assertSucceeds(getDocs(collection(dbAs(RECIPIENT), 'users', RECIPIENT, 'tips')));
  });

  it('a stranger cannot read or list them', async () => {
    await seedTip();
    await assertFails(getDoc(tipRef(STRANGER)));
    await assertFails(getDocs(collection(dbAs(STRANGER), 'users', RECIPIENT, 'tips')));
  });

  it('the sender cannot read the recipient\'s tips either', async () => {
    await seedTip();
    await assertFails(getDoc(tipRef(SENDER)));
    await assertFails(getDocs(collection(dbAs(SENDER), 'users', RECIPIENT, 'tips')));
  });
});
