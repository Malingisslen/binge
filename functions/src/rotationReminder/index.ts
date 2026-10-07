/**
 * BIN-181 — rotation reminder push ("Dags att pausa Viaplay" / "Viaplay är värt
 * det igen"). Since BIN-1442 each reminder is also a card in the app's bell, and
 * the same daily run sends the "Påminn mig" reminders for paused services
 * (runPauseReminders below).
 *
 * onSchedule('every 24 hours', europe-west1). Queries users who opted into
 * rotation reminders (notificationSettings.rotationReminders == true), reads the
 * schedule the client persisted (users/{uid}.rotationSchedule — derived from the
 * rotation calendar), and fires a push for each cancel/resume event falling due
 * within the next day (dueRotationEvents).
 *
 * Dedup marker: rotationReminderState/{uid}_{providerId}_{kind}_{date}, written
 * AFTER the push (so a crash between send and marker can re-send once next run —
 * effectively at-most-once in steady state; the FCM `tag` collapses any duplicate).
 * Admin SDK bypasses firestore.rules → no rule change; the
 * inline rotationSchedule field + the opt-in flag are owner-writable user-doc
 * fields. Reads only opted-in users (indexed equality query), so it's cheap.
 */

import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { dueRotationEvents, type RotationScheduleItem } from './logic';
// BIN-350: the "due today" window compares against user-set cancel/resume dates,
// which are Stockholm wall-clock dates — so today must be the Stockholm day too,
// not UTC (a 01:00 local reminder would otherwise fire against yesterday's window).
import { stockholmDayId } from '../util/dayId';
import { PROVIDER_NAMES } from '../shared/providerNames';
import { createInboxCard } from '../shared/inboxCard';
import {
  countFollowedAiring,
  duePauseReminders,
  nextPauseReminderAfter,
  pauseReminderBody,
  type FollowedSeries,
} from './pauseReminder';

/** Users handled per run by the pause-reminder pass; the rest wait a day. */
const PAUSE_REMINDER_PAGE = 500;
/** Followed series read per due user; past it the count in the text is a floor. */
const FOLLOWED_READ_LIMIT = 1000;

/**
 * BIN-1442 — "Påminn mig" after Pausa. Finds users whose earliest reminded pause
 * ends today or earlier, and for each due pause writes a bell card and, when push
 * is on, a push. Nothing in the user's document reaches the text except through
 * pauseReminder.ts's checks.
 *
 * Order per pause: card (create, idempotent) → marker (create; if it exists the
 * push already went) → push. Then the reminders are cleared with update(), which
 * fails rather than recreating a profile that was deleted meanwhile.
 */
async function runPauseReminders(db: Firestore, today: string): Promise<number> {
  const snap = await db.collection('users')
    .where('pauseReminderNext', '<=', today)
    .select('providerPauses', 'notificationSettings')
    .limit(PAUSE_REMINDER_PAGE)
    .get();
  let sent = 0;
  for (const doc of snap.docs) {
    try {
      const data = doc.data();
      const pushEnabled = (data.notificationSettings as { pushEnabled?: boolean } | undefined)?.pushEnabled === true;
      const due = duePauseReminders(data.providerPauses, today);
      if (due.length > 0) {
        const followed = await db.collection('users').doc(doc.id).collection('watchlist')
          .where('status', '==', 'mina')
          .select('subscriptionProviders', 'nextAirDate')
          .limit(FOLLOWED_READ_LIMIT)
          .get();
        const series = followed.docs.map(d => d.data() as FollowedSeries);
        for (const r of due) {
          const body = pauseReminderBody(r.providerName, countFollowedAiring(series, r.providerId, today));
          await createInboxCard(db, doc.id, `pause-reminder-${r.providerId}-${r.resumeAt}`, { title: r.providerName, body });
          const markerRef = db.collection('rotationReminderState').doc(`${doc.id}_${r.providerId}_pause_${r.resumeAt}`);
          try {
            await markerRef.create({ uid: doc.id, notifiedAt: FieldValue.serverTimestamp() });
          } catch (err) {
            if ((err as { code?: unknown }).code === 6) continue; // pushed on an earlier run
            throw err;
          }
          await sendPushToUser(doc.id, {
            title: r.providerName,
            body,
            actionUrl: '/savings/',
            tag: `pause-reminder-${r.providerId}`,
          }, { pushEnabled });
          sent += 1;
        }
      }
      // Clear what was handled, and anything malformed that kept the user in the
      // query: the next reminder is recomputed from what is still valid.
      const next = nextPauseReminderAfter(data.providerPauses, due.map(r => r.providerId));
      // Map keys are numeric provider ids, so the dotted path is unambiguous.
      const patch: Record<string, unknown> = { pauseReminderNext: next ?? FieldValue.delete() };
      for (const r of due) patch[`providerPauses.${r.providerId}.remind`] = FieldValue.delete();
      await doc.ref.update(patch);
    } catch (err) {
      logger.error(`rotationReminderNotify: pause reminder for ${doc.id} failed`, err);
    }
  }
  logger.info('rotationReminderNotify pause reminders done', { dueUsers: snap.size, sent });
  return sent;
}

function parseSchedule(raw: unknown): RotationScheduleItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RotationScheduleItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.providerId !== 'number' || typeof x.cancelDate !== 'string') continue;
    out.push({
      providerId: x.providerId,
      // Cap length — rotationSchedule is a client-written user-doc field, so a
      // crafted huge shortName would otherwise reach the FCM body + logs every run.
      shortName: typeof x.shortName === 'string' ? x.shortName.slice(0, 64) : 'en tjänst',
      cancelDate: x.cancelDate,
      resumeDate: typeof x.resumeDate === 'string' ? x.resumeDate : null,
    });
  }
  return out;
}

export const rotationReminderNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const db = getFirestore();
    const today = stockholmDayId();

    try {
      await runPauseReminders(db, today);
    } catch (err) {
      logger.error('rotationReminderNotify: pause reminder query failed', err);
    }

    let snap;
    try {
      snap = await db.collection('users').where('notificationSettings.rotationReminders', '==', true).get();
    } catch (err) {
      logger.error('rotationReminderNotify: user query failed', err);
      return;
    }

    let totalNotified = 0;
    for (const doc of snap.docs) {
      try {
        const data = doc.data();
        const pushEnabled = (data.notificationSettings as { pushEnabled?: boolean } | undefined)?.pushEnabled === true;
        const schedule = parseSchedule(data.rotationSchedule);
        const due = dueRotationEvents(schedule, today);
        for (const ev of due) {
          const markerId = `${doc.id}_${ev.providerId}_${ev.kind}_${ev.date}`;
          const markerRef = db.collection('rotationReminderState').doc(markerId);
          if ((await markerRef.get()).exists) continue; // already reminded

          const isCancel = ev.kind === 'cancel';
          // BIN-1442: the name comes from the server's list when it knows the
          // service; the client-written shortName is only the fallback.
          const name = PROVIDER_NAMES[ev.providerId] ?? ev.shortName;
          const title = isCancel ? 'Dags att rotera' : 'Värt det igen';
          const body = isCancel
            ? `Dags att pausa ${name} — inget du följer sänds just nu`
            : `${name} är värt det igen — nytt att följa`;
          // BIN-1442: a bell card as well as the push (a `system` card needs no
          // title id), so the reminder reaches someone without push turned on.
          await createInboxCard(db, doc.id, `rotation-${ev.providerId}-${ev.kind}-${ev.date}`, { title, body });
          await sendPushToUser(doc.id, {
            title,
            body,
            actionUrl: '/savings/',
            tag: `rotation-${ev.providerId}`,
          }, { pushEnabled });
          await markerRef.set({ uid: doc.id, notifiedAt: FieldValue.serverTimestamp() }, { merge: true });
          totalNotified += 1;
        }
      } catch (err) {
        logger.error(`rotationReminderNotify: user ${doc.id} failed`, err);
      }
    }
    logger.info('rotationReminderNotify done', { optedInUsers: snap.size, notified: totalNotified });
  },
);
