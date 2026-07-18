# ADR 0016 — BIN-543 leavingRollup: resumable pagination cursor rejected in favor of a slower single-day cadence

**Date:** 2026-07-18 · **Status:** Accepted (Malin) · **Via:** targeted single-role critique (Data/Integrations Engineer #13), same domain as BIN-541

## Context
BIN-543 proposed giving `leavingRollup` ("vad försvinner") a persisted MOTN `/changes` pagination
cursor so a run could RESUME across days instead of restarting from page 0 every time,
accumulating pages into a staging doc and only flipping the public `streamingLeaving/current`
doc once a full multi-day pass completed. This was meant to avoid the job exhausting its
150/cycle MOTN budget (BIN-541) in ~1 week if real "expiring soon" demand ever consistently
needs more than ~5 pages/run. Malin decided to build something here now, despite no evidence
yet that binge (pre-launch, zero users) actually needs it.

## Conflict
The Data/Integrations Engineer role (#13, same role that reviewed BIN-541) **blocked** the
cursor/staging design as specced:

1. **Window drift is fatal, not a tuning detail.** `/changes?from=X&to=X+31d` is a MOVING
   window. A resumed multi-day pass accumulates pages fetched against DIFFERENT `from/to`
   values each day — some early-fetched titles will have already expired by publish time,
   others that entered the 31-day horizon on a later day are silently absent from earlier
   pages. Stitching these into one "complete" snapshot doesn't produce completeness — it
   produces a plausible-looking but WRONG collage. This is worse than the status quo
   ("goes stale sometimes, safely") — it would be "goes wrong sometimes, silently."
2. **MOTN cursor validity across days is unverified.** A cursor minted against day N's
   `from/to` query params resuming under day N+1's freshly-computed `from/to` may simply be
   rejected or reset by the vendor — no evidence the API supports this.
3. **Reworking the `complete: boolean` completeness guard risks reintroducing exactly the
   bug class BIN-541 spent 3-4 xhigh review rounds closing** (a single source of truth for
   "is this run's result safe to publish") — multi-day accumulation needs a second,
   differently-scoped staleness concept layered on top, in code that was just hardened
   under real review pressure.

## Decision — build the simpler alternative instead
Widen `leavingRollup`'s PER-RUN page budget and run the job LESS OFTEN (e.g. every 3-4 days
instead of daily), keeping the existing single-day full-or-nothing pass and the unchanged
`complete` semantics. Zero new persisted state, zero window-drift risk, no touching the
already-hardened completeness guard. Before committing even to that: check whether
streamingOffers' 300-of-450 slice of the combined MOTN budget has headroom to reallocate
toward leavingRollup's 150, rather than assuming the split from BIN-541 is fixed.

This still satisfies Malin's actual intent (a "vad försvinner" job that doesn't go dark for
weeks under real demand) without the correctness risk of the originally-proposed design.

## Decided by
Malin, on the Data/Integrations Engineer's recommendation — no escalation needed since the
role's technical objection was to the SPECIFIC design, not to building something; the
simpler alternative was accepted without dispute.
