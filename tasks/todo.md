# BIN-433 — tier-aware bundle arbitrage v2 (approved plan, 2026-07-07)

Standing directive: finish everything solo via /sprint-execute. BIN-429 verification
(live, telia.se 2026-07-07) found ALL Swedish bundles use ad tiers → v1 bar seeds
nothing (BIN-429 Done, documented). BIN-433 = the honest tier-aware v2. Routed
medium → role #28 blind critique = proceed-with-conditions, 10 must-haves (event
logged). #28 is the same role that set the v1 bar — its sign-off sanctions the
bar's replacement.

## Verified seed data (telia.se/tv/streaming + /streaming-mest, 2026-07-07)
Ordinary prices (3-mån-kampanj 199/249/299 ignored per rule 1):
- Telia Streaming Mer 269: Netflix 'standard' · Max 'ads' · Disney+ 'ads'
- Telia Streaming Maxad 319: + Prime (untiered base, "med reklam" = SE-basutbudet)
- Telia Streaming Mest 499: + TV4 'plus' (Telia-radens reklam-disclaimer gäller
  endast livesändningar = TV4:s ad-FREE Plus) + Viaplay 'standard' ("Ingen reklam")
Matching-tier check: Mer 327 vs 269 = 58 (matchar Telias egen "spara 58"-claim ✓);
Mest 734 vs 499 = 235.

## Acceptance criteria (#28 must-haves, binding)
- AC1 unknown user cost (null) NEVER coerced to 0 before <= — owned-unknown skipped
  from replaced AND downgrade (fixture test w/ otherwise-passing ≥2 bundle).
- AC2 <= boundary pinned: user cost == bundle tier price → replaced (exact-equality test).
- AC3 orphan tier id (present key, not in catalog) → provider skipped from BOTH
  buckets (fail-safe, never fabricated saving) + a seed-validity test asserting every
  includedTiers value exists in providers.ts today (loud, like the stale canary).
- AC4 omitted key (untiered/base → defaultMonthlyCost) is a DISTINCT path from AC3's
  orphan; both tested separately (Prime = the untiered case).
- AC5 downgradeProviderIds never counts toward ≥2 gate, currentKr, savingKr —
  regression test: 2 replaced + 1 downgrade passes gate on replaced.length alone.
- AC6 downgrade ids canonical + deduped (same normalizeIncluded path).
- AC7 verifiedDate doc comment covers TIER MIX, not just price+contents.
- AC8 the worked example is a passing fixture against the REAL catalog: exact-match
  Mest household → currentKr 734, savingKr 235 (ticket's earlier 135 was a mislabeled
  household — corrected in ticket per #28's escalation).
- AC9 bundle tier price resolves LIVE from providers.ts tiers[] (drift intentional —
  do NOT freeze; #28 explicitly warns against "fixing" this).
- AC10 Prime-as-69-base assumption documented in seed source comment (ad-free upgrade
  entered as custom cost lands honestly in downgrade via > comparison).

## Files
src/lib/advisor/bundleArbitrage.ts (+.test.ts) ONLY. No rules/firebase/UI (BIN-430
stays parked, re-gated on this). Reviewers: code + test (opus); /code-review high;
no security marker needed (no firebase/rules paths).

No architecture-changing unknowns — assumptions verified live in browser today.
