/**
 * BIN-1063 steg 3 — the group-handover loop, behind an injected port.
 *
 * The decision lives in `logic.ts`; this is the orchestration around it. Split
 * out for the same reason `retentionCleanup/runCleanup.ts` is: the root vitest
 * toolchain cannot resolve `firebase-admin`, so the only way to exercise the loop
 * against a real Firestore emulator is to drive it through a port the test can
 * implement with the client SDK.
 *
 * Both doors run THIS function, through the one Admin-SDK port in
 * `adminIo.ts`. Neither re-derives who inherits.
 */

import { buildHandoverUpdate, clearsAddedBy, type MemberRow } from './logic';

/** One `groups/{gid}/watchlist/{id}` row, narrowed to what the handover reads. */
export interface WatchlistRow {
  readonly id: string;
  readonly addedBy: unknown;
}

/** One `groups/{gid}/sessionHistory/{id}` row, narrowed the same way. */
export interface SessionHistoryRow {
  readonly id: string;
  readonly pickedByUid: unknown;
  readonly participantUids: readonly string[];
}

/** What one group looks like to the decision. */
export interface GroupRow {
  readonly ownerUid: string;
  readonly memberUids: readonly string[];
}

/** The `groups/{gid}` ownership swap. Bounded: one document. */
export interface HandoverWrite {
  readonly ownerUid: string;
  readonly memberUids: readonly string[];
}

/**
 * The departing member's own traces inside a group that survives.
 *
 * #5 Legal/GDPR Counsel's binding condition on BIN-1063 steg 3: handing the group
 * over must not become an exemption from the erasure a plain member-leave already
 * performs. `members/{uid}` carries a denormalized copy of the name and photo that
 * steg 1 erased from the profile; `household/{uid}` and the per-title
 * `progress/{uid}` rows are the member's own contributions; `joinAttempts/{uid}`
 * holds a plaintext invite token (BIN-329).
 *
 * The uid-bearing FIELDS are cleared rather than deleting the row they sit on:
 * `watchlist.addedBy`, and `sessionHistory`'s `pickedByUid` and `participantUids`.
 * Malin's decision of 2026-09-06 was about `addedBy` — the title stays, the note
 * saying who added it goes — and the others are the same shape one collection
 * over. Derive the set rather than trusting this list:
 *   grep -n "Uid" src/types/social.ts src/lib/firebase/groups.ts
 */
export interface TraceErasure {
  /** Every watchlist row id, for the `progress/{uid}` under each. */
  readonly itemIds: readonly string[];
  /** The subset whose `addedBy` names the departing member. */
  readonly clearAddedByIds: readonly string[];
  /** Session-history row ids whose `pickedByUid` names the departing member. */
  readonly clearPickedByIds: readonly string[];
  /** Session-history row ids whose `participantUids` contains the departing member. */
  readonly dropParticipantIds: readonly string[];
}

/**
 * The injected port. Deliberately primitive: every method maps to ONE Firestore
 * operation the real handover performs, so a port implementation has nowhere to
 * hide a decision.
 */
export interface HandoverIo {
  /** Ids of the groups where `ownerUid == uid`. */
  ownedGroupIds(uid: string): Promise<readonly string[]>;
  /** The group document, or null if it is gone. */
  readGroup(groupId: string): Promise<GroupRow | null>;
  /** Every `groups/{gid}/members/{uid}` row. `joinedAtMs` is null when unusable. */
  readMembers(groupId: string): Promise<readonly MemberRow[]>;
  /** Every `groups/{gid}/watchlist/{id}` row. */
  readWatchlist(groupId: string): Promise<readonly WatchlistRow[]>;
  /** Every `groups/{gid}/sessionHistory/{id}` row. */
  readSessionHistory(groupId: string): Promise<readonly SessionHistoryRow[]>;
  /**
   * Swap the owner, but ONLY if `ownerUid` is still `expectedOwnerUid`; return
   * false when it had already moved.
   *
   * The check and the write MUST be one atomic unit. That is what makes a retry a
   * no-op rather than a second election — two runs must never be able to name two
   * different successors — and it is why the condition lives in the port rather
   * than in the caller, which cannot hold a transaction open.
   *
   * It writes `ownerUid` and `memberUids` on the group document and nothing else.
   * The erasure is deliberately NOT in here: a group's watchlist is unbounded, and
   * a transaction that grew with it would eventually exceed its write limit and
   * fail the one write that must not.
   */
  claimOwnership(
    groupId: string,
    expectedOwnerUid: string,
    write: HandoverWrite,
  ): Promise<boolean>;

  /**
   * Erase the departing member's traces from a group that survives.
   *
   * Runs BEFORE the swap, in chunks the port sizes, and is idempotent — every
   * write is a delete or a field removal, so a retry converges. A failure here
   * leaves the caller still the owner, which is what keeps the group findable on
   * the retry: after the swap, neither door's query would return it again.
   */
  eraseMemberTraces(groupId: string, leavingUid: string, erasure: TraceErasure): Promise<void>;
  log: { info(message: string, data?: unknown): void; error(message: string, data?: unknown): void };
}

/**
 * What one run did.
 *
 * `handedOver`, `toDelete` and `noop` are the three outcomes; `raced` counts the
 * groups whose `ownerUid` moved between the read and the write, which is a noop
 * arrived at the hard way. They are separate counters because a zero must mean
 * one thing: a run that swept nothing and a run that raced on everything are
 * different events, and the summary line is the only place a person sees either.
 */
export interface HandoverSummary {
  ownedGroups: number;
  handedOver: number;
  toDelete: number;
  /**
   * WHICH groups resolved to `delete`, not just how many.
   *
   * The retention sweep plans its deletions before this runs, so a group that
   * loses its last other member in between is not in that plan and would be
   * left standing forever: its owner's Auth account and `users/{uid}` tree are
   * erased in the same run, after which the uid never appears in
   * `listUserUids()` again. The ids let the caller notice.
   */
  toDeleteIds: string[];
  noop: number;
  raced: number;
  failed: number;
  /**
   * Groups where a write was ATTEMPTED — incremented before the first one, not
   * after the last.
   *
   * It is what lets the caller tell "nothing happened" from "something did and
   * then it failed". Every write here is irreversible for the person: ownership
   * moved, the uid dropped from `memberUids`, rows deleted. A caller that
   * reported all of it as "nothing has been deleted" would be lying, and the
   * count has to be conservative — attempted, never committed — because a
   * chunked erasure can land writes and then throw.
   */
  attempted: number;
}

/**
 * Hand over every group `leavingUid` owns.
 *
 * Never throws for a per-group failure: it counts it and moves on, so one bad
 * group cannot strand the others. The caller decides what a non-zero `failed`
 * means — for the account-delete door it must abort the cascade, because falling
 * through would delete a group other people are still in.
 */
export async function runGroupHandover(
  io: HandoverIo,
  leavingUid: string,
): Promise<HandoverSummary> {
  const groupIds = await io.ownedGroupIds(leavingUid);
  const summary: HandoverSummary = {
    ownedGroups: groupIds.length,
    handedOver: 0,
    toDelete: 0,
    toDeleteIds: [],
    noop: 0,
    raced: 0,
    failed: 0,
    attempted: 0,
  };

  for (const groupId of groupIds) {
    try {
      const group = await io.readGroup(groupId);
      if (!group) continue;

      const members = await io.readMembers(groupId);
      const outcome = buildHandoverUpdate(group.ownerUid, leavingUid, members, group.memberUids);
      if (outcome.kind === 'noop') { summary.noop += 1; continue; }
      if (outcome.kind === 'delete') {
        summary.toDelete += 1;
        summary.toDeleteIds.push(groupId);
        continue;
      }

      // The erasure runs BEFORE the swap, and the order is load-bearing in the
      // failing direction. Both doors find a group by `ownerUid` or by
      // `memberUids array-contains`, and the swap changes both at once — so a
      // throw from the erasure AFTER a committed swap would strand the departing
      // member's rows permanently, unreachable by any retry and outside the
      // retention sweep. Erasing first inverts that: a failure leaves the caller
      // still the owner, so the retry finds the group and re-runs. Every erase
      // write is a delete or a field removal, so re-running converges.
      const watchlist = await io.readWatchlist(groupId);
      const history = await io.readSessionHistory(groupId);
      // Before the first write, not after the last: a chunked erasure can commit
      // some rows and then throw, and the caller must not report that as untouched.
      summary.attempted += 1;
      await io.eraseMemberTraces(groupId, leavingUid, {
        itemIds: watchlist.map((row) => row.id),
        clearAddedByIds: watchlist
          .filter((row) => clearsAddedBy(row.addedBy, leavingUid))
          .map((row) => row.id),
        clearPickedByIds: history
          .filter((row) => clearsAddedBy(row.pickedByUid, leavingUid))
          .map((row) => row.id),
        dropParticipantIds: history
          .filter((row) => row.participantUids.includes(leavingUid))
          .map((row) => row.id),
      });

      const claimed = await io.claimOwnership(groupId, group.ownerUid, {
        ownerUid: outcome.ownerUid,
        memberUids: outcome.memberUids,
      });
      if (!claimed) { summary.raced += 1; continue; }
      summary.handedOver += 1;
    } catch (err) {
      io.log.error('groupHandover: group failed, others continue', { groupId, err });
      summary.failed += 1;
    }
  }

  io.log.info('groupHandover done', { leavingUid, ...summary });
  return summary;
}
