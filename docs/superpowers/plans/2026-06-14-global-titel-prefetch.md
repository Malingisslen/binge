# Global titel-prefetch (delegerad intent-lyssnare) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit-spärr (viktigt):** repot har en `require-review-before-commit`-hook. Implementer-agenter ska BARA staga (`git add`), ALDRIG committa, och ALDRIG röra `.claude/state/`-markörer. Orkestratorn kör projektets `binge-code-reviewer` (för `src/**.ts(x)`) + `binge-test-reviewer` (för `*.test.ts`), som skriver markörerna, och committar sedan.

**Goal:** Ersätt den per-kort-wirade hover-prefetchen med EN global, delegerad intent-lyssnare som prefetchar valfri titellänk (`/movie/:id`, `/tv/:id`) i hela appen — på hover-intent, touch och tangentbordsfokus — så att varje yta (TitleCard, RecCard, kalendern, brödsmulor, framtida kort) får snabb navigation utan per-komponent-kod.

**Architecture:** En `useTitleLinkPrefetch()`-hook monteras EN gång i `AppShell` och sätter document-delegerade lyssnare (`pointerover`/`pointerdown`/`focusin`). När intent landar på ett `<a>` vars pathname matchar `/movie/:id` eller `/tv/:id` läses typ+id ur länken och `queryClient.prefetchQuery(titlePrefetchSpec(...))` körs mot SAMMA queryKey som detaljsidan (dedupas av staleTime, strypt av TMDB-klientens 8-concurrent-semafor). Den per-kort-wirade `usePrefetchTitle` i TitleCard blir överflödig och tas bort.

**Tech Stack:** Next.js 16 (static export), React 19, TanStack Query v5, TypeScript, Vitest.

**Kostnad:** Oförändrad — bara TMDB-anrop (gratis API), ingen Firestore. Respekterar dessutom data-sparläge (`navigator.connection.saveData`) → hoppar prefetch helt då. Hover-intent (150 ms) + staleTime-dedup + 8-semaforen håller TMDB-trycket nere.

**Bakgrund / varför:** Hover-prefetchen byggdes först in i `TitleCard` (committat, live, bevisat fungerande). Men appen har fler kort/länk-ytor (RecCard i rekommendations-raderna, ev. kalender/karuseller) som då missades. Att wira varje kort för sig är repetitivt och lätt att glömma. En delegerad lyssnare keyad på länkens href täcker ALLA titellänkar automatiskt — nuvarande och framtida — och är netto mindre kod.

**Viktiga repo-regler:**
- Svensk UI-text, inga hex-färger, `danger`-tokens för fel.
- `npm run typecheck` + `npm test` (lokalt `tsc` ej på PATH — använd `npm run typecheck`; enskild testfil: `npx vitest run <fil>`).
- Det finns ev. ocommittat arbete från annat håll i arbetsträdet — RÖR INTE filer utanför din task, scoped:a `git add`.

**Designprinciper (gäller hela planen):**
- **Href är sanningen.** `/movie/603/` säger både typ och id. Lyssnaren läser `anchor.pathname` (hanterar relativa + absoluta länkar, strippar query) och parsar den.
- **Intent, inte allt.** Hover → 150 ms-fördröjning innan prefetch (sveps-förbi filtreras). Touch (`pointerdown`) + tangentbord (`focusin`) → direkt (trycket/fokus ÄR intenten).
- **Dedup gratis.** `prefetchQuery` med samma `staleTime` som detaljsidan är en no-op om datan är färsk.
- **Snäll medborgare.** Hoppa prefetch helt i data-sparläge.

---

## Filstruktur

- **Modify:** `src/lib/tmdb/prefetch.ts` — lägg ren helper `parseTitleHref(path)`.
- **Modify:** `src/lib/tmdb/prefetch.test.ts` — tester för `parseTitleHref`.
- **Create:** `src/hooks/useTitleLinkPrefetch.ts` — den globala delegerade lyssnaren.
- **Modify:** `src/components/layout/AppShell.tsx` — montera hooken en gång.
- **Modify:** `src/components/title/TitleCard.tsx` — ta bort den nu överflödiga per-kort-wiringen.
- **Delete:** `src/hooks/usePrefetchTitle.ts` — ersatt av den globala lyssnaren.

`titlePrefetchSpec`, `currentSeasonToPrefetch`, `seasonPrefetchSpec` i `prefetch.ts` BEHÅLLS (säsongs-prefetchen på TV-sidan + nästa-sida-prefetchen på Utforska är separata och rörs inte).

---

### Task 1: `parseTitleHref`-helper + tester

**Files:**
- Modify: `src/lib/tmdb/prefetch.ts`
- Modify: `src/lib/tmdb/prefetch.test.ts`

- [ ] **Step 1: Failande test**

I `src/lib/tmdb/prefetch.test.ts`, lägg `parseTitleHref` i importen på rad 2:
```ts
import { titlePrefetchSpec, currentSeasonToPrefetch, parseTitleHref } from './prefetch';
```
och lägg ett nytt describe-block sist (före sista `});` på filnivå — alltså som ett eget toppnivå-block):
```ts
describe('parseTitleHref', () => {
  it('parsar movie- och tv-pathnames (med och utan trailing slash)', () => {
    expect(parseTitleHref('/movie/603/')).toEqual({ mediaType: 'movie', id: 603 });
    expect(parseTitleHref('/movie/603')).toEqual({ mediaType: 'movie', id: 603 });
    expect(parseTitleHref('/tv/1399/')).toEqual({ mediaType: 'tv', id: 1399 });
  });
  it('returnerar null för icke-titellänkar', () => {
    expect(parseTitleHref('/person/5/')).toBeNull();
    expect(parseTitleHref('/user/malin')).toBeNull();
    expect(parseTitleHref('/my/series/')).toBeNull();
    expect(parseTitleHref('/movies/5')).toBeNull();   // "movies" != "movie"
    expect(parseTitleHref('/movie/abc')).toBeNull();   // icke-numeriskt id
    expect(parseTitleHref('/')).toBeNull();
  });
});
```

- [ ] **Step 2: Kör → ska faila**

Run: `npx vitest run src/lib/tmdb/prefetch.test.ts`
Expected: FAIL — `parseTitleHref` finns inte.

- [ ] **Step 3: Implementera i `src/lib/tmdb/prefetch.ts`**

Lägg till (t.ex. efter `titlePrefetchSpec`), och säkerställ att `MediaType` redan importeras i filen (det gör den — `import type { MediaType, ... } from '@/types'`):
```ts
// Parsar en titellänks pathname → { mediaType, id } för /movie/:id och /tv/:id.
// Returnerar null för allt annat (/person, /user, /my/*, okända paths). Anchor-
// pathname strippar query, så /movie/603/?fromGroup=x kommer in som /movie/603/.
export function parseTitleHref(path: string): { mediaType: MediaType; id: number } | null {
  const m = path.match(/^\/(movie|tv)\/(\d+)(?:\/|$)/);
  if (!m) return null;
  return { mediaType: m[1] as MediaType, id: Number(m[2]) };
}
```

- [ ] **Step 4: Kör → ska passera**

Run: `npx vitest run src/lib/tmdb/prefetch.test.ts`
Expected: PASS (alla, inkl. de nya parseTitleHref-testerna).

- [ ] **Step 5: Stage (INTE commit)**
```bash
git add src/lib/tmdb/prefetch.ts src/lib/tmdb/prefetch.test.ts
git status --short
```

---

### Task 2: `useTitleLinkPrefetch`-hook + montera i AppShell

**Files:**
- Create: `src/hooks/useTitleLinkPrefetch.ts`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Skapa hooken `src/hooks/useTitleLinkPrefetch.ts`**

```ts
'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseTitleHref, titlePrefetchSpec } from '@/lib/tmdb/prefetch';

// ~150 ms hover innan vi tror på "intent" — sveps-förbi-länkar filtreras bort.
const HOVER_INTENT_MS = 150;

// Data-sparläge → hoppa prefetch helt (snäll mot mätabonnemang).
function saveDataOn(): boolean {
  try {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return c?.saveData === true;
  } catch {
    return false;
  }
}

/**
 * Global, delegerad prefetch-på-intent för ALLA titellänkar (/movie/:id, /tv/:id)
 * i appen — oavsett vilken komponent som ritar länken. Monteras EN gång (AppShell).
 *
 * - pointerover: starta 150 ms hover-intent-timer för länken; byter man länk
 *   eller lämnar den nollställs timern. Efter 150 ms → prefetcha.
 * - pointerdown: prefetcha direkt (touch/klick = omedelbar intent).
 * - focusin: prefetcha direkt (tangentbordsnavigation = intent).
 *
 * Prefetchen träffar SAMMA queryKey som detaljsidan (titlePrefetchSpec), dedupas
 * av staleTime och stryps av TMDB-klientens 8-concurrent-semafor. Bara TMDB,
 * ingen Firestore. Hoppas helt i data-sparläge.
 */
export function useTitleLinkPrefetch(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingPath: string | null = null;

    const clearTimer = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pendingPath = null;
    };

    const prefetchPath = (path: string) => {
      const parsed = parseTitleHref(path);
      if (!parsed) return;
      void queryClient.prefetchQuery(titlePrefetchSpec(parsed.mediaType, parsed.id));
    };

    // Returnerar länkens pathname om target ligger i ett <a> till en titel.
    const titlePathOf = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const a = target.closest('a');
      if (!(a instanceof HTMLAnchorElement)) return null;
      return parseTitleHref(a.pathname) ? a.pathname : null;
    };

    const onPointerOver = (e: Event) => {
      if (saveDataOn()) return;
      const path = titlePathOf(e.target);
      if (!path) { clearTimer(); return; }
      if (path === pendingPath) return; // redan på väg för denna länk
      clearTimer();
      pendingPath = path;
      timer = setTimeout(() => {
        const p = pendingPath;
        clearTimer();
        if (p) prefetchPath(p);
      }, HOVER_INTENT_MS);
    };

    const onIntentNow = (e: Event) => {
      if (saveDataOn()) return;
      const path = titlePathOf(e.target);
      if (path) prefetchPath(path);
    };

    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerdown', onIntentNow, { passive: true });
    document.addEventListener('focusin', onIntentNow);

    return () => {
      clearTimer();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerdown', onIntentNow);
      document.removeEventListener('focusin', onIntentNow);
    };
  }, [queryClient]);
}
```

- [ ] **Step 2: Montera i AppShell**

I `src/components/layout/AppShell.tsx`:
- Lägg importen (nära de andra hook-importerna):
```tsx
import { useTitleLinkPrefetch } from '@/hooks/useTitleLinkPrefetch';
```
- I `AppShell`-komponenten, anropa hooken UNCONDITIONALLY (före alla early returns), direkt efter `useFcmForeground();` (rad 26):
```tsx
  useTitleLinkPrefetch();
```
VIKTIGT: den MÅSTE ligga före `if (isLandingForGuest) return ...` så hook-ordningen är stabil (React-hooks-regeln) och lyssnaren är aktiv i båda render-grenarna.

- [ ] **Step 3: Verifiering**

Run: `npm run typecheck && npm test`
Expected: PASS. (Inga nya enhetstester för hooken — DOM-delegering verifieras live i Task 4. Pure-logiken `parseTitleHref` är redan testad i Task 1.)

- [ ] **Step 4: Stage (INTE commit)**
```bash
git add src/hooks/useTitleLinkPrefetch.ts src/components/layout/AppShell.tsx
git status --short
```

---

### Task 3: Ta bort per-kort-wiringen i TitleCard + radera usePrefetchTitle

Nu täcker den globala lyssnaren TitleCard också → den per-kort-wirade prefetchen är dubbelarbete. Ta bort den (netto mindre kod, en sanningskälla).

**Files:**
- Modify: `src/components/title/TitleCard.tsx`
- Delete: `src/hooks/usePrefetchTitle.ts`

- [ ] **Step 1: Ta bort wiringen i TitleCard**

I `src/components/title/TitleCard.tsx`:
- Ta bort importen `import { usePrefetchTitle } from '@/hooks/usePrefetchTitle';`.
- Ta bort raden `const prefetch = usePrefetchTitle();` i komponentkroppen.
- På den yttersta wrappern `<div className="group relative" ...>`, ta bort de tre prefetch-props (`onPointerEnter`, `onPointerLeave`, `onPointerDown`) så att den åter blir bara:
```tsx
    <div className="group relative">
```
Lämna allt annat i TitleCard oförändrat (postern, QuickAddButton, NotInterestedButton, titel-länken). `MediaType`-importen kan vara kvar om den används på annat håll i filen; ta bara bort den om den blir oanvänd (typecheck/lint visar).

- [ ] **Step 2: Radera den överflödiga hooken**
```bash
git rm src/hooks/usePrefetchTitle.ts
```
(Inget annat importerar den — verifiera: `grep -rn "usePrefetchTitle" src` ska efter TitleCard-ändringen ge noll träffar.)

- [ ] **Step 3: Verifiering**

Run: `grep -rn "usePrefetchTitle" src` → ska vara TOMT.
Run: `npm run typecheck && npm test` → PASS (om `MediaType` blev oanvänd i TitleCard: ta bort den ur import-raden tills lint/typecheck är rena).

- [ ] **Step 4: Stage (INTE commit)**
```bash
git add src/components/title/TitleCard.tsx
git add -u src/hooks/usePrefetchTitle.ts
git status --short
```
(`git add -u` stagar borttagningen.)

---

### Task 4: Slutverifiering + live-smoke + deploy

**Files:** inga (verifiering + deploy).

- [ ] **Step 1: Full grind**

Run: `npm run lint && npm run typecheck && npm test`
Expected: 0 lint-errors (varningar ok), typecheck rent, alla tester gröna.

- [ ] **Step 2: Granskning + commit (orkestratorn, inte implementer)**

Kör projektets review-agenter på den stagade diffen och committa när markörerna är färska:
- `binge-code-reviewer` (för `src/**.ts(x)`: prefetch.ts, useTitleLinkPrefetch.ts, AppShell.tsx, TitleCard.tsx) → skriver `code-review-done.marker`.
- `binge-test-reviewer` (för `prefetch.test.ts`) → skriver `test-done.marker`.

Föreslagna commits (en per task, eller en samlad — välj efter granskning):
```bash
git commit -m "perf(prefetch): global delegerad intent-lyssnare för alla titellänkar

En useTitleLinkPrefetch-hook i AppShell prefetchar valfri /movie/:id- och
/tv/:id-länk på hover-intent (150 ms), touch (pointerdown) och tangentbords-
fokus (focusin) — keyad på länkens href, så ALLA kort-/länk-ytor täcks
(TitleCard, RecCard, kalender, framtida kort) utan per-komponent-kod. Tar bort
den nu överflödiga per-kort-wiringen + usePrefetchTitle. Respekterar data-
sparläge; bara TMDB, dedupas av staleTime, stryps av 8-semaforen.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push + deploy**

```bash
git push origin main
```
(Working agreement: push-direct-to-main deployar hosting. Bygget har en 30-min-spärr.)

- [ ] **Step 4: Live-smoke-test (KORREKT metod — via React Query-cachen, INTE nätverksloggen)**

När deployen gått igenom: i en inloggad Chrome, navigera till en yta som tidigare saknade prefetch (t.ex. rekommendations-RADERNA, eller kalendern). Kör i DevTools-konsolen (eller via verktyg) en kontroll som:
1. Hämtar `queryClient` via fiber-trädet.
2. Väljer en titellänk vars `queryClient.getQueryData(['movie'|'tv', id])` är `undefined` (genuint otömt).
3. Hovrar länken på riktigt (>150 ms) ELLER dispatchar fokus.
4. Verifierar att `queryClient.getQueryData(...)` därefter är definierad OCH att ett `/movie|tv/{id}`-fetch syns.

VIKTIGT: verifiera via **React Query-cachen** (`getQueryData`/`getQueryState`), inte bara `performance.getEntriesByType('resource')` — en redan-prefetchad titel är en korrekt no-op och ger inget nytt nätverksanrop. (Det var fällan i förra rundan.)

Förväntat: titlar på RecCard-rader (och övriga ytor) prefetchas nu, vilket de inte gjorde innan.

- [ ] **Step 5: Bekräfta noll Firestore-påverkan**

I Network-fliken: prefetch ska bara generera `api.themoviedb.org`-anrop, aldrig `firestore.googleapis.com`.

---

### Självgranskning (kör mot specen)

1. **Täckning:** Alla fyra ytor (hover/touch/fokus + "alla kort") → Task 2-hooken täcker dem via delegering. RecCard-luckan stängs eftersom lyssnaren är href-baserad, inte komponent-baserad. ✅
2. **Borttagning utan regression:** Task 3 tar bort TitleCards wiring först EFTER att Task 2 monterat den globala lyssnaren — inget fönster utan prefetch. (Om tasksen körs i ordning.) ✅
3. **Typkonsekvens:** `parseTitleHref` returnerar `{ mediaType: MediaType; id: number } | null`; `titlePrefetchSpec(mediaType, id)` tar exakt de typerna. `useTitleLinkPrefetch` returnerar `void`. ✅
4. **Inga platshållare:** all kod komplett. ✅

### Medvetet INTE i denna plan

- **IntersectionObserver-prefetch av synliga kort** — den delegerade hover/touch/fokus-lyssnaren täcker intent billigare; en synlighets-baserad variant skulle kunna prefetcha en hel skärm på en gång (TMDB-tryck). Omvärdera bara om touch-/fokus-head-starten känns för kort.
- **Säsongs- och nästa-sida-prefetch** — separata, redan byggda, orörda.
- **Prefetch av watchlist-/Firestore-data** — utanför scope; detta gäller bara TMDB-titeldetalj.
