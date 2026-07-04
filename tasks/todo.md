# Sprint plan — 2026-07-04 (autonomous /sprint-execute)

Goal directive: "finish everything you can by yourself using /sprint-execute".
Autonomous run (Malin away) → ship only Tier-A logic/test to main; file the rest.

## Selected batch (2 Tier-A ships)

Backlog is mostly blocked (SEO chain gated on GSC snapshots that need Malin's
access) or Tier-B/C/D (visual/social/functions). Two genuine Tier-A cores:

### 1. BIN-183 — Bundle-arbitrage engine (Tier A · route=medium · panel=[28])
New pure module `src/lib/advisor/bundleArbitrage.ts` + `.test.ts`, beside
listOptimizer/spendSnapshot. Ships the tested ENGINE dormant; `SWEDISH_BUNDLES`
seed ships EMPTY (AFFILIATE_PROGRAMS precedent) because web bundle prices are
campaign-laden + ad-tier-substituted (not honestly seedable — same class as
BIN-406). Curation → BIN-429 (browser, Tier D). Advisor UI → BIN-430 (Tier B).

Role #28 blind critique = proceed-with-conditions, 10 must-haves (all folded as
acceptance criteria below). Review event logged (canonical schema).

**Acceptance criteria (graded by verifier):**
- AC1 suggestion returned ONLY when bundle replaces ≥2 PAID owned services (effective cost>0) AND savingKr>0; single-service / break-even never surface.
- AC2 savingKr === currentKr − bundle.monthlyKr over the replaced set ONLY; bonus never folded in.
- AC3 alias ids in owned set OR bundle.includedProviderIds never double-count (canonical dedup at construction).
- AC4 uncatalogued/phantom ids dropped — never replaced, never a bonus label.
- AC5 `now` required (non-defaulted); campaign-lapsed price reverts to ordinary via resolveEffectiveMonthlyCost.
- AC6 each suggestion carries `stale` from isBundleStale(verifiedDate, now, 180); malformed date → stale (fail-safe); tested.
- AC7 suggestions sorted by savingKr desc; documented mutually-exclusive (never summed).
- AC8 seed honesty: a test asserts no seeded bundle is already stale; empty seed references BIN-429 in a comment.
- AC9 a Pluto-shaped (isAds, cost 0) service in a bundle is never counted into replaced/currentKr.

### 2. BIN-423 WP4 (partial) — remove dead FAQPage JSON-LD (Tier A · route=skip)
Remove `FAQ_JSON_LD` + `faqLd` from `HomePageClient.tsx`. Google retired FAQ rich
results June 2026 (world-watch flag) → dead structured data. NOT a linking change,
so decoupled from the GSC-gated WP2/WP3 chain. Verify: `FAQPage` absent from
`out/index.html`. (WP3 person-filmography + breadcrumb JSON-LD stay parked in
BIN-423 — genuinely GSC-gated.)

**Acceptance criteria:** FAQPage JSON-LD absent from built homepage; no dangling
faqLd refs; homepage still renders all three auth branches; suite green.

## Open questions
No architecture-changing unknowns. Assumptions: (a) bundle data is not honestly
seedable now → empty seed + engine, matching the AFFILIATE_PROGRAMS pattern already
in providers.ts; (b) FAQPage removal is safe to split from BIN-423's GSC gate since
it touches no internal links. Both confirmed against the code + the role #28 panel.

## Post-sprint
Gates (lint/typecheck/test/build) green → commit-gate reviewers → /commit → push
(deploys hosting). BIN-183 → Done (logic core). BIN-423 → In Review (WP4-FAQ done,
note WP3 still gated). BIN-429/BIN-430 filed follow-ups.
