/**
 * BIN-1444 — push när en tjänst och nivå du har ändrar pris (paket L).
 *
 * onSchedule('every 24 hours', europe-west1). Prisändringarna finns bara i
 * klientkatalogen, som prisagenten uppdaterar och som bara deployar sajten. Sajten
 * publicerar dem därför som /prisandringar.json vid bygget, med banderollens text
 * färdigbyggd, och den här funktionen hämtar filen. En ny rad når alltså pushen
 * utan någon functions-deploy.
 *
 * Mottagare: användare med notificationSettings.priceChanges == true (opt-in,
 * förvalt av) vars tjänst, nivå och paus matchar raden (rowAppliesTo).
 *
 * Dedup per prisändring, inte per användare: priceChangeNotifyState/{key} skrivs
 * FÖRE utskicket, så en rad pushas högst en gång — en krasch mitt i tappar resten
 * av mottagarna hellre än att pusha någon två gånger. Markören skrivs med
 * done: false och vänds till true efter loopen, så en avbruten rad syns i
 * databasen. Markören bär ingen uid och
 * namnger ingen användare, så den är ingen persondata och behöver ingen
 * raderingsväg. Admin SDK förbigår firestore.rules → ingen regeländring.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendPushToUser } from '../push';
import { stockholmDayId } from '../util/dayId';
import { freshRows, parseFeed, rowAppliesTo } from './logic';

const FEED_URL = 'https://binge.nu/prisandringar.json';
const FETCH_TIMEOUT_MS = 10_000;

async function fetchFeed() {
  const res = await fetch(FEED_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.json());
}

export const priceChangeNotify = onSchedule(
  { schedule: 'every 24 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    let rows;
    try {
      rows = await fetchFeed();
    } catch (err) {
      logger.error('priceChangeNotify: feed fetch failed', err);
      return;
    }
    if (!rows) {
      logger.error('priceChangeNotify: feed failed validation, nothing sent');
      return;
    }

    const db = getFirestore();
    const pending = [];
    for (const row of freshRows(rows, stockholmDayId())) {
      const marker = db.collection('priceChangeNotifyState').doc(row.key);
      if ((await marker.get()).exists) continue;
      pending.push({ row, marker });
    }
    if (pending.length === 0) {
      logger.info('priceChangeNotify done', { freshRows: 0 });
      return;
    }

    let snap;
    try {
      // En läsning per opt-in-användare, bara de körningar som har en ny rad. Ingen
      // sidindelning ännu; select() hämtar bara fälten rowAppliesTo och pushen läser.
      snap = await db
        .collection('users')
        .where('notificationSettings.priceChanges', '==', true)
        .select('myProviders', 'providerTiers', 'providerPauses', 'notificationSettings')
        .get();
    } catch (err) {
      logger.error('priceChangeNotify: user query failed', err);
      return;
    }

    let notified = 0;
    let failed = 0;
    for (const { row, marker } of pending) {
      // create, inte set: en överlappande körning som hunnit först får raden.
      try {
        await marker.create({ notifiedAt: FieldValue.serverTimestamp(), done: false });
      } catch {
        continue;
      }
      for (const doc of snap.docs) {
        try {
          const data = doc.data();
          if (!rowAppliesTo(row, data)) continue;
          const pushEnabled = (data.notificationSettings as { pushEnabled?: boolean } | undefined)?.pushEnabled === true;
          await sendPushToUser(doc.id, {
            title: row.title,
            body: row.body,
            actionUrl: '/savings/',
            tag: `price-change-${row.key}`,
          }, { pushEnabled });
          notified += 1;
        } catch (err) {
          failed += 1;
          logger.error(`priceChangeNotify: user ${doc.id} failed`, err);
        }
      }
      try {
        await marker.update({ done: true });
      } catch (err) {
        logger.error(`priceChangeNotify: partial send, marker ${row.key} not closed`, err);
      }
    }
    logger.info('priceChangeNotify done', { freshRows: pending.length, optedInUsers: snap.size, notified, failed });
  },
);
