/**
 * Scheduled episode-release detection (B4, BIN-1475).
 *
 * onSchedule('every 6 hours', europe-west1). Scans collectionGroup('watchlist')
 * for TV in 'mina' (narrowed via .select()), groups by show, fetches TMDB airing
 * info per unique show, derives 'ikapp' per follower, dedupes against a per-show
 * episodeNotifyState/{tmdbId}.lastNotifiedEpisode marker (idempotent), and QUEUES
 * the caught-up followers on the same state doc (`pending`, `hasPending`).
 *
 * It sends nothing itself: episodeMorningDigest turns the queue into one inbox
 * card and one push per user at 08:00, so a user never gets a per-episode push
 * and a morning question about the same episode.
 *
 * The Admin SDK bypasses firestore.rules, so the episodeNotifyState collection
 * needs no rule change.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { readFollowedSeries } from '../shared/followedSeries';
import { fetchTvAiringInfo } from './tmdb';
import { trimStaleQueue } from '../episodeDigest/trimQueue';
import { deriveSubState, shouldNotify, type WatchlistLite } from './logic';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');
async function readLastNotified(tmdbId: number): Promise<number | null> {
  const snap = await getFirestore().collection('episodeNotifyState').doc(String(tmdbId)).get();
  const v = snap.data()?.lastNotifiedEpisode;
  return typeof v === 'number' ? v : null;
}

/**
 * Leveranskontrakt (medvetna designval):
 * - AT-MOST-ONCE: markören (lastNotifiedEpisode) avanceras till last.id i samma
 *   skrivning som kön fylls, så en omkörning köar inte samma avsnitt igen.
 * - TOM MOTTAGARLISTA avancerar också markören. Det är KORREKT: om ingen följare
 *   är 'ikapp' när avsnittet släpps är alla antingen 'aktiv' (har redan backlog,
 *   ska inte nudgas om ett nyare avsnitt) eller blir 'ikapp' först efter att de
 *   sett avsnittet (då behöver de ingen fråga). Att inte köa är rätt i båda fallen.
 * - Inställningen "Nya avsnitt" och att serien fortfarande följs kontrolleras först
 *   vid utskicket (episodeMorningDigest), så ett val som ändras under natten gäller.
 * - Kön bär bara uid:n, inga titlar. episodeMorningDigest tar bort de uid:n den
 *   är klar med, och poster äldre än tre dygn.
 */
async function processShow(tmdbId: number, items: WatchlistLite[]): Promise<number> {
  const info = await fetchTvAiringInfo(tmdbId);
  if (!info) return 0;
  const lastNotified = await readLastNotified(tmdbId);
  if (!shouldNotify(info.lastEpisode, lastNotified)) return 0;
  const last = info.lastEpisode!;
  const db = getFirestore();
  const uids = [...new Set(items.filter((it) => deriveSubState(it, info.status, last) === 'ikapp').map((it) => it.uid))];
  const stateRef = db.collection('episodeNotifyState').doc(String(tmdbId));
  if (uids.length === 0) {
    await stateRef.set({ lastNotifiedEpisode: last.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return 0;
  }
  await stateRef.set({
    lastNotifiedEpisode: last.id,
    hasPending: true,
    pending: FieldValue.arrayUnion({
      episodeId: last.id, season: last.season_number, episode: last.episode_number,
      airDate: last.air_date ?? null, uids, queuedAt: Date.now(),
    }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return uids.length;
}

export const episodeReleaseNotify = onSchedule(
  { schedule: 'every 6 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY] },
  async () => {
    // First, so it runs even when the scan below fails.
    try { await trimStaleQueue(Date.now()); }
    catch (err) { logger.error('episodeNotify: queue trim failed', err); }
    let series: WatchlistLite[] = [];
    try { series = await readFollowedSeries(); }
    catch (err) { logger.error('episodeNotify: watchlist scan failed', err); return; }
    const byShow = new Map<number, WatchlistLite[]>();
    for (const it of series) { const arr = byShow.get(it.tmdbId); if (arr) arr.push(it); else byShow.set(it.tmdbId, [it]); }
    let totalNotified = 0; // queued recipients, not pushes
    for (const [tmdbId, items] of byShow) {
      try { totalNotified += await processShow(tmdbId, items); }
      catch (err) { logger.error(`episodeNotify: show ${tmdbId} failed`, err); }
    }
    logger.info('episodeNotify done', { followedTvDocs: series.length, uniqueShows: byShow.size, queued: totalNotified });
  },
);
