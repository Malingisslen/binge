# BIN-424 — Hub-of-hubs SEO index page (`/guider`)

**Status:** approved by Malin (2026-07-11, verbal "go ahead" after scoping-pass recommendation).
**Area:** frontend / seo. **Not** a sensitive domain (no rules/functions/auth/data-model) →
router tier `skip`, no stakeholder panel required. Ships direct to main per working agreement.

## Problem
The footer links only 4 of 24 franchise pages and 4 of 11 "försvinner" pages
(`Footer.tsx`). The other ~27 curated SEO landing pages are in the sitemap but have
~zero internal links → weak crawl equity (the same orphaning BIN-178 fixed for
`/provider`). Sitemap presence ≠ internal-link equity.

## Approach
One new indexable static page, `/guider`, that links **every** curated SEO landing page,
plus a single footer link to it — so all of them are one hop from every pre-rendered page.
Pure static, no data fetching; link lists come from existing constants.

## Work items
1. `src/lib/seo/hubLinks.ts` — pure helper: `providerLinks()` / `franchiseLinks()` /
   `leavingLinks()` / `hubSections()` from `FRANCHISES` + `SEO_PROVIDER_IDS`. ✅ done
2. `src/lib/seo/hubLinks.test.ts` — coverage guard: fails if a franchise/provider is added
   but not linked, or a curated provider id stops resolving. ✅ done (5 tests green)
3. `src/app/guider/page.tsx` — `force-static` server page: metadata (index inherited +
   canonical), CollectionPage + ItemList JSON-LD, `PageHeader`, three link sections from
   `hubSections()`. Canonical `/guider/`.
4. `src/app/sitemap.ts` — add `/guider/` to `staticEntries()` (priority ~0.6, weekly).
5. `src/components/layout/Footer.tsx` — add one "Alla streamingguider" link to `/guider/`
   (the de-orphaning hop). Keep the existing curated shortlists.

## Acceptance
- `hubLinks.test.ts` green; page links all 24 franchises + 11 providers + 11 leaving.
- typecheck + lint clean; page builds as a real static route (`out/guider/index.html`
  with `<h1>`, not the noindex catch-all shell).
- `/guider/` present in sitemap; footer links to it.

## Open questions
None architecture-changing. Assumptions: route slug `/guider/` (aligns with the footer's
existing "Guider" grouping); page inherits root-layout `index:true` (mirrors the valid-slug
`/billigaste` + `/provider` pages, which set only canonical). Genre hubs + försvinner SSR
are explicitly **out of scope** (deferred per the scoping pass).
