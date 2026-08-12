# Architecture Decision Records (ADRs)

Append-only, dated records of decisions made by the **stakeholder-review** pipeline
(see [`../world-watch/DESIGN.md`](../world-watch/DESIGN.md) §1.2 + §2.6). Every
disagreement the panel surfaces — whether the Chief-Architect agent resolved it by the
priority rubric or it escalated to Malin — becomes one file here.

The review **advises**; an ADR records *what was decided and why*, not an action taken.

## Convention
- One file per decision: `NNNN-kebab-title.md` (zero-padded, monotonic).
- **Append-only.** Don't rewrite a past ADR; if a decision is reversed, write a new ADR
  that supersedes it and update the old one's `Status` to `Superseded by NNNN`.
- Use the template below. Keep it short — the value is the *record*, not prose.

## Template

```markdown
# NNNN. <Decision title>

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Escalated-to-human | Superseded by NNNN
- **Trigger:** <plan or changed fileset that prompted the review>
- **Stakeholders (panel):** <roles consulted, with their verdicts>

## Context
<The decision at hand and the genuine tension between stakeholders.>

## Conflict
<The specific disagreement: role A wants X (stake), role B wants Y (stake).>

## Decision
<What was decided. If resolved by the rubric, name the **deciding tier**
(e.g. "tier 2 Legal beats tier 5 Cost"). If escalated, state the yes/no question
put to Malin and her answer.>

## Consequences
<What follows — must-haves, conditions, follow-up tickets. The review advises only.>

## Decided by
<Chief-Architect agent (rubric tier N) | Human owner (Malin) | Synthesizer (no conflict)>
```

## Index
- [0001](0001-deploy-retention-cleanup.md) — Deploy dormant retentionCleanup + reclaimOrphanFollows (validation run)
- [0002](0002-bin275-google-sso-terms-consent.md) — BIN-275: recording terms acceptance for Google-SSO users
- [0003](0003-bin318-avbruten-taste-weight.md) — BIN-318: taste weight for rated-but-abandoned titles
- [0004](0004-bin322-cheapestpath-tier-pricing.md) — BIN-322: cheapestPath must price by tier, and display honestly
- [0005](0005-bin337-person-pipeline-placement.md) — BIN-337: shared person-ID pipeline placement
- [0006](0006-bin350-vendor-quota-daykeys-stay-utc.md) — BIN-350: vendor-quota day-keys stay UTC (deviation from ticket)
- [0007](0007-bin329-joinattempts-erasure-approach.md) — BIN-329: joinAttempts erasure mechanism infeasible, plan parked
- [0008](0008-bin276-327-groups-rules-cap-scope.md) — Groups rules hardening: scope the memberUids size-cap to growth branches
- [0009](0009-bin402-tmdb-tos-sweep.md) — BIN-402: TMDB ToS sweep — clear-by-default, lazy-refresh-on-view
- [0010](0010-household-read-gap.md) — Household facet: read-gap disclosure + share-to-see reciprocity (BIN-184)
- [0011](0011-bin185-recap-cc-by-sa.md) — BIN-185: recaps use CC BY-SA sources under the conservative posture
- [0012](0012-provider-wordmark-vs-logo.md) — Provider pills use wordmarks, not real brand logos
- [0013](0013-tillsammans-social-design.md) — Tillsammans / social layer: founding design decisions
- [0014](0014-seo-lighthouse-tradeoffs.md) — SEO/AI-search: accept Lighthouse 93–96, and what NOT to build for AI
- [0015](0015-tillsammans-write-binding-scope.md) — Tillsammans write binding: anon-forgery residual accepted (A1); expiry gate re-declined (BIN-24 re-affirmed)
- [0016](0016-leavingrollup-resumable-cursor-rejected.md) — BIN-543: resumable MOTN pagination cursor rejected (window drift = silently wrong, not just stale) in favor of a slower single-day cadence
- [0017](0017-media-type-doc-id-namespacing.md) — BIN-560: personal-library doc ids namespaced `${mediaType}_${tmdbId}`; reset-not-backfill (Fork A) + store-mediaType-as-field (Fork B); export schema → MAJOR 2.0
- [0018](0018-seo-selection-ratchet.md) — BIN-823: the SEO selection becomes a persisted ratchet instead of being re-derived per build
- [0019](0019-aborted-deletion-marker-scope.md) — BIN-816: aborted-deletion marker stays device-local (cross-device gap accepted); the surviving auth account is a documented DELAY, not a breach, and BIN-816 grows to include the server-side reaper that holds that window (Malin)
