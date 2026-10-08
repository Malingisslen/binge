/**
 * BIN-1259 — pure decision for "tell the reporter their report was decided".
 *
 * No firebase-admin imports, so it unit-tests under the root vitest toolchain,
 * same split as `submitReport/logic.ts`.
 *
 * Why a trigger and not a write from the admin page: `users/{uid}/notifications`
 * is `allow create: if false`, so only the Admin SDK can put a card in someone's
 * inbox. Widening that rule for admins would turn every admin session into "can
 * write anything into anyone's inbox", which is far more than this needs. Derive
 * the rule rather than trusting this comment:
 *   grep -n -A 6 "match /users/{uid}/notifications" firestore.rules
 */

/** The statuses that END a report. Anything else is still in progress. */
export const DECIDED_STATUSES = ['actioned', 'dismissed'] as const;
export type DecidedStatus = (typeof DECIDED_STATUSES)[number];

/**
 * The one thing the reporter is told.
 *
 * Malin's decision 2026-09-20: a single wording for BOTH outcomes. It names
 * neither the target nor what was done. #12 Trust & Safety's reasoning, which
 * decided it against #18's two outcome-specific drafts: a reporter who can read
 * the outcome can file repeatedly to learn whether an admin sides with them,
 * which turns the inbox into a harassment instrument.
 *
 * It is a constant rather than a per-status lookup because there is one wording.
 * Should a second ever be wanted, that is a product decision and a new ticket —
 * do not grow it from a field on the report.
 */
export const REPORT_DECIDED_CARD = {
  title: 'Din anmälan',
  body: 'Vi har granskat din anmälan.',
} as const;

/**
 * Should this update send the reporter a card?
 *
 * Only on a TRANSITION into a decided status. Two things follow from that, and
 * both are the point:
 *
 * - An admin who later edits something else on a report that was already decided
 *   does not re-notify. `updateReportStatus` writes `updatedAt` on every save, so
 *   without the before/after comparison every such save would send a second card.
 * - A report that is re-opened and decided again reaches this predicate again,
 *   because the status left the decided set in between. Whether a second card is
 *   WRITTEN is not this function's answer — see the document id in `index.ts`.
 *
 * Firestore triggers are at-least-once, so the same transition can arrive twice.
 * That duplicate is the caller's to absorb, not this function's: it answers "is
 * this a decision", never "have we already sent it".
 */
export function decidesReport(
  before: { status?: unknown } | undefined,
  after: { status?: unknown } | undefined,
): boolean {
  if (!after) return false;
  return isDecided(after.status) && !isDecided(before?.status);
}

function isDecided(status: unknown): status is DecidedStatus {
  return typeof status === 'string' && (DECIDED_STATUSES as readonly string[]).includes(status);
}

/**
 * Who to tell, or null when there is nobody.
 *
 * `reporterUid` is pinned immutable by the report update rule, so it cannot have
 * been swapped between the create and this read. It can still be missing on a
 * document old enough to predate the field, which is why this returns null
 * rather than asserting.
 */
export function reporterToNotify(after: { reporterUid?: unknown } | undefined): string | null {
  const uid = after?.reporterUid;
  return typeof uid === 'string' && uid.length > 0 ? uid : null;
}
