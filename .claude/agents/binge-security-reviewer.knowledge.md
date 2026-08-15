# binge-security-reviewer — knowledge (principles)

**Edited IN PLACE.** Fold each lesson into the bullet it belongs; merge duplicates, supersede
contradictions, never append at the bottom. A bullet earns its place only by changing what a review does.
Dated record → `…archive.md` (append-only). Cap 30k — pay for new lessons by compressing old ones.

## Seed checklist
- **Public-read:** `reviews/**`,`lists`(isPublic),`usernames`,`sessions/**`,`reports`(create-only, never
  client-read). NEW public-read collection must be intentional+minimal.
- **Ownership:** every per-user read/write enforces `request.auth.uid` (`blocked`=hygiene, not boundary).
  `NEXT_PUBLIC_` secret = finding.

## How to prove a finding
- **Rules-trace = hypothesis — write a live PoC.** Throwaway `src/test/rules/_poc-*.test.ts` on the real
  `initializeTestEnvironment`/`withSecurityRulesDisabled` harness, `npm run test:rules`, delete before
  finishing; prove closure inverted. Port taken → `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run
  --config vitest.rules.config.ts`. Blocked = DERIVED.
- **Mutation-proof any fix whose test could pass for an unrelated reason:** neutralize ONLY the new clause,
  re-run — exactly the target test must fail; restore byte-identical (verify by hash). A `<= 1` range check
  once masked a broken ratchet (BIN-540). Tooling-blocked → restore anyway, label DERIVED. **A stale
  module-transform cache FABRICATES results either way — 3× now:** one mutation per `npx vitest run <file>
  --no-cache`, never a mutate/restore loop in one process, dump the mutated LINE in the same command. **A
  leftover mutation-harness file INSIDE `src/test/rules/`** corrupts every LATER run (BIN-624): `git status
  --porcelain` the test dir first, delete a stray `*mutant*`/`*_poc*` file.
- **A test title is not coverage** — an `it()` naming "rejects 0 → 1" actually asserted `5`. A mock with FEWER
  FIELDS than the real hook can't exercise what the missing one gates (a `useAuth` mock lacking `user` encodes
  ABSENT, not null). Deny tests whose rule `get()`s the writer's own profile must seed via
  `withSecurityRulesDisabled`, else they pass vacuously. A test reading its subject back through a SECOND
  validator proves nothing — assert the STORED bytes. **A DEFAULTED parameter added to a shared helper needs
  its own pin:** BIN-875's `extract` default went in while every fixture used `disabled:false`, under which
  both candidates agree — swapping the default stays green. Pin it with the ONE fixture that tells them apart.
- **A source-scanning guard test is itself an attestation — read its regex against the chokepoint's OWN
  idiom.** BIN-816's guard first detected WRITES: `doc\(\s*\w+\s*,` misses `kit.doc(kit.db,'users',uid)`,
  the style the sanctioned module itself uses, and requiring BOTH a 'ref' and a 'write' regex let a hoisted
  `const ref = doc(...)` through. What works: a **whitelist over the REFERENCE** (naming the doc at all
  fails; each exemption must also assert the guard call), every exemption still MATCHES, each ALTERNATION
  pinned by its own unit case (r4 — the `collection()` half was otherwise droppable green), and a fileset
  floor just under the real count (BIN-838). Residual: segment-form misses a template-literal path.
- **`hasOnly` bounds the KEY SET only** — never presence, never values. A merge-written field needs the entry
  AND a per-field bind; one unrecognized key rejects the ENTIRE write (BIN-349/93). A `hasOnly` field with no
  value bind is fine unbound if a SIBLING shipped field of identical shape (rendered only through an
  id→lookup table, never interpolated) is unbound too (BIN-814).
- **A "does an unrelated write survive on an already-contaminated doc" ratchet test must seed via
  `withSecurityRulesDisabled`** when mutation-testing the deployed rule — a live seed is rejected by the same
  `hasOnly` before the target line runs, so the scenario goes unexercised (VALUE ratchets like
  `vetoRemaining <=`).
- **`resource.data.get(k,D)` defends a MISSING key only.** A present-but-mistyped value (`isHost:'yes'`)
  returns as-is → equality type-errors → allow-expr fails → slot bricked (plantable DoS). Use
  `resource == null ? true : resource.data.get(k,D) is <T> ? <equality> : <heal to safe value>`, heal one-way.
- **A type-guard closes the JUNK-VALUE brick, not the MISSING-FIELD brick**, and left-hand
  `request.resource.data.k is T` asserts PRESENCE — so `is <type>` silently makes a field MANDATORY on that
  path. Enumerate every partial-update writer against the smallest real write; harden with `.get(k,D) is T` on
  the left. `updateDoc`'s `request.resource.data` is the MERGED doc, so an omitted pinned field inherits.
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
  forever; fix with `createdAt is timestamp && createdAt == request.time` (BIN-476→480). Same shape for an
  AGE-gated reaper on Auth `metadata.creationTime`: unparseable must return "leave alone".
- Exact-self-leave: `size()==resource.data.memberUids.size()-1` + `hasAll` + `!(request.auth.uid in
  request.resource.data.memberUids)` proves the caller removed only themself.
- Admin report-update rules pin `reporterUid`/`target*`/`reason`/`createdAt` by equality to `resource.data.*`.
  `usernames/{username}` has `allow create`, no `allow update`, so writing an existing doc default-denies —
  which also means a reservation's `uid` can only change via delete-then-create BY ITS OWNER, so a
  `where('uid','==',me)` query result stays delete-permitted (BIN-875).

## Anon/session identity and caller binding
- **A caller-agnostic "anon" branch that doesn't format-constrain the KEY it accepts lets anyone pre-claim a
  signed-in identity's future path.** BIN-509: `participants/{pid}` bound "is anon" to the doc's own
  `uid == null` and `pid` to nothing, so a planted `participants/{victim_uid}` forged a swipe SURVIVING the
  victim's real join (uids are one anonymous `usernames/*` read away). Fix at BOTH legs:
  `anonShapedPid(p) = p.size() == 32 && p.matches('^[0-9a-f]+$')` — disjoint from 28-char uids.
- **Don't conflate a new anon-identity attack with the accepted anon-vs-anon deviation** (ADR 0015 accepts
  anon-forging-anon; forging a SIGNED-IN identity's vote is a different class). **Scope a ratchet's promise
  honestly:** BIN-540's `vetoRemaining` caps the FIELD, not the ACT — `swipes` rules never read it.
- **Confirm a flag is genuinely cosmetic before rating its immutability gap** — grep whether any rule/function
  reads it for access. Cross-account write is structurally impossible when the target uid comes from the
  closed-over auth context or the doc PATH, never a parameter. Verify a format-guard fix three ways: live PoC;
  trace every legitimate writer; confirm the format from the generator, not a comment.

## GDPR export/delete completeness
- `collectUserDataSnapshots` auto-covers ONLY `users/{uid}/**` + a fixed collectionGroup list; every NEW
  top-level uid-keyed collection is wired manually. A doc-id that merely STARTS with uid is swept by
  NEITHER — restructure or add a queryable `uid`.
- **A THIRD shape escapes the subcollection-vs-admin-doc binary: a uid-keyed leaf under a NON-user parent** —
  `releaseNotifyState/{tmdbId}/notified/{uid}`, `reviews/{id}/likes/{uid}`, `usernames/{name}.uid`. Ask "does
  ANY doc identify a specific user, directly or by doc-id?" If yes: `uid` FIELD + CG sweep, or if retained,
  Art. 17(3) comment + policy entry + reaper.
- A new TOP-LEVEL GDPR-cascaded doc needs its own seeded live-emulator assertion in `account-deletion.test.ts`
  — the `KNOWN_USER_SUBCOLLECTIONS` loop misses it, and a mocked test proves wiring, not live erasure. The
  three-way set-equality guard (rules paths == const == helper `collection()` reads == `keyof
  UserDataSnapshots`, locked by `dataExport.coverage.test.ts`) is the structural defense (BIN-347) — and it is
  also what makes `snaps.profileSnap.ref` the right way to queue the profile delete, since a hand-built path
  is invisible to it.
- CG export queries need (a) a `uid` FIELD per doc — doc-id alone is unqueryable — and (b) an owner-scoped
  recursive-wildcard read rule (`match /{path=**}/likes/{id}`); nested per-doc rules don't cover CG.
  **Collector change needed?** New subcollection → yes; new field/doc-ID scheme on a covered subcollection →
  no; tab-local ephemeral state isn't a collection.
- A TTL reaper as sole erasure path needs a SYMBOLIC test (`MARKER_MAX_AGE_MS > functionalWindowMs`), not a
  hardcoded number. Plaintext join tokens get two layers: client cascade + Admin-SDK CG reaper (Art.17
  backstop for abandoned joins/Console-deleted accounts).
- **A read rule conditioned on more than plain membership (reciprocity `exists()`, roles, `isAdmin()`) can break
  the OWNER's own export/delete.** Split `read` into `get` + `list`: `get` gets an unconditional same-uid
  carve-out; `list` keeps the strict gate. Suites that always seed the actor's own doc MASK this (BIN-184).
- **Consent honesty:** `termsAcceptedAt`/`termsVersion`/`ageConfirmedAt` write only in `ensureUserProfile`'s
  `!snap.exists()` branch, justified by a comment naming ONE screen — **any sign-in call site outside that
  screen mints consent from a page that showed neither** (BIN-668), and an attestation is only as wide as its
  grep pattern (a handler passed by REFERENCE never matches `grep 'signIn()'`). Route to the notice-bearing
  screen; never backfill; enumerate ALL orderings on a write race (BIN-535). **An ABORTED erasure hits the
  same branch** — the profile is legitimately absent, so recreating it mints a consent record dated today for
  someone who asked to leave (BIN-816).

## Cross-account and cross-session leak classes
- **Invalidate a per-account cache/ref/mirror on the OWNER IDENTITY, never on the owned VALUE.** A value-keyed
  dep degrades to "never invalidates" on the empty/default state — the NEW-user state (BIN-592: an effect
  keyed `[source]` never re-ran between two users both at `undefined`). Tell: a hook whose doc-comment names
  an account scope but whose dep array holds only payload. Verify the key is the RIGHT identifier (`uid`, not
  the lagging `user.uid`) and CURRENT; SIGN-OUT resets A→null; SIBLINGS carry the class.
- **When a sign-out handler clears per-session refs, audit the reset SET — what it clears AND what it keeps.**
  A per-login retry latch MUST clear (BIN-617); a MONOTONIC epoch must NOT (a pre-sign-out run could
  re-qualify as `isCurrent()`); a per-TAB counter must not either, but key it `Map<uid,n>`. A uid-scoped
  DELETION marker must survive sign-out and only its render mirror reset (BIN-816).
- **A bare `await` on a client write against `persistentLocalCache` can HANG forever, not just fail.**
  `setDoc`/`updateDoc`/`deleteDoc` resolve only on server ACK; offline they never settle (BIN-844). Fix with
  `Promise.race` vs a short timeout, honest only if the abandoned write is truly DISCARDED (`terminate()`
  alone does not cancel pending writes; `clearIndexedDbPersistence()` after it does). READS differ:
  `getDocs`/`getDoc` fall back to CACHE rather than rejecting, so a `catch` fallback on a query is
  near-unreachable offline — don't rate it as the common path.
- **'A surface that is never rendered cannot write' is false for a tab that already rendered it.** BIN-816
  swaps `AppShell` for a limbo screen off a React flag set at deletion time; a SECOND tab never re-runs the
  profile load, so its flag stayed false — and the auto-writing providers (`WatchlistProvider`'s migrations)
  sit ABOVE the swapped shell anyway. `isOwner` never requires `users/{uid}` to exist, so those writes
  outlive the profile and no 'account without a profile' sweep can see them. When a render-level gate
  replaces write-site gates, check (a) it re-reads its SOURCE (the localStorage marker), not a state
  snapshot — a `storage` listener fires only in the OTHER tabs (`null` key = `clear()`), and an in-flight
  profile load's late `.then` writes a stale `false` over it unless that `.then` re-reads too — and (b) the
  WHOLE provider stack above it, effect by effect. **The marker's cross-device gap is NOT bounded by the
  server sweep, whatever the policy doc says** — a marker-less return recreates `users/{uid}` and hides that
  account from the sweep for good; ADR 0022/BIN-879 accepted this gap and fixed the overstating sentence in
  `orphans.ts`/`deletionMarker.ts`. A Console-only MANUAL erasure (RUNBOOK §5f) needs the same completeness
  bar: deleting `users/{uid}` doesn't cascade subcollections unless the operator confirms the prompt
  (`docs/moderation.md` has that line, §5f didn't).
- **Per-uid listener state that resets only inside `if (!uid)` leaks across a truthy→truthy uid switch**
  (shared device, no sign-out): `notesByTmdbId` keeps A's map until B's first snapshot. Reset unconditionally
  at the effect's TOP — and guard a cross-account MIGRATION effect with a ref set INSIDE the same synchronous
  snapshot callback that sets the state it reads. **The guard doesn't travel with the ref — check every call
  site sharing it** (BIN-598: shared `findItem()` read `itemsRef` but skipped the uid check, so a WRITE
  DECISION could fire on a foreign cached item).
- **A deny-list redaction on a doc with no `hasOnly` write-whitelist eventually leaks a newly-accreted field**
  (whole-doc reads; client redaction never stops a raw SDK/REST read). Fix: source → `allow read: if
  isOwner(uid)`; a top-level positive-whitelist projection (`publicProfiles/{uid}`) with `hasOnly` + per-field
  binds; visibility gated LIVE by a privileged `get()` on the SOURCE doc, never a mirrored flag; `isSignedIn()
  &&` before the friend-branch `exists()`; **audit EVERY client call site reading a FOREIGN `users/{uid}`
  BEFORE tightening** — rules-only is an outage.
- **Retiring a field you can't drop from `hasOnly`:** the `update` guard needs the three-way OR — absent/
  null/unchanged from `resource.data.get(k, null)`. Prefer a whitelist-copy helper over spread+delete.
- **A shared helper collapsing a three-way distinction into a two-way return re-opens the ghost-vs-private
  class** (`getPublicProfileCard` mapped both `!exists()` and permission-denied to `null`). Check
  `error.code === 'permission-denied'`; no error = "not opted in".

## Social-graph mirror-write trust boundaries
- Symmetric mirror writes must NEVER be gated by `isOwner(uid) || isOwner(targetUid)` alone — the second
  branch lets the doc SUBJECT write into the victim's namespace. Gate on proof of a prior relationship doc:
  `exists()` when the proof is deleted in the SAME batch; `existsAfter()` when created together (BIN-20).
  Rules gate KEYS, not field COMPLETENESS. A member-create rule's `get(group)` DOES see a doc written earlier
  in the batch.
- **A compensating/rollback write needs its own TOCTOU check — UNLESS the doc is provably unreachable by
  anyone else yet.** Could the mutated state have been VALIDLY re-established before the delayed rollback
  fires (a stalled join's late `arrayRemove` stripping a uid a completed rejoin added)? Then re-`getDoc`
  first. Not needed for a rollback DELETING a doc `addDoc`-minted in the SAME call (BIN-555) — and delete the
  whole doc, never `arrayRemove` the lone member (that orphans it from the owner's `array-contains` query).

## Server-only collections, public rollups, external input
- A top-level collection with NO rules block is default-denied — safe ONLY because this rules file has no
  `match /{document=**}` catch-all; re-verify on each approval (`*Budget`, `*State`, `sweepState` families). A
  MUTATE GATE (`sweepState/tmdbFieldsSweep.mutateEnabled`) is Console-only — dry-run-by-default is a data
  field, never a deploy flag.
- Public-read no-PII rollups (`streamingLeaving`, `recaps/**`, `priceHistory`, `streamingOffers`,
  `titleRatingsAggregate`): `allow read: if true; allow write: if false` at peer level, never widening an
  enclosing match block. External API ids used as URL path + lookup key get a strict format guard (Wikidata
  `/^Q\d+$/` + `encodeURIComponent()`); on fetch failure return null, never overwrite the prior doc.
- **Post-sign-in return path (BIN-645/669): the parse is never the residual — CARRIER + WRITE SITE are.**
  Parse guard: first char `/`, second neither `/` nor `\`, plus a control-char scan. `?next=` LEAVES the
  origin (the popup copies the URL to the auth handler); `sessionStorage` fixes that, but the write site can
  still express a query — `RETURN_QUERY_KEYS` allowlist on BOTH legs. A guard remembering the DEPARTING
  user's page across `signOut()` needs an `isSigningOut()` ref PREDICATE, not consume-once.
- **Consume-on-read makes the consuming effect NON-IDEMPOTENT** — a second run (StrictMode, extra identity
  change) reads null and falls back to default; gate with a ref latch set INSIDE the success branch, nothing
  between latch and navigate may throw. Read only AFTER auth resolves, and "resolved" needs TWO predicates:
  AuthContext nulls `user` on a profile-read reject, so gate on `uid` + the loading flag. A loading FLAG +
  nullable payload must distinguish "resolved-absent" from "not yet".
- Third-party `href`: reject unless `startsWith('https://')` (`safeHref`, `rel=noopener`). Prose renders as
  plain-text React children, never `dangerouslySetInnerHTML`; JSON-LD needs `.replace(/</g,'\\u003c')`. Free
  text with no `hasOnly` cap gets length-capped in the CONSUMING function before an FCM body.
- App Check is opt-in (reCAPTCHA v3, no-op without a site key — never assume enforcement). `request.app !=
  null` is the right v2 idiom but SOFT: only `enforceAppCheck: true` hard-rejects (BIN-361). v2 callables
  redirect to `*.run.app` — both belong in CSP `connect-src`. Rules can't count sibling writes in a
  writeBatch — use a server-authoritative `onCall` + per-uid cooldown in `runTransaction`.

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
  enforcement from design-intent (vendor spend is bounded by `reserveMotnSlot`'s transaction, not cadence).
  Never refund a reservation the vendor already counted.
- **"Claim in a transaction, work outside, release on failure" has a hard-timeout hole.** GCP force-kills a
  timed-out function with no `finally`, so a kill between claim and release sticks the flag for the cycle —
  bound the window under the platform timeout, or give the claim a LEASE timestamp. Transactions retry the
  callback, so `.add()` duplicates; use idempotent `.doc(id).set()`.
- **Don't GUESS which status a malformed path-param id draws.** BIN-856 assumed 400; live probes showed
  `movie/{NaN,'',abc,-1,0}` all 404 (bad RESOURCE) → `[]`, the SUCCESS path, never reaching the reject-governor.
  Real harm is a quieter **quota LEAK**: no `checkedAt` → immortal tier-0 item, re-picked every run. Fix is the
  same either way (filter before the id enters the work set) — verify live.

## Admin-SDK sweeps and scheduled writers
- **Admin SDK bypasses `firestore.rules` entirely — `hasOnly` offers ZERO protection against what a sweep
  writes.** The backstop is pure logic: a FRESH payload from a fixed allowlist, unit-tested for key-set
  equality + disjointness from `FORBIDDEN_FIELDS`. Whole-DB sweeps add a dry-run-by-default gate, cursor +
  budget, and an audit `lastRun` write every run.
- **`FieldValue.increment` is redundant once a transaction already reads the target doc for another reason**
  (a dedup `lastEventId` check) — OCC retries the WHOLE callback on conflict, so `read.value + delta` commits
  against the freshest value like increment would; it earns its keep only on an unread doc or a write OUTSIDE
  a transaction. Before dropping it: confirm no OTHER writer of the collection, add a `numberOr0`-style guard
  matching increment's own non-numeric→SET-to-delta behavior (not `NaN`-poison forever), and check the merged
  write payload is unchanged. Live-emulator-proved, mutation-caught: BIN-727 `communityRatings`.
- **An IRREVERSIBLE whole-population sweep needs a CEILING, the ceiling needs a FLOOR, and the REFUSAL needs
  an operator path.** 'A failed check means could-not-check' (BIN-848/816) covers ERRORS only; a
  SUCCESSFUL-but-wrong read (renamed collection, wrong db id, inverted predicate) makes every candidate
  legitimately absent and one run eats the population. Demand `MAX_PER_RUN` that deletes NOTHING when
  exceeded, on any sweep whose unit of destruction can't be restored. A purely PROPORTIONAL bound
  (`> 0.25*checked`) LATCHES — candidates shrink only by deletion, so the backlog disables the sweep for good
  (under 50 users, ONE orphan of three trips it, r3); require `> max(FLOOR, fraction*checked)` and pin the
  decisive SMALL case. **The floor BOUNDS the latch, it does not remove it** (r4) — above it the wedge is
  permanent and cheap to plant (one `signUp` mints a profile-less Auth account). Rate the REFUSAL itself: a
  RUNBOOK clear-by-hand entry, and any LEGAL doc claim ('deleted within 7 days') a runbook-only fix leaves
  false. **WHERE it lives:** the admin-free predicate module — extracting the predicate still leaves the CALL
  unpinned; ask for the filtered SET, not a boolean. Same ceiling on every sibling sweep; check each
  refusal's fail-safe DIRECTION (`absentUidsFromLookup` refuses `disabled:true` as absent — a suspended
  account still owns its handle).
- **A new privileged API call inside an existing function invalidates the post-deploy attestation scoped to
  the OLD permission.** BIN-848 verified only `firebaseauth.users.get`, claiming its sweep was "the only
  caller of an Auth user-management API"; BIN-816 added `listUsers` + `deleteUsers` (a DELETE permission). A
  missing runtime role makes the sweep inert with a green deploy — grep the attestation, name the new
  permission, add its log-line acceptance bar in the same commit.
- A shared `Set`/`Map` accumulator returned only at loop-end fails twice on a throw from unit K: K+1..M
  skipped, 1..K-1's writes discarded. try/catch-continue per unit, error-REPORTING callback gets its OWN
  nested try/catch (BIN-848). Three paths writing the same ambiguous '0/success' summary: give the outer
  `.catch()` a sentinel a legit run can't produce (`-1`, never `0`), require a second ATTEMPTED counter too.
- **collectionGroup matches by LEAF collection id regardless of parent path** — grep other writers/readers of
  that leaf name before trusting one (`collectionGroup('watchlist')` also matches `groups/{id}/watchlist/{id}`,
  safe only because those docs lack `status`). Append each page before the `size < PAGE_SIZE` break; uid comes
  from the doc PATH (`d.ref.parent.parent?.id`), never client content.
- Bare-tmdbId keying collides movie and TV: grouping keys, state doc ids, FCM `tag`s, inbox ids and action
  URLs all need `mediaTypeDocId`. Fixing one collection's keying bug → grep every OTHER collection keyed on
  the same bare id (BIN-523).
- A doc-id namespacing migration on a doc holding a MULTI-WRITER map needs a VALUE-level merge, never a
  document-level `??` fallback — the first post-cutover write creates a one-entry namespaced doc HIDING every
  pre-cutover entry (BIN-608 `swipes.votes`; pin a legacy-key test). A doc id is a trust boundary only if it
  appears in the allow-expression, and a FORM guard is not a VOLUME guard: BIN-624's `canonicalSwipeDocId`
  still permits `movie_1`…`movie_999999` (junk-doc cost, ADR 0015).
- **A LOOSE doc-id parser makes ALIASES collide in a last-write-wins Map** (`'movie_042'` took `movie_42`'s
  slot, BIN-618): the parser must be the writer's STRICT inverse.

## Deploy order (deploy.yml is hosting-only)
- Order is direction-dependent — decide it. Name a TARGETED command (`--only
  functions:availableNotify`), never a blanket `--only functions`. Rules/indexes go FIRST when new client code
  depends on them (a CG export query deployed before its rules makes export AND deletion throw for everyone);
  AFTER hosting when a new constraint would deny writes from the OLD still-running client (BIN-540).
- **`deploy.yml`'s rules/functions drift guard runs FIRST with no `continue-on-error`** — a commit touching
  `functions/**` fails the job before the hosting step, so prod runs the PARENT commit for BOTH surfaces.

## Review scope, premises and attestations
- **An attestation is a load-bearing claim — verify it like code**, in a comment, a JSDoc, a `tasks/todo.md`
  note, a policy doc or your own last marker. A false safety comment is WORSE than none: it says the audit
  happened (BIN-523's "the scan filters mediaType"). **A REDESIGN orphans comments** — grep the REMOVED
  mechanism's name across the diff's files. **A "line-endings only" claim needs BYTE ACCOUNTING:**
  `--ignore-cr-at-eol` ignores a TRAILING CR but not a LONE one (content).
- **Challenge a dispatching prompt's premise, and scope a RE-review by SHA.** "NEVER had a security review",
  "everything else is as you last saw it" and "only file X moved" have each been false; the brief's file list
  is a hint, never the boundary. **Sha equality proves the BYTES held, not that their CLAIMS do** — a
  byte-identical module's doc comment is falsifiable by a change elsewhere in the diff. An unchanged file the
  diff depends on is exempt from re-reading, never from re-derivation.
- **When a diff's ticket matches a gap NAMED in a prior entry, re-grep to confirm FULL closure** — a targeted
  fix routinely leaves an identical-pattern sibling unfixed. A ticket AC promising 'a new test proves X' with
  no test file in the diff is itself the finding; same for an ADR's Consequences saying a field 'will be
  added to `hasOnly()`'. **On a RE-review, MUTATE each accepted fix — never grep for it.** BIN-816 r3: the
  one-line re-read that closed the round-1 Art. 17 hole sat in a file with 64 passing tests, sixteen named
  for that ticket, and neutering the clause left 64/64 green. A named test block is not a pin, and a fix
  nothing pins is one refactor from silently gone. Mutate the WIRING too, not only the predicate a fix
  extracted into a testable module. **Reproduce the author's own mutation count — it is a claim** (r4:
  'reddens exactly 1 of 66' was 2). When every round shares ONE staged blob there is no per-round diff:
  mtime-sort `git diff --cached --name-only` for the real delta — r4's brief named five files, eight moved.
- **Shared-checkout hazard: a sibling's mutation loop can land INSIDE your window** — 4× now — so a clean
  `git status` is NOT proof; re-`Read`/re-run twice, identical required. **Review target is the STAGED blob**
  — `Read` serves the worktree; align `git show :<path> | md5sum` with `md5sum <path>` first (BIN-856 r2).
- **Reviewing a FORWARD-REVERT:** prove exactness (`git diff <base> -- <files>` EMPTY); baseline = what is
  DEPLOYED. Next.js server-runtime advisories are neutral under `output: 'export'`.

## Archive
Write it every review, dated. Grep it for a familiar finding, a past PoC, or an over-compressed principle.
