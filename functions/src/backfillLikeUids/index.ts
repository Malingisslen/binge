import * as crypto from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

/** Firestore's per-commit write ceiling is 500; leave headroom like the client. */
const BATCH_SIZE = 450;
/** Page size for the bounded collection-group scan — never load every like at once. */
const PAGE_SIZE = 2000;

// Reuse the existing admin secret (also gates /api/insights) so this one-shot
// migration is triggerable by the operator (curl with Bearer <INSIGHTS_TOKEN>)
// without minting a client ID token — no new secret to manage.
const INSIGHTS_TOKEN = defineSecret('INSIGHTS_TOKEN');

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

/** Bearer token authorizes either as the shared admin secret or an admin's ID token. */
async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  const expected = process.env.INSIGHTS_TOKEN || '';
  if (expected && safeEqual(token, expected)) return true;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    const snap = await getFirestore().collection('users').doc(decoded.uid).get();
    return snap.exists && snap.data()?.isAdmin === true;
  } catch {
    return false;
  }
}

/**
 * BIN-347 — one-shot backfill of the `uid` field on review likes.
 *
 * Existing `reviews/{reviewId}/likes/{likerUid}` docs predate the `uid` field
 * (they were doc-id-only). The GDPR export + Art. 17 erasure path enumerates a
 * user's likes via `collectionGroup('likes').where('uid','==',uid)`, so a like
 * lacking the field is invisible to it — never exported, never erased. This sets
 * `uid := doc-id` on every like that lacks it, in bounded pages and ≤450-op
 * batches. Admin-only (shared secret / admin ID token) and idempotent (skips docs
 * already carrying `uid`) — safe to re-run. Removable once prod is confirmed
 * backfilled.
 */
export const backfillLikeUids = onRequest(
  { region: 'europe-west1', secrets: [INSIGHTS_TOKEN] },
  async (req, res) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!(await isAuthorized(token))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const db = getFirestore();
    let scanned = 0;
    let patched = 0;
    let cursor: QueryDocumentSnapshot | undefined;

    for (;;) {
      // select('uid') keeps egress minimal — we only need to know whether the
      // field is already present. The doc id IS the liker's uid (doc-id = uid).
      let q = db.collectionGroup('likes').select('uid').orderBy('__name__').limit(PAGE_SIZE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;

      const missing = snap.docs.filter(d => d.get('uid') === undefined);
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const d of missing.slice(i, i + BATCH_SIZE)) {
          batch.update(d.ref, { uid: d.id });
        }
        await batch.commit();
      }

      scanned += snap.size;
      patched += missing.length;
      if (snap.size < PAGE_SIZE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }

    logger.info(`backfillLikeUids: scanned=${scanned} patched=${patched}`);
    res.status(200).json({ scanned, patched });
  },
);
