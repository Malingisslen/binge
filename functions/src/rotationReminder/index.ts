/**
 * BIN-181 — rotation reminder push ("Dags att pausa Viaplay" / "Viaplay är värt
 * det igen").
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

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { dueRotationEvents, type RotationScheduleItem } from './logic';

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
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
    const today = todayIsoUtc();

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
          // Push-only (no inbox doc) — the inbox model is tmdbId-shaped and a
          // rotation reminder has no title; the FCM push carries the message.
          await sendPushToUser(doc.id, {
            title: isCancel ? 'Dags att rotera' : 'Värt det igen',
            body: isCancel
              ? `Dags att pausa ${ev.shortName} — inget du följer sänds just nu`
              : `${ev.shortName} är värt det igen — nytt att följa`,
            actionUrl: '/savings/',
            tag: `rotation-${ev.providerId}`,
          }, { pushEnabled });
          // uid stored so a future delete-cascade can sweep these markers; until
          // then they're sealed garbage (default-deny, UIDs never recycled), same
          // accepted residual as titleRatingsRateLimit.
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
