# Sprint 2026-07-10 — workflow-map hygiene + advisor outage follow-up + TMDB ToS sweep

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 11 open tickets (Todo/In Progress both
empty before this run). Only 3 clear a "build"/"build-review" mandate. The other
8 are unchanged or newly-arrived variants of honest reads from prior sprints:
still gated on a date/cache event, or still genuinely Malin's call. No
manufactured work to fill N — a small batch is the correct call here.

## Agent A — infra (workflow-map re-trace)

- [ ] **[Tier A] BIN-449** — Re-trace the stale workflow-map flows flagged by
  `.claude/state/workflow-map-stale.json` (stamped 2026-07-09T20:00, triggered by
  BIN-422/423 + household-work edits to `firestore.rules`,
  `src/app/person/[id]/page.tsx`, `src/components/groups/HouseholdPanel.tsx`,
  `src/components/pages/MoviePageClient.tsx`, `src/hooks/useGroupHousehold.ts`,
  `src/lib/firebase/accountDeletion.ts`, `src/lib/tmdb/client.ts`). Per CLAUDE.md's
  "Workflow map freshness" contract: re-trace ONLY the flows whose nodes match the
  flag's triggers, update the map's `<script id="data">` JSON (nothing else), run
  the linter, delete the flag, commit.
  - Disposition: **build** (repo-mandated mechanical hygiene, no product/UI
    decision — CLAUDE.md itself specifies the exact procedure).
  - Router: `node docs/org/route.mjs docs/workflow-map.html` → tier **skip**
    (doc-only, owned solely by role #21 Technical Writer — never the sole MEDIUM
    reviewer for a code change, and here it's not even a code change).
  - requiresPlanMode: **false** (skip tier).
  - Files:
    - `docs/workflow-map.html` (~2571 lines — update ONLY the `<script id="data">`
      JSON block for the flows whose nodes match the flag's triggers)
    - `.claude/state/workflow-map-stale.json` (delete after the map update)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. Every trigger path in the flag (`firestore.rules`, `person/[id]/page.tsx`,
       `HouseholdPanel.tsx`, `MoviePageClient.tsx`, `useGroupHousehold.ts`,
       `accountDeletion.ts`, `tmdb/client.ts`) is reflected in an updated or
       added flow node in the map's data JSON — proven by diffing the JSON
       against the trigger list.
    2. `node scripts/check-workflow-map.mjs` passes (no dangling path references,
       no function/route missing flow coverage).
    3. `.claude/state/workflow-map-stale.json` no longer exists after the commit.
    4. No file other than `docs/workflow-map.html`'s data JSON and the deleted
       flag is touched — per CLAUDE.md's explicit "nothing else" instruction
       (don't rebuild the whole map, don't touch unrelated flows).

## Agent B — streaming (advisor outage empty-state, BIN-448)

- [ ] **[Tier B] BIN-448** — Streamingrådgivaren: distinguish a TMDB-outage state
  from a genuine "no services" state in the savings-page empty view, for the
  narrower remaining case BIN-442 didn't cover: `providers: []`, `hasError: true`,
  `bundleSuggestions: []` (user owns services, none happen to be bundle-eligible,
  and TMDB failed) — today this still falls through to the misleading "Inga
  tjänster tillagda än" empty state, exactly the false "you have no services"
  screen BIN-442 fixed for the wider case.
  - Disposition: **build-review** (the underlying misleading-state bug is a
    clear build, but the specific fix requires new user-facing copy — an
    "avbrottsmedveten" message replacing/augmenting the empty state — which is a
    product/UX wording decision. Ship a best-guess fix; Malin should review the
    exact copy/treatment before it's marked Done, per the ticket's own explicit
    "if Malin decides the nuance isn't wanted, close deliberately instead" option).
  - signoffReason: the new outage-aware copy/wording in the savings-page empty
    state (or her call that the existing empty state is fine as-is and this
    should be closed without a UI change).
  - Router: `node docs/org/route.mjs src/app/savings/page.tsx
    src/hooks/useSubscriptionAdvisor.ts` → tier **medium** (single) · owning role
    **#28 Recommendations / Scoring-Integrity Engineer** (same role attached to
    BIN-430/433/440/442).
  - requiresPlanMode: **false** (single + priority Medium(3), not ≤2, no security
    label).
  - Files:
    - `src/app/savings/page.tsx` (~200-235 — add a branch for
      `hasError && providers.length === 0 && bundleSuggestions.length === 0`)
    - `src/app/savings/page.test.tsx` (existing file from BIN-442 — extend with
      the new regression case)
    - `src/hooks/useSubscriptionAdvisor.ts` (read-only reference — `hasError` is
      already exposed; don't touch its computation)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. When `hasError === true` and `providers.length === 0` and
       `bundleSuggestions.length === 0`, the page shows outage-aware messaging —
       NOT the "Inga tjänster tillagda än" no-services copy — proven by a new
       test stubbing exactly that shape.
    2. The genuine no-services case (`hasError: false, providers: [],
       bundleSuggestions: []`) still shows the existing EmptyState unchanged —
       proven by a test (or the existing test left passing and asserted).
    3. The already-fixed BIN-442 path (`hasError: true, providers: [],
       bundleSuggestions: [oneSuggestion]`) still renders `BundleArbitrageCard`
       unchanged — no regression to the prior fix.
    4. `npm run typecheck` and `src/app/savings/page.test.tsx` stay green; the
       new/changed copy string(s) are called out explicitly in the close-out
       comment for Malin's review (not silently auto-closed Done).

## Agent C — data (TMDB ToS sweep, BIN-402) — Tier C, expanded plan required

- [ ] **[Tier C] BIN-402** — Build the periodic sweep mechanism Malin approved
  2026-07-02 when she accepted the risk on unbounded-TTL denormalized TMDB fields
  on watchlist docs (TMDB ToS §1.C forbids caching API data >6 months): a
  scheduled Cloud Function (likely monthly), chunked `writeBatch`, refreshing-or-
  clearing all denormalized TMDB fields older than 6 months for ALL users
  (dormant accounts included — client-side read-repair doesn't reach them).
  - Disposition: **build** (mandate is clear and explicit — this is a named
    follow-up to Malin's own 2026-07-02 decision, not a speculative idea) — BUT
    this is a Cloud Functions + Firestore-migration change, both explicitly
    listed in CLAUDE.md's "plan before large changes" trigger list AND in
    `cfg.tierCTriggers` ("functions/**", "Firestore migrations"). Per the
    sprint-execute skill's Tier C rule, an EXPANDED PLAN (Phase 1.5) is
    mandatory before any Edit/Write — this ticket does not skip straight to
    code. It also cannot auto-close Done: Tier C lands In Review for sign-off
    (budget/cost math + the "accepted risk, gate it as a separate chore" framing
    both warrant her eyes before it ships to production data).
  - Router: `node docs/org/route.mjs firestore.rules src/lib/firebase/userData.ts
    functions/src/index.ts` (blast-radius estimate — closest real analog is the
    user-owned-data collector pattern) → tier **top** (full-panel) via the
    high-stakes path `src/lib/firebase/userData.ts` → roles **#5 Legal/GDPR
    Counsel, #6 Data Protection Officer, #27 Database Administrator/Data-layer
    Engineer**.
  - requiresPlanMode: **true** (full-panel tier, AND independently a
    `cfg.tierCTriggers` hit on both "functions/**" and "Firestore migrations").
  - Files (estimate — confirm in the expanded plan):
    - `functions/src/ttlSweep/index.ts` or similar new scheduled-function module
      (new file, mirrors the `episodeNotify`/`retentionCleanup` pattern)
    - `functions/src/index.ts` (export wiring for the new scheduled function)
    - Possibly `src/lib/firebase/userData.ts` reference only, if reusing the
      shared per-user-subcollection enumeration helper
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. An expanded plan (Phase 1.5 block) is written into this file BEFORE any
       Edit/Write, covering: which fields sweep (title, posterPath,
       providers/providersCheckedAt, genreIds, tmdbStatus, runtime,
       nextAirDate/nextAirCode/nextAirProvider/nextAirUpdatedAt/
       digitalReleaseDate), chunking strategy, and a documented read/write-volume
       vs. 25 SEK/mån Blaze-cap cost estimate.
    2. The sweep mechanism reaches ALL users (dormant accounts included), not
       just active-client read-repair — proven by the implementation being a
       server-side scheduled function, not a client hook.
    3. No TMDB-derived field >6 months old survives a sweep run against a test
       fixture with stale timestamps.
    4. Swept docs receive NO `updatedAt` bump — proven by a test asserting
       `updatedAt` is unchanged pre/post-sweep (protects "Fortsätt titta" sort
       order in `continueWatching.ts`, an explicit "don't do X" from the ticket).

## Not selected (mandate / gating — surfaced, not built)

- **BIN-189** (seasonal challenges — Nordic Noir November etc., Low) — new
  shareable feature with real design surface (progress rings, badges, share
  cards). Recommendation: worth exploring as a themed mini-sprint, needs a
  design pass first — not something to silently build into existence.
- **BIN-170** (Binge Wrapped year-in-review, Low) — new shareable feature, needs
  a design pass (what stats, what the share-card looks like). Recommendation:
  fun, low urgency; revisit as a themed mini-sprint closer to a natural moment
  (December/new year) rather than now. Unchanged from prior sprints.
- **BIN-185** (spoiler-safe catch-up recaps, Low) — new AI-generated-content
  feature; spoiler-boundary trust is high-stakes if wrong, needs a design/UX
  pass first. Recommendation: worth exploring, needs a design spike before it's
  a ticket that builds itself. Unchanged.
- **BIN-360** (targeted "släpps idag" FCM push, Low) — a new push-notification
  channel; UX/consent call (frequency, opt-in default) she should weigh in on
  before it's built. Recommendation: build a small opt-in proposal for her to
  react to, not a silent ship. Unchanged.
- **BIN-173** (affiliate-tag rent/buy deeplinks, Medium) — real revenue
  opportunity but a business/legal call (affiliate program terms, disclosure
  copy, which networks) Malin hasn't greenlit. Recommendation: worth doing,
  needs her decision on which affiliate program(s) first. Unchanged.
- **BIN-424** (SEO hub-topology review, Low) — a scoping *review* of three
  separate new-URL-surface ideas (hub-of-hubs, genre hubs, forsvinner SSR), each
  needing its own product/keyword-targeting call before it's a buildable
  ticket — not itself a code change. Recommendation: worth a scoping pass now
  that WP1-3 have shipped, but that session is Malin's call to schedule.
  Unchanged.
- **BIN-419** (SEO re-measure content-floor impact, Low) — explicit due date
  2026-08-28, not due for ~7 more weeks. Recommendation: leave parked; revisit
  near the date. Unchanged.
- **BIN-447** (Cloudflare-purge backstop for BIN-423 WP3 person filmography,
  Medium) — mandate is clear (Malin's own backstop ticket) but genuinely not
  actionable today: the build cache only re-seeds person entries at the next
  weekly scheduled refresh (~2026-07-13); running the purge now would be a
  no-op. Recommendation: do it — just not yet. Revisit ~2026-07-13; note any
  `/commit`-driven deploy before then auto-purges everything and may resolve
  this for free. Unchanged from the 2026-07-09 read.

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.

## Post-sprint steps

- [ ] Phase 2: implement BIN-449 first (mechanical, zero risk, unblocks the
  dangling CI-freshness flag), then BIN-448 (TDD the outage-branch test first),
  then BIN-402 LAST — write its expanded plan (Phase 1.5) before any Edit/Write,
  since it's the one Tier C / full-panel item.
- [ ] Phase 1.4: convene the stakeholder panel for BIN-402 (full-panel — Legal
  #5, DPO #6, DBA #27) and the single-reviewer critique for BIN-448 (role #28)
  before implementing either; fold must-haves into the acceptance criteria above.
- [ ] Phase 2.7: fresh-context verifier grades the acceptance criteria above from
  diff + tests only, per ticket.
- [ ] Phase 3: commit (code-reviewer marker for all three; test-reviewer marker
  for BIN-448/BIN-402's test files; security-reviewer marker for BIN-402's
  functions/ changes), push (push triggers deploy — but BIN-402 needs an
  explicit go-ahead per CLAUDE.md's Cloud-Functions large-change rule before its
  commit ships, not just the reviewer markers). BIN-449 → Done on all-pass.
  BIN-448 and BIN-402 → In Review (build-review / Tier C) regardless of
  criteria outcome, per their tier semantics.

---

# Archived — Sprint 2026-07-09 (b) — bundle-arbitrage resilience + test-guard follow-ups

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 9 open tickets (Todo/In Progress both
empty). Only 2 clear a "build" mandate. The other 7 are unchanged or newly-arrived
variants of the same honest reads from the last two sprints: still gated on a
date/cache event, or still genuinely Malin's call. No manufactured work to fill
N — a small batch is the correct call here.

## Agent A — streaming (bundle-arbitrage diff follow-ups, round 2)

Both tickets trace back to the BIN-430 ship. Files are disjoint (page/hook vs. a
design-system test file) so there's no patch-conflict risk running them in one
batch/one agent.

- [x] **[Tier A] BIN-442** — Bundle-arbitrage card hidden during a TMDB outage —
  decouple it from the `providers.length === 0` empty-state guard. Shipped
  (87357bb).
- [x] **[Tier A] BIN-441** — Decide + close the deferred BIN-439 sub-scope: a
  savings-cluster-specific design-token guard in `consistency.test.ts`. Shipped.

## Not selected (mandate / gating — surfaced, not built)

- **BIN-447** (SEO/infra, Medium) — Cloudflare-purge backstop for BIN-423 WP3
  person-filmography static HTML. Time-gated, not actionable until ~2026-07-13.
- **BIN-419** (SEO measurement, Low) — explicit due date 2026-08-28.
- **BIN-424** (SEO hub-topology review, Low) — scoping review, needs her call.
- **BIN-173** (affiliate-tag rent/buy deeplinks, Medium) — business/legal call.
- **BIN-360** (targeted "släpps idag" FCM push, Low) — UX/consent call.
- **BIN-185** (spoiler-safe catch-up recaps, Low) — needs design spike.
- **BIN-170** (Binge Wrapped year-in-review, Low) — needs design pass.

## Needs you (Tier D)

None this round.

## Post-sprint steps

- [x] Phase 2/2.7/3 complete — commit 87357bb, pushed, deployed.

---

# Archived — Sprint 2026-07-09 (a) — BIN-430 traceability follow-ups

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 10 open tickets. Only 2 clear a "build"
mandate — both are BIN-430 follow-ups filed by the post-sprint completeness sweep.
The other 8 are unchanged from the 2026-07-07 sprint's honest read: still gated,
still not due, or still genuinely Malin's call (see "Not selected" below). No
manufactured work to fill N — a small batch is the correct call here.

## Agent A — streaming (BIN-430 diff follow-ups)

Both tickets touch the same three files from the BIN-430 ship (untested wiring +
an unresolved reviewer note on the same diff), so they run as ONE batch/one agent,
sequenced, to avoid file-conflict risk between "investigate + maybe fix" and
"add test coverage" landing on the same lines.

- [x] **[Tier A] BIN-440** — Recover the test-reviewer's lost medium production-code
  correctness note from the BIN-430 ship. Real bug found and fixed → BIN-442
  filed for the actual fix (decouple bundle card from providers-empty guard).
- [x] **[Tier A] BIN-439** — Add hook-level test coverage for the untested
  `bundleSuggestions` `useMemo` in `useSubscriptionAdvisor.ts`. Shipped; a minor
  deferred sub-scope (savings-cluster-specific design-token guard) split out to
  BIN-441.

## Not selected (mandate / gating — surfaced, not built)

Unchanged from the 2026-07-07 read — re-checked against today's backlog, nothing
has moved:

- **BIN-422/BIN-423** (SEO internal-linking WP2/WP3+WP4) — shipped this session
  (b72c799) — see the new sprint above.
- **BIN-424** (SEO hub-topology review) — the ticket itself says "evaluate after
  WP1-3 land"; WP2/3 haven't shipped yet (see above). Not yet scoped. Recommendation:
  revisit once BIN-422/423 ship.
- **BIN-419** (SEO re-measure content-floor impact) — explicit due date
  2026-08-28, not due for ~7 more weeks. Recommendation: leave parked; a
  reminder/cron could pick this up near the date.
- **BIN-173** (affiliate-tag rent/buy deeplinks) — real revenue opportunity but a
  business/legal call (affiliate program terms, disclosure copy, which networks)
  that Malin hasn't greenlit. Recommendation: worth doing, needs her decision on
  which affiliate program(s) first.
- **BIN-360** (targeted "släpps idag" FCM push) — a new push-notification channel;
  UX/consent call (frequency, opt-in default) she should weigh in on before it's
  built. Recommendation: build a small opt-in proposal for her to react to, not a
  silent ship.
- **BIN-185** (spoiler-safe catch-up recaps) — new AI-generated-content feature,
  needs a design/UX pass (spoiler-boundary trust is high-stakes if wrong).
  Recommendation: worth exploring, needs a design spike before it's a ticket that
  builds itself.
- **BIN-170** (Binge Wrapped year-in-review) — new shareable feature, needs a
  design pass (what stats, what the share-card looks like). Recommendation: fun,
  low urgency; revisit as a themed mini-sprint closer to a natural moment (e.g.
  December/new year) rather than now.

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.

Post-sprint completeness sweep filed two follow-ups now archived in the sprint
above: BIN-440 (lost test-reviewer note) and BIN-439 (hook-level test gap).
