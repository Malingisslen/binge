# Orphan-follow sweep (`reclaimOrphanFollows`) — design

**Date:** 2026-06-14
**Ticket context:** follow-up to BIN-21
**Status:** approved (Malin signed off on approach + weekly cadence 2026-06-14)

## Problem

When a user deletes their account, `deleteAccount` (`src/contexts/AuthContext.tsx`)
cleans up **outbound** follows correctly: for each `users/{deleted}/following/{X}`
it also deletes the mirror `users/{X}/followers/{deleted}`, because the deleting
user owns both writes.

It cannot clean up **inbound** follows. When X follows A:

- `users/{A}/followers/{X}` — owned by X (rules: `allow delete: if isOwner(followerUid)`, `firestore.rules:187`)
- `users/{X}/following/{A}` — owned by X

When A deletes their account, A is forbidden by the rules from deleting either
doc. So after deletion:

- `users/{A}/followers/{X}` lingers forever under the deleted account's tree.
- `users/{X}/following/{A}` lingers forever as a "dangling follow" on every user
  who followed A.

BIN-21 fixed the **user-visible** symptom: `useFollowList` drops ghost follows
whose target profile no longer exists, at read time. But the orphaned docs
themselves persist and grow unbounded. This design reclaims them server-side.

## Decision

**A weekly scheduled Cloud Function**, `reclaimOrphanFollows`. Rejected
alternatives:

- **(b) Clean up on the deletion path / via an onDelete trigger.** The client
  cannot delete other users' `following/{A}` docs (rules forbid it), so this
  would need the Admin SDK in a function anyway. An onDelete trigger fires per
  deletion (more invocations) and only covers the deletion case — it would miss
  any orphan created by a future rules edge. A scheduled sweep is simpler,
  cheaper to reason about, and catches every orphan source.
- **Hybrid (instant trigger + weekly net).** Most code and cost for a low-stakes
  hygiene problem where ghosts are already hidden from users on read. Not worth it.

## How it works

New file `functions/src/reclaimOrphanFollows/index.ts`, exported from
`functions/src/index.ts`, mirroring the existing scheduled-function shape
(`onSchedule`, `region: 'europe-west1'`, `timeoutSeconds: 300`, `memory: '512MiB'`)
used by `episodeReleaseNotify` and `rollupInsights`.

### Detection — the "alive set" approach

1. Read every `users/*` doc **id-only** (`.select()` with no fields → 1 read/doc,
   minimal egress) into an in-memory `Set<string>` of uids that still exist.
2. `collectionGroup('following')` scan. Each doc path is
   `users/{owner}/following/{target}`, where `owner` is `doc.ref.parent.parent.id`
   and `target` is `doc.id`. Delete the doc if `owner ∉ alive` **or**
   `target ∉ alive`. (`target ∉ alive` is the dangling-follow-on-others case.)
3. `collectionGroup('followers')` scan. Each doc path is
   `users/{followed}/followers/{follower}`, where `followed` is
   `doc.ref.parent.parent.id` and `follower` is `doc.id`. Delete the doc if
   `followed ∉ alive` (the deleted-account leftover) **or** `follower ∉ alive`.

### Deletion

Collect orphan `DocumentReference`s and delete in batches of 450 (the same
ceiling the client deletion path uses), one `db.batch()` per chunk,
`Promise.allSettled` across chunks. Batch errors are logged via
`functions.logger`, not thrown — one failed batch never aborts the run; the next
run retries whatever is left.

### Schedule

`schedule: 'every 168 hours'` (weekly). No user-visible urgency — ghosts are
already hidden on read — so weekly reclamation of underlying storage is plenty.

## Pure logic + tests

The orphan-detection decision is extracted into a pure helper so it can be tested
without firebase-admin, following the `episodeNotify/logic.ts` +
`logic.test.ts` pattern:

`functions/src/reclaimOrphanFollows/logic.ts`

```ts
export type FollowKind = 'following' | 'followers';

/** A flattened follow doc, independent of Firestore types. */
export interface FollowRef {
  kind: FollowKind;
  ownerUid: string;   // doc.ref.parent.parent.id
  otherUid: string;   // doc.id (target for 'following', follower for 'followers')
}

/** Orphaned when either endpoint's user profile no longer exists. */
export function isOrphanFollow(ref: FollowRef, aliveUids: Set<string>): boolean {
  return !aliveUids.has(ref.ownerUid) || !aliveUids.has(ref.otherUid);
}
```

`functions/src/reclaimOrphanFollows/logic.test.ts` (Vitest) covers:

- both endpoints alive → not orphan
- owner missing → orphan (deleted account's leftover follower / its own follow)
- other endpoint missing → orphan (dangling follow on a live user)
- both missing → orphan
- works identically for `kind: 'following'` and `kind: 'followers'`

Tests assert real branch logic; they are not weakened to pass.

## Cost

Reads per run = `(#users) + (#following docs) + (#followers docs)`. Deletes only
for actual orphans. At binge's current volume this is a few hundred operations
per week — far under the Firestore free tier, nowhere near the 25 SEK/mån cap.
`.select()` narrows egress on every scan.

## Safety / correctness

- **Idempotent.** Pure cleanup; a second run finds nothing.
- **No rules change.** Admin SDK bypasses `firestore.rules` (same as
  `episodeNotifyState` writes).
- **No false positives.** A brand-new signup cannot be referenced by pre-existing
  orphan docs. A user deleted mid-run is simply caught on the next run.
- **Partial-failure tolerant.** Per-batch `allSettled` + logged errors; the run
  always completes and the next run mops up remainders.

## Deploy reality (must be carried into the implementation plan)

This is a Cloud Functions change. After merge it requires a **manual
`firebase deploy --only functions`** — the `deploy.yml` drift-guard blocks the
push otherwise. Hosting ships via `workflow_dispatch`. `/commit` does not cover
functions deploys (see memory: deploy-scope). The plan's final step must spell
this out.

## Out of scope

- No change to BIN-21's read-time ghost filtering (`useFollowList`) — it stays as
  the instant user-facing guard; this sweep is purely the storage backstop.
- No change to `deleteAccount` — outbound cleanup there is already correct.
- No friends/friendRequests sweep — the deletion path already mirrors both sides
  of those, and they are not subject to the same inbound-ownership asymmetry.
