# Sprint 2026-07-16 — selection

Linear available. 7 tickets selected (`build`), clustered into 6 disjoint-file batches.
0 obsolete (all 7 candidate bugs/gaps re-verified present in current `main` before
selecting — grep-of-main premise check per the skill). 3 needs-approval this round
(BIN-509, BIN-527, BIN-521 carried) — all three get a plain-language reasoning below;
none selected into a batch.

## Batch: streaming (advisor dedup)

- [ ] **BIN-528** [Tier A] `build` — Extract the shared "which watch-statuses count as a
      live reason to keep a service" guard clause out of three separate copies
      (`tvActiveProviderIdsFromItems` in serviceValue.ts, `buildHouseholdContribution` in
      householdAggregate.ts, the active-set derivation in spendSnapshot.ts) into one small
      helper the three consume; keep each surface's extra local filters (e.g. serviceValue's
      `mediaType==='tv'` + `avslutad`-exclusion) local, not folded into the shared helper.
      Files: `src/lib/advisor/serviceValue.ts`, `src/lib/advisor/householdAggregate.ts`,
      `src/lib/spendSnapshot.ts` (+ their `.test.ts` files). Stakeholders: single ·
      #24 Monetization/Partnerships. requiresPlanMode: no.
  - [ ] A single shared helper (new export) encodes the common "which statuses qualify as
        active" rule; all three call sites use it instead of duplicating the status list.
  - [ ] serviceValue's TV-only filter and `avslutad`-exclusion (BIN-513) still apply and are
        NOT moved into the shared helper (they stay local to serviceValue.ts).
  - [ ] All three modules' existing test suites pass unmodified in their assertions — this
        is a pure refactor, not a behavior change to any of the three dead-weight/household/
        spend verdicts.

## Batch: infra (test coverage measurement)

- [ ] **BIN-525** [Tier A] `build` — Run vitest with `--coverage` once, record the measured
      percentage, and wire a report-only (non-blocking) coverage step into CI. Do NOT add a
      blocking coverage floor/threshold — that decision is explicitly Malin's, deferred.
      Files: `package.json`, `vitest.config.ts` (or equivalent), `.github/workflows/ci.yml`.
      Stakeholders: single · #8 DevOps/SRE. requiresPlanMode: **yes** (3-file CI/tooling
      change — working-agreement "large change" threshold).
  - [ ] CI runs a coverage pass and the measured overall percentage is recorded (Linear
        comment on BIN-525 + this ticket's close-out note).
  - [ ] No blocking floor/threshold is added anywhere (`--coverage` reporting only) — CI
        does not go red purely because of a coverage number.
  - [ ] The floor-or-not decision itself is explicitly left open for Malin (surfaced, not
        pre-decided) in the close-out comment.

## Batch: auth (AuthContext bug fixes)

- [ ] **BIN-517** [Tier A] `build` — Stop `register()`'s `setDoc(..., {username: null},
      {merge:true})` from clobbering `ensureUserProfile`'s auto-claimed username (drop
      `username` from `register()`'s payload entirely — merge:true then leaves whatever
      `ensureUserProfile` claimed intact). Files: `src/contexts/AuthContext.tsx` (+ new
      test). Stakeholders: full-panel (AuthContext.tsx high-stakes path) · #5 Legal/GDPR,
      #27 DBA. requiresPlanMode: **yes**.
  - [ ] `register()`'s `setDoc` payload no longer includes a `username` key (or otherwise
        provably can't overwrite a just-claimed username back to null).
  - [ ] A new test proves a registered user ends with a non-null `username` AND exactly one
        `usernames/{name}` reservation (no orphan).
  - [ ] `setProviderCost`/`setProviderCampaign` (BIN-516, same file/batch) are untouched by
        this criterion's diff — the two fixes stay independently reviewable.

- [ ] **BIN-516** [Tier A] `build` — `setProviderCost`/`setProviderCampaign` mutate their
      mirror ref before the Firestore write resolves and never revert on failure, so a
      rejected value silently persists via the next successful edit. Revert the ref (or
      rebuild the payload from committed state) on write failure, for both. Files:
      `src/contexts/AuthContext.tsx` (+ new test). Stakeholders: full-panel (AuthContext.tsx
      high-stakes path) · #5 Legal/GDPR, #27 DBA. requiresPlanMode: **yes**.
  - [ ] Both `setProviderCost` and `setProviderCampaign` revert their ref to the pre-edit
        value (or equivalent non-ref-poisoning fix) when the Firestore write throws.
  - [ ] A new test forces the write to reject, then performs a second successful edit to a
        DIFFERENT provider, and asserts the rejected value is NOT included in that second
        write's payload.
  - [ ] The existing successful-write path test assertions are unmodified.

## Batch: watchlist (BIN-505 follow-up tests + cleanup)

- [ ] **BIN-522** [Tier A] `build` — Pin the four test-coverage gaps BIN-505's reviewers
      verified by manual trace only (updatedAt-omission on notes migration/updateNotes,
      cross-account `itemsUidRef` guard, `useFollowList`'s real 'Privat användare' fallback
      replacing the stale 'ghost'-branch test, `syncMyPublicProfile` field clamping), and fix
      `updateNotes`' unconditional no-op write when there's no legacy inline note and
      `visFields` is empty. Files: `src/contexts/WatchlistContext.tsx` (+ test),
      `src/hooks/useFollowList.helpers.test.ts`, `src/lib/firebase/publicProfile.ts` (+ test).
      Stakeholders: single · #14 Software Architect. requiresPlanMode: **yes** (multi-file,
      privacy-adjacent follow-up to a PII fix).
  - [ ] New tests assert `'updatedAt' in payload === false` for both the eager notes
        migration and `updateNotes` (mirrors the `nextAirReadRepair` pattern).
  - [ ] A new test simulates a mid-session uid switch A→B and asserts the notes migration
        does NOT write A's notes under B.
  - [ ] `useFollowList.helpers.test.ts`'s stale `'ghost'`-branch assertion is replaced with a
        test for the real 'Privat användare' fallback row; no test still asserts `'ghost'`.
  - [ ] `updateNotes` skips the item-level write when there's no legacy inline note AND
        `visFields` is empty (no behavior change to the notes-subcollection write itself).

## Batch: data (availableNotify/priceDropNotify mediaType collision)

- [ ] **BIN-523** [Tier C — functions/** trigger, expanded plan required] `build` — Movie N
      and TV N currently collapse into one `availableNotifyState`/`releaseNotifyState` doc
      (keyed on bare `tmdbId`) and one `processTitle` group, producing wrong/suppressed
      pushes for that overlap. Namespace state-doc ids by media type (`movie_${tmdbId}` /
      `tv_${tmdbId}`) and group `processTitle` by `(mediaType, tmdbId)`; apply the same fix
      to `priceDropNotify` if it shares the pattern. Files:
      `functions/src/availableNotify/index.ts`, `functions/src/priceDropNotify/index.ts`
      (+ tests). Stakeholders: single · #13 Data/Integrations Engineer. requiresPlanMode:
      **yes** (security-labeled + functions/** tierCTrigger).
  - [ ] State-doc ids (both `availableNotifyState` and `releaseNotifyState`) are namespaced
        by media type — a movie and a TV show sharing the same numeric tmdbId get separate
        docs.
  - [ ] `processTitle` groups watchlist rows by `(mediaType, tmdbId)`, not `tmdbId` alone.
  - [ ] A new test proves a user holding movie N and TV N gets two independent notify/dedup
        entries (neither suppresses or mis-types the other).
  - [ ] `priceDropNotify` is checked for the same keying bug; fixed if present, or the ticket
        close-out states explicitly why it doesn't apply.

## Batch: social (groups fan-out cap)

- [ ] **BIN-510** [Tier C — full-panel, expanded plan required] `build` — `syncProgressToGroups`
      (fired on every episode/progress write) and its sibling `array-contains` group queries
      in `groups.ts` (4 call sites: :477, :562, :750, :778) have no `limit()`, unlike
      `useFollow.ts`'s `FOLLOWING_LIMIT = 500` pattern for the analogous following query — a
      direct Blaze-budget risk for heavy group users. Add a bounded limit (mirror
      `FOLLOWING_LIMIT`) to all four call sites; skip the sync entirely when the user has zero
      groups without a collection scan. Files: `src/lib/firebase/groups.ts` (+ tests).
      Explicitly NOT in scope: `AuthContext.tsx:443`'s `updateProviders` group query has the
      same unbounded shape but is a low-frequency (provider-list-edit) call, not the
      per-episode hot path — leave it alone this round (note it in the close-out for a
      possible follow-up ticket). Stakeholders: full-panel · #27 DBA, #4 Security Architect,
      #14 Software Architect. requiresPlanMode: **yes**.
  - [ ] All four `array-contains` group queries in `groups.ts` (:477, :562, :750, :778) carry
        a bounded `limit()`.
  - [ ] `syncProgressToGroups` (or its caller) skips the group-fan-out query entirely for a
        user known to be in zero groups, without a full collection scan.
  - [ ] A new test proves the query is bounded (a user "in" more groups than the limit still
        only reads up to the limit).
  - [ ] `AuthContext.tsx:443` is explicitly left unchanged — no edits to `AuthContext.tsx` in
        this ticket's diff (keeps it disjoint from the auth batch above).

## Needs you (mandate gate — not selected, see reasoning)

- **BIN-509** — Tillsammans session write-rules forgery fix (swipes/participant slot not
  bound to the caller). Real, verified-still-present security bug in a live feature — but
  it's a `firestore.rules` change, and the working agreement's one standing exception is
  that Firestore rules/schema changes get **a written plan and an explicit go-ahead FIRST**,
  not an auto-build that parks in review after already being live (this repo's push-triggers-
  deploy means "In Review" would happen only after the rules are already serving traffic).
  Router confirms full-panel (Security Architect, DPO, DBA). Recommend: **do it** — it's a
  real integrity hole (any link-holder can forge another participant's vote or hijack their
  slot) — but run it as its own `/stakeholder-review` + written plan next, with your sign-off
  before the rules deploy, same as BIN-505's process. Not urgent (data is anonymous/ephemeral,
  7-day TTL, no PII), so safe to schedule rather than rush.
- **BIN-527** — Advisor TV dead-weight shield keys on availability, not actual per-title
  watch location (a show available on 2 owned services shields both, even though the user
  only watches it on one). The ticket itself says "needs a product decision... no clean code
  fix without that call" and lays out 3 options (accept as-is / tighten to attribute-one-
  service like films / require real watch-recency — bigger). This is exactly your call, not
  an engineering one. Recommend: **(b) — tighten to attribute-one-service**, for consistency
  with the film path (BIN-513 already accepted that same false-positive/false-negative
  tradeoff for films), but only when you're ready to sign off on it — not urgent, client-only
  advisor logic, adjustable anytime.
- **BIN-521** — Bundle-rådgivare nudge (multi-service → cheaper operator bundle). Carried
  from the prior sprint's needs-approval queue; ticket self-declares "ren idé, kräver egen
  brainstorm/design innan bygge." Recommend its own `/stakeholder-review`
  (Monetization + Data/Integrations) before any code — unchanged reasoning from 2026-07-15.

## Deferred, no new judgment needed (already-decided in memory, left in Backlog)

BIN-520 (BIN-507 orchestration-test follow-up — low priority, already attempted once this
sprint cycle and dropped for failed verification; description records the intended
"accept pure-helper-only" resolution but it was never actually committed to `index.ts` —
re-verified via grep, the header comment doesn't exist on main. Leaving deferred rather than
re-attempting immediately; low value (doc comment + criteria downgrade only, job stays in
count-only mode regardless)). BIN-402/454/468 (TMDB ToS sweep — mutateEnabled deliberately
deferred to a real-traffic gate ~Aug). BIN-170 (Binge Wrapped — booked Nov). BIN-189
(Seasonal challenges — panel-approved for Aug/Sept build, not now). BIN-419 (SEO
re-measurement, not due until 2026-08-28).

## Post-sprint steps

1. `npm run typecheck` across all touched files.
2. File Linear follow-ups for anything deferred mid-implementation (e.g. the
   `AuthContext.tsx:443` unbounded query noted under BIN-510, if worth its own ticket).
3. Commit through the review gates (code/security/test markers as triggered), conventional
   commit referencing all ticket ids (BIN-528/525/517/516/522/523/510).
4. Push (deploys on push) → poll `deploy.yml` → purge Cloudflare. BIN-523/510 touch
   `functions/**` respectively `src/lib/firebase/groups.ts` — confirm whether either needs a
   manual `firebase deploy --only functions` (deploy.yml only deploys hosting).
5. Transition: Tier A build + all-pass → Done. Any Tier C ticket with an unresolved
   full-panel conflict or a failed/unclear acceptance criterion → In Review instead, with a
   note on what to look at.

## Deviation log (filled post-sprint 2026-07-16)

- BIN-528: no host file named for the shared helper → watchStatus.ts is the semantic home but plan-gated + outside the batch fileset → hosted in `src/lib/spendSnapshot.ts` (oldest surface, defines the concept, no import cycles).
- BIN-528: householdAggregate.test.ts already pins the guard ('sedd' exclusion case) → left untouched, no redundant coverage.
- BIN-525: functions/src admin entrypoints fail v8 coverage remap (PARSE_ERROR, silently excluded) → coverage.include scoped to `src/**/*.{ts,tsx}` with WHY comment — denominator declared, not accidental.
- BIN-522: 'Privat användare' fallback tests already existed; the genuinely stale part was the dead 'ghost' union member (unreachable since BIN-505) → retired 'ghost' from FollowProfile/resolveFollowRows, tests pin null→fallback + order/count.
- BIN-522: publicProfile.ts clamping already shipped in d6ff035 → tests only, no production change there.
- BIN-522: WatchlistContext test gaps live in WatchlistContext.test.tsx, not useFollowList.helpers.test.ts as ticketed.
- BIN-522: mutation-verification `git checkout --` wiped the real edit → re-applied + re-verified; lesson filed (tasks/lessons.md + digest).
**BIN-523 + BIN-510 were REVERTED before deploy (2026-07-16) — failed verification.** The
notes below record what the sprint *attempted*; none of it is in the code. Read them as
rework input for the returned tickets, NOT as shipped fact. The code is back at `fd4b14e`.

- BIN-523 [REVERTED]: attempted — releaseNotifyState doc ids deliberately NOT namespaced (movie-only by construction; renaming orphans live per-user dedup markers → double pushes in the 3-day catch-up window).
- BIN-523 [REVERTED]: attempted — priceDropNotifyState verified movie-only at the query → no change, invariant claimed in a header comment. **The verification rejected exactly this claim:** the query filter only protects priceDropNotify's READ side; `priceHistory/{tmdbId}` is written by `streamingOffers`, which dedupes by bare tmdbId and carries the SAME collision. The header comment (now reverted away) asserted a safety property that does not hold. Any rework must fix `streamingOffers/logic.ts` too, or drop the claim.
- BIN-523 [REVERTED]: attempted — FCM tag `available-${tmdbId}` shared the collision → include mediaType in the namespaced key. Residual: inbox doc id still bare → BIN-529.
- BIN-510 [REVERTED]: attempted — zero-groups skip via per-uid 5-min TTL cache seeded by first scan/subscription, invalidated by in-module membership mutations. Failed correctness/intent verification.
- BIN-510 [REVERTED]: attempted — refreshMyHouseholdContributions got the bounded limit() only, not the skip (low-frequency caller). Bounded-query test missing → BIN-530; AuthContext:443 → BIN-536.

---

# Archive — Sprint 2026-07-15 (shipped 4ae5735 + fd4b14e)

BIN-511/512/513/514/515/518/519 shipped; BIN-505 (PII leak) landed separately (d6ff035).
BIN-520 dropped (failed verification, see "Deferred" section above for current state).
Full archived plan detail available via `git show 4ae5735:tasks/todo.md` if needed.

---

# Archive — BIN-505 full plan (SHIPPED 2026-07-16, d6ff035)

Full design + panel record: `tasks/bin-505-plan.md`,
`docs/incidents/2026-07-14-bin505-profile-pii-exposure.md`. Follow-ups filed as BIN-522
(above) and BIN-523 (mediaType collision, unrelated surface found by the same review pass).
