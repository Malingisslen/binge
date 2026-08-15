/**
 * Scheduled watchlist push job (BIN-60 + BIN-360). Two phases in ONE pass so
 * they dedupe deterministically (no cross-cron ordering assumption):
 *
 * 1. RELEASE PHASE (BIN-360 + BIN-463/464) — for vill_se MOVIES ("bevakade"
 *    films), write a "släpps idag" inbox card + fire a push on the SE digital
 *    release date (TMDB type 4), regardless of whether the film is on a subscribed
 *    service. The card rides the Bevaka-släpp opt-in; only the PUSH is gated on
 *    pushEnabled. Two robustness upgrades:
 *      • BIN-463 — the resolved SE digital dates are CACHED per title in
 *        releaseNotifyState/{tmdbId} (with a TTL), so we stop re-fetching
 *        /release_dates for every bevakad film on every daily run.
 *      • BIN-464 — at-most-once is per-USER, keyed on a dedicated marker the user
 *        can't clear from the client (releaseNotifyState/{tmdbId}/notified/{uid}.
 *        notifiedDate), not the user-deletable inbox card. A small catch-up grace
 *        window means a missed cron day still fires. Collects the notified
 *        (uid,tmdbId) set. The marker is uid-identifying, so retentionCleanup
 *        reaps it after 30 days (its GDPR Art. 17 erasure path — admin-only, out
 *        of the client deletion cascade's reach).
 * 2. AVAILABILITY PHASE (BIN-60) — scans vill_se + mina, fetches SE flatrate per
 *    unique (mediaType, tmdbId) title (BIN-523: TMDB movie/TV ids are independent
 *    namespaces), diffs against availableNotifyState/{movie|tv}_{tmdbId}.lastFlatrate, and
 *    pushes followers who (a) subscribe to a newly-added provider, (b) have
 *    availableOnMyServices on. First observation only sets the baseline (no
 *    first-run blast). Marker advances every run (idempotent). SKIPS any
 *    (uid,tmdbId) the release phase already owns today → exactly one push, and
 *    the "släpps idag" message wins the overlap.
 *
 * Admin SDK bypasses firestore.rules → the state collections need no rule change.
 *
 * WHERE THE LOGIC LIVES (BIN-727 step 2). This file is now only the PORT plus the
 * schedule wrapper: one method per Firestore read/write, per TMDB fetch and per
 * push send, no decisions. Every decision — the paged scan and its cursor, the uid
 * and tmdbId derivation, the legacy-state fallback read, the baseline-only first
 * observation, the marker advance, the release cache TTL, the catch-up window, the
 * per-user dedup and the cross-phase suppression — lives in ./runNotify.ts, which
 * imports no firebase-admin and is therefore drivable by
 * src/test/rules/available-notify-orchestrator.test.ts against a real Firestore
 * emulator with TMDB and push doubles.
 *
 * The push send goes through the port for a reason worth keeping (#13, 2026-08-15):
 * there is no FCM emulator, so "a user who opted out is never sent to" can only be
 * proven by counting calls to a port method. It must never be inlined back.
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { fetchSeFlatrate } from './tmdb';
import { fetchReleaseDates } from '../releaseNotify/tmdb';
import { runAvailableNotify, type NotifyIo } from './runNotify';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

// BIN-515: bounded scan. The old single `.get()` materialized the whole matching
// collection-group in one query — an uncapped read-bill that can breach Firestore's
// 10 MB single-response limit at scale (a hard error that aborts the entire notify
// run, dropping every availability + "släpps idag" push). This mirrors the
// streamingOffers / followedSeries paginated loop. The `status IN [...]` filter is
// served by the existing `status` COLLECTION_GROUP single-field index (which the
// old query already relied on); ordering by document id rides that index's implicit
// __name__ tail, so the limit/startAfter cursor needs NO new index. Same docs, same
// shape — just bounded reads.
const PAGE_SIZE = 2000;

/**
 * The production port: one Admin-SDK / TMDB / FCM operation per method.
 *
 * `.select(...)` in the scan is load-bearing in both directions: it keeps the scan
 * cheap AND it is what the orchestrator's grouping reads. Drop or misspell a field
 * and every title reads as blank-status → nothing is ever notified, with no error
 * anywhere. (The emulator harness implements this port with the client SDK, which
 * has no `.select()`, so it reads the FULL doc — a superset of these fields. It
 * therefore proves the loop and the decisions, but it is structurally unable to
 * catch a wrong projection list. This comment is that gap's only guard — the same
 * one retentionCleanup's port carries.)
 */
const adminIo: NotifyIo = {
  pageSize: PAGE_SIZE,
  log: logger,
  now: () => new Date(),

  scanWatchlistPage: async (cursor, pageSize) => {
    const db = getFirestore();
    let q = db.collectionGroup('watchlist')
      .where('status', 'in', ['vill_se', 'mina'])
      .select('mediaType', 'status', 'title', 'tmdbId')
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) q = q.startAfter(db.doc(cursor));
    const snap = await q.get();
    return snap.docs.map((d) => ({ path: d.ref.path, data: d.data() as Record<string, unknown> }));
  },

  readAvailableState: async (docId) => {
    const snap = await getFirestore().collection('availableNotifyState').doc(docId).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  },

  writeAvailableState: async (docId, lastFlatrate) => {
    await getFirestore().collection('availableNotifyState').doc(docId).set(
      { lastFlatrate: [...lastFlatrate], updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  },

  // BIN-463: per-title cache of the resolved SE digital dates. Top-level, admin-only
  // state (mirrors availableNotifyState) — no firestore.rules change needed, and it
  // is NOT user-owned so it stays out of the GDPR export/delete path. Movie-only.
  // BIN-523: doc ids here stay UN-namespaced (bare tmdbId) on purpose — the release
  // phase filters to mediaType === 'movie' before ever touching this collection, so
  // no TV id can collide, and renaming would orphan the live per-user dedup markers
  // (releaseNotifyState/{tmdbId}/notified/{uid}) → double "släpps idag" pushes for
  // releases inside the catch-up window. Keep the movie-only invariant if you add
  // writers.
  readReleaseCache: async (tmdbId) => {
    const snap = await getFirestore().collection('releaseNotifyState').doc(String(tmdbId)).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  },

  writeReleaseCache: async (tmdbId, seDigitalDates) => {
    await getFirestore().collection('releaseNotifyState').doc(String(tmdbId)).set(
      { seDigitalDates: [...seDigitalDates], datesResolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  },

  // BIN-464: per-user dedup marker the user can't clear from the client. Lives
  // under the admin-only releaseNotifyState state doc (never in users/{uid}), so
  // wiping the inbox doesn't reset it. Stores the release date we last pushed this
  // user for. It IS uid-identifying behavioral data, so it is not retained forever:
  // the scheduled retentionCleanup sweep reaps markers older than 30 days
  // (RELEASE_MARKER_MAX_AGE_MS) — well past the 3-day catch-up window where it
  // matters — which is also its GDPR Art. 17 erasure path (the client deletion
  // cascade can't reach an admin-only collection). See docs/data-retention-policy.md.
  readReleaseMarker: async (tmdbId, uid) => {
    const snap = await getFirestore()
      .collection('releaseNotifyState').doc(String(tmdbId)).collection('notified').doc(uid).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  },

  writeReleaseMarker: async (tmdbId, uid, notifiedDate) => {
    await getFirestore()
      .collection('releaseNotifyState').doc(String(tmdbId)).collection('notified').doc(uid)
      .set({ notifiedDate, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  },

  readNotification: async (uid, notifId) => {
    const snap = await getFirestore()
      .collection('users').doc(uid).collection('notifications').doc(notifId).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  },

  writeNotification: async (uid, notifId, card) => {
    await getFirestore()
      .collection('users').doc(uid).collection('notifications').doc(notifId)
      .set({ ...card, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  },

  readUserDoc: async (uid) => {
    const snap = await getFirestore().collection('users').doc(uid).get();
    return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
  },

  fetchSeFlatrate: (tmdbId, mediaType) => fetchSeFlatrate(tmdbId, mediaType),
  fetchReleaseDates: (tmdbId) => fetchReleaseDates(tmdbId),

  sendPush: (uid, payload, opts) => sendPushToUser(uid, payload, opts),
};

export const availableNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 540, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    await runAvailableNotify(adminIo);
  },
);
