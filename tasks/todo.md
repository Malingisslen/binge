# BIN-624 — swipe doc-id guard in firestore.rules (+ the server-strictness question)

Plan written 2026-08-05, approved the same day. **Half 1 is BUILT and in this commit;
half 2 waits on the instrumented count and is not written yet.** Tier `top` per
`node docs/org/route.mjs firestore.rules …`; panel #4 Security Architect, #6 Data
Protection Officer, #27 DBA ran BLIND and concurrently before this plan was written.
Their conditions are folded in below as binding acceptance criteria.

The 2026-08-05 sprint plan that used to live here is deleted, not archived — it shipped
(`2dbf487`, `2ce3b2c`, `24bdd3e`, `c28b90d`, `eb02f44`) and its outcome is recorded on the
tickets and in project memory. A stale plan that states false things is worse than no plan.

---

## What this is about, in one paragraph

Every per-title document is keyed `movie_${tmdbId}` / `tv_${tmdbId}`. BIN-618 made the
CLIENT parser strict — `movie_042`, `tv_0000042`, `zmovie_42` all resolve to nothing — so a
hand-written alias can no longer re-key onto a genuine title's slot. The SERVER copy stayed
permissive on purpose, because its read sites had never been audited. BIN-636 pinned that
deliberate split with `src/lib/mediaTypeDocId.parity.test.ts`, whose header names THIS ticket
as the thing that resolves it. Two things are still open, and they turn out to be much less
related than the ticket assumed.

---

## Half 1 — the swipe doc-id guard. BUILD IT.

`match /swipes/{tmdbId}` put no constraint on the document id at
all: anyone holding a session link can create `sessions/{id}/swipes/<anything>`. Cost and
clutter, not vote integrity — BIN-636's audit established that no forged doc id can suppress
or forge a vote on either side any more.

```
function canonicalSwipeDocId(id) {
  return id.matches('^(movie|tv)_(0|[1-9][0-9]*)$');
}
```

ANDed onto the `create` branch only. `update` stays unguarded.

**Why create-only.** `create` and `update` in Firestore rules are decided by whether the
document exists, not by the caller — so an attacker cannot reach the update branch on a path
with no document. Exempting update therefore forecloses every new non-canonical id while
letting the legacy bare-numeric swipe docs (written pre-namespacing, still merged
per-participant per BIN-608) keep receiving votes until the session's 7-day TTL reaps them.
Both #4 and #27 confirmed this independently; #27 confirmed it is a coherent end state and
strands nothing.

**Why it cannot break the app.** `recordSwipe` (`src/lib/firebase/sessions.ts:116-128`) is
the only writer and always goes through `mediaTypeDocId(params.mediaType, params.tmdbId)`
with `tmdbId` statically typed `number` — canonical by construction.

**Cost:** free. A `matches()` on the path segment, no `get()` (contrast `voteKeyIsAnonSlot`,
`firestore.rules:805`, which does one). No index impact.

### Acceptance criteria — half 1

- [x] **BLOCKING, from #4 Security Architect — the emulator suite must be rewritten in the
      same change.** `src/test/rules/firestore-rules.test.ts` defined
      `swipeRef(db, tmdbId = '603')` — a BARE-NUMERIC default — and all **21** call sites in
      the BIN-509 vote-binding block created their swipe doc at that path via
      `setDoc(…, {merge:true})`. The new create-guard rejects every one of them before the
      vote logic under test is reached, including the four `assertSucceeds` cases.
      **Never loosen the regex to admit bare-numeric on create** — that re-opens precisely
      the hole this half exists to close.
      **DONE:** the namespacing moved into the `swipeRef` helper (one line, all 21 sites),
      so each case still tests what its name says. Both the security and the test reviewer
      ran their OWN mutation run to confirm it: with the guard stripped, exactly 10 tests
      fail and all 10 are in the new block — none of the 21 rewritten cases is being held up
      by the guard.
- [x] A NEW emulator test asserts a non-canonical create is denied (`movie_042`, `042`,
      `zmovie_42`, `season_42`, `movie_`) and a canonical one succeeds.
      **DONE:** 10 denial cases + 3 acceptance cases (incl. `movie_0`, which is canonical
      output for the number 0 and must NOT be read as a leading zero). The list is a
      deliberate superset of `ALIASES_OF_42` in `mediaTypeDocId.parity.test.ts`.
      A path-traversal id (`../evil`) is deliberately NOT asserted — the Firestore SDK
      rejects the reference before any rule runs, so the case would pass without the guard
      and prove nothing. The comment in the file says so.
- [x] A NEW emulator test asserts a grandfathered bare-numeric doc, admin-seeded, can still
      be UPDATED with a new vote key — the BIN-608 merge path must survive.
      **DONE:** also catches the regression where someone extends the guard to `update`.
- [x] `npm run test:rules` green against the emulator BEFORE deploy (#4). Java on PATH.
      **DONE: 244/244.**
- [ ] **OPEN — Malin's step.** Deploy by hand: `firebase deploy --only firestore:rules`.
      `deploy.yml` ships hosting only and will never do this. Rollback is pure removal of an
      added constraint — no data migration, no lockstep client deploy, since production
      clients already write canonical ids only (#4). **Until this runs, the guard is in the
      repo but not in production.**

---

## Half 2 — server strictness. **PANEL SPLIT; Malin resolved it as (B). NOT BUILT YET.**

The ticket asked for five rounds whether the server's `parseTmdbIdFromDocId` should adopt
the client's strictness. The panel came back with two defensible, incompatible answers — and
in reaching them, both roles independently found that **the bug everyone has been pointing at
is not in the parser at all.**

### The finding that reframes the question

`functions/src/communityRatings/index.ts:43-59` takes the watchlist doc id from the trigger
path and uses it as the `titleRatingsAggregate` doc id **verbatim**:

```js
const pathMediaType = parseMediaTypeFromDocId(docIdRaw);
if (pathMediaType != null) { docId = docIdRaw; }        // ← verbatim, suffix never canonicalized
else { docId = mediaTypeDocId(bodyMediaType, docIdRaw); } // ← also verbatim in the suffix
```

`parseMediaTypeFromDocId` is prefix-strict and **identical on both copies** — it is not part
of the divergence. So a `movie_042` watchlist doc forks that title's rating aggregate into a
second document *today*, and would go on doing so **after half 2 ships, unchanged**.
Tightening the shared parser does not touch this line. Both #4 and #27 flagged it, from
opposite directions. *(Verified by reading the file: correct.)*

The one-line fix is `docId = mediaTypeDocId(pathMediaType, parseTmdbIdFromDocId(docIdRaw))`.
It is a correctness change, not a security tightening, and it belongs on its own ticket
(**filed as BIN-766**).

**That one line stops being correct at step 4 of this very plan.** Once half 2 tightens the
SERVER parser, an alias id returns `NaN`, and `mediaTypeDocId('movie', NaN)` is the literal
string `movie_NaN` — a new junk aggregate instead of a merged one. Step 3's zero-count gate
makes it unreachable only if the count really is zero and stays zero. So the fix must guard
`Number.isFinite` and skip-with-a-log before it can ship alongside a strict server parser;
BIN-766's acceptance criteria already require a test for exactly that case. Build it correct
under BOTH parser variants, or it becomes a hidden binding to half 2's outcome.

### The actual split

**#4 Security Architect — do not build half 2 as scoped.** It "fixes the wrong bug": it
touches 7 unrelated read sites and leaves the vote-splitting line untouched. The remaining
effect — a `movie_042` watchlist doc that the server reads as title 42 while the owner's own
app drops it — is owner-write-only, self-inflicted, never cross-user. Trading "server acts
on the wrong title" for "server silently drops the document" is a data-integrity/UX call,
not an access-control fix. Low priority for this role.

**#27 DBA — ship it, after a free verification.** The affected-doc count cannot be known:
there is no `schemaVersion` stamp, and Firestore cannot regex a document key in a query, so
the only real count is a full collection-group read — exactly the cost the 25 SEK/month cap
exists to avoid, and a cost this repo already declined once for a comparable read. So half 2
must be judged safe under *population unknown*. It very likely is: ~90 `mediaTypeDocId(…)`
call sites were traced and every one passes a `number`, or a `number|string` sourced from a
TMDB response — never a raw route string. **Legacy bare-numeric docs (`123`) survive
strictness**; they are in the agreed part of the contract, not the alias set. #27's proposed
verification is the good part: **piggyback one-time counting on the 5 scheduled functions'
already-budgeted reads for one cycle**, flagging any doc id that fails the strict regex but
passes the permissive one, before flipping the parser. Zero marginal reads, zero cost.

**#6 Data Protection Officer — clean bill of health, no blocking, no conditions.** The crux
question was whether a doc the client cannot see escapes subject rights. It does not:
`collectUserDataSnapshots` enumerates the whole watchlist subcollection raw, and both the
GDPR export and account deletion iterate that snapshot without ever calling a parser — a
`movie_042` doc is exported verbatim and hard-deleted. No Art. 15/17/20 gap. The weekly-digest
email raises no Art. 5(1)(d) accuracy issue: the personal data is accurate, the mismatch is a
display bug. Half 1 has no privacy dimension at all — it is cost/clutter on 7-day TTL data.
Retention is clean: `retentionCleanup` `recursiveDelete`s the whole session tree regardless of
doc-id shape.

### RESOLVED 2026-08-05 — Malin picked **(B)**

Given the three options below with (A) recommended, she chose **(B): ship half 1 and the
`communityRatings` fix now, then tighten the server after #27's free instrumented count comes
back zero.** Not to be re-litigated; (A) and (C) are closed.

What that commits us to, in order:
1. **Half 1** — the rules guard, the 21-fixture rewrite, the new denial/grandfather tests.
2. **The `communityRatings` one-line fix** on its own ticket — it is in (A), so it is in (B).
3. **The instrumented count** — added to the 5 scheduled functions' existing reads, run for
   one full cycle. **The count must come back zero before the parser is touched.** A non-zero
   count is a STOP and comes back to Malin, not a reason to tighten anyway.
4. **Only then** the server parser, the parity-test rewrite, and the BIN-759 wording — in
   their own commit, with their own targeted `firebase deploy --only functions`.

Step 4 is deliberately unreachable in the same sitting as step 1: it waits on a scheduled run.

### The three options — Malin picked (B)

- **(A) Ship half 1 only. Fix `communityRatings` on its own ticket. Leave the server
  permissive.** Follows #4. Closes the junk-doc hole, fixes the real aggregate-split bug at
  its actual site, and leaves the parser split — with its parity test — exactly as BIN-636
  designed it. Cheapest, and nothing about it is wrong later.
- **(B) A, plus tighten the server after #27's free instrumented count comes back zero.**
  Follows #27. Ends the divergence permanently and lets the parity test collapse into a plain
  agreement block. Costs one extra scheduled-run cycle of waiting and a functions deploy.
- **(C) A, and close half 2 as won't-do**, recording that the divergence is permanent and the
  parity test stays a divergence net forever.

**Recommendation: (A), with the `communityRatings` fix filed immediately as its own ticket.**
It is the only option where every role's finding is acted on and nothing is built on a premise
the panel just disproved. (B) remains available at any time and is strictly cheaper to decide
once the aggregate bug is out of the way — and #27's counting trick is worth keeping whichever
way this goes.

### Acceptance criteria — half 2 (Malin chose B, so these are live, not hypothetical)

- [ ] The instrumented count runs for one full cycle across the 5 scheduled functions and
      reports **zero** alias-shaped doc ids before the parser is touched (#27). A NON-zero
      count is a STOP and comes back to Malin — never a reason to tighten anyway.
- [ ] `src/lib/mediaTypeDocId.parity.test.ts` is rewritten per its own header:
      `ALIASES_OF_42` folds into `AGREED_READS` expecting `NaN` on both sides, and the
      `pins the shadowing` case is deleted — it asserts server-only behaviour that (B)
      removes. **Never relax the client to make the file pass.**
- [ ] **When `ALIASES_OF_42` goes away, the superset comment in
      `src/test/rules/firestore-rules.test.ts` (the swipe denial list) and the back-pointer
      beside `ALIASES_OF_42` both name a constant that no longer exists.** Rewrite both in
      the same commit — the rules denial list itself STAYS; only the wording that ties it to
      a deleted array changes. Nothing mechanically links those two files, which is exactly
      why this is written down.
- [ ] Functions deployed by hand (`firebase deploy --only functions`), targeted. No coupling
      to the half-1 rules deploy — they guard different collections (#27).

---

## Loose end this plan must not drop

**BIN-759** — BIN-752 recently wrote "never a licence to resync the pair" into both copies'
comments, which reads as contradicting a ticket that asks for exactly one controlled resync.
Under option (A) or (C) the wording is simply *correct* and BIN-759 can be closed as
not-a-conflict. Under (B) it must be rewritten in the same commit that tightens the server.

**#6's non-blocking observation, outside this ticket's scope:** `users/{uid}/watchlist/{itemId}`
(`firestore.rules:250`) has no doc-id format guard either — the alias class BIN-618 closed on
the read side has no write-side backstop there. Integrity/cost, not privacy. Worth a ticket;
not this one.
