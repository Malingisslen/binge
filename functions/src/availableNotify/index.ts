/**
 * Scheduled watchlist push job (BIN-60 + BIN-360). Two phases in ONE pass so
 * they dedupe deterministically (no cross-cron ordering assumption):
 *
 * 1. RELEASE PHASE (BIN-360) — for vill_se MOVIES ("bevakade" films), write a
 *    "släpps idag" inbox card + fire a push on the SE digital release date (TMDB
 *    type 4), regardless of whether the film is on a subscribed service. The card
 *    rides the Bevaka-släpp opt-in; only the PUSH is gated on pushEnabled.
 *    At-most-once is per-USER, keyed on the `${tmdbId}-release` inbox doc's
 *    existence (no per-title marker). Collects the notified (uid,tmdbId) set.
 * 2. AVAILABILITY PHASE (BIN-60) — scans vill_se + mina, fetches SE flatrate per
 *    unique title, diffs against availableNotifyState/{tmdbId}.lastFlatrate, and
 *    pushes followers who (a) subscribe to a newly-added provider, (b) have
 *    availableOnMyServices on. First observation only sets the baseline (no
 *    first-run blast). Marker advances every run (idempotent). SKIPS any
 *    (uid,tmdbId) the release phase already owns today → exactly one push, and
 *    the "släpps idag" message wins the overlap.
 *
 * Admin SDK bypasses firestore.rules → the state collections need no rule change.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { fetchSeFlatrate } from './tmdb';
import { fetchReleaseDates } from '../releaseNotify/tmdb';
import { releasesDigitallyToday, stockholmDateString } from '../releaseNotify/logic';
import { diffNewProviders, qualifyingProviders, canonicalProviderId, type WatchlistTitleLite, type UserNotifSettings } from './logic';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

async function readWatchlistTitles(): Promise<WatchlistTitleLite[]> {
  const db = getFirestore();
  const snap = await db.collectionGroup('watchlist')
    .where('status', 'in', ['vill_se', 'mina'])
    .select('mediaType', 'status', 'title', 'tmdbId')
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    const uid = d.ref.parent.parent?.id ?? '';
    return {
      uid,
      tmdbId: Number(x.tmdbId ?? Number(d.id)),
      mediaType: String(x.mediaType ?? ''),
      status: String(x.status ?? ''),
      title: String(x.title ?? ''),
    };
  });
}

async function readLastFlatrate(tmdbId: number): Promise<number[] | null> {
  const snap = await getFirestore().collection('availableNotifyState').doc(String(tmdbId)).get();
  const v = snap.data()?.lastFlatrate;
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null;
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

async function processTitle(tmdbId: number, items: WatchlistTitleLite[], releaseSkip: Set<string>): Promise<number> {
  const db = getFirestore();
  const mediaType = items[0]?.mediaType || 'tv';
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
  const last = await readLastFlatrate(tmdbId);
  const newIds = diffNewProviders(currentIds, last);

  const writeMarker = () =>
    db.collection('availableNotifyState').doc(String(tmdbId))
      .set({ lastFlatrate: currentIds, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  if (newIds.length === 0) { await writeMarker(); return 0; }

  const actionUrl = `/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/`;
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
    // the `${tmdbId}-${canonicalId}` doc id so the inbox renders + dedupes it.
    const notifId = `${tmdbId}-${providerId}`;
    await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
      tmdbId, mediaType, title: it.title, kind: 'provider_available',
      providerId, providerName, read: false, createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendPushToUser(it.uid, {
      title: `Nu på din ${providerName}`,
      body: `${it.title} går att streama där nu`,
      actionUrl, tag: `available-${tmdbId}`,
    }, { pushEnabled: u.settings.pushEnabled });
    notified += 1;
  }));
  await writeMarker();
  return notified;
}

/**
 * Release phase (BIN-360). For every vill_se MOVIE (the "bevakad" set — vill_se is
 * film-only) that releases digitally in SE today, write a "släpps idag" inbox card
 * for each owner and push it to those with pushEnabled. Returns the set of
 * (uid,tmdbId) it owns today so the availability phase can skip them (dedup:
 * release wins). Every owner is added to the skip set regardless of send outcome —
 * a film releasing today always belongs to the release message, never "finns nu på
 * X". At-most-once is per-USER, keyed on the release inbox doc's existence (no
 * per-title marker), so a user who bevakar the film mid-day is still caught next run.
 */
async function runReleasePhase(titles: WatchlistTitleLite[], today: string): Promise<Set<string>> {
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
    // one movie's block must not skip the rest's release-day check (exact-day match
    // → no catch-up next run) NOR discard the skip set built so far.
    try {
      const results = await fetchReleaseDates(tmdbId);
      if (results === null) continue;                    // fetch failed → skip
      if (!releasesDigitallyToday(results, today)) continue;

      // Fan owners out (matches processTitle's Promise.allSettled) — one slow/
      // failing recipient can't block or abort the others.
      await Promise.allSettled(owners.map(async (it) => {
        skip.add(skipKey(it.uid, 'movie', tmdbId));      // movies only; availability defers for this owner regardless of send outcome
        // At-most-once is PER USER, keyed on the release inbox doc itself: if this
        // user already has a `${tmdbId}-release` card, we've notified them for this
        // release — don't re-push on a same-day rerun. (No per-title marker, so a
        // user who bevakar the film mid-day still gets notified on the next run.)
        const inboxRef = db.collection('users').doc(it.uid).collection('notifications').doc(`${tmdbId}-release`);
        try {
          if ((await inboxRef.get()).exists) return;
          const u = await readUserData(it.uid);
          if (!u) return;                                // user-doc missing → nothing to write/send
          const filmTitle = it.title?.trim() || 'En film du bevakar';
          // Inbox card — written for every bevakad owner regardless of pushEnabled,
          // mirroring episodeNotify/weeklyDigest: the in-app card rides the feature
          // opt-in (the Bevaka-släpp tap), and ONLY the FCM push is gated on
          // pushEnabled (enforced inside sendPushToUser). kind 'digital_release' is
          // tmdbId-shaped like episode_release; the client renders it.
          await inboxRef.set({
            tmdbId, mediaType: 'movie', title: filmTitle, kind: 'digital_release',
            read: false, createdAt: FieldValue.serverTimestamp(),
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
    const today = stockholmDateString(new Date());
    let releaseSkip = new Set<string>();
    try { releaseSkip = await runReleasePhase(titles, today); }
    catch (err) { logger.error('releaseNotify phase failed', err); }

    // Phase 2: availability transitions, skipping release-owned (uid,tmdbId).
    const byTitle = new Map<number, WatchlistTitleLite[]>();
    for (const it of titles) { const arr = byTitle.get(it.tmdbId); if (arr) arr.push(it); else byTitle.set(it.tmdbId, [it]); }
    let totalNotified = 0;
    for (const [tmdbId, items] of byTitle) {
      try { totalNotified += await processTitle(tmdbId, items, releaseSkip); }
      catch (err) { logger.error(`availableNotify: title ${tmdbId} failed`, err); }
    }
    logger.info('availableNotify done', {
      watchlistDocs: titles.length, uniqueTitles: byTitle.size,
      notified: totalNotified, releaseOwned: releaseSkip.size,
    });
  },
);
