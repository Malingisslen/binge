/**
 * BIN-1475 — the morning question: ONE inbox card and ONE push per user at 08:00
 * Stockholm, "Igår kom 3 avsnitt du följer", opening a list where each episode
 * can be ticked off.
 *
 * Input is the queue episodeReleaseNotify leaves on episodeNotifyState/{tmdbId}
 * (`hasPending`, `pending[]`). Nothing is sent per episode any more.
 *
 * At send time, not at queue time, each user is checked again: the "Nya avsnitt"
 * setting is still on, the series is still followed ('mina'), and the episode is
 * not already watched. A user who changed their mind overnight gets nothing.
 *
 * Idempotency: the card id carries the run's Stockholm date and is written with
 * create(); a retry finds it and sends no second push, so a user gets at most one
 * push per day. The card is the load-bearing write; the push after it is best
 * effort, so a push failure never makes the user count as failed (a failed user
 * would be told again tomorrow under a new card id). Afterwards each show's queue
 * loses exactly the uids this run finished with, inside a transaction, so an
 * episode queued meanwhile is kept. Admin SDK bypasses firestore.rules; the card
 * is the user's own inbox doc.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { stockholmDayId } from '../util/dayId';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';
import {
  MAX_DIGEST_ITEMS, alreadyWatched, settlePending, allAiredYesterday, digestBody, digestTitle, groupQueueByUser, onePerShow,
  type DigestItem, type PendingEpisode,
} from './logic';

const DAY_MS = 24 * 60 * 60 * 1000;

async function readQueue(): Promise<Array<{ tmdbId: number; pending: PendingEpisode[] }>> {
  const snap = await getFirestore().collection('episodeNotifyState').where('hasPending', '==', true).get();
  const out: Array<{ tmdbId: number; pending: PendingEpisode[] }> = [];
  for (const d of snap.docs) {
    const tmdbId = Number(d.id);
    const pending = d.get('pending');
    if (Number.isFinite(tmdbId) && Array.isArray(pending)) out.push({ tmdbId, pending: pending as PendingEpisode[] });
  }
  return out;
}

/** The followed, still-unwatched episodes for one user; [] when they should hear nothing. */
async function itemsForUser(
  uid: string,
  queued: Array<{ tmdbId: number; season: number; episode: number; airDate: string | null }>,
): Promise<{ items: DigestItem[]; pushEnabled: boolean } | null> {
  const db = getFirestore();
  const profile = await db.collection('users').doc(uid).get();
  if (!profile.exists) return null;
  const settings = profile.data()?.notificationSettings as { episodeReleases?: boolean; pushEnabled?: boolean } | undefined;
  if (settings?.episodeReleases === false) return null;

  const refs = queued.flatMap((q) => [
    db.collection('users').doc(uid).collection('watchlist').doc(mediaTypeDocId('tv', q.tmdbId)),
    db.collection('users').doc(uid).collection('watchlist').doc(String(q.tmdbId)), // legacy bare id
  ]);
  const snaps = await db.getAll(...refs);
  const items: DigestItem[] = [];
  queued.forEach((q, i) => {
    const doc = [snaps[i * 2], snaps[i * 2 + 1]].find((s) => s.exists && s.get('mediaType') === 'tv');
    if (!doc || doc.get('status') !== 'mina') return;
    const season = doc.get('lastWatchedSeason');
    const episode = doc.get('lastWatchedEpisode');
    if (alreadyWatched({
      lastWatchedSeason: typeof season === 'number' ? season : null,
      lastWatchedEpisode: typeof episode === 'number' ? episode : null,
    }, q.season, q.episode)) return;
    items.push({ tmdbId: q.tmdbId, title: String(doc.get('title') ?? ''), season: q.season, episode: q.episode, airDate: q.airDate });
  });
  return { items, pushEnabled: settings?.pushEnabled === true };
}

async function sendDigest(uid: string, queued: Parameters<typeof itemsForUser>[1], runDate: string, yesterdayId: string): Promise<boolean> {
  const found = await itemsForUser(uid, queued);
  if (!found) return false;
  const items = onePerShow(found.items).filter((i) => i.title !== '').slice(0, MAX_DIGEST_ITEMS);
  if (items.length === 0) return false;

  const title = digestTitle(items.length, allAiredYesterday(items, yesterdayId));
  const body = digestBody(items);
  try {
    await getFirestore().collection('users').doc(uid).collection('notifications').doc(`episode-digest-${runDate}`).create({
      kind: 'episode_digest',
      title,
      summary: body,
      episodes: items.map((i) => ({ tmdbId: i.tmdbId, title: i.title, season: i.season, episode: i.episode })),
      actionUrl: '/my/igar/',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if ((err as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS: today's card and push are done
    throw err;
  }
  try {
    await sendPushToUser(uid, { title, body, actionUrl: '/my/igar/', tag: 'episode-digest' }, { pushEnabled: found.pushEnabled });
  } catch (err) { logger.warn(`episodeMorningDigest: push to ${uid} failed after the card was written`, err); }
  return true;
}

export const episodeMorningDigest = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Europe/Stockholm', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const now = Date.now();
    const runDate = stockholmDayId(new Date(now));
    const yesterdayId = stockholmDayId(new Date(now - DAY_MS));
    let queue: Awaited<ReturnType<typeof readQueue>>;
    try { queue = await readQueue(); }
    catch (err) { logger.error('episodeMorningDigest: queue read failed', err); return; }

    const byUser = groupQueueByUser(queue);
    const failed = new Set<string>();
    let sent = 0;
    for (const [uid, queued] of byUser) {
      try { if (await sendDigest(uid, queued, runDate, yesterdayId)) sent += 1; }
      catch (err) { failed.add(uid); logger.error(`episodeMorningDigest: user ${uid} failed`, err); }
    }

    const db = getFirestore();
    const done = new Set([...byUser.keys()].filter((u) => !failed.has(u)));
    for (const show of queue) {
      const readIds = new Set(show.pending.map((p) => p.episodeId));
      const ref = db.collection('episodeNotifyState').doc(String(show.tmdbId));
      try {
        await db.runTransaction(async (tx) => {
          const current = (await tx.get(ref)).get('pending');
          const rest = settlePending(Array.isArray(current) ? (current as PendingEpisode[]) : [], readIds, done, now);
          if (rest.length === 0) tx.update(ref, { pending: FieldValue.delete(), hasPending: FieldValue.delete() });
          else tx.update(ref, { pending: rest });
        });
      } catch (err) { logger.error(`episodeMorningDigest: settling queue for ${show.tmdbId} failed`, err); }
    }
    logger.info('episodeMorningDigest done', { shows: queue.length, users: byUser.size, sent, failed: failed.size });
  },
);
