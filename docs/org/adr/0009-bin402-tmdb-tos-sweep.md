# ADR 0009 — BIN-402 TMDB ToS-svep: clear-by-default, lazy-refresh-on-view

**Date:** 2026-07-03
**Status:** Accepted (plan-level) · **implementation REVERTED off `main` 2026-07-10** and preserved on branch `bin-402-parked` — do not treat the `tmdbFieldsRefreshedAt` rules-allowlist entry or the `tmdbFieldsSweep` function described below as live/shipped. Blocked on BIN-453 (client-side freshness-stamp writer) before it may be re-attempted, and requires a founder-approved plan per the Tier-A-only autonomous-sprint rule.
**Route tier:** `top` — full panel convened blind, pre-plan.
**Panel:** Legal / GDPR Counsel (#5), Data Protection Officer (#6), Database Administrator / Data-layer Engineer (#27).

## Context

TMDB API terms §1.C forbid caching API-derived data > 6 months. Binge denormalizes TMDB fields
onto every `users/{uid}/watchlist/{tmdbId}` doc with no TTL. A scheduled server-side sweep is needed
(client read-repair never touches dormant accounts). This is the first Cloud Function to write to
*every* user's watchlist collection on a schedule — whole-DB blast radius.

## Decision

All three panelists returned **no blocking objection**, conditional on must-haves (folded into the
plan's binding acceptance criteria: `docs/superpowers/plans/2026-07-03-bin-402-tmdb-tos-sweep.md`).

**The one design tension — and its resolution:**
- **Legal (#5)** required that "refresh OR clear" both genuinely satisfy §1.C, with refresh meaning a
  real TMDB fetch (no timestamp-laundering).
- **DBA (#27)** required that the batch job **default to clear, not re-fetch**, because proactive
  per-title re-fetch is an unbounded fan-out with no ceiling tied to the 25 SEK/month Blaze cap.

**Resolution (no conflict):** v1 batch job **clears** stale fields (bounded, Firestore-only, compliant
with §1.C — clearing removes the stale cache). Freshness is restored **lazily at read time** on the next
title-page view, which already calls TMDB. This is both the compliant default (Legal) and the
cost-bounded one (DBA). No ADR-level disagreement remained.

## Consequences

- New `tmdbFieldsRefreshedAt` doc stamp (missing = stale); added to `firestore.rules` `hasOnly()` whitelist.
- Trigger threshold set to **5 months** (Legal: §1.C is a ceiling; leaves slack against monthly cadence +
  budget throttling).
- Hard field-allowlist enforced in code + unit test (DPO): the sweep must never touch user-authored fields.
- Audit-trail completion record required as the evidence the control actually runs (Legal).
- Dry-run-first for the initial scheduled run (DBA): log counts, write nothing, until Malin sees the numbers.
- Cost (read/write volume vs the cap) must be computed **before** build — hard prerequisite.
- Tier-D: manual `firebase deploy --only functions` (+ rules if the whitelist changes); deploy.yml won't.

## Non-halt note

Parked In Review per the autonomous-loop non-halt rule — a `top`-tier / high-stakes-core (DPO) change is
never auto-built. Malin's written go-ahead gates implementation (CLAUDE.md risky-migration exception).
