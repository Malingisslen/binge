import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where, type Firestore,
} from 'firebase/firestore';
import { buildSessionInviteFields, sessionInviteDocId } from '@/lib/sessionInvites';

// Bjud in till Tillsammans — users/{recipient}/sessionInvites/{sessionId}_{fromUid} and
// sessionInvitePushes/{id} against the real rules. The payloads come from
// `buildSessionInviteFields`, the builder the app writes with, so an allowed case proves
// the app's own write passes.
//
// Every denial below starts from a fixture where every OTHER clause holds (a live
// session hosted by the sender, a friendship in the recipient's tree, no block either
// way, profiles for the setting and the name get()), so the clause a test names is the
// one that refuses.

const PROJECT_ID = 'binge-rules-test-session-invites';
// No underscores: a real Firebase uid has none, and the doc id joins on '_'.
const HOST = 'hostuid';
const RECIPIENT = 'recipientuid';
const STRANGER = 'strangeruid';
const SESSION = 'Sess1onAbc';
const GROUP_SESSION = 'GroupSess1on';
const GROUP = 'grp1';

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

const inOneDay = () => Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, 'users', RECIPIENT), { displayName: 'Rut' });
    await setDoc(doc(db, 'users', HOST), { displayName: 'Hanna' });
    await setDoc(doc(db, 'users', STRANGER), { displayName: 'Sten' });
    await setDoc(doc(db, 'users', RECIPIENT, 'friends', HOST), { uid: HOST, since: Timestamp.now() });
    await setDoc(doc(db, 'users', HOST, 'friends', RECIPIENT), { uid: RECIPIENT, since: Timestamp.now() });
    await setDoc(doc(db, 'sessions', SESSION), { hostUid: HOST, groupId: null, expiresAt: inOneDay() });
  });
});

async function seed(fn: (db: Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore() as unknown as Firestore); });
}

function dbAs(uid: string) { return testEnv.authenticatedContext(uid).firestore(); }

function payload(over: Record<string, unknown> = {}, sessionId = SESSION, fromUid = HOST) {
  return {
    ...buildSessionInviteFields({ fromUid, fromName: 'Hanna', sessionId }),
    createdAt: serverTimestamp(),
    ...over,
  };
}

function inviteRef(asUid: string, id = sessionInviteDocId(SESSION, HOST), recipient = RECIPIENT) {
  return doc(dbAs(asUid), 'users', recipient, 'sessionInvites', id);
}

async function seedInvite() {
  await seed(async (db) => {
    await setDoc(
      doc(db, 'users', RECIPIENT, 'sessionInvites', sessionInviteDocId(SESSION, HOST)),
      { ...payload(), createdAt: Timestamp.now() },
    );
  });
}

describe('sessionInvites — who may invite', () => {
  it('the host of a live session can invite a confirmed friend', async () => {
    await assertSucceeds(setDoc(inviteRef(HOST), payload()));
  });

  it('an invite without a name is allowed', async () => {
    await assertSucceeds(setDoc(inviteRef(HOST), payload({ fromName: null })));
    const bare: Record<string, unknown> = payload();
    delete bare.fromName;
    await seed(async (db) => { await deleteDoc(doc(db, 'users', RECIPIENT, 'sessionInvites', sessionInviteDocId(SESSION, HOST))); });
    await assertSucceeds(setDoc(inviteRef(HOST), bare));
  });

  it('a signed-in non-friend outside the session group is denied', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', 'StrangerSess'), { hostUid: STRANGER, groupId: null, expiresAt: inOneDay() });
    });
    await assertFails(setDoc(
      inviteRef(STRANGER, sessionInviteDocId('StrangerSess', STRANGER)),
      payload({ fromName: 'Sten' }, 'StrangerSess', STRANGER),
    ));
  });

  it('a friendship only in the SENDER\'s tree is not enough', async () => {
    await seed(async (db) => { await deleteDoc(doc(db, 'users', RECIPIENT, 'friends', HOST)); });
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a recipient who blocked the host is not invited', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'blocked', HOST), { blockedAt: Timestamp.now() });
    });
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a host who blocked the recipient cannot invite them', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', HOST, 'blocked', RECIPIENT), { blockedAt: Timestamp.now() });
    });
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a block on somebody else does not stop the invite', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'blocked', STRANGER), { blockedAt: Timestamp.now() });
      await setDoc(doc(db, 'users', HOST, 'blocked', STRANGER), { blockedAt: Timestamp.now() });
    });
    await assertSucceeds(setDoc(inviteRef(HOST), payload()));
  });

  it('a recipient who turned invites off is not invited', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { sessionInviteNotify: false } }, { merge: true });
    });
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a recipient with the key true, or settings without the key, is invited', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { pushEnabled: true } }, { merge: true });
    });
    await assertSucceeds(setDoc(inviteRef(HOST), payload()));
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', 'SecondSess'), { hostUid: HOST, groupId: null, expiresAt: inOneDay() });
      await setDoc(doc(db, 'users', RECIPIENT), { notificationSettings: { sessionInviteNotify: true } }, { merge: true });
    });
    await assertSucceeds(setDoc(
      inviteRef(HOST, sessionInviteDocId('SecondSess', HOST)),
      payload({}, 'SecondSess'),
    ));
  });

  it('a signed-out client is denied', async () => {
    await assertFails(setDoc(
      doc(testEnv.unauthenticatedContext().firestore(), 'users', RECIPIENT, 'sessionInvites', sessionInviteDocId(SESSION, HOST)),
      payload(),
    ));
  });

  // A group session the host belongs to: the host shares the group with themselves, has
  // a profile and blocks nobody, so every clause but `uid != request.auth.uid` holds.
  it('nobody can invite themselves', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', GROUP), { memberUids: [HOST] });
      await setDoc(doc(db, 'groups', GROUP, 'members', HOST), { uid: HOST });
      await setDoc(doc(db, 'sessions', GROUP_SESSION), { hostUid: HOST, groupId: GROUP, expiresAt: inOneDay() });
    });
    await assertFails(setDoc(
      inviteRef(HOST, sessionInviteDocId(GROUP_SESSION, HOST), HOST),
      payload({}, GROUP_SESSION),
    ));
  });

  it('a friend who is not the host cannot invite to the session', async () => {
    // The stranger is the recipient's friend here, so only the host clause can refuse.
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'friends', STRANGER), { uid: STRANGER, since: Timestamp.now() });
    });
    await assertFails(setDoc(
      inviteRef(STRANGER, sessionInviteDocId(SESSION, STRANGER)),
      payload({ fromName: 'Sten' }, SESSION, STRANGER),
    ));
  });

  it('an expired session cannot be invited to', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', SESSION), { expiresAt: Timestamp.fromMillis(Date.now() - 1000) }, { merge: true });
    });
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a session that does not exist cannot be invited to', async () => {
    await assertFails(setDoc(inviteRef(HOST, sessionInviteDocId('NoSuchSess', HOST)), payload({}, 'NoSuchSess')));
  });
});

describe('sessionInvites — a shared group instead of a friendship', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await deleteDoc(doc(db, 'users', RECIPIENT, 'friends', HOST));
      await setDoc(doc(db, 'sessions', GROUP_SESSION), { hostUid: HOST, groupId: GROUP, expiresAt: inOneDay() });
      await setDoc(doc(db, 'groups', GROUP), { memberUids: [HOST, RECIPIENT] });
      await setDoc(doc(db, 'groups', GROUP, 'members', HOST), { uid: HOST });
      await setDoc(doc(db, 'groups', GROUP, 'members', RECIPIENT), { uid: RECIPIENT });
    });
  });

  const groupRef = (asUid = HOST) => inviteRef(asUid, sessionInviteDocId(GROUP_SESSION, HOST));

  it('a member of the session\'s group can be invited without being a friend', async () => {
    await assertSucceeds(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });

  it('a recipient outside the session\'s group is denied', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', GROUP), { memberUids: [HOST] });
      await deleteDoc(doc(db, 'groups', GROUP, 'members', RECIPIENT));
    });
    await assertFails(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });

  it('a host who has left the session\'s group cannot invite through it', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'groups', GROUP), { memberUids: [RECIPIENT] });
      await deleteDoc(doc(db, 'groups', GROUP, 'members', HOST));
    });
    await assertFails(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });

  // Leaving a group removes the uid from memberUids, and the members row can stay
  // behind. The row is left in place here so only memberUids can refuse.
  it('a host whose members row outlived their membership cannot invite through it', async () => {
    await seed(async (db) => { await setDoc(doc(db, 'groups', GROUP), { memberUids: [RECIPIENT] }); });
    await assertFails(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });

  it('a recipient whose members row outlived their membership is not invited through it', async () => {
    await seed(async (db) => { await setDoc(doc(db, 'groups', GROUP), { memberUids: [HOST] }); });
    await assertFails(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });

  it('a shared group does not help a session started without it', async () => {
    await assertFails(setDoc(inviteRef(HOST), payload()));
  });

  it('a group member the recipient blocked is still denied', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'users', RECIPIENT, 'blocked', HOST), { blockedAt: Timestamp.now() });
    });
    await assertFails(setDoc(groupRef(), payload({}, GROUP_SESSION)));
  });
});

describe('sessionInvites — identity binding', () => {
  it('a forged fromUid is denied', async () => {
    await assertFails(setDoc(inviteRef(STRANGER), payload()));
    await assertFails(setDoc(inviteRef(HOST), payload({ fromUid: STRANGER })));
  });

  it('a doc id that names another sender or session is denied', async () => {
    await assertFails(setDoc(inviteRef(HOST, sessionInviteDocId(SESSION, STRANGER)), payload()));
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', 'OtherSess'), { hostUid: HOST, groupId: null, expiresAt: inOneDay() });
    });
    await assertFails(setDoc(inviteRef(HOST, sessionInviteDocId('OtherSess', HOST)), payload()));
    await assertFails(setDoc(inviteRef(HOST, 'free-form-id'), payload()));
  });

  it('a session id outside the auto-id alphabet is denied', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', 'bad_id'), { hostUid: HOST, groupId: null, expiresAt: inOneDay() });
    });
    await assertFails(setDoc(inviteRef(HOST, sessionInviteDocId('bad_id', HOST)), payload({}, 'bad_id')));
  });

  it('a session id longer than 40 characters is denied', async () => {
    const long = 'a'.repeat(41);
    await seed(async (db) => {
      await setDoc(doc(db, 'sessions', long), { hostUid: HOST, groupId: null, expiresAt: inOneDay() });
    });
    await assertFails(setDoc(inviteRef(HOST, sessionInviteDocId(long, HOST)), payload({}, long)));
  });

  it('a name that is not the sender\'s own is denied', async () => {
    await assertFails(setDoc(inviteRef(HOST), payload({ fromName: 'Rut' })));
  });

  it('a name over 80 characters is denied even when the profile carries it', async () => {
    const long = 'x'.repeat(81);
    await seed(async (db) => { await setDoc(doc(db, 'users', HOST), { displayName: long }, { merge: true }); });
    await assertFails(setDoc(inviteRef(HOST), payload({ fromName: long })));
  });

  it('a name that is not a string is denied', async () => {
    await assertFails(setDoc(inviteRef(HOST), payload({ fromName: ['Hanna'] })));
  });
});

describe('sessionInvites — field whitelist', () => {
  it('an extra field is denied', async () => {
    await assertFails(setDoc(inviteRef(HOST), payload({ groupId: GROUP })));
  });

  it('a missing sessionId is denied', async () => {
    const rest: Record<string, unknown> = payload();
    delete rest.sessionId;
    await assertFails(setDoc(inviteRef(HOST), rest));
  });

  it('a client-chosen createdAt is denied', async () => {
    await assertFails(setDoc(inviteRef(HOST), payload({ createdAt: Timestamp.fromMillis(Date.UTC(2020, 0, 1)) })));
  });
});

describe('sessionInvites — update, delete and read', () => {
  it('nobody can update an invite, the host included', async () => {
    await seedInvite();
    await assertFails(setDoc(inviteRef(HOST), payload()));
    await assertFails(updateDoc(inviteRef(HOST), { fromName: deleteField() }));
    await assertFails(updateDoc(inviteRef(RECIPIENT), { fromName: deleteField() }));
  });

  it('the recipient can delete an invite', async () => {
    await seedInvite();
    await assertSucceeds(deleteDoc(inviteRef(RECIPIENT)));
  });

  it('neither the host nor a stranger can delete an invite', async () => {
    await seedInvite();
    await assertFails(deleteDoc(inviteRef(HOST)));
    await assertFails(deleteDoc(inviteRef(STRANGER)));
  });

  it('the recipient can read and list their invites', async () => {
    await seedInvite();
    await assertSucceeds(getDoc(inviteRef(RECIPIENT)));
    await assertSucceeds(getDocs(collection(dbAs(RECIPIENT), 'users', RECIPIENT, 'sessionInvites')));
  });

  it('the host cannot read the invite back, and a stranger cannot list them', async () => {
    await seedInvite();
    await assertFails(getDoc(inviteRef(HOST)));
    await assertFails(getDocs(collection(dbAs(HOST), 'users', RECIPIENT, 'sessionInvites')));
    await assertFails(getDocs(collection(dbAs(STRANGER), 'users', RECIPIENT, 'sessionInvites')));
  });
});

describe('sessionInvitePushes — the push brake marker', () => {
  const MARKER = `${RECIPIENT}_${HOST}`;
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'sessionInvitePushes', MARKER), {
        recipientUid: RECIPIENT, fromUid: HOST, lastPushedAt: Timestamp.now(),
      });
    });
  });

  it('the recipient and the sender can read and query their own markers', async () => {
    await assertSucceeds(getDoc(doc(dbAs(RECIPIENT), 'sessionInvitePushes', MARKER)));
    await assertSucceeds(getDoc(doc(dbAs(HOST), 'sessionInvitePushes', MARKER)));
    await assertSucceeds(getDocs(query(
      collection(dbAs(RECIPIENT), 'sessionInvitePushes'), where('recipientUid', '==', RECIPIENT),
    )));
    await assertSucceeds(getDocs(query(
      collection(dbAs(HOST), 'sessionInvitePushes'), where('fromUid', '==', HOST),
    )));
  });

  it('a third party cannot read or list them', async () => {
    await assertFails(getDoc(doc(dbAs(STRANGER), 'sessionInvitePushes', MARKER)));
    await assertFails(getDocs(collection(dbAs(STRANGER), 'sessionInvitePushes')));
    await assertFails(getDocs(query(
      collection(dbAs(STRANGER), 'sessionInvitePushes'), where('recipientUid', '==', RECIPIENT),
    )));
  });

  it('a signed-out client cannot read them', async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'sessionInvitePushes', MARKER)));
  });

  it('no client writes or deletes a marker, its own included', async () => {
    await assertFails(setDoc(doc(dbAs(RECIPIENT), 'sessionInvitePushes', MARKER), { lastPushedAt: Timestamp.now() }, { merge: true }));
    await assertFails(deleteDoc(doc(dbAs(RECIPIENT), 'sessionInvitePushes', MARKER)));
    await assertFails(deleteDoc(doc(dbAs(HOST), 'sessionInvitePushes', MARKER)));
    await assertFails(setDoc(doc(dbAs(HOST), 'sessionInvitePushes', `${STRANGER}_${HOST}`), {
      recipientUid: STRANGER, fromUid: HOST, lastPushedAt: Timestamp.now(),
    }));
  });
});
