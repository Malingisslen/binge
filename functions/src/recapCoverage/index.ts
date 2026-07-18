/**
 * Callable recap coverage-gap recorder (BIN-544).
 *
 * The ONLY writer of recapCoverageGaps/{tmdbId}; the collection is locked to
 * clients in firestore.rules, so counters can't be forged by writing Firestore
 * directly (mirrors recordAskBinge's sealed-collection pattern). Aggregated
 * per SHOW (tmdbId), not per-episode — the consuming question is "which show
 * needs backfill," not a per-episode breakdown.
 *
 * Access gate (mirrors recordAskBinge): App Check token present (the intended
 * gate for logged-out browsing — recap misses can happen for anonymous
 * users) OR authenticated. No rate limit: a bounded single-doc increment per
 * call, same cost shape as recordAskBinge.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { validateMissInput } from './logic';

export const logRecapMiss = onCall({ region: 'europe-west1' }, async (request) => {
  const hasAppCheck = request.app !== undefined;
  const isAuthed = request.auth?.uid !== undefined;
  if (!hasAppCheck && !isAuthed) {
    throw new HttpsError('failed-precondition', 'App Check krävs för anonyma anrop.');
  }

  const parsed = validateMissInput(request.data);
  if (!parsed.ok) throw new HttpsError('invalid-argument', parsed.error);

  await getFirestore().collection('recapCoverageGaps').doc(String(parsed.value.tmdbId)).set({
    count: FieldValue.increment(1),
    lastMissedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});
