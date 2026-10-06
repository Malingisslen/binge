# 0024. SEO: a core of titles with Swedish availability instead of the top lists

- **Date:** 2026-10-05
- **Status:** Accepted
- **Supersedes:** the ceilings in ADR 0018 (the ratchet mechanism itself stays)
- **Trigger:** Google Search Console, 2026-10-05 — indexed pages fell from 260 (July) to 1 (the homepage) by September
- **Stakeholders (panel):** #15 Growth Marketer (plan, approve with conditions), #26 Information Architect (step 1, approve with conditions)

## Context
Search Console showed no manual action and no technical block. About 28 800 title pages were
"crawled, not indexed", 15 300 "discovered, not indexed", and 6 400 person pages were duplicates
without a chosen canonical. The pages were TMDB metadata with little of binge's own. Google judged
them thin, and the judgement reached the whole domain.

## Decision
Malin chose "Banta" on a decision card and said "Kör" to the plan on 2026-10-05.

1. The pre-rendered selection is a core of titles that can be watched on a Swedish service,
   derived from TMDB `/discover` (popularity, `watch_region=SE`, any monetization type).
   Ceilings and the derivation target live in `SELECTION_CEILING` and `SEO_TITLE_TARGET_IDS`;
   read them there. The ratchet (union, evict oldest) is unchanged, and the invariant
   ceiling > derivation is tested.
2. `MANIFEST_VERSION` is bumped, so the first build re-derives instead of trimming the old
   top-list selection.
3. The seed list from 2026-08-08 is retired. It pinned pages Google no longer indexes.
4. Person pages are not pre-rendered for Google. The route builds only the fallback ids, with
   noindex, and the person sitemap file is gone.
5. Title and person client pages no longer flip the catch-all's noindex to index after
   hydration. Provider hubs keep their flip.
6. The catch-all shell has no canonical in its static HTML (it was noindex plus canonical to
   the homepage).
7. robots.txt does not block the dropped pages, so Google can read their noindex.

## Conditions folded in (#26)
Sitemap equals the pre-rendered set (one manifest, two readers); a core page's canonical equals
its sitemap URL; no title, season or person client sets `indexable`; robots.txt never disallows
title or person paths; the build logs the final count per type. Internal linking from the core
to hubs, and per-title Swedish availability text, are step 2.

## Alternatives considered
Keeping the ~29 000 pages and only enriching them: rejected, because enrichment at that volume
is still mostly TMDB copy and Google had already stopped reading most of the pages.
Disallowing the dropped pages in robots.txt: rejected, because a blocked URL cannot show its
noindex.

## Consequences
A shared link to a title outside the core gets the generic preview. Hosting storage and build
time shrink. Success is measured in Search Console at week 4 and 8; the pass mark is at least
300 core pages and half of binge's own hubs indexed. If it misses, the core is cut further and
the focus moves to binge's own pages.

## Decided by
Malin, 2026-10-05.
