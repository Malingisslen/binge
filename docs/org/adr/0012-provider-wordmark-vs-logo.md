# ADR 0012 — Provider pills use wordmarks, not real brand logos

**Date:** 2026-06-02 · **Status:** Accepted (design decision, live) · **Via:** "Mina streamingtjänster" redesign

## Context
The `/settings` "Mina streamingtjänster" section (`src/components/settings/ProvidersSection.tsx`)
renders each streaming service as a pill. The design question: use the service's
real brand logo, or a **wordmark** (the service *name* set in its brand colour)?

## Conflict
- **Recognition (Design/UX)** wants the strongest visual identity — real logos read fastest.
- **Legal / Brand** wants the smallest trademark-and-attribution footprint and no
  per-vendor logo-guideline maintenance.

## Decision
Use **wordmark pills** (brand name in brand colour), not real logos. Rationale:

- **Nominative / referential use** protects the *name* solidly (US *New Kids on the
  Block*; EU Art. 14(1)(c) Dir. 2015/2436 + Swedish Varumärkeslag 2010:1877). The
  "only as much as necessary" test is met by the name; a logo is aesthetic and thus a
  **weaker** defence (cf. CJEU *Audi v GQ*, 2024).
- Real logos sourced from TMDB would trigger **JustWatch attribution on every surface**,
  require compliance with each service's logo guideline (no recolouring), and add
  rebrand maintenance (e.g. Max ↔ HBO Max, 2025).
- Wordmarks also fit "Schemat" (no decorative images).

Real logos + JustWatch attribution remain a possible *separate, deliberate* decision later.

## Consequences
- Brand colour is applied via inline style from `SWEDISH_PROVIDERS` data (no raw hex in
  classes); implementation must contrast-check per provider and fall back to `ink` text
  where white-on-brand fails WCAG AA, so the a11y guard holds.
- No new datamodel or Firestore schema change.

## Decided by
Malin (design approval, 2026-06-02). Recorded here on the 2026-07-13 docs-sweep when the
originating design spec was retired; the spec's implementation detail is now the shipped code.
