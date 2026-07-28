# tasks/todo.md — scratch

## ACTIVE PLAN — Sprint 2026-07-28

Selected from the Linear backlog for project "Binge" (team "Binge"), scoped throughout.
8 tickets, 6 batches, all disjoint by file. None obsolete (grep-of-main premise check ran
on every build candidate; BIN-468's items 1-2 were already confirmed shipped by the ticket
itself on 2026-07-24 — only its remaining items 3-4 were candidates, and those are NOT
selected this round). BIN-569 looked implemented from its own ticket body ("Step-0
re-scope... now implemented") but `candidateKey`/`indexSwipes`/`mediaTypeDocId` are absent
from `src/lib/together/matching.ts` and `src/lib/firebase/sessions.ts` on main — the
description is stale, the ticket is a genuine, fully-speced build.

### Batch 1 — watchlist (agent: direct or binge specialist)

- [x] **[Tier A][build]** BIN-599 — QuickRateModal inflates rewatchCount on a rate-only
  pass over an already-'sedd' film.
  Files: `src/components/recommendations/QuickRateModal.tsx` (+ new test).
  Fix: only call `updateStatus(...)` when `existing.status !== 'sedd'`; check sibling
  quick-rate/bulk surfaces for the same pattern.
  Acceptance:
  - QuickRateModal only calls `updateStatus('movie', id, 'sedd')` when `existing.status !== 'sedd'`.
  - A test asserts rating an already-'sedd' film via QuickRateModal does not increment `rewatchCount`.
  - `isRewatch`'s narrow `sedd→sedd` rule in `buildStatusUpdate` is NOT broadened — don't re-open the mis-click fabrication bug BIN-593 closed.
  - Other quick-rate/bulk surfaces are checked for the same unconditional-`updateStatus` pattern; any found are fixed here or filed as a follow-up.

- [x] **[Tier A][build]** BIN-588 — Season auto-advance marks a whole season watched from
  one ticked episode (episode 8/8 ticked alone advances past 1–7 unwatched), corrupting
  spoiler-mask boundaries.
  Files: `src/hooks/useEpisodeProgressWithSync.ts` (+ test).
  Fix: gate the mark-watched auto-advance on real season completeness via
  `highestWatchedPosition`/`episodeProgress`, mirroring the unwatch branch 11 lines below.
  Acceptance:
  - Auto-advance only fires when episodes 1..N-1 are also watched (checked against `episodeProgress`, not just the ticked episode number).
  - New test: ticking only the last episode of an otherwise-unwatched season does NOT advance `lastWatchedSeason`/`lastWatchedEpisode` to the next season.
  - Existing "watched in order through the last episode" auto-advance path still passes — no regression on the legitimate case.
  - Reuses the unwatch branch's existing position-recompute helper rather than duplicating it.

### Batch 2 — streaming (agent: direct or binge specialist)

- [x] **[Tier A][build]** BIN-589 — `isUserBehindOnAired` compares seasons numerically;
  a season-0 special airing last reads as "caught up", feeding a wrong keep/cancel verdict
  into the Subscription Advisor.
  Files: `src/hooks/useSubscriptionAdvisor.helpers.ts` (+ test, likely
  `useSubscriptionAdvisor.helpers.test.ts`).
  Fix: season-0-aware ordering (season 0 sorts AFTER numbered seasons for this comparison),
  matching the convention already used in `contiguousWatchedBoundary`/`inventoryFromSeasons`.
  Acceptance:
  - `isUserBehindOnAired` returns `true` (behind) when `last_episode_to_air` is a season-0 special and the user is on any numbered season.
  - New test pins that exact case; the existing reverse case (season 0 as the user's OWN progress, in `isCaughtUpOnEndedShow`) is unchanged.
  - No change to any TMDB fetch/caching logic — comparison-logic fix only.

### Batch 3 — social (agent: direct or binge specialist)

- [x] **[Tier A][build]** BIN-600 — Feed's per-followee reviews query has `limit(10)`
  with no `orderBy`; Firestore orders by random doc-id, so the newest review is usually
  dropped before the 14-day filter even runs.
  Files: `src/app/feed/page.tsx`, possibly `firestore.indexes.json` (composite index for
  `uid` + `createdAt` — check whether one already exists for the reviews listing query).
  Stakeholder tier: **single** (#18 Community Manager, routed via `docs/org/route.mjs`).
  Acceptance:
  - Query adds `orderBy('createdAt', 'desc')` alongside `limit(10)`, matching `useReviews.ts`'s existing shape.
  - Verified (test or manual) that the query now returns the 10 most-recent reviews, not an arbitrary `__name__`-ordered sample.
  - If a composite index is required and missing, `firestore.indexes.json` is updated.
  - No change to the `Promise.allSettled` fan-out BIN-595 already shipped in the same function.

- [!] **[Tier A][build]** BIN-569 — Tillsammans swipe votes collide movie N + TV N
  (`sessions/{id}/swipes/{tmdbId}` keyed on bare numeric id; a mixed-media session deck
  can contain both). Ticket body already carries a full, reviewed fix spec — implement it
  as written.
  Files: `src/lib/firebase/sessions.ts`, `src/types/social.ts`, `src/lib/together/matching.ts`,
  `src/hooks/useMySessions.ts`, `src/components/pages/TillsammansSessionPageClient.tsx`,
  `src/lib/together/matching.test.ts`.
  Acceptance:
  - Swipe docs are keyed on `mediaTypeDocId(mediaType, tmdbId)` going forward; movie 42 and TV 42 no longer share a vote tally.
  - Legacy bare-id docs (pre-cutover, in-flight sessions) still resolve via a numeric fallback — an active session doesn't lose votes mid-week.
  - New tests cover: film vs serie never share a vote; veto isolation; progress/next-candidate isolation per media type.
  - `firestore.rules` is NOT touched (the wildcard binding never parses the doc id — verified in the ticket's own re-scope note).

### Batch 4 — data/functions (agent: direct or binge specialist) — Tier C, plan expansion required

- [x] **[Tier C][build]** BIN-586 — `leavingRollup` dedupes titles by bare tmdbId; a
  movie/tv id collision on the same provider silently drops one from the public
  `/forsvinner` page (real, un-logged data loss on an SEO surface).
  Files: `functions/src/leavingRollup/logic.ts` (+ `logic.test.ts`).
  **Risk gate: `functions/**` is a `tierCTriggers` match → expanded plan required before
  implementing (Step-0 classification, files, blast radius, rollback shape) even though the
  fix itself is narrow and mechanical.** binge-security-reviewer gate fires on `functions/`.
  Fix: key `perTitle` on `mediaTypeDocId(ref.mediaType, ref.id)` instead of bare `ref.id`;
  extend the sort tie-break to include mediaType. Mirrors the composite-key pattern already
  used identically 3x elsewhere (BIN-523/529/545, ADR 0017) — this is the one surface that
  never got the migration.
  Acceptance:
  - `perTitle` map key is `(mediaType, tmdbId)`; a movie and a TV show sharing a numeric id, both expiring on the same provider, both survive in `byProvider` output.
  - Sort tie-break also breaks on mediaType, not `tmdbId` alone.
  - New test asserts the movie/tv collision case above.
  - `byProvider`'s external shape (fields `useStreamingLeaving`/`ForsvinnerListClient` read) is unchanged — only the internal map key.

### Batch 5 — auth (agent: direct or binge specialist) — full-panel, plan expansion required

- [!] **[Tier B][build-review]** BIN-587 — Privacy downgrade fails open: a failed
  `defaultVisibility` cascade (public→private) leaves watchlist items publicly readable
  indefinitely with no retry, no signal, no repair.
  Files: `src/contexts/AuthContext.tsx` (`updateDefaultVisibility`, ~line 640-674), plus
  whatever settings surface shows `defaultVisibility` (`src/components/settings/UsernameSection.tsx`
  is the confirmed reader — verify at Step-0 whether the pending-state UI belongs there).
  **Stakeholder tier: full-panel** (#5 Legal/GDPR Counsel, #27 Database Administrator,
  routed via `docs/org/route.mjs` — high-stakes path). Plan expansion required (Phase 1.5).
  **Scope: implement Option 1 ONLY** (surface + retry). Option 2 (fail-closed read rule —
  a `firestore.rules` change) is deliberately OUT of scope here; file it as its own
  follow-up ticket instead of folding it in.
  Signoff reason: how the "sync incomplete" state is surfaced to the user is a product/UX
  call, and this is a privacy control on user data — Malin should see the diff.
  Acceptance:
  - `updateDefaultVisibility` sets a `visibilitySyncPending`-style flag on the user doc when the item-cascade throws (not just `console.error`).
  - The flag is retried automatically on next app load until it clears; the settings UI reflects "sync incomplete" while pending.
  - `firestore.rules` is NOT modified in this ticket — a follow-up ticket for Option 2 (fail-closed read) is filed in Linear.
  - A test covers: cascade throws → pending flag set → retried on next mount → flag clears on success.

### Batch 6 — infra (agent: direct or binge specialist)

- [!] **[Tier A][build]** BIN-584 — `npm audit`: 1 critical (`websocket-driver`, via
  `firebase@12.12.1` → ships to every visitor's browser) + CVEs in build-toolchain deps.
  Files: `package.json`, `package-lock.json`.
  Fix: `npm audit fix`, then full verification per the ticket. If it wants a `firebase`
  major bump, STOP and split that into its own ticket rather than taking it here.
  Acceptance:
  - `npm audit --omit=dev` reports zero critical and zero high afterward.
  - No `firebase` major-version bump is taken inside this ticket (explicit ticket constraint) — split out if `npm audit fix` wants one.
  - `npm run typecheck`, `npm test`, `npm run test:rules` all pass after the bump.
  - `npm run analyze` shows no First Load JS regression vs the tracked baseline.

## Needs you (Tier D / needs-approval — not built this sprint)

- **BIN-541** (MOTN/RapidAPI vendor quota gap) — needs-approval. The ticket's own text
  requires confirming the real plan quota (daily vs monthly, actual number) from the
  RapidAPI/Nokia API Hub dashboard before any fix shape can even be chosen, and explicitly
  says "do not click Upgrade Plan without sign-off." That's an external fact only you can
  pull, plus functions/** is a sensitive domain requiring a written plan first regardless.
  **Recommendation:** check the dashboard when convenient, tell me daily vs monthly + the
  number, and I'll fold the fix into next sprint with a proper plan.
- **BIN-565** (bound the legacy bare-id offers-fallback read-cost) — needs-approval. The
  ticket deliberately defers itself: its own acceptance criteria require re-litigating a
  dated-cutoff-vs-work-set-gate question with the DBA (#27) using a counter-argument the
  original panel never saw, before any fix shape is settled. Not ready to build blind.
  **Recommendation:** worth a `/stakeholder-review` pass with the DBA before it's sprint
  material — low current cost impact (pre-launch traffic), so no urgency.
- **BIN-590** (password-strength enforcement is client-only) — needs-approval. Two very
  different fix shapes exist: a Firebase Console Identity Platform policy (an ops action,
  zero code) vs. a new `beforeCreate` blocking Cloud Function (real infra footprint, manual
  deploy, pre-launch). The ticket itself calls the impact "modest." Whether to add a new
  Cloud Function pre-launch for a Low-severity gap is genuinely your call.
  **Recommendation:** try the Console password-policy route first (cheaper, no deploy) —
  if that's insufop of the console coverage, then the blocking-function ticket becomes a
  real Tier C candidate for a future sprint.
- **BIN-547** (logRecapMiss abuse ceiling) — needs-approval, but not really contested: the
  ticket's own text says "accepted as a known, tracked residual... before real launch." It's
  explicitly self-deferred, same shape as BIN-454's Nov gate. **Recommendation:** leave it
  parked; revisit alongside the pre-launch hardening pass.

Deferred (good build candidates, not selected this round to keep the sprint to 8 tickets —
carry into next sprint): BIN-598 (WatchlistContext lookup-idiom + `seenDate()` consistency
cleanup), BIN-601 (failed-listener `addedAt` stamp fix — explicitly meant to ride with
BIN-598, same file), BIN-468 items 3-4 (`seProviderIds` dedup across
`MoviePageClient.tsx`/`TVShowPageClient.tsx` + `refreshTmdbFields` integration tests),
BIN-564 (test the `useStreamingOffers` legacy bare-id fallback), BIN-585 (trivial
`shared-plugin.json` dead-path fix).

## Acceptance grading (Phase 2.7 — graded per ticket, not per sprint)

Legend: `[x]` all criteria met · `[!]` at least one criterion failed or ungraded → parked
In Review, never a false Done.

- **BIN-599 `[x]` → Done, 3 of 4 met.** Guard in place; `isRewatch` NOT broadened; sibling
  surfaces checked. **UNMET:** no QuickRateModal regression test exists — no test file for
  that component exists in the repo at all. Filed **BIN-611**; recorded as a deviation below
  rather than silently dropped.
- **BIN-588 `[x]` → Done, 3 of 4 met literally.** Auto-advance now gated on real
  completeness; new test pins the last-episode-alone case; the in-order path still passes.
  **DEVIATED:** the "reuses the existing position-recompute helper" criterion — a new sibling
  helper was added instead, for a structural reason (see deviation log). Accepted by both
  code and test review. Filed **BIN-616** for the orphaned JSDoc it left behind.
- **BIN-589 `[x]` → Done, all 3 met**, with the fix implemented as the narrower asymmetric
  rule (see deviation log) rather than the symmetric one the plan cited. No TMDB
  fetch/caching logic touched. Remaining gap filed as **BIN-615**.
- **BIN-600 `[x]` → Done, 3 of 4 met.** `orderBy('createdAt','desc')` added; composite index
  already existed so `firestore.indexes.json` is untouched; the `Promise.allSettled` fan-out
  was not disturbed. **UNGRADED:** "verified the query returns the 10 most-recent reviews" —
  no test infra exists for this page and no prod read was done. Filed **BIN-612**, which also
  covers the new risk that `orderBy` silently excludes docs missing `createdAt`.
- **BIN-586 `[x]` → Done, all 4 met** (composite key, mediaType tie-break, new collision
  test, external shape unchanged). Production is NOT yet changed — functions need a manual
  targeted deploy, filed as **BIN-610**.
- **BIN-569 `[!]` → In Review, criterion 2 FAILED.** Namespaced keying, test coverage and
  the untouched `firestore.rules` all hold, but the legacy fallback resolves per DOCUMENT,
  so the first post-cutover vote hides every pre-cutover vote on that title. Filed
  **BIN-608** (Urgent).
- **BIN-587 `[!]` → In Review, 3 of 4 met.** Flag/retry/clear chain verified correct
  end-to-end, UI reflects the pending state, `firestore.rules` untouched, tests cover the
  cascade-throws path. **UNMET at grading time:** the Option-2 follow-up ticket the plan made
  a condition of the narrowing did not exist — now filed as **BIN-609**. Also: the
  full-panel stakeholder review (roles 5/27/19) that Phase 1.5 made binding never ran; it
  must run before this ticket closes. Nit filed as **BIN-617**.
- **BIN-584 `[!]` → In Review, 1 of 4 met cleanly.** The "no firebase major bump" constraint
  holds (12.12.1 unchanged). The zero-critical-zero-high bar is UNMET — the critical cleared,
  2 highs remain pinned inside `next` (**BIN-603**, raised to Todo/High). `npm run analyze`
  was not run and is ungradeable anyway because no tracked baseline exists (**BIN-613**).
  `test:rules` passed on an alternate emulator port but that result is unrecorded.

## Deviation log

Plan-vs-reality divergences, per the skill's Phase-2 contract. `[deviation]` = plan said one
thing, reality another. `[discovery]` = found, deliberately not fixed. `[needs-human]` =
parked for Malin.

**BIN-599**
- `[deviation]` Plan named one file → the fix falsified a comment block in
  `src/lib/watchlistWrites.ts` asserting "QuickRateModal re-marks already-sedd films without
  checking, so it increments on every pass" → comment-only edit there so the code doesn't
  ship a comment that lies. No logic change.
- `[needs-human]` Acceptance criterion "a test asserts rewatchCount doesn't increment" NOT
  met — no QuickRateModal test harness exists. Filed **BIN-611**. The production fix is
  sound by hand-trace, but the regression guard on a permanently-uneditable counter is
  missing, so nothing stops the next edit from re-introducing the bug.

**BIN-588**
- `[deviation]` Plan said gate on completeness using `highestWatchedPosition` → that helper
  returns the MAX watched position and structurally cannot express completeness (max 10-of-10
  is true whether 1–9 are watched or not) → added a sibling pure helper `isSeasonFullyWatched`
  in the same `*.helpers.ts` file per the repo's test-extraction convention. This is the
  "reuses the existing helper" criterion not being met as written.
- `[deviation]` Plan implied REPLACING the finale trigger with a completeness check →
  replacing it would make auto-advance newly fire when a season is completed OUT of order
  (finale ticked first, gaps filled later), which never advanced before → kept the existing
  `episode >= episodeCount` trigger AND added the completeness gate, so the new rule is a
  strict subset of the old one and the out-of-order case behaves exactly as today.

**BIN-589**
- `[deviation]` Plan said to make season 0 sort AFTER numbered seasons "matching the
  convention already used in `contiguousWatchedBoundary`/`inventoryFromSeasons`" → those two
  helpers EXCLUDE season 0 entirely (`season >= 1` filters); the cited convention does not
  exist → kept the plan's intent (season-0-aware ordering), implemented as the narrower
  mixed-track rule, and recorded the correction in the Linear ticket body.
- `[deviation]` Plan implied a symmetric ordering change → applying it symmetrically flips
  user-marker-S0-vs-aired-numbered to "caught up", contradicting `highestWatchedPosition`
  (the writer of the field, which ranks S0 below every numbered season) and breaking the
  pinned test at `useSubscriptionAdvisor.test.ts:336` → chose the conservative asymmetric
  rule that changes exactly ONE case. No existing test was weakened or rewritten.
- `[deviation]` Plan asked for the new test in `watchStatus.test.ts` → the function's own
  suite lives in `useSubscriptionAdvisor.test.ts` → added the tests there, next to the
  function's existing cases, avoiding a second file in another batch's surface.
- `[discovery]` Marker-S0 vs aired-frontier-S0 still reads "caught up" for someone who has
  watched ONLY specials while numbered seasons aired. Fixing it needs `show.seasons` as a new
  input; the root cause is that one scalar marker cannot represent two tracks. Filed
  **BIN-615**.

**BIN-600**
- `[deviation]` Plan listed `firestore.indexes.json` as possibly needing a new composite
  index → `reviews uid ASC + createdAt DESC` already exists → index file untouched, no
  Firestore index deploy required.
- `[discovery]` The ticket's Note claims BIN-595 already converted this same fan-out from
  `Promise.all` to `Promise.allSettled` → the tree still has a bare `Promise.all` in
  `FeedContent` and `git log -- src/app/feed/page.tsx` shows no BIN-595 commit. NOT folded in
  (different ticket). Worth re-checking whether BIN-595's feed leg was lost.

**BIN-569**
- `[deviation]` The ticket body's 2026-07-24 section reads as past tense — "plan-stale, now
  implemented", listing six files as "actual scope as built" → NONE of it was in the tree at
  HEAD ad014ce → treated the body as a reviewed SPEC rather than a record of shipped work and
  implemented it as written. A prior sprint evidently wrote this up and never landed the code.
  Promoted to a lesson (`tasks/lessons.md`, 2026-07-28) because it is a recurring trap.
- `[deviation]` Spec left the shape of `indexSwipes` open → chose a returned lookup FUNCTION
  (`SwipeLookup`) over exposing two raw Maps, so no caller can re-implement the fallback and
  get it subtly wrong.
- `[needs-human]` That fallback is nonetheless WRONG: it resolves per document, not per vote.
  Filed **BIN-608** (Urgent) and the ticket is parked In Review. Also promoted to a lesson.
- `[discovery]` `docs/workflow-map.html` still documents the payload as
  `sessions/{id}/swipes/{tmdbId}`. Deliberately NOT bundled — map edits ship in their own
  commit per the standing lesson. Rolled into **BIN-614**. The trigger-loaded schema doc
  `.claude/rules/data-model.md` WAS corrected in this commit (it is operating instructions,
  not flow prose, and misleads the next agent to open `src/lib/firebase/**`).
- `[discovery]` Existing rules tests seed swipe docs on bare ids like `'603'` → they still
  pass unchanged because the rules never parse the doc id and deletion sweeps the whole
  collection → left alone rather than churning an emulator suite this batch cannot run.

**BIN-586**
- `[deviation]` Plan said edit `logic.ts` only → the collision was untested and the
  co-located `logic.test.ts` had no (movie, tv) same-id case → added 2 regression tests in
  the same already-owned file rather than shipping the fix unproven.
- `[deviation]` Plan implied a plain typecheck pass → `npx tsc -p functions/tsconfig.json`
  emits 128 pre-existing errors because `functions/node_modules` isn't installed in this
  worktree → verified scope-locally instead (zero errors in the two changed files) rather
  than installing deps or editing unrelated files.
- `[needs-human]` The fix does nothing in production until a manual targeted
  `firebase deploy --only functions:leavingRollup` runs. Filed **BIN-610**.

**BIN-587**
- `[deviation]` Plan named 2 files → the behaviour is untestable without extending the
  AuthContext test harness (its `fsdb` mock lacked `writeBatch`/`deleteField`, its `getDocs`
  stub returned id-only docs) → added `src/contexts/AuthContext.test.tsx`, same auth surface,
  no third production file.
- `[deviation]` Plan said "set a flag on the user doc" → the flag write can fail on the SAME
  network error that killed the cascade, leaving no cross-session record → conservative
  choice: in-session React state is set regardless (so the warning shows immediately) and the
  failed flag write is logged. No retry queue, no local-storage mirror invented. The residual
  this leaves is exactly what **BIN-609** (Option 2) is for.
- `[deviation]` Plan said "retry on next app load until it clears" → an unconditional effect
  would also fire instantly after the in-session failure and could hammer a persistently
  failing cascade → exactly one repair attempt per uid per app load, with the in-session
  failure consuming that session's slot.
- `[deviation]` Ticket suggested only SURFACING the incomplete state → surfacing without
  repair leaves the user stuck until a reload → added one "Försök igen nu" button re-running
  the SAME visibility value. No new component, danger tokens per the design system.
- `[needs-human]` The Phase-1.5 full-panel stakeholder review (roles 5 Legal/GDPR Counsel,
  27 DBA, 19) that the plan made binding never ran, and no `review` event was appended to
  `docs/org/metrics/events.jsonl`. It must run on this diff before BIN-587 closes.

**BIN-584**
- `[deviation]` Ticket said `npm audit fix` fixes all five → it clears 3 (critical + moderate
  + top-level postcss high); the other two highs are pinned exactly inside `next` and npm's
  only remedy is `--force` down to `next@9.3.3`, a seven-major breaking downgrade → refused
  the downgrade, took the three safe fixes, split the rest into **BIN-603**. No `overrides`
  block added.
- `[deviation]` Exit criterion "zero critical AND zero high" is unattainable without that
  downgrade → re-scoped in the Linear body to zero critical + zero moderate, with the 2
  build-toolchain-only highs documented and deferred. No test or check was weakened.
- `[deviation]` Ticket claimed `websocket-driver` and `protobufjs` ship to the browser via
  the firebase client SDK → both `@firebase/database` and `@firebase/firestore` expose
  `browser: dist/index.esm.js` and only reach `faye-websocket`/`@grpc/proto-loader` from
  `main: dist/index.node.cjs.js`, so NEITHER is in the client bundle → kept the patch (still
  correct) but corrected the exposure claim instead of escalating urgency.
- `[deviation]` Ticket asked for `npm run analyze` → that's the full 25k-page SSG build
  (45+ min, needs TMDB network + build cache), not runnable in a throwaway worktree →
  skipped and proved the same thing structurally (firebase stayed 12.12.1, no client-bundle
  dependency changed). Flagged, not silently dropped. There is also no tracked baseline to
  compare against — filed **BIN-613**.
- `[deviation]` Plan assumed `npm run test:rules` would run → emulator port 8080 was held by
  a sibling worktree → generated a throwaway alt-port config (8391), ran all 231 rules tests
  green, deleted the temp file. Did NOT kill the other process or edit `firebase.json`.
- `[deviation]` Ticket listed `package.json` among files to change → every fix landed inside
  existing semver ranges and all CI/deploy jobs use `npm ci`, so the lockfile alone is
  authoritative → left `package.json` untouched for the minimal diff.

**Sprint-level**
- `[needs-human]` The `binge-security-reviewer` marker as first stamped covered only the
  social batch and explicitly superseded the earlier auth review, naming neither
  `functions/src/leavingRollup/logic.ts` nor `AuthContext.tsx` — the exact BIN-472 failure
  mode from the lessons digest. Re-stamped so it names every triggering surface before commit.
- `[discovery]` `.claude/state/workflow-map-stale.json` is still on disk and
  `docs/workflow-map.html` is untouched. Deliberate: map edits get their own commit (lessons
  digest, e2cf608). Filed **BIN-614**.

---

## ARCHIVED — BIN-595 sprint (shipped ad014ce, 2026-07-28)

## ACTIVE PLAN — BIN-595 only (BIN-596 split out after four review rounds)

Malin approved the queue **BIN-595 → BIN-599 → BIN-596 → source flag + BIN-597 → BIN-598**
and later approved "commit BIN-595 when review is clean, then stop". This plan is the
**reduced** scope after that stop condition failed four times; she approved the split.

### The defect (BIN-595, pre-existing, CONFIRMED)

`WatchlistContext.addItem` wrote the two denormalised visibility fields
(`effectiveVisibility` + the legacy `isPublic` mirror — never the per-item `visibility`
override itself, which only `updateVisibility` writes) unconditionally from the PROFILE-WIDE default. `addItem` is
also the re-mark path (StatusButton / QuickAddButton / useMarkSeen), so an ordinary status
change clobbered a per-title privacy override. The stored `visibility` field survived — the
payload omits it — but nothing reads it for access control: both `firestore.rules` and
`usePublicProfile` key on `effectiveVisibility`.

`addItem` was the worst offender. The six sibling mutators inline the same rule as
`current?.visibility == null`, which is ALSO true for `undefined` — so they stamp during a
cold load too. That is reachable (`SeasonPageClient`, the calendar's `EventCard`) and is
tracked in BIN-598.

### The fix, as it now stands

One pure helper in `src/lib/watchlistWrites.ts`:

```ts
export function shouldStampVisibility(
  current: { visibility: ItemVisibility | null } | undefined,
): boolean {
  return current?.visibility == null;
}
```

`addItem` spreads `effectiveVisibilityNow()` only when it returns true. That is deliberately
the SAME rule the siblings already inline — extracting it changes no behaviour for an
unloaded title; it gives the rule one name and one test so BIN-598 can tighten all seven
writers together once the per-title override actually ships.

### Why BIN-596 was split out — the decision this plan records

An earlier version of the helper ALSO refused to stamp during a cold load, to protect an
override that might not have loaded yet. That branch triggered a four-round cascade:

1. It caused a real product regression — a doc with NO `effectiveVisibility` is missing from
   the owner's own public profile, because `usePublicWatchlist`'s tier queries match that
   field by EQUALITY and Firestore equality never matches an absent field. For a PUBLIC
   default too, not just the 'friends' case the first comment described.
2. To close that window I pulled BIN-596 in — gating `StatusButton`/`QuickAddButton` on the
   snapshot. That required an `onSnapshot` error callback, because `loading` otherwise
   sticks true forever on a failed listen and every add control in the app would grey out.
3. The error callback then made a failed listener render as a **confidently empty library**:
   `items` stays `[]`, so a user with 300 titles sees an empty Bibliotek, and
   `CollectionSection`'s "Lägg till alla" reappears and can bulk-demote films already marked
   seen. I traded a stuck spinner for a lie with destructive buttons attached.
4. Round 4 also found the `!uid` guard made every logged-out click a silent dead click on the
   two highest-traffic SEO pages, and `QuickAddButton`'s gate keyed on the Firestore profile
   doc rather than auth, throwing signed-in users into a re-auth popup.

**The cold-load branch protected nothing.** The DPO established `updateVisibility` has zero
callers and never had one in any released version, so the override it guarded cannot exist.
Removing the branch removes the regression, which removes the need for BIN-596 here, which
removes the whole cascade.

BIN-596 is now its own ticket, to be done with the loading / failed / empty states designed
properly rather than bolted on. The abandoned implementation is not worth recovering as a
patch — its shape is what caused the cascade — but everything learned about WHY is written up
on BIN-596 itself, which is the durable record.

### Also reverted out of this commit

The `/feed` `Promise.allSettled` change and the extracted `collectSettledFeed` helper. Both
were sound in isolation and reviewed clean twice, but they are independent of BIN-595 and
round 4 raised a real open question about them (swallowing TRANSIENT failures past React
Query's retry). They belong in the same ticket as the rest of the feed work — BIN-600 already
covers that area.

### Acceptance

- Re-mark of an override'd item omits both fields; re-mark of a non-override'd item still stamps
  (the A4.3 lazy-on-write re-assert must not regress); a genuinely new title stamps.
- No behaviour change for a title not in the local snapshot — same as today.
- No `firestore.rules`, indexes or schema change.
- Mutation-verify each assertion.

### Panel (ran on the original, larger scope — conclusions still hold)

- **Software Architect (#14)** — no blocking. Endorsed a named helper over re-inlining.
- **DPO (#6)** — no remediation duty, no Art. 33/34 action: the per-title override has never
  been reachable, so the state this bug reverses could not be created. Verified independently
  and harder (`git log --all -S` over `src/components/ src/app/` is empty for
  `updateVisibility`, so no released version ever had a UI for it either).
