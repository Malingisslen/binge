# Sprint 2026-07-18 — decision-queue tail, planned

All 4 items from the 2026-07-17 decision queue (see project memory
`project_decision_queue_2026-07-18.md`) resolved via direct Q&A with Malin, then cast
through the role-org (router + targeted critiques, one per ticket — `via: manual` for
3, full `/stakeholder-review` for BIN-521) before writing acceptance criteria, per the
CLAUDE.md working-agreement's "cast stakeholders before planning" rule. All 4 review
events logged (`docs/org/metrics/events.jsonl`). One conflict → ADR 0016.

## Batch: streaming (advisor TV one-service attribution)

Router: `node docs/org/route.mjs src/lib/advisor/serviceValue.ts` → **medium**,
Monetization/Partnerships Lead (#24). Verdict: **endorse-with-changes**.

- [ ] **BIN-527** [Tier A/B] `build` — Apply the same `attributeProvider()`-style
      single-provider selection already used for films to `tvActiveProviderIdsFromItems()`
      in `src/lib/advisor/serviceValue.ts` — an active TV title currently credits EVERY
      owned provider it's available on as "actively used" (shielding all of them from the
      dead-weight verdict); it should credit exactly ONE, same deterministic
      lowest-canonical-id tiebreak as `attributeProvider`. Confirmed: no cheap
      last-watched-provider signal exists on `WatchlistItem` to do better without the
      declined bigger build (real watch-recency) — lowest-id is the accepted approximation.
      Re-verify the ticket's secondary claim ("+ unstarted shields indefinitely") against
      current `main` at Step 0 — original ticket text was not preserved verbatim through
      the decision-queue update, confirm it's still present before fixing it.
      Files: `src/lib/advisor/serviceValue.ts` (+ tests). Stakeholders: single · #24.
      requiresPlanMode: no (single file, client-only, no data/schema implications).
  - [ ] `tvActiveProviderIdsFromItems` credits exactly one owned provider per active TV
        title (same tiebreak function/logic as `attributeProvider`, not a duplicate
        implementation).
  - [ ] **Binding (panel condition):** the UI copy that surfaces this shielded/dead-weight
        verdict carries the "tillgänglig via" hedge in the SAME change (per the
        2026-07-16 decision queue's existing precedent for this exact tradeoff) — not
        deferred to a follow-up.
  - [ ] **Binding (panel condition):** close-out note states whether attribution came out
        lopsided toward one provider id across the test/seed data (a systemic bias risk
        the panel flagged, since `Math.min()` always favors the same provider for every
        co-licensed show) — if clearly lopsided, flag for a tiebreak change (e.g. hash on
        titleId) as a fast-follow; don't silently ship a directional bias unnoted.
  - [ ] New/updated tests cover: a TV title on 2 owned services credits only one; the
        BIN-513 film-path parity (same shape of tradeoff, applied to TV).

## Batch: data (recap coverage-gap logging)

Router: `node docs/org/route.mjs src/hooks/useRecap.ts src/lib/analytics.ts` → **medium**,
Product Manager (#9). Verdict: **endorse-with-changes — BLOCKING change to the original
plan's data store.**

- [ ] **BIN-544** [Tier C — new Firestore collection, expanded plan required] `build` —
      **NOT a Plausible event as originally scoped.** Panel found Plausible can't answer
      "which shows need backfill most" (aggregate event counts only, not a sortable/
      queryable list) — use a small Firestore counter doc instead:
      `recapCoverageGaps/{tmdbId}` with `count: FieldValue.increment(1)` +
      `lastMissedAt: serverTimestamp()`, aggregated per-SHOW (not per-episode — the
      backfill decision is "which show," episode-level granularity just produces hundreds
      of rows to hand-aggregate later). Fire from `src/hooks/useRecap.ts`'s queryFn when it
      resolves to a genuine miss (`{recap: null, coveredBoundary: null}`) — RECAPS_ENABLED
      on, not still loading. New Firestore collection → needs `firestore.rules` (write-only
      for authenticated-or-anon clients, admin-read; no client read needed) — sensitive
      domain, full written plan + Malin's go-ahead required before touching rules.
      Files: `src/hooks/useRecap.ts`, `firestore.rules` (+ tests, + rules tests).
      Stakeholders: single · #9. requiresPlanMode: **yes** (firestore.rules + new schema).
  - [ ] Firestore write path is `recapCoverageGaps/{tmdbId}`, incrementing a counter +
        timestamp, NOT a Plausible `trackEvent` call.
  - [ ] Aggregation key is `tmdbId` (show-level), not per-episode.
  - [ ] `firestore.rules` allows the increment-write from any client (no auth requirement group
        — recap misses can happen for anonymous browsing) but denies client reads (admin-only
        surface, read via Console or a future /insikter panel, not by users).
  - [ ] **Binding (panel condition):** the write path is rate-limit-considered before real
        launch — pre-launch with zero users, a raw client Firestore write is acceptable
        for now, but the close-out note must flag "convert to a rate-limited callable
        Function before public launch" as a tracked follow-up, not silently accepted
        indefinitely.
  - [ ] No UI/UX change — the existing "no recap" render is unchanged; this is silent
        instrumentation only.
  - [ ] New tests cover: the increment write fires only on a genuine resolved miss (not
        while loading, not when RECAPS_ENABLED is false); rules tests prove write-allowed
        + read-denied for a non-admin client.

## Batch: infra (leavingRollup pacing — redesigned per ADR 0016)

Router: `node docs/org/route.mjs functions/src/leavingRollup/index.ts
functions/src/leavingRollup/motnChanges.ts functions/src/streamingOffers/index.ts` →
ownership-map gap on the newer leavingRollup/util paths (resolves to **skip** — a mapping
artifact, not a real signal); manually cast **medium**, Data/Integrations Engineer (#13,
same role that owns BIN-541). Verdict: **BLOCK the originally-proposed cursor design; build
the simpler alternative instead — see ADR 0016.**

- [ ] **BIN-543** [Tier C — functions/** trigger, expanded plan required] `build` —
      **Design changed from the original ticket** (resumable multi-day pagination cursor
      → rejected, see `docs/org/adr/0016-leavingrollup-resumable-cursor-rejected.md`: window
      drift makes multi-day accumulation silently WRONG, not just stale, and MOTN cursor
      validity across days is unverified). Build instead: widen `leavingRollup`'s per-run
      page budget and reduce run frequency (e.g. every 3-4 days instead of daily), keeping
      the existing single-day full-or-nothing pass and the unchanged `complete: boolean`
      completeness guard untouched. Before sizing the new page budget: check whether
      `streamingOffers`' 300-of-450 slice of the combined MOTN cycle budget has headroom to
      reallocate toward leavingRollup's 150 — the BIN-541 split isn't necessarily final.
      Zero new persisted state beyond what BIN-541 already added.
      Files: `functions/src/leavingRollup/index.ts` (schedule cadence),
      `functions/src/leavingRollup/motnChanges.ts` (MAX_PAGES, if widened),
      possibly `functions/src/streamingOffers/index.ts` (if the 300/150 split is
      rebalanced) (+ tests). Stakeholders: single · #13. requiresPlanMode: **yes**
      (functions/** sensitive domain, regardless of router's "skip" — CLAUDE.md always
      requires this for Cloud Functions changes).
  - [ ] No persisted pagination cursor, no staging/accumulation doc — confirms the ADR
        0016 pivot was actually followed, not the original cursor design.
  - [ ] `complete: boolean` semantics in `motnChanges.ts` are UNCHANGED (still true only on
        a genuine single-run natural end) — this ticket must not touch that guard's logic.
  - [ ] Scheduled cadence is reduced (e.g. `every 72 hours` or `every 96 hours`) OR the
        per-run page budget is widened within the existing single-day model — close-out
        note states which lever was pulled and the arithmetic showing it stays within
        LEAVING_HARD_CYCLE_CAP (150) or its rebalanced replacement across the full ~31-day
        cycle, mirroring BIN-541's own PER_RUN_SELECT × cycle-length ≤ cap proof.
  - [ ] If the 300/150 streamingOffers/leavingRollup split is rebalanced, `STREAMING_HARD_CYCLE_CAP`
        + `LEAVING_HARD_CYCLE_CAP` are updated together with an explicit comment update
        (mirrors the existing BIN-541 comment style) — never one changed silently while the
        other's own "combined ~450-of-500" claim goes stale.
  - [ ] New/updated tests cover the new cadence/budget arithmetic (pure logic, same pattern
        as BIN-541's `dayId.test.ts`/`budget.test.ts`).

## Not ready to plan as a build ticket — needs its own design pass

- **BIN-521** — Bundle-rådgivare proactive nudge. Routed through the full
  `/stakeholder-review` flow (router: single, Recommendations/Scoring-Integrity Engineer
  #28). Verdict: **approve-with-conditions**, but the conditions themselves ARE the
  brainstorm this ticket already said it needed — not yet a buildable spec:
  - Must respect `BundleSuggestion.stale` (no proactive push on unverified >180d-old
    pricing) with the caveat given EQUAL visual weight to the savings headline, not
    demoted to fine print in a compressed nudge format.
  - Must reuse `detectBundleArbitrage`/`selectBundleSuggestions` output as-is — no
    duplicated pricing/comparison logic for the nudge surface.
  - Needs dismiss/frequency-cap state before going proactive (today's card is a pull
    surface that can re-show every visit; a push surface can't nag).
  - Needs an explicit decision on how the nudge relates to `useSubscriptionAdvisor`'s
    existing single-slot `primaryAction` cascade (pause > catchup > subscribe > idle) —
    additive banner, or competing for that same slot.
  - Copy must stay comparative/generic given single-vendor (Telia-only) seed data — no
    wording reading as vendor endorsement; a future affiliate wrap (BIN-173 precedent)
    needs its own disclosure pass, not bundled in here.
  Next step: a real design session (not a code sprint) working through these 5 points,
  THEN a build plan. Malin already confirmed this path (2026-07-18 Q&A).

## Post-sprint steps (once built)

1. `npm run typecheck` + relevant `npm test` scoped to touched files.
2. BIN-544 + BIN-543 touch `functions/**`/`firestore.rules` respectively → confirm Tier-D
   manual deploy needs (rules and/or functions; deploy.yml ships hosting only).
3. Commit through the review gates; conventional commit referencing ticket ids.
4. Transition tickets: Done for clean acceptance-criteria passes; In Review for anything
   with an unresolved close-out note (e.g. BIN-527's lopsided-attribution check, BIN-544's
   rate-limit-follow-up flag).

---

# Sprint 2026-07-17 — selection

Linear available (scoped to project "Binge" throughout, per the shared-team isolation
rule). 10 tickets selected (`build`), clustered into 5 disjoint-file batches. 1 obsolete
(BIN-541 — grep-of-main confirmed already shipped under 12b88f4, ticket never transitioned).
4 needs-approval (BIN-527, BIN-521 carried; BIN-544, BIN-543 new this round) — reasoning below.

**Two batches (data, rules) touch surfaces from the 2026-07-16 sprint's REVERTED tickets
(BIN-523, BIN-510) — both failed outcome verification last time and were force-reverted
before deploy.** This round's acceptance criteria explicitly require the retry not to repeat
the same failure mode (cited per-ticket below). Treat these two batches with extra care:
re-verify against current `main`, not the old attempt's diff.

## Batch: social (groups.ts fan-out + correctness)

Router: `node docs/org/route.mjs src/lib/firebase/groups.ts` → **top** (full-panel), Security
Architect (#4). requiresPlanMode: **yes** for both tickets (same file, same panel).

- [ ] **BIN-510** [Tier C — full-panel, expanded plan required] `build` — RETRY (previous
      attempt reverted 2026-07-16 for failed correctness verification: a per-uid 5-min TTL
      cache seeded by first scan/subscription, invalidated by in-module membership mutations,
      did not hold up). `syncProgressToGroups` and its sibling `array-contains` group queries
      in `groups.ts` (verified still unbounded at :477, :562, :750, :778 on current `main`)
      have no `limit()`. Add a bounded limit (mirror `useFollow.ts`'s `FOLLOWING_LIMIT`
      pattern) to all four call sites; skip the sync entirely when the user has zero groups,
      without a full collection scan — but this time the skip mechanism must independently
      re-verify correctness (don't reuse the exact prior TTL-cache shape without confirming
      its invalidation is airtight, or pick a simpler mechanism, e.g. read the bounded query
      result itself rather than a separately-cached membership flag).
      Explicitly NOT in scope: `AuthContext.tsx:443`'s `updateProviders` group query has the
      same unbounded shape — that's BIN-536, in the auth batch below, kept disjoint from this
      file. Files: `src/lib/firebase/groups.ts` (+ tests).
  - [ ] All four `array-contains` group queries in `groups.ts` (:477, :562, :750, :778) carry
        a bounded `limit()`.
  - [ ] `syncProgressToGroups` (or its caller) skips the group-fan-out query entirely for a
        user known to be in zero groups, without a full collection scan.
  - [ ] A new test proves the query is bounded (a user "in" more groups than the limit still
        only reads up to the limit).
  - [ ] Close-out note explicitly states how this attempt's skip-mechanism differs from (or
        re-verifies) the reverted attempt's TTL-cache approach.

- [ ] **BIN-532** [Tier A] `build` — Two correctness bugs verified present in `groups.ts`:
      (1) `addToGroupWatchlist` (:353) does a non-merge `setDoc` including `memberRatings: {}`,
      so re-adding an already-present title (race between two members, or a remove+re-add)
      silently zeroes existing member ratings; (2) `createGroup` (:23) writes the group doc
      (`addDoc`) then the owner's member doc (`setDoc`) as two separate non-atomic writes — a
      failure after the first leaves an ownerless group doc. Files: `src/lib/firebase/groups.ts`
      (+ tests, same file as BIN-510 above — sequence these two tickets' edits, don't let them
      collide on the same functions).
  - [ ] `addToGroupWatchlist` no longer resets `memberRatings` to `{}` when the watchlist item
        already exists (merge write or equivalent that preserves existing ratings).
  - [ ] `createGroup`'s two writes are made atomic (batch/transaction), or — if a generated
        `addDoc` id makes a single-batch write impractical — a documented compensating step
        exists so a mid-failure never leaves a group with no owner member doc.
  - [ ] New tests cover: re-add preserves existing `memberRatings`; the atomicity fix (or its
        documented fallback) is exercised.

## Batch: data (availableNotify / priceDropNotify mediaType collision)

Router: `node docs/org/route.mjs functions/src/availableNotify/index.ts
functions/src/priceDropNotify/index.ts` → **medium** (single), Data/Integrations Engineer
(#13). requiresPlanMode: **yes** (security label on BIN-523 + `functions/**` is a
`tierCTrigger` regardless of router tier).

- [ ] **BIN-523** [Tier C — functions/** trigger, expanded plan required] `build` — RETRY
      (previous attempt reverted 2026-07-16 for failed verification on TWO specific points —
      both must be addressed this time, not just re-attempted the same way):
      (a) a plain doc-id rename orphans live per-user dedup markers in the 3-day catch-up
      window → double pushes; (b) the header-comment claim that `priceDropNotify` is
      "movie-only at the query, so safe" was verification-REJECTED — `priceHistory/{tmdbId}`
      is written by `streamingOffers/logic.ts`, which dedupes by bare `tmdbId` and carries the
      SAME collision; a query-side guard doesn't protect the write side. Movie N and TV N
      currently collapse into one `availableNotifyState`/`releaseNotifyState` doc (keyed on
      bare `tmdbId`, confirmed still bare on current `main`) and one `processTitle` group.
      Files: `functions/src/availableNotify/index.ts`, `functions/src/priceDropNotify/index.ts`,
      `functions/src/streamingOffers/logic.ts` (+ tests).
  - [ ] State-doc ids are namespaced by media type (or an equivalent fix) WITHOUT orphaning
        existing per-user dedup markers in the 3-day catch-up window — close-out note explains
        the chosen migration/compat approach explicitly.
  - [ ] `processTitle` groups watchlist rows by `(mediaType, tmdbId)`, not `tmdbId` alone.
  - [ ] A new test proves a user holding movie N and TV N gets two independent notify/dedup
        entries.
  - [ ] `streamingOffers/logic.ts`'s `priceHistory/{tmdbId}` write path is fixed for the same
        collision (not just the `priceDropNotify` read side) — this is the specific gap the
        prior attempt's header-comment claim missed.

- [ ] **BIN-529** [Tier A, same file as BIN-523 above] `build` — Residual: the FCM tag
      (`available-${tmdbId}`) and inbox notification doc id (`${tmdbId}-${providerId}`) in
      `functions/src/availableNotify/index.ts` still collide bare-tmdbId across mediaType.
      Fold into the same diff as BIN-523 (same file, same session) rather than a separate pass.
      Files: `functions/src/availableNotify/index.ts` (+ tests).
  - [ ] The FCM tag and/or inbox notification doc id include `mediaType` so a movie and TV
        show sharing a numeric id don't merge-overwrite each other's inbox card / push tag.
  - [ ] A new test proves a user holding movie N and TV N receives two distinct inbox
        notification docs.

## Batch: auth (AuthContext.tsx follow-ups)

Router: `node docs/org/route.mjs src/contexts/AuthContext.tsx` → **top** (full-panel), Legal/
GDPR Counsel (#5) + DBA (#27). requiresPlanMode: **yes** for all three tickets (same
high-stakes file — CLAUDE.md's working-agreement also names AuthContext.tsx directly as a
sensitive-domain path).

- [ ] **BIN-531** [Tier A] `build` — `setProviderRenewalDay` (verified at :536-542) mutates
      `providerRenewalDaysRef` before the Firestore write resolves and never reverts on
      failure — the exact mirror-ref-poisoning pattern BIN-516 already fixed in its siblings
      `setProviderCost`/`setProviderCampaign` (same file, lines ~464-500, rollback pattern
      confirmed present there). Files: `src/contexts/AuthContext.tsx` (+ test).
  - [ ] `setProviderRenewalDay` reverts `providerRenewalDaysRef` to its pre-edit value (or
        equivalent non-ref-poisoning fix) when the Firestore write throws.
  - [ ] A new test forces the write to reject, then performs a second successful edit to a
        different provider, and asserts the rejected value is NOT included in that second
        write's payload.
  - [ ] `setProviderCost`/`setProviderCampaign`'s existing test assertions are unmodified.

- [ ] **BIN-535** [Tier A] `build` — Follow-up from the BIN-517 security review (Low,
      non-blocking): a broader `register()`/`ensureUserProfile` profile-doc overwrite race
      remains beyond the username sub-case BIN-517 already closed. Re-read the exact review
      finding via `get_issue` on BIN-535 before coding — Step-0 premise check first, since this
      is a follow-up to already-shipped code. Files: `src/contexts/AuthContext.tsx` (+ test).
  - [ ] The race identified in the BIN-517 review is closed, or the close-out documents why
        it's not exploitable (Step-0 finding it's already moot is an acceptable outcome).
  - [ ] A new test demonstrates the fix (or the premise-gone note stands in for it).
  - [ ] BIN-517's existing username-fix tests are unmodified.

- [ ] **BIN-536** [Tier A] `build` — `updateProviders`' group query (verified at :448) has the
      same unbounded `array-contains` shape as BIN-510's four call sites, deliberately left out
      of that ticket to keep batches disjoint. Low-frequency (provider-list edit), but the fix
      is mechanical — mirror `FOLLOWING_LIMIT`/BIN-510's bound. Files: `src/contexts/AuthContext.tsx`
      (+ test).
  - [ ] `updateProviders`' group query carries a bounded `limit()`, mirroring BIN-510's pattern.
  - [ ] A new test proves the query is bounded.
  - [ ] No behavior change to which groups get a provider update within the limit (existing
        successful-path tests unmodified).

## Batch: watchlist (flaky test stabilization)

Router: `node docs/org/route.mjs src/contexts/WatchlistContext.test.tsx` → **skip** (test-only,
no owning role). requiresPlanMode: **no**.

- [ ] **BIN-533** [Tier A] `build` — The BIN-522 notes-migration describe block in
      `WatchlistContext.test.tsx` (verified present, lines ~571-794) fails under rare timing
      (~1/31 runs per the reviewing agent's observation) — test-reliability, not a security or
      production-behavior issue. Files: `src/contexts/WatchlistContext.test.tsx`.
  - [ ] The affected test(s) no longer rely on real-timer / timing-race behavior (deterministic
        fake timers or awaited microtask ordering instead).
  - [ ] No assertion on the notes-migration invariants (the `updatedAt`-omission checks etc.)
        is weakened — same behavior pinned, just made deterministic.
  - [ ] Close-out note states how flake-freedom was verified (e.g. N repeated local runs).

## Batch: rules (Tillsammans veto/isHost hardening + BIN-509 cleanup)

Router: `node docs/org/route.mjs firestore.rules` → **top** (full-panel), Security Architect
(#4) + DPO (#6) + DBA (#27). requiresPlanMode: **yes** — AND this is a `firestore.rules`
change, which is CLAUDE.md's standing working-agreement exception: **written plan + Malin's
explicit go-ahead FIRST**, same as BIN-509's process, before any Edit/Write. Both tickets here
were pre-scoped as deliberate follow-ups by the BIN-509 panel itself (2026-07-16) — mandate is
established, but the rules-change ceremony still applies in full.

- [ ] **BIN-540** [Tier C — firestore.rules, full-panel, WRITTEN PLAN + GO-AHEAD REQUIRED
      before any edit] `build` — `vetoRemaining`/`isHost` are listed in the participants
      `hasOnly()` field set (verified at :828-829) but have NO value validation — any
      participant can self-write `vetoRemaining: 999` or `isHost: true`. The BIN-509 panel
      explicitly flagged this as "its own small ticket" (deliberately kept out of BIN-509's
      scope). Files: `firestore.rules`, `src/test/rules/firestore-rules.test.ts`.
  - [ ] `vetoRemaining` and `isHost` are no longer client-writable to arbitrary values (value
        validation added — e.g. `vetoRemaining` bounded to its starting allowance, `isHost`
        can't be self-granted by a non-owner participant).
  - [ ] New DENY tests: a participant cannot set `isHost:true` on their own write; cannot set
        `vetoRemaining` above its starting allowance.
  - [ ] Existing BIN-24/BIN-509 participant tests still pass unmodified in intent (legitimate
        own-slot writes remain allowed).

- [ ] **BIN-542** [Tier C — firestore.rules, full-panel, WRITTEN PLAN + GO-AHEAD REQUIRED
      before any edit] `build` — Cleanup-severity, no correctness impact (found by
      `/code-review xhigh` during the BIN-509 ship, deliberately deferred out of that diff):
      `anonVoteAddOk()` (verified at :794-797) recomputes `votes.diff(resource.data.votes)`
      per call instead of binding it once; note the caveat that `addedKeys()` returns a
      non-indexable Set (relevant to how the simplification is written). Files:
      `firestore.rules` (+ `src/test/rules/firestore-rules.test.ts` if the refactor touches
      test-visible behavior, which it should not).
  - [ ] `anonVoteAddOk()` binds `votes.diff()` once and reuses it, instead of recomputing per
        call.
  - [ ] Pure simplification — the full sessions/swipes rules test suite passes UNMODIFIED
        (no behavior change).
  - [ ] The `addedKeys()`-is-a-non-indexable-Set caveat from the original finding is either
        resolved in the simplified code or explicitly left as a documented non-issue.

## Needs you (mandate gate — not selected, see reasoning)

- **BIN-527** — Advisor dead-weight TV shield keys on availability, not actual per-title watch
  location. Carried from the 2026-07-16 sprint's needs-approval queue (self-declared "needs a
  product decision... no clean code fix without that call", 3 options laid out in the ticket).
  Unchanged reasoning: recommend **(b) tighten to attribute-one-service**, for consistency with
  the film path (BIN-513 already accepted that tradeoff), when you're ready to sign off — not
  urgent, client-only advisor logic, adjustable anytime.
- **BIN-521** — Bundle-rådgivare nudge (multi-service → cheaper operator bundle). Carried,
  self-declared "ren idé, kräver egen brainstorm/design innan bygge." Recommend its own
  `/stakeholder-review` (Monetization + Data/Integrations) before any code.
- **BIN-544** (new) — Cache-miss logging for the recap feature, to prioritize coverage backfill
  by real demand instead of guesswork. Reasonable idea, but it's speculative pre-launch (zero
  users yet, so "real demand" signal doesn't exist to log against today) and adds an analytics
  surface without a clear near-term consumer. Recommend: **hold** until there's real traffic to
  measure — revisit alongside BIN-419's SEO re-measurement (~2026-08-28) when there's usage to
  look at. Not urgent.
- **BIN-543** (new) — `leavingRollup` resumable MOTN pagination cursor, to avoid a mid-cycle
  blackout "under sustained demand." Real engineering hardening, but the risk it prevents is
  explicitly conditional on demand binge doesn't have yet pre-launch (BIN-541 already gave this
  job its own small `LEAVING_HARD_CYCLE_CAP = 150` allocation, well under the 500/mo pool) — and
  the fix touches `functions/**` pagination logic (Tier C, real complexity: cursor persistence +
  resume semantics). Recommend: **defer** until `leavingRollup` is actually observed hitting its
  cap in production (the health/staleness signal BIN-541 added would surface that) — building
  resumability against a hypothetical load now risks the same kind of over-engineering-vs-actual-
  behavior mismatch that caused this sprint's two reverts. Not urgent.

## Deferred, no new judgment needed (already-decided in memory, left in Backlog)

BIN-402/454/468 (TMDB ToS sweep — mutateEnabled deliberately deferred to a real-traffic gate
~Aug). BIN-170 (Binge Wrapped — booked Nov). BIN-189 (Seasonal challenges — panel-approved for
Aug/Sept build, not now). BIN-419 (SEO re-measurement, not due until 2026-08-28). BIN-520
(BIN-507 orchestration-test follow-up — low priority, already deferred last sprint; re-verified
via grep, its intended resolution was never actually committed — leaving deferred, low value).
**BIN-534** (CI runs the full test suite twice after BIN-525's coverage step) — legitimate small
tech-debt fix, but dropped for this sprint's capacity (10 tickets already selected); carry to
next sprint, no judgment issue.

## Obsolete (git/code shows already done, Linear still open)

- **BIN-541** — MOTN vendor quota monthly-vs-daily fix. Verified via grep of current `main`:
  `functions/src/streamingOffers/index.ts` and `functions/src/leavingRollup/index.ts` both use
  renamed `STREAMING_HARD_CYCLE_CAP`/`LEAVING_HARD_CYCLE_CAP` constants with a shared
  `reserveMotnSlot`/`motnCycle` budget-reservation mechanism — exactly the fix BIN-541
  specified. Shipped under commit `12b88f4` (2026-07-17). Ticket was never transitioned to
  Done; recommend closing it citing that commit rather than re-implementing.

## Post-sprint steps

1. `npm run typecheck` across all touched files.
2. **Rules batch (BIN-540/542) is plan-gated per the working agreement** — write the expanded
   plan, get Malin's explicit go-ahead, THEN implement. Do not Edit/Write firestore.rules before
   that go-ahead lands.
3. File Linear follow-ups for anything deferred mid-implementation.
4. Commit through the review gates (code/security/test markers as triggered — note ALL five
   batches trigger `binge-code-reviewer`; social/data/auth/rules batches additionally trigger
   `binge-security-reviewer` per their file patterns). Conventional commit(s) referencing all
   ticket ids. Given the rules batch is plan-gated separately, consider a SEPARATE commit for
   BIN-540/542 once approved, rather than bundling with the other four batches.
5. Push (deploys hosting on push) → poll `deploy.yml` → purge Cloudflare. BIN-523/529 touch
   `functions/**` (manual `firebase deploy --only functions` required — deploy.yml doesn't cover
   it). BIN-540/542 touch `firestore.rules` (manual `firebase deploy --only firestore:rules`
   required, AFTER Malin's go-ahead).
6. Transition: Tier A build + all-pass → Done. BIN-510/523's Tier C status + prior-revert
   history means any unresolved verification concern parks them In Review rather than Done, even
   if the code compiles and tests pass — the bar this round is "doesn't repeat the specific
   failure mode that got them reverted last time," not just "green tests."
7. Close BIN-541 as obsolete, citing `12b88f4`.

---

# PLAN — BIN-541: MOTN vendor quota is monthly (500/mo hard limit), not daily (100/day) — 2026-07-17

**Class:** `functions/**` (sensitive domain, router tier `medium`, owning role #13
Data/Integrations Engineer). Blind critique from #13 obtained 2026-07-17 (endorse-with-
changes, 3 blocking concerns folded in below). Awaiting Malin's go-ahead + one missing fact
(exact vendor reset-cycle date) before any Edit/Write.

## Trigger
RapidAPI "quota 85% used" email (2026-07-16) turned out to be real: Malin's dashboard check
(2026-07-17) shows the actual MOTN/RapidAPI Basic plan is **$0.00/mo, 500 API requests/MONTH,
Hard Limit** (calls rejected once exhausted — no overage billing risk, but the vendor
integration goes dark for the rest of the billing period). Code assumed 100/day resetting
UTC daily (BIN-320, docs/org/adr/0006). That assumption was never verified against the real
plan terms and is wrong on both axes: wrong period (monthly, not daily) and wrong size
relationship (an 85-90/day allowance against a 500/month pool can exhaust the month in ~6
days if ever fully used).

## Verified facts
- `functions/src/streamingOffers/index.ts` (BIN-320): reserves slots against
  `motnBudget/{utcDay}`, `HARD_DAILY_CAP=90`, `DAILY_BUDGET=85`. Today's actual usage was
  only ~16 calls (`streamingHealth/current.workSetSize: 16`) — this job alone isn't the
  problem at current library size.
- `functions/src/leavingRollup/index.ts` + `motnChanges.ts` (BIN-178): calls MOTN's
  `/changes` endpoint daily, paginated up to `MAX_PAGES=20` — **zero quota-safety counter**.
  Up to 20 calls/day, completely unmetered — the likelier actual driver of the 85%-used
  alert.
- Vendor "Rate Limit: 1000 requests/hour" is a non-issue at these volumes — not worth gating.

## Fix (role #13 critique folded in)
1. **Do not port the existing 429→"burn to cap" behavior verbatim to a monthly counter.**
   Today a 429 zeroes the *daily* remainder (worst case: one bad day lost). At monthly
   granularity the same logic would zero the *whole month's* remaining budget on a single
   transient hourly-rate-limit 429, which is a different failure and much worse. Must
   distinguish "hourly throttle, retry next run" from "monthly quota actually exhausted"
   (e.g. inspect a `Retry-After`/reset-window header if RapidAPI sends one, or treat repeat
   429s across N consecutive runs as real exhaustion, not the first one).
2. **Fold `leavingRollup` into the SAME shared reservation counter for real** — add an actual
   `reserveSlot`-style check inside `motnChanges.ts`'s pagination loop (per page, before each
   fetch), not just after-the-fact attribution. Both jobs must draw from one Firestore counter
   that reflects true combined vendor usage.
3. **Give each job an explicit sub-allocation, not a free-for-all draw** — e.g. leavingRollup
   gets a fixed small daily/monthly ceiling (it doesn't need much — it's one rollup doc), and
   streamingOffersRefresh gets the remainder. Prevents either job from silently starving the
   other.
4. **Confirm the real reset-cycle boundary before hardcoding a `YYYY-MM` UTC key** — the
   dashboard screenshot shows "500/Month" but not the reset day. If it's a rolling 30-day
   window anchored to signup date rather than a UTC calendar month, a naive calendar-month
   key can either falsely show budget available right after the real reset, or double-spend
   across the mismatch window. **Needs Malin to check** the RapidAPI/Nokia account billing
   page for the actual renewal date (usually shown near the plan/subscription details).
5. **Add a staleness/admin-alert signal for leavingRollup**, mirroring what
   `streamingOffers` already has (`notifyAdmin`/`streamingHealth`) — today leavingRollup has
   no equivalent, so if its slice of the budget runs out, "vad försvinner" goes silently
   stale with no signal.
6. **Rename `DAILY_BUDGET`/`HARD_DAILY_CAP`** to something that names the real unit (e.g.
   `MONTHLY_BUDGET`/`HARD_MONTHLY_CAP`) — role #13: the stale name is exactly how this got
   miscalibrated once already.
7. Leave a new dated decision note (append-only, per repo convention) superseding BIN-320's
   "100/day" assumption — NOT a silent rewrite of ADR-0006 (which is about timezone choice,
   still probably fine) or the BIN-320 comments (historical record of what was believed at
   the time).

## Explicitly not doing
- Not adding any paid tier / clicking "Upgrade Plan" — that's Malin's call alone, not bundled
  into this fix.
- Not building an hourly rate-limit gate (1000/hr is not a real constraint at binge's volume).

## Open question for Malin — RESOLVED 2026-07-17
Subscription was created **2026-06-21**; Malin isn't 100% certain but has no evidence of a
calendar-month reset. **Working assumption: rolling window anchored to the 21st of each
month** (not UTC calendar month). Counter key = the current billing-cycle start date (the
most recent 21st-of-month on/before today), not `YYYY-MM`. Kept a generous buffer (~10%
under 500) regardless, since the anchor-date belief isn't independently confirmed — if a
future run gets rejected well before the next 21st, that's a signal this assumption is wrong
and the anchor needs correcting (log the vendor's actual rejection date if it happens).

## Acceptance criteria (draft — will firm up once reset-date question resolves)
- [ ] One shared Firestore counter reflects combined MOTN usage from BOTH
      `streamingOffersRefresh` and `leavingRollup`, keyed to the vendor's real reset cycle.
- [ ] `leavingRollup`'s `/changes` pagination reserves a slot per page before each call (not
      after-the-fact accounting).
- [ ] A stray 429 no longer zeroes the full month's remaining budget — distinguishes
      transient/hourly throttling from real monthly exhaustion.
- [ ] Each job has an explicit sub-allocation; neither can silently starve the other.
- [ ] leavingRollup gets an admin-visible staleness signal when its allocation is exhausted,
      matching streamingOffers' existing pattern.
- [ ] Constants renamed to name the real unit (monthly, not daily).
- [ ] New/updated tests cover: shared-counter reservation across both jobs, 429 handling that
      doesn't over-burn, sub-allocation isolation.
- [ ] Dated decision note added (not a silent rewrite of BIN-320/ADR-0006).
- [ ] `functions/**` → binge-security-reviewer + binge-code-reviewer gates; Tier-D manual
      `firebase deploy --only functions` (deploy.yml doesn't deploy functions).

## Open questions
No architecture-changing unknowns remain — the one substantive open question (billing-cycle
reset date) was resolved via AskUserQuestion earlier (see "Open question for Malin —
RESOLVED" above: rolling window anchored to the 21st, working assumption, safety buffer
applied). Everything since is fix-forward work under this SAME approved plan, driven by the
`functions/**` review gates this plan itself required (binge-security-reviewer,
binge-test-reviewer, `/code-review xhigh`) — three review rounds each found real defects,
fixed in turn, no new scope or design decision introduced:
- Round 1 (8 findings): PER_RUN_SELECT/cycle-cap pacing mismatch, 429-vs-budget write gating
  on `streamingLeaving/current`, `computeHealth` conflation, `staleNotified` swallow-on-no-op,
  throttle-streak-reset-by-no-signal, `dayId.ts` short-month anchor bug, duplicated
  `markStaleOnce`.
- Round 2 (9 findings): leavingRollup's incomplete-run guard firing the shared alert on an
  UNCONFIRMED single 429 (bypassing the 2-run confirmation the round-1 fix built), a
  mid-pagination non-429 failure not caught by the completeness guard, missing Scheduler
  idempotency guard, `notify()`-throws-skips-budget-write coupling, redundant double-notify,
  missing tests for the extracted `notifyOnceForCycle`, `computeHealth` thresholds
  uncalibrated for the new `PER_RUN_SELECT`, triplicated notification boilerplate.
- Round 3 (7 distinct findings, session hit its usage limit mid-review — sweep/synthesize
  steps didn't complete, fixing the verified findings by hand): `complete` flag incorrectly
  true on `hasMore:true` + missing `nextCursor` (OR-logic bug), `lastRunAt` idempotency marker
  written BEFORE risky pagination instead of after (unlike streamingOffersRefresh's actual
  pattern), `notifyOnceForCycle`'s check-then-act race under Cloud Scheduler's at-least-once
  delivery, duplicated throttle-confirmation block between the two jobs. One round-3 finding
  (streamingOffers no longer burns the bucket on a single 429) is NOT a regression — it's
  restating round 1's deliberate, security-reviewed fix; not changed.

---

# PLAN — BIN-509: Tillsammans session write rules (caller binding) — 2026-07-16

**Class:** firestore.rules (sensitive domain, router tier `top`). Full panel convened
2026-07-16 (Security #4, DPO #6, QA #7, DBA #27 + Codebase Archaeologist), all
approve-with-conditions, zero inter-role conflicts, TWO escalations for Malin (below).
Metrics event logged. Malin gave intent go-ahead ("go ahead") for panel+plan; build
awaits her answers + plan approval.

## The holes (verified against firestore.rules @ HEAD 3644a22)

1. **Swipes (L778-786) — ZERO auth binding.** `allow create, update` checks only doc
   shape (hasOnly['votes','updatedAt'], votes map ≤50). No isSignedIn(), no caller
   binding, no expiry gate. ANY caller (anon link-holder included; participants/swipes
   are public-read so participant ids are enumerable) can setDoc WITHOUT merge and
   replace/forge any participant's vote. matching.ts treats 'veto' as -Infinity → one
   hostile client silently kills every match or fabricates one. "One veto per session"
   is client-UI-only. This hole has existed since Tillsammans launch — BIN-24 only
   touched participants, never swipes (archaeologist-verified).
2. **Participants (L755-776) — uid FIELD bound (BIN-24), doc PATH not.** A signed-in
   user can setDoc(participants/{anyPid}, {uid:<own uid>,…}) overwriting another
   participant's slot — including hijacking an ANON participant's slot (uid-field check
   passes because the field is "honest"). Corrupts displayName/providers → feeds
   computeSessionProviders → candidate filtering.

**Identity model (ground truth):** pid = `existingUid ?? generateSecureToken()` — pid==uid
for signed-in; a random unguessable client token for anon (request.auth is null; NOT
Firebase Anonymous Auth — rules cannot verify anon identity, structurally).

## Fix (panel-conditioned)

### firestore.rules — swipes block
- **Create branch** (resource == null): payload shape checks + votes.keys() constraint —
  NEVER touch resource.data on create (diff()-on-create throws → denies ALL first votes;
  4 roles + archaeologist flagged independently; every existing .diff() use in this file
  is update-only for this reason).
- **Update branch:** `votes.diff(resource.data.votes).affectedKeys()` must be exactly ONE key.
- **Signed-in callers:** that one key must == request.auth.uid (their pid).
- **Anon callers:** single-key constraint only (stops wholesale map replacement /
  veto-storms). NO fake "secret" binding — any secret on a public-read doc is readable,
  a false proof (Security). Residual anon-vs-anon forgery → ESCALATION A.
- **Vote VALUE enum** (`in ['yes','no','veto']`) — trivially adjacent to the diff logic,
  included (archaeologist scope-call).
- **Expiry gate** `get(sessions/$(sessionId)).data.expiresAt > request.time` — reuses the
  existing get() pattern from this block's delete rules. BUT: ESCALATION B (reverses a
  prior founder decision).
- Update the stale block comment (L741-742 "unlisted-link-modellen räcker") — it justifies
  the old loose model and would mislead the next reader.

### firestore.rules — participants block
- Signed-in branch: add `pid == request.auth.uid` (path binding on top of BIN-24's field
  binding). Anon branch (uid == null) unchanged — pid unbindable, token-trust model.
- Expiry gate on participants: ONLY if Escalation B says yes, and then existing BIN-24
  tests (~L697-741, which never seed a parent session doc) must be re-seeded, not loosened.

### src/test/rules/firestore-rules.test.ts (extend BIN-24 describe block + new sibling swipes block, reuse ownerDb/anonDb/otherDb + validParticipant factory)
DENY: signed-in writes vote key ≠ own uid; signed-in overwrites another pid's slot (incl.
hijacking an anon slot); multi-key votes diff (any caller); non-merge setDoc that CHANGES
another participant's existing key (QA: a same-content replacement + one new key is
legitimately allowed — don't assert it as deny); write after expiresAt (if gate ships;
seed parent session via withSecurityRulesDisabled with explicit past/future expiresAt);
invalid vote value. ALLOW (regression): own-vote create (first swipe on fresh tmdbId —
the create branch); own-vote merge update (recordSwipe shape: setDoc merge:true
{votes:{[pid]:vote}, updatedAt} — deep-merges, diff isolates own key); anon participant
create; anon single-key vote. Re-run FULL existing sessions tests — if the expiry gate
breaks BIN-24 tests, seed sessions docs, never weaken the gate.

### Honesty scope (QA/DBA/DPO binding)
Ticket/commit language = "closes SIGNED-IN cross-participant vote + slot forgery; caps
anon writes to single-key; anon-vs-anon forgery remains {per Escalation A}". NEVER "closes
all vote forgery". A test named "anon forgery blocked" cannot be true — don't write one.

### Pre-deploy check (DBA)
Query live sessions/*/participants for docs with uid != null && docId != uid (legacy
pattern-mismatch would brick their lastActiveAt/veto updates under the new path binding).
Any found within TTL window → carve-out or delete before rules deploy.

### Deploy (Tier-D)
Manual `firebase deploy --only firestore:rules` FIRST (deploy.yml ships hosting only);
no client code change expected (recordSwipe's write shape already passes the new rules —
QA traced). xhigh /code-review (rules diff) + binge-security-reviewer + binge-test-reviewer
gates. Accepted-deviations entry for the anon residual (per Escalation A). ADR for
Escalation B's outcome (reverses BIN-24's recorded call).

## ESCALATION A — anonymous-forgery residual (all 4 roles converge, Malin decides)
Rules can't authenticate an anonymous caller. Options:
- **A1 (panel lean):** accept residual — anon participants can still forge OTHER ANON
  participants' single votes (not signed-in ones; not wholesale). Ephemeral 7-day data,
  unlisted-link trust model, zero new data elements. Record in accepted-deviations.md.
- **A2:** require sign-in to swipe — closes everything, breaks anonymous participation
  (product regression for the link-share flow).
- **A3:** Firebase Anonymous Auth — real binding for everyone, but a NEW pseudonymous
  identifier in Firebase Auth: GDPR inventory + retention/reaper story required (DPO:
  anon auth accounts never auto-expire; BIN-480-class follow-up), new auth provider.

## ESCALATION B — expiry gate reverses a recorded founder decision
BIN-24's commit (e6d02e8) explicitly says "Expiry-gate medvetet utelämnad (kostnad)" —
Malin already decided ONCE against this gate on cost grounds. Adding it now = +1 billed
read per swipe write (hottest session write path; ~0.01 kr per 300 swipes — trivial at
current traffic under the 25 SEK cap, but ongoing). Value: blocks zombie-session write
floods in the up-to-30-day window before retentionCleanup reaps expired sessions.
- **B1 (panel lean):** add the gate on swipes (+ participants), document the read cost.
- **B2:** keep BIN-24's call — skip the gate, rely on retentionCleanup's 30d reap.

## Follow-up (file, don't build here): vetoRemaining/isHost value forging
Participants can self-write vetoRemaining:999 / isHost:true raw (hasOnly lists keys, no
value validation; one-veto cap is client-only). Adjacent, real, but its own small ticket.

## Acceptance criteria (panel conditions folded — BINDING)
- [ ] Create/update split — no unconditional resource.data reference (deny-all-creates bug class).
- [ ] Signed-in: vote key == auth.uid; pid == auth.uid path binding. Anon: single-key cap.
- [ ] Vote value enum enforced.
- [ ] Expiry gate per Escalation B (+ re-seeded BIN-24 tests if yes).
- [ ] Deny+allow tests per QA list; full sessions suite green (npm run test:rules, Java/JBR).
- [ ] Legacy pid!=uid spot-check before deploy.
- [ ] Stale block comment updated; accepted-deviations entry (anon residual per A); ADR (B).
- [ ] Honest scope language in ticket/commit.
- [ ] Manual rules deploy + xhigh review + security/test reviewer gates.

---

# Archive — Sprint 2026-07-16 (shipped, 2 reverted)

Full detail: `git show 84e7f4d:tasks/todo.md`. Shipped BIN-528/525/517/516/522 + BIN-509
(cae9541) + BIN-541 (12b88f4, now marked obsolete above — never Done'd in Linear).
BIN-523/510 REVERTED before deploy (3644a22, failed sprint verification) — both re-selected
as retries in this sprint's "social" and "data" batches above, with the specific failure
modes cited so the retries don't repeat them.

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
