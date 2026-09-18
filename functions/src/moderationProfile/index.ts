/**
 * Callable `getProfileForModeration` (BIN-1244).
 *
 * Lets an admin see a reported user's display fields — also when the profile is
 * private — from the /admin/reports view, and nowhere else. The Admin SDK read
 * bypasses firestore.rules on purpose; firestore.rules itself is unchanged, so
 * search, invites, lists and the public profile page behave as before for the admin.
 * The pure parts (input, admin check, field whitelist, lookup budget) are in logic.ts.
 *
 * Every lookup that reads a profile is logged with the actor, the target and whether
 * a profile was found — never the profile's contents.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { validateLookupInput, isAdminDoc, projectModerationProfile, spendLookup } from './logic';

// One message for every refusal before the lookup, so a caller cannot tell "not
// signed in" from "not admin" from "bad input" (role 4's condition).
const REFUSED = 'Du har inte behörighet för den här åtgärden.';

export const getProfileForModeration = onCall(
  { region: 'europe-west1', enforceAppCheck: true },
  async (request) => {
    const actorUid = request.auth?.uid;
    if (!actorUid) throw new HttpsError('permission-denied', REFUSED);

    const db = getFirestore();
    const actorSnap = await db.doc(`users/${actorUid}`).get();
    if (!isAdminDoc(actorSnap.data())) throw new HttpsError('permission-denied', REFUSED);

    const input = validateLookupInput(request.data);
    if (!input.ok) throw new HttpsError('permission-denied', REFUSED);

    const budgetRef = db.doc(`moderationBudget/${actorUid}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(budgetRef);
      const start = snap.get('windowStart');
      const prev = start instanceof Timestamp
        ? { windowStartMs: start.toMillis(), count: Number(snap.get('count')) || 0 }
        : null;
      const next = spendLookup(prev, Date.now());
      if (!next) throw new HttpsError('resource-exhausted', 'För många uppslag just nu. Försök igen om en stund.');
      tx.set(budgetRef, { windowStart: Timestamp.fromMillis(next.windowStartMs), count: next.count });
    });

    // Only an account someone has reported can be looked up: the settings page tells
    // users that admins see these fields "vid en anmälan", and this is what makes it so.
    const reports = await db.collection('reports')
      .where('targetType', '==', 'user')
      .where('targetId', '==', input.uid)
      .limit(1)
      .get();
    if (reports.empty) throw new HttpsError('permission-denied', REFUSED);

    const profileSnap = await db.doc(`publicProfiles/${input.uid}`).get();
    logger.info('moderation profile lookup', {
      actorUid,
      targetUid: input.uid,
      found: profileSnap.exists,
    });
    if (!profileSnap.exists) return { profile: null };
    return { profile: projectModerationProfile(profileSnap.data() ?? {}) };
  },
);
