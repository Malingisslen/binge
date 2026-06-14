# Prestanda: runtime-responsivitet + TMDB-trim + bundle-split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit-spärr (viktigt):** repot har en `require-review-before-commit`-hook. Implementer-agenter ska BARA staga (`git add`), ALDRIG committa, och ALDRIG röra `.claude/state/`-markörer. Orkestratorn kör projektets `binge-code-reviewer` (för `src/**.ts(x)`) + `binge-test-reviewer` (för `*.test.ts`), som skriver markörerna, och committar sedan. En WP per commit.

**Goal:** Hålla appen responsiv när biblioteket växer (inkrementell rendering istället för att rita alla titlar på en gång), trimma bort onödig TMDB-fan-out (rådgivaren + rekommendationernas provider-hämtning), och koddela sällan-besökta rutter — utan att lägga till någon betald tjänst eller nytt runtime-beroende.

**Architecture:** Två nya rena primitiver i `src/hooks/` — `useInView` (en IntersectionObserver-wrapper) och `useIncrementalList` (visar de första N, avslöjar fler när en sentinel scrollas in, nollställs vid filter/sortändring). Båda bygger på webbläsarens inbyggda IntersectionObserver (inget npm-tillägg). Rådgivaren får en `enabled`-flagga så den inte fan-out:ar på bibliotekssidor där dess data inte används. Rekommendationsraderna gatear sin provider-hämtning på `inView`. Sällan-rutter wrap:as i `next/dynamic`.

**Tech Stack:** Next.js 16 (static export), React 19, TanStack Query v5, TypeScript, Vitest + @testing-library/react (jsdom). **Inga nya dependencies** — allt bygger på inbyggd `IntersectionObserver` och `next/dynamic`.

**Kostnad:** Sänker driftskostnad (färre TMDB-anrop på kalla laddningar). Ingen Firestore-påverkan. Inga nya tjänster.

---

## Bakgrund / varför (grundat i kodläsning)

Första-laddningens prestanda är redan optimerad (12-tasksplanen + prediktiv prefetch + global prefetch-lyssnare). Det som återstår, verifierat genom att läsa koden:

- **`src/components/WatchlistPage.tsx`** renderar `displayItems.map(...)` rakt av i alla tre vyer (tabell rad 451, rutnät 538, kort 409). Vid 500 titlar = 500 `<tr>`/`<Link>`-noder (tabellen ~4 000 DOM-noder) i en målning. Filtrering re-renderar allt monterat på varje tangenttryck.
- **`useSubscriptionAdvisor`** (`src/components/WatchlistPage.tsx:77`) mountas på ALLA bibliotekssidor men dess output (`unfinishedTmdbIds`/`endedCaughtUpTmdbIds`) används bara när `status === 'mina'` (sektionering på /my/series) eller `behindFilterActive` (som kräver 'mina'). På /my/films, /my/vill-se, /my/avbrutna, /my/all fan-out:ar den TV-detaljqueries i onödan.
- **`useSearchProviders(items)`** anropas i varje `RecRow` (`src/components/recommendations/RecRow.tsx:73`) på mount, ~6 titlar/rad × flera synliga rader ≈ 40+ `watch-providers`-queries vid kall /recommendations-laddning, även för rader långt under viklinjen.
- Sällan-rutter (`/insikter`, `/onboarding`, grupp-inställningsmodal, kollapsade Streamingrådgivar-sektioner) importeras statiskt → ligger i route-chunken även när de inte renderas.

---

## Filstruktur

**Nya filer:**
- `src/hooks/useInView.ts` — IntersectionObserver-primitiv (WP-B2, återanvänds i WP-A1).
- `src/hooks/useInView.test.ts` — test för fallback-beteendet.
- `src/hooks/useIncrementalList.ts` — inkrementell-lista-hook + ren `incrementalSlice`-helper (WP-A1).
- `src/hooks/useIncrementalList.test.ts` — test för `incrementalSlice` + reset.
- `src/hooks/useSubscriptionAdvisor.helpers.ts` — BEFINTLIG; lägg `advisorTmdbIds`-helper (WP-B1).

**Modifierade filer:**
- `src/hooks/useSubscriptionAdvisor.ts` — `enabled`-flagga + använd `advisorTmdbIds` (WP-B1).
- `src/hooks/useSubscriptionAdvisor.helpers.test.ts` — BEFINTLIG (om finns) / annars ny; test för `advisorTmdbIds` (WP-B1).
- `src/components/WatchlistPage.tsx` — gate advisor (WP-B1), memoize counts (WP-A2), inkrementell rendering i tabell/rutnät/flat-kort (WP-A1).
- `src/components/watchlist/FollowingCardSections.tsx` — inkrementell rendering per sektion (WP-A1).
- `src/components/recommendations/RecRow.tsx` — gate `useSearchProviders` på `inView` (WP-B2).
- `src/app/insikter/page.tsx`, `src/app/onboarding/page.tsx`, `src/components/pages/GroupPageClient.tsx`, `src/app/savings/page.tsx` — `next/dynamic` (WP-C1).

**Rekommenderad exekveringsordning** (billigast/lägst risk först; B2 före A1 eftersom A1 återanvänder `useInView`):
WP-B1 → WP-A2 → WP-B2 → WP-A1 → WP-C1 → (WP-C2 valfri).

---

## WP-B1: Gate rådgivaren så den inte fan-out:ar där den inte används

**Mål:** På bibliotekssidor som inte är /my/series (och inte "ligger efter"-filtret) ska rådgivaren inte registrera några TMDB-queries.

### Task B1.1: `advisorTmdbIds`-helper + test

**Files:**
- Modify: `src/hooks/useSubscriptionAdvisor.helpers.ts`
- Modify/Create: `src/hooks/useSubscriptionAdvisor.helpers.test.ts`

- [ ] **Step 1: Skriv failande test**

Lägg i `src/hooks/useSubscriptionAdvisor.helpers.test.ts` (skapa filen om den inte finns, med imports nedan; om den finns, lägg bara till importen av `advisorTmdbIds` och describe-blocket):
```ts
import { describe, it, expect } from 'vitest';
import { advisorTmdbIds } from './useSubscriptionAdvisor.helpers';

describe('advisorTmdbIds', () => {
  const following = [{ tmdbId: 1, mediaType: 'tv' }, { tmdbId: 2, mediaType: 'tv' }] as any;
  const willSee = [{ tmdbId: 2, mediaType: 'tv' }, { tmdbId: 3, mediaType: 'movie' }, { tmdbId: 4, mediaType: 'tv' }] as any;

  it('returnerar tom lista när enabled = false (ingen fan-out)', () => {
    expect(advisorTmdbIds(false, following, willSee)).toEqual([]);
  });
  it('unionar following-TV + vill_se-TV (dedupat), utan film, när enabled', () => {
    expect(advisorTmdbIds(true, following, willSee).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });
});
```

- [ ] **Step 2: Kör → ska faila**

Run: `npx vitest run src/hooks/useSubscriptionAdvisor.helpers.test.ts`
Expected: FAIL — `advisorTmdbIds` finns inte.

- [ ] **Step 3: Implementera helpern**

Lägg till i `src/hooks/useSubscriptionAdvisor.helpers.ts` (matcha filens befintliga importstil; `WatchlistItem` importeras troligen redan — annars `import type { WatchlistItem } from '@/types';`):
```ts
// Vilka tmdb-ids rådgivaren ska hämta TV-detaljer för: following-TV +
// vill_se-TV (filmer har redan providers lagrade). Tom lista när enabled=false
// så useQueries registrerar NOLL queries (ingen TMDB-fan-out) på bibliotekssidor
// där rådgivarens output inte används.
export function advisorTmdbIds(
  enabled: boolean,
  followingTV: WatchlistItem[],
  willSeeItems: WatchlistItem[],
): number[] {
  if (!enabled) return [];
  return Array.from(new Set([
    ...followingTV.map(i => i.tmdbId),
    ...willSeeItems.filter(i => i.mediaType === 'tv').map(i => i.tmdbId),
  ]));
}
```

- [ ] **Step 4: Kör → ska passera**

Run: `npx vitest run src/hooks/useSubscriptionAdvisor.helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**
```bash
git add src/hooks/useSubscriptionAdvisor.helpers.ts src/hooks/useSubscriptionAdvisor.helpers.test.ts
```

### Task B1.2: `enabled`-flagga i hooken + gate i WatchlistPage

**Files:**
- Modify: `src/hooks/useSubscriptionAdvisor.ts`
- Modify: `src/components/WatchlistPage.tsx`

- [ ] **Step 1: Lägg enabled-param i hooken**

I `src/hooks/useSubscriptionAdvisor.ts`:
- Lägg importen av helpern till den befintliga re-export/import-raden (rad 13–23-blocket importerar redan från `./useSubscriptionAdvisor.helpers`): lägg `advisorTmdbIds,` i den importlistan.
- Ändra signaturen (rad 41) till:
```ts
export function useSubscriptionAdvisor(
  lookAheadDays = 60,
  options?: { enabled?: boolean },
): AdvisorResult {
  const enabled = options?.enabled ?? true;
  const { getByStatus, loading: watchlistLoading } = useWatchlist();
```
- Ersätt `tmdbIds`-memon (rad 62–68) med:
```ts
  const tmdbIds = useMemo(
    () => advisorTmdbIds(enabled, followingTV, willSeeItems),
    [enabled, followingTV, willSeeItems]
  );
```
- Ändra `isLoading`-raden (rad 87) så att ett avstängt råd inte rapporterar laddning:
```ts
  const isLoading = enabled ? aggregateAdvisorLoading(watchlistLoading, showQueries) : false;
```
(Allt annat oförändrat. När `tmdbIds` är `[]` registrerar `useQueries` noll queries → ingen fetch. `computed` returnerar tomma `unfinishedTmdbIds`/`endedCaughtUpTmdbIds` eftersom `shows` är tom.)

- [ ] **Step 2: Gate anropet i WatchlistPage**

I `src/components/WatchlistPage.tsx`, rad 77, ersätt:
```tsx
  const advisor = useSubscriptionAdvisor();
```
med:
```tsx
  // Rådgivaren behövs bara på /my/series ('mina'): för sub-state-sektionering
  // och "ligger efter"-filtret. På övriga bibliotekssidor används dess output
  // inte — gate så den inte fan-out:ar TV-detaljqueries i onödan.
  const advisor = useSubscriptionAdvisor(60, { enabled: status === 'mina' });
```

- [ ] **Step 3: Verifiera**

Run: `npm run typecheck && npm test`
Expected: PASS. (SavingsPage anropar `useSubscriptionAdvisor(LOOK_AHEAD_DAYS)` utan options → enabled defaultar true → oförändrat beteende.)

- [ ] **Step 4: Stage**
```bash
git add src/hooks/useSubscriptionAdvisor.ts src/components/WatchlistPage.tsx
```

### Task B1.3: Granskning + commit (orkestratorn)
- [ ] Kör `binge-code-reviewer` (src) + `binge-test-reviewer` (helpers.test). Vid grönt:
```bash
git commit -m "perf(library): gate streamingrådgivaren till /my/series — ingen TMDB-fan-out på övriga bibliotekssidor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## WP-A2: Memoize biblioteks-räknarna (sluta skanna hela listan på varje render)

**Mål:** `totalCount`, `tvVisibleCount` och `tvTotalCount` skannar hela `items`/`filtered` utanför memo på varje render (rad 159–203) — sker på varje tangenttryck i sökrutan. Härled dem inom `useMemo`.

**Files:**
- Modify: `src/components/WatchlistPage.tsx`

- [ ] **Step 1: Ersätt de omemoiserade räknarna**

I `src/components/WatchlistPage.tsx`, ersätt blocket på rad 159–161:
```tsx
  const totalCount = status
    ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)).length
    : items.length;
```
med:
```tsx
  const totalCount = useMemo(
    () => status
      ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)).length
      : items.length,
    [items, status]
  );
```

Och ersätt blocket på rad 200–203:
```tsx
  const tvVisibleCount = filtered.filter(i => i.mediaType === 'tv').length;
  const tvTotalCount = items.filter(
    i => i.status === 'mina' && !i.dropped && i.mediaType === 'tv'
  ).length;
```
med:
```tsx
  const tvVisibleCount = useMemo(
    () => filtered.filter(i => i.mediaType === 'tv').length,
    [filtered]
  );
  const tvTotalCount = useMemo(
    () => items.filter(i => i.status === 'mina' && !i.dropped && i.mediaType === 'tv').length,
    [items]
  );
```
(`useMemo` importeras redan på rad 3.)

- [ ] **Step 2: Verifiera**

Run: `npm run typecheck && npm test`
Expected: PASS (ren refaktor — samma värden, färre skanningar per render).

- [ ] **Step 3: Stage + granskning + commit**
```bash
git add src/components/WatchlistPage.tsx
```
Kör `binge-code-reviewer`. Vid grönt:
```bash
git commit -m "perf(library): memoize biblioteks-räknarna (sluta skanna hela listan per render/tangenttryck)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## WP-B2: `useInView` + defer rekommendationernas provider-hämtning

**Mål:** En återanvändbar `useInView`-primitiv, och `RecRow` hämtar providers först när raden är nära viklinjen — så kall /recommendations-laddning bara fan-out:ar synliga rader.

### Task B2.1: `useInView`-hook + test

**Files:**
- Create: `src/hooks/useInView.ts`
- Create: `src/hooks/useInView.test.ts`

- [ ] **Step 1: Skriv failande test**

`src/hooks/useInView.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInView } from './useInView';

describe('useInView', () => {
  it('faller tillbaka på inView=true när IntersectionObserver saknas och en nod fästs (jsdom/SSR)', () => {
    const orig = (globalThis as any).IntersectionObserver;
    // jsdom saknar IntersectionObserver — säkerställ att den är borta.
    delete (globalThis as any).IntersectionObserver;
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    // callback-ref:en triggar effekten när noden fästs; utan IO → inView=true.
    act(() => { result.current.ref(document.createElement('div')); });
    expect(result.current.inView).toBe(true);
    if (orig) (globalThis as any).IntersectionObserver = orig;
  });
});
```

- [ ] **Step 2: Kör → ska faila**

Run: `npx vitest run src/hooks/useInView.test.ts`
Expected: FAIL — `useInView` finns inte.

- [ ] **Step 3: Implementera**

`src/hooks/useInView.ts`:
```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * IntersectionObserver-primitiv. Returnerar en CALLBACK-ref att fästa på ett
 * element (`<div ref={ref} />`) och en `inView`-boolean. Callback-ref:en gör att
 * observern återkopplas om det observerade elementet byts ut (t.ex. när
 * biblioteket växlar tabell↔rutnät och sentineln blir en ny DOM-nod) — en vanlig
 * objekt-ref skulle fortsätta observera den gamla, avmonterade noden.
 *
 * Med `once: true` slår den om till true första gången elementet syns och kopplar
 * sedan loss (stannar true). Utan `once` speglar den synligheten löpande.
 *
 * Fallback: i miljöer utan IntersectionObserver (jsdom-tester, ev. äldre SSR-
 * path) antas elementet synligt (inView=true) när en nod fästs, så innehåll
 * aldrig döljs.
 */
export function useInView<T extends Element>(
  options?: { rootMargin?: string; once?: boolean },
): { ref: (node: T | null) => void; inView: boolean } {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((n: T | null) => setNode(n), []);
  const rootMargin = options?.rootMargin ?? '0px';
  const once = options?.once ?? false;

  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, rootMargin, once]);

  return { ref, inView };
}
```

- [ ] **Step 4: Kör → ska passera**

Run: `npx vitest run src/hooks/useInView.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**
```bash
git add src/hooks/useInView.ts src/hooks/useInView.test.ts
```

### Task B2.2: Gate `useSearchProviders` på inView i RecRow

**Files:**
- Modify: `src/components/recommendations/RecRow.tsx`

- [ ] **Step 1: Wire useInView + gate provider-hämtningen**

I `src/components/recommendations/RecRow.tsx`:
- Lägg importen efter rad 6:
```tsx
import { useInView } from '@/hooks/useInView';
```
- I komponenten, ersätt rad 73:
```tsx
  const providerMap = useSearchProviders(items);
```
med:
```tsx
  // Hämta providers först när raden är ~300px från viklinjen — annars fan-out:ar
  // /recommendations watch-providers för varje rad direkt vid mount (~6×rader).
  // once: behåll laddat när raden scrollats förbi.
  const { ref: rowRef, inView } = useInView<HTMLElement>({ rootMargin: '300px', once: true });
  const providerMap = useSearchProviders(inView ? items : []);
```
- Fäst `rowRef` på `<section>`-elementet (rad 82). Ändra:
```tsx
    <section className="rec-cat" aria-labelledby={`rec-cat-${rowSpec.rowKey}`}>
```
till:
```tsx
    <section ref={rowRef} className="rec-cat" aria-labelledby={`rec-cat-${rowSpec.rowKey}`}>
```

(`useSearchProviders([])` → noll queries; korten renderar utan provider-prickar tills raden syns, sedan fylls de i. RecCard tål tom `providers`-array — den defaultar redan `?? []` på rad 106.)

- [ ] **Step 2: Verifiera**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Stage + granskning + commit**
```bash
git add src/hooks/useInView.ts src/hooks/useInView.test.ts src/components/recommendations/RecRow.tsx
```
Kör `binge-code-reviewer` (src) + `binge-test-reviewer` (useInView.test). Vid grönt:
```bash
git commit -m "perf(rec): defer rekommendationsradernas provider-hämtning tills raden syns (useInView)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## WP-A1: Inkrementell rendering av bibliotekslistorna

**Mål:** Rita de första ~100 titlarna; avslöja fler när en sentinel scrollas in. Nollställ till 100 vid filter-/sortändring så sökning aldrig re-renderar mer än ~100 noder. Gäller tabell, rutnät, flat-kort OCH /my/series-sektionerna.

### Task A1.1: `useIncrementalList` + `incrementalSlice` + test

**Files:**
- Create: `src/hooks/useIncrementalList.ts`
- Create: `src/hooks/useIncrementalList.test.ts`

- [ ] **Step 1: Skriv failande test**

`src/hooks/useIncrementalList.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { incrementalSlice } from './useIncrementalList';

describe('incrementalSlice', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  it('kapar visible till count och flaggar hasMore', () => {
    const r = incrementalSlice(items, 100);
    expect(r.visible).toHaveLength(100);
    expect(r.visible[0]).toBe(0);
    expect(r.visible[99]).toBe(99);
    expect(r.hasMore).toBe(true);
  });
  it('hasMore=false när count täcker hela listan', () => {
    const r = incrementalSlice(items, 250);
    expect(r.visible).toHaveLength(250);
    expect(r.hasMore).toBe(false);
  });
  it('hanterar count > length utan att spilla', () => {
    const r = incrementalSlice([1, 2, 3], 100);
    expect(r.visible).toEqual([1, 2, 3]);
    expect(r.hasMore).toBe(false);
  });
});
```

- [ ] **Step 2: Kör → ska faila**

Run: `npx vitest run src/hooks/useIncrementalList.test.ts`
Expected: FAIL — `incrementalSlice` finns inte.

- [ ] **Step 3: Implementera**

`src/hooks/useIncrementalList.ts`:
```ts
'use client';

import { useEffect, useState } from 'react';
import { useInView } from './useInView';

export function incrementalSlice<T>(items: T[], count: number): { visible: T[]; hasMore: boolean } {
  return { visible: items.slice(0, count), hasMore: count < items.length };
}

/**
 * Inkrementell rendering för långa listor utan extern beroende. Visar de första
 * `initial` posterna; när `sentinelRef`-elementet scrollas in (inom rootMargin)
 * höjs antalet med `step`. Nollställs till `initial` när `items`-referensen
 * ändras (filter/sortering) — så en sökning aldrig re-renderar mer än `initial`
 * noder. I jsdom/utan IntersectionObserver blir inView=true direkt → hela listan
 * visas (korrekt för tester; ingen windowing att verifiera där).
 */
export function useIncrementalList<T>(
  items: T[],
  opts?: { initial?: number; step?: number },
): { visible: T[]; hasMore: boolean; sentinelRef: (node: HTMLDivElement | null) => void } {
  const initial = opts?.initial ?? 100;
  const step = opts?.step ?? 60;
  const [count, setCount] = useState(initial);
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({ rootMargin: '600px' });

  // Nollställ när listan byter identitet (filter/sortering/statusbyte).
  useEffect(() => {
    setCount(initial);
  }, [items, initial]);

  // Avslöja fler medan sentineln syns och det finns mer kvar.
  useEffect(() => {
    if (inView && count < items.length) {
      setCount(c => Math.min(items.length, c + step));
    }
  }, [inView, count, items.length, step]);

  const { visible, hasMore } = incrementalSlice(items, count);
  return { visible, hasMore, sentinelRef };
}
```

- [ ] **Step 4: Kör → ska passera**

Run: `npx vitest run src/hooks/useIncrementalList.test.ts`
Expected: PASS.

- [ ] **Step 5: Stage**
```bash
git add src/hooks/useIncrementalList.ts src/hooks/useIncrementalList.test.ts
```

### Task A1.2: Inkrementell rendering i WatchlistPage (tabell/rutnät/flat-kort)

**Files:**
- Modify: `src/components/WatchlistPage.tsx`

- [ ] **Step 1: Importera + härled visible-listan**

I `src/components/WatchlistPage.tsx`:
- Lägg importen nära de andra hook-importerna:
```tsx
import { useIncrementalList } from '@/hooks/useIncrementalList';
```
- Direkt EFTER `displayItems`-memon (efter rad 188), lägg:
```tsx
  // Inkrementell rendering: rita ~100 åt gången, avslöja fler vid scroll.
  // Nollställs vid filter/sortering (displayItems byter referens) så sökning
  // aldrig re-renderar hela biblioteket. Markeringslogik (select-all m.m.)
  // jobbar fortfarande mot hela displayItems — bara renderingen kapas.
  const { visible: visibleItems, hasMore, sentinelRef } = useIncrementalList(displayItems);
```

- [ ] **Step 2: Tabellvyn — rendera visibleItems + sentinel**

I tabellvyn, ändra `displayItems.map((item, idx) => {` (rad 451) till `visibleItems.map((item, idx) => {`.
Direkt EFTER den stängande `</table>`-taggen och dess wrapper-`</div>` (rad 533–534), lägg sentineln innan blocket stängs. Konkret: byt raderna
```tsx
          </table>
        </div>
      ) : (
```
mot
```tsx
          </table>
        </div>
        {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
        </>
      ) : (
```
och öppna motsvarande fragment: byt tabellvyns inledande
```tsx
      ) : view === 'table' ? (
        <div className="bg-surface border border-border-main rounded-sm overflow-x-auto">
```
mot
```tsx
      ) : view === 'table' ? (
        <>
        <div className="bg-surface border border-border-main rounded-sm overflow-x-auto">
```
(`tbody`-empty-state-raden behåller `displayItems.length === 0` — den oförändrad; vid 0 poster finns ingen sentinel eftersom hasMore=false.)

- [ ] **Step 3: Rutnätsvyn — rendera visibleItems + sentinel**

I rutnätsvyn (det avslutande `: (`-blocket, rad 535–571), ändra `displayItems.map(item => {` (rad 538) till `visibleItems.map(item => {`.
Lägg sentineln direkt efter den inre grid-`</div>` (efter rad 562, före legend-`<p>`):
```tsx
            })}
          </div>
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
```
(Behåll `displayItems.length === 0`/`displayItems.length > 0`-villkoren för empty-state och legend — de gäller hela listan.)

- [ ] **Step 4: Flat-kort-vyn (icke-'mina') — rendera visibleItems + sentinel**

I kort-vyns `else`-gren (rad 407–422, när `followingSections` är null), ändra `displayItems.map(item => (` (rad 409) till `visibleItems.map(item => (` och lägg sentineln direkt efter listan, före empty-state:
```tsx
            ))}
            {hasMore && <div ref={sentinelRef} aria-hidden className="col-span-full h-px" />}
            {displayItems.length === 0 && (
```
(/my/series-kortvyn använder `FollowingCardSections` — den hanteras i Task A1.3. `visibleItems`/`sentinelRef` delas mellan tabell/rutnät/flat-kort; bara en vy är monterad åt gången så samma ref återanvänds säkert.)

- [ ] **Step 5: Verifiera**

Run: `npm run typecheck && npm test`
Expected: PASS. Manuellt (valfritt i dev): på en stor `/my/all` ska bara ~100 rader/celler finnas i DOM tills man scrollar.

- [ ] **Step 6: Stage**
```bash
git add src/components/WatchlistPage.tsx
```

### Task A1.3: Inkrementell rendering per sektion i FollowingCardSections

**Files:**
- Modify: `src/components/watchlist/FollowingCardSections.tsx`

- [ ] **Step 1: Bryt ut en CardSection-kropp som använder hooken**

I `src/components/watchlist/FollowingCardSections.tsx`:
- Lägg importen:
```tsx
import { useIncrementalList } from '@/hooks/useIncrementalList';
```
- Lägg en intern komponent (ovanför `FollowingCardSections`) som renderar en sektions kort inkrementellt:
```tsx
function SectionGrid({
  items,
  nextAirByTmdbId,
  subState,
}: {
  items: WatchlistItem[];
  nextAirByTmdbId: Map<number, string>;
  subState: LibrarySubState;
}) {
  const { visible, hasMore, sentinelRef } = useIncrementalList(items);
  return (
    <>
      <div className={CARD_GRID_CLASS}>
        {visible.map(item => (
          <WatchlistCard
            key={item.tmdbId}
            item={item}
            nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
            subState={subState}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </>
  );
}
```

- [ ] **Step 2: Använd SectionGrid i båda sektionsgrenarna**

Ersätt den inre grid:en i `avslutad`-grenen (rad 88–98) — byt blocket
```tsx
              {avslutadOpen && (
                <div className={CARD_GRID_CLASS}>
                  {items.map(item => (
                    <WatchlistCard
                      key={item.tmdbId}
                      item={item}
                      nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                      subState={key}
                    />
                  ))}
                </div>
              )}
```
mot
```tsx
              {avslutadOpen && (
                <SectionGrid items={items} nextAirByTmdbId={nextAirByTmdbId} subState={key} />
              )}
```

Och ersätt den vanliga sektionens grid (rad 112–121) — byt blocket
```tsx
            <div className={CARD_GRID_CLASS}>
              {items.map(item => (
                <WatchlistCard
                  key={item.tmdbId}
                  item={item}
                  nextAirDate={nextAirByTmdbId.get(item.tmdbId)}
                  subState={key}
                />
              ))}
            </div>
```
mot
```tsx
            <SectionGrid items={items} nextAirByTmdbId={nextAirByTmdbId} subState={key} />
```
(`LibrarySubState` importeras redan via `type LibrarySubState` på rad 8.)

- [ ] **Step 3: Verifiera**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Stage + granskning + commit**
```bash
git add src/hooks/useIncrementalList.ts src/hooks/useIncrementalList.test.ts src/components/WatchlistPage.tsx src/components/watchlist/FollowingCardSections.tsx
```
Kör `binge-code-reviewer` (src) + `binge-test-reviewer` (useIncrementalList.test). Vid grönt:
```bash
git commit -m "perf(library): inkrementell rendering av bibliotekslistor (tabell/rutnät/kort/sektioner)

Rita ~100 titlar åt gången, avslöja fler vid scroll, nollställ vid filter/sort.
Kapar DOM-tryck + filtreringsjank för stora bibliotek. Inget nytt beroende —
inbyggd IntersectionObserver via useInView/useIncrementalList.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## WP-C1: Koddela sällan-besökta rutter

**Mål:** Flytta admin-/sällan-komponenter ur initial route-chunk med `next/dynamic` (ssr:false — det är ändå en client-export-SPA).

### Task C1.1: Insikter + Onboarding (sidnivå)

**Files:**
- Modify: `src/app/insikter/page.tsx`
- Modify: `src/app/onboarding/page.tsx`

- [ ] **Step 1: Insikter**

Ersätt `src/app/insikter/page.tsx` rad 2 + 11–13:
```tsx
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

const InsikterClient = dynamic(() => import('./InsikterClient'), { ssr: false });

export const metadata: Metadata = {
  title: 'Insikter (internt) — Binge',
  robots: { index: false, follow: false },
};

export default function InsikterPage() {
  return <InsikterClient />;
}
```
(Behåll `export const metadata` exakt som i originalet.)

- [ ] **Step 2: Onboarding**

Ersätt `src/app/onboarding/page.tsx` helt:
```tsx
'use client';

import dynamic from 'next/dynamic';
import AuthGuard from '@/components/AuthGuard';

const OnboardingFlow = dynamic(
  () => import('@/components/onboarding/OnboardingFlow').then(m => m.OnboardingFlow),
  { ssr: false },
);

export default function OnboardingPage() {
  return (
    <AuthGuard>
      <OnboardingFlow />
    </AuthGuard>
  );
}
```

- [ ] **Step 3: Verifiera**

Run: `npm run build`
Expected: bygget lyckas; `/insikter` och `/onboarding` finns kvar i exporten. (Kör hela `npm run build` eftersom dynamic-importer bara verifieras vid build/export — `typecheck` ensam räcker inte.)

- [ ] **Step 4: Stage**
```bash
git add src/app/insikter/page.tsx src/app/onboarding/page.tsx
```

### Task C1.2: GroupSettingsModal (renderas bara vid ägar-interaktion)

**Files:**
- Modify: `src/components/pages/GroupPageClient.tsx`

- [ ] **Step 1: Dynamisk import av modalen**

I `src/components/pages/GroupPageClient.tsx`:
- Ta bort den statiska importen på rad 22 (`import { GroupSettingsModal } from '@/components/groups/GroupSettingsModal';`).
- Lägg överst bland importerna:
```tsx
import dynamic from 'next/dynamic';
```
- Lägg efter import-blocket (modulnivå, utanför komponenten):
```tsx
const GroupSettingsModal = dynamic(
  () => import('@/components/groups/GroupSettingsModal').then(m => m.GroupSettingsModal),
  { ssr: false },
);
```
(Renderingen på rad ~262 är oförändrad. Modalen renderas villkorligt vid ägar-interaktion, så chunken hämtas först då.)

- [ ] **Step 2: Verifiera**

Run: `npm run build`
Expected: bygget lyckas.

- [ ] **Step 3: Stage**
```bash
git add src/components/pages/GroupPageClient.tsx
```

### Task C1.3: Streamingrådgivarens "Mer detaljer"-sektioner (lazy + gate på open)

**Files:**
- Modify: `src/app/savings/page.tsx`

`AdvisorTimeline` + `WillSeePerProvider` ligger i ett `<details>` (kollapsat default) men monteras ändå direkt. Lazy-importera dem OCH rendera dem först när `<details>` öppnats, så chunken + deras arbete inte sker på sidladdning.

- [ ] **Step 1: Lazy-importera + gate på open-state**

I `src/app/savings/page.tsx`:
- Lägg överst:
```tsx
import dynamic from 'next/dynamic';
```
- Ta bort de statiska importerna på rad 8 (`AdvisorTimeline`) och rad 14 (`WillSeePerProvider`).
- Lägg modulnivå-konstanter (efter import-blocket):
```tsx
const AdvisorTimeline = dynamic(() => import('@/components/savings/AdvisorTimeline'), { ssr: false });
const WillSeePerProvider = dynamic(() => import('@/components/savings/WillSeePerProvider'), { ssr: false });
```
- I `SavingsContent`, lägg en open-state och koppla den till `<details>`. Ändra `<details ref={detailsRef} ...>` (rad 242) så att den styr render: lägg först
```tsx
  const [detailsOpen, setDetailsOpen] = useState(false);
```
(lägg `useState` till React-importen på rad 3: `import { useEffect, useRef, useState } from 'react';`)
och i `handleShowSubscribeRows` (rad 154–159) sätt även state:
```tsx
  const handleShowSubscribeRows = () => {
    const el = detailsRef.current;
    if (!el) return;
    el.open = true;
    setDetailsOpen(true);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
```
- Ändra `<details>`-elementet (rad 242) till att uppdatera state på toggle:
```tsx
            <details
              ref={detailsRef}
              className="mb-3 scroll-mt-3 mt-3"
              onToggle={e => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
```
- Gate de tunga komponenterna inuti på `detailsOpen` — ändra raden `<AdvisorTimeline />` + `<WillSeePerProvider rows={advisor.willSeeByProvider} />` (rad 247–248) till:
```tsx
                {detailsOpen && <AdvisorTimeline />}
                {detailsOpen && <WillSeePerProvider rows={advisor.willSeeByProvider} />}
```
(Resten av `<details>`-innehållet — SubscribeRowTable m.m. — kan stå kvar oförändrat; det är lättviktigt.)

- [ ] **Step 2: Verifiera**

Run: `npm run build`
Expected: bygget lyckas. Beteende: "Mer detaljer" öppnar som förut; tidslinjen + per-provider-listan laddas/renderas först vid öppning.

- [ ] **Step 3: Stage + granskning + commit**
```bash
git add src/app/insikter/page.tsx src/app/onboarding/page.tsx src/components/pages/GroupPageClient.tsx src/app/savings/page.tsx
```
Kör `binge-code-reviewer`. Vid grönt:
```bash
git commit -m "perf(bundle): koddela sällan-rutter (insikter/onboarding/grupp-modal) + lazy:a Streamingrådgivarens detaljsektioner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## WP-C2 (VALFRI — ingen prestandavinst, ren housekeeping)

~49 `font-family: var(--mono)`-deklarationer i `src/app/globals.css` pekar på `--mono` som numera aliasar `--sans`. Noll runtime-kostnad (ingen extra font laddas). **Detta hör inte hemma i en prestanda-runda** — ta det separat som städning om det är önskvärt. Om det ändå görs: mekaniskt ersätt `var(--mono)` → `var(--sans)` i `globals.css` (noll-risk, visuellt identiskt), `npm run build`, commit. Lämnas medvetet ute ur exekveringsordningen ovan.

---

## Slutverifiering (efter alla WP)

- [ ] `npm run lint && npm run typecheck && npm test` — allt grönt.
- [ ] `npm run build` — exporten lyckas (verifierar alla `next/dynamic`-splittar).
- [ ] Push → deploy (hosting). Inga firestore.rules/functions rörda → drift-guarden släpper igenom.
- [ ] Live-rök (inloggad): på en stor `/my/all`, bekräfta i DevTools att DOM-noderna börjar ~100 och växer vid scroll; på `/recommendations`, bekräfta i Network att `watch-providers`-anrop fyrar per rad vid scroll, inte alla på en gång; på `/my/films`, bekräfta att inga `tv-lite`-anrop fyras från rådgivaren (gated).

---

## Självgranskning (mot specen)

1. **A (responsivitet):** Inkrementell rendering täcker tabell + rutnät + flat-kort (Task A1.2) + /my/series-sektioner (Task A1.3); nollställning vid filter/sort löser filtreringsjank; räknar-memoisering (WP-A2) tar bort per-tangenttryck-skanningarna. ✅
2. **B (TMDB-trim):** Rådgivaren gated till /my/series (WP-B1); rec-providers deferade till inView (WP-B2). ✅
3. **C (bundle):** Insikter/Onboarding/GroupSettingsModal/Streamingrådgivar-detaljer koddelade (WP-C1); --mono noterad som valfri icke-perf-städning (WP-C2). ✅
4. **Inga nya beroenden / tjänster:** allt på inbyggd IntersectionObserver + next/dynamic. ✅
5. **Typkonsistens:** `useInView<T>()→{ref:(node)=>void, inView}` (callback-ref); `useIncrementalList<T>(items,opts)→{visible,hasMore,sentinelRef:(node)=>void}`; `incrementalSlice(items,count)→{visible,hasMore}`; `advisorTmdbIds(enabled,following,willSee)→number[]`; `useSubscriptionAdvisor(days, {enabled})`. Callback-refs fästs identiskt i JSX (`ref={sentinelRef}`), så konsument-JSX är oförändrad. Alla anrop matchar signaturerna. ✅
6. **Inga platshållare:** all kod komplett. ✅

### Medvetet INTE i denna plan
- **Äkta virtualisering (react-window/react-virtual):** inkrementell rendering ger merparten av vinsten utan nytt beroende eller layoutstrid med responsiv CSS-grid/tabell/sektioner. Omvärdera bara om mätning visar att stora, helt-nedscrollade listor fortfarande hackar.
- **Kalender-fan-out-gating på bibliotekssidor:** `useCalendarEntries` mountas också brett, men dess `nextAirByTmdbId` används av kort-vyerna — gating kräver mer noggrann scoping; eget spår om det visar sig dyrt.
- **`getByStatus`-referensändring → advisor-omräkning vid varje snapshot:** medium insats, smal nytta (bara vid täta Firestore-writes); separat spår.
