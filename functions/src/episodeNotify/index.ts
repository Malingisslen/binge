/**
 * Scheduled episode-release push (B4).
 *
 * onSchedule('every 6 hours', europe-west1). Scans collectionGroup('watchlist')
 * for TV in 'mina' (narrowed via .select()), groups by show, fetches TMDB airing
 * info per unique show, derives 'ikapp' per follower, dedupes against a per-show
 * episodeNotifyState/{tmdbId}.lastNotifiedEpisode marker (idempotent), and pushes
 * to followers who are caught up and have episodeReleases enabled.
 *
 * The Admin SDK bypasses firestore.rules, so the episodeNotifyState collection
 * needs no rule change.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { sendPushToUser } from '../push';
import { fetchTvAiringInfo } from './tmdb';
import { deriveSubState, shouldNotify, type WatchlistLite, type LastEpisode } from './logic';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');

async function readFollowedSeries(): Promise<WatchlistLite[]> {
  const db = getFirestore();
  const snap = await db.collectionGroup('watchlist')
    .where('mediaType', '==', 'tv').where('status', '==', 'mina')
    .select('mediaType', 'status', 'title', 'tmdbId', 'lastWatchedSeason', 'lastWatchedEpisode', 'tmdbStatus')
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    const uid = d.ref.parent.parent?.id ?? '';
    return {
      uid, tmdbId: Number(x.tmdbId ?? Number(d.id)), mediaType: String(x.mediaType ?? ''),
      status: String(x.status ?? ''), title: String(x.title ?? ''),
      lastWatchedSeason: typeof x.lastWatchedSeason === 'number' ? x.lastWatchedSeason : null,
      lastWatchedEpisode: typeof x.lastWatchedEpisode === 'number' ? x.lastWatchedEpisode : null,
      tmdbStatus: typeof x.tmdbStatus === 'string' ? x.tmdbStatus : null,
    };
  });
}
async function readLastNotified(tmdbId: number): Promise<number | null> {
  const snap = await getFirestore().collection('episodeNotifyState').doc(String(tmdbId)).get();
  const v = snap.data()?.lastNotifiedEpisode;
  return typeof v === 'number' ? v : null;
}
// Läser users/{uid} EN gång och returnerar båda notis-flaggorna, så vi slipper
// den dubbla läsningen (episodeReleases här + pushEnabled i sendPushToUser).
// null = user-doc saknas → notifiera inte alls. (BIN-33)
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
    pushEnabled: settings?.pushEnabled === true, // default off (måste opt:a in)
  };
}
function episodeCode(last: LastEpisode): string {
  return `S${String(last.season_number).padStart(2, '0')}E${String(last.episode_number).padStart(2, '0')}`;
}

/**
 * Leveranskontrakt (medvetna designval):
 * - AT-MOST-ONCE: markören (lastNotifiedEpisode) avanceras till last.id efter
 *   körningen oavsett om varje enskild push lyckades. En total FCM-utage ger
 *   alltså ingen retry för det avsnittet. Episod-nudgen är "nice to have", inte
 *   garanterad leverans — vi prioriterar idempotens (inga dubbletter vid re-run)
 *   framför at-least-once.
 * - TOM MOTTAGARLISTA avancerar också markören. Det är KORREKT: om ingen följare
 *   är 'ikapp' när avsnittet släpps är alla antingen 'aktiv' (har redan backlog,
 *   ska inte nudgas om ett nyare avsnitt) eller blir 'ikapp' först efter att de
 *   sett avsnittet (då behöver de ingen "nytt avsnitt"-notis). Att inte notifiera
 *   är rätt i båda fallen.
 * - KOSTNAD: per-mottagare-läsningen (readNotificationSettings — en doc-läsning
 *   vars pushEnabled vidarebefordras till sendPushToUser, BIN-33)
 *   körs BARA när shouldNotify är sann, dvs när en följd serie faktiskt fått ett
 *   nytt avsnitt — sällsynt per körning. Dominant kostnad är collectionGroup-
 *   svepet (ett per körning), inte per-mottagare-fan-out:en.
 */
async function processShow(tmdbId: number, items: WatchlistLite[]): Promise<number> {
  const info = await fetchTvAiringInfo(tmdbId);
  if (!info) return 0;
  const lastNotified = await readLastNotified(tmdbId);
  if (!shouldNotify(info.lastEpisode, lastNotified)) return 0;
  const last = info.lastEpisode!;
  const db = getFirestore();
  const recipients = items.filter((it) => deriveSubState(it, info.status, last) === 'ikapp');
  if (recipients.length === 0) {
    await db.collection('episodeNotifyState').doc(String(tmdbId))
      .set({ lastNotifiedEpisode: last.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return 0;
  }
  const title = recipients[0]?.title || 'En serie du följer';
  const code = episodeCode(last);
  const actionUrl = `/tv/${tmdbId}/`;
  let notified = 0;
  await Promise.allSettled(recipients.map(async (it) => {
    // En läsning av users/{uid} för båda flaggorna; pushEnabled vidarebefordras
    // till sendPushToUser så den slipper läsa samma doc igen (BIN-33).
    const settings = await readNotificationSettings(it.uid);
    if (!settings || !settings.episodeReleases) return;
    const notifId = `episode-${tmdbId}-${last.id}`;
    await db.collection('users').doc(it.uid).collection('notifications').doc(notifId).set({
      tmdbId, mediaType: 'tv', title: it.title || title, kind: 'episode_release',
      episodeCode: code, read: false, createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await sendPushToUser(it.uid, { title: 'Nytt avsnitt', body: `${it.title || title} — ${code} har släppts`, actionUrl, tag: `episode-${tmdbId}` }, { pushEnabled: settings.pushEnabled });
    notified += 1;
  }));
  await db.collection('episodeNotifyState').doc(String(tmdbId))
    .set({ lastNotifiedEpisode: last.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return notified;
}

export const episodeReleaseNotify = onSchedule(
  { schedule: 'every 6 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    let series: WatchlistLite[] = [];
    try { series = await readFollowedSeries(); }
    catch (err) { logger.error('episodeNotify: watchlist scan failed', err); return; }
    const byShow = new Map<number, WatchlistLite[]>();
    for (const it of series) { const arr = byShow.get(it.tmdbId); if (arr) arr.push(it); else byShow.set(it.tmdbId, [it]); }
    let totalNotified = 0;
    for (const [tmdbId, items] of byShow) {
      try { totalNotified += await processShow(tmdbId, items); }
      catch (err) { logger.error(`episodeNotify: show ${tmdbId} failed`, err); }
    }
    logger.info('episodeNotify done', { followedTvDocs: series.length, uniqueShows: byShow.size, notified: totalNotified });
  },
);
