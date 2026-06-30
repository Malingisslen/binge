# ADR 0008 — Groups rules hardening: scope the memberUids size-cap to growth branches

**Date:** 2026-06-29
**Tickets:** BIN-276, BIN-327
**Status:** Accepted (plan parked In Review; rules not yet deployed)
**Panel:** #4 Security Architect, #6 DPO, #27 DBA, #7 QA (routed `top`)

## Context

Hardening the `match /groups/{groupId}` rules: pin `ownerUid`/invite-token fields in
the owner-update branch (BIN-276) and cap `memberUids.size()` to bound read
amplification (BIN-327). The panel agreed on every must-have except one detail.

## Decision

**1. The `memberUids.size() <= 100` cap goes on the token-join and invite-accept
branches only — not the owner-update branch, not a re-cap on `create`.**

- DBA #27 argued for a cap on *every* branch that can write `memberUids`, for uniform
  enforcement.
- Security #4 argued the owner-update branch is shrink-only (`hasAll(new ⊆ old)`), so
  it structurally cannot grow the array, and `create` is already pinned to size 1 via
  `hasOnly([auth.uid])`.

**Resolved in favour of Security #4** (higher-stakes owner for rules correctness; the
claim is a verifiable structural fact). A `size()` predicate on a branch that can only
shrink the array is dead code that implies a guard it doesn't provide. The two join
branches are the only paths that grow `memberUids`; the cap belongs exactly there.

**2. Do NOT pin `name`/`defaults` in the owner-update branch.** Security #4 caught that
this branch is the sole authorizer of the legit rename path (`updateGroupSettings`,
`src/lib/firebase/groups.ts:56–59`). Pinning them would silently break renames. Lock
only identity/membership-shape fields (`ownerUid`, `inviteTokenHash`,
`inviteTokenRotatedAt`).

**3. Ceiling = 100.** DBA noted 50 would halve worst-case per-`get()` payload at no
realistic product cost, but 100 is defensible for permanent household/friend groups
(≈3 KB, far from the 1 MiB limit; the bound targets read-amplification). Not a security
boundary — left at 100, flagged for product if it ever matters.

**4. Implementation discovery — the leave branch was also an uncapped growth path.**
During execution (Step-0 re-read of the live rules), the leave branch (firestore.rules
~666) was found to have **neither** `hasAll` **nor** a size cap. A current member could
set `memberUids` to a *superset* (excluding themselves) — injecting an arbitrary uid as
they "leave", and bypassing the join/accept cap entirely, making BIN-327's cap a fig
leaf. This wasn't in the signed-off plan but is squarely within DBA #27's stated
principle ("pin on every branch that can write `memberUids`"). Resolution: added
`resource.data.memberUids.hasAll(request.resource.data.memberUids)` to the leave branch —
the identical idiom already on the owner branch, strictly tightening (verified: the only
leave-flow caller, `removeMember`/`leaveGroup`, does `arrayRemove(self)`, a pure shrink →
still passes). Covered by the new `leave branch — shrink-only` tests.

**Residual (follow-up):** even with `hasAll`, a leaving member can still *remove* a third
party (a subset is still ⊆ old) — lower severity (removal-only, no injection, and the
actor is leaving). Filed as a follow-up rather than expanded here, since "exactly-self-
removed" needs a more intricate set-difference predicate and its own review.

**5. Implementation discovery #2 — the `inviteTokenHash` pin broke token rotation
(caught by pre-deploy security review).** The plan said "pin `inviteTokenHash` in the
owner branch." But `rotateInviteToken` and `disableInviteToken` (groups.ts:68–92) are
legit *owner* writes that intentionally change the hash, and they flow through the owner
branch — so the pin denied them, leaving an owner unable to revoke a leaked invite link.
This is the SAME failure mode the panel caught for `name`/`defaults` (owner branch = the
only path for a legit op), which the plan reintroduced for the token fields. Fix: keep
the owner-branch hash pin (so a membership edit can't swap the hash), and add a dedicated
**token-rotation branch** that allows `inviteTokenHash`/`inviteTokenRotatedAt` to change
while pinning `ownerUid`/`memberUids`/`name`/`defaults`. A member-remove+hash-swap attack
changes `memberUids`, so it matches neither branch → still denied. Covered by new tests
(owner can rotate / owner can disable / non-owner cannot rotate). Lesson: plan-time review
and implementation-time review are different lenses — the gate must run again before a
rules deploy.

## Consequences

- The parked plan (`~/.claude/plans/binge-groups-rules-hardening-2026-06-29.md`)
  encodes this scope. Tests assert the cap on the join paths and that owner-rename
  still works.
- No erasure impact: leave/delete shrink `memberUids` and are never blocked by the cap
  (DPO #6; verified in `deleteAccount`).
- Tier C: needs Malin's sign-off + manual `firebase deploy --only firestore:rules`.
