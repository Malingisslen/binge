# Sprint 2026-07-07 — BIN-430 (bundle-arbitrage advisor UI)

Selection-phase only (Phase 1 of sprint-execute). One ticket selected; the rest of
the open backlog is genuinely her call (see "Not selected" below) or ops-blocked.

## Agent A — streaming (advisor UI)

- [ ] **[Tier B] BIN-430** — Surface `detectBundleArbitrage()` (BIN-183/429/433, shipped
  7a37294) in Streamingrådgivaren: a panel "Dina lösa tjänster kan bli billigare i ett
  paket" — best-saving-first `BundleSuggestion` rows, bonus services shown qualitatively,
  `stale` caveat surfaced, optional signup link (affiliate-wrap deferred to BIN-173).
  - Disposition: **build-review** (ticket itself specifies "Autonomy tier: B" — user-visible
    copy/placement is Malin's sign-off, engine logic is already reviewed/shipped).
  - Router: `node docs/org/route.mjs` → tier **medium** (single) · owning role **#28
    Recommendations / Scoring-Integrity Engineer** (same role that signed off BIN-433's
    tier-aware engine this UI consumes).
  - requiresPlanMode: **false** (single + priority Low, not ≤2, no security label).
  - Signoff reason: where the panel sits on the page and how the "replace your à-la-carte
    set" + stale-price copy reads — a visual/product call, not a correctness question.
  - Files (estimated from a code read — `src/lib/advisor/bundleArbitrage.ts` is untouched,
    consumer-only):
    - `src/hooks/useSubscriptionAdvisor.ts` — feed owned `canonMyProviders` +
      `{providerTiers, providerCosts, providerCampaigns}` + `now` into
      `detectBundleArbitrage(...)`, add `bundleSuggestions` to the returned advisor object
      (mirrors how `providers`/`willSeeByProvider` are already computed there).
    - `src/types/advisor.ts` — extend `AdvisorResult` with `bundleSuggestions:
      BundleSuggestion[]`.
    - `src/components/savings/BundleArbitrageCard.tsx` (new) — the panel itself, canonical
      recipe (PageHeader-adjacent card pattern already used by `DiagnosisCard`/
      `ServiceValueCard`), Swedish copy, danger/design tokens only.
    - `src/components/savings/BundleArbitrageCard.test.tsx` (new) — renders rows,
      never-summed bonus copy, stale caveat toggling.
    - `src/app/savings/page.tsx` — mount `<BundleArbitrageCard />` in `SavingsContent`
      (near `DiagnosisCard`/`NumberedActionsList` — exact placement is the sign-off item).
  - Acceptance criteria (rubric for Phase 2.7 verify):
    1. Panel renders one row per `BundleSuggestion` returned by
       `detectBundleArbitrage`, best-saving-first, using `replacedNames` / `currentKr` /
       `bundle.name` / `bundleKr` / `savingKr` — with NO cross-suggestion summing (a user
       can only buy one bundle).
    2. `bonusNames` render as qualitative "+ du får även …" text only — never added into
       `savingKr` or any displayed total (grep: no arithmetic on bonus fields in the
       component).
    3. `stale: true` suggestions show the muted "priser verifierade {verifiedDate} — kan
       vara inaktuella" caveat; `stale: false` suggestions do not (test covers both).
    4. Canonical recipe respected: Swedish UI strings, design tokens (no hex, no raw
       Tailwind red), no `next/image` — matches `.claude/rules/design-system.md`.

## Not selected (mandate / gating — surfaced, not built)

See `needsApproval` in this session's structured plan for the honest reasoning + a
recommendation on each: BIN-422/423 (SEO WPs — sequenced, gated on a Search Console
snapshot I can't pull), BIN-173 (affiliate program signup — business/legal call),
BIN-419 (measurement scheduled 2026-08-28, not due), BIN-424 (explicitly "evaluate
after WP1-3 land" — not yet scoped), BIN-360 (new push-notification channel — UX/consent
call), BIN-185 (spoiler-safe recaps — new AI feature, needs a design pass), BIN-170
(Binge Wrapped — new shareable feature, needs a design pass).

## Needs you (Tier D)

None this round — no ops/credential-blocked candidate reached the build bar.

## Post-sprint steps

- [ ] Phase 2: implement BIN-430 per the files above, TDD (test first per
  `bundleArbitrage.test.ts`'s existing fixture style), `npm run typecheck` + `npm test`
  scoped to `useSubscriptionAdvisor` + the new component.
- [ ] Phase 2.7: fresh-context verifier grades the 4 acceptance criteria above from
  diff + tests only.
- [ ] Phase 3: commit (code-reviewer + test-reviewer markers — no security marker, no
  firebase/rules paths touched), push (push triggers deploy), screenshot the panel,
  park **In Review** (Tier B/build-review — never auto-Done), notify Malin with a
  plain-language "what changed" + the one signoff question (placement + copy).

---

# Archived — Sprint 2026-07-07 (BIN-433, shipped 7a37294)

## BIN-433 — tier-aware bundle arbitrage v2 (approved plan, 2026-07-07)

Standing directive: finish everything solo via /sprint-execute. BIN-429 verification
(live, telia.se 2026-07-07) found ALL Swedish bundles use ad tiers → v1 bar seeds
nothing (BIN-429 Done, documented). BIN-433 = the honest tier-aware v2. Routed
medium → role #28 blind critique = proceed-with-conditions, 10 must-haves (event
logged). #28 is the same role that set the v1 bar — its sign-off sanctions the
bar's replacement.

### Verified seed data (telia.se/tv/streaming + /streaming-mest, 2026-07-07)
Ordinary prices (3-mån-kampanj 199/249/299 ignored per rule 1):
- Telia Streaming Mer 269: Netflix 'standard' · Max 'ads' · Disney+ 'ads'
- Telia Streaming Maxad 319: + Prime (untiered base, "med reklam" = SE-basutbudet)
- Telia Streaming Mest 499: + TV4 'plus' (Telia-radens reklam-disclaimer gäller
  endast livesändningar = TV4:s ad-FREE Plus) + Viaplay 'standard' ("Ingen reklam")
Matching-tier check: Mer 327 vs 269 = 58 (matchar Telias egen "spara 58"-claim ✓);
Mest 734 vs 499 = 235.

### Acceptance criteria (#28 must-haves, binding)
AC1 unknown user cost (null) NEVER coerced to 0 before <= — owned-unknown skipped
from replaced AND downgrade (fixture test w/ otherwise-passing ≥2 bundle).
AC2 <= boundary pinned: user cost == bundle tier price → replaced (exact-equality test).
AC3 orphan tier id (present key, not in catalog) → provider skipped from BOTH
buckets (fail-safe, never fabricated saving) + a seed-validity test asserting every
includedTiers value exists in providers.ts today (loud, like the stale canary).
AC4 omitted key (untiered/base → defaultMonthlyCost) is a DISTINCT path from AC3's
orphan; both tested separately (Prime = the untiered case).
AC5 downgradeProviderIds never counts toward ≥2 gate, currentKr, savingKr —
regression test: 2 replaced + 1 downgrade passes gate on replaced.length alone.
AC6 downgrade ids canonical + deduped (same normalizeIncluded path).
AC7 verifiedDate doc comment covers TIER MIX, not just price+contents.
AC8 the worked example is a passing fixture against the REAL catalog: exact-match
Mest household → currentKr 734, savingKr 235 (ticket's earlier 135 was a mislabeled
household — corrected in ticket per #28's escalation).
AC9 bundle tier price resolves LIVE from providers.ts tiers[] (drift intentional —
do NOT freeze; #28 explicitly warns against "fixing" this).
AC10 Prime-as-69-base assumption documented in seed source comment (ad-free upgrade
entered as custom cost lands honestly in downgrade via > comparison).

### Files
src/lib/advisor/bundleArbitrage.ts (+.test.ts) ONLY. No rules/firebase/UI (BIN-430
stays parked, re-gated on this). Reviewers: code + test (opus); /code-review high;
no security marker needed (no firebase/rules paths).

No architecture-changing unknowns — assumptions verified live in browser today.
