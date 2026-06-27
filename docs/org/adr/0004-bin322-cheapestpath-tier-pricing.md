# 0004. BIN-322 — cheapestPath must price by tier, and display honestly

- **Date:** 2026-06-27
- **Status:** Parked (scope ruling) — Tier-B, awaiting Malin's copy sign-off
- **Trigger:** `/sprint-execute` selected BIN-322 (the `subscribe` rung of `cheapestPath`
  ranks by `defaultMonthlyCost`, ignoring cheaper ad-supported tiers). Routed `medium`.
- **Stakeholder:** Monetization / Partnerships Lead #24 (owns the savings wedge +
  `cheapestPath.ts`).

## Context
`cheapestPath`'s final `subscribe` rung (`src/lib/streaming/cheapestPath.ts:97-105`) picks
the provider with the lowest `getProvider(id)?.defaultMonthlyCost`. Several providers carry
cheaper ad-tiers (Disney+ 109→69, Max 149→89, Viaplay 169→79, TV4 169→69), so the
optimizer can name the wrong "cheapest" provider and imply a higher price than needed —
on the savings-wedge line users act on.

The naive fix (rank by cheapest tier, pure logic, unit-tested) looked Tier-A. But the
consumer `CheapestPathVerdict.tsx:55` **recomputes the displayed price itself** as
`getProvider(v.providerId)?.defaultMonthlyCost`, ignoring the verdict's `priceAmount`.

## Conflict / Ruling (#24 — HARD OBJECTION to ranking-only)
Shipping ranking-only would name a provider that won on its 89 kr ads tier while the hero
line keeps printing `(149 kr/mån)` — "a defensible-moat asset telling a quantified lie."
The ranking change *creates* the inconsistency, so the two halves are inseparable.

**Ruling: ranking + honest display ship TOGETHER as one Tier-B change, parked for sign-off.**
- **Deciding tier:** revenue-trust (this is the money line) over velocity. Not auto-shippable.

## Required implementation (folded into the ticket as binding spec)
1. `cheapestTierCost(p)` comparator = cheapest **general-entertainment** tier, NOT raw
   `Math.min` over `tiers`. Viaplay (79→399→699) and TV4 (69→…→699) have sport/bundle
   tiers; a future data edit could make a sport-only tier the min and surface a tier that
   can't play the title. Needs a `ProviderTier.kind`/exclude flag in `providers.ts`.
   Fallback for no-tier providers (Prime): `defaultMonthlyCost`. Tie-break: lowest id.
2. Verdict carries `priceAmount` (resolved for subscribe) + `tierId`/`tierLabel`. UI renders
   from the verdict; **delete the `CheapestPathVerdict.tsx:55` default-cost recompute** (the
   root defect — leaving it re-introduces the bug).
3. Hero copy (Swedish): sub-default tier → `Billigaste väg: Disney+ från 69 kr/mån (med reklam)`
   ("från" signals entry price; tier label mandatory — the caveat is the honesty); no-tier
   provider → `Billigaste väg: Prime 69 kr/mån`; unknown cost → keep `Finns på ${name}`.
4. Keep neutral (non-saffron) styling — a cheaper ads price is still a spend.
5. **Forward note (not this ticket):** when affiliate deeplinks land (BIN-173), the sort must
   stay price-truth, never margin-weighted.

## Decision
Park In Review; do not build-and-ship autonomously (UI money copy + a provider-data
classification decision both need Malin). Spec above is complete enough for a sign-off build.

## Decided by
Monetization / Partnerships Lead #24. Human owner (Malin) signs off the Swedish copy +
the sport-tier classification before it ships.
