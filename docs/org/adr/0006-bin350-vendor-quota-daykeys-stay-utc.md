# 0006. BIN-350 — vendor-quota day-keys stay UTC (deviation from ticket)

- **Date:** 2026-06-29
- **Status:** Accepted (panel-guided deviation from ticket scope)
- **Trigger:** `/sprint-execute` selected BIN-350 (route remaining UTC `toISOString().slice(0,10)`
  day-keys in scheduled functions through the shared `stockholmDayId` helper). Routed `medium`.
- **Stakeholder:** Financial Controller #3 (owns the 25 SEK/mån Blaze cap + per-day vendor budgets).

## Context
BIN-343 moved askBinge's daily doc-keys to `Europe/Stockholm`. BIN-350 asked to do the same for
the remaining scheduled functions, listing `titleRatings` among the candidates. The ticket framed
this as one uniform "UTC day-key bug class."

## Conflict / Ruling (#3 split the sites by purpose)
Not every day-key is a product-facing reporting window. Two listed sites are **vendor-quota
windows** whose doc-id must mirror the *external API's own daily reset*, which is UTC:

- `streamingOffers/index.ts` `motnDay` — MOTN's 100/day, already documented UTC ("don't harmonize").
- `titleRatings/index.ts` `today()` — keys `omdbBudget/{day}` capping us under OMDb's free 1000/day.
  OMDb resets that quota on its own UTC clock.

Migrating these to Stockholm would misalign our counter against the vendor's reset, and across the
one-time UTC→Stockholm cutover the 22:00–24:00 UTC window would be counted under two different
day-ids — letting up to ~2 hours of calls be served twice inside one 24h period and **overshoot a
paid/throttled cap**. A third class — **data-dates** (`isoFromUnix`, `parse.ts` `isoDate`) — format
an offer's own leaving/release timestamp; localizing them would silently shift displayed dates.

**Decision: migrate only the product-facing reporting/notification buckets; keep vendor-quota and
data-date sites on UTC with an explicit clarifying comment at each.**

- Migrated → `stockholmDayId`: `insights/rollup.ts` `dateId` (+ retention cutoff follows it),
  `weeklyDigest` `runDate`, `leavingRollup` `today` label, `rotationReminder` `today`.
- Kept UTC (commented): `streamingOffers` `motnDay`, `titleRatings` `today()`,
  `leavingRollup/logic.ts` `isoFromUnix`, `streamingOffers/parse.ts` `isoDate`,
  `rotationReminder/logic.ts` `isoPlusDays` (pure calendar math on a passed ISO string).
- **Deciding tier:** cost-cap integrity (no double-spend of a vendor quota) over literal
  ticket scope.

## Consequences (folded into acceptance criteria)
- Canonical `stockholmDayId` moved to `functions/src/util/dayId.ts`; `askbinge/logic.ts` re-exports
  it (import path + its test unchanged). New `dayId.test.ts` pins DST + late-night rollover.
- `insights` history write and retention sweep share one timezone basis (`expiredInsightDocIds`
  derives its cutoff from the same `dateId`), so no history doc is dropped or leaked by a 1-day skew.
- One-time cutover blip is harmless: each rollup is a full current-state snapshot (idempotent), not
  an additive per-day counter — no reporting day is double-counted or dropped.
- Deferred follow-up (filed): the cosmetic /insikter one-time cutover annotation (frontend, Tier B).

## Decided by
Financial Controller #3 (owns vendor-budget windows + the Blaze cap). Deviation from the ticket's
"migrate all" framing is deliberate and documented here.
