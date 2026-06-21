/**
 * Scheduled "available on my services" push (BIN-60).
 *
 * onSchedule('every 24 hours', europe-west1). Scans collectionGroup('watchlist')
 * for vill_se + mina titles (narrowed via .select()), groups by tmdbId, fetches
 * SE flatrate providers per unique title (one TMDB call/title, deduped), diffs
 * against a per-title availableNotifyState/{tmdbId}.lastFlatrate marker, and
 * pushes to followers who (a) subscribe to a newly-added provider, (b) have
 * availableOnMyServices on. First observation only establishes the baseline
 * (no first-run blast). Marker advances every run (idempotent, at-most-once).
 *
 * Admin SDK bypasses firestore.rules → availableNotifyState needs no rule change.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { fetchSeFlatrate } from './tmdb';
import { diffNewProviders, qualifyingProviders, type WatchlistTitleLite, type UserNotifSettings } from './logic';

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

async function processTitle(tmdbId: number, items: WatchlistTitleLite[]): Promise<number> {
  const db = getFirestore();
  const mediaType = items[0]?.mediaType || 'tv';
  const providers = await fetchSeFlatrate(tmdbId, mediaType);
  if (providers === null) return 0; // fetch failed → skip, don't touch the marker
  const currentIds = providers.map((p) => p.id);
  const last = await readLastFlatrate(tmdbId);
  const newIds = diffNewProviders(currentIds, last);

  const writeMarker = () =>
    db.collection('availableNotifyState').doc(String(tmdbId))
      .set({ lastFlatrate: currentIds, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  if (newIds.length === 0) { await writeMarker(); return 0; }

  const nameById = new Map(providers.map((p) => [p.id, p.name]));
  const actionUrl = `/${mediaType === 'movie' ? 'movie' : 'tv'}/${tmdbId}/`;
  let notified = 0;
  await Promise.allSettled(items.map(async (it) => {
    const u = await readUserData(it.uid);
    if (!u) return;
    const qualifying = qualifyingProviders(u.settings, newIds, u.myProviders);
    if (qualifying.length === 0) return;
    // ONE push per title per availability-transition. If the title gains several
    // of the user's providers in the same run we notify about the first only —
    // "X går att streama nu" is the signal; the title page shows every provider.
    // The marker advances to include ALL current providers, so the others won't
    // re-fire later either. This is deliberate (avoids double-spam for one title).
    const providerName = nameById.get(qualifying[0]) ?? 'en av dina tjänster';
    const notifId = `available-${tmdbId}-${qualifying[0]}`;
    await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
      tmdbId, mediaType, title: it.title, kind: 'available_on_service',
      providerName, read: false, createdAt: FieldValue.serverTimestamp(),
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

export const availableNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 540, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    let titles: WatchlistTitleLite[] = [];
    try { titles = await readWatchlistTitles(); }
    catch (err) { logger.error('availableNotify: watchlist scan failed', err); return; }
    const byTitle = new Map<number, WatchlistTitleLite[]>();
    for (const it of titles) { const arr = byTitle.get(it.tmdbId); if (arr) arr.push(it); else byTitle.set(it.tmdbId, [it]); }
    let totalNotified = 0;
    for (const [tmdbId, items] of byTitle) {
      try { totalNotified += await processTitle(tmdbId, items); }
      catch (err) { logger.error(`availableNotify: title ${tmdbId} failed`, err); }
    }
    logger.info('availableNotify done', { watchlistDocs: titles.length, uniqueTitles: byTitle.size, notified: totalNotified });
  },
);
