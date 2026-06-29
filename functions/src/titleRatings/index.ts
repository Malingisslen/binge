import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { parseOmdbRatings, isFresh } from './parse';
import { evaluateOmdbBudget } from './budget';
import type { RatingsDoc } from './types';

const OMDB_API_KEY = defineSecret('OMDB_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID'); // BIN-346: cap-alert recipient
const TTL_DAYS = 45;
const IMDB_RE = /^tt\d{6,}$/;
const DAILY_CAP = 900; // global OMDb calls/day ceiling (free tier is 1000/day)
// BIN-346: alert the operator at ~80% so there's time to act (raise the cap,
// investigate abuse) BEFORE users start getting stale/exhausted at the cap.
const ALERT_THRESHOLD = Math.floor(DAILY_CAP * 0.8); // 720

// BIN-350: stays UTC by design — this keys the OMDb daily-budget doc (omdbBudget/{day})
// that caps us under OMDb's free 1000/day. OMDb resets that quota on its own UTC clock,
// so the budget bucket MUST mirror the vendor's UTC reset window (same rationale as
// streamingOffers' motnDay). Migrating it to Stockholm would misalign our counter
// against OMDb's reset and risk double-spending the cap across the cutover. Do NOT
// route this through stockholmDayId.
function today(): string { return new Date().toISOString().slice(0, 10); }

// BIN-346: once-per-day admin notification when OMDb usage approaches the cap.
// Best-effort + mirrors streamingOffers' notifyAdmin shape (same inbox/channel);
// never blocks or fails the rating backfill.
async function notifyOmdbBudgetApproaching(): Promise<void> {
  const adminUid = process.env.ADMIN_UID;
  if (!adminUid) return;
  const db = getFirestore();
  await db.collection('users').doc(adminUid).collection('notifications').add({
    kind: 'system',
    title: 'Betygskvot (OMDb) närmar sig taket',
    body: `~${ALERT_THRESHOLD}/${DAILY_CAP} OMDb-anrop använda idag. Vid taket serveras äldre betyg. Höj kvoten eller utred onormal trafik.`,
    actionUrl: '/insikter',
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export const titleRatings = onCall(
  { region: 'europe-west1', secrets: [OMDB_API_KEY, ADMIN_UID] },
  async (request): Promise<RatingsDoc> => {
    // Public backfill: no auth. Clients read the cached doc directly; this runs
    // only on a cache miss to populate it, behind a hard global daily cap.
    const imdbId = String((request.data as { imdbId?: unknown })?.imdbId ?? '');
    if (!IMDB_RE.test(imdbId)) throw new HttpsError('invalid-argument', 'Ogiltigt IMDb-id.');

    // BIN-361: App Check MONITORING (not enforcement). request.app is populated
    // when a valid App Check token rode along, undefined otherwise — logging it
    // lets us measure the verified rate of REAL titleRatings calls before ever
    // flipping enforceAppCheck. A callable is invoked after the client has minted
    // its token, so this rate should be high (unlike cold-load Firestore reads).
    // Rejects nothing; safe to ship.
    logger.info('titleRatings: appcheck-coverage', { appCheckVerified: !!request.app });

    const db = getFirestore();
    const ref = db.collection('titleRatings').doc(imdbId);
    const now = Date.now();

    const snap = await ref.get();
    if (snap.exists) {
      const cached = snap.data() as RatingsDoc;
      if (isFresh(cached.checkedAt, now, TTL_DAYS)) return cached;
    }

    const key = process.env.OMDB_API_KEY;
    if (!key) throw new HttpsError('internal', 'OMDB_API_KEY saknas.');

    // Reserve a slot in the global daily budget BEFORE spending an OMDb call.
    // BIN-346: the same transaction also decides (once/day, via persisted flags)
    // whether to fire the approaching-cap admin alert or the hard-cap forensic
    // log — pure logic in evaluateOmdbBudget, signals emitted after commit.
    const budgetRef = db.collection('omdbBudget').doc(today());
    const decision = await db.runTransaction(async (tx) => {
      const b = await tx.get(budgetRef);
      const d = evaluateOmdbBudget(
        {
          count: b.exists ? Number(b.get('count') ?? 0) : 0,
          alerted: b.exists ? Boolean(b.get('alertedAt')) : false,
          capLogged: b.exists ? Boolean(b.get('capLoggedAt')) : false,
        },
        DAILY_CAP,
        ALERT_THRESHOLD,
      );
      const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (d.allowed) patch.count = d.newCount;
      if (d.setAlerted) patch.alertedAt = FieldValue.serverTimestamp();
      if (d.setCapLogged) patch.capLoggedAt = FieldValue.serverTimestamp();
      tx.set(budgetRef, patch, { merge: true });
      return d;
    });

    if (decision.fireAlert) {
      logger.warn(`titleRatings: OMDb dygnskvot ~80% (${ALERT_THRESHOLD}/${DAILY_CAP}) nådd för ${today()}.`);
      await notifyOmdbBudgetApproaching().catch((e) => logger.error('titleRatings: admin-notis misslyckades', e));
    }
    if (decision.fireCapLog) {
      logger.error(`titleRatings: OMDb dygnskvot SLUT (${DAILY_CAP}/${DAILY_CAP}) för ${today()} — serverar stale/avvisar tills imorgon.`);
    }
    if (!decision.allowed) {
      if (snap.exists) return snap.data() as RatingsDoc; // serve stale rather than nothing
      throw new HttpsError('resource-exhausted', 'Betygskvoten för dagen är slut.');
    }

    let ratings;
    try {
      // BIN-293: 8s ceiling — a hung OMDb connection would otherwise keep the
      // callable open to its budget; the catch below degrades to stale/throw.
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.Response !== 'True') {
        const errStr = typeof json.Error === 'string' ? json.Error : '';
        // genuine not-found → cache all-null (terminal). transient → throw (don't cache).
        if (!/not found|incorrect imdb/i.test(errStr)) throw new Error(`OMDb transient: ${errStr}`);
      }
      ratings = parseOmdbRatings(json);
    } catch (err) {
      logger.warn(`titleRatings: OMDb fetch failed for ${imdbId}`, err);
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas.');
    }

    const doc: RatingsDoc = { imdbId, checkedAt: now, ...ratings };
    await ref.set(doc);
    return doc;
  },
);
