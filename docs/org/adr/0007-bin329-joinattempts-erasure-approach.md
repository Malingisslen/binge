# 0007. BIN-329 — joinAttempts erasure: proposed mechanism infeasible, plan parked

- **Date:** 2026-06-29
- **Status:** Accepted & implemented (Malin: "fix 329 permanently"). Final design refined
  the parked plan — see "Implemented design" below.
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

## Implemented design (after "fix 329 permanently" go-ahead)
The build refined the plan to the **lowest-risk permanent fix — no `firestore.rules` change and
no new index**:

- **Server reaper = a staleness sweep, not an owner-existence query.** A token-join is one
  synchronous two-step flow; a successful join deletes its own `joinAttempt` within seconds, and a
  retry rewrites a fresh one. So *any* attempt older than a short TTL is an orphan whose only content
  is a now-spent plaintext token. The existing `retentionCleanup` daily job gains a
  `collectStaleJoinAttempts` sweep (`collectionGroup('joinAttempts')`, `select('createdAt')`,
  `orderBy('__name__')` — the same bounded, **index-free** pattern as the notifications sweep) that
  deletes attempts older than **1 hour** (`isStaleJoinAttempt` pure helper + tests). This single
  mechanism closes ALL three gaps — abandoned-join orphans, the member-walk blind spot, and the
  Firebase-Console bypass (admin SDK ignores rules) — without touching rules or indexes.
- **Client cascade for immediacy.** `deleteAccount` queues a deterministic
  `doc(groups/{gid}/joinAttempts/{myUid})` delete in its existing `groupsSnap` loop, so self-service
  deletion erases the token instantly rather than waiting up to ~25h for the sweep. Allowed by the
  existing `delete: if uid == request.auth.uid` rule; delete-on-missing is a safe no-op.
- **Export:** `joinAttempts` is intentionally NOT a `UserDataSnapshots` key — it's handled inline in
  the cascade + reaper (like the other per-group sub-cleanups), so it's naturally export-excluded.
  The `userData.ts` header documents why (group's shared secret, not personal data — like `fcmTokens`).
- **Token minimization deferred:** the create rule hashes the plaintext at create-time, so the token
  must be in the doc to pass validation — removing it would need a rules change. The 1h reaper bounds
  exposure to ≤~25h, so the rules change was judged not worth its risk this round.
- **episodeReactions:** documented in `data-retention-policy.md` (deleted by the cascade, no TTL — it's
  content, not a secret). The broader Console-bypass for cascade-only content is named as a known
  low-sensitivity limitation owned by a future owner-existence reaper.

## Decided by
Panel #5/#6/#27 (unanimous: original mechanism infeasible). Built after Malin's "fix permanently"
go-ahead, with the staleness-reaper refinement to avoid a rules/index change.
