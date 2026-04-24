import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './config';
import { toDate } from './utils';

/**
 * UGC-rapportering + admin-moderation. Skriv till top-level `reports/`,
 * admin läser via /admin/reports/ (firestore.rules gate:ar).
 */

export type ReportReason =
  | 'spam'
  | 'hate'
  | 'harassment'
  | 'illegal'
  | 'pii'
  | 'other';

export type ReportTargetType = 'review' | 'comment' | 'user' | 'list';

export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam / reklam',
  hate: 'Hatiskt innehåll / rasism',
  harassment: 'Trakasserier / personangrepp',
  illegal: 'Olagligt innehåll',
  pii: 'Delar privat information (PII)',
  other: 'Annat',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: 'Öppen',
  reviewed: 'Granskad',
  actioned: 'Åtgärdad',
  dismissed: 'Avfärdad',
};

export interface Report {
  id: string;
  reporterUid: string;
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerUid: string;
  reason: ReportReason;
  note?: string;
  status: ReportStatus;
  createdAt: Date;
  updatedAt?: Date;
}

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

/**
 * Admin-läsning. Kräver att användaren har isAdmin: true i users/{uid}-doc
 * (firestore.rules enforce:ar). Normal användare får permission-denied.
 */
export async function listReports(options: {
  status?: ReportStatus;
  maxRows?: number;
} = {}): Promise<Report[]> {
  const constraints: QueryConstraint[] = [];
  if (options.status) {
    constraints.push(where('status', '==', options.status));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  constraints.push(limit(options.maxRows ?? 100));

  const snap = await getDocs(query(collection(db, 'reports'), ...constraints));
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      reporterUid: data.reporterUid as string,
      targetType: data.targetType as ReportTargetType,
      targetId: data.targetId as string,
      targetOwnerUid: data.targetOwnerUid as string,
      reason: data.reason as ReportReason,
      note: data.note as string | undefined,
      status: data.status as ReportStatus,
      createdAt: toDate(data.createdAt),
      updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
    };
  });
}

export async function updateReportStatus(
  reportId: string,
  status: ReportStatus,
): Promise<void> {
  await updateDoc(doc(db, 'reports', reportId), {
    status,
    updatedAt: serverTimestamp(),
  });
}
