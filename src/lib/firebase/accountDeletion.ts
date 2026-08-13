import type { DocumentReference } from 'firebase/firestore';
import type { FirestoreKit } from './db';
import type { UserDataSnapshots } from './userData';
import { markCascadePartial } from '../authErrors';

/**
 * Account-deletion cascade, extracted from `AuthContext.deleteAccount` (BIN-347)
 * so the Art. 17 erasure path can be exercised end-to-end against the Firestore
 * emulator (`src/test/rules/account-deletion.test.ts`).
 *
 * Split into two db-injectable halves:
 *  - `collectDeletionRefs` — the pure PLAN (every ref to delete + the member/
 *    editor-array updates), no side effects beyond the reads it needs.
 *  - `applyDeletionPlan` — the chunked-commit half (≤450-op batches).
 *
 * `deleteAccount` keeps only the auth-bound tail (`deleteUser` + cache clear).
 * Behaviour MUST stay identical to the inline version this replaced — the
 * emulator test is the runtime proof.
 */

/** The Firestore surface the plan-builder reads through (a superset is fine). */
export type DeletionReadKit = Pick<
  FirestoreKit,
  'db' | 'doc' | 'getDocs' | 'collection' | 'query' | 'where'
>;
/** The Firestore surface the committer writes through. */
export type DeletionWriteKit = Pick<FirestoreKit, 'db' | 'writeBatch' | 'serverTimestamp'>;

export interface MemberLeaveUpdate {
  ref: DocumentReference;
  newMemberUids: string[];
}
export interface EditorLeaveUpdate {
  ref: DocumentReference;
  newEditors: string[];
}
export interface DeletionPlan {
  refs: DocumentReference[];
  memberLeaveUpdates: MemberLeaveUpdate[];
  editorLeaveUpdates: EditorLeaveUpdate[];
}

/**
 * Build the full set of DocumentReferences to delete + the member/editor-array
 * updates for erasing user `id`, given their data snapshots. Does NOT commit,
 * delete the auth user, or clear the cache.
 *
 * The per-review (likes/comments), per-session (participants/swipes) and
 * per-group (members/watchlist/progress/sessionHistory) reads are awaited
 * directly and never swallowed — a read failure throws and aborts deletion
 * rather than letting it report a clean wipe over data it never saw.
 */
export async function collectDeletionRefs(
  fs: DeletionReadKit,
  id: string,
  snaps: UserDataSnapshots,
): Promise<DeletionPlan> {
  const { db, doc, getDocs, collection } = fs;
  const refs: DocumentReference[] = [];

  // 1. Simple per-user subcollections.
  snaps.watchlistSnap.docs.forEach(d => refs.push(d.ref));
  // BIN-164: owner-only per-title tags — deleted with the account (never orphaned).
  snaps.watchlistTagsSnap.docs.forEach(d => refs.push(d.ref));
  // BIN-505: owner-only per-title notes — deleted with the account (never orphaned).
  snaps.watchlistNotesSnap.docs.forEach(d => refs.push(d.ref));
  snaps.episodeProgressSnap.docs.forEach(d => refs.push(d.ref));
  snaps.notificationsSnap.docs.forEach(d => refs.push(d.ref));
  snaps.notInterestedSnap.docs.forEach(d => refs.push(d.ref));
  snaps.blockedSnap.docs.forEach(d => refs.push(d.ref));
  // Sparbeslut-historik (Streamingrådgivaren).
  snaps.pauseHistorySnap.docs.forEach(d => refs.push(d.ref));
  // Följda listor (BIN-96) — ägar-ägda.
  snaps.listFollowsSnap.docs.forEach(d => refs.push(d.ref));
  // FCM-tokens — sluta skicka push till raderad användare.
  snaps.fcmTokensSnap.docs.forEach(d => refs.push(d.ref));
  // Report-throttle (BIN-25) + Fråga Binge throttle.
  snaps.reportMetaSnap.docs.forEach(d => refs.push(d.ref));
  snaps.askBingeMetaSnap.docs.forEach(d => refs.push(d.ref));

  // 2. Outbound follows: delete own "following" + mirror "followers" on target.
  snaps.followingSnap.docs.forEach(d => {
    refs.push(d.ref);
    refs.push(doc(db, 'users', d.id, 'followers', id));
  });
  // 2b. Friends — both directions (mirror on their side).
  snaps.friendsSnap.docs.forEach(d => {
    refs.push(d.ref);
    refs.push(doc(db, 'users', d.id, 'friends', id));
  });
  // 2c. Pending requests (incoming + outgoing) — both directions.
  snaps.friendRequestsSnap.docs.forEach(d => {
    refs.push(d.ref);
    refs.push(doc(db, 'users', d.id, 'friendRequestsSent', id));
  });
  snaps.friendRequestsSentSnap.docs.forEach(d => {
    refs.push(d.ref);
    refs.push(doc(db, 'users', d.id, 'friendRequests', id));
  });
  // 2d. Inkomna grupp-inbjudningar.
  snaps.groupInvitesSnap.docs.forEach(d => refs.push(d.ref));

  // 3. My reviews + all their subcollections (likes + comments on my reviews).
  for (const reviewDoc of snaps.reviewsSnap.docs) {
    const [likesSnap, commentsSnap] = await Promise.all([
      getDocs(collection(db, 'reviews', reviewDoc.id, 'likes')),
      getDocs(collection(db, 'reviews', reviewDoc.id, 'comments')),
    ]);
    likesSnap.docs.forEach(d => refs.push(d.ref));
    commentsSnap.docs.forEach(d => refs.push(d.ref));
    refs.push(reviewDoc.ref);
  }

  // 4. My comments + likes on OTHERS' reviews + episode reactions (collection-group).
  snaps.reviewCommentsSnap.docs.forEach(d => refs.push(d.ref));
  snaps.reviewLikesSnap.docs.forEach(d => refs.push(d.ref));
  snaps.episodeReactionsSnap.docs.forEach(d => refs.push(d.ref));

  // 5. My lists + hosted Tillsammans-sessions (participants/swipes before the doc).
  snaps.listsSnap.docs.forEach(d => refs.push(d.ref));
  for (const sessionDoc of snaps.sessionsSnap.docs) {
    const [participantsSnap, swipesSnap] = await Promise.all([
      getDocs(collection(db, 'sessions', sessionDoc.id, 'participants')),
      getDocs(collection(db, 'sessions', sessionDoc.id, 'swipes')),
    ]);
    participantsSnap.docs.forEach(d => refs.push(d.ref));
    swipesSnap.docs.forEach(d => refs.push(d.ref));
    refs.push(sessionDoc.ref);
  }

  // INTENTIONALLY NOT cascaded: reports/{reportId}. Moderation reports store
  // reporterUid but are deliberately retained under GDPR Art. 17(3); rules set
  // `allow delete: if false`. See docs/data-retention-policy.md (BIN-277) — do
  // not "fix" this as a missing-cascade bug.

  // 6. Groups: owner → delete the whole group + subcollections; member → leave
  //    (strip self from memberUids + delete my member doc + my progress).
  const memberLeaveUpdates: MemberLeaveUpdate[] = [];
  for (const groupDoc of snaps.groupsSnap.docs) {
    // BIN-329: erase any joinAttempts/{myUid} (holds a plaintext invite token).
    refs.push(doc(db, 'groups', groupDoc.id, 'joinAttempts', id));
    const data = groupDoc.data();
    const ownerUid = data.ownerUid as string | undefined;
    if (ownerUid === id) {
      const [membersSnap, groupWatchlistSnap, sessionHistorySnap] = await Promise.all([
        getDocs(collection(db, 'groups', groupDoc.id, 'members')),
        getDocs(collection(db, 'groups', groupDoc.id, 'watchlist')),
        getDocs(collection(db, 'groups', groupDoc.id, 'sessionHistory')),
      ]);
      membersSnap.docs.forEach(d => refs.push(d.ref));
      sessionHistorySnap.docs.forEach(d => refs.push(d.ref));
      // BIN-184: hushålls-refs härleds ur MEDLEMS-id:na — ALDRIG via en list-
      // query, som share-to-see-reglerna nekar för en ägare som inte själv delar
      // (xhigh-review 2026-07-05: list-nekandet fick hela raderingen att kasta).
      // batch.delete på icke-existerande docs är no-ops, och household ⊆ members
      // (removeMember + member-grenen nedan städar vid utträde) → full täckning.
      const householdUids = new Set<string>(membersSnap.docs.map(d => d.id));
      householdUids.add(id);
      householdUids.forEach(u => refs.push(doc(db, 'groups', groupDoc.id, 'household', u)));
      for (const wDoc of groupWatchlistSnap.docs) {
        const progSnap = await getDocs(
          collection(db, 'groups', groupDoc.id, 'watchlist', wDoc.id, 'progress'),
        );
        progSnap.docs.forEach(d => refs.push(d.ref));
        refs.push(wDoc.ref);
      }
      refs.push(groupDoc.ref);
    } else {
      const current = (data.memberUids as string[]) ?? [];
      memberLeaveUpdates.push({
        ref: groupDoc.ref,
        newMemberUids: current.filter(u => u !== id),
      });
      const groupWatchlistSnap = await getDocs(
        collection(db, 'groups', groupDoc.id, 'watchlist'),
      );
      for (const wDoc of groupWatchlistSnap.docs) {
        refs.push(doc(db, 'groups', groupDoc.id, 'watchlist', wDoc.id, 'progress', id));
      }
      refs.push(doc(db, 'groups', groupDoc.id, 'members', id));
      // BIN-184: mitt hushålls-bidrag i gruppen jag lämnar (delade kostnadsdata)
      // — GDPR Art. 17: får inte överleva kontot (no-op om aldrig opt-in).
      refs.push(doc(db, 'groups', groupDoc.id, 'household', id));
    }
  }

  // 7. BIN-149: lists I co-edit but don't own — strip my uid from editors[].
  //    Skip lists I OWN (already queued for deletion in section 5); a batch.update
  //    on an already-deleted doc throws and would abort deletion before deleteUser().
  const editorLeaveUpdates: EditorLeaveUpdate[] = [];
  const ownedListIds = new Set(snaps.listsSnap.docs.map(d => d.id));
  snaps.editableListsSnap.docs.forEach(d => {
    if (ownedListIds.has(d.id)) return;
    const editors = (d.data().editors as string[]) ?? [];
    editorLeaveUpdates.push({ ref: d.ref, newEditors: editors.filter(u => u !== id) });
  });

  // 9. User doc + username reservation + weeklyDigestState dedup marker (BIN-163).
  refs.push(doc(db, 'weeklyDigestState', id));
  // BIN-505: public projection (top-level, doc-id = uid) — Art. 17 erasure. NOT a
  // KNOWN_USER_SUBCOLLECTION, so queued explicitly via the snap's own ref (the
  // DocumentSnapshot always has .ref; batch.delete is a no-op if it never existed).
  refs.push(snaps.publicProfileSnap.ref);
  // Via the snapshot's own ref, like the projection above. A hand-built path to
  // the same document also worked, but `dataExport.coverage.test.ts` walks the
  // snapshot list to prove every delete-cascaded collection is actually queued —
  // and a profile deleted by a hand-built path is invisible to it. That guard
  // caught this the moment BIN-875 removed the other `snaps.profileSnap` read.
  // It also keeps this file out of the chokepoint test's exemption list.
  refs.push(snaps.profileSnap.ref);
  // BIN-875: the reservation goes in LAST, immediately after users/{uid}, and
  // that adjacency is load-bearing — see collectUsernameReservationRefs.
  const usernameRefs = await collectUsernameReservationRefs(fs, id);
  usernameRefs.forEach(r => refs.push(r));

  return { refs, memberLeaveUpdates, editorLeaveUpdates };
}

/**
 * BIN-875 / ADR 0020 conditions 1–3 — which `usernames/{name}` reservations this
 * account still holds.
 *
 * The reservation used to be resolved as `profileSnap.data()?.username ??
 * fallbackUsername`, and both sources die in the same accident. If a first
 * deletion attempt erased `users/{uid}` but fell over before `deleteUser()`, the
 * profile document is gone on the retry and the React-state fallback is null
 * after a reload — so the reservation was never queued and the handle stayed
 * taken forever, by an account that no longer exists.
 *
 * Three fixes were on the table and the panel killed two:
 *  - the ADR 0019 marker is device-local by decision, and the person who returns
 *    days later on another device is exactly the one who needs this;
 *  - the profile document was ALREADY tried — `e75a8dc` (2026-06-14) made it the
 *    primary source for this very bug, which then recurred, and
 *    `ensureUserProfile` can resurrect the document between attempts so on a
 *    retry both sources may be present and *wrong* rather than merely absent.
 *
 * What survives is asking the collection itself. `firestore.rules` grants
 * `allow read: if true` across `/usernames/{username}` (list, not just get) and
 * `usernames.uid` carries no `fieldOverrides` exemption, so Firestore's default
 * single-field index serves this equality with no schema change at all.
 *
 * The query result is also the OWNERSHIP CHECK. `firestore.rules` only permits a
 * delete when `resource.data.uid == request.auth.uid`, and chunks are atomic — so
 * queuing a handle someone else has since reclaimed would throw and abort the
 * whole chunk, gating the retry on a stale reference (against ADR 0019 condition
 * 3). Every ref here came back FROM the equality, so a reclaimed handle is simply
 * absent rather than a thrown batch.
 *
 * A query that FAILS queues nothing. The obvious-looking fallback — reuse the
 * profile document's name — was in the first version of this and both the code
 * and security reviews called it: those names carry no ownership proof, and a
 * handle someone else has since claimed would be a delete `firestore.rules:502`
 * refuses, thrown from inside the atomic chunk that also carries `users/{uid}`.
 * That aborts the chunk and gates the retry on a stale reference, which is what
 * ADR 0019 condition 3 forbids outright. Returning nothing costs one reservation
 * until the next attempt or the daily sweep releases it (BIN-875's own server
 * half), which is strictly less than losing the run.
 */
async function collectUsernameReservationRefs(
  fs: DeletionReadKit,
  id: string,
): Promise<DocumentReference[]> {
  const { db, getDocs, collection, query, where } = fs;
  try {
    const owned = await getDocs(query(collection(db, 'usernames'), where('uid', '==', id)));
    return owned.docs.map(d => d.ref);
  } catch (err) {
    // Logged, not silent: a persistently failing query leaves one reservation
    // waiting for the daily sweep every single time, and without this line that
    // is invisible in the console (code review, 2026-08-13).
    console.warn('[deletion] username reservation query failed; leaving it to the sweep', err);
    return [];
  }
}

/** Firestore batch op limit is 500; leave headroom. */
export const DELETION_CHUNK = 450;

/**
 * Commit a deletion plan in ≤450-op chunks: deletes first, then member-leave
 * updates, then editor-leave updates (each in their own chunks).
 *
 * **Each chunk is atomic. The run of chunks is not.** The comment here used to
 * stop at the first sentence — "a failing commit throws and aborts, never a
 * partial clean wipe" — which is true of one batch and reads as a guarantee
 * about the whole cascade. It is not one: an account large enough to span
 * several chunks loses a network connection midway and ends up with part of its
 * data erased and the rest intact (BIN-876, and the reason the whole-cascade
 * reading had to go).
 *
 * So the failure says which of the two happened. `committedChunks` counts what
 * actually landed, and a failure after the first success is re-thrown tagged
 * `CASCADE_PARTIAL` — the only thing that lets the settings page stop telling a
 * half-erased user that nothing happened. Failing on the FIRST chunk is left
 * untagged and rethrown as-is: nothing committed, so the reassuring message is
 * true.
 *
 * In-memory for this call only. No cursor is persisted and no plan is resumable
 * — ADR 0016 rejected exactly that for a structurally similar job, and this
 * cascade's principle is to rebuild the plan from Firestore on every attempt
 * (`src/test/rules/account-deletion.test.ts`). The retry does not resume; it
 * re-derives, and converges because deleting an already-deleted document is a
 * no-op.
 */
export async function applyDeletionPlan(fs: DeletionWriteKit, plan: DeletionPlan): Promise<void> {
  const { db, writeBatch, serverTimestamp } = fs;
  const { refs, memberLeaveUpdates, editorLeaveUpdates } = plan;
  let committedChunks = 0;

  try {
    for (let i = 0; i < refs.length; i += DELETION_CHUNK) {
      const batch = writeBatch(db);
      refs.slice(i, i + DELETION_CHUNK).forEach(r => batch.delete(r));
      await batch.commit();
      committedChunks += 1;
    }
    for (let i = 0; i < memberLeaveUpdates.length; i += DELETION_CHUNK) {
      const batch = writeBatch(db);
      memberLeaveUpdates.slice(i, i + DELETION_CHUNK).forEach(u => {
        batch.update(u.ref, { memberUids: u.newMemberUids });
      });
      await batch.commit();
      committedChunks += 1;
    }
    for (let i = 0; i < editorLeaveUpdates.length; i += DELETION_CHUNK) {
      const batch = writeBatch(db);
      editorLeaveUpdates.slice(i, i + DELETION_CHUNK).forEach(u => {
        batch.update(u.ref, { editors: u.newEditors, updatedAt: serverTimestamp() });
      });
      await batch.commit();
      committedChunks += 1;
    }
  } catch (err) {
    if (committedChunks === 0) throw err;
    throw markCascadePartial(err);
  }
}
