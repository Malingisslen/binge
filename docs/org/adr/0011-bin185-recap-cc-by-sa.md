# ADR 0011 — BIN-185 recaps use CC BY-SA sources under the conservative (share-alike) posture

**Date:** 2026-07-12
**Status:** Accepted (Malin's decision, Legal-panel-recommended default)
**Context:** BIN-185 spoiler-safe catch-up recaps. Operator runbook: `docs/recaps/RUNBOOK.md`.

## Context

BIN-185 recaps are generated from **Wikipedia and other CC BY-SA-compatible wikis** (the original
TMDB-sourced design was blocked — TMDB's API Terms §1.C prohibit feeding TMDB data to an LLM; see
[[reference_tmdb_ai_ml_ban]] / the spec's pivot). A recap built by reading and re-expressing a wiki's
episode summaries is plausibly a **derivative work ("adaptation")** under CC BY-SA, which carries two
binding obligations: **Attribution (BY)** and **ShareAlike (SA)**. The Legal panel (2026-07-12) presented
two postures:
- **Conservative:** treat recaps as CC BY-SA-encumbered — attribute per recap, accept that the recap text
  is itself CC BY-SA (others may reuse it with attribution + share-alike).
- **Aggressive:** instruct the model to work at the fact/idea level only, argue independent authorship, take
  only a courtesy credit — lower legal certainty.

## Decision

**Conservative posture.** Malin chose it (the panel's recommended default).

1. Every recap sourced from a CC BY-SA wiki carries a per-recap credit next to the text: source name(s) +
   link, the licence name linking `creativecommons.org/licenses/by-sa/4.0/`, and a "bearbetad"
   (changes-made) indication (`RecapSourceCredit`).
2. **binge's recap text is itself licensed CC BY-SA 4.0.** Third parties may copy/redistribute/republish it
   with attribution + share-alike. (This is a copyright-licence obligation on the *text* only; binge's site
   Terms still restrict scraping the site — a separate legal regime.)
3. The output licence is the latest-compatible CC BY-SA version across the sources used (3.0 → 4.0 is
   one-way compatible; combined output is licensed CC BY-SA 4.0).
4. Every source ingested MUST be CC BY-SA-compatible — verified at generation time; an all-rights-reserved
   source is never used (a show with no compatible source is logged to `docs/recaps/unsourced-shows.json`,
   not recapped). IMDb stays PARKED (needs a commercial AI-synthesis licence).
5. Generation prompt instructs: paraphrase, never copy verbatim phrasing or track a source's structure.

## Consequences

- The recaps for popular shows (which the batch covers) produce text binge does not hold exclusive rights
  over — an accepted, deliberate tradeoff, not a leak of data or the feature itself.
- Attribution is a per-recap UI obligation, not a footer — enforced by `RecapSourceCredit` rendering from
  the doc's `sources[]`.
- No TMDB attribution is required on the recap (no TMDB content in it); TMDB's 6-month caching ceiling
  (§1.C) does not apply (recaps are Wikipedia-derived, not TMDB Data) — recaps are durable-forever.
