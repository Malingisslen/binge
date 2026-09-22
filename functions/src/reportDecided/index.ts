/**
 * BIN-1259 — tell the reporter when their report has been decided.
 *
 * A Firestore trigger rather than a write from `/admin/reports`, because
 * `users/{uid}/notifications` is `allow create: if false`: only the Admin SDK can
 * put a card in someone else's inbox. Adding an `isAdmin()` create branch there
 * would let any admin session write arbitrary content into any user's inbox — a
 * far wider right than this feature needs. #4 Security Architect's binding
 * condition.
 *
 * The trigger reads only `status` and `reporterUid` off the report. It never
 * reads `note`, `reason` or any future admin-written reason field, which is what
 * makes "the reporter never sees the admin's own words" structural rather than a
 * discipline a later edit could break. BIN-1250's reason field is internal.
 *
 * Idempotence is the document id, not a marker document. The card is written at
 * `report_{reportId}`, so Firestore's at-least-once delivery collapses onto the
 * same document instead of stacking cards. A report that is re-opened and decided
 * again lands on that same id too — one card per report, which is what a reader
 * wants from an inbox.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

import { decidesReport, reporterToNotify, REPORT_DECIDED_CARD } from './logic';

export const notifyReportDecided = onDocumentUpdated(
  { document: 'reports/{reportId}', region: 'europe-west1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!decidesReport(before, after)) return;

    const reporterUid = reporterToNotify(after);
    if (!reporterUid) {
      // A report old enough to predate `reporterUid`, or one whose field is
      // unreadable. There is nobody to tell; the decision itself stands.
      logger.info('notifyReportDecided: no reporter on the report, nothing sent', {
        reportId: event.params.reportId,
      });
      return;
    }

    const db = getFirestore();
    try {
      // `create`, not `set`. The fixed id alone stops cards STACKING, but a `set`
      // would rewrite `read: false` and a fresh `createdAt` on every redelivery —
      // so an at-least-once retry could mark a card the reporter had already
      // opened unread again and lift it back to the top of an inbox ordered by
      // `createdAt`. `create` fails closed on the second delivery instead.
      await db
        .collection('users')
        .doc(reporterUid)
        .collection('notifications')
        .doc(`report_${event.params.reportId}`)
        .create({
          kind: 'system',
          title: REPORT_DECIDED_CARD.title,
          body: REPORT_DECIDED_CARD.body,
          // No `actionUrl`: `reports/{reportId}` is admin-read-only, so there is
          // nothing the reporter could open. `TopbarActions` renders a system
          // card without one as a plain row rather than a link, so the absence
          // is the intended behaviour and not a fall-through.
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
      // ALREADY_EXISTS is the ordinary redelivery, not a failure. Anything else
      // is rethrown, which surfaces it in the logs. Whether the platform then
      // redelivers is a separate decision this trigger has not made: `retry` is
      // opt-in on a v2 trigger and is not set here, as `communityRatings`
      // measured for itself. A transient write failure therefore loses the card.
      if ((err as { code?: number }).code !== 6) throw err;
      logger.info('notifyReportDecided: card already written, redelivery ignored', {
        reportId: event.params.reportId,
      });
    }
  },
);
