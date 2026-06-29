/**
 * Pure validation + cooldown logic for the report-submit callable (BIN-49) — no
 * firebase-admin imports so it unit-tests under the root vitest toolchain (same
 * split as reclaimOrphanFollows/logic.ts).
 *
 * Why this exists: the BIN-25 rules-based throttle gated per *batch*, so a
 * single writeBatch of N report-creates + 1 throttle write let all N through
 * (~499 reports/10s). Firestore rules can't count batch siblings. The fix routes
 * report creation through this server-authoritative callable and locks the
 * `reports` create rule — so the only gate is here, one report per call, with a
 * transactional per-uid cooldown the client can't bypass.
 */

export const REPORT_REASONS = ['spam', 'hate', 'harassment', 'illegal', 'pii', 'other'] as const;
export const REPORT_TARGET_TYPES = ['review', 'comment', 'user', 'list'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_COOLDOWN_MS = 10_000;
export const REPORT_NOTE_MAX = 500;
/** Upper bound for id-shaped fields — a Firestore doc id or Firebase uid is well
 *  under this; the cap just stops a token holder bloating the doc (cost). */
export const REPORT_ID_MAX = 256;

export interface ValidReport {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  note?: string;
}

// BIN-292: where to read the REAL owner of a reported target. The client's
// `targetOwnerUid` is no longer trusted (it was forgeable → a framing vector);
// the callable derives the owner from the actual target doc instead. Pure so the
// path/parse logic is unit-testable.
export type TargetRef =
  | { kind: 'user'; uid: string }   // a user report — targetId IS the owner uid
  | { kind: 'doc'; path: string[] } // read .uid from the doc at this path
  | { kind: 'invalid' };            // malformed (e.g. bad comment path) → unresolved

export function resolveTargetRef(targetType: ReportTargetType, targetId: string): TargetRef {
  switch (targetType) {
    case 'user':
      return { kind: 'user', uid: targetId };
    case 'review':
      return { kind: 'doc', path: ['reviews', targetId] };
    case 'list':
      return { kind: 'doc', path: ['lists', targetId] };
    case 'comment': {
      // targetId packs the full path: reviews/{reviewId}/comments/{commentId}
      const m = /^reviews\/([^/]+)\/comments\/([^/]+)$/.exec(targetId);
      return m ? { kind: 'doc', path: ['reviews', m[1], 'comments', m[2]] } : { kind: 'invalid' };
    }
    default:
      return { kind: 'invalid' };
  }
}

export type ValidationResult =
  | { ok: true; value: ValidReport }
  | { ok: false; error: string };

/**
 * Validate + normalize the client payload. Because the `reports` create rule is
 * locked (BIN-49), this is the ONLY validation gate — mirror what the rule used
 * to assert. reporterUid is NOT taken from the payload; the caller derives it
 * from the authenticated context.
 */
export function validateReportInput(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Ogiltig rapport.' };
  const d = raw as Record<string, unknown>;

  if (typeof d.reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(d.reason))
    return { ok: false, error: 'Ogiltig anledning.' };
  if (typeof d.targetType !== 'string' || !(REPORT_TARGET_TYPES as readonly string[]).includes(d.targetType))
    return { ok: false, error: 'Ogiltig måltyp.' };
  if (typeof d.targetId !== 'string' || d.targetId.length === 0 || d.targetId.length > REPORT_ID_MAX)
    return { ok: false, error: 'Ogiltigt mål-id.' };
  // BIN-292: targetOwnerUid is intentionally NOT validated/accepted here — the
  // callable derives the real owner from the target doc (it was a forgeable
  // framing input). Any client-sent targetOwnerUid is simply ignored/stripped.

  let note: string | undefined;
  if (d.note !== undefined && d.note !== null) {
    if (typeof d.note !== 'string') return { ok: false, error: 'Ogiltig kommentar.' };
    const trimmed = d.note.trim().slice(0, REPORT_NOTE_MAX);
    if (trimmed.length > 0) note = trimmed;
  }

  return {
    ok: true,
    value: {
      targetType: d.targetType as ReportTargetType,
      targetId: d.targetId,
      reason: d.reason as ReportReason,
      ...(note ? { note } : {}),
    },
  };
}

/**
 * True if a new report is still inside the cooldown window: the user's previous
 * report (at lastMs) is newer than nowMs − cooldown. A null lastMs (no prior
 * report) is never within cooldown.
 */
export function isWithinCooldown(lastMs: number | null, nowMs: number, cooldownMs = REPORT_COOLDOWN_MS): boolean {
  return lastMs !== null && nowMs - lastMs < cooldownMs;
}
