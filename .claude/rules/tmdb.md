---
paths:
  - "src/lib/tmdb/**"
  - "src/hooks/**"
  - "src/components/title/**"
---

# TMDB — shared cache keys, rate limits, API conventions

## staleTime — dela via `TMDB_STALE`

Flera hooks kan registrera samma queryKey — då MÅSTE de använda samma
`TMDB_STALE`-konstant (annars slåss observers om senaste värde):

- `['tv', id]` (full detalj, append_to_response): useTVShow + QuickAddButton
  + StatusButton → `TMDB_STALE.TV_DETAIL`
- `['tv-lite', id]` (bas + watch/providers): useCalendar + useSubscriptionAdvisor
  → `TMDB_STALE.LITE_DETAIL`
- `['movie', id]` (full detalj): useMovie → `TMDB_STALE.MOVIE_DETAIL`
- `['movie-lite', id]` (bas + release_dates + providers): useCalendar
  → `TMDB_STALE.LITE_DETAIL`

Fan-out-ytor (kalender/rådgivare, en query per bibliotekstitel) ska använda
lite-varianterna (`getTVShowLite`/`getMovieLite` i `src/lib/tmdb/client.ts`) —
fulla detaljsvar är 5–10× större och hör hemma på titelsidor.

**React Query-persist (`shouldPersistQuery` i `src/lib/queryClient.ts`):**
persisterar BARA små, delade katalog-queryer (`genres-*`, `trending`,
`popular-*`, `discover-*`). Per-titel-data persisteras ALDRIG — den skalar med
bibliotekets storlek och sprängde 5 MB-localStorage-taket i produktion. Detta
gäller `tv-lite`/`movie-lite`/`tv-season` OCH `watch-providers` (sistnämnda är
per-titel multi-country, ~40 KB/titel — stod för 1396 av 1409 KB efter att
tv-lite togs bort). Per-titel-data re-fetchas billigt (gated) och watchlist-datan
är redan momentan via Firestores IndexedDB-cache, så återbesök är snabba ändå.

## Rate-limit + AbortSignal

`src/lib/tmdb/client.ts` har en 8-concurrent-semaphore + 429 Retry-After-respekt
+ AbortSignal hela vägen. React Query's `ctx.signal` skickas vidare i alla
`useQuery`/`useQueries` så navigations-bort avbryter in-flight fetches.

## API conventions

- Always use `language=sv-SE` och `watch_region=SE` för svenskt innehåll
- `region=SE` + `watch_region=SE` på `/discover/movie` + `/discover/tv`
- Watch providers via `append_to_response=watch/providers`, key `results.SE`
- Provider categories: `flatrate`, `free`, `ads`, `rent`, `buy`
  - `ads` filtreras bort i advisor om användaren inte har någon ads-tjänst
- Image base: `https://image.tmdb.org/t/p/{size}/`
- Attribution required: _"This product uses the TMDB API but is not endorsed or certified by TMDB"_ — konstanter i `src/lib/tmdb/attribution.ts`

## Provider mapping

`src/lib/tmdb/providers.ts` har `SWEDISH_PROVIDERS` + `canonicalProviderId()`.
TMDB returnerar ibland samma tjänst under flera ids (t.ex. TV4 Play = 489 +
alias 1944). `canonicalProviderId` normaliserar så vi inte visar en tjänst
två gånger.
