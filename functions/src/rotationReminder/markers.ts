/**
 * BIN-1279: erase an account's `rotationReminderState` dedup markers.
 *
 * Each marker is `{uid, notifiedAt}` under an id that names the streaming service
 * the person was reminded to pause, so it says what they subscribed to long after
 * the account is gone. Two doors erase it: the account-delete button, through
 * `handOverOwnedGroups`, and the retention sweep's `rotationReminders` category.
 * Derive them rather than trusting this sentence:
 *   git grep -n "rotationReminderState" -- functions/src
 *
 * Its own port rather than two more methods on `HandoverIo` (#27's condition on
 * BIN-1279): the markers have nothing to do with groups.
 */

import type { Firestore } from 'firebase-admin/firestore';

/** Writes per batch, under Firestore's own 500 ceiling. */
const MARKER_BATCH_LIMIT = 450;

export interface ReminderMarkerIo {
  /** Paths of every marker whose `uid` field is the uid. */
  markerPaths(uid: string): Promise<readonly string[]>;
  /** Delete the given paths in one batch. */
  deleteMarkers(paths: readonly string[]): Promise<void>;
}

/**
 * Delete every marker the uid has, in batches.
 *
 * `progress.attempted` is set before the first batch, for the same reason as in
 * `runMemberGroupErasure`: a throw after a batch has landed must not be reported
 * as a run that wrote nothing. Every write is a delete, so a retry converges.
 */
export async function eraseReminderMarkers(
  io: ReminderMarkerIo,
  uid: string,
  progress: { attempted: boolean },
): Promise<{ found: number }> {
  const paths = await io.markerPaths(uid);
  for (let i = 0; i < paths.length; i += MARKER_BATCH_LIMIT) {
    progress.attempted = true;
    await io.deleteMarkers(paths.slice(i, i + MARKER_BATCH_LIMIT));
  }
  return { found: paths.length };
}

export function adminReminderMarkerIo(db: Firestore): ReminderMarkerIo {
  return {
    markerPaths: async (uid) => {
      const snap = await db.collection('rotationReminderState').where('uid', '==', uid).select().get();
      return snap.docs.map((d) => d.ref.path);
    },
    deleteMarkers: async (paths) => {
      const batch = db.batch();
      paths.forEach((p) => batch.delete(db.doc(p)));
      await batch.commit();
    },
  };
}
