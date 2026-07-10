# Sprint 2026-07-10 — workflow-map re-trace (post-revert cleanup)

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 14 open tickets (Todo/In Progress both
empty before this run). Only 2 clear a "build" mandate. Six of the remaining
twelve are downstream of BIN-402 (the TMDB-field sweep), which was **auto-shipped
and then reverted off `main` earlier today** (commit e2cf608) — its rules +
Cloud Function are gone from the tree pending a founder-approved relaunch plan
(ADR 0009), so building tests/docs/runbook/fixes for that machinery right now
would target code that doesn't exist on main. The other six are unchanged
honest reads from prior sprints: still gated on a date/cache event, or still
genuinely Malin's call. No manufactured work to fill N — a small batch is the
correct call here.

## Important context for the implementer (read before starting)

`git show e2cf608` (the BIN-402 revert) touched `docs/workflow-map.html` and,
because the map edit was bundled into the same commit (38bfd3b) as the BIN-402
work, **collaterally wiped out the legitimate BIN-422/423 franchise/person-page
flow documentation** that a prior sprint had already added to `flow-titlepage`'s
description. Verified by grep: `docs/workflow-map.html` currently has ZERO
mentions of "BIN-422", "BIN-423", "franchiseByCollectionId", or
"combined_credits" — despite BIN-450's own ticket text claiming "the map edit
did re-trace the BIN-422/423 franchise/person flows." **BIN-450's premise is
stale — trust the grep, not the ticket text.** This sprint needs to redo that
lost re-trace, not just do the new BIN-448/savings one.

## Agent A — infra (workflow-map re-trace, merged BIN-449 + BIN-450)

Both tickets touch the same single file (`docs/workflow-map.html`) plus the
same stale-flag file, and the second is explicitly a follow-through on the
first's incomplete acceptance step — they run as one batch/one agent, two
sequential edits, to avoid any patch-conflict risk.

- [ ] **[Tier A] BIN-449** — Re-trace the workflow-map flows that went stale
  from BIN-422/423 + household work, per CLAUDE.md's "Workflow map freshness"
  contract.
  - Disposition: **build** (repo-mandated mechanical hygiene, no product/UI
    decision — CLAUDE.md itself specifies the exact procedure; doc-only).
  - Router: `node docs/org/route.mjs docs/workflow-map.html` → tier **skip**
    (doc-only, owned solely by role #21 Technical Writer).
  - requiresPlanMode: **false** (skip tier).
  - Files:
    - `docs/workflow-map.html` (`<script id="data">` JSON only)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. `flow-titlepage`'s description again names BIN-422 (franchise link on
       movie pages) and BIN-423 WP3/WP4 (person filmography + breadcrumbs) —
       proven by `grep -c "BIN-42[23]" docs/workflow-map.html` > 0 (it is
       currently 0; this re-adds work the revert collaterally destroyed, per
       the note above — don't just re-read BIN-450's stale claim that it's
       already done).
    2. Household-work nodes (`HouseholdPanel`, `useGroupHousehold`,
       `accountDeletion.ts`) stay documented and unbroken — they already are
       (verified pre-sprint); this criterion is a regression guard, not new
       work.
    3. `node scripts/check-workflow-map.mjs` passes.
    4. No file other than `docs/workflow-map.html`'s data JSON is touched by
       this step (the flag file is deleted in BIN-450 below, once both
       re-traces are in).

- [ ] **[Tier A] BIN-450** — Re-trace the /savings + Streamingrådgivaren flow
  (BIN-442/448 outage-aware empty-state change) into the map, then clear the
  now-current stale flag.
  - Disposition: **build** (same mechanical hygiene; doc-only).
  - Router: `node docs/org/route.mjs docs/workflow-map.html
    src/app/savings/page.tsx src/hooks/useSubscriptionAdvisor.ts` → tier
    **skip** (doc-only change to the map; the underlying advisor code isn't
    being touched, only its flow description).
  - requiresPlanMode: **false** (skip tier).
  - Files:
    - `docs/workflow-map.html` (`<script id="data">` JSON only)
    - `.claude/state/workflow-map-stale.json` (delete once BOTH re-traces
      above are reflected in the map)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. The advisor-flow node/description touching `useSubscriptionAdvisor.ts`
       mentions the BIN-442/448 outage-vs-no-services distinction (the
       `bundleSuggestions` outage-survival behavior + the savings-page empty
       state gating) — proven by reading the updated flow description.
    2. `node scripts/check-workflow-map.mjs` passes (currently green already;
       must stay green).
    3. `.claude/state/workflow-map-stale.json` no longer exists after the
       commit.
    4. No file other than `docs/workflow-map.html`'s data JSON and the deleted
       flag is touched — per CLAUDE.md's explicit "nothing else" instruction.
       `firestore.rules` is a trigger in the current flag but requires NO
       content change here (rules already documented pre-revert-cleanup;
       verify, don't touch).

## Not selected — downstream of the reverted BIN-402 (needs a founder-approved
## relaunch plan before any of these are actionable again)

BIN-402 (scheduled `tmdbFieldsSweep` + firestore.rules allowlist for
`tmdbFieldsRefreshedAt`) was reverted off `main` today (e2cf608) specifically
*because* it auto-shipped without a founder go-ahead and failed its own
verification. The full implementation is preserved on branch `bin-402-parked`.
Building any of the six tickets below now means writing tests for/documenting/
extending code that isn't in the tree, or re-touching `firestore.rules` for a
feature that was just pulled for exactly that reason. None of these are a
"clear, unambiguous build" — they're all contingent on a decision only Malin
can make (relaunch BIN-402 on a real plan, or drop it).

- **BIN-453** (Urgent) — "Write `tmdbFieldsRefreshedAt` freshness stamp on
  client writes." The correctness defect this describes is real and was the
  actual reason for today's revert — but fixing it means adding a stamp write
  gated by a `firestore.rules` allowlist entry that no longer exists on main.
  Recommendation: **do it, but only as part of a single BIN-402 relaunch plan**
  (rules + function + client stamp-writer land together, founder-approved) —
  not as a standalone piecemeal client change against absent rules.
- **BIN-452** (High) — "Test tmdbFieldsSweep orchestration." Tests code
  (`functions/src/tmdbTosSweep/`) that has been deleted from main.
  Recommendation: revisit once/if BIN-402 relaunches; not actionable today.
- **BIN-451** (Medium) — "Add tmdbFieldsSweep to workflow-map coverage
  universe." Would document a Cloud Function that isn't exported from
  `functions/src/index.ts` anymore. Recommendation: same as above — bundle
  into a future relaunch, don't build standalone.
- **BIN-454** (High) — "tmdbFieldsSweep rollout runbook." An ops runbook for a
  function that isn't deployed and isn't live. Recommendation: write this
  alongside the relaunch plan, not before it exists.
- **BIN-447** (Medium, SEO/infra) — Cloudflare-purge backstop for BIN-423 WP3
  person-filmography static HTML. Mandate is clear (a real backstop Malin
  filed) but genuinely not actionable today: the build cache only re-seeds
  person entries past their 6-day freshness window at the next weekly
  scheduled refresh (~2026-07-13); running the purge now would be a no-op.
  Recommendation: **do it — just not yet.** Revisit ~2026-07-13.
- **BIN-419** (Low, SEO measurement) — explicit due date 2026-08-28, not due
  for ~7 more weeks. Recommendation: leave parked; revisit near the date.

## Needs you — founder's call, not a mandate a sprint should assume (Linear
## comments not posted this round; recorded here for the decision queue)

- **BIN-424** (Low) — SEO hub-topology review (hub-of-hubs, genre hubs,
  `/forsvinner/[id]` server-rendering). The gate it names ("evaluate after
  WP1-3 ship") has technically cleared (all three shipped as of today), but
  the ticket itself is a scoping *review* of three separate new-URL-surface
  ideas, each needing its own product/keyword-targeting call — not itself a
  code change. Reason it's not a "build": scoping conclusions would bake in
  product decisions (which surfaces get built, what they target) without her
  input. Recommendation: worth a scoping pass now that the gate cleared, but
  scheduling that session is her call.
- **BIN-173** (Medium) — Affiliate-tag rent/buy provider deeplinks. Real,
  clearly-scoped revenue opportunity, but a business/legal call (which
  affiliate program, disclosure copy) she hasn't greenlit. Recommendation:
  worth doing — needs her decision on which affiliate program(s) first.
- **BIN-360** (Low) — Targeted "släpps idag" FCM push on SE digital release
  date. A new push-notification channel; UX/consent call (frequency, opt-in
  default) is hers to make before it's built. Recommendation: build a small
  opt-in proposal for her to react to, not a silent ship.
- **BIN-185** (Low) — Spoiler-safe catch-up recaps ("påminn mig var jag
  slutade"). New AI-generated-content feature; spoiler-boundary trust is
  high-stakes if wrong and needs a design/UX pass first. Recommendation:
  worth exploring, needs a design spike before it's buildable.
- **BIN-170** (Low) — "Binge Wrapped" year-in-review. New shareable feature,
  needs a design pass (what stats, share-card look) and has a natural seasonal
  moment (Dec/New Year) it should ship near. Recommendation: fun, low
  urgency — revisit as a themed mini-sprint closer to that moment.
- **BIN-189** (Low) — Seasonal challenges ("Nordic Noir November",
  "Oscarsjakten"). New editorial + engagement feature reusing existing list
  infra; low-medium engineering effort but the ticket itself frames Malin as
  the monthly content author ("you author 1-2/month — a content lever, not an
  engineering one") — the actual product decision (which challenges, cadence,
  badge design) is inherently hers. Recommendation: worth building the
  mechanism (join/progress doc + badge) once she picks the first challenge
  theme and badge treatment; don't build the UI blind.

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.

## Post-sprint steps

- [ ] Phase 2: implement BIN-449 then BIN-450 (sequential — 450 depends on 449's
  re-trace landing first, then deletes the flag), `node
  scripts/check-workflow-map.mjs` after each edit.
- [ ] Phase 2.7: fresh-context verifier grades the acceptance criteria above
  from diff + tests only, per ticket — pay special attention to criterion 1 on
  BIN-449 (the grep-provable claim that BIN-450's premise was stale).
- [ ] Phase 3: commit (doc-only diff — likely no reviewer marker required since
  `docs/workflow-map.html` isn't `src/**`/`functions/src/**`; confirm against
  `reviewGates` patterns before assuming no gate fires), push. Both are clean
  Tier A builds → Done on all-pass.

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
  decouple it from the `providers.length === 0` empty-state guard. Shipped.
- [x] **[Tier A] BIN-441** — Decide + close the deferred BIN-439 sub-scope: a
  savings-cluster-specific design-token guard in `consistency.test.ts`. Shipped.

## Needs you (Tier D)

None this round.

---

# Archived — Sprint 2026-07-09 (a) — BIN-430 traceability follow-ups

Selection-phase only (Phase 1 of sprint-execute). Backlog scan (project "Binge",
states Backlog/Todo/In Progress) returned 10 open tickets. Only 2 clear a "build"
mandate — both are BIN-430 follow-ups filed by the post-sprint completeness sweep.
The other 8 are unchanged from the 2026-07-07 sprint's honest read: still gated,
still not due, or still genuinely Malin's call.

## Agent A — streaming (BIN-430 diff follow-ups)

- [x] **[Tier A] BIN-440** — Recover the test-reviewer's lost medium production-code
  correctness note from the BIN-430 ship. Real bug found and fixed → BIN-442
  filed for the actual fix.
- [x] **[Tier A] BIN-439** — Add hook-level test coverage for the untested
  `bundleSuggestions` `useMemo` in `useSubscriptionAdvisor.ts`. Shipped.

## Needs you (Tier D)

None this round.
