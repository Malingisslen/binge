// Pure decision for what a joinSession() write must carry, extracted so it can
// be unit-tested without Firebase (the rest of sessions.ts imports firebase).
//
// Three cases, all driven by the participant slot's CURRENT stored state:
//  • first join (no slot yet)  → arm the veto budget (1) and isHost:false.
//  • rejoin of a valid slot     → touch NOTHING veto/host-related. BIN-540's
//    ratchet only allows counting DOWN, so re-writing vetoRemaining:1 onto a
//    spent slot (0) is permission-denied — that was the cross-device lockout.
//  • rejoin of a JUNK slot       → heal the mistyped field to a rules-valid
//    value (0 / false, both pass the ratchet). Without this the victim of a
//    planted `vetoRemaining:'many'` can never re-enter, since the merged write
//    still has to pass `is int` / `is bool`.

export interface StoredParticipantState {
  vetoRemaining?: unknown;
  isHost?: unknown;
}

export interface JoinFieldPlan {
  /** First join → true; caller adds vetoRemaining/isHost/joinedAt. */
  firstJoin: boolean;
  /** Extra fields to merge on a REJOIN (empty unless a junk field needs healing). */
  heal: { vetoRemaining?: 0; isHost?: false };
}

export function planJoinFields(existing: StoredParticipantState | null): JoinFieldPlan {
  if (existing === null) return { firstJoin: true, heal: {} };
  const heal: { vetoRemaining?: 0; isHost?: false } = {};
  // Heal a junk TYPE *and* a valid-but-out-of-range integer (a pre-BIN-540
  // planted `vetoRemaining: 2` / `-1` is a whole number, so an is-int-only test
  // would leave it, and the rule's `>= 0 && <= 1` would then deny every rejoin
  // — the same lockout, one sub-case over). 0/1 are the only legal stored values.
  const veto = existing.vetoRemaining;
  if (!Number.isInteger(veto) || (veto as number) < 0 || (veto as number) > 1) heal.vetoRemaining = 0;
  if (typeof existing.isHost !== 'boolean') heal.isHost = false;
  return { firstJoin: false, heal };
}
