import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './config';

/**
 * UGC-rapportering — skapar en report-doc i top-level `reports/{reportId}`
 * collection. Admin-flödet hanteras off-line via Firebase Console (se
 * docs/moderation.md för runbook när den skrivs).
 *
 * Rate-limiting är regel-side: firestore.rules har en rule att en användare
 * bara kan skapa X rapporter per tidsfönster (server-time-kontroll). Här
 * klient-side gör vi bara en enkel "minst 1 sekund mellan rapporter"-throttle
 * så brytbutonen inte kan spammas av misstag.
 *
 * Data-model: reports dokumentets fält
 * - reporterUid: string (request.auth.uid, enforced by rules)
 * - targetType: 'review' | 'comment' | 'user' | 'list'
 * - targetId: string (review doc id, comment path, uid, list id)
 * - targetOwnerUid: string (snapshot of uid that posted the content)
 * - reason: 'spam' | 'hate' | 'harassment' | 'illegal' | 'pii' | 'other'
 * - note?: string (max 500 chars)
 * - createdAt: Timestamp
 * - status: 'open' — admin kan sätta till 'reviewed' / 'actioned' / 'dismissed'
 */

export type ReportReason =
  | 'spam'
  | 'hate'
  | 'harassment'
  | 'illegal'
  | 'pii'
  | 'other';

export type ReportTargetType = 'review' | 'comment' | 'user' | 'list';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam / reklam',
  hate: 'Hatiskt innehåll / rasism',
  harassment: 'Trakasserier / personangrepp',
  illegal: 'Olagligt innehåll',
  pii: 'Delar privat information (PII)',
  other: 'Annat',
};

let lastReportAt = 0;
const REPORT_COOLDOWN_MS = 1000;

export async function createReport(params: {
  reporterUid: string;
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerUid: string;
  reason: ReportReason;
  note?: string;
}): Promise<void> {
  const now = Date.now();
  if (now - lastReportAt < REPORT_COOLDOWN_MS) {
    throw new Error('Vänta lite innan du rapporterar igen.');
  }
  lastReportAt = now;

  const trimmedNote = params.note?.trim().slice(0, 500);

  await addDoc(collection(db, 'reports'), {
    reporterUid: params.reporterUid,
    targetType: params.targetType,
    targetId: params.targetId,
    targetOwnerUid: params.targetOwnerUid,
    reason: params.reason,
    ...(trimmedNote ? { note: trimmedNote } : {}),
    status: 'open',
    createdAt: serverTimestamp(),
  });
}
