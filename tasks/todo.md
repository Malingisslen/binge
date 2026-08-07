# BIN-815 — make the hanging build say what it is stuck on (2026-08-07b)

Tier `medium`, panel `[3 Financial Controller]`, router re-run at HEAD on the actual
files. **The critique ran today and is on the ticket**; its conditions are this plan's
acceptance criteria, not a separate step.

## Scope — deliberately points 1 and 4 only

The critique's binding condition 1 is explicit: *ship the observability alone first, land
it, and use the next real hang to identify what is actually stuck before building retry or
concurrency changes on speculation.* So:

- **Point 1 (observability)** — built here.
- **Point 4 (cache survives a failed build)** — built here. Cheap and strictly better than
  today regardless of what the hang turns out to be.
- **Point 2 (per-fetch timeout + retry)** — NOT built. The critique found the ticket's
  premise factually false at HEAD: `buildFetch.ts` already applies a 20 s
  `AbortSignal.timeout` to every build-time fetch, through an abort-aware semaphore. A
  45–175 minute hang is happening *despite* a 20-second per-call ceiling, so the stuck
  thing is not an unbounded TMDB fetch. Adding a retry here would spend Actions minutes on
  the wrong layer.
- **Point 3 (lower concurrency)** — NOT built. Same reason: speculation until point 1
  reports.

## What changes

### A. `src/lib/tmdb/buildFetch.ts` — a watchdog heartbeat

A module-level in-flight map plus one `setInterval` per worker process printing, every
30 s:

```
[build-fetch] pid=1234 inflight=2 fetched=418/1500 oldest=41s
[build-fetch]   STUCK 41s  params:popular-movies/p3
```

The diagnostic value is in the line it prints when **nothing** is in flight — but that
inference is only sound if every build-time call is registered. The timer is `.unref()`ed.

### B. Register the calls that actually run in the phase that hangs

All three `generateStaticParams` that make network calls in `Collecting page data` —
`movie/[id]` (1000 list fetches), `tv/[id]` (1000) and `person/[id]` (~2100 via
`collectPersonIds`) — call `startBuildWatchdog()` and wrap their fetches in
`trackBuildCall`. The other four (`provider`, `genre`, `billigaste`, `forsvinner`) are
static lists with no network.

`sitemap.ts`'s copy is deliberately NOT instrumented: it runs in a later phase. The
watchdog outlives that boundary, so a hang there still prints `inflight=0` — recorded in
`buildFetch.ts` so nobody reads that line as proof.

### C. `.github/workflows/deploy.yml` — save the TMDB cache when the build fails

`actions/cache/restore` + `actions/cache/save` with
`if: always() && steps.tmdb-cache.outputs.cache-primary-key != ''`, keyed on
`run_id`-`run_attempt`. The guard states the real precondition — the restore step ran, so a
key exists. A step that was never *reached* has an EMPTY conclusion, not `'skipped'`, so the
obvious-looking `conclusion != 'skipped'` check would have been a tick that never fires.

**Honest limit, recorded in the workflow comment:** `timeout-minutes` sits on the Build
*step*, not the job, and there is no job-level cap — so `always()` steps do run and the save
almost certainly fires on the 2026-08-07 event. Still to be confirmed on the next real hang
rather than assumed.

## It took three review rounds to instrument the right file

Worth recording, because two of the three wrong answers looked obviously right.

- **Round 1** registered only `fetchForBuild`, and started the watchdog only on a cache
  *miss*. On a warm cache — the regime a code deploy runs in — no timer existed at all.
- **Round 2** registered the sitemap and gave its ~4000 previously-unbounded calls a
  `buildSignal()`. Both wrong. `sitemap.xml` has no dynamic segment, so it runs in
  *Generating static pages*, not the phase that hangs. Worse, `AbortSignal.timeout` starts
  counting at **creation**: creating 2000 signals in one synchronous burst behind an 8-slot
  semaphore aborts most of them while still queued. A reviewer measured it against the real
  semaphore — 64 dispatched, 146 aborted of 210 — which would have shipped a sitemap with
  **zero** `/person/` URLs. That change is fully reverted.
- **Round 3** instrumented `movie/[id]` and `tv/[id]` `generateStaticParams`. **Round 4**
  added `person/[id]`, which the integration reviewer caught as the biggest caller in that
  phase (~2100 calls) — and gave aggregate labels their own stuck threshold, because two
  reviewers independently noticed that a healthy build would otherwise print STUCK every
  tick and train the reader to ignore the line.

The stakeholder critique's premise — "a 20 s timeout already applies to every build-time
fetch" — is still not quite true (the sitemap's list calls have none), but round 2 proved
that adding one naively is worse than leaving it. That is now its own question, not this
ticket's.

## Acceptance criteria

- [x] A heartbeat every 30 s during `Collecting page data`, including when zero fetches are
      in flight and on a fully warm cache. [tests in buildFetch.test.ts + titleParams.watchdog.test.ts]
- [x] The heartbeat **repeats** — a one-tick-then-die watchdog is indistinguishable from
      today's silence. [mutant kills 6 tests]
- [x] `movie/[id]`, `tv/[id]` and `person/[id]` register their fetches; unwrapping one
      route's `trackBuildCall` fails exactly that route's tests and leaves the siblings
      green. [mutation-verified]. `startBuildWatchdog()` in those routes is belt-and-braces
      and deliberately NOT separately pinned — the first `trackBuildCall` starts the same
      singleton interval, so the call is inert by construction.
- [x] A stuck call is named with its label and its age, and the age grows across ticks.
- [x] The STUCK list is capped at 5 **oldest** plus a count. Reversing the sort fails a
      test, and so does sorting by label instead of by age — the fixture's names run
      backwards against their ages on purpose. [mutation-verified]
- [x] An aggregate label (`params:person-ids`, ~2100 calls, no 20 s ceiling of its own) has
      its own generous threshold, so a healthy build never prints STUCK for it — while a
      real hang still does. [mutation-verified]
- [x] The watchdog timer is unref'd. [mutant kills 1 test]
- [x] `trackBuildCall` registers, names and de-registers on both success and throw, and
      costs no refresh budget. [4 tests]
- [x] Retries are NOT added; `networkFetches`, `refreshBudget()` and the 1500 default are
      untouched. [critique conditions 2, 3, 5]
- [x] `TMDB_BUILD_REFRESH_BUDGET` and the 175-minute timeout are untouched.
      [critique condition 6]
- [x] `sitemap.ts` and `seoPersonIds.ts` are back at HEAD — round 2's change to them was a
      regression, not an improvement.
- [x] The cache is saved on a failed build step, keyed per attempt, and the workflow states
      that survival of a hard timeout kill is unverified. [critique condition 4]

## Still owed after this ships

The critique's condition 1 stands: **use the next real hang to identify the culprit before
building retries or a concurrency change.** This batch buys the evidence; it does not claim
to fix the hang.

---

# Sprint 2026-08-07 — selection

Fourth pass in three days on a backlog that's mostly self-referential process debt
(the sprint engine reviewing its own review mechanics). Comments were read on all 45
open candidates before anything was judged — 19 already carry a recorded decision from
Malin, 1 is an unanswered parking brake, 2 are now obsolete (their fix landed under a
different ticket today), and 14 needs-approval items are real but not clearly hers to
want built right now. 10 tickets selected across 6 disjoint-file batches.

## Batch A — watchlist (agent: direct)

Same domain, kept together on purpose (per the 2026-08-06 sprint's own reasoning): all
three touch watched/progress semantics, and a cross-batch conflict there would be
silent, not a merge error.

- [ ] **BIN-655** [Tier B · build · Malin: "BYGG" 2026-08-06] `addItem` is two functions
  wearing one name — split the bulk-import path from the human mark-seen path.
  Files: `src/contexts/WatchlistContext.tsx`, `src/lib/watchlistWrites.ts` (+ tests).
  Acceptance:
  - Two distinct entry points exist (bulk/sync vs. human mark-seen) instead of one
    `addItem` inferring intent from opts flags. [diff]
  - Bulk callers (CSV import, onboarding, Collection/Companion "add all") never count a
    rewatch or re-stamp `watchedAt`/`ratedAt`. [diff]
  - All existing call sites migrated to the correct entry point; typecheck + full suite
    green. [diff]

- [ ] **BIN-679** [Tier C · build-review · requiresPlanMode · Malin: "bygg" 2026-08-06]
  Let curated Season-0 specials (Doctor Who 2005) be marked watched without regressing
  the progress marker.
  **Write a short plan block here before touching code** (watch-status-model-adjacent,
  a CLAUDE.md sensitive domain) — her "bygg" approved the feature, not a skipped plan.
  Files: `src/contexts/WatchlistContext.tsx` (`updateProgress`), the BIN-580 specials
  section component, `src/hooks/useSubscriptionAdvisor.helpers.ts` (read-only), tests.
  Acceptance:
  - A written plan for the model change is recorded here before code. [diff]
  - Ticking a curated special never regresses `lastWatchedSeason/Episode`,
    `continueWatching`, or group progress sync for an otherwise-caught-up title. [diff]
  - "Samla klart" meter inclusion/exclusion of specials is an explicit, documented
    choice. [diff]
  - Parks In Review for Malin's visual sign-off (UI-visible). [run]

- [ ] **BIN-689** [Tier A/B · build-review · single #28 pending · Malin: "JA — bygg,
  eget litet pass" 2026-08-06] BIN-598 part 2 — centralize the "watchedAt counts only
  when status is sedd" predicate (7 hand-copied call sites).
  Files: `src/hooks/useServiceValue.ts`, `src/components/watchlist/DiaryPageClient.tsx`,
  `src/components/pages/UserProfilePageClient.tsx`, `src/app/stats/page.tsx`,
  `src/components/WatchlistPage.tsx`, `src/lib/taste/stats.ts`, `src/lib/diary.ts`, new
  shared helper under `src/lib/`.
  Starting point: stash `7d56bff15021ef21cbaf54822f95bad988e4c89a` (9 files, previously
  reviewer-approved) — verify against current main before reusing, don't apply blind.
  Acceptance:
  - Predicate extracted to ONE shared helper (test-extraction pattern). [diff]
  - All 7 listed call sites migrated to it; the two documented "leave alone" spots
    (UserProfilePageClient's in-place sort, `/stats`'s legacy "Sedd" counter) stay
    untouched. [diff]
  - A test kills the mutant "remove the sedd-gate". [diff]
  - Parks for #28 Recommendations / Scoring-Integrity Engineer sign-off before Done
    (router: single, this batch can't convene it). [run]

## Batch B — data (agent: direct)

- [ ] **BIN-646** [Tier B · build · Malin: "bygg den nu ändå" 2026-08-06 — router
  confirms `skip` on the real files] mediaTypeDocId rest: validate the write side (2
  of 3 original points already shipped by hand in `a4a1470`).
  Files: `src/lib/mediaTypeDocId.ts`, `src/lib/watchlistWrites.test.ts`.
  Acceptance:
  - `mediaTypeDocId()`'s write path rejects/normalizes a non-canonical id instead of
    silently producing a doc-id its own reader later refuses (~90 call sites — bound
    the change to id normalization, not new throw-everywhere behavior without a
    fallback). [diff]
  - The missing `planQuickRateWrite` zero-discovery-value test case
    (`src/lib/watchlistWrites.test.ts:264`) is added. [diff]
  - `mediaTypeDocId.parity.test.ts` and `mediaTypeDocId.test.ts` stay green — the
    client/server divergence this ticket's siblings (BIN-624/759) depend on is not
    accidentally re-closed. [diff]

- [ ] **BIN-814** [Tier B · build-review] `watchlist.providers` has two writers with
  different definitions of "providers" (title page: all 5 categories incl. rent/buy;
  taste backfill: subscription-only 3) — content depends on who ran last, and it can
  silently change what counts as a "vill se"-anchor in the subscription advisor.
  Default direction (no recorded decision, so picking the one BIN-468 already pinned):
  **option 1 in the ticket** — broad definition (incl. rent/buy) wins; the taste
  backfill stops writing the field and reads it instead.
  Files: `src/lib/tmdb/seProviderIds.ts`, `src/lib/taste/backfill.ts`, both title-page
  call sites, tests.
  Acceptance:
  - Exactly one writer for `watchlist.providers`/`providersCheckedAt`; the taste
    backfill reads via the shared helper instead of deriving its own subset. [diff]
  - A test pins that re-running the backfill after a title-page visit doesn't narrow
    the stored provider set. [diff]
  - `useSubscriptionAdvisor`'s `hasWillSeeAnchor` behavior is called out explicitly in
    the diff/commit (it's the one advisor-facing consequence of this choice). [diff]
  - Parks In Review — the definition choice has a small user-facing advisor effect, so
    Malin should see which of the 3 options got picked before it's Done. [run]

## Batch C — social (agent: direct)

- [ ] **BIN-766** [Tier B · build-review · single #27 pending · Malin: "egen
  granskningssession med #27 först, sedan bygg" 2026-08-06] `communityRatings` reuses
  the watchlist doc-id verbatim — a malformed id splits a title's rating average in two.
  Files: `functions/src/communityRatings/logic.ts`, `logic.test.ts`, `index.ts`
  (delegates only — `index.ts` imports firebase-admin, untestable in root vitest).
  Starting point: stash `441bf4df1d04155d987712e58222b77af1ccd4e4` (3 files, previously
  built) — verify against current main, don't apply blind; last outcome-verification
  said `data-safety=fail` for an unknown reason, re-check before reusing wholesale.
  Acceptance:
  - Rating-aggregate doc id is derived via `mediaTypeDocId(pathMediaType,
    parseTmdbIdFromDocId(docIdRaw))`, not the raw watchlist doc-id. [diff]
  - A malformed legacy id (e.g. `movie_042`) now aggregates into the SAME bucket as the
    canonical id for that title. [diff]
  - Parks for #27 Database Administrator / Data-layer Engineer sign-off before Done
    (router: single, this batch can't convene it) — including their open question about
    the `firestore.rules:250` doc-id form check. [run]

## Batch D — auth-frontend (agent: direct)

- [ ] **BIN-813** [Tier A · build] Delete-account flow: a second "Radera igen"
  click after the token has aged past ~5 min can hit the pre-check branch, which
  always says "Ingenting har raderats" even when the cascade already ran.
  Files: `src/components/settings/DeleteAccountSection.tsx`,
  `DeleteAccountSection.test.tsx`.
  Acceptance:
  - The pre-check branch remembers (session-scoped) that a deletion cascade was already
    attempted, and drops the "Ingenting har raderats." promise clause on a subsequent
    rejection instead of repeating a claim that may now be false. [diff]
  - The "Försök igen" button's re-entry into this flow is covered by a test. [diff]
  - BIN-777's existing exact-string tests still pass (no accidental copy regression on
    the branches this doesn't touch). [diff]

## Batch E — infra (agent: direct, requiresPlanMode)

- [ ] **BIN-815** [Tier C · build-review · requiresPlanMode] Deploy build hangs in
  "Collecting page data" — 4 of 6 runs on 2026-08-07 timed out rather than failing fast.
  Files: TBD after investigation — likely `.github/workflows/deploy.yml`,
  `next.config.mjs`, or the byggtids-TMDB SEO pre-rendering cache/timeout code
  (`docs/deployment.md`'s domain).
  **Write the short investigation-plan block here before editing deploy.yml** —
  deploy/hosting is a CLAUDE.md sensitive domain regardless of ticket size.
  Acceptance:
  - Root cause identified and written down (which step hangs, why it hangs instead of
    failing). [diff]
  - A hang now fails within a bounded time instead of running to the workflow timeout
    (existing 6-day/budget guards untouched — see `deployment.md`). [diff]
  - Fix verified via `gh run list --workflow=deploy.yml` showing a subsequent green
    run. [run]

## Batch F — scheduled-jobs (agent: direct, requiresPlanMode)

- [ ] **BIN-727** [Tier C (functions/**) · build · requiresPlanMode · Malin: "bygg"
  2026-08-06, #27 DBA already ran a blind critique and rescoped it — conditions below
  are theirs, already binding] Scheduled-job orchestration is untested (12 of 13 have
  their Firestore logic inside the `onSchedule` wrapper).
  Files: `functions/src/retentionCleanup/` (+ new `SweepIo`-style port + emulator
  test), `functions/src/availableNotify/` (+ emulator test).
  Acceptance:
  - `retentionCleanup`'s read→apply→write loop is exercised against a real Firestore
    emulator via an injected IO port (tmdbFieldsSweep/SweepIo pattern), not a mock.
    [diff]
  - A doc dated exactly at the TTL threshold is NOT deleted; re-running over the same
    data deletes zero additional docs. [diff]
  - `availableNotify`: a second run doesn't re-send, and a user who declined never
    reaches `sendPushToUser`. [diff]
  - `communityRatings`'s dedup check never lands outside the counting transaction — a
    test forces a concurrent re-run and shows nothing double-counts. [diff]
  - `tmdbFieldsSweep` untouched; `mutateEnabled` never referenced. [diff]
  - Report explicitly that green here ≠ live: `retentionCleanup` and
    `reclaimOrphanFollows` aren't in the deploy chain and need Malin's manual functions
    deploy. [diff]

## Batch G — frontend-copy (agent: direct)

- [ ] **BIN-795** [Tier A · build] Privacy policy doesn't mention the theme choice
  persisted in `localStorage` (unlike the two documented `sessionStorage` keys).
  Files: `src/app/integritet/page.tsx`.
  Acceptance:
  - Storage section lists the theme key with type (localStorage, persistent), purpose,
    and "no third party access". [diff]
  - No new consent UI, no new legal basis. [diff]

## Needs you (Tier D / routed elsewhere / genuinely her call)

- **BIN-802, BIN-803, BIN-805** — real, low-risk tech debt in this repo's own risk
  router (`docs/org/route.mjs` has zero tests; `docs/org/ownership-map.json` was
  hand-edited despite its own "auto-generated, do not hand-edit" header; `CODE_ROOTS`
  excludes `docs/`/`scripts/` so the router routes its own code `skip`). Genuinely
  buildable in this repo, just not picked this round for capacity — good next-sprint
  candidates, no urgency (nothing user-facing).
- **BIN-804** — the new `reasonCode` contract (BIN-788) has no documented consumer yet.
  Partly a binge doc update (CLAUDE.md), partly cross-repo (sprint-selection reads).
  Low urgency.
- **BIN-806, BIN-798, BIN-790, BIN-793** — process/audit debt in the sprint tooling.
  BIN-806's named batches (BIN-759, BIN-468) already shipped today, so its remaining
  ask (retroactively re-run reviewers over old commits) has low marginal value now.
  BIN-798 and BIN-790 are mostly resolved already (per their own latest comments) with
  a residual claude-plugins-side design question neither this repo nor a sprint can
  close. BIN-793's baseline drift is trivial (`--update-baseline`) — fold into the next
  commit that touches `docs/workflow-map.html` rather than a standalone ticket.
- **BIN-797** — `firestore.rules` allows `movie_0`, which the client already refuses to
  read (orphaned doc, not a forged vote). Low severity; her own prior guidance was to
  fold it into BIN-624's eventual rules session rather than a standalone change.
- **BIN-807, BIN-808, BIN-809** — real gaps (a past commit bundled a workflow-map edit
  with tooling code; BIN-789's crash-boundary mechanical detection was never built;
  BIN-583's cross-row dedupe — shipped today — is only tested in the helper layer, not
  the component that applies it). BIN-809 in particular is worth an early pick next
  round: it's a test gap on a panel's BINDING condition for code already live.
- **BIN-810** — should the other three "don't resync the pair" warnings in
  `mediaTypeDocId` get the same softening as BIN-759's? Genuinely her call, not urgent.
- **BIN-811** — should "Fortsätter som film" also anchor on finished-watching series,
  not just followed ones? Product/UX call, not a defect.

## Already answered — recorded decision, not re-asked (full detail in the structured
## plan returned to the orchestrator)

BUILD (selected above): BIN-655, BIN-679, BIN-689, BIN-646, BIN-766, BIN-727.
BLOCKED (waits on something only she/an external clock can supply): BIN-624 (half 2
waits on #27's free-read count, her chosen option B), BIN-781 (her "bygg nu" can't run
— sole target file lives outside this repo), BIN-754 (same — "build, but never inside a
sprint"), BIN-419/BIN-170/BIN-454/BIN-402 (each waits on a specific future date or her
own manual step), BIN-541 (waits on her reading the vendor's quota dashboard), BIN-559
(she asked for a written plan, not code, first), BIN-613 (her yes was explicit "as its
own job, never inside a sprint" — touches deploy.yml itself), BIN-590 (her build
decision needs a plan+critique pass this sprint didn't have capacity for — top pick
next round), BIN-565 (waits on real traffic growth past free tier, her stated trigger).
EXCLUDED (she said no / not now, settled): BIN-658, BIN-603, BIN-558, BIN-521, BIN-189,
BIN-791 (routes to a dedicated claude-plugins session; its remaining "curiosity" point
is deprioritized).

## Parked (unanswered — do not build, do not re-ask)

- **BIN-779** (2026-08-06T11:16): "säg till om jag ska ta den i en separat körning,
  eller om den ska ligga kvar. Jag gör inget förrän du valt." Still unanswered.

## Obsolete (already fixed under a different ticket — verified against current main)

- **BIN-801** — `docs/org/route.mjs`'s NUL byte is gone (confirmed: `indexOf(0) === -1`
  on the current file). Fixed as a side effect of BIN-788/789 (`eb6352e`).
- **BIN-787** — both batches it worried about (BIN-759, BIN-468) are shipped on main
  today (`261d0bb`, `2eda858`). Nothing left to restore.

## Deviation log

(none yet — filled in during execution)

---

# Archive — Sprint 2026-08-06c

11 tickets selected across 6 batches; see commit history around `eb6352e`..`2eda858`
for what actually shipped (BIN-788/789/759/468/583/796 landed; BIN-679/689/797 did not
make it into this pass and were re-evaluated above).

# Archive — Batch 2026-08-06 — de fyra biljetter panelen släppte igenom

Byggda för hand: BIN-555 (ägarlöst gruppdokument), BIN-777 (felrutan vid
kontoradering), BIN-767 (integritetspolicyns sessionStorage-nycklar), BIN-646 (2 av 3
punkter). Se `a4a1470`.
