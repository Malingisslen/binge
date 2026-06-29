# 0007. BIN-329 — joinAttempts erasure: proposed mechanism infeasible, plan parked

- **Date:** 2026-06-29
- **Status:** Proposed (plan parked In Review — NOT built this run)
- **Trigger:** `/sprint-execute` selected BIN-329 (account deletion misses
  `groups/{id}/joinAttempts/{uid}`; plaintext invite token survives). Routed `top`.
- **Panel:** #5 Legal/GDPR Counsel, #6 Data Protection Officer, #27 Database Administrator (blind).

## Context
A token-join writes `groups/{groupId}/joinAttempts/{uid}` (doc-id = uid, body = plaintext invite
token). The ticket's suggested fix: a `collectionGroup('joinAttempts').where(documentId() == uid)`
query in `collectUserDataSnapshots`, pushing the refs into the `deleteAccount` batch.

## Conflict / Ruling (unanimous: the proposed mechanism cannot run)
All three reviewers independently flagged that `firestore.rules` sets `joinAttempts` to
`read: if false`. A client `collectionGroup('joinAttempts')` read is therefore **permission-denied
for every doc** — the query silently collects nothing and the Art. 17 gap persists *undetected*.
(The `documentId() == uid` precedent at `userData.ts` works only because `likes` is `read: if true`.)

Two further gaps the ticket glossed:
1. **Abandoned-join orphan** — the two-step join (write attempt → add to `memberUids`) can leave a
   `joinAttempts/{uid}` in a group the user never became a member of. A member-walk over
   `groupsSnap` (`memberUids array-contains uid`) cannot reach it.
2. **Console-deletion bypass** — admin-deleting a user in the Firebase Auth Console runs no client
   cascade; `retentionCleanup` (Admin SDK) sweeps only `sessions` + `notifications`, so the plaintext
   token survives indefinitely.

## Decision (to be confirmed by Malin before building — risky/rules-touching)
Two-layer fix, NOT the single collection-group query:
- **Client (common case, zero new reads/index):** in `deleteAccount`'s existing `groupsSnap` loop,
  queue a deterministic `doc(groups/{gid}/joinAttempts/{uid})` delete into the existing delete batch.
  Allowed by `delete: if uid == request.auth.uid`; delete-on-missing is a safe no-op.
- **Server (full coverage):** a scheduled/Auth-triggered Admin-SDK reaper that does the real
  `collectionGroup('joinAttempts').where(documentId() == uid)` (rules-bypassed) to catch
  abandoned-join + Console-deleted orphans, also covering `episodeReactions`.
- **Export:** classify `joinAttempts` **delete-only, excluded from `buildUserExport`** (it is the
  group's shared secret, not the user's personal data — like `fcmTokens`). Update the
  `dataExport.coverage` classification + `userData.ts` comment so the absence is self-documenting.
- **Minimization (separate hardening):** the plaintext token need not persist post-create (the rule
  hashes it server-side at create) — write a marker doc or guarantee immediate self-delete.
- **Verification:** emulator-backed deletion test asserting zero surviving `joinAttempts` /
  `episodeReactions` for the deleted uid (the BIN-328 compile-time guard does NOT cover group
  subcollections).
- **Docs:** add `joinAttempts` + `episodeReactions` rows to `docs/data-retention-policy.md`, and
  name the Console-deletion bypass as a known limitation with an owner.

## Why parked, not built
Touches `firestore.rules` and/or a new Cloud Function (admin-SDK reaper) — a Tier-C risky change
that, per CLAUDE.md, gets a written plan + explicit go-ahead before code. Filed In Review.

## Decided by
Panel #5/#6/#27 (unanimous: mechanism infeasible). Final build approach awaits Malin's go-ahead.
