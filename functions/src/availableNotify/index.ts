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
 */

import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { fetchSeFlatrate } from './tmdb';
import { fetchReleaseDates } from '../releaseNotify/tmdb';
import {
  seDigitalReleaseDates,
  stockholmDateString,
  shouldRefetchReleaseDates,
  releaseDateToFire,
  releaseAction,
  isLegacyReleaseCard,
  type ReleaseDateCache,
} from '../releaseNotify/logic';
import { diffNewProviders, qualifyingProviders, canonicalProviderId, normalizeMediaType, availableStateDocId, inboxNotifId, type WatchlistTitleLite, type UserNotifSettings } from './logic';

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

async function readWatchlistTitles(): Promise<WatchlistTitleLite[]> {
  const db = getFirestore();
  const out: WatchlistTitleLite[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q = db.collectionGroup('watchlist')
      .where('status', 'in', ['vill_se', 'mina'])
      .select('mediaType', 'status', 'title', 'tmdbId')
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const x = d.data();
      const uid = d.ref.parent.parent?.id ?? '';
      out.push({
        uid,
        tmdbId: Number(x.tmdbId ?? Number(d.id)),
        mediaType: String(x.mediaType ?? ''),
        status: String(x.status ?? ''),
        title: String(x.title ?? ''),
      });
    }
    if (snap.size < PAGE_SIZE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return out;
}

// stateId = availableStateDocId(mediaType, tmdbId) — media-type-namespaced
// (BIN-523).
//
// xhigh /code-review (2026-07-19) caught a real gap in the ORIGINAL BIN-523
// framing: "legacy bare-tmdbId docs are orphaned on purpose" is only true
// for titles that actually COLLIDED (their old doc's lastFlatrate may
// genuinely mix both media's providers). For the much larger set of titles
// that never collided, the old doc's data is perfectly valid — but keying
// purely on the new stateId meant EVERY title's first post-deploy run saw
// `last === null` regardless, silently swallowing any real "now streaming"
// transition that happened to land in that one run (diffNewProviders takes
// the baseline-only branch on a null `last`, by design, to avoid a false
// first-run blast). Reading `tmdbId` (the legacy key) as a fallback ONLY
// when the namespaced doc doesn't exist yet fixes the common (non-colliding)
// case at the cost of reintroducing the ORIGINAL (already-accepted, already
// self-correcting) mixed-baseline risk for the rare colliding case — for one
// SUCCESSFUL run only. `writeMarker` (below) always writes forward to the
// namespaced doc once a fetch actually succeeds, so every subsequent
// successful run reads clean, correctly-scoped state. A title whose fetch
// keeps FAILING never even reaches this function — processTitle returns
// early on a null fetch, before readLastFlatrate is called — so it's not a
// repeated-fallback case at all, just an unrelated, pre-existing "skip this
// run" outcome.
async function readLastFlatrate(stateId: string, legacyTmdbId: number): Promise<number[] | null> {
  const stateSnap = await getFirestore().collection('availableNotifyState').doc(stateId).get();
  if (stateSnap.exists) {
    const v = stateSnap.data()?.lastFlatrate;
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null;
  }
  const legacySnap = await getFirestore().collection('availableNotifyState').doc(String(legacyTmdbId)).get();
  const v = legacySnap.data()?.lastFlatrate;
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null;
}

// BIN-463: per-title cache of the resolved SE digital dates. Top-level, admin-only
// state (mirrors availableNotifyState) — no firestore.rules change needed, and it
// is NOT user-owned so it stays out of the GDPR export/delete path. Movie-only.
// BIN-523: doc ids here stay UN-namespaced (bare tmdbId) on purpose — the release
// phase filters to mediaType === 'movie' before ever touching this collection, so
// no TV id can collide, and renaming would orphan the live per-user dedup markers
// (releaseNotifyState/{tmdbId}/notified/{uid}) → double "släpps idag" pushes for
// releases inside the catch-up window. Keep the movie-only invariant if you add
// writers.
async function readReleaseCache(tmdbId: number): Promise<ReleaseDateCache | null> {
  const snap = await getFirestore().collection('releaseNotifyState').doc(String(tmdbId)).get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  const seDigitalDates = Array.isArray(d.seDigitalDates)
    ? d.seDigitalDates.filter((x: unknown): x is string => typeof x === 'string')
    : [];
  const ts = d.datesResolvedAt;
  const datesResolvedAtMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
  return { seDigitalDates, datesResolvedAtMs };
}

async function writeReleaseCache(tmdbId: number, seDigitalDates: string[]): Promise<void> {
  await getFirestore().collection('releaseNotifyState').doc(String(tmdbId)).set(
    { seDigitalDates, datesResolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

// BIN-464: per-user dedup marker the user can't clear from the client. Lives
// under the admin-only releaseNotifyState state doc (never in users/{uid}), so
// wiping the inbox doesn't reset it. Stores the release date we last pushed this
// user for. It IS uid-identifying behavioral data, so it is not retained forever:
// the scheduled retentionCleanup sweep reaps markers older than 30 days
// (RELEASE_MARKER_MAX_AGE_MS) — well past the 3-day catch-up window where it
// matters — which is also its GDPR Art. 17 erasure path (the client deletion
// cascade can't reach an admin-only collection). See docs/data-retention-policy.md.
function releaseMarkerRef(tmdbId: number, uid: string) {
  return getFirestore().collection('releaseNotifyState').doc(String(tmdbId)).collection('notified').doc(uid);
}

async function readNotifiedReleaseDate(tmdbId: number, uid: string): Promise<string | null> {
  const snap = await releaseMarkerRef(tmdbId, uid).get();
  const v = snap.data()?.notifiedDate;
  return typeof v === 'string' ? v : null;
}

// BIN-472 deploy-day guard: does this user still hold a GENUINE pre-BIN-464
// `${tmdbId}-release` inbox card? Only queried when the per-user marker is absent
// (the common steady-state path skips this read entirely). A card the CURRENT
// code wrote carries `viaMarker: true`, so isLegacyReleaseCard excludes it — that
// distinction is what time-boxes the guard to the one-time cutover: without it, a
// newer digital date arriving 30+ days after the first push (marker already
// reaped, card still present) would look identical to the cutover and wrongly
// suppress the fresh "släpps idag" push forever.
async function hasLegacyReleaseCard(tmdbId: number, uid: string): Promise<boolean> {
  const snap = await getFirestore()
    .collection('users').doc(uid).collection('notifications').doc(`${tmdbId}-release`).get();
  return isLegacyReleaseCard(snap.exists ? (snap.data() ?? null) : null);
}

// One read of users/{uid} for both myProviders and the notif flags. null =
// user-doc missing → don't notify.
async function readUserData(uid: string): Promise<{ myProviders: number[]; settings: UserNotifSettings } | null> {
  const snap = await getFirestore().collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const s = data.notificationSettings as { availableOnMyServices?: boolean; pushEnabled?: boolean } | undefined;
  const myProviders = Array.isArray(data.myProviders)
    ? data.myProviders.filter((n: unknown): n is number => typeof n === 'number')
    : [];
  return {
    myProviders,
    settings: {
      availableOnMyServices: s?.availableOnMyServices !== false, // default on
      pushEnabled: s?.pushEnabled === true, // default off (must opt in)
    },
  };
}

// Key for the release-phase suppression set: a specific user's specific title.
// Keyed by mediaType too: TMDB movie ids and TV ids are independent namespaces,
// so a user can hold movie N and TV N. Without mediaType, a movie's release skip
// would wrongly suppress the unrelated TV show's availability push.
const skipKey = (uid: string, mediaType: string, tmdbId: number): string => `${uid}:${mediaType}:${tmdbId}`;

async function processTitle(stateId: string, items: WatchlistTitleLite[], releaseSkip: Set<string>): Promise<number> {
  const db = getFirestore();
  // Groups are keyed on availableStateDocId(mediaType, tmdbId), so every item
  // shares one (mediaType, tmdbId) — items[0] is authoritative, not arbitrary.
  const { tmdbId } = items[0];
  const mediaType = normalizeMediaType(items[0].mediaType);
  const providers = await fetchSeFlatrate(tmdbId, mediaType);
  if (providers === null) return 0; // fetch failed → skip, don't touch the marker
  // Canonicalise provider ids (TMDB aliases → one id), matching how the client
  // stores myProviders + keys notif docs. Dedupe by canonical id, first name wins.
  const nameById = new Map<number, string>();
  for (const p of providers) {
    const cid = canonicalProviderId(p.id);
    if (!nameById.has(cid)) nameById.set(cid, p.name);
  }
  const currentIds = [...nameById.keys()];
  const last = await readLastFlatrate(stateId, tmdbId);
  const newIds = diffNewProviders(currentIds, last);

  const writeMarker = () =>
    db.collection('availableNotifyState').doc(stateId)
      .set({ lastFlatrate: currentIds, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  if (newIds.length === 0) { await writeMarker(); return 0; }

  const actionUrl = `/${mediaType}/${tmdbId}/`;
  let notified = 0;
  await Promise.allSettled(items.map(async (it) => {
    // Overlap day: the release phase already sent this user "släpps idag" for this
    // title. DELIBERATELY suppress BOTH the availability push and its
    // provider_available inbox card (return before writing either) so the user
    // gets exactly one signal — the release one (Malin's "prefer släpps idag").
    // The release card links to /movie/{id}/ where the live SE providers show, so
    // "which service" isn't lost. The provider marker still advances below (early
    // return only skips the send/card, not writeMarker), so it won't re-fire.
    if (releaseSkip.has(skipKey(it.uid, it.mediaType, it.tmdbId))) return;
    const u = await readUserData(it.uid);
    if (!u) return;
    const qualifying = qualifyingProviders(u.settings, newIds, u.myProviders);
    if (qualifying.length === 0) return;
    // ONE push per title per availability-transition. If the title gains several
    // of the user's providers in the same run we notify about the first only —
    // "X går att streama nu" is the signal; the title page shows every provider.
    // The marker advances to include ALL current providers, so the others won't
    // re-fire later either. This is deliberate (avoids double-spam for one title).
    const providerId = qualifying[0];
    const providerName = nameById.get(providerId) ?? 'en av dina tjänster';
    // Shape + id MATCH the client/inbox `provider_available` model
    // (useNotifications.ts): kind, providerId (canonical), providerName, and
    // the media-type-namespaced `${stateId}-${canonicalId}` doc id (BIN-529)
    // so a movie and TV show sharing a tmdbId + provider can't merge-overwrite
    // one inbox card.
    const notifId = inboxNotifId(mediaType, tmdbId, providerId);
    await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
      tmdbId, mediaType, title: it.title, kind: 'provider_available',
      providerId, providerName, read: false, createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendPushToUser(it.uid, {
      title: `Nu på din ${providerName}`,
      body: `${it.title} går att streama där nu`,
      // Tag rides the namespaced stateId too — a bare-tmdbId tag would let a
      // movie-N push visually replace an unrelated TV-N push in the browser.
      actionUrl, tag: `available-${stateId}`,
    }, { pushEnabled: u.settings.pushEnabled });
    notified += 1;
  }));
  await writeMarker();
  return notified;
}

/**
 * Release phase (BIN-360 + BIN-463/464). For every vill_se MOVIE (the "bevakad"
 * set — vill_se is film-only) whose SE digital date is today (or within the
 * catch-up grace window), write a "släpps idag" inbox card for each owner and
 * push it to those with pushEnabled. Returns the set of (uid,tmdbId) it owns
 * (fire-window films) so the availability phase can skip them (dedup: release
 * wins). Every owner of a fireable film is added to the skip set regardless of
 * send outcome — that film belongs to the release message, never "finns nu på X".
 *
 * BIN-463: the resolved SE digital dates are cached per title; we only re-hit TMDB
 * when the cache is missing, stale, or a cached date is near release. BIN-464:
 * at-most-once is per-USER via a dedicated non-deletable marker storing the
 * notified date, and the grace window makes a missed cron day self-heal.
 */
async function runReleasePhase(titles: WatchlistTitleLite[], today: string, nowMs: number): Promise<Set<string>> {
  const db = getFirestore();
  const skip = new Set<string>();

  // Group each vill_se movie's OWNER DOCS by tmdbId — we keep the per-owner items
  // (not one movie-level title) so each user's card/push carries their own
  // denormalized title, never the first-scanned owner's (which could be blank).
  const byMovie = new Map<number, WatchlistTitleLite[]>();
  for (const t of titles) {
    if (t.status !== 'vill_se' || t.mediaType !== 'movie') continue;
    const arr = byMovie.get(t.tmdbId);
    if (arr) arr.push(t); else byMovie.set(t.tmdbId, [t]);
  }

  for (const [tmdbId, owners] of byMovie) {
    // Isolate each movie (mirrors phase 2's per-title try/catch below): a throw in
    // one movie's block must not skip the rest's release-window check NOR discard
    // the skip set built so far.
    try {
      // BIN-463: trust the cached dates unless missing/stale/near-release. On a
      // refetch we re-resolve from TMDB and re-stamp the cache; a fetch failure
      // leaves the cache untouched (retry next run).
      const cache = await readReleaseCache(tmdbId);
      let seDigitalDates: string[];
      if (shouldRefetchReleaseDates(cache, today, nowMs)) {
        const results = await fetchReleaseDates(tmdbId);
        if (results === null) continue;                  // fetch failed → skip, keep cache
        seDigitalDates = seDigitalReleaseDates(results);
        await writeReleaseCache(tmdbId, seDigitalDates); // cache even [] → no daily re-fetch for date-less films
      } else {
        seDigitalDates = cache?.seDigitalDates ?? [];
      }

      const dateToFire = releaseDateToFire(seDigitalDates, today);
      if (dateToFire === null) continue;                 // not in the fire window

      // Fan owners out (matches processTitle's Promise.allSettled) — one slow/
      // failing recipient can't block or abort the others.
      await Promise.allSettled(owners.map(async (it) => {
        skip.add(skipKey(it.uid, 'movie', tmdbId));      // movies only; availability defers for this owner regardless of send outcome
        // BIN-464: per-USER dedup on a NON-deletable marker, not the inbox card.
        // If we already pushed this user for THIS release date, skip — even across
        // the grace window and even if they cleared their inbox. A newer digital
        // date re-arms (dateToFire changes).
        try {
          const notifiedDate = await readNotifiedReleaseDate(tmdbId, it.uid);
          // BIN-472: only when there is no marker do we check for a legacy card —
          // the steady state (marker present) never pays for this extra read.
          const hasLegacyCard = notifiedDate === null
            ? await hasLegacyReleaseCard(tmdbId, it.uid)
            : false;
          const action = releaseAction(notifiedDate, dateToFire, hasLegacyCard);
          if (action === 'skip') return;                 // marker already covers this date
          if (action === 'seed') {
            // Pre-BIN-464 code already notified this user via the legacy inbox
            // card. Seed the per-user marker to this date WITHOUT re-pushing, so
            // the BIN-464 cutover never double-fires "släpps idag". Bias: a stale,
            // never-cleared card for an OLD release could seed-suppress a genuine
            // new re-release once — accepted as the "never double-push" tradeoff.
            await releaseMarkerRef(tmdbId, it.uid).set(
              { notifiedDate: dateToFire, updatedAt: FieldValue.serverTimestamp() },
              { merge: true },
            );
            return;
          }
          const u = await readUserData(it.uid);
          if (!u) return;                                // user-doc missing → nothing to write/send
          const filmTitle = it.title?.trim() || 'En film du bevakar';
          // Inbox card — written for every bevakad owner regardless of pushEnabled,
          // mirroring episodeNotify/weeklyDigest: the in-app card rides the feature
          // opt-in (the Bevaka-släpp tap), and ONLY the FCM push is gated on
          // pushEnabled (enforced inside sendPushToUser). kind 'digital_release' is
          // tmdbId-shaped like episode_release; the client renders it. `viaMarker`
          // stamps this card as MARKER-ERA so the BIN-472 legacy guard never
          // mistakes it for a pre-BIN-464 artifact and seed-suppresses a genuine
          // re-arm once the 30-day marker has been reaped (see isLegacyReleaseCard).
          await db.collection('users').doc(it.uid).collection('notifications').doc(`${tmdbId}-release`).set({
            tmdbId, mediaType: 'movie', title: filmTitle, kind: 'digital_release',
            viaMarker: true, read: false, createdAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          await sendPushToUser(it.uid, {
            // "finns digitalt" not "går att streama": TMDB type-4 (digital) is the
            // digital-availability date, which can be rent/buy (TVOD), not always
            // flatrate streaming — the film page shows the exact SE offer.
            title: 'Släpps idag',
            body: `${filmTitle} finns digitalt i Sverige idag`,
            actionUrl: `/movie/${tmdbId}/`,
            tag: `release-${tmdbId}`,
          }, { pushEnabled: u.settings.pushEnabled });
          // Advance the marker AFTER the attempt (like availableNotify's marker):
          // even if the push failed we won't re-spam this user for this date; the
          // grace window + next-run retry covers a mid-day bevakning of a new date.
          await releaseMarkerRef(tmdbId, it.uid).set(
            { notifiedDate: dateToFire, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
        } catch (err) {
          logger.error(`releaseNotify: notify ${it.uid} for title ${tmdbId} failed`, err);
        }
      }));
    } catch (err) {
      logger.error(`releaseNotify: title ${tmdbId} failed`, err);
    }
  }
  return skip;
}

export const availableNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 540, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    let titles: WatchlistTitleLite[] = [];
    try { titles = await readWatchlistTitles(); }
    catch (err) { logger.error('availableNotify: watchlist scan failed', err); return; }

    // Phase 1: release-day pushes. A failure here must not block availability.
    const now = new Date();
    const today = stockholmDateString(now);
    let releaseSkip = new Set<string>();
    try { releaseSkip = await runReleasePhase(titles, today, now.getTime()); }
    catch (err) { logger.error('releaseNotify phase failed', err); }

    // Phase 2: availability transitions, skipping release-owned (uid,tmdbId).
    // Grouped by (mediaType, tmdbId) via availableStateDocId (BIN-523) — TMDB
    // movie and TV ids are independent namespaces, so bare-tmdbId grouping
    // collapsed movie N + TV N into one title with an arbitrary mediaType.
    const byTitle = new Map<string, WatchlistTitleLite[]>();
    for (const it of titles) {
      const key = availableStateDocId(it.mediaType, it.tmdbId);
      const arr = byTitle.get(key); if (arr) arr.push(it); else byTitle.set(key, [it]);
    }
    let totalNotified = 0;
    for (const [stateId, items] of byTitle) {
      try { totalNotified += await processTitle(stateId, items, releaseSkip); }
      catch (err) { logger.error(`availableNotify: title ${stateId} failed`, err); }
    }
    logger.info('availableNotify done', {
      watchlistDocs: titles.length, uniqueTitles: byTitle.size,
      notified: totalNotified, releaseOwned: releaseSkip.size,
    });
  },
);
