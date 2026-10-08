/**
 * BIN-1449 — "Din streaming i september" in the bell on the 1st. One bell card per
 * user whose bill in Rådgivaren has something to show for the month that just ended:
 * a service that cost money, and something checked off. Bell only, no push, the same
 * promise as weeklyDigestNotify. The text names no amount, so the server never
 * repeats the price calculation (Malin's choice A, 2026-10-07).
 *
 * The card id is `monthly-bill-<yyyy-mm>`, written with create(), so a retried or
 * repeated run never doubles a card or marks a read one unread again. Admin SDK
 * writes under users/{uid}/notifications, which the account export and deletion
 * already cover as a whole collection.
 */

import { getFirestore, FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { createInboxCard } from '../shared/inboxCard';
import {
  activePauses, episodeCheckedOff, filmCheckedOff, hasPaidService, monthlyBillCard, monthlyBillOptedOut, previousStockholmMonth, showDocIds,
  type BillPause, type BillUser, type NotifyMonth,
} from './logic';

const USER_PAGE = 300;
const PROGRESS_PAGE = 200;

async function pausesFor(db: Firestore, uid: string, user: BillUser): Promise<BillPause[]> {
  const history = await db.collection('users').doc(uid).collection('pauseHistory').select('providerId', 'pausedAt', 'resumedAt').get();
  const finished = history.docs.flatMap(d => {
    const h = d.data();
    return typeof h.providerId === 'number' && typeof h.pausedAt === 'string'
      ? [{ providerId: h.providerId, pausedAt: h.pausedAt, resumedAt: typeof h.resumedAt === 'string' ? h.resumedAt : null }]
      : [];
  });
  return [...activePauses(user), ...finished];
}

/** Something checked off in the month, counted the way the client's bill counts it. */
async function checkedOffSomething(db: Firestore, uid: string, month: NotifyMonth): Promise<boolean> {
  const userRef = db.collection('users').doc(uid);
  const films = await userRef.collection('watchlist')
    .where('watchedAt', '>=', new Date(month.startMs))
    .where('watchedAt', '<', new Date(month.endMs))
    .select('mediaType', 'status', 'dropped', 'watchedAt')
    .get();
  if (films.docs.some(d => filmCheckedOff(d.data(), month))) return true;

  // Episodes carry their date inside the progress document, so the progress
  // documents are read, in pages so one large library cannot exhaust the run's
  // memory, and the read stops at the first hit. The client's bill counts an
  // episode only for a show in the library, so its watchlist row is checked too.
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = userRef.collection('episodeProgress').orderBy(FieldPath.documentId()).select('seasons').limit(PROGRESS_PAGE);
    if (cursor) q = q.startAfter(cursor);
    const page = await q.get();
    for (const doc of page.docs) {
      if (!episodeCheckedOff(doc.data(), month)) continue;
      for (const id of showDocIds(doc.id)) {
        const show = await userRef.collection('watchlist').doc(id).get();
        if (show.exists && show.get('mediaType') === 'tv') return true;
      }
    }
    if (page.size < PROGRESS_PAGE) return false;
    cursor = page.docs[page.docs.length - 1];
  }
}

async function handleUser(db: Firestore, doc: QueryDocumentSnapshot, month: NotifyMonth): Promise<'written' | 'existed' | 'skipped'> {
  const user = doc.data() as BillUser;
  if (!Array.isArray(user.myProviders) || user.myProviders.length === 0) return 'skipped';
  // Before any subcollection read, so a user who turned the card off costs nothing.
  if (monthlyBillOptedOut(user)) return 'skipped';
  const pauses = await pausesFor(db, doc.id, user);
  if (!hasPaidService(user, pauses, month)) return 'skipped';
  if (!(await checkedOffSomething(db, doc.id, month))) return 'skipped';
  const card = monthlyBillCard(month);
  return (await createInboxCard(db, doc.id, card.id, card)) ? 'written' : 'existed';
}

export const monthlyBillNotify = onSchedule(
  { schedule: '0 9 1 * *', timeZone: 'Europe/Stockholm', region: 'europe-west1', timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const month = previousStockholmMonth(new Date());
    const counts = { scanned: 0, written: 0, existed: 0, skipped: 0, failed: 0 };
    let cursor: QueryDocumentSnapshot | null = null;
    for (;;) {
      let q = db.collection('users').orderBy(FieldPath.documentId())
        .select('myProviders', 'providerTiers', 'providerCosts', 'providerPauses', 'providerCampaigns', 'notificationSettings.monthlyBill')
        .limit(USER_PAGE);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      for (const doc of page.docs) {
        counts.scanned += 1;
        try {
          counts[await handleUser(db, doc, month)] += 1;
        } catch (err) {
          counts.failed += 1;
          logger.warn('monthlyBillNotify: user failed', { uid: doc.id, err: String(err) });
        }
      }
      // A run cut off by the timeout logs no summary, so each page leaves a trace.
      logger.info('monthlyBillNotify: page', { month: month.id, ...counts });
      if (page.size < USER_PAGE) break;
      cursor = page.docs[page.docs.length - 1];
    }
    // A run that times out leaves the rest unwritten; a manual re-run is safe, since
    // the cards already written are skipped by their id.
    logger.info('monthlyBillNotify: done', { month: month.id, ...counts });
  },
);
