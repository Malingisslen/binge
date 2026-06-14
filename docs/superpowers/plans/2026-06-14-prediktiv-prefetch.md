# Prediktiv prefetch / lazy-load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hämta titel-/säsongs-/sidodata från TMDB *innan* användaren klickar (på hover-intent, touch, och idle) så att navigationen känns momentan — utan att lägga till någon driftskostnad.

**Architecture:** All prefetch går via React Querys `queryClient.prefetchQuery` mot SAMMA queryKeys som detaljsidorna redan använder (`['movie', id]`, `['tv', id]`, `['tv-season', id, n]`, `['discover', tab, params]`). Det betyder att en lyckad prefetch gör att detaljsidans `useQuery`/`useTrending` etc. hittar färdig data i cachen och renderar direkt. `prefetchQuery` är fire-and-forget (kastar aldrig, returnerar inget) och är en no-op om datan redan är färsk (staleTime-dedup). Allt går genom den befintliga 8-concurrent-semaforen + AbortSignal i `src/lib/tmdb/client.ts`, så prefetch kan aldrig översvämma TMDB.

**Tech Stack:** Next.js 16 (App Router, static export), React 19, TanStack Query v5, TypeScript, Vitest.

**Kostnad:** Noll nya betaltjänster. Prefetch är BARA TMDB-anrop (gratis API, rate-limitat 8-i-taget) — INGEN Firestore-läsning. En hover-prefetch är samma anrop som annars sker på klick, bara tidigarelagt; touch/idle-prefetch lägger på enstaka spekulativa anrop som dedupas av staleTime.

**Viktiga repo-regler:**
- Svenskt UI, inga hex-färger, `danger`-tokens för fel.
- Verifiering per task: `npm run typecheck` + `npm test` (alla gröna). Pure-logic extraheras för testbarhet utan Firebase-imports (befintligt mönster, se `*.helpers.ts`).
- Commits på svenska, avsluta med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Deploy via push till main (deploy.yml). Bygget har en 30-min-spärr (sedan 2026-06-13).

**Designprinciper för prefetch (gäller alla tasks):**
- **Intent, inte allt.** Hover prefetchar först efter ~150 ms (hover-intent) så att titlar man bara sveper förbi inte hämtas. Touch prefetchar på `pointerdown` (= ett faktiskt tryck). Idle/next-page prefetchar bara på tydlig intent (hover på "Visa fler").
- **Dedup gratis.** `prefetchQuery` med samma `staleTime` som detaljsidan → om datan redan är färsk händer ingenting.
- **Avbryt billigt.** Lämnar muspekaren kortet före 150 ms avbryts timern (ingen hämtning startar). In-flight fetches avbryts redan av TMDB-klientens AbortSignal vid navigation.

---

## Filstruktur

- **Create:** `src/lib/tmdb/prefetch.ts` — ren helper `titlePrefetchSpec(mediaType, id)` + `currentSeasonToPrefetch(show)`. Testbar utan React/Firebase.
- **Create:** `src/lib/tmdb/prefetch.test.ts` — enhetstester för helpers.
- **Create:** `src/hooks/usePrefetchTitle.ts` — hook som ger hover-intent- + touch-handlers åt ett titelkort.
- **Modify:** `src/components/title/TitleCard.tsx` — koppla in prefetch-handlers på kortets wrapper.
- **Modify:** `src/components/pages/TVShowPageClient.tsx` — prefetcha aktuell säsong vid mount.
- **Modify:** `src/app/discover/page.tsx` — prefetcha nästa sida på hover av "Visa fler".

---

### Task 1: `titlePrefetchSpec`-helper + `usePrefetchTitle`-hook + hover-intent på TitleCard

Detta är kärnan: hovra ett filmkort på desktop → titelns detalj hämtas → klick renderar direkt.

**Files:**
- Create: `src/lib/tmdb/prefetch.ts`
- Create: `src/lib/tmdb/prefetch.test.ts`
- Create: `src/hooks/usePrefetchTitle.ts`
- Modify: `src/components/title/TitleCard.tsx`

- [ ] **Step 1: Skriv failande test för `titlePrefetchSpec`**

Skapa `src/lib/tmdb/prefetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { titlePrefetchSpec } from './prefetch';
import { TMDB_STALE } from './cacheTiers';

describe('titlePrefetchSpec', () => {
  it('ger fulla tv-detaljnyckeln + TV_DETAIL för serier', () => {
    const spec = titlePrefetchSpec('tv', 1399);
    expect(spec.queryKey).toEqual(['tv', 1399]);
    expect(spec.staleTime).toBe(TMDB_STALE.TV_DETAIL);
    expect(typeof spec.queryFn).toBe('function');
  });
  it('ger fulla movie-detaljnyckeln + MOVIE_DETAIL för filmer', () => {
    const spec = titlePrefetchSpec('movie', 27205);
    expect(spec.queryKey).toEqual(['movie', 27205]);
    expect(spec.staleTime).toBe(TMDB_STALE.MOVIE_DETAIL);
  });
});
```

- [ ] **Step 2: Kör testet — ska faila**

Run: `npx vitest run src/lib/tmdb/prefetch.test.ts`
Expected: FAIL — `titlePrefetchSpec` finns inte (Cannot find module './prefetch' eller is not a function).

- [ ] **Step 3: Implementera `src/lib/tmdb/prefetch.ts`**

```ts
import { getMovie, getTVShow, getTVSeason, type TmdbFetchOpts } from './client';
import { TMDB_STALE } from './cacheTiers';
import type { MediaType, TMDBTVShow, TMDBMovie, TMDBSeasonDetail } from '@/types';

// Prefetch-spec som matchar EXAKT detaljsidornas useQuery (useMovie/useTVShow i
// src/hooks/useTMDB.ts): samma queryKey + staleTime, så en lyckad prefetch gör
// att detaljsidan hittar färdig data i cachen och renderar direkt.
export function titlePrefetchSpec(
  mediaType: MediaType,
  id: number,
): {
  queryKey: readonly [string, number];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TMDBTVShow | TMDBMovie>;
  staleTime: number;
} {
  if (mediaType === 'tv') {
    return {
      queryKey: ['tv', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => getTVShow(id, { signal } satisfies TmdbFetchOpts),
      staleTime: TMDB_STALE.TV_DETAIL,
    };
  }
  return {
    queryKey: ['movie', id],
    queryFn: ({ signal }: { signal: AbortSignal }) => getMovie(id, { signal } satisfies TmdbFetchOpts),
    staleTime: TMDB_STALE.MOVIE_DETAIL,
  };
}

// Aktuell säsong att prefetcha för en TV-detaljsida: next_episode_to_air:s
// säsong om den finns (det är den användaren mest sannolikt öppnar), annars
// sista kända säsongen. Returnerar null om serien saknar säsonger.
export function currentSeasonToPrefetch(show: {
  number_of_seasons?: number | null;
  next_episode_to_air?: { season_number?: number | null } | null;
}): number | null {
  const next = show.next_episode_to_air?.season_number;
  if (typeof next === 'number') return next;
  if (typeof show.number_of_seasons === 'number' && show.number_of_seasons > 0) {
    return show.number_of_seasons;
  }
  return null;
}

export function seasonPrefetchSpec(
  seriesId: number,
  seasonNumber: number,
): {
  queryKey: readonly [string, number, number];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TMDBSeasonDetail>;
  staleTime: number;
} {
  return {
    queryKey: ['tv-season', seriesId, seasonNumber],
    queryFn: ({ signal }: { signal: AbortSignal }) => getTVSeason(seriesId, seasonNumber, { signal }),
    staleTime: TMDB_STALE.SEASON,
  };
}
```

VERIFIERA: att `TmdbFetchOpts` faktiskt exporteras från `src/lib/tmdb/client.ts` (det gör den — `export interface TmdbFetchOpts`). Om `TMDBSeasonDetail` inte finns i `@/types`, byt returtyp till det typnamn `getTVSeason` faktiskt returnerar (kolla signaturen i client.ts: `getTVSeason(...): Promise<TMDBSeasonDetail>`).

- [ ] **Step 4: Kör testet — ska passera**

Run: `npx vitest run src/lib/tmdb/prefetch.test.ts`
Expected: PASS (2 tester).

- [ ] **Step 5: Skapa `usePrefetchTitle`-hooken**

Skapa `src/hooks/usePrefetchTitle.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { titlePrefetchSpec } from '@/lib/tmdb/prefetch';
import type { MediaType } from '@/types';

// ~150 ms hover innan vi tror på "intent" — filtrerar bort titlar som bara
// sveps förbi med muspekaren, så vi inte prefetchar hela griden.
const HOVER_INTENT_MS = 150;

/**
 * Ger prefetch-handlers åt ett titelkort. På desktop: hovra i ~150 ms →
 * prefetcha titelns detalj (samma queryKey som detaljsidan, dedupas av
 * staleTime). Lämnar man kortet före dess avbryts timern. På touch:
 * prefetcha direkt på pointerdown (= ett faktiskt tryck, kommer ~100 ms
 * före att navigeringen är klar). Allt fire-and-forget; kostar bara ett
 * TMDB-anrop som ändå skulle skett på klick.
 */
export function usePrefetchTitle() {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((mediaType: MediaType, id: number) => {
    void queryClient.prefetchQuery(titlePrefetchSpec(mediaType, id));
  }, [queryClient]);

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // Rensa en hängande timer om kortet unmountar mitt i hover-intent-fönstret.
  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback((mediaType: MediaType, id: number) => {
    cancel();
    timer.current = setTimeout(() => fire(mediaType, id), HOVER_INTENT_MS);
  }, [cancel, fire]);

  return { onPointerEnter, onPointerLeave: cancel, fire };
}
```

- [ ] **Step 6: Koppla in hover-intent i TitleCard**

I `src/components/title/TitleCard.tsx`:
- Lägg importen (nära de andra hook-importerna, t.ex. efter `import { useWatchlist } from '@/hooks/useWatchlist';`):
```tsx
import { usePrefetchTitle } from '@/hooks/usePrefetchTitle';
```
- I komponentkroppen, efter `const { getItem } = useWatchlist();`:
```tsx
  const prefetch = usePrefetchTitle();
```
- Lägg handlers på den YTTERSTA wrappern (`<div className="group relative">`) — den omsluter både postern och titel-länken, så hover var som helst på kortet räknas. Bara om titeln är trackbar (`isTrackable` finns redan):
```tsx
  return (
    <div
      className="group relative"
      onPointerEnter={isTrackable ? () => prefetch.onPointerEnter(item.media_type as MediaType, item.id) : undefined}
      onPointerLeave={isTrackable ? prefetch.onPointerLeave : undefined}
    >
```
(`MediaType` importeras redan i filen — verifiera; annars lägg till i `import type`-raden från `@/types`. `isTrackable` är redan definierad ovanför return.)

- [ ] **Step 7: Typecheck + tester**

Run: `npm run typecheck && npm test`
Expected: PASS (alla, inkl. de 2 nya prefetch-testerna).

- [ ] **Step 8: Manuell verifiering**

Kör `npm run dev`, öppna `/discover` eller `/recommendations` med DevTools → Network (filter: `themoviedb`). Hovra ett filmkort i >150 ms → ett `/movie/{id}` eller `/tv/{id}`-anrop ska gå iväg. Klicka sedan kortet → titelsidan ska rendera **utan** "Laddar…"-skelett (datan finns redan). Svep snabbt förbi flera kort utan att stanna → inga anrop (intent-fördröjningen filtrerar).

- [ ] **Step 9: Commit**

```bash
git add src/lib/tmdb/prefetch.ts src/lib/tmdb/prefetch.test.ts src/hooks/usePrefetchTitle.ts src/components/title/TitleCard.tsx
git commit -m "perf(prefetch): hover-intent-prefetcha titeldetalj från TitleCard

Hovra ett filmkort i ~150 ms → titelns TMDB-detalj hämtas i bakgrunden mot
samma queryKey som detaljsidan, så klicket renderar direkt utan Laddar-skelett.
Intent-fördröjning filtrerar bort sveps-förbi-titlar; staleTime dedupar; bara
TMDB (ingen Firestore-kostnad).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Touch-prefetch (mobil) — prefetcha på pointerdown

Mobil har ingen hover. `pointerdown` fyrar vid första touchen, ~100 ms innan klicket/navigeringen är klar — tillräckligt för en head-start. Vi återanvänder `fire` från hooken (ingen intent-fördröjning på touch; trycket ÄR intenten).

**Files:**
- Modify: `src/hooks/usePrefetchTitle.ts`
- Modify: `src/components/title/TitleCard.tsx`

- [ ] **Step 1: Lägg en `onPointerDown` i hooken**

I `src/hooks/usePrefetchTitle.ts`, lägg till i den returnerade objektet (efter `onPointerLeave: cancel`):
```tsx
    onPointerDown: fire,
```
Så returraden blir:
```tsx
  return { onPointerEnter, onPointerLeave: cancel, onPointerDown: fire, fire };
```
(`fire(mediaType, id)` finns redan. `onPointerDown` anropas med samma argument som `fire`.)

- [ ] **Step 2: Koppla in pointerdown i TitleCard**

I `src/components/title/TitleCard.tsx`, utöka den yttersta wrappern från Task 1 med `onPointerDown`:
```tsx
    <div
      className="group relative"
      onPointerEnter={isTrackable ? () => prefetch.onPointerEnter(item.media_type as MediaType, item.id) : undefined}
      onPointerLeave={isTrackable ? prefetch.onPointerLeave : undefined}
      onPointerDown={isTrackable ? () => prefetch.onPointerDown(item.media_type as MediaType, item.id) : undefined}
    >
```
OBS: `onPointerDown` fyrar för BÅDE mus och touch. På mus är det harmlöst (hover-intent har oftast redan fyrat; staleTime gör det andra anropet till en no-op). På touch är det enda vägen. Ingen separat touch-detektering behövs.

- [ ] **Step 3: Typecheck + tester**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manuell verifiering**

I DevTools → Toggle device toolbar (mobilemulering) → tryck-och-håll ett kort kort innan du släpper → ett detaljanrop ska gå på pointerdown. Släpp → navigering, sidan redan varm. (Eller verifiera på riktig mobil mot dev-servern.)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePrefetchTitle.ts src/components/title/TitleCard.tsx
git commit -m "perf(prefetch): touch-prefetcha titeldetalj på pointerdown (mobil)

Mobil saknar hover — pointerdown fyrar ~100 ms före navigeringen är klar och
ger samma head-start. Återanvänder hookens fire(); staleTime gör mus-fallet
(där hover-intent ofta redan hämtat) till en no-op.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Säsongs-prefetch på TV-detaljsidan

När du öppnar en serie: prefetcha aktuell säsongs avsnitt så att avsnittslistan / "bocka av avsnitt" känns momentan.

**Files:**
- Modify: `src/components/pages/TVShowPageClient.tsx`
- Test: täcks av `currentSeasonToPrefetch` i `src/lib/tmdb/prefetch.test.ts` (Task 1) — utöka testet nedan.

- [ ] **Step 1: Lägg failande test för `currentSeasonToPrefetch`**

I `src/lib/tmdb/prefetch.test.ts`, lägg till ett nytt describe-block:
```ts
import { currentSeasonToPrefetch } from './prefetch';

describe('currentSeasonToPrefetch', () => {
  it('väljer next_episode_to_air-säsongen när den finns', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 5, next_episode_to_air: { season_number: 6 } })).toBe(6);
  });
  it('faller tillbaka på sista säsongen utan next_episode', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 3, next_episode_to_air: null })).toBe(3);
  });
  it('returnerar null när serien saknar säsonger', () => {
    expect(currentSeasonToPrefetch({ number_of_seasons: 0, next_episode_to_air: null })).toBeNull();
    expect(currentSeasonToPrefetch({})).toBeNull();
  });
});
```
(Importen av `currentSeasonToPrefetch` kan slås ihop med den befintliga `titlePrefetchSpec`-importen högst upp.)

- [ ] **Step 2: Kör — ska passera direkt** (helpern skrevs redan i Task 1)

Run: `npx vitest run src/lib/tmdb/prefetch.test.ts`
Expected: PASS (alla, inkl. de 3 nya). Om `currentSeasonToPrefetch` saknas (Task 1 ej körd): implementera den enligt Task 1 Step 3.

- [ ] **Step 3: Prefetcha säsongen vid mount i TVShowPageClient**

I `src/components/pages/TVShowPageClient.tsx`:
- Lägg importerna (nära övriga):
```tsx
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentSeasonToPrefetch, seasonPrefetchSpec } from '@/lib/tmdb/prefetch';
```
(`useEffect` kan redan vara importerad — slå ihop i så fall.)
- I komponentkroppen, efter att `show` finns tillgänglig (efter `if (!show) return ...`-guarden — lägg den EFTER guarden så `show` garanterat är icke-null; React-hooks-regeln om "inga hooks efter early return" gäller, så lägg istället useEffect FÖRE guarden men gate:a på `show`):

Lägg detta bland de andra hookarna högst upp i komponenten (inte efter en early return):
```tsx
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!show) return;
    const season = currentSeasonToPrefetch(show);
    if (season == null) return;
    void queryClient.prefetchQuery(seasonPrefetchSpec(show.id, season));
  }, [show, queryClient]);
```
VERIFIERA: variabelnamnet på TMDBTVShow-objektet i filen (det heter `show` enligt rad 118/311). Om hooken `useTVShow` returnerar `{ data: show }` med annat namn, anpassa.

- [ ] **Step 4: Typecheck + tester**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Manuell verifiering**

`npm run dev` → öppna en serie-sida med DevTools → Network. Ett `/tv/{id}/season/{n}`-anrop ska gå strax efter att sidan laddat (utan att du expanderat avsnittslistan). Expandera listan → avsnitten ska vara där direkt.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tmdb/prefetch.test.ts src/components/pages/TVShowPageClient.tsx
git commit -m "perf(prefetch): prefetcha aktuell säsong vid mount på TV-detaljsidan

Öppnar du en serie hämtas next_episode_to_air:s säsong (annars sista säsongen)
direkt, så avsnittslistan + bocka-av-avsnitt känns momentant. Samma queryKey
som useTVSeason → dedupas; bara TMDB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Nästa-sida-prefetch på Utforska ("Visa fler")

När du hovrar "Visa fler" på `/discover` börjar nästa sida hämtas, så listan växer direkt vid klick.

**Files:**
- Modify: `src/app/discover/page.tsx`

- [ ] **Step 1: Läs filens query-konstruktion + "Visa fler"-knappen**

Läs `src/app/discover/page.tsx`. Bekräfta (verifierat 2026-06-14):
- Query: `useQuery({ queryKey: ['discover', tab, discoverParams], queryFn: () => tab === 'movies' ? discoverMovies(discoverParams) : discoverTV(discoverParams), enabled: tab !== 'trending', staleTime: 5*60*1000 })` (rad ~77-82).
- `discoverParams` innehåller `page: String(page)` (rad ~67).
- "Visa fler"-knappen: `onClick={() => setPage(p => p + 1)}` (rad ~195).
- `discoverMovies`/`discoverTV` importeras redan från `@/lib/tmdb/client`.

- [ ] **Step 2: Lägg en prefetch-handler för nästa sida**

I `src/app/discover/page.tsx`:
- Säkerställ importen av `useQueryClient` (lägg till om den saknas):
```tsx
import { useQueryClient } from '@tanstack/react-query';
```
- I komponentkroppen, efter `const { user } = useAuth();`:
```tsx
  const queryClient = useQueryClient();
```
- Lägg en memo:erad prefetch-funktion EFTER att `discoverParams` definierats (rad ~75):
```tsx
  // Prefetcha nästa sida på hover av "Visa fler" — samma queryKey som listan
  // använder (['discover', tab, params]) fast med page+1, så klicket växer
  // listan direkt. Bara för riktiga discover-tabbar (trending paginerar inte).
  const prefetchNextPage = () => {
    if (tab === 'trending') return;
    const nextParams = { ...discoverParams, page: String(page + 1) };
    void queryClient.prefetchQuery({
      queryKey: ['discover', tab, nextParams],
      queryFn: () => (tab === 'movies' ? discoverMovies(nextParams) : discoverTV(nextParams)),
      staleTime: 5 * 60 * 1000,
    });
  };
```

- [ ] **Step 3: Koppla handlern på "Visa fler"-knappen**

På knappen (rad ~195, den med `onClick={() => setPage(p => p + 1)}`), lägg till hover/focus:
```tsx
          onMouseEnter={prefetchNextPage}
          onFocus={prefetchNextPage}
```
(Behåll `onClick` oförändrad.)

- [ ] **Step 4: Typecheck + tester**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Manuell verifiering**

`/discover` → välj en tabb (Filmer/Serier, inte Trending) → DevTools Network → hovra "Visa fler" → ett `/discover/{movie,tv}` med `page=2` ska gå iväg. Klicka → nästa sida visas direkt (datan redan varm).

- [ ] **Step 6: Commit**

```bash
git add src/app/discover/page.tsx
git commit -m "perf(prefetch): prefetcha nästa Utforska-sida på hover av Visa fler

Hovra Visa fler → page+1 hämtas mot samma queryKey som listan, så klicket
växer listan direkt. Bara på intent (hover/focus), bara icke-trending-tabbar,
bara TMDB.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Avslutande verifiering (efter alla tasks)

- [ ] `npm run lint && npm run typecheck && npm test` — allt grönt.
- [ ] Manuell runda i dev med Network-fliken öppen:
  - Hovra titelkort (desktop) → detaljanrop efter ~150 ms; klick → ingen Laddar-skelett.
  - Svep snabbt förbi kort → inga anrop.
  - Touch-emulering: pointerdown → detaljanrop.
  - Serie-sida → säsongsanrop vid mount; avsnittslista direkt.
  - /discover → hovra "Visa fler" → page=2-anrop; klick → instant.
- [ ] Bekräfta att INGA Firestore-anrop tillkommit (Network-filter `firestore` ska vara oförändrat) — prefetch är enbart TMDB.
- [ ] Deploy via push till main; verifiera live med Network-fliken på binge.nu.

### Medvetet INTE i denna plan

- **IntersectionObserver-prefetch av alla synliga kort** — mer kod + risk att prefetcha en hel skärm med kort på en gång (TMDB-tryck). pointerdown (Task 2) täcker mobil-intent billigare. Omvärdera bara om touch-head-starten känns för kort i praktiken.
- **Idle-prefetch av nästa discover-sida på varje sidladdning** — skulle hämta page+1 även när användaren stannar (ett bortkastat anrop per sida). Hover-på-Visa-fler (Task 4) är noll-spill. Byt bara om "Visa fler" oftast ligger under viktlinjen så hover inte hinner ge head-start.
- **Prefetch av rekommendationskaskadens nästa steg** — `useRecommendationsCascade` har egen, mer komplex paginering; egen plan om det visar sig trögt.
