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

import {
  buildHandoverUpdate, buildOwnerPickedHandover, buildTraceErasure,
  HandoverRefusal, refusalForSentInvites, type ClaimResult, type MemberRow,
} from './logic';

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

/**
 * The `groups/{gid}` ownership swap. Bounded: one document. Carries WHO leaves,
 * not the resulting member list — the port derives that from its own
 * transactional read through `planClaim` (BIN-1266).
 */
export interface HandoverWrite {
  readonly ownerUid: string;
  readonly leavingUid: string;
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
   * Swap the owner, but ONLY if `ownerUid` is still `expectedOwnerUid` and the
   * successor is still a member. What to write, or why not, is `planClaim`'s
   * decision on the port's own read.
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
  ): Promise<ClaimResult>;

  /**
   * Erase the departing member's traces from a group that survives.
   *
   * Runs BEFORE the swap, in chunks the port sizes, and is idempotent — every
   * write is a delete or a field removal, so a retry converges. A failure here
   * leaves the caller still the owner, which is what keeps the group findable on
   * the retry: after the swap, neither door's query would return it again.
   */
  eraseMemberTraces(groupId: string, leavingUid: string, erasure: TraceErasure): Promise<void>;

  /**
   * Paths of every `users/{other}/groupInvites/{groupId}` the uid SENT.
   *
   * A collection-group query on `fromUid`, which only Admin credentials can run:
   * the read rule on that path is `isOwner(uid)`, so no client query can span
   * other people's trees. That is why this door is server-side at all.
   *
   * `fromUid` is pinned to the writer on create and immutable after, so the
   * predicate is sound for every document that has ever existed in the
   * collection — verified against the commit that created it, not assumed.
   */
  sentInvitePaths(uid: string): Promise<readonly string[]>;

  /**
   * Delete every given path in ONE atomic batch, or write nothing.
   *
   * The atomicity is the point, not an optimisation: see
   * `SENT_INVITE_BATCH_LIMIT`. The caller refuses above the ceiling rather than
   * chunking, so this method never has to decide anything.
   */
  deleteSentInvites(paths: readonly string[]): Promise<void>;
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
      await io.eraseMemberTraces(groupId, leavingUid, buildTraceErasure(watchlist, history, leavingUid));

      // A lost claim writes nothing. `owner-changed`: the group is someone else's
      // now. `successor-left`: the group is STILL the leaver's, with other members in
      // it, so it counts as failed — both doors must stop there rather than go on to
      // delete or orphan a group other people are still in.
      const claim = await io.claimOwnership(groupId, group.ownerUid, {
        ownerUid: outcome.ownerUid,
        leavingUid,
      });
      if (claim.kind === 'owner-changed') { summary.raced += 1; continue; }
      if (claim.kind === 'successor-left') {
        io.log.error('groupHandover: successor left before the claim, group still owned', { groupId });
        summary.failed += 1;
        continue;
      }
      summary.handedOver += 1;
    } catch (err) {
      io.log.error('groupHandover: group failed, others continue', { groupId, err });
      summary.failed += 1;
    }
  }

  io.log.info('groupHandover done', { leavingUid, ...summary });
  return summary;
}


/**
 * BIN-1118: the extra port the owner-picked handover needs, kept OFF `HandoverIo`.
 *
 * The sweep and the account-delete door build a `HandoverIo` each. Adding a
 * required method there would have forced both to grow a notification they never
 * send — the automatic handover happens because an account is going away, and
 * telling the remaining members would be announcing a deletion they were not told
 * about. This path is the one a human chose, so it is the one that announces.
 */
export interface HandoverNotifyIo {
  /** `groups/{gid}.name`, or null when the document has none. */
  readGroupName(groupId: string): Promise<string | null>;
  /** The successor's display name, or null when unreadable. */
  readMemberName(groupId: string, uid: string): Promise<string | null>;
  /**
   * Write one inbox card into each recipient's `users/{uid}/notifications`.
   *
   * Admin SDK only: the collection is `allow create: if false` for clients, so
   * no browser session can write into another member's tree. Derive it rather
   * than trusting this comment:
   *   grep -n -A 6 "match /users/{uid}/notifications" firestore.rules
   */
  notifyMembers(
    recipientUids: readonly string[],
    card: { title: string; body: string; actionUrl: string },
  ): Promise<void>;
}

/** Why an owner-picked handover did not happen. Surfaced to the caller verbatim. */
export const OWNER_PICK_REFUSALS: Record<'not-owner' | 'not-a-member' | 'self' | 'owner-changed' | 'successor-left', string> = {
  'not-owner': 'Du äger inte den här gruppen.',
  'not-a-member': 'Personen du valde är inte medlem i gruppen.',
  self: 'Du kan inte lämna över gruppen till dig själv.',
  'owner-changed': 'Gruppen bytte ägare medan du höll på. Ladda om sidan.',
  'successor-left': 'Personen du valde har lämnat gruppen. Välj någon annan.',
};

/**
 * Hand ONE group to a successor the owner named, then leave it.
 *
 * Mirrors `runGroupHandover`'s order exactly — erase the departing owner's traces
 * FIRST, swap second — and for the same reason: a throw after a committed swap
 * would strand those rows outside every retry, because both doors find a group by
 * `ownerUid` or `memberUids`, and the swap moves both at once.
 *
 * Unlike that function this one THROWS on refusal. It handles a single group that
 * a person is looking at, so a silent no-op would show them a success and leave
 * them the owner.
 *
 * Refusals throw `HandoverRefusal`; everything else throws whatever failed. The
 * callable reads that distinction to decide which messages may be shown to the
 * owner, so a new refusal added here must use the class too. Derive the throw
 * sites: `git grep -n "HandoverRefusal(" -- functions/src`
 *
 * The notification is sent AFTER the swap and is best-effort: it is the last step
 * and nothing depends on it, so a failure there must not turn a completed
 * handover into a reported failure. It is logged instead.
 */
export async function runOwnerPickedHandover(
  io: HandoverIo & HandoverNotifyIo,
  groupId: string,
  leavingUid: string,
  successorUid: string,
): Promise<void> {
  // The group is read AFTER the rows the erasure needs, so the membership check
  // below is the last read before the first write. A successor who leaves in the
  // window that remains is caught by `planClaim` and refused, but the erasure has
  // run by then — see `## BIN-1267` in .claude/rules/accepted-deviations.md.
  const watchlist = await io.readWatchlist(groupId);
  const history = await io.readSessionHistory(groupId);
  const group = await io.readGroup(groupId);
  if (!group) throw new HandoverRefusal('Gruppen finns inte längre.');

  const outcome = buildOwnerPickedHandover(group, leavingUid, successorUid);
  if (outcome.kind === 'refused') throw new HandoverRefusal(OWNER_PICK_REFUSALS[outcome.reason]);

  await io.eraseMemberTraces(groupId, leavingUid, buildTraceErasure(watchlist, history, leavingUid));

  // Reads the successor's name BEFORE the swap: the departing owner's own member
  // row is erased above, but the successor's is not, and reading it here keeps
  // the notification off the critical path afterwards.
  const successorName = await io.readMemberName(groupId, successorUid);
  const groupName = await io.readGroupName(groupId);

  const claim = await io.claimOwnership(groupId, group.ownerUid, {
    ownerUid: outcome.ownerUid,
    leavingUid,
  });
  // The same optimistic guard the automatic door uses, now with two ways to lose.
  switch (claim.kind) {
    case 'owner-changed': throw new HandoverRefusal(OWNER_PICK_REFUSALS['owner-changed']);
    case 'successor-left': throw new HandoverRefusal(OWNER_PICK_REFUSALS['successor-left']);
    case 'claimed': break;
  }

  // BIN-1271, Malins beslut 2026-09-23: the invitations the departing owner sent
  // for THIS group go with them. After the swap and best-effort, like the
  // notification below: a failure must not turn a completed handover into a
  // reported failure.
  try {
    await eraseSentInvites(io, leavingUid, groupId);
  } catch (err) {
    io.log.error('groupHandover: sent-invite erasure after owner-picked handover failed, handover stands', { groupId, err });
  }

  try {
    await io.notifyMembers(claim.memberUids, {
      title: 'Gruppen har ny ägare',
      body: `${successorName ?? 'En medlem'} tog över ${groupName ?? 'gruppen'}.`,
      actionUrl: `/grupper/${groupId}/`,
    });
  } catch (err) {
    io.log.error('groupHandover: owner-picked notification failed, handover stands', { groupId, err });
  }
}


/**
 * Erase the invitations this uid SENT into other people's trees.
 *
 * Runs BEFORE `runGroupHandover` in the callable. The order is load-bearing, not
 * incidental: a refusal here is a run that has written nothing at all, so the
 * caller's "nothing has been deleted" message stays true. Run after the
 * handover, the same refusal would arrive on top of writes that already landed.
 *
 * Independent of group ownership — an invite you sent is yours to erase whether
 * or not you still own the group it points at, and the handover may have moved
 * that ownership already.
 *
 * The sweep reaches the same documents by a DIFFERENT mechanism — the
 * `groupInvitesSent` category, whose deletes are chunked under the sweep's own
 * ceiling. The all-or-nothing property below is this function's, not that one's.
 * Derive the callers rather than trusting a sentence:
 * git grep -n "eraseSentInvites(" -- functions/src
 *
 * Returns how many were found and erased. Throws the refusal string when the
 * count exceeds what one atomic batch can carry.
 */
export async function eraseSentInvites(
  io: Pick<HandoverIo, 'sentInvitePaths' | 'deleteSentInvites' | 'log'>,
  uid: string,
  /** BIN-1271: only the invitations for this group. The document id IS the group id. */
  groupId?: string,
): Promise<{ found: number }> {
  const all = await io.sentInvitePaths(uid);
  const paths = groupId === undefined ? all : all.filter((p) => p.endsWith(`/groupInvites/${groupId}`));
  const refusal = refusalForSentInvites(paths.length);
  if (refusal) {
    io.log.error('groupHandover: sent-invite erasure refused', { uid, found: paths.length });
    throw new Error(refusal);
  }
  if (paths.length > 0) await io.deleteSentInvites(paths);
  io.log.info('groupHandover: sent invites erased', { uid, found: paths.length });
  return { found: paths.length };
}
