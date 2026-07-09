# Sprint 2026-07-09 — BIN-430 traceability follow-ups

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

- [ ] **[Tier A] BIN-440** — Recover the test-reviewer's lost medium production-code
  correctness note from the BIN-430 ship. The test-reviewer's marker header claimed
  two notes (one test-gap, one production-code concern) but only the test-gap
  (→ BIN-439) was ever written down — the production-code concern was never
  recorded, graded, or ticketed. Process/traceability gap, not a confirmed bug; a
  first pass already cleared the obvious candidate (raw `myProviders` vs
  `canonMyProviders` — not a bug, `detectBundleArbitrage` canonicalizes internally).
  - Disposition: **build** (correctness investigation with a clear mandate — verify
    shipped code is right; not a product/UI decision). Auto-closeable either way
    (real bug fixed, or false-alarm recorded) since the ticket itself frames both
    outcomes as valid completions.
  - Router: `node docs/org/route.mjs --md` → tier **medium** (single) · owning role
    **#28 Recommendations / Scoring-Integrity Engineer** (same role attached to
    BIN-430/433).
  - requiresPlanMode: **false** (single + priority Medium(3), not ≤2, no security
    label).
  - Files (re-review surface, no new files expected unless a real bug is found):
    - `src/hooks/useSubscriptionAdvisor.ts` — the `bundleSuggestions` memo + return
      spread
    - `src/types/advisor.ts` — `AdvisorResult.bundleSuggestions` + BundleSuggestion
      re-export
    - `src/components/savings/BundleArbitrageCard.tsx` — the panel
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. binge-test-reviewer is re-run on this exact diff surface (the 3 files above)
       and the specific "medium production-code correctness concern" is re-derived
       and written down verbatim — not just re-asserted as "cleared".
    2. If real: fixed in the same 3 files with a regression test added. If false
       alarm: recorded in the Linear closing comment with the reviewer's exact
       reasoning, and NO unrelated code is changed.
    3. `npm run typecheck` and the scoped test suite (useSubscriptionAdvisor* +
       BundleArbitrageCard.test.tsx) stay green.
    4. `src/lib/advisor/bundleArbitrage.ts` and `SWEDISH_BUNDLES` seed data are NOT
       touched — that's BIN-183/433 territory, already shipped and reviewed;
       out of scope here.

- [ ] **[Tier A] BIN-439** — Add hook-level test coverage for the untested
  `bundleSuggestions` `useMemo` in `useSubscriptionAdvisor.ts` (wiring + gate),
  filed by the same completeness sweep + the test-reviewer's own note. The engine
  (`bundleArbitrage.ts`) is heavily tested already (BIN-183/433); only the hook's
  wiring around it has zero coverage.
  - Disposition: **build** (test-gap, obvious-benefit, no product decision).
  - Router: same files → tier **medium** (single) · owning role **#28**.
  - requiresPlanMode: **false** (single + priority Low(4)).
  - Files:
    - `src/hooks/useSubscriptionAdvisor.test.ts` or
      `useSubscriptionAdvisor.helpers.ts`/`.test.ts` (extend, matching the existing
      pure-logic-extraction pattern so it runs without Firebase imports)
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. A test asserts `bundleSuggestions` returns `[]` when the advisor's
       `enabled` flag is false.
    2. A test asserts `bundleSuggestions` reflects `detectBundleArbitrage` output
       built from the owned-provider/cost/campaign settings when `enabled` is true
       (correct args passed through — providers, tiers, costs, campaigns, `now`).
    3. New test(s) follow the `useSubscriptionAdvisor.helpers.ts` pure-logic
       pattern — no Firebase imports, runs in the root Vitest suite.
    4. Existing suites (`useSubscriptionAdvisor.test.ts`,
       `useSubscriptionAdvisor.helpers.test.ts`, `BundleArbitrageCard.test.tsx`)
       still pass; `bundleArbitrage.ts` itself is not touched (already covered,
       out of scope).

## Not selected (mandate / gating — surfaced, not built)

Unchanged from the 2026-07-07 read — re-checked against today's backlog, nothing
has moved:

- **BIN-422/BIN-423** (SEO internal-linking WP2/WP3+WP4) — sequenced, explicitly
  gated on a Search Console snapshot after the prior work-package (WP1/WP2) that
  I can't pull. Recommendation: hold until Malin (or a future session with GSC
  access) confirms the snapshot; don't build ahead of the gate.
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

## Post-sprint steps

- [ ] Phase 2: implement BIN-440 then BIN-439 in that order (investigate/fix
  before adding coverage), TDD where a fix lands, `npm run typecheck` + `npm test`
  scoped to `useSubscriptionAdvisor*` + `BundleArbitrageCard`.
- [ ] Phase 2.7: fresh-context verifier grades the acceptance criteria above from
  diff + tests only, per ticket.
- [ ] Phase 3: commit (code-reviewer + test-reviewer markers — no security marker,
  no firebase/rules paths touched), push (push triggers deploy). BIN-439 is a
  clean Tier A test-add → Done on all-pass. BIN-440 → Done if false-alarm-recorded
  or fixed-with-passing-criteria; back to Todo only if a real unresolved concern
  can't be closed in-session.

---

# Archived — Sprint 2026-07-07 (BIN-430 bundle-arbitrage advisor UI)

Selection-phase only (Phase 1 of sprint-execute). One ticket selected; the rest of
the open backlog is genuinely her call (see "Not selected" below) or ops-blocked.

## Agent A — streaming (advisor UI)

- [x] **[Tier B] BIN-430** — Surface `detectBundleArbitrage()` (BIN-183/429/433,
  shipped 7a37294) in Streamingrådgivaren: a panel "Dina lösa tjänster kan bli
  billigare i ett paket" — best-saving-first `BundleSuggestion` rows, bonus
  services shown qualitatively, `stale` caveat surfaced, optional signup link
  (affiliate-wrap deferred to BIN-173). Shipped 6ac3ece.
  - Disposition: **build-review** (ticket itself specifies "Autonomy tier: B" —
    user-visible copy/placement is Malin's sign-off, engine logic is already
    reviewed/shipped).
  - Router: `node docs/org/route.mjs` → tier **medium** (single) · owning role
    **#28 Recommendations / Scoring-Integrity Engineer** (same role that signed
    off BIN-433's tier-aware engine this UI consumes).
  - requiresPlanMode: **false** (single + priority Low, not ≤2, no security
    label).
  - Signoff reason: where the panel sits on the page and how the "replace your
    à-la-carte set" + stale-price copy reads — a visual/product call, not a
    correctness question.
  - Files: `src/hooks/useSubscriptionAdvisor.ts`, `src/types/advisor.ts`,
    `src/components/savings/BundleArbitrageCard.tsx` (new),
    `src/components/savings/BundleArbitrageCard.test.tsx` (new),
    `src/app/savings/page.tsx`.
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. Panel renders one row per `BundleSuggestion` returned by
       `detectBundleArbitrage`, best-saving-first, using `replacedNames` /
       `currentKr` / `bundle.name` / `bundleKr` / `savingKr` — with NO
       cross-suggestion summing (a user can only buy one bundle).
    2. `bonusNames` render as qualitative "+ du får även …" text only — never
       added into `savingKr` or any displayed total (grep: no arithmetic on
       bonus fields in the component).
    3. `stale: true` suggestions show the muted "priser verifierade
       {verifiedDate} — kan vara inaktuella" caveat; `stale: false` suggestions
       do not (test covers both).
    4. Canonical recipe respected: Swedish UI strings, design tokens (no hex, no
       raw Tailwind red), no `next/image` — matches `.claude/rules/design-system.md`.

Post-sprint completeness sweep filed two follow-ups now in the 2026-07-09 sprint
above: BIN-440 (lost test-reviewer note) and BIN-439 (hook-level test gap).

## Not selected (mandate / gating — surfaced, not built)

See `needsApproval` in that session's structured plan for the honest reasoning +
a recommendation on each: BIN-422/423 (SEO WPs — sequenced, gated on a Search
Console snapshot I can't pull), BIN-173 (affiliate program signup —
business/legal call), BIN-419 (measurement scheduled 2026-08-28, not due), BIN-424
(explicitly "evaluate after WP1-3 land" — not yet scoped), BIN-360 (new
push-notification channel — UX/consent call), BIN-185 (spoiler-safe recaps — new
AI feature, needs a design pass), BIN-170 (Binge Wrapped — new shareable feature,
needs a design pass).

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.
