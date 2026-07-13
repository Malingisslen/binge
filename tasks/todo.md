# BIN-461 — Genre hub pages /genre/[slug] (Malin reversed "not now" → build now, 2026-07-13)

**Goal:** one crawlable, pre-rendered landing page per curated genre — "Bästa [genre] att
streama i Sverige" — mirroring the proven `/billigaste/[slug]` recipe (pure static, curated
slug set, no DynamicRouter/firebase.json wiring, resilient EmptyState on build flake).
Router verdict: tier **medium**, owning role #10 Performance Engineer (blind critique below
folded in). Keyword research: competitor pages (Netflixguiden/Filmtopp/MovieZine) all rank
per-provider genre lists; binge's angle is cross-provider + "ingår i ditt abonnemang".

## Curated genre set (10 slugs, ASCII, explicit per-media TMDB ids — no runtime guessing)

| slug | H1 head term | movie id | tv id |
|---|---|---|---|
| thriller | Bästa thrillers | 53 | — (TV saknar thriller-genre) |
| skrack | Bästa skräckfilmerna | 27 | — |
| action | Bästa actionfilmer & serier | 28 | 10759 |
| komedi | Bästa komedier | 35 | 35 |
| drama | Bästa dramafilmer & serier | 18 | 18 |
| deckare | Bästa deckare & kriminalserier | 80 | 80 |
| dokumentarer | Bästa dokumentärer | 99 | 99 |
| sci-fi | Bästa sci-fi | 878 | 10765 |
| romantik | Bästa romantiska filmer | 10749 | — |
| animerat | Bästa animerade filmer & serier | 16 | 16 |

## Tasks

- [ ] 1. `src/lib/seo/genreHubs.ts` — `GENRE_HUBS` config (slug, h1, metaTitle,
  metaDescription ≤160, blurb, movieGenreId?, tvGenreId?) + `SEO_GENRE_SLUGS` export.
  Single source shared by page, sitemap, hub links (same role as `SEO_PROVIDER_IDS`).
- [ ] 2. `src/lib/seo/genreHubs.test.ts` — slug format/uniqueness, ids exist in
  `GENRE_LABELS`, media-id sanity vs `genreMapping` (TDD: write first).
- [ ] 3. `src/app/genre/[slug]/page.tsx` — `force-static` + `dynamicParams=false` +
  `generateStaticParams` over `SEO_GENRE_SLUGS`. Build fetch: `discoverMovies`/`discoverTV`
  `{with_genres, sort_by: 'popularity.desc', 'vote_count.gte': '50', page: '1'}` via the
  billigaste-style `withRetry` (4 attempts, backoff) + `buildSignal()`. Server-rendered:
  `PageHeader`, sektion **Filmer** + **Serier** (skip section when no genre id / zero rows),
  hand-rolled poster `<ol>` (billigaste style), `CollectionPage`+`ItemList` JSON-LD,
  `JustWatchCredit` + TMDB-attribution, `EmptyState` "kommer snart" on total-zero (BIN-460
  lesson — never notFound() for a sitemap-committed URL). Metadata: known slug → title/desc/
  canonical + OG; unknown → `robots noindex,nofollow` fallback (provider pattern).
- [ ] 4. `src/app/genre/[slug]/page.test.tsx` — JSON-LD parses + @type asserts, metadata
  canonical for known slug, noindex for unknown (BIN-478 pattern).
- [ ] 5. `src/app/sitemap.ts` — `genreEntries()`: 10 URLs, `weekly`, priority 0.7.
- [ ] 6. `src/lib/seo/hubLinks.ts` — `genreLinks()` + 4th `HubSection` on `/guider`;
  update `hubLinks.test.ts` coverage guard.
- [ ] 7. Workflow map (SEPARATE COMMIT per 2026-07-10 lesson): `docs/workflow-map-universe.json`
  routes += `/genre/[slug]`; add covers[] to the SEO-pages flow in `docs/workflow-map.html`;
  run `node scripts/check-workflow-map.mjs`.
- [ ] 8. Verify: `npm test` + `npm run typecheck` + `npm run lint`; local `next build` spot-
  check that `out/genre/thriller/index.html` contains `page-h1` + real titles (build-flake
  lesson: HTTP 200 is not enough). Review gates: binge-code-reviewer + binge-test-reviewer +
  `/code-review high` → markers → commit → push → await deploy green → purge Cloudflare →
  live curl check → BIN-461 Done.

## Panel conditions (Performance Engineer #10 — VERDICT approve-with-conditions, 2026-07-13; binding)

- [PE-1] Fetch via DIRECT `discoverMovies`/`discoverTV` + `buildSignal()`, **never
  `fetchForBuild`** — that cache/budget system is id-keyed for the 25k-title pipeline;
  query-shaped genre calls through it would corrupt cache-key shape and eat shared
  title-refresh budget. Test: page imports only discover* + buildSignal, no fetchForBuild.
- [PE-2] Movie+TV discover per page in `Promise.all` (mirror ProviderPage.fetchPopular),
  not sequential awaits — one round-trip of added latency per page, not two.
- [PE-3] `withRetry` scoped PER CALL (a flaked TV discover must not re-run a succeeded
  movie discover).
- [PE-4] Posters at `w92` (46×69, billigaste's bandwidth choice) + explicit width/height +
  `loading="lazy"` + `decoding="async"` — pin the size token, no heavier variant.
- [PE-5] Verify step includes a build wall-time note: 10 pages × ≤2 calls × 4 attempts ×
  backoff must stay low single-digit seconds even at retry exhaustion (30-min-build
  incident 2026-06-15 is the cautionary precedent).
- [PE-6] No client-side fan-out on hydrate (server-rendered grid; no new useQuery); +10
  sitemap URLs, zero impact on the 25k pre-render budget. (`hubLinks` is pure static —
  confirmed zero runtime cost.)

## Out of scope (explicitly)

- Fler genrer än 10 (utöka efter GSC-data), fantasy/familj väntar.
- Ingen DynamicRouter/klient-fallback för okända slugs (billigaste-mönstret, inte provider-).
- Inga ändringar i `/billigaste`-koden (withRetry kopieras lokalt, extraheras EJ nu).
