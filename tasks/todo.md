# PLAN — BIN-513 regression fix (xhigh review finding, 2026-07-16)

**Context:** BIN-505 has LANDED (d6ff035). Finishing the sprint 2026-07-15 ship. The
`/code-review xhigh` pass found one CONFIRMED correctness regression in BIN-513 that must be
fixed before shipping it.

**Problem:** `useServiceValue.ts` feeds every `'mina'` TV provider into `tvActiveProviderIds`
keying on raw status only. A paid service whose ONLY title is a finished, Ended/Canceled series
that the user has caught up on (derived sub-state `'avslutad'`) is therefore permanently
suppressed from the "dead weight" verdict — the exact wasted subscription the advisor exists to
flag. `ej_paborjad`/`paborjad`/`ligger_efter` are legitimate keep-anchors; `'avslutad'` is not.

**Fix (2 production files + 1 test — scope is a small logic correction, tier `skip`/`medium`,
no rules/auth/GDPR/status-model change — `librarySubState` is READ, not changed):**
1. `src/lib/advisor/serviceValue.ts` — add pure, testable helper
   `tvActiveProviderIdsFromItems(items)` that derives the guard list and EXCLUDES any TV title
   whose persisted `librarySubState(it) === 'avslutad'`. (Persisted-fields-only variant — no
   extra TMDB fan-out; a finished show without backfilled `tmdbStatus` conservatively reads as
   `'paborjad'` and stays shielded, which is safe.)
2. `src/hooks/useServiceValue.ts` — replace the inline loop with the helper call.
3. `src/lib/advisor/serviceValue.test.ts` — cover: `avslutad`-only service is NOT in the guard
   list (→ dead-weight true); `ej_paborjad`/`ligger_efter`/`vill_se` ARE (→ shielded); film
   ignored.

**Acceptance:** helper unit-tested; `npm run typecheck` + full advisor suite green; re-run
binge-code-reviewer + binge-test-reviewer over the changed files before commit.

**Assumptions (no architecture-changing unknowns):** the persisted-only sub-state is the right
signal (matches how the library view itself sections these); threading the advisor's live
ended-set into the hook is a larger change and out of scope for this fix.

---

# ⚠ BIN-505 still in progress — uncommitted work on disk, read before touching these files

`git status` shows a large uncommitted diff matching the BIN-505 plan below. It is **not**
finished (GDPR wiring, rules tests, docs, gates, and deploy are still unchecked). Full plan:
`tasks/bin-505-plan.md`. Full detail preserved below the `---` separator.

**Files already touched by BIN-505 — do not select new tickets against these until it's
committed:** `firestore.rules`, `src/contexts/AuthContext.tsx`, `src/contexts/WatchlistContext.tsx`,
`src/lib/firebase/{friends,userData,dataExport,accountDeletion,userSearch,username,publicProfile}.ts`,
`src/app/{feed,grupper}/page.tsx`, `src/components/layout/TopbarActions.tsx`,
`src/components/pages/{FriendsPageClient,ListPageClient,UserProfilePageClient}.tsx`,
`src/hooks/{useFollowList,useFriendsWhoSaw,usePublicProfile}.ts`.

This governed today's selection: BIN-509 (Tillsammans rules) and BIN-510 (groups fan-out,
touches WatchlistContext.tsx) are real, worth-building tickets that were deliberately **not**
selected this round for exactly this reason — see their Linear comments. Same for BIN-517/516
(AuthContext.tsx bugs) — left unselected in Backlog, no comment needed (clear bug fixes,
purely a scheduling conflict, pick up next sprint once BIN-505 lands).

---

# Sprint 2026-07-15 — selection

Linear available. 8 tickets selected (`build`/`build-review`), clustered into 4 disjoint-file
batches. 1 obsolete (BIN-173, closed with resolving commit). 1 needs-approval this round
(BIN-521, idea needs its own design pass) plus BIN-509/BIN-510 held for timing (see banner
above) — all three got a plain-language Linear comment recording the reasoning.

## Batch: watchlist (scoring + next-air repair)

- [ ] **BIN-511** [Tier A] `build` — Fix profile top-genre weighting: `stats.ts` divides
      rating by 10 (0–10 scale) but ratings are 0.5–5, so a 5★ title under-weighs an unrated
      watch. Files: `src/lib/taste/stats.ts`, `src/lib/taste/stats.test.ts`.
      Stakeholders: single · #28 Recommendations/Scoring-Integrity. requiresPlanMode: no.
  - [ ] `weightForItem` normalizes `rating` off the real 0.5–5 scale (e.g. `rating/5`) so a
        5★ item's weight is ≥ the unrated `'sedd'` weight (0.8) — pin with a test.
  - [ ] The `avbruten` check runs before the `rating` check so a rated-then-dropped item gets
        weight 0.
  - [ ] `stats.test.ts` fixtures use only 0.5–5 ratings (no impossible 8/9 values).
  - [ ] `vector.ts`'s existing (correct) normalization is untouched.

- [ ] **BIN-518** [Tier A] `build` — `nextAirReadRepair.flushNextAirWrites` marks a chunk
      "written" before its `batch.commit()` resolves, so a partial-batch failure silently
      drops the later chunk's repair. Files: `src/lib/watchlist/nextAirReadRepair.ts` (+ test).
      Stakeholders: single · #10 Performance Engineer. requiresPlanMode: no.
  - [ ] `writtenThisSession` is marked per-chunk only AFTER that chunk's `batch.commit()`
        resolves (or the mark-before-commit choice is explicitly documented as deliberate —
        pick one, code + comment agree).
  - [ ] A new test forces `batch.commit()` to reject on a multi-chunk flush and asserts the
        later, uncommitted chunk's ids are NOT left in `writtenThisSession`.
  - [ ] Existing successful-path tests are unmodified in their assertions.

- [ ] **BIN-519** [Tier A] `build` — Pin next-air read-repair invariants (no-`updatedAt`,
      multi-render coalescing) at the `useCalendar` hook layer, not just the pure-helper
      layer. Files: `src/hooks/useCalendar.test.ts` (+ `useCalendar.ts` if needed).
      Stakeholders: single · #10 Performance Engineer. requiresPlanMode: no.
  - [ ] A hook-layer test drives an unmocked (or Firestore-spied) `flushNextAirWrites` and
        asserts the written payload has no `updatedAt` key.
  - [ ] A hook-layer debounce test re-renders multiple times inside the 1200ms window and
        asserts `flushNextAirWrites` fires exactly once (proves coalescing, not just delay).
  - [ ] Both new/updated assertions live in `useCalendar.test.ts`, not only the pure-helper
        test file.

## Batch: streaming (advisor)

- [ ] **BIN-513** [Tier A] `build` — `useServiceValue`'s "behåll eller säg upp" verdict only
      counts films (`status === 'sedd'`), so a TV-only-watched service is wrongly flagged
      dead weight. Scope: minimum guard (suppress the false verdict), full TV-hours rollup is
      a follow-up. Files: `src/hooks/useServiceValue.ts`, `src/lib/advisor/serviceValue.ts`
      (+ tests). Stakeholders: single · #24 Monetization/Partnerships. requiresPlanMode: no.
  - [ ] `isDeadWeight` is no longer asserted true for a service whose only usage is TV
        (nonzero follow/vill_se activity, zero film `'sedd'` titles) — either by folding TV
        `watchedAt` hours into the rollup or by suppressing the guard for TV-only usage.
  - [ ] A test proves a genuinely-unused service (no film AND no TV activity) is still
        flagged dead weight — the existing correct case is not broken.
  - [ ] `serviceValue.ts`'s doc comment stays accurate to whichever fix is chosen.

- [ ] **BIN-514** [Tier B] `build-review` — Surface three already-computed, already-tested
      advisor stats that render nowhere: `longestPauseDays`, `mostUsedProvider`,
      `freeSharerCount`. Zero new logic/queries — render-only + one field pass-through.
      Files: `src/components/watchlist/RotationCalendar.tsx`, `src/app/savings/page.tsx`,
      `src/lib/advisor/householdAggregate.ts` (+ HouseholdPanel component + its row/interface
      type). Stakeholders: single · #28 Recommendations/Scoring-Integrity. requiresPlanMode: no.
      **Sign-off reason:** ticket self-flags "needs sign-off" — the exact copy/placement of
      three new UI lines is Malin's call, not an engineering one. Parks In Review.
  - [ ] `longestPauseDays` renders in `RotationCalendar.tsx`'s sparat-i-år card.
  - [ ] `mostUsedProvider` renders on `src/app/savings/page.tsx`.
  - [ ] `freeSharerCount` is copied into the returned household row/interface and rendered
        in `HouseholdPanel`.
  - [ ] No new Firestore reads/writes were added — diff is render + one struct field only.

## Batch: frontend (design-system violations)

- [ ] **BIN-512** [Tier A] `build` — Two title pages bypass the canonical `NotFound`
      component with a raw div; `QuickAddButton`'s dropdown uses the disallowed `shadow-lg`
      instead of `shadow-pop`. Files: `src/components/pages/MoviePageClient.tsx`,
      `src/components/pages/TVShowPageClient.tsx`, `src/components/title/QuickAddButton.tsx`.
      Stakeholders: skip (trivial). requiresPlanMode: no.
  - [ ] `MoviePageClient.tsx`'s not-found return uses `<NotFound .../>`, not the raw div.
  - [ ] `TVShowPageClient.tsx`'s not-found return uses `<NotFound .../>`, not the raw div.
  - [ ] `QuickAddButton.tsx`'s dropdown uses `shadow-pop` (or `shadow-lift`), not `shadow-lg`.
  - [ ] No other `shadow-lg` / raw not-found divs were introduced elsewhere in the diff.

## Batch: data-functions

- [ ] **BIN-515** [Tier C — functions/** trigger, expanded plan required] `build` — Paginate
      `availableNotify` + `priceDropNotify`'s unbounded `collectionGroup('watchlist')` scans
      (BIN-294 fixed the sibling functions, missed these two). Files:
      `functions/src/availableNotify/index.ts`, `functions/src/priceDropNotify/index.ts`.
      Stakeholders: single · #13 Data/Integrations Engineer. requiresPlanMode: **yes**
      (functions/** tierCTrigger).
  - [ ] Both functions' `collectionGroup('watchlist')` queries use
        `orderBy(...).limit(PAGE_SIZE)` + `startAfter(cursor)`, looping until
        `snap.size < PAGE_SIZE` — mirroring the established `streamingOffers` pattern.
  - [ ] The existing `.where('status','in',…)` filter is unchanged.
  - [ ] A new test proves multi-page results are all collected (no behavior change to who
        gets notified — only bounded reads per query).

- [ ] **BIN-520** [Tier C — functions/** trigger, expanded plan required] `build` — BIN-507's
      two orchestration acceptance criteria (error-audit-on-throw, dry-run-resume) are only
      proven at the pure-helper layer, not against the real `tmdbTosSweep/index.ts` wiring.
      Do option (a) from the ticket: add the integration-level tests. Files:
      `functions/src/tmdbTosSweep/index.ts` (+ new test). Stakeholders: skip (trivial by
      router, but functions/** still forces the plan gate). requiresPlanMode: **yes**.
  - [ ] A test forces `q.get()`/`batch.commit()` to throw mid-run and asserts `stateRef`
        still receives a `lastRun` write (proves the real try/catch wiring, not just
        `buildLastRunAudit`'s output shape).
  - [ ] A test drives two dry-run invocations and asserts the second resumes past where the
        first left off (`dryRunCursor` persisted + read back).
  - [ ] No change to `mutateEnabled` — the sweep stays in count-only mode.

## Needs you (mandate gate — not selected, see Linear comments)

- **BIN-521** — Bundle-rådgivare nudge. Ticket self-declares "ren idé, kräver egen
  brainstorm/design innan bygge." Recommend: run its own `/stakeholder-review`
  (Monetization + Data/Integrations) before any code.
- **BIN-509** — Tillsammans session rules fix (real bug, Tier top/full-panel). Held for
  timing: `firestore.rules` already has BIN-505's uncommitted diff on disk. Build next,
  right after BIN-505 ships, with its own `/stakeholder-review`.
- **BIN-510** — Unbounded groups fan-out (real perf/cost issue, Tier top/full-panel). Held
  for timing: touches `WatchlistContext.tsx`, which BIN-505 has uncommitted changes in.
  Build next, right after BIN-505 ships, with its own `/stakeholder-review`.

## Deferred, no new judgment needed (already-decided in memory, left in Backlog)

BIN-517/BIN-516 (AuthContext.tsx bugs — file conflict with BIN-505, pick up next sprint),
BIN-402/454/468 (TMDB ToS sweep — Stage 2 shipped count-only, mutateEnabled deliberately
deferred to a real-traffic gate ~Aug), BIN-170 (Binge Wrapped — booked Nov), BIN-189
(Seasonal challenges — panel-approved for Aug/Sept build, not now), BIN-419 (SEO
re-measurement, not due until 2026-08-28).

## Obsolete (closed this sprint)

- **BIN-173** — Affiliate-tag rent/buy deeplinks. Already shipped 2026-07-12 (`fabf1b0`):
  `affiliateWrap` exists in `providers.ts`, wired into all 3 render sites, has its own test
  file. Closed Done with a comment; remaining step (Adtraction account signup) is Malin's
  ops, not tracked here.

## Post-sprint steps

1. `cfg.verify.analyzeCommand` (`npm run typecheck`) across all touched files.
2. File Linear follow-ups for anything deferred mid-implementation.
3. Commit through the review gates (code/security/test markers as triggered), conventional
   commit referencing all ticket ids.
4. Push (deploys on push) → poll `deploy.yml` → purge Cloudflare.
5. Transition: Tier A build + all-pass → Done. BIN-514 (build-review) → In Review regardless
   of pass/fail, with a note on what to look at.

## Deviation log

(none yet — filled in during execution)

---

# Archive — BIN-505 full plan (still in progress, not archived-as-done; kept here for
# continuity so it isn't lost if this file is next overwritten)

# BIN-505 — public-profile + watchlist-notes PII leak (APPROVED, in progress)

Full design + panel record: `tasks/bin-505-plan.md`. Router tier `top`; full panel
(Security #4, Legal/GDPR #5, DPO #6, DBA #27) convened + conditions folded. Malin
decisions 2026-07-14: **one full push** + **hide `myProviders` from everyone**.

## Approach (two tracks)
- **Track A — profile:** lock `users/{uid}` read to owner-only; serve public/friend
  viewers a positive-whitelist projection `publicProfiles/{uid}` (display fields only).
  Visibility gated LIVE via privileged `get(users/{uid})` in the projection read rule →
  no stale-public window. Owner best-effort sync via `updateUserField` funnel + load-time
  backfill. All ~12 foreign `users/{uid}` reads migrated to the projection helper.
- **Track B — notes:** move free-text `notes` off the public/friends-readable watchlist
  doc into owner-only `users/{uid}/watchlistNotes/{tmdbId}` (BIN-164 mirror). Atomic
  write (subcollection set + inline `deleteField`); rules block re-introducing a note;
  bounded eager migration on load.

## Progress
- [x] firestore.rules: owner-lock users read; `publicProfiles` match (live-gated read +
      value-bound write); `watchlistNotes` match; watchlist create/update notes-null guard.
- [x] `src/lib/firebase/publicProfile.ts` — projection read/write/backfill helper.
- [x] AuthContext owner sync + backfill effect.
- [x] Migrated 12 foreign reads: usePublicProfile, UserProfilePageClient, userSearch,
      username.ts (lookupUserByHandle + ResolvedUser), friends.ts listFriends, feed,
      useFollowList, TopbarActions, FriendsPageClient, ListPageClient, grupper,
      useFriendsWhoSaw.
- [x] WatchlistContext notes track (listener + join + atomic updateNotes + eager migration
      + removeItem cascade).
- [~] GDPR: userData.ts wiring (watchlistNotes subcollection + publicProfiles top-level) —
      IN PROGRESS; then dataExport export + accountDeletion erasure + dedicated tests.
- [ ] Eager admin backfill of `publicProfiles` for existing users (avoid blank profiles).
- [ ] Rules tests (firestore-rules.test.ts) — stranger/friend deny + projection allow.
- [ ] Docs: data-retention-policy, data-export-format, dated breach-assessment record.
- [ ] Gates (code/security/test review + /code-review + typecheck + tests + rules tests).
- [ ] Deploy: rules first (manual) → backfill → hosting workflow_dispatch → verify → purge.

## Acceptance criteria (panel conditions) — see tasks/bin-505-plan.md "CONDITIONS folded"
Unauthenticated read of users/{uid} DENIED; projection has no email/costs/hemkommun/
myProviders; watchlist read exposes no notes; owner still sees own data; export+erasure
cover publicProfiles + watchlistNotes (dedicated tests); breach record written.
