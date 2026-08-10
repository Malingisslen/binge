# binge-security-reviewer — knowledge (principles)

**Edited IN PLACE.** Fold each lesson into the bullet it belongs to; merge duplicates, supersede
contradictions, never append at the bottom. A bullet earns its place only by changing what a review DOES.
Dated record → `…knowledge.archive.md` (append-only). Cap 30k — a new lesson pays by compressing an old one.

## Seed checklist
- **Public-read:** `reviews/**`, `lists` (isPublic), `usernames`, `sessions/**`, `reports` (create-only, never
  client-read). A NEW public-read collection must be intentional + minimal.
- **Ownership:** every per-user read/write enforces `request.auth.uid` (`users/{uid}/blocked` = hygiene, not a
  boundary). A secret in `NEXT_PUBLIC_` is a finding.

## How to prove a finding
- **Rules-trace = hypothesis — write a live PoC.** Throwaway `src/test/rules/_poc-*.test.ts` on the real
  `initializeTestEnvironment`/`unauthenticatedContext`/`withSecurityRulesDisabled` harness, `npm run
  test:rules`, delete before finishing; prove closure inverted. Port taken →
  `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run --config vitest.rules.config.ts`. Blocked → DERIVED.
- **Mutation-proof any fix whose test could pass for an unrelated reason:** neutralize ONLY the new clause,
  re-run — exactly the target test must fail; restore byte-identical (verify by hash). A `<= 1` range check
  once masked a broken ratchet (BIN-540). Tooling-blocked → restore anyway, label DERIVED.
  **A stale module-transform cache FABRICATES results either way — three times now** (latest: BIN-636's
  untouched client regex read as accepting `movie_042`): one mutation per `npx vitest run <file> --no-cache`,
  `rm -rf node_modules/.vite/vitest` between runs, never a mutate/restore loop in one process, dump the
  mutated LINE in the same command; one clear-then-rerun doesn't earn trust either — re-run before trusting
  EITHER verdict. **A leftover mutation-harness file INSIDE `src/test/rules/` (not scratchpad) corrupts every
  LATER run**: BIN-624's stray `__bin624_mutant.test.ts` sat untracked there, globbed into `npm run
  test:rules`, reporting 474/10-failed against a real 244/244. `git status --porcelain` the test dir before
  trusting any count; delete a stray `*mutant*`/`*_poc*` file there before believing the suite.
- **A test title is not coverage** — an `it()` naming "rejects 0 → 1" actually asserted `5`. A mock with FEWER
  FIELDS than the real hook can't exercise what the missing one gates (a `useAuth` mock lacking `user` encodes
  ABSENT, not null). Deny tests whose rule `get()`s the writer's own profile must seed via
  `withSecurityRulesDisabled`, else they pass vacuously. A test reading its subject back through a SECOND
  validator proves nothing — assert the STORED bytes, or the writer's guard can be deleted and the reader
  covers for it.

## Firestore rules — presence/type/pins/ratchets
- **`hasOnly` bounds the KEY SET only** — never presence, never values. A merge-written field needs the entry
  AND a per-field bind; one unrecognized key rejects the ENTIRE write (BIN-349/93). A `hasOnly` field with NO
  value bind (a bare `number[]`, e.g. `providers`) is fine to leave unbound if a SIBLING already-shipped field
  of the identical shape/consumption (rendered only through an id→lookup table, never interpolated/executed)
  is unbound too — don't demand a new bind an existing analogous field never got (BIN-814 `subscriptionProviders`
  next to `providers`).
- **A "does an unrelated write survive on an already-contaminated doc" ratchet test must seed via
  `withSecurityRulesDisabled`, not a live write, when mutation-testing by editing the deployed rule itself** —
  a live seed under the mutated ruleset gets rejected by the same `hasOnly` before the target line runs, so the
  mutation is still caught but the seeded scenario goes unexercised. Harmless for a pure `hasOnly` guard; a
  live false-negative gap for a VALUE ratchet whose behavior depends on prior state (`vetoRemaining <=`,
  `tmdbFieldsRefreshedAt <= request.time`). Tighten before reusing as a VALUE-ratchet template.
- **`resource.data.get(k,D)` defends a MISSING key only.** A present-but-mistyped value (`isHost:'yes'`)
  returns as-is → equality type-errors → allow-expr fails → slot bricked (plantable DoS). Use
  `resource == null ? true : resource.data.get(k,D) is <T> ? <equality> : <heal to safe value>`, heal one-way.
- **A type-guard closes the JUNK-VALUE brick, not the MISSING-FIELD brick**, and left-hand
  `request.resource.data.k is T` asserts PRESENCE — so `is <type>` silently makes a field MANDATORY on that
  path. Enumerate every partial-update writer against the smallest real write (a heartbeat, not the test's),
  hunt for a `setDoc(...,{merge:true})` hardcoding the field's INITIAL value, harden with `.get(k,D) is T` on
  the left. `updateDoc`'s `request.resource.data` is the MERGED doc, so a pinned field omitted inherits and
  passes.
- **A range bound is not a ratchet.** `is int && >=0 && <=1` stops "set it absurd", not "reset after spending
  down" (live-confirmed 0→1 veto re-grant). Use
  `v <= (resource == null || !(resource.data.get('v',1) is int) ? 1 : resource.data.get('v',1))`. **Tells:** an
  ADR saying "budget"/"cap"/"once per X"; one field ratcheted, its neighbour not.
- **Pin an existing field with the REQUEST-doc idiom**
  `!('x' in request.resource.data) || request.resource.data.x == resource.data.get('x', null)`; the stored-doc
  idiom short-circuits TRUE on legacy docs missing the field — forgeable (BIN-276/365). An UNGUARDED equality
  is STRICTER (missing → error → DENY): guard only when omission should pass (BIN-357). A pin can also block
  the LEGITIMATE flow (BIN-276's `inviteTokenHash` pin broke token rotation while 100 tests passed) — trace
  every legitimate client mutation of a pinned field.
- **A client-writable timestamp a server reads as "fresh → skip action" needs `<= request.time`, not just
  `is timestamp`** — else `Timestamp.fromMillis(futureMs)` defeats the sweep forever. `serverTimestamp()`
  resolves to exactly `request.time` (`<=`, not `<`), so every honest writer must use the sentinel; promoting
  an unvalidated field to this ratchet makes any legacy doc holding a FUTURE value fail ALL later merge-writes
  (`is timestamp` does NOT reject a JS `Date`). A "re-stamp without rewriting data" path must re-verify against
  the authoritative source in the SAME call.
- **A reaper's "undateable = kept forever" restraint is safe only if the CREATE rule makes the date
  mandatory.** `hasOnly(['token','createdAt'])` requires neither key — `setDoc({token})` skips the reaper
  forever; fix with `createdAt is timestamp && createdAt == request.time` (BIN-476→480).
- Exact-self-leave: `size() == resource.data.memberUids.size() - 1` + `hasAll` + `!(request.auth.uid in
  request.resource.data.memberUids)` proves the caller removed themself.
- Admin report-update rules pin `reporterUid`/`target*`/`reason`/`createdAt` by equality to `resource.data.*`
  — fires even when new fields ride along. `usernames/{username}` has `allow create`, no `allow update`, so
  writing an existing doc is an `update` → default-denied, closing the availability TOCTOU.
  `collectionGroup(...).orderBy('__name__')` needs a `COLLECTION_GROUP` index — standing accepted gap.

## Anon/session identity and caller binding
- **A caller-agnostic "anon" branch that doesn't format-constrain the KEY it accepts lets anyone pre-claim a
  signed-in identity's future path.** BIN-509: `participants/{pid}` bound "is anon" to the doc's own
  `uid == null` and `pid` to nothing, so a planted `participants/{victim_uid}` forged a swipe SURVIVING the
  victim's real join (victim uids are one anonymous `usernames/{username}` read away). Fix at BOTH legs, zero
  read cost: `anonShapedPid(p) = p.size() == 32 && p.matches('^[0-9a-f]+$')` — disjoint from 28-char uids.
- **Don't conflate a new anon-identity attack with the accepted anon-vs-anon deviation** (ADR 0015 accepts one
  anon link-holder forging ANOTHER anon participant's vote; forging what becomes a SIGNED-IN identity's vote
  is a different class). **Scope a ratchet's promise honestly:** BIN-540's `vetoRemaining` caps the FIELD, not
  the ACT — the `swipes` rules never read it, so the one-veto cap is UI-only, and nothing caps an anon
  link-holder minting fresh slots (BIN-624 form-guards the doc id, not the count — see Admin-SDK section).
- **Confirm a flag is genuinely cosmetic before rating its immutability gap** — grep whether any rule/function
  reads it for access (participant `delete` gates on `hostUid == request.auth.uid`, not `participant.isHost`).
  Cross-account write is structurally impossible when the target uid comes from the closed-over auth context or
  the doc PATH, never a parameter. Verify a format-guard fix three ways: live PoC; trace every legitimate writer
  for false positives; confirm the format from the generator, not a comment.

## GDPR export/delete completeness
- `collectUserDataSnapshots` auto-covers ONLY `users/{uid}/**` + a fixed collectionGroup list; every NEW
  top-level uid-keyed collection is wired manually. A doc-id that merely STARTS with uid is swept by
  NEITHER — restructure or add a queryable `uid`.
- **A THIRD shape escapes the subcollection-vs-admin-doc binary: a uid-keyed leaf under a NON-user parent** —
  `releaseNotifyState/{tmdbId}/notified/{uid}`, `reviews/{id}/likes/{uid}`. Ask not "is the PARENT
  user-owned" but **"does ANY doc identify a specific user, directly or via doc-id?"** If yes: a `uid` FIELD +
  a CG sweep in the cascade, or — if retention is intended — Art. 17(3) comment + policy entry + TTL reaper.
- A new TOP-LEVEL GDPR-cascaded doc needs its own seeded live-emulator assertion in `account-deletion.test.ts`
  — the `KNOWN_USER_SUBCOLLECTIONS` loop misses it, and a mocked test proves wiring, not live erasure. The
  three-way set-equality guard (rules paths == const == helper `collection()` reads == `keyof
  UserDataSnapshots`, locked by `dataExport.coverage.test.ts`) is the structural defense (BIN-347).
- CG export queries (`likes`/`comments`/`reactions`) need (a) a `uid` FIELD per doc — doc-id alone is
  unqueryable, so backfill — and (b) an owner-scoped recursive-wildcard read rule (`match /{path=**}/likes/{id}
  { allow read: if isSignedIn() && resource.data.uid == request.auth.uid; }`); nested per-doc rules don't
  cover CG. **Collector change needed?** New subcollection → yes; new FIELD on covered doc → no; new doc-ID
  SCHEME in a covered subcollection → no (`getDocs` is doc-id-agnostic); tab-local ephemeral state isn't a
  collection.
- A TTL reaper as sole erasure path needs a SYMBOLIC test (`MARKER_MAX_AGE_MS > functionalWindowMs`), not a
  hardcoded number. Plaintext join tokens get two layers: client cascade + Admin-SDK CG reaper (Art. 17
  backstop for abandoned joins/Console-deleted accounts).
- **A read rule conditioned on more than plain membership (reciprocity `exists()`, roles, `isAdmin()`) can break
  the OWNER's own export/delete.** Split `read` into `get` + `list`: `get` gets an unconditional same-uid
  carve-out; `list` keeps the strict gate. Suites that always seed the actor's own doc MASK this (BIN-184).
- **Consent honesty:** `termsAcceptedAt`/`termsVersion`/`ageConfirmedAt` write only in `ensureUserProfile`'s
  `!snap.exists()` branch, justified by a comment naming ONE screen — **any sign-in call site outside that
  screen mints consent from a page that showed neither** (BIN-668: `onClick={signIn}` in two other components).
  An attestation is only as wide as its grep pattern — a handler passed by REFERENCE never matches `grep
  'signIn()'`; grep the BARE identifier. Fix by routing to the notice-bearing screen, rendered UNCONDITIONALLY;
  never backfill phantom consent; enumerate ALL orderings on a consent-bearing write race (BIN-535).

## Cross-account and cross-session leak classes
- **Invalidate a per-account cache/ref/mirror on the OWNER IDENTITY, never on the owned VALUE.** A value-keyed
  dep degrades to "never invalidates" on the empty/default state — the NEW-user state, likeliest to matter and
  least tested (BIN-592: an effect keyed `[source]` never re-ran between two users both at `undefined`, so A's
  price map survived into B's first profile write). Tell: a hook whose doc-comment names an account scope but
  whose dep array holds only payload. Verify: the key is the RIGHT identifier (`uid`, not the lagging
  `user.uid`) and CURRENT (a LAYOUT effect); SIGN-OUT resets A→null; SIBLINGS carry the class.
- **When a sign-out handler clears per-session refs, audit the reset SET — what it clears AND what it keeps.**
  A per-login retry latch MUST clear (BIN-617, else a same-uid sign-out/in inherits the spent latch); a
  MONOTONIC epoch must NOT (a pre-sign-out run could re-qualify as `isCurrent()`); a per-TAB counter must not
  either, but key it `Map<uid,n>` — else it's shared across every account in that tab.
- **A bare `await` on a client write against `persistentLocalCache` can HANG forever, not just fail.**
  `setDoc`/`updateDoc`/`deleteDoc` resolve only on server ACK; offline they never settle (missed on BIN-844's
  `disablePushForUser` inside `signOut` — could hang sign-out forever on a shared device, worse than the leak
  the ticket closed). Fix with `Promise.race` vs a short timeout, honest only if the abandoned write is truly
  DISCARDED: `terminate()` alone does NOT cancel pending writes, only `terminate()`-then-
  `clearIndexedDbPersistence()` (this repo's `clearFirestorePersistence`) does. Any destructive/blocking flow
  firing a write before its point of no return needs this race, not a bare await.
- **Per-uid listener state that resets only inside `if (!uid)` leaks across a truthy→truthy uid switch**
  (shared device, no sign-out): `notesByTmdbId` keeps A's map until B's first snapshot, so a shared tmdbId
  shows A's note under B's title. Reset unconditionally at the effect's TOP — and guard a cross-account
  MIGRATION effect with a ref set INSIDE the same synchronous snapshot callback that sets the state it reads
  (`itemsUidRef.current = uid` alongside `setItems`), so a passing guard proves read source and write
  destination are the same account. **The guard doesn't travel with the ref — check every call site sharing
  it, not just effects with one already** (BIN-598's shared `findItem()` read the same `itemsRef` but skipped
  the `itemsUidRef` check: WRITE PATH is closure-bound/safe, but a WRITE DECISION read off the shared ref can
  fire on a FOREIGN account's cached item after a same-device switch). **FIXED + mutation-verified
  (2026-08-04):** `findItem` returns `undefined` when `itemsUidRef.current !== uid`.
- **A deny-list redaction on a doc with no `hasOnly` write-whitelist eventually leaks a newly-accreted field**
  (whole-doc reads; client redaction never stops a raw SDK/REST read). Fix: (1) source → `allow read: if
  isOwner(uid)`; (2) top-level positive-whitelist projection (`publicProfiles/{uid}`), `hasOnly` PLUS
  per-field binds; (3) gate visibility LIVE via a privileged `get()` on the SOURCE doc, never a mirrored flag;
  (4) `isSignedIn() &&` before the friend-branch `exists()`; (5) **audit EVERY client call site reading a
  FOREIGN `users/{uid}` BEFORE tightening** — rules-only is an outage.
- **Retiring a field you can't drop from `hasOnly`:** the `update` guard needs the three-way OR — absent /
  null / unchanged from `resource.data.get(k, null)`; null-guarding `create` alone breaks every ordinary edit
  on a legacy doc. Prefer a whitelist-copy helper over spread+delete (a removed TYPE is not a runtime strip).
- **A shared helper collapsing a three-way distinction into a two-way return re-opens the ghost-vs-private
  class** (`getPublicProfileCard` mapped both `!exists()` and permission-denied to `null`, so private users
  vanished from the follow list). One anonymous fallback row for both IS the fix. Check
  `error.code === 'permission-denied'`; no error means "not opted in".

## Social-graph mirror-write trust boundaries
- Symmetric mirror writes must NEVER be gated by `isOwner(uid) || isOwner(targetUid)` alone — the second
  branch lets the doc SUBJECT write into the victim's namespace. Gate on proof of a prior relationship doc:
  `exists()` when the proof is deleted in the SAME batch; `existsAfter()` when created together (BIN-20).
  Rules gate KEYS, not field COMPLETENESS — a client omitting `followedAt` reads as "old" in reclaim sweeps. A
  member-create rule's `get(group)` DOES see a doc written earlier in the batch.
- **A compensating/rollback write needs its own TOCTOU check — UNLESS the doc is provably unreachable by
  anyone else yet.** Ask whether the mutated state could have been independently, VALIDLY re-established
  before the delayed rollback fires (a stalled join's late `arrayRemove` strips a uid a completed rejoin
  added); fix: re-`getDoc` first. No re-check needed for a rollback that DELETES a doc `addDoc`-minted in the
  SAME call before its id/token left the function (BIN-555 createGroup: no invite token handed out yet) —
  delete-the-whole-doc, not `arrayRemove` the lone member, is also the right SHAPE there: `arrayRemove` would
  leave an ownerless orphan hidden from the owner's own `array-contains` query.

## Server-only collections, public rollups, external input
- A top-level collection with NO rules block is default-denied — safe ONLY because this rules file has no
  `match /{document=**}` catch-all; re-verify on each approval (`*Budget`, `*State`, `sweepState` families). A
  MUTATE GATE (`sweepState/tmdbFieldsSweep.mutateEnabled`) is Console-only — dry-run-by-default is a data
  field, never a deploy flag.
- Public-read no-PII rollups (`streamingLeaving`, `recaps/**`, `priceHistory`, `streamingOffers`,
  `titleRatingsAggregate`): `allow read: if true; allow write: if false` at peer level, never widening an
  enclosing match block; single-segment wildcards cover new doc-id schemes. External API ids used as URL path
  + lookup key get a strict format guard (Wikidata `/^Q\d+$/` + `encodeURIComponent()`); external maps consume
  only strictly-parsed fields (`(movie|tv)/<positive int>`); on fetch failure return null, never overwrite the
  prior doc.
- **Post-sign-in return path (BIN-645): the parse is never the residual — CARRIER + WRITE SITE are.** Parse
  guard: first char `/`, second neither `/` nor `\`, plus a control-char scan. A `?next=` QUERY both LEAVES
  the origin (Firebase's popup copies the URL to the auth handler) and is ATTACKER-SUPPLIED (`?invite=`
  auto-joins on mount); `sessionStorage` fixes both, but the WRITE SITE can still express a query — hence a
  `RETURN_QUERY_KEYS` allowlist on BOTH legs. The PATH half can't be allowlisted (it IS the feature);
  "onboarding OUTRANKS the stored path" holds only once the profile LOADED.
  **BIN-669 (a route guard remembering the DEPARTING user's page across `signOut()`, which never navigates):**
  fix = `isSigningOut()` ref-backed PREDICATE, not consume-once (a consuming reader flips yes→no across
  React's double effect-run); raise before the sign-out call, lower only in a `finally`. Residual: `signOut()`
  broadcasts to every same-origin tab, but the flag is ONE TAB's memory — a second tab still remembers its
  page (narrower, not a fix defect).
- **Consume-on-read makes the consuming effect NON-IDEMPOTENT** — a second run (StrictMode, extra identity
  change) reads null and falls back to default; gate with a ref latch set INSIDE the success branch (unreachable
  on a FAILED sign-in), nothing between latch and navigate may throw. Read only AFTER auth resolves, but
  "resolved" needs its OWN two predicates: AuthContext nulls `user` on a profile-read reject, so gating on
  `user` alone never fires — gate on `uid` + the loading flag. A loading FLAG + nullable payload must
  distinguish "resolved-absent" from "not yet".
- Third-party `href`: reject unless `startsWith('https://')` (`safeHref`, `rel=noopener`). Prose renders as
  plain-text React children, never `dangerouslySetInnerHTML`; JSON-LD needs `.replace(/</g,'\\u003c')`. Free
  text with no `hasOnly` cap gets length-capped in the CONSUMING function before an FCM body.
- App Check is opt-in (reCAPTCHA v3, no-op w/o a site key — never assume enforcement). `request.app != null` is
  the correct v2 idiom but SOFT: only `enforceAppCheck: true` hard-rejects an anon actor budget-draining with
  distinct uncached ids (BIN-361). v2 callables redirect to `*.run.app` — both belong in CSP `connect-src`.
  Rules can't count sibling writes in a writeBatch either — fix with server-authoritative `onCall`, per-uid
  cooldown in `runTransaction`, `reporterUid` from auth.

## Secrets and config
- Secrets via `defineSecret` → `process.env.*`, in headers or a vendor-mandated query param (TMDB), never
  logged; failure logs carry only the HTTP status. Admin-SDK offline-script path segments need
  `Number.isInteger` validation (no `/` in a doc id); in CI, user-controlled strings go via `env:`.
- **Test a gitignore secret pattern with `git check-ignore`** against the RUNBOOK's literal filename AND the
  tool's DEFAULT download name — `*-recaps-writer*.json` misses `recaps-writer.json`; GCP's
  `{project}-{hash}.json` matches no `*service-account*` pattern.

## Cost, budgets, rate limits, fan-out
- Sealing a client-writable counter behind a callable closes FORGERY/write-SHAPE, NOT COST or DOC-COUNT.
  Against "X matches the sealed pattern used by Y/Z/W", verify each sibling's SPECIFIC bound —
  `askBingeStats/{day}` one doc/day, `omdbBudget/{day}` transactional cap + `enforceAppCheck`,
  `titleRatingsRateLimit/{uid}` per-caller. Identify the ACTUAL enforcement vs the design-intent justification
  — vendor spend is bounded by `reserveMotnSlot`'s transaction, not schedule cadence (a wrong comment is a
  Low). Never refund a reservation the vendor already counted.
- **"Claim in a transaction, work outside, release on failure" has a hard-timeout hole.** GCP force-kills a
  timed-out function with no `finally`, so a kill between claim and release sticks the flag for the cycle —
  bound the window under the platform timeout, or give the claim a LEASE timestamp. Transactions retry the
  callback, so `.add()` duplicates; use idempotent `.doc(id).set()`.

## Admin-SDK sweeps and scheduled writers
- **Admin SDK bypasses `firestore.rules` entirely — `hasOnly` offers ZERO protection against what a sweep
  writes.** The backstop is pure logic: a FRESH payload from a fixed allowlist, unit-tested for key-set
  equality + disjointness from `FORBIDDEN_FIELDS`. Whole-DB sweeps add a dry-run-by-default gate, cursor +
  budget, and an audit `lastRun` write every run.
- A shared `Set`/`Map` accumulator returned only at loop-end fails twice on a throw from unit K: K+1..M skipped,
  1..K-1's already-landed writes discarded (re-pushed next phase). try/catch-continue per unit. **The unit's own
  error-REPORTING callback needs its own nested try/catch too** — an unguarded `onError?.(err)` inside the
  per-unit `catch` defeats the isolation if the logger itself throws (BIN-848: increment the counter BEFORE the
  guarded callback runs). **Three DIFFERENT code paths can write the same ambiguous "0/success" summary value
  for a check meant to attest an effect occurred, and a fix for one doesn't cover the others:** (1) an outer
  `.catch()` substituting a default for a whole-scan failure needs a sentinel a legitimate run can't produce
  (`skippedBatches: -1`, never `0`); (2) an early-return bail-out before the guarded call ever fires can log the
  exact same "0 skipped" a fully-successful run would (BIN-848 follow-up: `byOwner.size === 0` returns
  `skippedAuthBatches: 0` before `getAuth()`/`getUsers()` ran at all — the value a post-deploy "prove this
  permission works" check was reading as proof, having asked nothing). Fix: pair the summary field with a
  second counter of what was actually ATTEMPTED (`checkedUids`, real count on the attempted path, `0` on every
  bail-out/failure path) and require both together. Applies only to purely logged/observed values; a value
  anything downstream branches on needs the distinction proven live, not asserted in a comment.
- **collectionGroup matches by LEAF collection id regardless of parent path** — grep other writers/readers of
  that leaf name before trusting one. `collectionGroup('watchlist')` also matches
  `groups/{id}/watchlist/{tmdbId}`, safe ONLY because those docs lack `status` — prefer `isUserWatchlistDocPath`.
  Append each page BEFORE the `size < PAGE_SIZE` break. uid must come from the doc PATH
  (`d.ref.parent.parent?.id`), never client content — re-verify each adopter.
- Bare-tmdbId keying collides movie and TV titles (independent TMDB namespaces): grouping keys, state doc
  ids, FCM `tag`s, inbox ids and action URLs all need mediaType (`mediaTypeDocId`). Fixing one collection's
  keying bug → grep every OTHER collection keyed on the same bare id (BIN-523 failed on this).
- A doc-id namespacing migration on a doc holding a MULTI-WRITER map needs a VALUE-level merge, never a
  document-level `??` fallback — the first post-cutover write creates a one-entry namespaced doc HIDING every
  pre-cutover entry (BIN-608 `swipes.votes`). Price the widening (an unattributable legacy key feeds BOTH
  namespaces — pin it in a test). A doc id is a trust boundary only if it appears in the allow-expression:
  BIN-624's `canonicalSwipeDocId(tmdbId)` guard on `swipes`' `create` is FORM-bound, not VOLUME-bound
  (`movie_1`…`movie_999999` still creatable) — don't read it as closing the junk-doc-cost class (ADR 0015).
- **A LOOSE doc-id parser makes ALIASES collide in a last-write-wins Map** (`'movie_042'` took genuine
  `movie_42`'s slot, BIN-618): require the parser be the writer's STRICT inverse. A "fall back to the nearest
  earlier X" loop needs a monotonic-DECREASING cursor that never overshoots.

## Deploy order (deploy.yml is hosting-only)
- Order is direction-dependent and load-bearing — decide it. Name a TARGETED command (`--only
  functions:availableNotify`), never a blanket `--only functions`. Rules/indexes go FIRST when new client code
  depends on them (a CG export query deployed before its rules makes GDPR export AND deletion throw for
  everyone); AFTER hosting when a new constraint would deny writes from the OLD still-running client (BIN-540).
- **`deploy.yml`'s rules/functions drift guard runs FIRST with no `continue-on-error`, so a commit touching
  `functions/**` fails the job BEFORE the hosting step — hosting doesn't deploy either**, so prod runs the
  PARENT commit for BOTH surfaces.

## Review scope, premises and attestations
- **An attestation is a load-bearing claim — verify it like code**, whether it sits in a comment, a JSDoc, a
  `tasks/todo.md` note, or your own last marker. A false safety comment is WORSE than none because it says the
  audit happened (BIN-523's "the scan filters mediaType" was false exactly where it mattered). **A REDESIGN
  orphans comments:** after `?next=` became sessionStorage the login page still credited `safeNextPath` with
  stopping it — grep the REMOVED mechanism's name across the diff's files. **A "line-endings only" claim needs
  BYTE ACCOUNTING:** `--ignore-cr-at-eol` ignores a TRAILING CR but not a LONE one (content).
- **Challenge a dispatching prompt's premise, and scope a RE-review by SHA.** "NEVER had a security review",
  "everything else is as you last saw it" and "only file X moved" have each been false. ALWAYS diff every
  staged sha against what the marker pinned: equality is the spot-check, inequality is the real scope, the
  brief's file list is a hint, never the boundary. **But sha equality proves the BYTES held, not that their
  CLAIMS do** — a byte-identical module's doc comment is falsifiable by a change elsewhere in the diff. An
  unchanged file the diff depends on is exempt from re-reading, never from re-derivation.
- **When a diff's ticket matches a gap NAMED in a prior entry, re-grep to confirm FULL closure** — a targeted
  fix routinely leaves an identical-pattern sibling unfixed. A ticket AC promising "a new test proves X" with
  no test file in the diff is itself the finding. Same for a plan/ADR's Consequences saying a field "will be
  added to `hasOnly()`" — verify `firestore.rules` was actually touched; an Admin-SDK-only v1 can defer it, but
  flag the commitment (the moment a client write path adds that key, `hasOnly` rejects the ENTIRE write).
- **Shared-checkout hazard (markers are gone, but a live sibling session isn't).** A live sibling's mutation
  loop can land INSIDE your window — 3× now — so a clean `git status` on one file is NOT proof it hasn't moved
  past it. `Read` serves the WORKTREE: hash against `git rev-parse :<path>` when something looks wrong. While
  a sibling's loop is live anywhere, distrust one result on any file: re-`Read` + re-run `--no-cache` twice,
  identical results required — disagreement with no edit of your own IS the signal.
- **Reviewing a FORWARD-REVERT:** prove exactness (`git diff <base> -- <files>` EMPTY → review reduces to "is
  `base` acceptable"); baseline = what is DEPLOYED. Next.js server-runtime advisories are neutral under
  `output: 'export'`.

## Archive
Write to it every review, dated. Grep it for a familiar finding, a past PoC shape, or a principle compressed
past use.
