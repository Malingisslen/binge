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

## Consequences

- The parked plan (`~/.claude/plans/binge-groups-rules-hardening-2026-06-29.md`)
  encodes this scope. Tests assert the cap on the join paths and that owner-rename
  still works.
- No erasure impact: leave/delete shrink `memberUids` and are never blocked by the cap
  (DPO #6; verified in `deleteAccount`).
- Tier C: needs Malin's sign-off + manual `firebase deploy --only firestore:rules`.
