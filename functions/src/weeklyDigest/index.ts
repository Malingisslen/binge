/**
 * BIN-163 — weekly "lämnar snart + nytt på dina tjänster" digest.
 *
 * onSchedule weekly (Mon 09:00 Europe/Stockholm). For each user who opted in
 * (notificationSettings.weeklyDigest == true) it rolls up, at library altitude,
 * what today is only ever a per-title badge:
 *   - LEAVING: titles in their library (vill_se films + mina series) whose
 *     streamingOffers carry a subscription offer leaving within 14 days on a
 *     provider they subscribe to (myProviders). Read straight from the shared
 *     streamingOffers docs that streamingOffersRefresh maintains — NO TMDB calls.
 *   - NEW: a COUNT of arrivals availableNotify already pushed this week (the
 *     user's own recent `provider_available` inbox docs) — summary, not a second
 *     detection system, so no duplicate notifications.
 *
 * Delivers ONE weekly push + ONE inbox card (kind 'weekly_digest', the only
 * non-tmdbId-shaped inbox kind — useNotifications renders it specially). Weekly
 * because the signal moves slowly and it keeps this the cheapest function in the
 * set (pure Firestore reads, once a week, only over opted-in users).
 *
 * Dedup: weeklyDigestState/{uid}.lastSentDate (the run's UTC date). Cloud
 * Scheduler is at-least-once; a same-day retry sees the marker and skips, so a
 * user never gets two digests for one Monday. Admin SDK bypasses firestore.rules
 * → the state collection needs no rule; the inbox doc is the user's own.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import {
  buildLeavingDigest,
  digestPushBody,
  hasDigestContent,
  type DigestOffer,
  type DigestTitle,
} from './logic';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LEAVING_WINDOW_DAYS = 14;
const MAX_CARD_ITEMS = 12; // cap the inbox card's title list; the count is exact

/** Read one user's library titles worth a digest (vill_se films + mina series). */
async function readLibraryTitles(uid: string): Promise<DigestTitle[]> {
  const db = getFirestore();
  const snap = await db.collection('users').doc(uid).collection('watchlist')
    .where('status', 'in', ['vill_se', 'mina'])
    .select('mediaType', 'status', 'title', 'tmdbId')
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      tmdbId: Number(x.tmdbId ?? Number(d.id)),
      title: String(x.title ?? ''),
      mediaType: (x.mediaType === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv',
    };
  });
}

/** Batch-read streamingOffers for the given title ids → offers per tmdbId. */
async function readOffers(tmdbIds: number[]): Promise<Map<number, DigestOffer[]>> {
  const db = getFirestore();
  const map = new Map<number, DigestOffer[]>();
  const ids = [...new Set(tmdbIds)];
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.collection('streamingOffers').doc(String(id)));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const offers = (s.get('offers') as DigestOffer[] | undefined) ?? [];
      map.set(Number(s.id), offers);
    }
  }
  return map;
}

/**
 * Count arrivals availableNotify delivered to this user in the last 7 days.
 * Filters on createdAt (single-field indexed) and keeps provider_available kinds
 * in code (legacy docs have no `kind` → treated as provider_available), avoiding
 * a composite index. Excludes episode_release and our own weekly_digest docs.
 */
async function countNewArrivals(uid: string, nowMs: number): Promise<number> {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(nowMs - WEEK_MS);
  const snap = await db.collection('users').doc(uid).collection('notifications')
    .where('createdAt', '>=', cutoff)
    .get();
  return snap.docs.filter((d) => {
    const kind = d.get('kind');
    return kind === undefined || kind === 'provider_available';
  }).length;
}

async function processUser(uid: string, data: FirebaseFirestore.DocumentData, nowMs: number, runDate: string): Promise<boolean> {
  const db = getFirestore();
  const settings = data.notificationSettings as { pushEnabled?: boolean } | undefined;
  const pushEnabled = settings?.pushEnabled === true;
  const myProviders = Array.isArray(data.myProviders)
    ? (data.myProviders as unknown[]).filter((n): n is number => typeof n === 'number')
    : [];

  const titles = await readLibraryTitles(uid);
  const offers = await readOffers(titles.map((t) => t.tmdbId));
  const leaving = buildLeavingDigest(titles, offers, myProviders, nowMs, LEAVING_WINDOW_DAYS);
  const newCount = await countNewArrivals(uid, nowMs);

  if (!hasDigestContent(leaving.length, newCount)) return false;

  // Idempotency: one digest per user per run-day. Checked AFTER content so an
  // empty week never burns the marker (next non-empty week still fires).
  const stateRef = db.collection('weeklyDigestState').doc(uid);
  if ((await stateRef.get()).get('lastSentDate') === runDate) return false;

  const summary = digestPushBody(leaving.length, newCount);
  await db.collection('users').doc(uid).collection('notifications').doc(`weekly-digest-${runDate}`).set({
    kind: 'weekly_digest',
    summary,
    leavingCount: leaving.length,
    newCount,
    items: leaving.slice(0, MAX_CARD_ITEMS).map((i) => ({
      tmdbId: i.tmdbId, title: i.title, mediaType: i.mediaType, leaving: i.leaving, daysLeft: i.daysLeft,
    })),
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await sendPushToUser(uid, {
    title: 'Din streamingvecka',
    body: summary,
    actionUrl: '/my/all',
    tag: 'weekly-digest',
  }, { pushEnabled });

  await stateRef.set({ lastSentDate: runDate, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

export const weeklyDigestNotify = onSchedule(
  { schedule: 'every monday 09:00', timeZone: 'Europe/Stockholm', region: 'europe-west1', timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const runDate = new Date(nowMs).toISOString().slice(0, 10);

    let snap;
    try {
      snap = await db.collection('users').where('notificationSettings.weeklyDigest', '==', true).get();
    } catch (err) {
      logger.error('weeklyDigestNotify: user query failed', err);
      return;
    }

    let sent = 0;
    for (const doc of snap.docs) {
      try {
        if (await processUser(doc.id, doc.data(), nowMs, runDate)) sent += 1;
      } catch (err) {
        logger.error(`weeklyDigestNotify: user ${doc.id} failed`, err);
      }
    }
    logger.info('weeklyDigestNotify done', { optedInUsers: snap.size, sent });
  },
);
