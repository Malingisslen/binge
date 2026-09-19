# binge-security-reviewer — server chapter

Read only when the staged diff touches this chapter's paths (see .claude/shared-plugin.json → knowledge.tiers).

## Social-graph mirror-write trust boundaries
- **When new server-side logic starts READING a collection to DECIDE something, ask which collection the
  RULES treat as authoritative for that decision, and in which direction the two can diverge.** A
  membership ARRAY on the parent doc and a membership SUBCOLLECTION are two records of one fact, written by
  different rule branches, and the weaker one silently becomes the ballot the moment a new consumer reads
  it. FOUND IN REVIEW, BIN-1063 steg 3 (fixed before it shipped; the shipped `pickGroupSuccessor` takes the
  array as a required `eligibleUids` parameter and uses the member rows only for each candidate's
  `joinedAt`). As first written it elected from `groups/{gid}/members/*` while `firestore.rules`
  decides MEMBERSHIP from `groups/{gid}.memberUids`. Say it that way and not "every access clause keys on
  memberUids" — that quantifier is false in the direction that matters here, since the clauses granting the
  most are the ones keyed on `ownerUid` (group `delete`, `sessionHistory` delete). The group doc's own
  `read` clause is not one of them — it has changed since (BIN-1152) — so read it directly from
  `firestore.rules` rather than assume its shape. The group-doc leave branch removes a uid from the array and touches no
  member doc, and after leaving the member-doc `delete` rule's self-branch (`uid in memberUids`) no longer
  admits her — so an ex-member's roll entry is permanent AND carries the earliest `joinedAt`, electing her
  owner of a group she left. `ownerUid` then grants group `delete`, `members/*` write and `household/*`
  delete with no membership test anywhere. Note the rules deliberately forbid the OWNER growing `memberUids`
  (`hasAll(new ⊆ old)`, BIN-327/H1) — so a picker sourced from the subcollection re-opens exactly the hole
  the array's rule was hardened to close. Check both directions: array-without-doc is usually inert (not a
  candidate), doc-without-array is the escalation. The fix belongs in the pure decider that already holds
  BOTH inputs, not in a caller: intersect first, and an empty intersection returns "no successor".
  **Accept only the shape where the access list is a REQUIRED parameter of the EXPORTED decider** — an
  optional argument, or an intersection done solely in the wrapper, leaves the exported picker electing
  from the roll for the next caller, which is the same hole one call site later. The property to assert
  is the invariant, not the filter: the elected uid must be an element of the array the write itself
  stores (successor ∈ surviving `memberUids`). That holds for THIS write and says nothing about the
  freeze reachable from a client write. Two producers, two
  answers — and which branches carry the guard is read off the rules, never off a count in a sentence. Two tests, one per direction — a roll entry absent from the
  array must not win, and the array-entry-with-no-roll-row direction pinned to whichever answer was decided.
  Companion trap in the same module: a `number | null` ordering key whose "null means unusable" contract
  lives only in prose lets a NON-FINITE value into the ranked pool, where `a !== b && a < b` is false in
  both directions and the winner flips with array order — guard with `Number.isFinite`, not `!== null`.

## Server-only collections, public rollups, external input
- App Check is opt-in (reCAPTCHA v3, no-op without a site key — never assume enforcement). `request.app !=
  null` is the right v2 idiom but SOFT: only `enforceAppCheck: true` hard-rejects (BIN-361). v2 callables
  redirect to `*.run.app` — both belong in CSP `connect-src`. Rules can't count sibling writes in a batch —
  use a server-authoritative `onCall` + per-uid cooldown in `runTransaction`.

## Secrets and config
- Secrets via `defineSecret` → `process.env.*`, in headers or a vendor-mandated query param (TMDB), never
  logged. **A failure log may carry the vendor's own error body only if the literal secret is stripped first**
  — `body.replaceAll(key, '[redacted]')` BEFORE truncating; `key` guarded non-empty or an empty-string
  `replaceAll` is catastrophic. One status code's credential-free proof isn't proof for every status the
  branch covers (BIN-856). Admin-SDK offline path segments need `Number.isInteger`; CI strings go via `env:`.
- **Test a gitignore secret pattern with `git check-ignore`** against the RUNBOOK filename AND the tool's
  DEFAULT download name — `*-recaps-writer*.json` misses `recaps-writer.json`; GCP's `{project}-{hash}.json`
  matches no `*service-account*` glob.

## Cost, budgets, rate limits, fan-out
- Sealing a client-writable counter behind a callable closes FORGERY/write-SHAPE, NOT COST or DOC-COUNT.
  Against "X matches the sealed pattern used by Y/Z/W", verify each sibling's SPECIFIC bound; separate ACTUAL
  enforcement from design-intent (vendor spend is bounded by `reserveMotnSlot`'s transaction, not cadence),
  and never refund a reservation the vendor already counted.
- **"Claim in a transaction, work outside, release on failure" has a hard-timeout hole.** GCP force-kills a
  timed-out function with no `finally`, so a kill between claim and release sticks the flag for the cycle —
  bound the window under the platform timeout, or give the claim a LEASE timestamp. Transactions retry the
  callback, so `.add()` duplicates; use idempotent `.doc(id).set()`.
- **"Every write is idempotent" is not "a retry REACHES this unit" — check whether the claim write mutates the
  field the CANDIDATE QUERY selects on.** FOUND IN REVIEW, BIN-1063 steg 3 bunt 2 (r1, fixed before it
  shipped — full finding in the archive, dated 2026-09-07; the shipped `runHandover.ts` calls
  `eraseMemberTraces` before `claimOwnership`). As first written the claim ran FIRST: `claimOwnership` swaps
  `ownerUid` AND drops the leaver from `memberUids`, with the trace erasure after it and outside the
  transaction. Both doors' candidate queries key on exactly those two fields (`where('ownerUid','==',uid)`
  in the callable,
  `where('memberUids','array-contains',uid)` in `collectUserDataSnapshots`), so a throw from the erasure —
  reachable by an ordinary concurrent delete, since an `update` on a removed row throws, and by a
  multi-batch `flush()` landing batch 1 and failing batch 2 — strands the departing account's PII where no
  retry and no sweep can ever see it again. The suite can even SAY so and be read as a strength: the
  idempotency test asserted "the group no longer matches the ownerUid query at all". Remedies, in order of
  preference: erase BEFORE the claim; or keep the selecting field intact until the erasure commits and clear
  it last; or widen the candidate query to the union. Ask at every claim-then-work split: after the claim,
  what still finds this unit?
- **Don't GUESS which status a malformed path-param id draws.** BIN-856 assumed 400; live probes showed
  `movie/{NaN,'',abc,-1,0}` all 404 (bad RESOURCE) → `[]`, the SUCCESS path, never reaching the governor.
  Real harm is a quieter **quota LEAK**: no `checkedAt` → immortal item, re-picked every run. Fix either way:
  filter before the id enters the work set — verify live.

## Admin-SDK sweeps and scheduled writers
- **Admin SDK bypasses `firestore.rules` entirely — `hasOnly` offers ZERO protection against what a sweep
  writes.** The backstop is pure logic: a FRESH payload from a fixed allowlist, unit-tested for key-set
  equality + disjointness from `FORBIDDEN_FIELDS`. Whole-DB sweeps add a dry-run-by-default gate, cursor +
  budget, and an audit `lastRun` write every run.
- **`FieldValue.increment` is redundant once a transaction already reads the target doc for another reason**
  — OCC retries the WHOLE callback, so `read.value + delta` commits against the freshest value; it earns its
  keep only on an unread doc or a write OUTSIDE a transaction. Before dropping it: confirm no OTHER writer,
  add a `numberOr0` guard matching increment's non-numeric→SET-to-delta behavior (not `NaN` forever), and
  check the merged payload is unchanged (BIN-727).
- **An IRREVERSIBLE whole-population sweep needs a CEILING, the ceiling needs a FLOOR, and the REFUSAL needs
  an operator path.** 'A failed check means could-not-check' (BIN-848/816) covers ERRORS only; a
  SUCCESSFUL-but-wrong read (renamed collection, inverted predicate, or a WHOLE DATABASE opened by
  inference) makes every candidate
  legitimately absent and one run eats the population.
  Demand `MAX_PER_RUN` that deletes NOTHING when
  exceeded. **The floor BOUNDS the latch, it does not remove it** — above it the wedge is permanent and cheap to
  plant (one `signUp` mints a profile-less Auth account). Rate the REFUSAL itself: a RUNBOOK clear-by-hand
  entry, and any LEGAL claim a runbook-only fix leaves false. It belongs in the admin-free predicate module,
  and extracting the predicate leaves the CALL unpinned — ask for the filtered SET, not a boolean.
- **A new privileged API call inside an existing function invalidates the post-deploy attestation scoped to
  the OLD permission.** BIN-848 verified only `firebaseauth.users.get`; BIN-816 added `listUsers` +
  `deleteUsers` (a DELETE permission). A missing runtime role makes the sweep inert with a green deploy —
  grep the attestation, name the new permission, add its log-line acceptance bar in the same commit.
- A shared accumulator returned only at loop-end fails twice on a throw from unit K: K+1..M skipped,
  1..K-1's writes discarded. try/catch-continue per unit; the error-REPORTING callback gets its OWN nested
  try/catch. Give the outer `.catch()` a sentinel a legit run can't produce (`-1`, never `0`) plus an
  ATTEMPTED counter (BIN-848).
- **collectionGroup matches by LEAF collection id regardless of parent path** — grep other writers/readers of
  that leaf name before trusting one (`collectionGroup('watchlist')` also matches `groups/{id}/watchlist/{id}`,
  safe only because those docs lack `status`). uid comes from the doc PATH (`d.ref.parent.parent?.id`), never
  client content.
- Bare-tmdbId keying collides movie and TV — grouping keys, state doc ids, FCM `tag`s, inbox ids and action
  URLs all need `mediaTypeDocId`; fixing one means grepping every other collection on that bare id (BIN-523).
