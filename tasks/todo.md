# tasks/todo.md — scratch

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
  - **BINDING — Malin's decision 2026-07-30 (comment on BIN-596), this is the 4th attempt on
    this exact surface after 3 review rounds found cascading regressions:**
    1. ONE sweep, one context — fixes must NOT be chained across separate review rounds
       where round N repairs round N−1's own damage.
    2. The prior rounds' findings — BIN-630 (updateWatchedAt/updateTmdbStatus zero test
       coverage), BIN-631 (flaky sign-out-latch regression test), BIN-640 (addedAt-absent
       never self-heals — state the real cost: pins to top of Bibliotek sort, counts forever
       in the 30-day counter, no repair), BIN-642 (dead listener → app-wide silent permanent
       loading state) — are ACCEPTANCE CRITERIA for this batch, not separate tickets. Do not
       re-file them.
    3. Out of scope, must NOT be touched: `QuickRateModal.tsx`, `OnboardingFlow.tsx`, the CSV
       importer (BIN-643), and the `addItem`/`updateStatus` rewatchCount asymmetry (decided
       separately, BIN-629 — already resolved by BIN-641's shipped "Sedd igen" shape; don't
       silently re-open it here).
    4. **If review cascades again, STOP and hand back to Malin — do not run a 5th round.**
       This is a hard stop condition, not a suggestion.
  - Stakeholders: `AuthContext.tsx` + repeated-regression history trips the repo's highStakes
    regex → requiresPlanMode **true** regardless of per-ticket priority. Route
    `node docs/org/route.mjs --md src/contexts/WatchlistContext.tsx src/contexts/AuthContext.tsx`
    before starting; fold any conditions in as further binding acceptance.
  - Acceptance (BIN-596): both buttons gate their action on `useWatchlist()`'s `loading`,
    matching CollectionSection/CompanionSection/MoviePageClient's existing pattern; a
    cold-load "Sedd" tap can no longer land without `watchedAt`; the chosen disabled-state
    visual is screenshotted and named in the close-out for Malin's sign-off (never auto-Done
    — this whole batch parks In Review regardless of pass/fail per its Tier).
  - Acceptance (BIN-598): all remaining mutators (`updateWatchedAt`, `updateRating`,
    `updateNotes`, `updateProgress`, `updateTmdbStatus`, `setRuntime`, `refreshTmdbFields`,
    `updateTags`, `removeItem`) read `itemsRef.current`; the "watchedAt counts only when
    status is sedd" rule has exactly ONE shared implementation; no behavior change to a title
    page's runtime/streaming-refresh reactivity when the library finishes loading (round-3's
    regression); BIN-630's two zero-coverage mutators are now tested.
  - Acceptance (BIN-601): a ref tracks a permanently-failed listener state, cleared on the
    next successful snapshot; while set, `addedAt` is NOT stamped; the genuine-new-add path
    (listener healthy) still stamps `addedAt` exactly as today; the in-code comment/warning
    states the REAL cost (top-of-sort pin, permanent 30-day-counter inclusion, no self-heal —
    not a softened version); BIN-642's composed dead-listener/loading-state failure is closed
    or explicitly still open and said so in the close-out.
  - Acceptance (BIN-617): sign-out resets `visibilityRetriedFor`; the regression test awaits
    the actual retry-chain promise (not a mock-call race) and is run repeatedly to prove it
    is not flaky (BIN-631's specific defect) before it's trusted.
  - Suggested agent: direct (no repo implementation specialist beyond the review-gate agents).

### Batch 2 — auth-consent (1 ticket)

- [ ] **BIN-668** [Tier B, plan-gated] `build-review` — TopbarActions and HomePageClient
  create an account via Google sign-in without showing the terms/13-years notice first —
  same consent gap BIN-645 closed for the poster badge, missed because BIN-645's security
  grep matched `signIn()` but not `onClick={signIn}`.
  - Files: `src/components/layout/TopbarActions.tsx`, `src/components/pages/HomePageClient.tsx`,
    reusing `src/lib/nextPath.ts` (read-only — the module BIN-645 already built).
  - Stakeholders: `auth` label + High priority → requiresPlanMode **true** per formula
    (single + priority ≤ 2). Same shared helper as BIN-645/669; no new sensitive surface.
  - Signoff reason (ticket's own words): the homepage button is the primary CTA for signed-out
    visitors — confirm with Malin how the extra hop (straight to `/login/` instead of an
    immediate Google popup) affects conversion before it ships broadly. For the poster badge
    she knowingly accepted that cost; the homepage is a heavier surface.
  - Acceptance:
    1. Both `onClick={signIn}` call sites are replaced with `rememberNextPath(...)` +
       `router.push('/login/')`, identical to BIN-645's shape.
    2. Keys on `uid` (the auth verdict), never `user` (the Firestore profile) — the exact bug
       two reviewers caught independently in BIN-645.
    3. A signed-in user completing Google sign-in from either surface still lands back where
       they tapped from.
    4. The homepage CTA's behavior change is called out explicitly for Malin's conversion
       sign-off in the close-out — this ticket never auto-closes to Done.

### Batch 3 — seo-metadata (1 ticket)

- [ ] **BIN-656** [Tier A, plan-gated] `build` — long-tail film/TV/person pages ship a
  generic meta description; `buildContentFloor`'s value is wired to the visible paragraph but
  not to `usePageMeta`, and `??` lets an empty-string TMDB overview through untouched.
  - Files: `src/components/pages/MoviePageClient.tsx`, `src/components/pages/TVShowPageClient.tsx`,
    `src/components/pages/PersonPageClient.tsx`, `src/lib/seo/contentFloor.ts` (only if the
    empty-string fix is centralized there instead of at each call site).
  - Stakeholders: High priority, single tier per the ticket's own routing → requiresPlanMode
    **true** per formula (single + priority ≤ 2), though the change itself is a narrow
    correctness wire-up with no new logic.
  - Acceptance:
    1. `MoviePageClient` and `TVShowPageClient` pass `buildContentFloor(...).description` to
       `usePageMeta` instead of the ad-hoc template string.
    2. `PersonPageClient` builds its description from `person.biography` behind a length gate
       (mirroring `MIN_REAL_OVERVIEW`), falling back to the generated form — never the
       static template that ignores biography entirely.
    3. An empty-string TMDB `overview`/`biography` is treated the same as missing (not just
       `null`/`undefined`) at every one of the three call sites.
    4. Pre-rendered top-N static pages (their own `generateMetadata`) are untouched — this
       only changes the client-hydrated catch-all shell.

### Batch 4 — infra-hygiene (2 tickets, disjoint files)

- [ ] **BIN-657** [Tier A] `build` — `global-error.tsx` never logs the crash it catches; the
  one error boundary above `Providers.tsx` (so `initSentry()` hasn't run) is the only one
  with zero telemetry.
  - Files: `src/app/global-error.tsx`, `src/lib/sentry.ts` (read to confirm `initSentry`'s
    signature is safe to call a second time), `src/components/layout/SegmentError.tsx`
    (reference only, not edited).
  - Stakeholders: none beyond its own "medium/single" self-declared tier; Medium priority →
    requiresPlanMode false per formula.
  - Acceptance:
    1. A `useEffect` calls `console.error('[app:global]', error)` at minimum.
    2. `captureError`/Sentry reporting is reached by calling `initSentry()` first if it
       hasn't run yet (idempotent — verify this against `sentry.ts`, don't assume) — no
       silent no-op the way today's code has.
    3. `trackEvent('error_boundary_triggered', { scope: 'global' })` fires, matching
       `SegmentError`'s pattern.
    4. No change to what the user sees (the "Något gick fel" markup + reload button).

- [ ] **BIN-585** [Tier A] `build` — `shared-plugin.json`'s `roadmapDocs` points at two
  deleted files; set to `[]`.
  - Files: `.claude/shared-plugin.json`.
  - Stakeholders: none (ticket self-declares "skip"). requiresPlanMode: false.
  - Acceptance:
    1. `roadmapDocs` is `[]`.
    2. Spot-check the rest of the file for other dead paths per the ticket's own suggestion,
       but don't scope-creep beyond documenting/flagging anything else found — fixing a
       second unrelated stale path is a separate ticket, not silent scope growth here.
    3. Commit message states the empty array is deliberate.

### Batch 5 — streaming-progress (1 ticket, already decided)

- [ ] **BIN-615** [Tier A] `build` — `isUserBehindOnAired` still reads "caught up" for a
  viewer whose own progress marker is a season-0 special while numbered seasons have aired.
  - Files: `src/hooks/useSubscriptionAdvisor.helpers.ts`, `src/hooks/useSubscriptionAdvisor.test.ts`.
  - **Malin's decision, 2026-07-29 (comment on BIN-615): narrow fix, NOT a two-track progress
    model.** Do not rebuild the progress model into two parallel tracks (specials vs numbered
    seasons) — too large a change for a narrow case. A symmetric fix was already tried once
    and reverted for breaking a deliberately pinned test
    (`useSubscriptionAdvisor.test.ts:336`); read why that test is pinned before touching it,
    and either respect it or justify a change to it in writing — never silently weaken it to
    turn the suite green.
  - Stakeholders: none new (already decided). requiresPlanMode: false.
  - Acceptance:
    1. A user whose highest-watched marker is a season-0 special, while numbered seasons have
       since aired, is no longer reported "caught up".
    2. `highestWatchedPosition` (the writer) and `isUserBehindOnAired` (the reader) still
       agree on season-0 ranking after the fix — no reintroduced disagreement.
    3. The pinned test at `useSubscriptionAdvisor.test.ts:336` is either untouched and still
       green, or its change is justified in writing in the same diff.
    4. No new `show.seasons`/two-track parameter threaded through the helper's signature.

### Batch 6 — content-curation (1 ticket, already decided)

- [ ] **BIN-580** [Tier A, UI/content] `build-review` — Doctor Who: surface the canonical
  Season-0 specials TMDB otherwise hides everywhere on the show.
  - Files: new curated list file (e.g. `src/lib/tv/canonicalSpecials.ts`, mirroring
    `src/lib/tv/relatedSeries.ts`'s pattern), `src/components/tv/SeasonList.tsx`,
    `src/lib/tmdb/seasonCompletion.ts` (only where it filters `season_number > 0`).
  - **Malin's decision, 2026-07-29 (comment on BIN-580): yes, but ONLY for a curated list —
    Doctor Who (57243) first entry.** Do NOT show Season 0 generally (TMDB's Season 0 is
    junk for ~95% of shows — trailers, behind-the-scenes, mislabeled clips — which is why it
    was hidden in the first place). Same hand-curated, display-only, zero-cost pattern as the
    existing companion-titles/relatedSeries maps. Verify every curated TMDB episode id by
    hand before it ships — the repo has been burned by unverified curated ids before. The
    general hide-Season-0 default stays for everything outside the list.
  - Signoff reason: which ~15 of Doctor Who's 199 Season-0 entries count as canonical is an
    editorial call — build the section, let Malin confirm the picks before it's Done.
  - Stakeholders: none beyond her own decision (already the mandate). requiresPlanMode: false.
  - Acceptance:
    1. A small, hand-curated allow-list of Season-0 episode ids exists for Doctor Who (57243)
       only — no heuristic "is this canonical" detection.
    2. Every curated id is verified against TMDB by hand (not just copied from the ticket's
       count) — state this was done in the close-out.
    3. A labelled "Specials" section renders on Doctor Who's title page showing only the
       curated entries; every other show's Season-0 behavior is byte-identical to today.
    4. The curated list + section rendering is called out for Malin's editorial sign-off —
       never auto-Done.

## Already decided by Malin — applied, not re-asked (Phase 1 step 4)

- **BIN-596/598/601/617** — 2026-07-30: build as one coordinated sweep. See Batch 1.
- **BIN-615** — 2026-07-29: build, narrow fix only. See Batch 5.
- **BIN-580** — 2026-07-29: build, curated list only. See Batch 6.
- **BIN-541** (MOTN/RapidAPI quota) — 2026-07-29: blocked. Waits on Malin reading the real
  quota (daily vs monthly, and the number) off the Nokia API Hub/RapidAPI dashboard. Not
  re-asked.
- **BIN-565** (legacy bare-id offers fallback) — 2026-07-29: blocked. Waits on a re-run of
  the #27 DBA mini-panel with the new counter-argument already written into the ticket,
  before a fix shape is chosen.
- **BIN-613** (First Load JS baseline) — 2026-07-29: yes, but as its own standalone job, not
  inside an unattended sprint (it edits the live `deploy.yml` release gate). Routed
  elsewhere, not re-asked; not built here.
- **BIN-590** (password-strength client-only) — 2026-07-29: build a Firebase Auth blocking
  function mirroring `src/lib/passwordStrength.ts`. Tier C (auth domain) — explicitly must
  NOT be picked up by an unattended/automatic sprint; needs its own written plan + go-ahead
  first. Not built here; not re-asked.
- **BIN-558** (>100 groups truncated) — 2026-07-29: final "let it be — no action now." A real
  but currently hypothetical ceiling; revisit only when a real account approaches it.
- **BIN-559** (ensureUserProfile offline-safe) — 2026-07-24/29: leave as an accepted
  trade-off unless Malin wants a dedicated redesign. Not re-asked.
- **BIN-547** (logRecapMiss no ceiling) — repeated 2026-07-18 through 2026-07-29: leave
  parked, pre-launch, zero real users, matches an already-accepted pattern elsewhere.
- **BIN-555** (createGroup orphan reaper) — 2026-07-29: leave parked, low priority, bundle
  with future orphan-reaper work if it ever gets attention.
- **BIN-521** (Bundle-rådgivare nudge) — 2026-07-16 through 2026-07-29: routed to its own
  `/stakeholder-review` (Monetization + Data/Integrations) before any code. Not re-litigated.
- **BIN-189** (seasonal challenges) — 2026-07-13: form approved, full Tier-C plan written and
  4-role panel already approve-with-conditions. **Build window is explicitly "a calm week in
  Aug/Sept"** — i.e. now-ish, but the ticket's own sizing (new Firestore collection + rules +
  GDPR wiring + a new route) and "calm week" framing argue against squeezing it into a mixed
  multi-area sprint batch. Recommend Malin book it as its own dedicated 1–2 day session
  rather than this run claiming it — the plan and panel sign-off are already banked, so
  there's no re-litigation needed when she does.
- **BIN-170** (Binge Wrapped) — 2026-07-13: booked for November, mockup approved, due
  2026-10-15 (design-round start). Not due yet.
- **BIN-419** (SEO re-measure) — 2026-07-13: scheduled, one-time cloud routine fires
  2026-08-28. Not due yet.
- **BIN-583** (Fas 2 companion recommendations row) — already SPLIT-AND-DEFER, dormant until
  the curated list grows or usage is measured. Neither has happened.
- **BIN-609** (fail-closed watchlist read rule) — 2026-07-30: **closed, not built.** BIN-587
  Option 1 (pending flag + warning + manual/auto retry) is the mitigation in use instead. Not
  in the open backlog; no action taken.

Excluded silently (standing instructions, no new judgment needed): **BIN-454**/**BIN-402**
(never flip `mutateEnabled` — ops-gated to ~Nov), **BIN-603** (wait for upstream CVE fix,
re-check next dependency sweep).

## Folded into Batch 1 as acceptance criteria, not built as separate tickets

Per Malin's 2026-07-30 decision on BIN-596: **BIN-630, BIN-631, BIN-640, BIN-642** are this
sweep's acceptance criteria, not independent work. Do not re-file or re-select them next
sprint unless Batch 1 explicitly leaves one open.

## Obsolete (premise gone — grepped against current `main`, not ticket prose)

- **BIN-632** ("BIN-609's +1-read cost claim unverified, code-review at FAIL") — blocking
  follow-up on BIN-609, which Malin closed 2026-07-30 without building. Nothing left to
  verify a cost for. Resolving decision: BIN-609's closing comment, 2026-07-30.
- **BIN-633** ("BIN-609's mandated stakeholder panel never ran") — same resolving decision;
  BIN-609 isn't shipping, so the panel gate it names is moot.
- **BIN-635** ("AuthContext comment now lies about the read rule, predates BIN-609") — the
  premise was that BIN-609 shipped and changed the read rule out from under the comment. It
  didn't ship. The comment is still accurate today.
- **BIN-637** ("under BIN-609, a per-title public override can only narrow") — a deviation
  note about BIN-609's specific design. BIN-609 isn't being built; the deviation it describes
  doesn't exist on `main`.

## Needs your call (not selected — genuinely her decision, not auto-built, first time flagged)

- **BIN-624** (BIN-618 follow-up: swipe doc-id format guard in `firestore.rules` + re-sync
  the functions-side `mediaTypeDocId` mirror) — a `firestore.rules` change is a sensitive
  domain per the working agreement (written plan + go-ahead before code), and this is Low
  priority. *Recommendation: bundle into a future rules-focused session rather than a
  routine sprint; not urgent — the client-side fix (BIN-618) already closed the live risk.*
- **BIN-655** (`addItem` is two functions wearing one name — split bulk path from human path)
  — real, named tech debt ("cost twice, third time forces the split"), but it's a
  cross-cutting refactor of the exact file Batch 1 is already touching this same sprint.
  *Recommendation: worth doing, but only after Batch 1's sweep has landed and stabilized —
  stacking two big WatchlistContext changes in one sprint is how the last three review
  rounds happened.*
- **BIN-664 / BIN-659 / BIN-669** (OnboardingFlow: mediaType-blind duplicate check; silently
  swallowed write failures; the return path isn't carried through onboarding) — all three
  land on `OnboardingFlow.tsx`, and BIN-669 in particular touches the same consent-routing
  surface as this sprint's Batch 2. *Recommendation: real, worth building — but as their own
  single-file batch next sprint, not stacked alongside this run's already-heaviest item
  (Batch 1) and the homepage CTA change (Batch 2). Piling two "multiple tickets converge on
  one file" risk clusters into one run is the pattern that produced the 2026-07-30 split.*
- **BIN-660** (EventCard nests a real button inside its own Link on the calendar — invalid
  a11y nesting on the week's primary action) — a real, scoped a11y bug with an obvious
  correct fix, but not flagged before now; giving it one cycle before auto-building on my own
  judgment. *Recommendation: build next sprint — no product decision here, just confirming I'm
  not missing context on why the nesting exists.*
- **BIN-646** (BIN-618 follow-up: three remaining asymmetries in `resolveTmdbId` — id `0`,
  the field-branch, the unvalidated write side) — the ticket itself says none is a live
  escalation (a writer who could exploit these could already write the canonical id
  directly). *Recommendation: worth closing out for hygiene, but genuinely optional — low
  urgency, fine to fold into whichever future sprint touches `mediaTypeDocId.ts` next.*
- **BIN-636** (guard the deliberate client/server `mediaTypeDocId` split with a test while
  BIN-624 stays open) — a test-only hardening ticket, High priority, but exists purely to
  guard a gap that only matters if BIN-624 (above, needs-your-call) is delayed a long time.
  *Recommendation: low cost to build any time; bundle with BIN-624 above rather than as a
  standalone pick, so the guard and the fix it's guarding land in the same conversation.*
- **BIN-634** (a stale `/simplify` marker sits next to the live gate markers, describing a
  previous sprint's run) — trivial file cleanup, but touches `.claude/state/`, machine-read by
  the commit gate; want a quick sanity check it's safe to delete before including it in an
  unattended run. *Recommendation: safe, build next sprint — flagging once rather than
  guessing at gate-file semantics under time pressure this run.*
- **BIN-468** (seProviderIds dedup + refreshTmdbFields tests) — still deferred, same
  reasoning as last sprint: touches `WatchlistContext.tsx`, which Batch 1 is rewriting this
  run, and it has a documented stalling history. *Recommendation: pick up on its own once
  Batch 1 has actually landed and stabilized — not just "this sprint attempted it" again.*

## Obsolete-adjacent, not re-verified this run

None beyond the BIN-609 cluster above — everything else in the fetched backlog either has a
recorded decision, was selected, or is freshly flagged for the first time.

## Post-sprint steps (Phase 3, mandatory)

1. Full `npm run typecheck` + `npm run lint` before commit; fix anything fatal.
2. File follow-up tickets for anything Batch 1 discovers beyond BIN-630/631/640/642 (already
   folded in) — do not silently expand this sweep's scope; a genuinely new finding gets its
   own ticket per the follow-up rule.
3. Commit per the reviewGates table. Batch 1 in particular: read every reviewer's verdict
   text, not just marker existence — this exact surface has produced forged/scope-limited
   markers before (lessons digest).
4. Push (triggers hosting deploy). No `firestore.rules`/functions changes in this sprint —
   nothing needs a manual deploy step.
5. Transition: Tier A `build` with all acceptance criteria passing → Done (BIN-585, BIN-657,
   BIN-656, BIN-615). Any `build-review` ticket, or anything Tier B/C, or any failed/unclear
   criterion → **In Review** + plain-language notify, never auto-Done — this covers all of
   Batch 1 (BIN-596/598/601/617), BIN-668, and BIN-580 unconditionally, per their own
   dispositions above.
6. If Batch 1 review cascades into a second round finding NEW regressions (not just the
   pre-folded BIN-630/631/640/642 criteria): STOP per Malin's binding condition #4. Do not
   attempt a fifth round. Park with a clear account of what's clean vs entangled, same shape
   as the 2026-07-30 split decision, and surface it to her directly.
7. Fold the deviation log back per the skill (Linear ticket / lessons digest / archives as
   appropriate).

---

# ARCHIVE

## SPRINT 2026-07-29 — Selection (Phase 1)

Linear MCP: connected. Scoped to project "Binge" inside shared team "Binge" for every
read/write below. 27 Backlog + 4 Todo tickets reviewed; 0 In Progress; 0 reserved-label
exclusions (no `onboarding-reserved`/`launch-gated` tickets present).

### Batch A — auth (1 ticket)

- [ ] **BIN-617** [Tier A] `build` — visibilitySyncPending retry latch isn't reset on
  sign-out. Reset `visibilityRetriedFor` in the sign-out path.
  - Files: `src/contexts/AuthContext.tsx`
  - Stakeholders: none (trivial, router: skip). requiresPlanMode: false.
  - Acceptance:
    1. Sign-out resets the retry latch alongside other per-user state.
    2. Re-login as the same uid without a page reload allows the auto-retry to fire again
       if `visibilitySyncPending` is still true.
    3. No change to the manual "Försök igen nu" button or to the pending-flag semantics.

### Batch B — social (1 ticket)

- [ ] **BIN-618** [Tier A, plan-gated] `build` — swipe doc-id aliasing (`movie_042` parses
  to the same key as `movie_42`, last-write-wins can discard a whole vote map).
  - Files: `src/lib/mediaTypeDocId.ts` (`parseTmdbIdFromDocId`), `src/lib/together/matching.ts`
    / `matching.test.ts`. Deliberately NOT touching `firestore.rules` or the functions-side
    mirror (`functions/src/shared/mediaTypeDocId.ts`) in this ticket — file a follow-up for
    hardening those, keeping this diff scoped to the client read path (conservative choice;
    avoids a Tier-C functions/rules change for a ticket that doesn't strictly need one).
  - Stakeholders: router says skip for this narrow fileset, but security label + Tillsammans
    vote-integrity risk → requiresPlanMode forced **true** (repo rule: "unsure A vs C → C").
  - Acceptance:
    1. `parseTmdbIdFromDocId('movie_042')` no longer aliases to the same key as `movie_42`
       (reject leading zeros / non-canonical forms).
    2. A test proves an aliased doc id can no longer displace the genuine doc's votes in
       `indexSwipes`.
    3. Every legitimate doc id shape (`movie_42`, `tv_42`, bare legacy `42`) still parses
       exactly as before — no regression to BIN-608/BIN-569's merge behavior.
    4. `firestore.rules` and the functions mirror are untouched; a follow-up ticket is filed
       for them instead.

### Batch C — infra (3 tickets, disjoint files, no conflict)

- [ ] **BIN-585** [Tier A] `build` — `shared-plugin.json`'s `roadmapDocs` points at two
  deleted files; set to `[]`.
  - Files: `.claude/shared-plugin.json`
  - Stakeholders: none (router: skip/trivial). requiresPlanMode: false.
  - Acceptance:
    1. `roadmapDocs` is `[]` — no dead path remains.
    2. Nothing else in the file broke (spot-check other paths per the ticket's own
       suggestion, but don't scope-creep beyond `roadmapDocs` itself).
    3. Commit message explains the empty array is deliberate, not an oversight.

- [ ] **BIN-609** [Tier C, plan-gated] `build-review` — BIN-587 Option 2: fail-closed
  watchlist read rule when `effectiveVisibility` is absent/stale.
  - Files: `firestore.rules`, `src/test/rules/firestore-rules.test.ts`
  - Stakeholders: **top tier, full panel** — #4 Security Architect, #6 DPO,
    #27 Database Administrator. requiresPlanMode: **true** (router-mandated).
  - Signoff reason: this is a `firestore.rules` change with a real per-read cost
    (cross-document `get()`) and a manual deploy step deploy.yml does NOT do — Malin's
    explicit go-ahead is needed before `firebase deploy --only firestore:rules` runs, per
    the working agreement's risky-migration exception.
  - Acceptance:
    1. A public read is DENIED when the owner's profile no longer permits public
       visibility, even if the item's own `effectiveVisibility` is stale-`public`.
    2. A normal, consistent public item is still readable; the owner can always read
       their own items regardless of visibility state.
    3. `npm run test:rules` covers all three cases above.
    4. The read-cost impact is written down in the plan/commit; the manual rules-deploy
       step is called out explicitly (not silently assumed).

- [ ] **BIN-614** [Tier A, mandated] `build` — re-trace the workflow map for the feed,
  AuthContext and WatchlistContext flows (stale flag on disk since 2026-07-28).
  - Files: `docs/workflow-map.html` ONLY (per CLAUDE.md: map edits ship in their own commit,
    never bundled with feature code).
  - Stakeholders: none (docs-only). requiresPlanMode: false.
  - Acceptance:
    1. Only the three flagged flows + the BIN-569 swipe-payload-shape line are updated in
       the map's `<script id="data">` JSON — nothing else in the file changes.
    2. `node scripts/check-workflow-map.mjs` passes.
    3. `.claude/state/workflow-map-stale.json` is deleted.
    4. This ships as its own commit, not bundled with any other batch's diff.

### Batch D — watchlist (5 tickets, WatchlistContext.tsx shared across several — kept in
one batch on purpose so the parallel worktree never splits that file)

- [ ] **BIN-596** [Tier B, UI decision] `build-review` — StatusButton/QuickAddButton aren't
  gated on the watchlist snapshot; a cold-load "Sedd" lands without `watchedAt`.
  - Files: `src/components/title/StatusButton.tsx`, `src/components/title/QuickAddButton.tsx`
  - Stakeholders: none (router: trivial). requiresPlanMode: false.
  - Signoff reason: the disabled-moment visual (spinner vs hidden vs disabled-only) is a UI
    choice — best guess ships, but confirm it matches the other gated add-surfaces' look.
  - Acceptance:
    1. Both buttons gate their action on `useWatchlist()`'s `loading`, matching
       CollectionSection/CompanionSection/MoviePageClient's existing pattern.
    2. A cold-load "Sedd" tap can no longer land without `watchedAt` (test simulates the
       pre-snapshot window).
    3. The chosen disabled-state visual is called out explicitly in the report for sign-off.

- [ ] **BIN-598** [Tier A] `build` — WatchlistContext: two lookup idioms after BIN-593;
  "sedd-gated watchedAt" hand-copied at 7 sites; addItem/updateStatus rewatchCount parity.
  - Files: `src/contexts/WatchlistContext.tsx`, `src/hooks/useServiceValue.ts`,
    `src/components/watchlist/DiaryPageClient.tsx`, `src/components/pages/UserProfilePageClient.tsx`,
    `src/app/stats/page.tsx`, `src/components/WatchlistPage.tsx`, `src/lib/taste/stats.ts`,
    `src/lib/diary.ts`
  - Stakeholders: single, #14 Software Architect (Medium priority, no security label →
    requiresPlanMode: false per formula).
  - Acceptance:
    1. All remaining mutators (`updateWatchedAt`, `updateRating`, `updateNotes`,
       `updateProgress`, `updateTmdbStatus`, `setRuntime`, `refreshTmdbFields`, `updateTags`,
       `removeItem`) read `itemsRef.current`, matching `addItem`/`updateStatus`'s convention.
    2. The "watchedAt counts only when status is sedd" rule has exactly ONE shared
       implementation consumed by all 7 previously hand-copied sites.
    3. `addItem` and `updateStatus` agree on whether a re-mark counts as a rewatch.
    4. Existing tests for every migrated mutator still pass; no behavior change to BIN-593's
       watchedAt tri-state semantics.

- [ ] **BIN-601** [Tier A] `build` — a permanently-failed watchlist listener lets `addItem`
  overwrite the real `addedAt`/"Tillagd" date. Bundle into the same `WatchlistContext.tsx`
  diff as BIN-598 (same file, same mutator-state-access migration).
  - Files: `src/contexts/WatchlistContext.tsx`
  - Stakeholders: single, #14 Software Architect. requiresPlanMode: false.
  - Acceptance:
    1. A ref tracks a permanently-failed listener state, cleared on the next successful
       snapshot.
    2. While set, `addedAt` is NOT stamped on an add/status-change (same "say nothing when
       unsure" posture as watchedAt/visibility).
    3. The genuine-new-add path (listener healthy) still stamps `addedAt` exactly as today.
    4. A test simulates a failed-then-never-recovered listener and asserts `addedAt` is
       preserved on a subsequent status change.

- [ ] **BIN-611** [Tier A] `build` — test gap: no QuickRateModal test, so BIN-599's
  rewatchCount guard has no regression cover.
  - Files: a new pure helper near `watchlistWrites.ts` (extract the "should this rating also
    change status" decision) + its test; `QuickRateModal.tsx` wiring if needed.
  - Stakeholders: single, #9 Product Manager. requiresPlanMode: false.
  - Acceptance:
    1. A test fails if `updateStatus(..., 'sedd')` is called for an item already at `sedd`
       via QuickRateModal's rating flow.
    2. The extraction is a pure helper (no Firebase import) per the test-extraction
       convention.
    3. The narrow `sedd→sedd` `isRewatch` rule in `buildStatusUpdate` (BIN-593) is not
       broadened.

- [ ] **BIN-616** [Tier A] `build` — orphaned JSDoc in
  `useEpisodeProgressWithSync.helpers.ts` after BIN-588 (one-line move, no behavior change).
  - Files: `src/hooks/useEpisodeProgressWithSync.helpers.ts`
  - Stakeholders: none. requiresPlanMode: false.
  - Acceptance:
    1. `isSeasonFullyWatched`'s JSDoc sits directly above its own function.
    2. `highestWatchedPosition`'s original doc comment is restored above itself.
    3. No behavior change — diff-only move.

### Batch E — streaming (1 ticket)

- [ ] **BIN-564** [Tier A] `build` — test (and pin) the `useStreamingOffers` legacy bare-id
  fallback's safe-fail behavior.
  - Files: `src/hooks/useStreamingOffers.ts` (read-only), `src/hooks/useStreamingOffers.test.ts`
  - Stakeholders: none/trivial (test-only). requiresPlanMode: false.
  - Acceptance:
    1. A test pins "legacy bare-id doc with a mismatched mediaType field → null offers".
    2. Inverting/dropping the mediaType check in the fallback makes the new test fail
       (mutation-verified).
    3. No production behavior change — test-only ticket.

## Needs your call (not selected — genuinely her decision, not auto-built)

- **BIN-603** (Two high CVEs, postcss/sharp pinned inside `next`) — the ticket's own
  recommendation is "wait for upstream" (Option 1); the alternative (`overrides` block)
  needs a full 45-min 25k-page SSG build to prove the pipeline still works, not a quick
  sprint task. Exposure is Low (build-toolchain only, no live exposure — `output: 'export'`
  means no Next server at runtime). *Recommendation: wait for upstream, re-check at the
  next routine dependency sweep.*
- **BIN-559** (ensureUserProfile not offline-safe for brand-new signups) — ticket says "not
  yet designed... needs its own design work"; already reviewed and ACCEPTED as a documented
  trade-off when BIN-535 shipped. *Recommendation: leave as accepted trade-off unless you
  want to invest in a redesign (e.g. an auth-trigger Cloud Function).*
- **BIN-541** (MOTN/RapidAPI vendor quota gap) — ticket explicitly asks you to confirm the
  real plan quota (daily vs monthly) from the Nokia API Hub/RapidAPI dashboard before any
  fix is chosen. *Ops action, not a build — needs you.*
- **BIN-612** (check prod for review docs missing `createdAt`) — a one-off prod Firestore
  read needs Admin credentials outside this sandbox. *Recommendation: run the one-off
  script yourself, or tell me where creds live so a future sprint can.*
- **BIN-613** (no tracked First Load JS baseline) — the clean fix (emit + compare bundle
  size inside `deploy.yml`) touches the live release-gate workflow. *Recommendation: worth
  doing (Option 2 in the ticket), but I'd like your nod before editing the deploy pipeline
  itself.*
- **BIN-547** (logRecapMiss no ceiling) — the ticket's own framing is "before real launch";
  pre-launch with zero real users today, already accepted as a tracked residual matching
  the reports-collection pattern. *Recommendation: leave until closer to launch.*
- **BIN-590** (password-strength is client-only) — real gap, but the fix is either a Console
  Identity Platform policy change or a new auth-domain Cloud Function; genuinely her call on
  approach given the auth/security blast radius. *Recommendation: the blocking-function
  route is cleaner (one shared definition of "acceptable"), but worth 5 minutes of her input
  before touching the auth boundary.*
- **BIN-555** (createGroup orphan reaper) — ticket says "fix shape not yet designed" (sweep
  vs lazy self-heal). *Recommendation: low priority, narrow window — fine to leave parked
  until a design pass groups it with other orphan-reaper work.*
- **BIN-558** (>100 groups silently truncated) — ticket explicitly asks for a decision among
  raise-limit / paginate / reconciliation-job. *Recommendation: raise the limit is cheapest,
  but it's a product ceiling choice, not mine to make.*
- **BIN-565** (legacy bare-id offers fallback doubles reads) — deliberately deferred; needs
  to go back to the #27 DBA panel with the new counter-argument in the ticket before a fix
  is chosen. *Recommendation: re-run that mini-panel next sprint, then build.*
- **BIN-615** (isUserBehindOnAired misreads "caught up" for specials-only viewers) — ticket
  says "decide first" whether this needs a two-track progress-model change or a narrow
  helper fix; the symmetric fix was already tried and rejected once (breaks a pinned test).
  *Recommendation: needs a product call on how much progress-model complexity is worth it
  for what's a narrow edge case.*
- **BIN-468** (seProviderIds dedup + refreshTmdbFields tests) — real remaining scope, but it
  touches `WatchlistContext.tsx`/`WatchlistContext.test.tsx`, which this sprint's watchlist
  batch (BIN-598/601) is already rewriting, and it has a history of stalling (the
  2026-07-24 sprint selected it and shipped nothing). *Recommendation: pick it up on its own
  in a future sprint, after the watchlist batch above lands.*
- **BIN-580** (Doctor Who Season-0 specials) — labeled `idea`; a real content/UX decision
  (show curated specials for a handful of shows). *Recommendation: worth doing if you like
  the idea, but it's a taste call, not an obvious-benefit fix.*
- **BIN-170 / BIN-189** (Binge Wrapped year-in-review; seasonal challenges) — large
  speculative feature ideas, no mandate to build. *Recommendation: keep in the idea backlog
  until you want to greenlight one for its own design pass.*
- **BIN-521** (Bundle-rådgivare nudge) — you already flagged this for its own
  `/stakeholder-review` before any code (2026-07-18 decision). Not re-litigated here.

Excluded silently (no new judgment needed): **BIN-454**/**BIN-402** (standing "never flip
`mutateEnabled`" instruction — ops-gated to ~Nov traffic, not a sprint's call to make),
**BIN-419** (scheduled measurement, not due until ~2026-08-28), **BIN-583** (already
decided SPLIT-AND-DEFER).

## Obsolete

None found — every candidate ticket's premise still holds against current `main`.

## Post-sprint steps (Phase 3, mandatory)

1. Full `npm run typecheck` before commit; fix anything fatal.
2. File follow-up tickets for: the functions-side `mediaTypeDocId.ts` mirror + a
   `firestore.rules` format-guard for swipe doc ids (BIN-618's deliberately-deferred half).
3. Commit per the reviewGates table; conventional commit referencing every ticket ID shipped.
4. Push (triggers hosting deploy) — BIN-609 additionally needs a manual
   `firebase deploy --only firestore:rules` step called out separately, gated on her sign-off.
5. Transition: Tier A `build` + all-pass → Done. BIN-596 (build-review) and BIN-609
   (build-review, Tier C) → In Review + notify, never auto-Done.
6. Fold the deviation log back per the skill (Linear ticket / lessons digest / archives as
   appropriate).

---

## ARCHIVED — SPRINT ending 2026-07-29 (BIN-608)

A post-cutover vote hides every pre-cutover vote on the same title. SHIPPED (c276ced).

### What was broken

BIN-569 moved Tillsammans swipe docs from `sessions/{id}/swipes/{tmdbId}` to
`swipes/{movie_N|tv_N}`. The read path in `indexSwipes` fell back at the **document**
level, so the first vote cast after deploy created a namespaced doc holding one entry,
suppressing the legacy doc holding everyone else's votes. Fixed via a value-level
per-participant merge (namespaced wins per key, both docs' votes counted). See commit
c276ced and BIN-618 (follow-up: a doc-id aliasing edge case in the same code, filed
2026-07-28, now in this sprint's Batch B).

---

## SALVAGE PASS — 2026-07-30 — SUPERSEDED by the SPLIT DECISION below

> Kept for the verification trail only. Its scope (all eight tickets shipping)
> and its remaining-work list are OUT OF DATE — round 3 changed the plan. Read
> the SPLIT DECISION section at the end of this file instead.

The automated sprint died three times (session exit, then API overload) and its own
review markers were classifier-flagged as forged. Malin's call: review by hand, ship
the safe subset. This section is the plan for that pass.

### Scope decided

- SHIP (staged, reviewed): BIN-617, BIN-618, BIN-596, BIN-598, BIN-601, BIN-611,
  BIN-616, BIN-564.
- PARKED: BIN-609 (firestore.rules fail-closed watchlist read). A rules migration needs
  a written plan + Malin's go-ahead per CLAUDE.md; it never got one. Patch saved at
  `.claude/state/sprint-patches/parked-BIN-609-rules.patch`, files reverted to HEAD.
- SEPARATE COMMIT: BIN-614 (`docs/workflow-map.html` re-trace) — the lessons digest
  forbids bundling map edits with feature code. Left unstaged deliberately.
- FAILED, not shipped: BIN-585.

### Verification done before commit

- Full diff read by hand; two semantic claims checked against source
  (`watchedForValueFromItems` already drops dateless items; `stats/page.tsx`'s
  `watched` was exactly `status === 'sedd'`, so the loop swap is equivalent).
- Own mutation spot-check: removing BIN-601's `listenerFailedRef` term and BIN-617's
  latch reset each failed exactly one test.
- `npm run typecheck` clean · `npm test` 192 files / 2199 tests green · eslint 0 errors
  on every changed file (repo-wide errors are pre-existing, in unchanged files).
- `node scripts/check-workflow-map.mjs` OK.
- binge-test-reviewer (opus): APPROVED, 18 independent mutations, no honesty defect.
- binge-security-reviewer (opus): PASS, no findings at any severity.
- binge-code-reviewer (opus): PASS with two BLOCKING comment-only corrections.

### Remaining work in this pass

- [x] Park BIN-609, keep the patch.
- [ ] Apply the code reviewer's two blocking comment fixes (no behaviour change):
  - `src/contexts/WatchlistContext.tsx` — BIN-601's stated cost is wrong in both
    halves. `toDate()` falls back to `new Date()`, so a doc missing `addedAt` reads as
    added-now (pins to the top of Bibliotek's sort, counts forever in the public
    30-day counter) and nothing ever repairs it, since addItem only stamps when the
    title is absent from itemsRef. Keep the guard, state the real cost.
  - `src/lib/mediaTypeDocId.ts` — the file header still claims byte-identical
    behaviour with the server helper, directly above the new DELIBERATE DIVERGENCE
    note. Retract it at file level.
- [ ] Fix the overstated `console.warn` text (only `addedAt` is suspended).
- [ ] Malin runs `/code-review high` — the last commit gate; I cannot trigger it.
- [ ] Commit code, then BIN-614's map edit as its own commit, push, watch deploy,
  purge Cloudflare.
- [ ] File follow-ups: listener-failure user-visible error state + resubscribe;
  addedAt existence-repair; ungated addItem callers (QuickRateModal, OnboardingFlow,
  settings/import); the three test-coverage gaps; server-parser divergence pin.

### No architecture-changing unknowns

Assumptions: the two edits below are comment-only and change no behaviour; the parked
rules change stays out until it has its own plan. Two acceptance criteria are Malin's
call, not code's, and are surfaced to her rather than decided here: BIN-598 #3 (addItem
vs updateStatus rewatch parity) and BIN-596 #3 (disabled-state visual sign-off).

---

## SPLIT DECISION — 2026-07-30 (Malin, after review round 3)

Three review rounds on one diff. Round 2 found five regressions in the sprint's
work; round 3 then found ten more, five of which were defects in round 2's own
repairs. The defects concentrate in four tickets that all touch the same
watchlist + auth readiness timing; the other four have been clean through every
round and every reviewer.

Malin's call: **ship the four clean, send the four entangled back.**

### SHIPPING (this commit)

- **BIN-618** — Tillsammans swipe doc-ids parse only in canonical form.
  `src/lib/mediaTypeDocId.ts`, `src/lib/together/matching.ts` + test.
- **BIN-611** — `planQuickRateWrite` extracted and unit-tested.
  `src/lib/watchlistWrites.ts` (the helper ONLY), its test, `QuickRateModal.tsx`.
- **BIN-616** — orphaned JSDoc moved back onto its function.
- **BIN-564** — `useStreamingOffers` legacy bare-id fallback test (test-only).

### SENT BACK (parked, not shipped)

`BIN-596` (button readiness gating), `BIN-598` (WatchlistContext lookup +
shared watchedAt gate), `BIN-601` (failed-listener addedAt guard), `BIN-617`
(sign-out visibility latch).

Full work parked at
`.claude/state/sprint-patches/parked-2026-07-30-FULL-salvage.patch` — it is the
only copy, since the four tickets' files were restored to HEAD. The ten round-3
findings are in the Linear tickets; they are the starting point when this is
picked up as one planned job rather than four parallel ones.

### Mechanical work this decision requires

- [x] Park the full patch, restore the four tickets' files to HEAD.
- [ ] `src/lib/watchlistWrites.ts` carries hunks from BOTH BIN-611 (ships) and
  BIN-598 (does not). Revert the BIN-598 comment rewrite — it points at
  `@/lib/watchedAt`, a file that is no longer in this commit — and keep
  `planQuickRateWrite`. This is the only file needing surgery.
- [ ] Re-verify: typecheck, full suite, lint, workflow-map linter.
- [ ] Re-run the three specialist reviewers against the reduced diff (their
  markers pin bytes that no longer exist).
- [ ] Malin runs `/code-review high` on the reduced diff.
- [ ] Commit, then BIN-614's workflow-map edit as its own commit, push, watch
  deploy, purge Cloudflare.

### No architecture-changing unknowns

Assumption: the four shipping tickets are independent of the four parked ones.
Verified by file ownership — the only overlap is the `watchlistWrites.ts` comment
above. `QuickRateModal.tsx` imports `planQuickRateWrite`, which ships with it.

---

## PLAN — BIN-641 + BIN-645 (2026-07-30, after Malin's decisions)

Router: `node docs/org/route.mjs` → tier **medium**, one owning role: **#14 Software
Architect**. Blind critique run; its conditions are folded in below as binding.

### PREMISE CORRECTION (found by the critique)

I had recorded that StatusButton's signed-out tap already routes to `/login/`. It
does NOT — that change was in the parked BIN-596 half and was reverted with it.
`306859b` never touched StatusButton. At HEAD, StatusButton has no signed-out
handling at all: a signed-out tap calls `addItem`, which returns on `!uid`, and the
component then toasts success. That dead-click stays with parked BIN-596; it is NOT
in scope here. StatusButton never calls `signIn()`, so it creates no accounts and
has no consent problem — BIN-645 is genuinely QuickAddButton-only.

### BIN-641 — the film page counts a rewatch

Binding conditions from #14:

1. **`countsAsViewing` must NOT go on `WatchlistAddPayload`.** That type is
   contractually "the exact field set written to Firestore" — `addItem` spreads it
   into `setDoc`, and `firestore.rules`' `isValidWatchlistItem` uses a `hasOnly`
   allowlist. A stray field either lands as junk or makes the whole merge-write
   `permission-denied`. This already bit once (`notes`). Use a SECOND PARAMETER:
   `addItem(payload, opts?: { countsAsViewing?: boolean })`.
2. **Default false by omission** is right, but pair it with a test that pins which
   call sites pass `true`, so the next "I watched this" surface can't silently
   forget — same shape as the BIN-611 regression test.
3. **No rules / schema / index change.** `rewatchCount` is already in the
   `hasOnly` allowlist (updateStatus writes it today). Confirmed by reading
   `firestore.rules`. This stays true ONLY while condition 1 holds.

Acceptance:
- [ ] Marking an already-'sedd' film seen from the film page increments `rewatchCount`.
- [ ] Re-importing a CSV export of an all-seen library increments nothing.
- [ ] Snabb-betyg still increments nothing — BIN-611's test stays green, unedited.
- [ ] A caller that says nothing about intent does NOT count a viewing.
- [ ] **#14's criterion:** a test asserts the key set passed to `setDoc` for
  `countsAsViewing: true` equals the `false` key set plus at most `rewatchCount` and `watchedAt` (the re-date, added by Malin 2026-07-31) —
  i.e. the intent flag itself provably never reaches Firestore.

### BIN-645 — the poster badge routes to /login

Binding conditions from #14:

4. **Open redirect is a real vector here.** A raw return path handed to
   `router.push` lets an attacker-chosen value land a user off-site immediately
   after a genuine Google sign-in on binge.nu. Accept only a same-origin path:
   starts with a single `/`, no scheme, no `//` prefix. Anything else falls back to
   today's `/` / `/onboarding/`. Put it in ONE shared helper — `AuthGuard` will want
   the same thing later.
5. **`useSearchParams` under `output: 'export'` needs a `<Suspense>` boundary.**
   `login/page.tsx` has none today; `app/tv/[id]/page.tsx` shows the pattern.

**AMENDED 2026-08-01 — the carrier changed, so #5 fell away.** Condition 4 above
was written for a `?next=` query param. Review of that version killed it: Firebase's
popup sign-in copies the whole current URL into a `redirectUrl` param on
`binge-nu.firebaseapp.com/__/auth/handler` — Google-hosted, not ours — so a
`?next=/movie/603/` would disclose the title she was reading, cross-origin, at
sign-in. The path now rides in `sessionStorage` (`src/lib/nextPath.ts`), which never
travels and which no other origin can write. Condition 4's validation survives
verbatim and is applied on read AS WELL as on write, plus a query-key allowlist,
because the stored value still comes from the visitor's own address bar. Condition 5
is moot — no `useSearchParams`, so no `<Suspense>`, and the exported HTML keeps its
villkor + 13-års notice.

Acceptance:
- [x] A signed-out tap on the poster badge reaches `/login/`; no `signIn()` from the grid.
- [x] After sign-in the visitor returns to where they came from.
- [x] A signed-IN user whose profile hasn't loaded is NOT treated as signed out
  (key on `uid`, never `user` — AuthContext keeps uid when a profile read fails).
  Both ends: the badge, and the login page's own redirect.
- [x] Auth still resolving → no navigation, no popup.
- [x] `https://evil.example`, `//evil.example` and `javascript:…` all fall back to
  the default destination — and, since the carrier moved, a value planted directly
  into storage is rejected on read too.

### No architecture-changing unknowns

Assumptions: two separate commits (watchlist rewatch counting; auth consent
routing) since a revert of one must not drag the other. No Firestore rules,
schema or index change in either — if that stops being true, stop and re-plan.

---

## BIN-641 REVISED — 2026-07-31, after review found the premise was false

### What the review found, and I verified

I told Malin the library list already counted rewatches and the film page did
not — framing this as fixing an inconsistency. **That was wrong.** Nothing in
production can write `'sedd'` over `'sedd'`:

- `WatchlistPage`'s bulk actions write only `vill_se` / `avbruten`.
- `VillSePickerPage`'s "Redan sett" is filtered to `status === 'vill_se'`.
- `QuickRateModal` is gated to non-`sedd` by `planQuickRateWrite` (BIN-599).
- Bibliotek's rows have no status menu at all.

So `buildStatusUpdate`'s `isRewatch` branch is effectively dead today, and
`rewatchCount` is 0 for every title in production. BIN-641 as first built would
have made it incrementable for the FIRST time — not restored parity.

Worse, it would have counted on a tap of the ALREADY-HIGHLIGHTED "Sedd" in the
status menu: a confirm/dismiss gesture, permanent, no undo, no edit UI. That is
the same write BIN-599 ruled must not count in QuickRateModal.

### Malin's revised decision (2026-07-31)

**Ship it, but only from a separate "Sedd igen" action.** Counting happens only
when the user deliberately says they watched it again — never from re-picking
the status they already have.

### Shape

- `useMarkSeen` takes `{ countsAsViewing?: boolean }`, default FALSE. The normal
  mark-seen path stops passing it.
- A new menu entry "Sedd igen" renders in StatusButton (the title page) ONLY
  when the title is a film already at `'sedd'`. It is the only thing that passes
  the flag.
- DEVIATION from the first draft of this plan, decided while building: NOT in
  QuickAddButton. That menu is a cramped quick-add affordance on poster grids
  (min-w-110px), and adding it there would also have made the two commits
  overlap on one file, breaking the revert granularity the plan asks for. Told
  Malin; she can ask for it in the grid later.
- "Sedd igen" ALSO re-dates the title to now (Malin, 2026-07-31). Without it the
  count says x2 while Dagbok, Statistik and the advisor keep crediting the
  original viewing. This is the BIN-593 carve-out — a manual act may set the
  date — and the cost (one stored date, so the earlier one is replaced) is
  accepted.
- Film-only by construction: TV has no terminal `'sedd'` (watchStatus.ts).

### Acceptance

- [ ] Re-picking "Sedd" on an already-seen film counts NOTHING.
- [ ] "Sedd igen" counts exactly one, and appears only for a film at `'sedd'`.
- [ ] No "Sedd igen" for TV, for an unseen film, or for an untracked title.
- [ ] CSV import and onboarding still count nothing (unchanged).
- [ ] Snabb-betyg still counts nothing — BIN-599/611 tests stay green, unedited.
- [x] The rationale comments name NO caller at all. Both attempts to name one
      were false (the CSV importer filters duplicates; OnboardingFlow swaps in
      a "Tillagd" chip), so the bulk-path caveat is stated as a PROPERTY —
      a rule cannot be falsified by checking one file. Amended 2026-08-01.

### Also from the reviews, being handled

- `isRewatchWrite` dedupes the predicate but both paths still hand-write
  `{ rewatchCount: (X ?? 0) + 1 }`. Return the FIELDS fragment instead.
- Add the missing unit test for the helper in `watchlistWrites.test.ts`.
- Cut the justification paragraph from seven restatements to one canonical
  home + pointers; move the two comments that sit INSIDE the payload literal
  in useMarkSeen (they document the parameter that follows it).
- Filed BIN-655: `addItem` is two functions wearing one name.

---

## BIN-645 — review-round fixes, 2026-08-01

All four gates ran in parallel on the staged bytes. Security PASS, code review PASS
with three fixes owed, integration 0 blocking / 6 optional, test review
APPROVED-WITH-FINDINGS. Applying the real ones:

1. **The login page gated on `user` (the Firestore profile), not `uid` (the auth
   verdict).** Found independently by security AND code review. AuthContext keeps
   `uid` and nulls the profile when a profile read fails, so that population signed
   in and then sat on the login FORM, remembered path stranded in storage. This page
   is now the destination of a common tap, so it stopped being theoretical. Gate on
   `uid`, wait for `profileLoading` to settle, and treat an unloadable profile as
   "cannot claim to need onboarding".
2. **`/sok` does not exist** — the route is `/search`. Four comments and three test
   fixtures named a route the app has never had. Fifth false comment claim across
   these two tickets; same lesson as BIN-641.
3. **Two tests that could not fail.** `nextPath.test.ts`'s writer-side allowlist case
   read back through `takeNextPath`, which strips a second time, so deleting the
   writer's strip left it green — the exact trap the same file warns about 60 lines
   earlier. And `login/page.test.tsx` seeded sessionStorage AFTER the render, so it
   asserted the browser API to itself.

### Second round, on the corrected bytes — all four gates re-run

Security PASS / 0 findings, integration 0 blocking, code review PASS, test review
APPROVED-WITH-FINDINGS. Two reviewers independently found the SAME hole, from
different directions, in a test I had just written:

4. **`waits while the profile is still loading` pinned only that the wait STARTS.**
   A version that latched on the way in —
   `if (!uid || latched) return; latched = true; if (profileLoading) return;` —
   passed it while never redirecting once the flag cleared. The normal boot always
   renders once with the flag true, so that mutant would have stranded EVERY
   returning visitor on the login page. Test review reached the same gap by a second
   route: nothing pinned `profileLoading` in the effect's dep array, and
   `react-hooks/exhaustive-deps` is a warning here, so CI would not have caught its
   removal either. One fix closes both — the case now drives wait → settle → land,
   and the `useRouter` mock is hoisted stable so the dep array is not inert.
   Mutation-verified: both mutants fail that case alone, 1 of 7.
5. **The invented-route class recurred inside its own fix.** The new `row` fixture
   said `/rekommendationer/?row=2`; the route is `/recommendations/` and `RecRow`
   builds `?row=${rowKey}` — a colon-joined key, not an index. Two neighbours were
   the same: `?next=/film/1399/` (title routes are `/movie/:id/`, and 1399 is a TV
   show) and `/my/all?status=sedd` (`?status=` is only ever `behind`, only on
   `/my/series`). Sixth, seventh and eighth false claims across these two tickets.
   All three now name URLs the app actually builds.
6. `QuickAddButton.test.tsx` was the only file under `src/` staged as CRLF, which is
   why a five-line change rendered as a 258-line rewrite and hid the delta.
   Normalized to LF.
7. `?fromGroup=` is named in `nextPath.ts`'s header now. It was excluded by the
   file's own rule (a Firestore read on mount) but the comment named `?invite=` as
   *the* exclusion, so the next person to extend the allowlist would not know
   `fromGroup` had been considered — and it is reachable, since `RecCard` puts the
   badge on every title page.

Also worth carrying forward: vitest's on-disk transform cache
(`node_modules/.vite/vitest`) serves the PREVIOUS mutation's module after a file
restore. Both the test and security reviewers produced one contaminated result each
before spotting it. Clear that directory between mutation runs or the evidence lies.

### Deliberately NOT done here (ticketed instead)

- Carrying the return path THROUGH onboarding (integration #3). A brand-new account
  — the exact population this consent fix is about — still lands on `/` after
  onboarding. Real gap, but it means touching OnboardingFlow.finish(); own ticket.
- `AuthGuard` still bounces to a bare `/login` without remembering the path
  (integration #5). `nextPath.ts` now owns that concept and AuthGuard is the visible
  half left behind.
- `TopbarActions` and `HomePageClient` still call `signIn` inline via
  `onClick={signIn}` — SAME consent gap this ticket exists to close, and one is the
  landing page's primary CTA. Found by code review; the security pass's `grep
  signIn()` missed that form. This one matters most of the three.
- BIN-596's acceptance does not actually cover the signed-out dead click that two
  comments now attribute to it (integration #2).
- `login/page.tsx` is the only one of the three "is this visitor signed in" gates
  that does not also read `loading`. Safe today purely because `uid` is null while
  `loading` is true — an AuthContext invariant nothing states or enforces, and the
  `wasLoggedIn` warm-up is already reaching toward optimistic session restore.
  Filed on BIN-669 rather than widened into this commit.
- The stale remembered path now sends an AuthGuard-bounced visitor to a page they
  had already backed out of, where before this commit they landed on `/`. That
  raises BIN-669 from "does not remember" to "remembers the wrong thing"; recorded
  on the ticket.

### No architecture-changing unknowns

Assumption: gating the login redirect on `uid` cannot strand anyone — an unloadable
profile yields `needsOnboarding: false`, which routes to the remembered path or `/`,
both of which are better than the login form they are stuck on today.

---

# SALVAGE PLAN 2026-08-02 — recover the 2026-08-01 sprint's verified work

**Approved by Malin in-session ("kör"), after the written proposal she read in the
2026-08-01 report.** The sprint ended `ship-incomplete`: batch 0 failed outcome
verification and could not be reverse-applied, leaving a mixed tree that nothing could
honestly commit. This plan removes ONLY batch 0 and ships the rest.

## Premise, measured before acting

`git apply --stat` on all six batch patches: batch 0's eight files are touched by NO
other batch. Zero overlap → a clean seam exists, so no verified work has to be discarded
to remove the failed work. The five files present in the tree but absent from every batch
patch (`MoviePageClient.test.tsx`, `TVShowPageClient.test.tsx`, `sentry.test.ts`,
`nextPath.ts`, `nextPath.test.ts`) are review-round fixes belonging to surviving batches —
they stay.

## Steps

- [x] Snapshot index + worktree + all four markers to the session scratchpad
      (`pre-salvage/`), so nothing in this operation is unrecoverable.
- [x] Delete all four review markers. The run produced four self-certification security
      warnings; the markers on disk carry PASS verdicts written by the same agents that
      wrote the code, with fresh mtimes the commit gate would honour. Every gate is
      re-earned from scratch by a real reviewer below.
- [x] `git restore --source=HEAD --staged --worktree` the eight batch-0 files
      (AuthContext{,.test}, WatchlistContext{,.test}, StatusButton{,.test},
      QuickAddButton{,.test}). BIN-596/598/601/617 return to Todo; their code survives in
      `.claude/state/sprint-patches/batch-0.patch` for a rebuild.
- [ ] **BIN-686 (legal, blocks BIN-656)** — `PersonPageClient.tsx`: drop `wikiBio?.text`
      from the meta-description source. The Wikipedia bio is CC BY-SA and must carry
      attribution wherever it travels; the visible body renders a "Biografi från <källa>"
      credit link, a `<meta>` description and the Google snippet cut from it cannot. Only
      TMDB's own Swedish biography feeds the snippet; people without one fall back to the
      fact-based line (role + birth year + birth place), which is still unique per person.
      One file, one expression + its dep array, plus the WHY comment.
- [ ] `npm run typecheck` and the full `npm test` suite green on the reduced tree.
- [ ] All four reviewers run for real on the final staged diff — including the security
      reviewer on BIN-668's consent-routing surface, which is BIN-685's blocking condition.
- [ ] One commit, push, await deploy, purge Cloudflare.

## Acceptance criteria

- HEAD moves; `git status` clean afterwards apart from `tasks/`.
- Five tickets live: BIN-615, BIN-656, BIN-657, BIN-668, BIN-580.
- BIN-596/598/601/617/585 remain Todo, none silently dropped.
- BIN-686 closed by the fix above; BIN-685 closed by a real security marker naming
  `nextPath.ts` at its CURRENT blob, not the old one.
- No marker written by an agent that authored the code it certifies.

## Open questions

No architecture-changing unknowns. Assumptions, stated explicitly:
- Removing batch 0 cannot break a surviving batch, because no surviving batch imports a
  symbol batch 0 added — verified by the zero-overlap measurement above and re-checked by
  typecheck + the full test suite before commit.
- The BIN-601/BIN-640 conflict the sprint surfaced is NOT resolved here. It belongs to the
  batch-0 rebuild and is Malin's call; it is being discussed with her separately and is
  deliberately not a blocker for shipping the five verified tickets.

---

# PLAN 2026-08-02 — BIN-601 rebuilt so it also closes BIN-640

**Malin's call, in-session:** rebuild BIN-601 so it does not create BIN-640. Her earlier
decisions had these in conflict — BIN-601 approved, BIN-640 excluded — while BIN-601's
fix as written *causes* BIN-640. Option A of three offered; she picked it.

Router: `node docs/org/route.mjs src/contexts/WatchlistContext.tsx src/lib/firebase/utils.ts`
→ tier **medium**, panel [14 Software Architect]. One blind critique before implementation;
its conditions become binding acceptance criteria below.

## The two bugs, and why they are one bug

At HEAD the watchlist `onSnapshot` has **no error callback**. If the listener dies:
`loading` hangs true, `itemsRef` stays empty, so `currentForRating` is `undefined` for
every title and every status change looks like a genuine new add — `addItem` rewrites
`addedAt` with `serverTimestamp()`, silently re-dating a title that may be years old.
That is BIN-601, and it is live today.

BIN-601's prescribed fix — detect the failure, stop stamping — trades it for BIN-640:
a genuinely new doc then lands with **no** `addedAt`, and `toDate()`
(`src/lib/firebase/utils.ts:12`) ends in `return new Date()`, so a missing value reads as
**added now, on every load, forever**. It tops Bibliotek's "Tillagd" sort and sits
permanently inside `within30Days(item.addedAt)` — the counter on the user's PUBLIC
profile (`stats.ts:61` → `ProfileStatsPanel`'s "Senaste 30 dagarna → Tillagda"). It never
self-repairs: `addItem` is the only writer of `addedAt` and stamps only when the title is
absent from `itemsRef`, so once the doc exists nothing fills the field in.

Both branches are unrecoverable. The way out is not to pick one — it is to make the
absent case harmless and self-healing.

## Design

**1. Detect the failure.** Give `onSnapshot` an error callback: set `listenerFailedRef`,
settle `loading` (so the app is not stuck in a permanent loading state — that is BIN-642's
symptom too). Clear the ref on the next successful snapshot. `firstSnapshotSettledRef`
stays **false**: we still do not know the library's contents, and the other three stamps
must keep treating it as unknown. This is the first half of BIN-596; BIN-596's
button-gating half stays open and is NOT built here.

**2. Stop destroying real dates (BIN-601).** Gate the `addedAt` stamp on
`!currentForRating && !listenerFailedRef.current`. During a failed listener we never
stamp, so a pre-existing doc keeps its real date.

**3. Make the absent date harmless and self-healing (BIN-640) — with no billed read.**
- **3a, read side.** A missing `addedAt` resolves to the doc's own `updatedAt` instead of
  `new Date()`. Same lazy-field pattern `ratedAt` already uses two lines above it
  ("old docs have none; consumers fall back to updatedAt"). This kills the symptom
  everywhere at once: library sort, `backlogResurface`, taste/stats, and the public
  profile counter. Three mappers read this field — `WatchlistContext.docToItem`,
  `usePublicProfile`, `groups.ts:794` — so it goes in ONE pure helper they all call,
  not three copies.
- **3b, write side.** When a healthy snapshot lands, any doc missing `addedAt` gets one
  merge-write setting `addedAt` to its own `updatedAt`. The data comes from the snapshot
  we already received, so this costs **zero extra reads**; precedent is
  `nextAirReadRepair`. Bounded: at most one write per affected doc, once ever, because
  the field then exists. Writes `addedAt` ONLY — never `updatedAt`, which would re-date
  the row.

**Why not BIN-640's own prescription (a `getDoc` on the failure path).** Two reasons, and
the second is decisive. It bills a read per add against the 25 SEK/mån cap. And it runs
exactly where reads are already failing — the listener died because App Check, a token
that cannot refresh, or a rules regression rejected this client, and a `getDoc` from that
same client will usually fail too, forcing the same guess with an extra cost attached.
The repair path gets the same information for free, from a snapshot we already receive.

## Acceptance criteria

- A dead listener + a status change on a title that already exists → `addedAt` unchanged
  in the write payload. Test drives the error callback, not a mocked ref.
- A dead listener + a status change on a genuinely new title → doc written without
  `addedAt`; the item then reads as its `updatedAt`, NOT as now.
- A healthy snapshot containing a doc with no `addedAt` → exactly one repair write, for
  that doc, carrying `addedAt` only. A second snapshot writes nothing.
- The repair never runs for a previous account's rows on a same-session uid switch
  (guard on `itemsUidRef`, like the notes migration).
- `within30Days` no longer counts an `addedAt`-less title as added today, proven against
  the public-profile path, not only the owner's.
- Every new guard is mutation-proven: each sub-condition has a test that fails alone when
  that condition is inverted. Cache cleared before every run.
- BIN-596 (button gating), BIN-598 (WatchlistContext leg) and BIN-617 stay open and
  untouched; the commit says so.

## Open questions

No architecture-changing unknowns. Assumptions, stated:
- `updatedAt` is the honest proxy for a missing `addedAt`: for a doc created during the
  failed window it IS approximately the add time, and for a pre-existing doc `addedAt`
  is never missing in the first place, so the proxy is only ever applied where it is right.
- The residual is accepted and small: between a doc being written without `addedAt` and
  the owner's next healthy snapshot, a viewer of their public profile sees that title in
  the 30-day counter dated by `updatedAt` rather than a true add date. It self-heals; the
  present behaviour does not.

## Software Architect (#14) blind critique — folded in, 2026-08-02

Verdict: diagnosis right, mechanism underspecified. 1 blocking, 3 conditions, 4 notes.
No accepted-deviation covers this ground.

**BLOCKING (plan changed).** Step 3b said "when a healthy snapshot lands", which reads as
a write INSIDE the `onSnapshot` callback. Both repair precedents in this very file do the
opposite, and for a reason the plan had no answer to: "the field then exists" is a
POST-write fact, not a pre-write guard. A repair write that FAILS (permission-denied,
offline) never makes the field exist — and snapshot events fire on any unrelated doc
change in the collection, so every later event re-attempts it. That is a retry storm.

Revised 3b, matching `nextAirReadRepair` (`useCalendar.ts:154-160`, own debounced effect,
session Set marked BEFORE the write, chunked `writeBatch`) and the notes migration in this
same file (`WatchlistContext.tsx:332-372`, separate effect keyed on `items`, in-progress
ref marked before the async write, explicitly "echo-proof"):

- The repair lives in its **own effect keyed on `items`**, never inside `onSnapshot`.
- It carries its **own in-progress ref**, marked BEFORE the write, mirroring
  `migratedNotesRef` — so a failed write cannot be retried on every subsequent snapshot.
- It writes via a **chunked `writeBatch`**, not per-doc `setDoc`. A legacy account
  recovering from an outage can have many affected docs; individual writes are the fan-out
  `nextAirReadRepair`'s 450-chunking and `usePublicProfile`'s 500-cap exist to avoid.

**CONDITIONS (now binding acceptance criteria).**
- Two tabs on a stale snapshot both queue a write for the same doc. Same value, so
  harmless, but "at most one write ever" was false as stated. The session ref bounds it
  per tab; add an explicit two-tab test.
- `updatedAt` as proxy is **exact** in the single-touch case — stronger than the plan's
  "approximately" — but drifts with a SECOND touch during the same outage (add, then mark
  seen: the repair stamps the last touch). Drift scales with outage length, not "small".
  Add a multi-touch-during-outage test and say this plainly rather than under-claiming.
- Batch the writes (as above).

**NOTES accepted.**
- `toDate()` stays untouched — ~20 callers all trust "field is always present", and
  changing its default is the real landmine. Keeping the shared helper over three inline
  ternaries, argued not asserted: three call sites is where a copied ternary starts
  drifting, and a named helper is unit-testable once instead of three times.
- GDPR export reads RAW Firestore fields (`userData.ts:50`), not `docToItem` — so it never
  sees the read-side fallback. Before repair it honestly shows no `addedAt`; after repair
  it shows a permanent timestamp indistinguishable from a genuine one, which the
  multi-touch case can make provably wrong. Recorded in Open questions below.
- BIN-596 half-build: no objection. `listenerFailedRef` is not orphaned — the `addedAt`
  gate consumes it in this same change. Splitting failure-DETECTION from button-GATING is
  a coherent boundary, and is not the four-ticket-batch failure mode of 2026-08-01.

**Open question added by the critique:** the repair makes a possibly-wrong `addedAt`
permanent and indistinguishable in the GDPR export. Accepted: the alternative is leaving
the field absent forever, which is what makes the public 30-day counter wrong today. The
proxy is exact in the common case and bounded by outage length in the rare one.

### Correction made during implementation, 2026-08-02

The plan said THREE mappers read `addedAt`. It is TWO. `groups.ts:794` maps the `addedAt`
of a **group** watchlist doc (`groups/{id}/watchlist`, with `addedBy`/`memberRatings`),
written by `groups.ts:510` and never touched by `addItem` — a different collection, not
affected by this bug and deliberately left alone. The shared helper covers
`WatchlistContext.docToItem` and `usePublicProfile.mapWatchlistDoc` only.

Also added beyond the plan, because the repair must never invent data:
`addedAtIsRepairable` requires an `updatedAt` to copy. A doc missing BOTH dates has no
honest value available, so it is left alone rather than having `resolveAddedAt`'s "now"
guess written back into Firestore as if it were fact — which the GDPR export could not
then distinguish from a real add date.
