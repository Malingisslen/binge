# 0005. BIN-337 — shared person-ID pipeline placement

- **Date:** 2026-06-28
- **Status:** Accepted (panel override of ticket instruction)
- **Trigger:** `/sprint-execute` selected BIN-337 (test sitemap URL-shape + DRY the
  duplicated person-ID pipeline between `sitemap.ts` and `person/[id]/page.tsx`). Routed
  `medium`.
- **Stakeholder:** Growth Marketer #15 (owns SEO pre-render ↔ sitemap parity).

## Context
`personEntries()` in `sitemap.ts` re-implemented, verbatim, the person-ID collection in
`person/[id]/page.tsx`'s `generateStaticParams`. If they drift, the sitemap lists person
URLs that aren't pre-rendered → "Crawled – not indexed" soft-404s. The ticket's suggested
fix: **extract the shared pipeline into `seoCoverage.ts`** (next to `cappedTitleIds`).

## Conflict / Ruling (#15 overrode the ticket's placement)
`seoCoverage.ts` is deliberately a **pure constants module** (no TMDB-client import), and
its fast, network-free `seoCoverage.test.ts` is *the* trustworthy guard for the coverage
math (`cappedTitleIds` merge/dedup/slice). Putting a *fetcher* there would make that pure
test transitively import the network layer — every contributor would need to mock the
client to test a constant. The precedent is already correct: `cappedTitleIds` does the
**pure** merge/dedup/slice; the **callers** fetch.

**Decision: keep `seoCoverage.ts` pure; put `collectPersonIds` in a new module
`src/lib/tmdb/seoPersonIds.ts`** that imports the client. Both `sitemap.ts` and
`person/[id]/page.tsx` call it.
- **Deciding tier:** test-suite integrity / SEO-coverage correctness (the parity guard the
  role owns) over literal adherence to the ticket text.

## Consequences (folded into acceptance criteria)
- New `seoPersonIds.ts`; `seoCoverage.ts` unchanged (still pure).
- `collectPersonIds(opts?: { signal?: () => AbortSignal | undefined })` — single source of
  truth. The merge/dedup/slice **order is load-bearing** (Set insertion order → cast-slice
  → `SEO_PERSON_TARGET_IDS` cap), so both callers must go through it; locked by
  `seoPersonIds.test.ts`.
- Sitemap calls it with no signal + no fallback (empty list is fine); the page caller
  injects `buildSignal` per fetch and layers the `≥1 SEO_FALLBACK_PERSON_IDS` fallback on
  top (only legitimate divergence — required by Next static export).
- `sitemap.test.ts` asserts **all six** URL families (movie/tv/person/provider/billigaste/
  forsvinner) are present and every entry is `https://binge.nu/…/` (absolute + trailing
  slash), exactly the 8 public static routes (no `/my`,`/login`,… leak), and no duplicate
  URLs.

## Decided by
Growth Marketer #15 (owns the parity invariant). Placement diverges from the ticket text
by design; recorded here so the divergence is intentional and auditable.
