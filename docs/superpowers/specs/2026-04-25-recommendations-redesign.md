# Rekommendationer 2.0 — designspec

_Version: 1.0 (2026-04-25). Ersätter befintlig `/recommendations`-sida._

## Sammanfattning

Bygg om `/recommendations` från en hård-kapad lista (20 titlar, ingen
paginering) till en **kaskad av horisontella rader** med olika rad-typer,
ordnade efter data-styrka och färskhet. Designspråket matchar
[Streamingrådgivaren](../../advisor-logic.md): prio-kaskad där topp-elementet
har en *förklarbar* anledning till sin position.

Motivation: nuvarande implementation slår i tak efter 20 titlar och saknar
paginering, refresh-mekanism och bredd i signaltyper. Användaren beskriver
upplevelsen som *"slut på rekommendationer efter ganska kort genomgång"*.

## Job-to-be-done

Två sammanflätade jobb, i prioritetsordning:

1. **Curation / backlog-byggande** — användaren vill *lägga till bra saker i
   sin Vill-se-lista*. Tillgänglighet just nu spelar mindre roll. Kvalitet
   och matchning mot smaken väger tyngst.
2. **Long-tail discovery / serendipity** — *"varför har ingen sagt åt mig
   att se den här?"*. Tematiska djupdyk, regissör/skådis-spår, klassiker i
   kanon-luckor.

Explicit *icke*-jobb: "Vad ska jag titta på just nu?" — det löses av
[/savings](../../advisor-logic.md), kalendern och de aktiva sidorna under
`/my/`. Rekommendations-sidan är en *framåtblickande* yta.

## Form factor

**Horisontella rader (Netflix-stil, men strikt Binge-mässigt).** Specifikt:

- Ingen `box-shadow`, max 2px `border-radius` på posters, ingen gradient
- 9-10px label ovanför varje rad i `text-text-muted` (`#888`),
  uppercase + 0.5px letter-spacing, matchar tabellrubrikerna
- Posters i samma proportion och stil som befintlig `TitleGrid`
- Klick på label → expanded view (se *Expanded view* nedan)
- Horisontell scroll i raden via `overflow-x: auto` med ranar-marginal

Argumentet *"horisontella rader = AI-look"* avvisas: det är gradienter,
shadows och dekorativa overlays som skapar AI-känslan, inte rad-mönstret
i sig. Criterion Channel och Letterboxd-listor är referenspunkter, inte
Netflix.

## Rad-vokabulär

Sju rad-typer aktiva i MVP. Alla aktiveras conditionellt baserat på data.

| ID | Namn | JTBD | Aktiveras när |
|----|------|------|---------------|
| 1 | Liknar [seed] | B | Användaren har ≥1 4-5★-titel |
| 2 | Mer från [Person] | B+C | Person finns i ≥3 av användarens 4-5★ |
| 3 | Klassiker i [Genre] du missat | B | Användaren har ≥1 dominant genre |
| 4 | Tematiskt: [keyword] | C | Keyword finns i ≥3 av användarens 3-5★ |
| 6 | Trendar i Sverige | C | Alltid (fallback) |
| 9 | Liknar din senaste 5★ | B | 5★-rating inom 30 dagar |
| 10 | Kommande premiärer | B | Användaren har ≥1 myProvider |

Rad-IDs 5, 7, 8 är medvetet uteslutna efter brainstorm
(anti-filterbubble, revival för opåbörjade, decennium-spår).

## Cascade-prioritering

Varje rad får en **score** vid varje sidladdning. Topp-rader visas;
resten lazy-loadas på scroll.

### Score-formler

| Rad | Aktiveras när | Score-formel | Praktisk max |
|-----|---------------|--------------|--------------|
| 9 | 5★-rating inom 30 dagar | `100 − dagar_sedan_rating` | 100 |
| 2 | Person ≥3 i 4-5★ | `personRecurrence × 15` | ~90 |
| 1 | ≥1 4-5★-seed | `seedCount × 12` (en rad per top-3 seeds) | ~80 |
| 4 | Keyword ≥3 i 3-5★ | `keywordRecurrence × 10` | ~70 |
| 10 | myProviders ≥1 | `min(upcomingCount × 4, 50)` | 50 |
| 3 | ≥1 dominant genre | `40` (alltid medel) | 40 |
| 6 | Alltid | `30` (alltid låg-bas) | 30 |

**Tie-break:** vid lika score, B-jobb-rader (1, 2, 9) före C-jobb-rader
(3, 4, 6, 10).

**Cap-regler:**
- Initialt rendrade rader: viewport + 1 rad (för att signalera "mer
  finns"). På 15,6"-laptop typiskt **5-6 rader**.
- Resten lazy-loadas på scroll
- En rad måste ha **≥4 resultat** för att alls visas; annars skippas
  oavsett score

**Förklarbarhet:** topp-radens label har ett *varför*-suffix när den
drivs av färska data. Exempel: rad 9 visar inte bara "Liknar din
senaste 5★" utan **"Du gav 5★ till Parasite för 3 dagar sedan — här
är liknande"**. Detta speglar prio-kaskaden i Streamingrådgivaren.

### Seed-vikter (från brainstorm-fråga 4, alternativ C)

| Vikt | Krav |
|------|------|
| Stark | Rating 4-5★ |
| Svag | Rating 3★ |
| Ej seed | Inget rating, eller rating 1-2★, eller "Avbruten" |

Vilka rader använder vilken vikt:

- **Rad 1, 9, 2:** *bara stark seeds (4-5★)* — hög-precision-rader
- **Rad 4 (keywords):** *stark + svag seeds (3-5★)* — lägre-precision-filter
  där bredd hjälper
- **Rad 3 (genre-canon):** topp-genre-detektion använder *stark + svag*
  för stabilitet

### Negativa signaler

- **Avbruten** + **Inte intresserad** + **rating 1-2★**: enbart
  *exkludering* från alla rader. Ingen anti-similarity-feedback (för
  brusig — användaren kan ha droppat av icke-smak-skäl).
- **Sedd utan rating**: räknas *inte* som seed (för otydlig signal). Men
  exkluderas från rekommendations-pool (du har redan sett den).

## Radkomposition

Hur titlar fylls *inom* varje rad.

| Rad | Källa | Filter | Sortering | Cap visible |
|-----|-------|--------|-----------|-------------|
| 1 | TMDB `/recommendations` ∪ `/similar` per seed | Exkl. watchlist + Inte intresserad | TMDB-position-viktad | 20, "visa fler" |
| 2 | `/person/{id}/combined_credits` | Exkl. watchlist + endast movie/tv | `vote_average × log(vote_count)` | 20 |
| 3 | `/discover` med `with_genres`, `vote_count.gte=2000` | Exkl. watchlist, hög vote-bas | `vote_average.desc` | 20 |
| 4 | `/discover` med `with_keywords` | Exkl. watchlist, `vote_count.gte=200` | `vote_average × popularity` | 20 |
| 6 | `/trending/all/week` | Exkl. watchlist + Inte intresserad + dolda länder | TMDB-default | 20 |
| 9 | Som rad 1 men *en* seed (senaste 5★) | Som rad 1 | Som rad 1 | 20 |
| 10 | `/discover` med `primary_release_date.gte=idag` + `with_watch_providers=user.myProviders` + `with_genres=top3` | Exkl. watchlist | `primary_release_date.asc` | 20 |

### Person-detektion (rad 2)

För varje 4-5★-titel, läs `credits` (redan tillgängligt via befintlig
`append_to_response` på title-detail). Räkna uppslag för:

- Hela `cast` top 5 per titel
- `crew[job=Director]`

Person måste finnas i **≥3** distinct 4-5★-titlar för att generera en rad.
Max **5 person-rader** på sidan totalt (välj de med högst recurrence).

### Keyword-detektion (rad 4)

För varje 3-5★-titel, hämta `/movie/{id}/keywords` eller
`/tv/{id}/keywords` (separat anrop, cachad 4h). Räkna keywords. Krav:
**≥3 distinct titlar** delar keyword. Max **3 keyword-rader**.

### Genre-detektion (rad 3)

Räkna `genre_ids` från användarens 3-5★-titlar. Topp **3-5 genrer**
(de med flest uppslag) får varsin rad.

## Cold-start

| Antal 3-5★ ratings | Vad visas |
|---|---|
| **0** | Rad 6 (trending) + rad 3 (genre-canon, fallback om `user.preferredGenres` satt; annars topp-genrer i SE) + rad 10 (om providers satt). Plus banner: *"Betygsätt 3 titlar du sett för fler personliga rader →"* med knapp som öppnar QuickRateModal |
| **1-2** | Rad 1 (1-2 seeds) + rad 9 (om recent 5★) + cold-start-rader. Banner: *"Betygsätt 1 till för person- och tematiska rader"* |
| **3-9** | Full pipeline; person/keyword-rader triggar inte alltid (kräver ≥3 recurrences) |
| **10+** | Full pipeline aktiv |

### QuickRateModal

90 sekunders onboarding-flow.

- Visar 10 titlar i taget i grid-layout
- Per titel: snabbknappar **"sett 5★"**, **"sett 4★"**, **"sett 3★"**,
  **"inte sett"**
- Pool: **TMDB `/discover/movie` med `region=SE` + `sort_by=popularity.desc`
  + `vote_count.gte=5000`** — topp 50 mest populära i SE all-time
- "Klart"-knapp visas efter 5 markeringar
- Skrivs till `users/{uid}/watchlist/` i normal `sedd`-status med rating
- Endast film i MVP (TV är klurigare — kan vara avbruten/följer/sedd)

## UX-detaljer

### Streaming-roll

- Provider-pills synliga som idag på `TitleGrid`-korten (information,
  ej gatekeeper)
- "Mina tjänster"-toggle på sidnivå, **default OFF**
- Toggle PÅ → alla rader filtreras till titlar med `flatrate`-tillgänglighet
  på user.myProviders (ej `ads`/`rent`/`buy`)
- **Undantag:** rad 10 (Kommande premiärer) är *implicit* filtrerad på
  user.myProviders alltid — det är dess själva poäng
- När user klickar in på titel utanför sina tjänster → titelsidan visar
  "Inte tillgänglig på dina tjänster" + "Lägg till i Vill-se" (befintligt
  watchlist-flöde)

### "Inte intresserad"-flow

- "X"-knapp på varje kort (befintlig `showNotInterested`-prop på
  `TitleGrid` återanvänds)
- Klick → optimistic remove + skriv till
  `users/{uid}/notInterested/{tmdbId}`
- **Lucka fylls tyst** från backing pool (raden har 20 visible men poolen
  är 50+ → vi fyller på från position 21)
- `notInterested` excluderar genom hela systemet (befintligt mönster)

### Sidnivå-filter

Alla filter MVP (inga "fas 2"-uppskjutna):

- **Genre** (single-select; "Alla" default)
- **Land** (single-select; respekterar `hiddenCountries` från user-prefs
  som default-exklusion)
- **Mina tjänster** (toggle, default OFF)
- **Decade** (single-select: 1960-, 1970-, 1980-, 1990-, 2000-, 2010-,
  2020-talet, "Alla")
- **Betygströskel** (slider 0-9 i 0.5-steg, default 0)
- **Search** (textinput, klient-sidigt filter på titel + original_title
  inom redan renderade titlar)

**Filter-defaults-minne:** sparas *inte* i Firestore. Återställs vid
sidladdning. Användaren börjar varje besök med rena filter.

**Filter-applikation per rad:**
- Genre/decade/betygströskel: appliceras *server-side* i `/discover`-baserade
  rader (3, 4, 10) via TMDB-params; klient-sidigt på övriga (1, 2, 6, 9)
- Land: klient-sidigt på alla rader (TMDB:s `with_origin_country` är
  opålitligt i `/recommendations` och `/similar`)
- Mina tjänster: kräver `flatrate`-data via `useSearchProviders`-hook
  (befintlig)
- Search: rent klient-sidigt, debouncad 200ms

Rader som blir <4 titlar efter filter göms automatiskt.

### Refresh-strategi

- Per-endpoint `staleTime` via React Query (se *Cache-tier-tillägg* nedan)
- Cascade-ordningen re-evalueras vid varje sidbesök (ej cached) — använder
  watchlist/rating-data via Firestore-listeners (reactive)
- **Ingen manuell refresh-knapp.** StaleTime + reactive cascade gör att
  sidan känns levande utan friktion.
- **Ingen seed-rotation.** Statisk: samma seeds tills användaren betygsätter
  något nytt. Förutsägbart och calm.

### Expanded view ("Visa fler ›" per rad)

- Klick på rad-label → samma sida i *expanded mode* via query-param:
  `/recommendations?row=<row-id>`
- `<row-id>`-format: `similar:movie:603`, `person:140607`,
  `genre:18`, `keyword:9663`, `trending`, `latest-fav`, `upcoming`
- I expanded mode:
  - Topp av sidan: rubrik (ärver från radens titel) + kort beskrivning av
    vad som drev raden + tillbaka-länk
  - Resten av sidan: `TitleGrid`-vy (vertikal grid, samma som /upptack)
  - Alla page-filter aktiva
  - **Plus extra sorteringskontroll**: relevans (default) / betyg /
    release-datum
  - "Visa fler"-knapp paginerar TMDB (page 2+)
- Implementeras client-side med `useSearchParams`. **Ingen
  DynamicRouter- eller firebase.json-ändring krävs** — query-param på
  redan-statisk route fungerar i static export.

## URL-strategi

- Rutten **förblir `/recommendations`**
- Sidrubriken byter till **"För dig"** (för att tydliggöra distinktion mot
  /upptack = "Utforska")
- Expanded view: `?row=<id>` query-param
- Inga sub-routes, ingen DynamicRouter-ändring, ingen firebase.json-ändring

## Datalager

### TMDB-anrop per sidladdning (worst case, warm user)

| Rad | Anrop | Cache |
|-----|-------|-------|
| 1 (similar × top-3 seeds) | 3 × 2 = 6 | 30 min |
| 2 (person × ≤5 recurring) | 5 (cached cred-detail) | 4h |
| 3 (genre × top-3) | 3 | 2h |
| 4 (keyword × top-3) | 3 | 2h |
| 6 (trending) | 1 | 1h |
| 9 (latest 5★) | 2 | 30 min |
| 10 (upcoming) | 1 | 2h |
| **Subtotal per visit** | **~21** | varierar |

Plus first-time-detection per ny 4-5★-titel:
- Person-data: gratis från befintlig `append_to_response` på title-detail
- Keyword-data: 1 anrop per ny top-rated titel, cachat 4h

Med befintlig 8-concurrent semaphor + parallel `useQueries` blir
wall-time ~1-2 sek på cold cache, instant på warm.

### Cache-tier-tillägg i `src/lib/tmdb/cacheTiers.ts`

Lägg till nya konstanter:

```ts
RECOMMENDATIONS: 30 * 60 * 1000,    // 30 min — recommendations + similar
PERSON_CREDITS: 4 * 60 * 60 * 1000, // 4h — combined_credits
KEYWORDS: 4 * 60 * 60 * 1000,       // 4h — title keywords
TRENDING: 60 * 60 * 1000,           // 1h
DISCOVER: 2 * 60 * 60 * 1000,       // 2h
```

**Critical:** alla callsites för `['recommendations', mediaType, id]` och
`['similar', mediaType, id]` MÅSTE använda samma `RECOMMENDATIONS`-konstant.
Befintliga `useTVShow`/`useMovieDetail` hämtar `recommendations` via
`append_to_response` — vi får antingen reuse den datan när vi har den, eller
acceptera dubbel-fetch och förlita oss på cache-tier för konsistens. Beslut:
**reuse via React Query cache där möjligt** — när cascade behöver
recommendations för seed X, kolla först om det finns i cachen från en
title-detail-fetch.

### Nya TMDB-helpers i `src/lib/tmdb/client.ts`

```ts
getSimilar(mediaType: 'movie' | 'tv', id: number, opts?): TMDBListResponse<TMDBSearchResult>
getMovieKeywords(id: number, opts?): { keywords: { id: number; name: string }[] }
getTVKeywords(id: number, opts?): { results: { id: number; name: string }[] }
```

(`getRecommendations` finns redan på rad 140.)

## Filorganisation

```
src/
├── app/recommendations/page.tsx                    # AuthGuard + Hub (smal)
├── components/recommendations/
│   ├── RecommendationsHub.tsx                      # Orchestrator
│   ├── RecommendationsExpanded.tsx                 # Query-param expanded view
│   ├── CascadeRow.tsx                              # Label + horisontell poster-rad
│   ├── RecommendationsFilters.tsx                  # Top-bar filter
│   ├── EmptyState.tsx                              # Cold-start banner
│   └── QuickRateModal.tsx                          # 90s onboarding
├── hooks/
│   ├── useRecommendationsCascade.ts                # Returnerar ordnad rad-array
│   └── rows/
│       ├── useRowSimilar.ts
│       ├── useRowPerson.ts
│       ├── useRowGenreCanon.ts
│       ├── useRowThematic.ts
│       ├── useRowTrending.ts
│       ├── useRowLatestFav.ts
│       └── useRowUpcoming.ts
└── lib/recommendations/
    ├── cascadePrioritizer.ts                       # Pure: data → ordered rows
    ├── seedAnalysis.ts                             # Pure: detect recurring people/keywords/genres
    ├── rowComposition.ts                           # Pure: filter/sort/cap per rad
    ├── cascadePrioritizer.test.ts
    ├── seedAnalysis.test.ts
    └── rowComposition.test.ts
```

Pure helpers i `/lib/recommendations/` följer mönstret från
`useSubscriptionAdvisor.helpers.ts` och `sessionTiming.ts` — testbara utan
Firebase-imports.

## Test-strategi

- **Pure helpers (Vitest):** cascadePrioritizer, seedAnalysis, rowComposition
  — täckning av:
  - Cascade: 0/1/3/10/100 ratings, recurring 0/2/3/5, recent vs old 5★
  - SeedAnalysis: tom watchlist, single rating, no recurring people, deep
    person/keyword recurrence
  - RowComposition: empty pool, all-excluded pool, filter applikation
- **Hook-tester:** `useRecommendationsCascade` med mockad watchlist via
  `renderHook` + react-query-wrapper
- **Manuell QA:** seed-script i `scripts/seed-recommendations-test-user.ts`
  som skapar 3 testanvändare i Firebase-emulator (cold/warm/power) för
  manuell verifiering av cold-start, kaskad och filter
- **Sentry-tags:** varje TMDB-anrop tagsätts
  `recommendation_row: similar|person|genre-canon|thematic|trending|latest-fav|upcoming`
  så vi kan se per-rad-failures i prod

## Implementation-gotchas

1. **TMDB_STALE-konsistens:** se *Cache-tier-tillägg* ovan. Mismatch mellan
   callsites = observers slåss om värden (känd buggklass).
2. **Reuse av title-detail-data:** title-detail har redan `recommendations`
   via `append_to_response`. Cascade ska *kolla cachen först* innan separat
   `getRecommendations`-anrop. Implementeras via React Query
   `queryClient.getQueryData(['movie', id])` i hook.
3. **Static-export-kompatibilitet:** all expanded-view-state via
   `useSearchParams` (App Router-hook). Ingen `useRouter().push` på server.
4. **Firestore-rules:** inga ändringar krävs.
   `users/{uid}/notInterested/{tmdbId}`-mönstret återanvänds direkt.
5. **Cascade re-eval på watchlist-mutation:** React Query invalidation på
   watchlist-mutation triggar re-render automatiskt. Gratis.
6. **`origin_country`-filter:** TMDB:s `with_origin_country` på `/discover`
   är opålitligt på `/recommendations` och `/similar` (de respekterar inte
   parametern). Klient-side-filter krävs.

## Fasning

**Allt i en PR.** Användarbeslut. Risk att flagga: PR:en blir stor (uppskattat
~2500-3500 LOC), reviews kan bli tunga. Mitigering: pure helpers +
hook-skiktet skrivs och testas isolerat innan UI-koden, så review kan ske
i logiska sjok även om allt är ett commit-träd.

## Open questions / explicit out-of-scope

**Out-of-scope för MVP:**
- Anti-filterbubble-rad (rad 5 — uteslutet i brainstorm)
- Revival för opåbörjade titlar (rad 7)
- Decennium-spår-rad (rad 8)
- Manuell refresh-knapp
- Seed-rotation över tid
- Filter-defaults-persistens
- Sub-routes via DynamicRouter
- TV-titlar i QuickRateModal (endast film i MVP)
- Anti-similarity-signaler från Avbruten/låga ratings
- Power-features: list export, share-rec-link, "rec from friend"

**Open questions** (kan svaras under implementation):
- Exakt placering av `RecommendationsFilters`-bar (sticky top eller scroll
  med innehållet?) — UX-tweak under implementation
- QuickRateModal: ska den dyka upp automatiskt vid första cold-start-besök,
  eller bara via banner-klick? — *Förslag: bara via klick.* Auto-pop känns
  påträngande.
- Visual feedback när cascade re-evaluerar efter rating-mutation — animerad
  eller silent? — *Förslag: silent.* Konsistent med "calm"-tema.
