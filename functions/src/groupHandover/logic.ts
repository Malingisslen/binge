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
 * `eligibleUids` is the group document's `memberUids`, never the uids of the
 * member rows. The two lists diverge, and in the direction that escalates:
 * `firestore.rules` decides membership from `memberUids`, while
 * `groups/{gid}/members/*` is written by a different branch, so a row can outlive
 * the membership it stands for. Electing from the rows alone would make such a
 * row's owner `ownerUid` — able to evict everyone and delete the group — and
 * would re-open BIN-327/H1 one collection deeper, since the owner branch cannot
 * add a uid to `memberUids` but nothing stops it planting a member row.
 *
 * The departing uid is excluded first and unconditionally. `createGroup` writes
 * the owner's own member row before anyone else can join, so their `joinedAt` is
 * the earliest in essentially every group — forgetting the exclusion elects the
 * departing owner and reports success, on the ordinary shape of a group.
 *
 * Ordering: a usable `joinedAt` outranks none; among those, earliest wins; ties
 * break on the lowest uid, so the successor never depends on the order the rows
 * were read in. When NO remaining member has one, the lowest uid still wins —
 * deleting other people's shared data over a missing field is the worse of the
 * two failures.
 */
export function pickGroupSuccessor(
  members: readonly MemberRow[],
  leavingUid: string,
  eligibleUids: readonly string[],
): string | null {
  const eligible = new Set(eligibleUids);
  const candidates = members.filter((m) => m.uid !== leavingUid && eligible.has(m.uid));
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
