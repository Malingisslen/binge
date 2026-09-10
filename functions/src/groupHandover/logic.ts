/**
 * BIN-1063 steg 3 — who inherits a group whose owner is gone.
 *
 * Malin's decision of 2026-09-06: an owned group with remaining members is
 * HANDED OVER to the longest-standing member, never deleted, on both doors — the
 * retention sweep and the account delete button.
 *
 * Pure predicates only, no firebase-admin import, so the part that DECIDES who
 * inherits is testable under the root vitest toolchain.
 */

// TYPE-ONLY, so it is erased at compile time and creates no runtime cycle with the module
// that imports this one. It is a single declaration on purpose: a second, structurally
// identical shape declared here would be assignable from the real one, so a FIFTH erasure
// category could be collected in runHandover and never written by memberTraceWrites — and
// that silence falls in the direction that leaves a departed member's data behind.
import type { TraceErasure } from './runHandover';

/** One `groups/{gid}/members/{uid}` document, narrowed to what succession reads. */
export interface MemberRow {
  readonly uid: string;
  /**
   * `joinedAt` as epoch milliseconds, or null when the document carries no usable
   * value. Nothing enforces the field at READ time, so the null branch is real
   * whatever the write paths do. Derive those rather than trusting a sentence:
   *   grep -n "joinedAt" src/lib/firebase/groups.ts firestore.rules
   */
  readonly joinedAtMs: number | null;
}

/**
 * What must happen to one group whose owner is leaving.
 *
 * Three outcomes, three values. One null for both `delete` and `noop` cannot be
 * told apart by any test, because the type cannot: a caller reading it as "delete
 * the group" destroys a live group on a retried sweep that already succeeded.
 */
export type HandoverOutcome =
  | { readonly kind: 'handover'; readonly ownerUid: string; readonly memberUids: readonly string[] }
  /** Nobody eligible remains. A successor cannot be invented, so the group goes. */
  | { readonly kind: 'delete' }
  /**
   * The departing uid does not own this group — either an earlier run already
   * handed it over, or they were only a member. No OWNERSHIP write is owed.
   *
   * It says nothing about the departing member's own traces. Those are the
   * caller's to erase, and the set is the one #5 Legal/GDPR Counsel's binding
   * condition names on BIN-1063 steg 3 — derive it from there, not from any
   * single existing path.
   */
  | { readonly kind: 'noop' };

/**
 * The member who inherits the group, or null when nobody can.
 *
 * The BALLOT is `eligibleUids` — the group document's `memberUids` — and the
 * member rows only supply each candidate's `joinedAt`. That asymmetry is the
 * whole safety property, and it runs in both directions.
 *
 * A row whose uid is NOT in `memberUids` is not a candidate. The two lists
 * diverge: `firestore.rules` decides membership from `memberUids`, while
 * `groups/{gid}/members/*` is written by a different branch, so a row can outlive
 * the membership it stands for. Electing from the rows would make such a row's
 * owner `ownerUid` — able to evict everyone and delete the group — and would
 * re-open BIN-327/H1 one collection deeper, since the owner branch cannot add a
 * uid to `memberUids` but nothing stops it planting a member row.
 *
 * A uid in `memberUids` with NO row is still a candidate. The join is three
 * separate writes and can die between them, leaving a member the rules count in
 * full — every membership clause reads the array and none consults the row. They
 * rank as unstamped rather than being skipped, because the alternative is
 * `delete`, and deleting a group out from under people the rules call members is
 * the worse of the two failures.
 *
 * The departing uid is excluded first and unconditionally. `createGroup` writes
 * the owner's own member row before anyone else can join, so their `joinedAt` is
 * the earliest in essentially every group — forgetting the exclusion elects the
 * departing owner and reports success, on the ordinary shape of a group.
 *
 * Ordering: a usable `joinedAt` outranks none; among those, earliest wins; ties
 * break on the lowest uid, so the successor never depends on the order the rows
 * were read in. When NO remaining member has one, the lowest uid still wins.
 */
export function pickGroupSuccessor(
  members: readonly MemberRow[],
  leavingUid: string,
  eligibleUids: readonly string[],
): string | null {
  const joinedAt = new Map(members.map((m) => [m.uid, m.joinedAtMs]));
  const candidates = eligibleUids
    .filter((uid) => uid !== leavingUid)
    .map((uid) => ({ uid, joinedAtMs: joinedAt.get(uid) ?? null }));
  if (candidates.length === 0) return null;

  // `Number.isFinite`, not `!== null`: NaN passes a null check, and both `a < b`
  // and `a > b` are false for it, so a corrupt value would win or lose depending
  // on the order the rows arrived in.
  const stamped = candidates.filter((m) => Number.isFinite(m.joinedAtMs));
  const pool = stamped.length > 0 ? stamped : candidates;

  return pool.reduce((best, m) => {
    const a = m.joinedAtMs;
    const b = best.joinedAtMs;
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
      return (a as number) < (b as number) ? m : best;
    }
    return m.uid < best.uid ? m : best;
  }).uid;
}

/**
 * Is this group empty of everyone but `leavingUid`?
 *
 * The retention sweep asks this twice — once when it PLANS which groups it may
 * delete, and once immediately before deleting each one. Two spellings of the
 * same question is how one of them drifts, and the two answers decide whether a
 * live third party's group is deleted or an empty one is kept forever.
 */
export function isEmptyExcept(memberUids: readonly string[], leavingUid: string): boolean {
  return memberUids.every((uid) => uid === leavingUid);
}

/**
 * What to do with this group, decided once for both doors.
 *
 * `noop` comes first and is the idempotency guard: a retried run must hold no
 * second election, which could name a different member than the first one did.
 * `memberUids` shrinks by exactly the departing uid and never grows.
 */
export function buildHandoverUpdate(
  currentOwnerUid: string,
  leavingUid: string,
  members: readonly MemberRow[],
  memberUids: readonly string[],
): HandoverOutcome {
  if (currentOwnerUid !== leavingUid) return { kind: 'noop' };
  // `survivors`, not `memberUids`. The picker excludes the leaver too, so this is
  // deliberate redundancy: removing either one alone leaves the departing uid
  // ineligible. Do not simplify it away.
  const survivors = memberUids.filter((uid) => uid !== leavingUid);
  const successorUid = pickGroupSuccessor(members, leavingUid, survivors);
  if (successorUid === null) return { kind: 'delete' };
  return { kind: 'handover', ownerUid: successorUid, memberUids: survivors };
}

/**
 * Whether a `groups/{gid}/watchlist/{id}` row must lose its `addedBy`.
 *
 * Malin's decision of 2026-09-06: the title stays — it is the shared list the
 * handover exists to preserve — but the note saying who added it goes.
 */
export function clearsAddedBy(addedBy: unknown, leavingUid: string): boolean {
  return addedBy === leavingUid;
}

/**
 * One write the trace erasure has to make, described rather than performed.
 *
 * `collection` and `doc` are relative to the group; `field` names the single field a
 * `clear`/`drop` touches. Describing the writes instead of issuing them is what lets the
 * ORDER, the COMPLETENESS and the batching all be checked by calling a function, in a test
 * that never needs firebase-admin.
 */
export interface TraceWrite {
  readonly op: 'delete' | 'clear' | 'drop';
  readonly collection: string;
  readonly doc: string;
  readonly field?: string;
}

/**
 * Every write erasing one member's traces from one group, in the order they must be made.
 *
 * BIN-1109. This used to be an inline loop inside the Admin-SDK port, where no test could
 * reach it: every test port implemented the method as a single unbroken batch, so the
 * batching's own correctness — that nothing is skipped between chunks, that the counter
 * resets — was never exercised at all.
 */
export function memberTraceWrites(leavingUid: string, erasure: TraceErasure): TraceWrite[] {
  const writes: TraceWrite[] = [
    { op: 'delete', collection: 'members', doc: leavingUid },
    { op: 'delete', collection: 'household', doc: leavingUid },
    // BIN-329: a joinAttempts row holds a plaintext invite token.
    { op: 'delete', collection: 'joinAttempts', doc: leavingUid },
  ];
  for (const itemId of erasure.itemIds) {
    writes.push({ op: 'delete', collection: `watchlist/${itemId}/progress`, doc: leavingUid });
  }
  for (const itemId of erasure.clearAddedByIds) {
    writes.push({ op: 'clear', collection: 'watchlist', doc: itemId, field: 'addedBy' });
  }
  for (const rowId of erasure.clearPickedByIds) {
    writes.push({ op: 'clear', collection: 'sessionHistory', doc: rowId, field: 'pickedByUid' });
  }
  for (const rowId of erasure.dropParticipantIds) {
    writes.push({ op: 'drop', collection: 'sessionHistory', doc: rowId, field: 'participantUids' });
  }
  return writes;
}

/**
 * The writes split into commits no larger than `limit`.
 *
 * Firestore commits at most 500 writes at once and the input grows with the group's
 * watchlist, which nothing bounds. Splitting is therefore not optional — and getting it
 * wrong loses writes silently, which is why it is a function with a return value rather
 * than a counter mutated inside a loop.
 */
export function chunkWrites(writes: readonly TraceWrite[], limit: number): TraceWrite[][] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`chunkWrites: limit must be a whole number of at least 1, got ${limit}`);
  }
  const chunks: TraceWrite[][] = [];
  // The advance is floored SEPARATELY from the refusal above, and that redundancy is
  // deliberate. With the loop advancing by a bare `limit`, deleting the refusal turns a
  // zero into an infinite loop — so the mutation that removes the guard makes the suite
  // HANG rather than go red, which reads as stuck CI rather than as a broken guard and is
  // the symptom BIN-802 already cost this repo. Flooring here means the refusal is the only
  // thing that rejects a bad limit, its deletion is a plain red, and no input can hang.
  for (let i = 0; i < writes.length; i += Math.max(1, limit)) {
    chunks.push(writes.slice(i, i + limit));
  }
  return chunks;
}

/** The marker the refusal carries when a write was already attempted. */
export const HANDOVER_PARTIAL = 'binge/handover-partial';

/**
 * Why the caller must NOT proceed with its own erasure, or null when it may.
 *
 * Lives here, next to the rest of the decision, so a test can CALL it. The
 * callable's own `if` is the only thing standing between a group that failed to
 * hand over and the account cascade's owner branch, which deletes the WHOLE
 * group — other members' household data included — irreversibly. A source scan
 * over the entry point can see that a branch is written, not that it fires.
 *
 * The message says whether anything was WRITTEN, and the marker in it is what the
 * client maps onto its partial-deletion wording. A failure after a group was
 * already handed over is not "nothing has been deleted": ownership moved, the uid
 * left `memberUids`, rows were erased, and getting back in needs a fresh invite.
 *
 * The summary type is deliberately not imported: this file has no dependency on
 * the loop, and the two numbers it reads are the ones it is about.
 */
export function refusalForHandover(
  summary: { readonly failed: number; readonly attempted: number },
): string | null {
  if (summary.failed === 0) return null;
  if (summary.attempted > 0) {
    return `${HANDOVER_PARTIAL}: Kunde inte lämna över alla grupper, och en del ändringar hann göras. Försök igen.`;
  }
  return 'Kunde inte lämna över alla grupper. Försök igen.';
}

/**
 * The most sent invitations one departing account may erase in a single run.
 *
 * The erasure is ONE atomic batch by design (#13's binding condition on
 * BIN-1147): a chunked delete can half-complete, and the client would still
 * classify a mid-loop death as "nothing has been deleted" — the BIN-876/813
 * class, twice fixed already. Firestore caps a batch at 500 writes, so the
 * ceiling sits under it rather than at it.
 *
 * Exceeding it erases NOTHING and refuses loudly. That is the deliberate
 * direction: a refusal is retryable and leaves a true message, a partial
 * erasure is neither.
 */
export const SENT_INVITE_BATCH_LIMIT = 450;

/**
 * Why the sent-invite erasure must refuse, or null when it may proceed.
 *
 * Lives here so a test can CALL it rather than scan for it.
 *
 * The message carries no partial marker on purpose: this runs BEFORE the
 * handover writes anything, so a refusal here means the run wrote nothing at
 * all, and the caller's "nothing has been deleted" wording stays true.
 *
 * It reaches LOGS, not the user. `classifyDeletionFailure` maps an untagged
 * failure to `untouched`, which renders one of the four locked BIN-813 wordings
 * — so this text must not be written as if the user will read it.
 */
export function refusalForSentInvites(found: number): string | null {
  if (found <= SENT_INVITE_BATCH_LIMIT) return null;
  return `Fler an ${SENT_INVITE_BATCH_LIMIT} skickade gruppinbjudningar. Ingenting raderades.`;
}
