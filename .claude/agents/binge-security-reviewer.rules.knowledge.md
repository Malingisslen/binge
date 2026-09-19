# binge-security-reviewer — rules chapter

Read only when the staged diff touches this chapter's paths (see .claude/shared-plugin.json → knowledge.tiers).

## How to prove a finding
- **Rules-trace = hypothesis — write a live PoC.** Throwaway `src/test/rules/_poc-*.test.ts` on the real
  `initializeTestEnvironment`/`withSecurityRulesDisabled` harness, `npm run test:rules`, delete before
  finishing; prove closure inverted. Port taken → custom `firebase.json`-alike passed via `--config` with
  a free port (8080 often held by a sibling session), or `FIRESTORE_EMULATOR_HOST=localhost:<port> npx
  vitest run --config vitest.rules.config.ts`. Blocked = DERIVED. **This applies to a "self-heals across
  the rules boundary" claim too, not only a denial hypothesis:** a mock-SDK unit test (`groups.test.ts`
  style, `vi.fn()` stand-ins for `setDoc`/`updateDoc`) proves the CALL SHAPE only and enforces nothing —
  BIN-1063's "ghost member (uid in memberUids, no member doc) heals on retry" passed a mocked
  `expect(result).toEqual({ok:true})` while live `firestore.rules` denies the underlying
  `updateDoc(group, {memberUids: arrayUnion(existingUid)})` for every non-owner already-a-member uid
  — PoC'd both bare and with a live `joinAttempts` doc, both `assertFails`. Net
  effect was not exploitable (fails closed).
  Any JS-level fall-through/retry claim that crosses into Firestore write semantics
  needs the SAME live-PoC treatment as a denial hypothesis, not just a mocked assertion.
- **Mutation-proof any fix whose test could pass for an unrelated reason:** neutralize ONLY the new clause,
  re-run — exactly the target test must fail; restore byte-identical (verify by hash). A `<= 1` range check
  once masked a broken ratchet (BIN-540). Tooling-blocked → restore anyway, label DERIVED. **A stale
  module-transform cache FABRICATES results either way — 3× now:** one mutation per `npx vitest run <file>
  --no-cache`, never a mutate/restore loop in one process, dump the mutated LINE in the same command. A
  leftover mutation-harness file INSIDE `src/test/rules/` corrupts every LATER run (BIN-624): `git status
  --porcelain` the test dir first, delete a stray `*mutant*`/`*_poc*` file. **A reported "exactly N red" is
  checkable WITHOUT re-running, so check it: `grep -l` which suites actually load `firestore.rules`,
  then scan only those for the fixture shape the mutant moves.** BIN-797's `*`→`+` looked like a dozen reds;
  all but two of those fixtures sit in an OPEN_RULES suite, so the reported 2 was right.
  **When the brief FREEZES the tree you cannot mutate — so
  DERIVE the count rather than accept or waive it:** walk every fixture in the affected `describe`
  and ask which VERDICT the mutant moves, `assertSucceeds` and `assertFails` alike. BIN-1063 r2's
  "`== targetUid` → `== request.auth.uid` fails 2" reproduced this way, and the two are not the pair
  a reader guesses — one is the disagreeing-uid DENY, the other the legit accept's OWNER-side write,
  which the substitution flips into a denial. A count unreachable by that walk is itself the finding.
- **`hasOnly` bounds the KEY SET only** — never presence, never values. A merge-written field needs the entry
  AND a per-field bind; one unrecognized key rejects the ENTIRE write (BIN-349/93). A `hasOnly` field with no
  value bind is fine unbound if a SIBLING shipped field of identical shape (rendered only through an
  id→lookup table, never interpolated) is unbound too (BIN-814).
- **A "does an unrelated write survive on an already-contaminated doc" ratchet test must seed via
  `withSecurityRulesDisabled`** — a live seed is rejected by the same `hasOnly` before the target line runs.
  Same for any GRANDFATHERED shape a tightened create rule now refuses.
- **`resource.data.get(k,D)` defends a MISSING key only.** A present-but-mistyped value (`isHost:'yes'`)
  returns as-is → equality type-errors → allow-expr fails → slot bricked (plantable DoS). Use
  `resource == null ? true : resource.data.get(k,D) is <T> ? <equality> : <heal to safe value>`, heal one-way.
  That type-guard closes the JUNK-VALUE brick, not the MISSING-FIELD one; and left-hand
  `request.resource.data.k is T` asserts PRESENCE, so `is <type>` silently makes a field MANDATORY on that
  path — harden with `.get(k,D) is T` on the left and enumerate every partial-update writer against the
  smallest real write. `updateDoc`'s `request.resource.data` is the MERGED doc, so an omitted pin inherits.
- **A range bound is not a ratchet.** `is int && >=0 && <=1` stops "set it absurd", not "reset after spending
  down". Use `v <= (resource == null || !(resource.data.get('v',1) is int) ? 1 : resource.data.get('v',1))`.
  **Tell:** an ADR saying "budget"/"cap"/"once per X" with one field ratcheted, its neighbour not.
- **Pin an existing field with the REQUEST-doc idiom**
  `!('x' in request.resource.data) || request.resource.data.x == resource.data.get('x', null)`; the stored-doc
  idiom short-circuits TRUE on legacy docs missing the field — forgeable (BIN-276/365). An UNGUARDED equality
  is STRICTER (missing → error → DENY): guard only when omission should pass (BIN-357). A pin can also block
  the LEGITIMATE flow (BIN-276's `inviteTokenHash` pin broke rotation while 100 tests passed) — trace every
  legitimate client mutation of a pinned field.
- **A client-writable timestamp a server reads as "fresh → skip action" needs `<= request.time`, not just
  `is timestamp`** — else `Timestamp.fromMillis(futureMs)` defeats the sweep forever. `serverTimestamp()`
  resolves to exactly `request.time` (`<=`, not `<`); promoting an unvalidated field to this ratchet makes any
  legacy doc holding a FUTURE value fail ALL later merge-writes (`is timestamp` does NOT reject a JS `Date`).
- **A reaper's "undateable = kept forever" restraint is safe only if the CREATE rule makes the date
  mandatory.** `hasOnly(['token','createdAt'])` requires neither key — `setDoc({token})` skips the reaper
  forever; fix with `createdAt is timestamp && createdAt == request.time` (BIN-476→480).
- Exact-self-leave: `size()==old.size()-1` + `hasAll` + `!(auth.uid in new)` = removed only themself.
- **A shrink-only guard on ONE branch says nothing about the GROWTH branches on the same array field** — each
  direction needs its own containment check. `groups/{id}`'s token-join and invite-accept branches bounded only
  `!(uid in old) && uid in new && size() <= 100` (plus the identity/token pins); nothing related the REST of
  `new` to `old`, so a caller holding a valid join token or invite could write `memberUids: [self]` and evict
  every existing member including the owner — reachable by a THIRD PARTY, not just the account whose own
  write it is. FOUND IN REVIEW, BIN-1125; **CLOSED 2026-09-09** on both branches. BIN-1108 had hardened the
  adjacent owner and leave branches against the OWNER freezing themselves out, and that fix neither touched
  nor worsened this growth-side hole — check every OTHER branch touching the same array field for the
  mirror-image gap before calling a shrink-only fix complete.
- **`old.hasAll(new.removeAll([addedUid]))` is NOT a sound containment check, and it was the recommended form
  here until 2026-09-09.** A DUPLICATE defeats it: `new = [self, self]` against `old = [owner]` satisfies it
  — `removeAll` strips both copies and `hasAll([])` is true — while the size clause reads `2 == 1 + 1` and the
  owner is written out. The form that holds is the containment stated forwards, `new.hasAll(old)`, paired with
  an exact `new.size() == old.size() + 1`; read the pair together, since `hasAll` alone admits a stranger
  added alongside the joiner and the size alone admits the duplicate. Pinned on both branches by the tests
  named `a joiner cannot use a duplicate of themselves to pad the size` and its invitee twin.

## Anon/session identity and caller binding
- **A caller-agnostic "anon" branch that doesn't format-constrain the KEY it accepts lets anyone pre-claim a
  signed-in identity's future path.** BIN-509: `participants/{pid}` bound "is anon" to the doc's own
  `uid == null` and `pid` to nothing, so a planted `participants/{victim_uid}` forged a swipe SURVIVING the
  victim's real join (uids are one anonymous `usernames/*` read away). Fix at BOTH legs:
  `anonShapedPid(p) = p.size() == 32 && p.matches('^[0-9a-f]+$')` — disjoint from 28-char uids.
- **Don't conflate a new anon-identity attack with the accepted anon-vs-anon deviation** (ADR 0015 accepts
  anon-forging-anon; forging a SIGNED-IN identity's vote is a different class). **Scope a ratchet's promise
  honestly:** BIN-540's `vetoRemaining` caps the FIELD, not the ACT — `swipes` rules never read it.

## Cross-account and cross-session leak classes
- **Retiring a field you can't drop from `hasOnly`:** the `update` guard needs the three-way OR — absent/
  null/unchanged from `resource.data.get(k, null)`. Prefer a whitelist-copy helper over spread+delete.

## Social-graph mirror-write trust boundaries
- Symmetric mirror writes must NEVER be gated by `isOwner(uid) || isOwner(targetUid)` alone — the second
  branch lets the doc SUBJECT write into the victim's namespace. Gate on proof of a prior relationship doc:
  `exists()` when the proof is deleted in the SAME batch; `existsAfter()` when created together (BIN-20).
  Rules gate KEYS, not field COMPLETENESS. A member-create rule's `get(group)` DOES see a doc written earlier
  in the batch.

## Server-only collections, public rollups, external input
- A top-level collection with NO rules block is default-denied — safe ONLY because this file has no
  `match /{document=**}` catch-all; re-verify on each approval (`*Budget`, `*State`, `sweepState`). A MUTATE
  GATE (`sweepState/tmdbFieldsSweep.mutateEnabled`) is Console-only — dry-run-by-default is a data field,
  never a deploy flag.
- Public-read no-PII rollups (`streamingLeaving`, `recaps/**`, `priceHistory`, `streamingOffers`,
  `titleRatingsAggregate`): `allow read: if true; allow write: if false` at peer level, never widening an
  enclosing match block. External API ids used as URL path + lookup key get a strict format guard (Wikidata
  `/^Q\d+$/` + `encodeURIComponent()`); on fetch failure return null, never overwrite the prior doc.

## Admin-SDK sweeps and scheduled writers
- **A LOOSE doc-id parser makes ALIASES collide in a last-write-wins Map** (`'movie_042'` took `movie_42`'s
  slot, BIN-618): the parser must be the writer's STRICT inverse. A STRICT parser still aliases two DIFFERENT
  ids when the create rule's digit group has no LENGTH cap — unbounded `[1-9][0-9]*` + `Number(digits)` loses
  precision past 2^53, so two huge id strings round to one float and canonicalise onto one doc (BIN-766) —
  same junk-doc cost class as the volume residual above.
  **Narrowing such a regex is safe only if it is create-ONLY and a strict SUBSET:** BIN-797 dropped `_0`
  (`^(movie|tv)_(0|[1-9][0-9]*)$`→`^(movie|tv)_[1-9][0-9]*$`) in BOTH copies. (a) new
  language ⊆ old, char by char (a botched DEgrouping, `_0|[1-9][0-9]*`, binds alternation at top level and
  goes WIDER); (b) no guard reference under `allow read/update/delete`, or a grandfathered doc is un-erasable
  (Art. 17). Export/erasure stay whole only because they carry
  `d.id`/`d.ref` from the snapshot and never re-derive an id — pin BOTH, live.

## Deploy order (deploy.yml is hosting-only)
- Order is direction-dependent — decide it. Name a TARGETED command (`--only
  functions:availableNotify`), never a blanket `--only functions`. Rules/indexes go FIRST when new client code
  depends on them (a CG export query deployed before its rules makes export AND deletion throw for everyone);
  AFTER hosting when a new constraint would deny writes from the OLD still-running client (BIN-540).
