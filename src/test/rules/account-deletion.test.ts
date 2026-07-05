import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  assertFails, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as fsMod from 'firebase/firestore';

// userData.ts imports fsdb() from ./db, which eager-inits Firebase Auth (config.ts)
// and throws without web env. Stub it — the test always injects an emulator kit, so
// the real fsdb() is never called.
vi.mock('../../lib/firebase/db', () => ({ fsdb: vi.fn() }));

import { collectUserDataSnapshots, KNOWN_USER_SUBCOLLECTIONS } from '../../lib/firebase/userData';
import { collectDeletionRefs, applyDeletionPlan } from '../../lib/firebase/accountDeletion';

/**
 * BIN-347 Part 2 — the load-bearing erasure proof.
 *
 * Seeds a representative account into EVERY owner-owned collection (plus nested
 * UGC, mirrored social-graph docs, and the deliberately-retained `reports`),
 * then runs the REAL extracted cascade (collectUserDataSnapshots →
 * collectDeletionRefs → applyDeletionPlan) against the Firestore emulator as the
 * authenticated owner, and asserts each `deleteCascade:true` collection is empty
 * while the documented carve-outs survive. This catches the runtime gap the
 * static guards can't: a ref that's *referenced* but never reaches batch.delete()
 * (or one a rule silently blocks).
 */

const PROJECT_ID = 'binge-deletion-test';
const ME = 'me_uid';
const OTHER = 'other_uid';
const MY_NAME = 'myname';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      host, port: Number(port),
    },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

/** The injectable kit: real firebase/firestore functions + the authed owner's db.
 *  The rules-unit-testing Firestore is structurally compatible at runtime but
 *  carries a different nominal type, so cast it. */
function meDb() {
  return testEnv.authenticatedContext(ME).firestore() as unknown as fsMod.Firestore;
}
function meKit() {
  return { ...fsMod, db: meDb() };
}

/** Run the real extracted deletion cascade as the authenticated owner. */
async function runDeletion() {
  const kit = meKit();
  const snaps = await collectUserDataSnapshots(ME, kit);
  const plan = await collectDeletionRefs(kit, ME, snaps);
  await applyDeletionPlan(kit, plan);
}

/** Seed with rules bypassed so we can write cross-user + admin-owned docs. */
async function seed(fn: (db: fsMod.Firestore) => Promise<void>) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await fn(ctx.firestore() as unknown as fsMod.Firestore);
  });
}

/** Read a doc with rules bypassed (for post-deletion assertions). */
async function exists(path: [string, ...string[]]): Promise<boolean> {
  let found = false;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore() as unknown as fsMod.Firestore;
    const snap = await fsMod.getDoc(fsMod.doc(db, ...(path as [string, string])));
    found = snap.exists();
  });
  return found;
}

/** Count docs in a collection with rules bypassed. */
async function count(path: [string, ...string[]]): Promise<number> {
  let n = 0;
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore() as unknown as fsMod.Firestore;
    const snap = await fsMod.getDocs(fsMod.collection(db, ...(path as [string, string])));
    n = snap.size;
  });
  return n;
}

/** Seed exactly one doc into every owner-owned subcollection + the wider graph. */
async function seedFullAccount() {
  await seed(async db => {
    const set = (p: [string, ...string[]], data: Record<string, unknown>) =>
      fsMod.setDoc(fsMod.doc(db, ...(p as [string, string])), data);

    // Profile + username reservation + admin-owned weeklyDigestState marker.
    await set(['users', ME], { username: MY_NAME, displayName: 'Me', isPublic: false });
    await set(['usernames', MY_NAME], { uid: ME });
    await set(['weeklyDigestState', ME], { lastSentDay: '2026-01-01' });

    // Every users/{me}/<subcol> — one doc each.
    await set(['users', ME, 'watchlist', '603'], { tmdbId: 603 });
    await set(['users', ME, 'watchlistTags', '603'], { tags: ['mysrys'] });
    await set(['users', ME, 'episodeProgress', '1399'], { tmdbId: 1399 });
    await set(['users', ME, 'notInterested', '500'], { tmdbId: 500 });
    await set(['users', ME, 'notifications', 'n1'], { kind: 'x' });
    await set(['users', ME, 'blocked', OTHER], { at: 1 });
    await set(['users', ME, 'pauseHistory', 'p1'], { providerId: 8 });
    await set(['users', ME, 'listFollows', 'L1'], { listOwnerUid: OTHER });
    await set(['users', ME, 'fcmTokens', 't1'], { token: 'abc' });
    await set(['users', ME, 'reportMeta', 'rm'], { lastReportAt: 1 });
    await set(['users', ME, 'askBingeMeta', 'am'], { count: 1 });
    await set(['users', ME, 'following', OTHER], { at: 1 });
    await set(['users', OTHER, 'followers', ME], { at: 1 });           // mirror of my outbound follow
    await set(['users', ME, 'followers', OTHER], { at: 1 });           // OTHER follows me — survives (OTHER-owned)
    await set(['users', ME, 'friends', OTHER], { since: 1 });
    await set(['users', OTHER, 'friends', ME], { since: 1 });          // friend mirror
    await set(['users', ME, 'friendRequests', OTHER], { fromUid: OTHER });
    await set(['users', OTHER, 'friendRequestsSent', ME], { toUid: ME }); // mirror of incoming
    await set(['users', ME, 'friendRequestsSent', OTHER], { toUid: OTHER });
    await set(['users', OTHER, 'friendRequests', ME], { fromUid: ME });   // mirror of outgoing
    await set(['users', ME, 'groupInvites', 'G1'], { fromUid: OTHER });

    // My review + a like/comment OTHER left on it (like carries uid == doc-id).
    await set(['reviews', 'myrev'], { uid: ME, tmdbId: 1 });
    await set(['reviews', 'myrev', 'likes', OTHER], { uid: OTHER, createdAt: 1 });
    await set(['reviews', 'myrev', 'comments', 'c1'], { uid: OTHER, text: 'hi' });

    // My like/comment/reaction on OTHER's review — must be erased; OTHER's review survives.
    // The like is found via the collection-group `where('uid','==',ME)` query (BIN-347).
    await set(['reviews', 'otherrev'], { uid: OTHER, tmdbId: 2 });
    await set(['reviews', 'otherrev', 'likes', ME], { uid: ME, createdAt: 1 });
    await set(['reviews', 'otherrev', 'comments', 'mycomment'], { uid: ME, text: 'mine' });
    await set(['episodeReactions', 'show_1_2', 'reactions', 'myreaction'], { uid: ME, emoji: '🔥' });

    // My list + a list I co-edit (owned by OTHER) — co-edit doc survives, my uid stripped.
    // isPublic is required (the lists read rule accesses it via dot-notation, so a
    // doc lacking it errors the rule — real lists always carry it via isValidList).
    await set(['lists', 'mylist'], { uid: ME, editors: [ME], isPublic: false });
    await set(['lists', 'otherlist'], { uid: OTHER, editors: [OTHER, ME], isPublic: false });

    // My hosted session + its subcollections.
    await set(['sessions', 'mysession'], { hostUid: ME });
    await set(['sessions', 'mysession', 'participants', 'p1'], { uid: ME });
    await set(['sessions', 'mysession', 'swipes', '603'], { uid: ME });

    // A group I OWN (full delete) + a group I'm a MEMBER of (leave only).
    // name + defaults are required: the member-leave update rule pins them via
    // dot-notation equality, so a group lacking them errors the rule (real groups
    // always carry them).
    await set(['groups', 'mygroup'], { ownerUid: ME, memberUids: [ME, OTHER], name: 'Mine', defaults: {} });
    await set(['groups', 'mygroup', 'members', ME], { uid: ME });
    await set(['groups', 'mygroup', 'watchlist', 'w1'], { tmdbId: 1 });
    await set(['groups', 'mygroup', 'watchlist', 'w1', 'progress', ME], { season: 1 });
    await set(['groups', 'mygroup', 'sessionHistory', 'sh1'], { pickedByUid: ME });
    await set(['groups', 'mygroup', 'joinAttempts', ME], { token: 'plain' });
    // BIN-184: hushålls-bidrag i den ägda gruppen — MEDVETET utan ME:s eget doc:
    // ägaren har INTE opt:at in (launch-fallet för varje befintlig ägare). Detta
    // är exakt scenariot som maskerades innan xhigh-reviewen: en list-query här
    // nekades av share-to-see-reglerna och fick HELA raderingen att kasta. Nu
    // härleds refs ur medlems-id:na, så OTHERS doc raderas ändå.
    await set(['groups', 'mygroup', 'members', OTHER], { uid: OTHER });
    await set(['groups', 'mygroup', 'household', OTHER], { providerIds: [337], providerCosts: { 337: 109 }, providerCampaigns: {}, activeProviderIds: [] });

    await set(['groups', 'othergroup'], { ownerUid: OTHER, memberUids: [OTHER, ME], name: 'Theirs', defaults: {} });
    await set(['groups', 'othergroup', 'members', ME], { uid: ME });
    await set(['groups', 'othergroup', 'watchlist', 'w2'], { tmdbId: 2 });
    await set(['groups', 'othergroup', 'watchlist', 'w2', 'progress', ME], { season: 1 });
    await set(['groups', 'othergroup', 'joinAttempts', ME], { token: 'plain2' });
    // BIN-184: mitt bidrag i gruppen jag bara är medlem i (member-grenen) —
    // OTHERS bidrag där ska överleva (deras data, deras grupp).
    await set(['groups', 'othergroup', 'household', ME], { providerIds: [8], providerCosts: { 8: 169 }, providerCampaigns: {}, activeProviderIds: [] });
    await set(['groups', 'othergroup', 'household', OTHER], { providerIds: [337], providerCosts: { 337: 109 }, providerCampaigns: {}, activeProviderIds: [] });

    // A report I filed — retained under Art. 17(3).
    await set(['reports', 'rep1'], {
      reporterUid: ME, targetType: 'review', targetId: 'x', reason: 'spam',
    });
  });
}

describe('GDPR account-deletion erasure (BIN-347 Part 2)', () => {
  it('erases every owner-owned subcollection while the documented carve-outs survive', async () => {
    await seedFullAccount();
    await runDeletion();

    // 1. Every owner-owned users/{me}/* subcollection empty — EXCEPT followers,
    //    whose docs are owned by the follower (the account holder can't delete them).
    for (const sub of KNOWN_USER_SUBCOLLECTIONS) {
      const remaining = await count(['users', ME, sub]);
      if (sub === 'followers') {
        expect(remaining, 'inbound followers are follower-owned → must survive').toBe(1);
      } else {
        expect(remaining, `users/${ME}/${sub} should be erased`).toBe(0);
      }
    }

    // 2. Profile doc, username reservation, and weeklyDigestState marker gone.
    expect(await exists(['users', ME]), 'profile doc erased').toBe(false);
    expect(await exists(['usernames', MY_NAME]), 'username reservation released').toBe(false);
    expect(await exists(['weeklyDigestState', ME]), 'weeklyDigestState marker erased').toBe(false);

    // 3. Mirrored social-graph docs on the counterparty reconciled (no dangling uid).
    expect(await exists(['users', OTHER, 'followers', ME]), 'follow mirror erased').toBe(false);
    expect(await exists(['users', OTHER, 'friends', ME]), 'friend mirror erased').toBe(false);
    expect(await exists(['users', OTHER, 'friendRequestsSent', ME]), 'incoming-req mirror erased').toBe(false);
    expect(await exists(['users', OTHER, 'friendRequests', ME]), 'outgoing-req mirror erased').toBe(false);

    // 4. My reviews + their subcollections gone.
    expect(await exists(['reviews', 'myrev']), 'my review erased').toBe(false);
    expect(await count(['reviews', 'myrev', 'likes']), 'likes on my review erased').toBe(0);
    expect(await count(['reviews', 'myrev', 'comments']), 'comments on my review erased').toBe(0);

    // 5. My nested UGC on OTHERS' reviews gone; OTHER's review itself survives.
    expect(await exists(['reviews', 'otherrev']), "other's review survives").toBe(true);
    expect(await exists(['reviews', 'otherrev', 'likes', ME]), 'my like on their review erased').toBe(false);
    expect(await exists(['reviews', 'otherrev', 'comments', 'mycomment']), 'my comment erased').toBe(false);
    expect(await exists(['episodeReactions', 'show_1_2', 'reactions', 'myreaction']), 'my reaction erased').toBe(false);

    // 6. Lists: mine deleted; the one I co-edit survives with my uid stripped from editors.
    expect(await exists(['lists', 'mylist']), 'my list erased').toBe(false);
    expect(await exists(['lists', 'otherlist']), "co-edited list survives").toBe(true);

    // 7. Hosted session + subcollections gone.
    expect(await exists(['sessions', 'mysession']), 'hosted session erased').toBe(false);
    expect(await count(['sessions', 'mysession', 'participants']), 'session participants erased').toBe(0);
    expect(await count(['sessions', 'mysession', 'swipes']), 'session swipes erased').toBe(0);

    // 8. Group I own fully deleted (incl. ALL its subcollections — Firestore does
    //    not cascade subcollection deletes, so each must be erased explicitly);
    //    group I'm a member of survives but I've left.
    expect(await exists(['groups', 'mygroup']), 'owned group erased').toBe(false);
    expect(await count(['groups', 'mygroup', 'members']), 'owned-group members erased').toBe(0);
    expect(await count(['groups', 'mygroup', 'watchlist']), 'owned-group watchlist erased').toBe(0);
    expect(await exists(['groups', 'mygroup', 'watchlist', 'w1', 'progress', ME]), 'owned-group watchlist progress erased').toBe(false);
    expect(await exists(['groups', 'mygroup', 'sessionHistory', 'sh1']), 'owned-group sessionHistory erased').toBe(false);
    expect(await exists(['groups', 'mygroup', 'joinAttempts', ME]), 'owned-group joinAttempts erased').toBe(false);
    // BIN-184: owner-grenen raderar HELA household-collectionen (alla medlemmars bidrag).
    expect(await count(['groups', 'mygroup', 'household']), 'owned-group household erased (BIN-184)').toBe(0);
    expect(await exists(['groups', 'othergroup']), 'member group survives').toBe(true);
    expect(await exists(['groups', 'othergroup', 'members', ME]), 'my member doc removed').toBe(false);
    expect(await exists(['groups', 'othergroup', 'joinAttempts', ME]), 'my joinAttempt erased (BIN-329)').toBe(false);
    expect(await exists(['groups', 'othergroup', 'watchlist', 'w2', 'progress', ME]), 'my group progress erased').toBe(false);
    // BIN-184: member-grenen raderar MITT bidrag; OTHERS bidrag i deras grupp överlever.
    expect(await exists(['groups', 'othergroup', 'household', ME]), 'my household contribution erased (BIN-184)').toBe(false);
    expect(await exists(['groups', 'othergroup', 'household', OTHER]), "other's household contribution survives").toBe(true);

    // 9. reports retained — Art. 17(3) carve-out (reporterUid intact).
    expect(await exists(['reports', 'rep1']), 'moderation report retained (Art. 17(3))').toBe(true);
  });

  it('strips my uid from a co-edited list and from a member-group memberUids (array reconcile)', async () => {
    await seedFullAccount();
    await runDeletion();

    let otherListEditors: unknown[] = ['unset'];
    let memberUids: unknown[] = ['unset'];
    await testEnv.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore() as unknown as fsMod.Firestore;
      otherListEditors = (await fsMod.getDoc(fsMod.doc(db, 'lists', 'otherlist'))).data()?.editors ?? [];
      memberUids = (await fsMod.getDoc(fsMod.doc(db, 'groups', 'othergroup'))).data()?.memberUids ?? [];
    });
    expect(otherListEditors, 'my uid stripped from co-edited list editors[]').toEqual([OTHER]);
    expect(memberUids, 'my uid removed from member-group memberUids[]').toEqual([OTHER]);
  });

  it('rules BLOCK a client delete on followers (follower-owned) and reports (retained)', async () => {
    await seedFullAccount();
    const db = meDb();
    // Survival must be by RULE, not merely because the cascade skipped them.
    await assertFails(fsMod.deleteDoc(fsMod.doc(db, 'users', ME, 'followers', OTHER)));
    await assertFails(fsMod.deleteDoc(fsMod.doc(db, 'reports', 'rep1')));
  });

  it('flushes every chunk when a subcollection exceeds the 450-op batch limit', async () => {
    await seed(async db => {
      await fsMod.setDoc(fsMod.doc(db, 'users', ME), { username: null });
      // 460 > DELETION_CHUNK (450) → forces the watchlist deletes across ≥2 batches.
      const writes: Promise<unknown>[] = [];
      for (let i = 0; i < 460; i++) {
        writes.push(fsMod.setDoc(fsMod.doc(db, 'users', ME, 'watchlist', `m${i}`), { tmdbId: i }));
      }
      await Promise.all(writes);
    });
    expect(await count(['users', ME, 'watchlist']), 'seeded 460 watchlist docs').toBe(460);

    await runDeletion();

    expect(await count(['users', ME, 'watchlist']), 'all 460 flushed across chunks').toBe(0);
    expect(await exists(['users', ME]), 'profile doc erased in same run').toBe(false);
  });
});
