/**
 * Callable Fråga Binge usage/error recorder (BIN-176 learning loop).
 *
 * The ONLY writer of askBingeStats/{YYYY-MM-DD}; the collection is locked to
 * clients in firestore.rules, so counters can't be forged by writing Firestore
 * directly. All input is validated against a fixed vocabulary (logic.ts) before
 * becoming a field path, so the daily doc can't grow unboundedly.
 *
 * Access gate (no open flood vector, yet works today):
 *   - App Check token present  → accept (the intended gate for logged-out users;
 *     activates automatically once App Check is configured in the console).
 *   - Authenticated user        → accept (account is friction enough for now).
 *   - Neither                   → reject. So logged-out capture only switches on
 *     once App Check is live — until then we still record logged-in searches.
 *
 * No cooldown: every search is a wanted data point (rapid query-refining is
 * normal), and the write is a bounded single-doc increment.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { validateRecordInput, buildIncrements } from './logic';

/** Server clock → which daily doc to bump. Avoids trusting a client-sent date. */
function todayId(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Place an increment at a nested path in a plain object (creating maps as needed). */
function setNested(root: Record<string, unknown>, path: string[], value: unknown): void {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

export const recordAskBinge = onCall({ region: 'europe-west1' }, async (request) => {
  const hasAppCheck = request.app !== undefined;
  const isAuthed = request.auth?.uid !== undefined;
  if (!hasAppCheck && !isAuthed) {
    throw new HttpsError('failed-precondition', 'App Check krävs för anonyma anrop.');
  }

  const parsed = validateRecordInput(request.data);
  if (!parsed.ok) throw new HttpsError('invalid-argument', parsed.error);

  // Build one nested object of FieldValue.increment()s and merge-write it in a
  // single op. merge:true deep-merges, so fields/maps are created lazily and the
  // doc only ever holds the fixed, validated keys.
  const payload: Record<string, unknown> = {};
  for (const inc of buildIncrements(parsed.value)) {
    setNested(payload, inc.path, FieldValue.increment(inc.delta));
  }

  await getFirestore().collection('askBingeStats').doc(todayId()).set(payload, { merge: true });

  return { ok: true };
});
