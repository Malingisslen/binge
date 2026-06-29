/**
 * BIN-188 — "Serien är tillbaka": dormancy-return push.
 *
 * onSchedule('every 24 hours', europe-west1). Scans collectionGroup('watchlist')
 * for TV in 'mina', groups by show, fetches TMDB airing info per unique show,
 * and — when TMDB has announced a SEASON PREMIERE (next_episode_to_air.episode_
 * number === 1) the show hasn't been notified for — pushes the followers who had
 * reached 'ikapp' or 'avslutad' (caught up): "Severance säsong 2 är på väg — du
 * var ikapp."
 *
 * Dedupe marker: returnNotifyState/{tmdbId}.lastNotifiedNextEpisode = next.id.
 * At-most-once + idempotent (the marker advances even on an empty recipient set),
 * same delivery contract as episodeReleaseNotify. The Admin SDK bypasses
 * firestore.rules, so returnNotifyState needs no rule change.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { readFollowedSeries } from '../shared/followedSeries';
import type { WatchlistLite } from '../episodeNotify/logic';
import { fetchTvReturnInfo } from './tmdb';
import { isCaughtUp, shouldNotifyReturn } from './logic';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

// Returns the last observed next-episode id + whether the marker doc exists.
// exists=false → first observation of this show → baseline (no notify).
async function readObservedNext(tmdbId: number): Promise<{ lastId: number | null; exists: boolean }> {
  const snap = await getFirestore().collection('returnNotifyState').doc(String(tmdbId)).get();
  const v = snap.data()?.lastObservedNextEpisode;
  return { lastId: typeof v === 'number' ? v : null, exists: snap.exists };
}

// One read of users/{uid} for both notif flags (reuses episodeReleases — a
// season-return is an episode-release event; no new setting). null = no user doc.
async function readNotificationSettings(
  uid: string,
): Promise<{ episodeReleases: boolean; pushEnabled: boolean } | null> {
  const snap = await getFirestore().collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const settings = snap.data()?.notificationSettings as
    | { episodeReleases?: boolean; pushEnabled?: boolean }
    | undefined;
  return {
    episodeReleases: settings?.episodeReleases !== false, // default on
    pushEnabled: settings?.pushEnabled === true,          // default off (opt-in)
  };
}

async function processShow(tmdbId: number, items: WatchlistLite[]): Promise<number> {
  const info = await fetchTvReturnInfo(tmdbId);
  if (!info) return 0;
  const db = getFirestore();

  const marker = await readObservedNext(tmdbId);
  // State marker: the current next-episode id (0 = no next). Always advanced so
  // the baseline gets recorded on the first observation and we dedupe after.
  const observedId = info.nextEpisode ? info.nextEpisode.id : 0;
  const writeMarker = () => db.collection('returnNotifyState').doc(String(tmdbId))
    .set({ lastObservedNextEpisode: observedId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  let notified = 0;
  if (shouldNotifyReturn(info.nextEpisode, marker.lastId, !marker.exists)) {
    const next = info.nextEpisode!;
    const recipients = items.filter((it) => isCaughtUp(it, info.status, info.lastEpisode));
    const title = recipients[0]?.title || 'En serie du följer';
    const actionUrl = `/tv/${tmdbId}/`;
    const seasonBit = `säsong ${next.season_number}`;
    await Promise.allSettled(recipients.map(async (it) => {
      const settings = await readNotificationSettings(it.uid);
      if (!settings || !settings.episodeReleases) return;
      const notifId = `return-${tmdbId}-${next.id}`;
      await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
        tmdbId, mediaType: 'tv', title: it.title || title, kind: 'show_return',
        seasonNumber: next.season_number, read: false, createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await sendPushToUser(it.uid, {
        title: 'Serien är tillbaka',
        body: `${it.title || title} — ${seasonBit} är på väg, du var ikapp`,
        actionUrl,
        tag: `return-${tmdbId}`,
      }, { pushEnabled: settings.pushEnabled });
      notified += 1;
    }));
  }

  // Always advance the marker (baseline on first observation; dedupe afterwards).
  await writeMarker();
  return notified;
}

export const showReturnNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    let series: WatchlistLite[] = [];
    try { series = await readFollowedSeries(); }
    catch (err) { logger.error('returnNotify: watchlist scan failed', err); return; }
    const byShow = new Map<number, WatchlistLite[]>();
    for (const it of series) { const arr = byShow.get(it.tmdbId); if (arr) arr.push(it); else byShow.set(it.tmdbId, [it]); }
    let totalNotified = 0;
    for (const [tmdbId, items] of byShow) {
      try { totalNotified += await processShow(tmdbId, items); }
      catch (err) { logger.error(`returnNotify: show ${tmdbId} failed`, err); }
    }
    logger.info('returnNotify done', { followedTvDocs: series.length, uniqueShows: byShow.size, notified: totalNotified });
  },
);
