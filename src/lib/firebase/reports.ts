import type { QueryConstraint } from 'firebase/firestore';
import { fsdb } from './db';
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

// Matchar cooldownen i firestore.rules (BIN-25). Klient-checken är bara snabb,
// vänlig UX (slipper round-trip + permission-denied) — den hårda gränsen
// enforce:as server-side via users/{uid}/reportMeta/throttle.
const REPORT_COOLDOWN_MS = 10_000;
const REPORT_COOLDOWN_KEY = 'binge:lastReportAt';

// Cooldownen lagras i sessionStorage (inte en modulvariabel) så att en
// page-reload inte nollställer den — annars kan en användare report-flooda
// genom att ladda om sidan mellan varje rapport (M5). Detta är hygien, inte
// en hård gräns; en server-side bucket är nästa steg om missbruk uppstår.
function getLastReportAt(): number {
  if (typeof window === 'undefined') return 0;
  return Number(window.sessionStorage.getItem(REPORT_COOLDOWN_KEY)) || 0;
}

function setLastReportAt(ts: number): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(REPORT_COOLDOWN_KEY, String(ts));
}

export async function createReport(params: {
  reporterUid: string;
  targetType: ReportTargetType;
  targetId: string;
  targetOwnerUid: string;
  reason: ReportReason;
  note?: string;
}): Promise<void> {
  const now = Date.now();
  if (now - getLastReportAt() < REPORT_COOLDOWN_MS) {
    throw new Error('Vänta lite innan du rapporterar igen.');
  }
  setLastReportAt(now);

  const trimmedNote = params.note?.trim().slice(0, 500);

  // Atomisk batch: rapporten + throttle-stämpeln skrivs tillsammans. Reglerna
  // kräver att throttle-doc:en sätts till request.time i samma batch och att
  // förra rapporten är äldre än cooldownen — annars nekas hela batchen (BIN-25).
  const { db, doc, collection, writeBatch, serverTimestamp } = await fsdb();
  const batch = writeBatch(db);
  // doc(collectionRef) utan id genererar ett klient-id (batch-motsvarigheten
  // till addDoc) så rapport-skrivningen blir atomisk med throttle-stämpeln.
  batch.set(doc(collection(db, 'reports')), {
    reporterUid: params.reporterUid,
    targetType: params.targetType,
    targetId: params.targetId,
    targetOwnerUid: params.targetOwnerUid,
    reason: params.reason,
    ...(trimmedNote ? { note: trimmedNote } : {}),
    status: 'open',
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', params.reporterUid, 'reportMeta', 'throttle'), {
    lastReportAt: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Admin-läsning. Kräver att användaren har isAdmin: true i users/{uid}-doc
 * (firestore.rules enforce:ar). Normal användare får permission-denied.
 */
export async function listReports(options: {
  status?: ReportStatus;
  maxRows?: number;
} = {}): Promise<Report[]> {
  const { db, collection, getDocs, limit, orderBy, query, where } = await fsdb();
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
  const { db, doc, updateDoc, serverTimestamp } = await fsdb();
  await updateDoc(doc(db, 'reports', reportId), {
    status,
    updatedAt: serverTimestamp(),
  });
}
