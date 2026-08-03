# tasks/todo.md — scratch

## SPRINT 2026-08-03 — Selection (Phase 1)

Linear MCP: connected. Scoped to project "Binge" inside shared team "Binge" for every
read/write below. 43 Backlog + 4 Todo tickets reviewed (0 In Progress); 0 reserved-label
exclusions (no `onboarding-reserved`/`launch-gated` tickets present in the fetched set).

**Premise check against current `main`:** grepped `WatchlistContext.tsx` directly rather
than trusting ticket prose. Confirmed BIN-601/640's rebuild (commit `1759749`) is live —
`listenerFailedRef`, the `onSnapshot` error callback, and `resolveAddedAt`'s repair effect
all exist at HEAD. That resolves **BIN-642** (see Obsolete). It does NOT include BIN-598's
mutator migration — `WatchlistContext.test.tsx` has zero `updateWatchedAt`/`updateTmdbStatus`
coverage, confirming BIN-630's gap is still real, not stale.

### Batch 1 — watchlist-auth-sweep-round2 (4 tickets, ONE coordinated diff — do not split)

- [ ] **BIN-596** [Tier B, plan-gated] `build-review` — StatusButton/QuickAddButton still
  aren't gated on the watchlist snapshot; a cold-load "Sedd" can land without `watchedAt`.
- [ ] **BIN-598** [Tier B, plan-gated] `build-review` — WatchlistContext: mutators still read
  the render-closure copy instead of `itemsRef.current`; `updateWatchedAt`/`updateTmdbStatus`
  have zero test coverage.
- [ ] **BIN-617** [Tier B, plan-gated] `build-review` — `visibilitySyncPending` retry latch
  isn't reset on sign-out.
- [ ] **BIN-701** [Tier A] `build` — determine whether `NOTES_MIGRATE_CAP` genuinely bounds
  the per-session notes migration or only paces it, and correct the comment at
  `WatchlistContext.tsx:17` to match reality.
  - Files: `src/contexts/WatchlistContext.tsx`, `src/contexts/WatchlistContext.test.tsx`,
    `src/contexts/AuthContext.tsx`, `src/contexts/AuthContext.test.tsx`,
    `src/components/title/StatusButton.tsx`, `src/components/title/StatusButton.test.tsx`,
    `src/components/title/QuickAddButton.tsx`, `src/components/title/QuickAddButton.test.tsx`.
  - **This is the 5th attempt on this exact surface.** Round 1 (BIN-595-era) cascaded 4
    defects. Round 2 (2026-07-30) was split after 3 review rounds; the 4 clean tickets
    shipped, these 4 parked. Round 3 (2026-08-01) rebuilt the package, BIN-601 failed
    verification, and the failed batch could NOT be reverse-applied cleanly (BIN-683) —
    NOTHING shipped, not even the 3 tickets that had no findings against them. Round 4
    (2026-08-02) pulled BIN-601 out on its own, redesigned it, and shipped it clean
    (`1759749`), closing BIN-640/642 with it. This is round 5, for the 3 remainder plus a
    small adjacent investigation ticket that touches the same file.
  - **Binding, carried forward from Malin's 2026-07-30 decision on BIN-596 (still in
    force — her 2026-08-01 comments describe what happened, they don't rescind it):**
    1. ONE sweep, one context. Do not let round N repair round N−1's own damage inside
       this same attempt.
    2. Folded acceptance, not separate tickets: **BIN-630** (updateWatchedAt/updateTmdbStatus
       zero coverage), **BIN-631** (flaky sign-out-latch regression test), **BIN-644 item 1**
       (same gap as BIN-630 — do not file a duplicate).
    3. Out of scope, must NOT be touched: `QuickRateModal.tsx`, `OnboardingFlow.tsx`, the CSV
       importer (BIN-643 — parked, needs Malin's product call), the addItem/updateStatus
       rewatchCount question (already resolved by BIN-641/BIN-629), and BIN-598's Part 2 (the
       shared "watchedAt-gated" helper across 7 files — deliberately deferred to **BIN-689**;
       touching 7 files concurrently with this batch is the exact risk that sank round 3).
    4. **If review cascades into a NEW regression (not just re-litigating BIN-630/631/644):
       STOP and hand back to Malin. Do not run a 6th round.**
  - **New, from the round-3/4 postmortems — treat as binding, not optional:**
    5. A "loading" gate alone is not enough. BIN-596 needs the three-state model
       (loading / failed / loaded) already established by BIN-601's rebuild
       (`firstSnapshotSettledRef` vs `listenerFailedRef` vs `loading`) — a failed listener
       must NOT read as "loaded && empty" (that turns a read failure into a destructive
       "you have no titles" lie, with `CollectionSection`'s "Lägg till alla" reachable on
       top of it). Key any signed-in check on `uid` (auth), never `user` (profile doc).
       Whatever gates a control must also gate what it *claims* — no success toast for a
       write that didn't happen.
    6. The button also needs a sign-in-restoring gate distinct from the loading gate — the
       ~100–500ms `onAuthStateChanged` window where `uid` is briefly null must not read as
       "click and get a silent no-op with a success toast."
  - Stakeholders: `AuthContext.tsx` + repeated-regression history trips the repo's highStakes
    regex → requiresPlanMode **true** regardless of per-ticket priority. Route
    `node docs/org/route.mjs --md src/contexts/WatchlistContext.tsx src/contexts/AuthContext.tsx`
    before starting; fold any conditions in as further binding acceptance.
  - Acceptance (BIN-596):
    1. Both buttons hold their action until BOTH auth has resolved (keyed on `uid`) AND the
       watchlist listener has settled (`firstSnapshotSettledRef`, not bare `loading`) — a
       cold-load tap can no longer land a "Sedd" without `watchedAt`, and a tap during
       auth-restore can no longer silently no-op behind a success toast.
    2. A failed listener does not present as "loaded && empty" — no false-success toast, and
       `CollectionSection`'s "Lägg till alla" bulk action is not reachable in that state.
    3. The chosen disabled/held-state visual is screenshotted and named in the close-out for
       Malin's sign-off — this ticket never auto-closes to Done regardless of pass/fail.
  - Acceptance (BIN-598):
    1. All 9 mutators read `itemsRef.current` where they look up the current item
       (confirm `updateTags`/`removeItem` genuinely do no such lookup before leaving them
       untouched — don't invent one).
    2. `updateWatchedAt` and `updateTmdbStatus` get real, mutation-verified test coverage
       (closes BIN-630 and BIN-644 item 1 — do not re-file either).
    3. No regression to a title page's runtime-fill / streaming-refresh reactivity once the
       library finishes loading — this is the exact defect the 2026-07-29 attempt shipped;
       write an explicit regression test for it.
    4. Part 2 (shared watchedAt-gated helper across 7 files) and the rewatchCount parity
       question are NOT touched here — confirmed out of scope in the diff.
  - Acceptance (BIN-617):
    1. Sign-out resets `visibilityRetriedFor` in the branch that runs when Firebase reports
       no one is signed in (covers explicit sign-out, expired session, cross-tab sign-out
       uniformly) — keep this placement, it was independently validated as correct.
    2. The regression test awaits the actual retry-chain promise, not a mock-call race, and
       is run repeatedly (10+ times) to prove it is not flaky — closes BIN-631.
  - Acceptance (BIN-701):
    1. The investigation states plainly which reviewer was right (paces vs. genuinely
       bounds) and corrects the `WatchlistContext.tsx:17` comment to match.
    2. If the investigation finds a genuine behavior bug (not just a stale comment), it is
       NOT silently fixed inline — stop and flag it as a new discovery instead.
  - Suggested agent: direct (no repo implementation specialist beyond the review-gate agents).

### Batch 2 — onboarding-continuity (3 tickets, one file)

- [ ] **BIN-664** [Tier A] `build` — OnboardingFlow's duplicate check ignores `mediaType`; a
  film and a series sharing a TMDB id collide.
- [ ] **BIN-659** [Tier B, plan-gated] `build-review` — onboarding swallows every failed
  write silently; a new user can land past onboarding with an empty list and no idea why.
- [ ] **BIN-669** [Tier A] `build` — a brand-new account loses its BIN-645/668 remembered
  return path through onboarding, landing on `/` instead — exactly the population that
  consent-routing fix exists for.
  - Files: `src/components/onboarding/OnboardingFlow.tsx`,
    `src/components/onboarding/OnboardingFlow.test.tsx` (or equivalent),
    `src/components/AuthGuard.tsx` (BIN-669's own scope, not just OnboardingFlow — see
    below), `src/lib/nextPath.ts` (one-line header-comment fix only, per BIN-669's own text).
  - **BIN-669 is bigger than its title.** Its own ticket body (2026-08-01 addenda) names
    three binding fixes in the same surface, all inside this ticket's own scope, not
    separate tickets:
    1. `AuthGuard`'s bounce-to-login must CLEAR the remembered-path key, not leave it — else
       a visitor who takes an unrelated AuthGuard bounce (e.g. tapping "Bibliotek" while
       signed out) after an earlier remembered-path write gets silently redirected to that
       stale earlier destination instead of `/`.
    2. `AuthGuard` must write any remembered path via `rememberNextPath()`, never a raw
       `sessionStorage.setItem` — this is the function that applies the same-origin
       validation; a raw write bypasses it and reopens the open-redirect surface BIN-645
       closed.
    3. `nextPath.ts`'s header comment names `invite` as "the" excluded query key, but
       `fromGroup` is ALSO deliberately excluded (it drives a Firestore read on mount) and
       reachable via `RecCard`. Name both, one sentence.
  - Stakeholders: `auth` label on 659/669, and BIN-669 reuses `nextPath.ts`'s open-redirect
    validation at TWO call sites (OnboardingFlow AND AuthGuard) → requiresPlanMode **true**
    ("unsure A vs C → C" — this writes to `users/{uid}` and touches the exact path-carrier
    BIN-645 hardened against open redirects). Route before starting; fold conditions in as
    acceptance.
  - Acceptance (BIN-664):
    1. The duplicate check compares BOTH `tmdbId` AND `mediaType` — a film/series id
       collision no longer causes one title to silently vanish from the onboarding picks.
    2. A regression test pins exactly this collision case.
  - Acceptance (BIN-659):
    1. A failed save during onboarding surfaces a visible "Det gick inte att spara. Försök
       igen." message with a retry action — no silent success.
    2. Onboarding does not advance past a step whose write failed.
    3. The chosen failure-UX is named in the close-out for Malin's sign-off — never auto-Done.
  - Acceptance (BIN-669):
    1. A new account that arrived via the poster-badge/QuickAddButton remembered-path flow
       still lands on that remembered title after finishing onboarding, not on `/`.
    2. Reuses `nextPath.ts`'s existing same-origin validation on read — no new open-redirect
       surface at the onboarding exit.
    3. An account with no remembered path is unaffected (still lands on `/`).
    4. `AuthGuard`'s bounce clears the remembered-path key rather than leaving a stale one
       behind, and writes any new remembered path only through `rememberNextPath()` — never
       a raw `sessionStorage.setItem`.
    5. `nextPath.ts`'s header comment names both `invite` and `fromGroup` as excluded keys.

### Batch 3 — calendar-a11y (1 ticket)

- [x] **BIN-660** [Tier A] `build` — SHIPPED 2026-08-03. `EventCard` nests a real `<button>` inside its own
  `<Link>` on the calendar week view — invalid nesting, hits screen readers on the week's
  primary action.
  - Files: `src/components/calendar/EventCard.tsx`, its test file.
  - Stakeholders: none (Medium priority, no highStakes match). requiresPlanMode: false.
  - Acceptance:
    1. No `<button>` renders inside an `<a>` in the fixed markup — a query that would have
       failed against today's structure now passes.
    2. Card-level navigation and the watched-toggle button keep their current, separate
       behaviors (tapping the card navigates; tapping the toggle marks watched without
       navigating).
    3. No visual change to the calendar week view.
  - **Deviations (review round, 2026-08-02):**
    - ~~Acceptance #1 is **UNPINNED — no test exists.**~~ **RESOLVED 2026-08-03, in this
      same commit.** `src/components/calendar/EventCard.test.tsx` now pins it: 12 tests,
      9 mutants killed across three review rounds — re-nesting the toggle inside the
      `<Link>`; the toggle escaping the card root entirely; dropping the root `.ev`,
      `is-tonight` or `is-watched` chrome; never applying `is-on`; swapping `isWatched`'s
      arg order; the movie footer hoisted out of the `<Link>`; and each of the two
      spacing numbers and the anchor's flex layout deleted. Every mutant verified landed
      by a grep before AND after its run, each on a cleared vitest transform cache.
      BIN-703 closed.
    - Acceptance #3 held only after a fix: moving focus off the card root put the global
      `:focus-visible` ring (drawn 2px outside the border box) inside the card's
      `overflow: hidden`, clipping it on three sides. Ring is now drawn inward on the
      anchor. The proper home for that rule is a `.ev`-adjacent class in `globals.css`,
      which is outside this batch — done with a Tailwind `focus-visible` utility instead.
    - The toggle's text label moved inside the `<button>`. It used to navigate (it sat in
      the anchor); as a sibling span it was inert. Its `aria-label`/`title` were dropped so
      the visible text is the accessible name.

### Batch 4 — streaming-test-gap (1 ticket)

- [ ] **BIN-638** [Tier A] `build` — `useStreamingOffers`'s 10s timeout race and the
  `enabled`-gate branches are untested (deferred sub-scope of BIN-564).
  - Files: `src/hooks/useStreamingOffers.ts` (read-only), `src/hooks/useStreamingOffers.test.ts`.
  - Stakeholders: none (test-only). requiresPlanMode: false.
  - Acceptance:
    1. A test pins the 10s timeout race (request outlives the timeout → resolves to a
       timeout/null state, not a hung promise).
    2. Both branches of the `enabled` gate are covered (disabled → no fetch; enabled →
       fetch runs).
    3. No production behavior change — test-only ticket.

### Batch 5 — seo-contentfloor-cleanup (2 tickets, same file cluster)

- [ ] **BIN-687** [Tier A] `build` — `PersonPageClient` is the only BIN-656-changed product
  file with no test — its bio source order and `useMemo` dep array are unpinned.
- [ ] **BIN-688** [Tier A] `build` — contentFloor cleanup after BIN-656: two different
  "does this text have substance" thresholds, double computation per render, and the static
  person-page path bypasses the shared helper.
  - Files: `src/lib/seo/contentFloor.ts`, `src/components/pages/PersonPageClient.tsx`
    (+ new test), `src/components/pages/MoviePageClient.tsx`,
    `src/components/pages/TVShowPageClient.tsx`, `src/app/person/[id]/page.tsx` (the
    pre-rendered static SEO page — BIN-688 finding #3, currently hard-slices `biography` at
    180 chars with no shared helper, so the static HTML and the hydrated client can serve
    different snippets for the same URL).
  - Stakeholders: none beyond BIN-656's own already-discharged routing (Low/Medium priority,
    no highStakes match). requiresPlanMode: false. **BIN-688's own text flags a dependency:**
    fixing the static person page must respect BIN-686's CC BY-SA answer (already applied in
    `PersonPageClient.tsx` — `wikiBio?.text` was dropped from the meta-description source) —
    the static page's fix must carry the same constraint, not reintroduce unattributed
    Wikipedia text into a meta tag.
  - Acceptance (BIN-687):
    1. A new `PersonPageClient.test.tsx` pins the bio source order
       (`svBio || wikiBio?.text || ''`) exactly as BIN-656 shipped it.
    2. The `useMemo` dep array (`[person, svBio, wikiBio?.text]`) is mutation-verified
       load-bearing (dropping a dep fails the new test).
  - Acceptance (BIN-688):
    1. The "substantial text" threshold has exactly ONE implementation, consumed by all
       three page clients — no second inline threshold.
    2. The floor computation is memoized once per render, not recomputed twice.
    3. `PersonPageClient`'s path goes through the same shared helper as Movie/TVShowPageClient
       — no bypass.
    4. `src/app/person/[id]/page.tsx`'s static description now goes through the same shared
       helper/threshold instead of a raw `biography?.slice(0, 180)` — same URL, same snippet,
       whether Google reads the static HTML or the hydrated page.
    5. The static page's fix does not reintroduce `wikiBio`/Wikipedia text into the meta
       description — same CC BY-SA constraint BIN-686 already applied client-side.
    6. No change to the pre-rendered top-N static pages' own `generateMetadata` output (same
       constraint BIN-656 itself carried) — this only fixes person pages OUTSIDE the top-N set.

## Already decided by Malin — applied, not re-asked (Phase 1 step 4)

- **BIN-596/598/617** — 2026-07-30: build as one coordinated sweep, binding conditions still
  in force (her 2026-08-01 comments explain what happened, they do not rescind the decision).
  See Batch 1. Applied as `build-review` (Tier B, never auto-closes).
- **BIN-541** (MOTN/RapidAPI quota) — 2026-07-29: blocked, waits on Malin reading the real
  quota off the Nokia API Hub/RapidAPI dashboard. Not re-asked.
- **BIN-565** (legacy bare-id offers fallback) — 2026-07-29: blocked, waits on re-running the
  #27 DBA mini-panel with the new counter-argument already written into the ticket.
- **BIN-613** (First Load JS baseline) — 2026-07-29: yes, but as its own standalone job
  (edits the live `deploy.yml` release gate) — routed elsewhere, not built in a sprint.
- **BIN-590** (password-strength server-side) — 2026-07-29: **build a Firebase Auth blocking
  function** mirroring `passwordStrength.ts` — but Tier C (auth domain), explicitly must NOT
  be picked up by an unattended sprint; needs its own written plan + go-ahead first. Approved
  in principle, blocked on a dedicated session.
- **BIN-558** (>100 groups truncated) — 2026-07-29: final "let it be — no action now."
- **BIN-559** (ensureUserProfile offline-safe) — 2026-07-24/29: accepted trade-off unless
  Malin wants a dedicated redesign.
- **BIN-547** (logRecapMiss no ceiling) — repeated through 2026-07-29: leave parked,
  pre-launch, zero real users, matches an already-accepted pattern elsewhere.
- **BIN-555** (createGroup orphan reaper) — 2026-07-29: leave parked, bundle with future
  orphan-reaper work if it ever gets attention.
- **BIN-521** (Bundle-rådgivare nudge) — 2026-07-16/18: routed to its own
  `/stakeholder-review` (Monetization + Data/Integrations) before any code. Not re-litigated.
- **BIN-189** (seasonal challenges) — 2026-07-13: form approved, full Tier-C plan + 4-role
  panel approve-with-conditions already done. Build window "a calm week in Aug/Sept" —
  recommend Malin book it as its own dedicated session rather than this run claiming it.
- **BIN-170** (Binge Wrapped) — 2026-07-13: booked for November, mockup approved, due
  2026-10-15 (design-round start). Not due yet.
- **BIN-419** (SEO re-measure) — 2026-07-13: scheduled, one-time cloud routine fires
  2026-08-28. Not due yet.
- **BIN-583** (Fas 2 companion recommendations row) — SPLIT-AND-DEFER, dormant until the
  curated list grows or usage is measured. Neither has happened.
- **BIN-603** (postcss/sharp CVEs pinned inside next) — repeated: wait for upstream fix,
  re-check at the next routine dependency sweep.
- **BIN-454 / BIN-402** (TMDB ToS sweep mutateEnabled) — standing CLAUDE.md instruction, never
  flipped by a sprint. Step 1 (dry-run) is shipped and live; BIN-454 tracks the flip, gated
  on real traffic + recorded prod dry-run cost + a missed-run alert, pegged to ~Nov 1.

## Folded into Batch 1 as acceptance criteria, not built as separate tickets

**BIN-630, BIN-631, BIN-644** (item 1 only) — confirmed still-real gaps against current
`main` (grepped, not trusted from ticket prose). Do not re-file; Batch 1's BIN-598/BIN-617
acceptance criteria close them.

## Obsolete (premise gone — grepped against current `main`, not ticket prose)

- **BIN-642** ("a dead watchlist listener leaves the whole app in a silent permanent loading
  state") — grepped `WatchlistContext.tsx`: the `onSnapshot` error callback added by the
  BIN-601/640 rebuild (`1759749`, 2026-08-02) sets `listenerFailedRef.current = true` AND
  calls `setLoading(false)` — the app is no longer stuck in `loading` forever. The remaining
  gap (what to show INSTEAD of a stuck spinner) is a different, already-filed problem —
  **BIN-700** — and stays open under needsApproval below, not re-litigated here.

## Needs your call (not selected — genuinely her decision, first time flagged or product
gated)

- **BIN-700** (dead listener now shows an empty library instead of an error) — real,
  Medium-priority gap left by the BIN-601/640 rebuild. The ticket's own comment says this
  needs to be re-scoped to a real fix (a distinct failed-state + retry, or bounded
  re-subscribe backoff) rather than picked at — and the empty-vs-frozen tradeoff is
  explicitly a product call, not a code call. *Recommendation: decide the tradeoff, then it's
  a contained follow-up to Batch 1's surface — don't fold it in blind this round.*
- **BIN-643** (QuickRateModal/OnboardingFlow/settings-import still call `addItem` ungated by
  the snapshot) — same class as BIN-700: the naive fix (flip `loading` false on failure) was
  tried and reverted for turning a stuck spinner into a confidently-empty-library lie with
  destructive buttons attached. *Recommendation: needs the same product decision as BIN-700
  before a fix shape is chosen — bundle them.*
- **BIN-679** (let curated Season-0 specials be marked watched without regressing the
  progress marker) — depends on Malin's still-pending editorial sign-off on BIN-580's curated
  Doctor Who list, and touches progress-marker write semantics — the exact area BIN-615 was
  explicitly kept to a narrow fix, not a two-track model. *Recommendation: confirm BIN-580's
  picks first, then scope this narrowly — don't fold progress-marker writes in blind.*
- **BIN-655** (`addItem` is two functions wearing one name) — real, worth doing, but touches
  `WatchlistContext.tsx`, which Batch 1 is rewriting this same sprint. *Recommendation: wait
  until Batch 1 has actually landed and stabilized — stacking two WatchlistContext rewrites
  in one sprint is the exact pattern that caused three earlier review cascades.*
- **BIN-468** (seProviderIds dedup + refreshTmdbFields tests) — same file-conflict reasoning
  as BIN-655, plus a documented stalling history (picked up 2026-07-24, shipped nothing).
  *Recommendation: pick up on its own once Batch 1 has landed.*
- **BIN-689** (BIN-598's deferred Part 2 — shared watchedAt-gated rule across 7 files) —
  deliberately excluded from Batch 1 this round; touching 7 files concurrently with the rest
  of Batch 1 is what sank round 3. *Recommendation: build once Batch 1 has landed, as its own
  single-purpose pass.*
- **BIN-624** (swipe doc-id format guard in `firestore.rules` + server mirror re-sync) — a
  `firestore.rules` change is a sensitive domain (written plan + go-ahead before code), Low
  priority, and the live risk is already closed by BIN-618. *Recommendation: bundle into a
  future rules-focused session, not urgent.*
- **BIN-636** (test guarding the client/server `mediaTypeDocId` split while BIN-624 stays
  open) — exists purely to cover the gap BIN-624 leaves open. *Recommendation: pair with
  BIN-624 rather than building the guard alone.*
- **BIN-646** (BIN-618 follow-up: three `resolveTmdbId` asymmetries, none currently live) —
  genuinely optional hygiene, no urgency. *Recommendation: fold into whichever future sprint
  next touches `mediaTypeDocId.ts`.*
- **BIN-585** (`shared-plugin.json` roadmapDocs points at two deleted files) — **failed twice
  now for the same mechanical reason**: `.claude/shared-plugin.json` is gitignored, so no
  sprint worktree can write it and no reviewer's `git diff` can see it — it is structurally
  outside what an automated sprint can ship (see BIN-684). *Recommendation: a one-line hand
  edit on your own machine — set `roadmapDocs` to `[]` around line 268. Nothing a sprint does
  differently will fix this.*
- **BIN-634** (stale `/simplify` marker from a previous sprint) — same gitignored-directory
  problem as BIN-585 (`.claude/state/simplify-done.marker`). *Recommendation: delete it by
  hand, or treat alongside BIN-684 if you want the sprint mechanism taught to handle
  `.claude/state/` safely.*
- **BIN-628 / BIN-683 / BIN-684 / BIN-639** (review-gate marker scoping, batch
  withdrawability, close-out enforcement, workflow-map-bundling withdrawal) — all four are
  about the sprint/review MECHANISM itself, not Binge's app code, and the actual fix likely
  lives in the shared `C:/claude-plugins` delivery skill rather than this repo.
  *Recommendation: worth hardening, but as a deliberate tooling investment you sign off on —
  not folded into a routine app-code sprint. BIN-628's specific instance (the Aug-1 marker)
  is already gone — it was deleted in the 2026-08-02 salvage — but the structural gap it
  named is the same one BIN-684 tracks.*
- **BIN-658** (eslint 9→10 major bump to clear 10 dev-only High CVEs) — dev-only, no live
  exposure, Low priority — but a major lint-tool bump can change what CI treats as an error.
  *Recommendation: worth doing, but as a deliberate look rather than a routine pick — flag if
  you want it folded into the next dependency sweep.*

## Post-sprint steps (Phase 3, mandatory)

1. Full `npm run typecheck` + `npm run lint` before commit; fix anything fatal.
2. File follow-up tickets for anything discovered beyond the folded-in BIN-630/631/644 —
   do not silently expand any batch's scope.
3. Commit per the reviewGates table. Batch 1 in particular: read every reviewer's verdict
   text, not just marker existence or mtime — this exact surface has produced scope-limited
   markers before (lessons digest, twice).
4. **Withdrawability check (BIN-683's lesson):** the instant all batches are applied, run
   `git apply -R --check` on every batch's patch BEFORE any post-apply fix touches the tree,
   and record which are still cleanly reversible. If Batch 1 fails outcome verification,
   pull it before anything else touches its 8 files — do not let a fix land on top of it
   first.
5. Push (triggers hosting deploy). No `firestore.rules`/functions changes in this sprint —
   nothing needs a manual deploy step.
6. Transition: Tier A `build` with all acceptance criteria passing → Done (BIN-701, BIN-664,
   BIN-669, BIN-660, BIN-638, BIN-687, BIN-688). Any `build-review` ticket, or anything Tier
   B/C, or any failed/unclear criterion → **In Review** + plain-language notify, never
   auto-Done — this covers all of Batch 1 (BIN-596/598/617) and BIN-659 unconditionally, per
   their own dispositions above.
7. **If Batch 1 review cascades into a NEW regression (not the pre-folded BIN-630/631/644
   criteria): STOP per Malin's binding condition. Do not attempt a 6th round.** Park with a
   clear account of what's clean vs. entangled and surface it to her directly — same shape as
   the 2026-07-30 split decision.
8. Fold the deviation log back per the skill (Linear ticket / lessons digest / archives as
   appropriate).

## CLOSE-OUT — 2026-08-03 (written by the post-sprint phase)

**Outcome as the sprint ended: NOTHING SHIPPED** — no commit, no push, no deploy, HEAD at
`4c03241`. **Amended 2026-08-03 after the sprint:** on Malin's "granska klart och committa",
batch 3 (BIN-660) was finished by hand in the main session — test written, three reviewers
each ended on `pass (0 blocking)`, their findings applied — and ships as THIS commit.
NOTE for the next reader: an earlier draft of this file asserted those verdicts BEFORE the
reviewers issued them. That is the self-certification shape this repo has been burned by;
the wording above was corrected once the verdicts actually existed. So: 1 of 5 batches
shipped; the other four remain as recorded below. Every gap still has a Linear ticket.

### Per batch

| Batch | Tickets | What actually exists | Disposition |
|---|---|---|---|
| 1 watchlist-auth-round5 | BIN-596/598/617/701 | Built. `stash@{0}` + `batch-0.patch`, applies cleanly to HEAD today. **Zero acceptance criteria graded, no review verdict recorded.** | All → Todo. Grading filed as **BIN-705**. BIN-701's traced answer posted to its ticket. |
| 2 onboarding-continuity | BIN-664/659/669 | **Nothing.** No patch, no stash, no deviation entry, no comment. | All → Todo. Vanished-batch filed as **BIN-708**. |
| 3 calendar-a11y | BIN-660 | **SHIPPED 2026-08-03**, on Malin's "granska klart och committa". Both staged EventCard versions were snapshotted first, the newer worktree one kept. Test written; code, test and integration reviewers each ran three rounds and each ended on `pass (0 blocking)`. 14 of their 17 Low/optional findings applied; the last 3 (all acceptance-#3 cosmetics, none touching the a11y contract) filed as a follow-up rather than triggering a fourth round. | BIN-660 + BIN-703 Done; BIN-702 obsolete. |
| 4 streaming-test-gap | BIN-638 | Built. `stash@{2}` + `batch-3.patch`, applies cleanly. No reviewer read it. | Left as-is (not in the transition mandate). Recovery filed as **BIN-704**. |
| 5 seo-contentfloor | BIN-687/688 | Built. `stash@{1}` + `batch-4.patch`, applies cleanly. No reviewer read it. BIN-688's acceptance #4/#5 rest on a premise already false at HEAD (BIN-656/b99e07d closed it). | Left as-is. Recovery + re-scope filed as **BIN-704**. |
| — | BIN-642 | Obsolete, premise closed by `1759749`. | → Canceled with the grep-verified reason. |

### Phase-3 steps: 0 of 8 executed by the sprint

No typecheck/lint evidence; no follow-up tickets; no Linear transitions; the
withdrawability check (step 4) provably did not run (batch-2 is already irreversible);
the deviation log was folded back for BIN-660 only. This close-out is the repair pass.

### Follow-ups filed (all project Binge)

- ~~**BIN-702**~~ — obsolete 2026-08-03: EventCard was committed, so there is nothing left to recover.
- ~~**BIN-703**~~ — closed 2026-08-03: `EventCard.test.tsx` ships in the same commit, 12 tests, 9 mutants killed.
- **BIN-704** — BIN-638 / BIN-687 / BIN-688 work exists in stashes+patches but was reported as nothing.
- **BIN-705** — Grade the round-5 watchlist work against its 9 criteria before any 6th attempt.
- **BIN-706** — The stale workflow-map flag survived another sprint (names files 2 commits back).
- **BIN-707** — `sprint-patches/` mixes two sprints under the same `batch-N` names.
- **BIN-708** — A whole batch produced no artifact and no gate noticed.
- Evidence of recurrence also added as a comment on **BIN-684**.

### Deviation log → folded back

Two recurring workflow rules appended to `tasks/lessons.md` + `.claude/rules/lessons-digest.md`
in the same edit: (1) a batch with no artifact is invisible, and `batch-N.patch` is not unique
across sprints; (2) a sprint worktree has no local `node_modules`, so the vitest-cache-clearing
step is a no-op — prove the mutant landed instead. Product-level deviations were written into
the tickets themselves (BIN-596's signed-out toast question, BIN-598's two deliberately-unmigrated
mutators, BIN-617's non-existent BIN-631 test, BIN-688's user-visible threshold consequence).

### Scratch deliberately NOT cleaned

Worktrees, `.claude/state/sprint-patches/*`, and every `sprint-parallel-cleanup` stash are left
exactly as they are — they are the only copy of three batches' work. See BIN-707 before touching
that directory.


---

# ARCHIVE

## SPRINT 2026-08-01 — Selection (Phase 1)

Linear MCP: connected. Scoped to project "Binge" inside shared team "Binge" for every
read/write below. ~48 Backlog tickets reviewed (0 Todo, 0 In Progress carried over); 0
reserved-label exclusions (no `onboarding-reserved`/`launch-gated` tickets present).

**Note on scratchpad state:** `.claude/state/sprint-patches/pending-BIN-641-*` and
`pending-BIN-645-*` files on disk are stale leftovers from the already-shipped BIN-641/645
work (commits d5bb353/71b404b/dc71bdd/4e87cc0) — working tree is clean, nothing to recover.
Safe to delete next time that directory is touched; not acted on here (out of scope).

### Batch 1 — watchlist-auth-sweep (4 tickets, ONE coordinated diff — do not split)

- [ ] **BIN-596** [Tier B, plan-gated] `build` — StatusButton/QuickAddButton aren't gated on
  the watchlist snapshot; a cold-load "Sedd" lands without `watchedAt`.
- [ ] **BIN-598** [Tier B, plan-gated] `build` — WatchlistContext: two lookup idioms after
  BIN-593; "sedd-gated watchedAt" hand-copied at 7 sites.
- [ ] **BIN-601** [Tier B, plan-gated] `build` — a permanently-failed watchlist listener lets
  `addItem` overwrite the real `addedAt`/"Tillagd" date.
- [ ] **BIN-617** [Tier B, plan-gated] `build` — `visibilitySyncPending` retry latch isn't
  reset on sign-out.
  - Files: `src/contexts/WatchlistContext.tsx`, `src/components/title/StatusButton.tsx`,
    `src/components/title/QuickAddButton.tsx`, `src/contexts/AuthContext.tsx` (sign-out path
    only), `src/lib/watchlistWrites.ts` (shared helper surface), plus each ticket's test file.

[... superseded content from the 2026-08-01 and earlier sprint plans, salvage passes, and
decision records preserved verbatim in git history at this file's prior revision (commit
4c03241 and earlier) — trimmed here to keep this scratch file from growing unbounded. See
`git log -p -- tasks/todo.md` for the full text of every prior sprint, salvage plan, and
decision record.]
