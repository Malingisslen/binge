# Insikter periodsiffror — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fyll "Nya användare" och "Titlar tillagda" i `/insikter` från netto-delta mellan dagliga Firestore-snapshots istället för (frånvarande) Plausible.

**Architecture:** En ren funktion `computeWindowDeltas` beräknar skillnaden mellan dagens `insights/daily`-snapshot och en baseline-snapshot vald utifrån spannets startdag. `apiInsights` Cloud Function läser baseline (+1 läsning), kör funktionen och returnerar ett nytt `window`-fält. Frontend pekar om två resolvers till fältet (golvat till 0) och Toolbar visar en "sedan {datum}"-notis när historiken är grundare än spannet.

**Tech Stack:** TypeScript, Firebase Cloud Functions (firebase-admin/firestore), Next.js/React frontend, Vitest. Spec: `docs/superpowers/specs/2026-06-18-insikter-periodsiffror-design.md`.

---

## File Structure

- **Create** `functions/src/insights/window.ts` — ren `computeWindowDeltas` (ingen firebase-import).
- **Create** `functions/src/insights/window.test.ts` — enhetstester (körs av root-vitest via `functions/src/**/*.test.ts`).
- **Modify** `functions/src/insights/types.ts` — ny `WindowDeltas`-interface + `window`-fält på `InsightsData`.
- **Modify** `functions/src/insights/api.ts` — `readBaseline()` + inkludera `window` i svaret.
- **Modify** `src/app/insikter/insights.types.ts` — spegla `WindowDeltas` + `window`-fält.
- **Modify** `src/app/insikter/metrics/resolvers.ts` — peka om `newUsers`/`titlesAdded`, golva till 0.
- **Modify** `src/app/insikter/metrics/resolvers.test.ts` — nya testfall.
- **Modify** `src/app/insikter/components/Toolbar.tsx` — "sedan {datum}"-caption från context.

---

## Task 1: Pure `computeWindowDeltas` + `WindowDeltas`-typ

**Files:**
- Modify: `functions/src/insights/types.ts`
- Create: `functions/src/insights/window.ts`
- Test: `functions/src/insights/window.test.ts`

- [ ] **Step 1: Lägg till `WindowDeltas`-typen i `functions/src/insights/types.ts`**

Lägg in interface FÖRE `InsightsData`-interfacet:

```ts
/** Net change between today's snapshot and a baseline snapshot (period metrics). */
export interface WindowDeltas {
  basisDate: string;   // document id of the baseline snapshot (YYYY-MM-DD)
  truncated: boolean;  // baseline newer than requested window start (history too shallow)
  deltas: {
    users: number;         // raw net change (may be negative)
    titlesTracked: number; // raw net change (may be negative)
  };
}
```

Lägg sedan till fältet i `InsightsData` (efter `plausible`-raden):

```ts
  window: WindowDeltas | null; // null until at least one prior snapshot exists
```

- [ ] **Step 2: Skriv det fallerande testet `functions/src/insights/window.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeWindowDeltas } from './window';
import type { RollupData } from './types';

function rollup(users: number, titlesTracked: number): RollupData {
  return {
    computedAt: '', readsUsed: 0, partial: false,
    totals: { users, titlesTracked, reviews: 0, activeSessions: 0, groups: 0 },
    statusDistribution: { vill_se: 0, mina: 0, sedd: 0, avbruten: 0 },
    mediaTypeSplit: { movie: 0, tv: 0 },
    ratingsHistogram: [], topTitles: [], topProviders: [], topGenres: [],
  };
}

describe('computeWindowDeltas', () => {
  it('returns null when there is no baseline', () => {
    expect(computeWindowDeltas(rollup(3, 320), null, null, '2026-06-11')).toBeNull();
  });

  it('computes net change from baseline to today', () => {
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-11', '2026-06-11');
    expect(v).toEqual({
      basisDate: '2026-06-11',
      truncated: false,
      deltas: { users: 0, titlesTracked: 19 },
    });
  });

  it('keeps a negative net delta raw (clamping is the frontend’s job)', () => {
    const v = computeWindowDeltas(rollup(3, 300), rollup(3, 302), '2026-06-11', '2026-06-11');
    expect(v?.deltas.titlesTracked).toBe(-2);
  });

  it('flags truncated when baseline is newer than the requested start', () => {
    // Requested 30d back (2026-05-19) but oldest snapshot is 2026-06-10.
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-10', '2026-05-19');
    expect(v?.truncated).toBe(true);
    expect(v?.basisDate).toBe('2026-06-10');
  });

  it('is not truncated when baseline is at or before the requested start', () => {
    const v = computeWindowDeltas(rollup(3, 320), rollup(3, 301), '2026-06-09', '2026-06-11');
    expect(v?.truncated).toBe(false);
  });
});
```

- [ ] **Step 3: Kör testet och bekräfta att det fallerar**

Run: `npx vitest run functions/src/insights/window.test.ts`
Expected: FAIL — `Failed to resolve import "./window"` / `computeWindowDeltas is not a function`.

- [ ] **Step 4: Implementera `functions/src/insights/window.ts`**

```ts
/**
 * Pure period-metric math for Insikter. No firebase imports so it runs under the
 * root vitest toolchain (functions/ has no test runner of its own).
 *
 * The dashboard's period tiles ("Nya användare", "Titlar tillagda") are the net
 * change between today's rollup snapshot and a baseline snapshot from the start
 * of the selected window. Raw net is returned here (can be negative); the
 * frontend floors it at 0 for display under an "added"-style label.
 */
import type { RollupData, WindowDeltas } from './types';

export function computeWindowDeltas(
  daily: RollupData,
  baseline: RollupData | null,
  baselineDate: string | null,
  requestedFrom: string,
): WindowDeltas | null {
  if (!baseline || !baselineDate) return null;
  return {
    basisDate: baselineDate,
    truncated: baselineDate > requestedFrom,
    deltas: {
      users: daily.totals.users - baseline.totals.users,
      titlesTracked: daily.totals.titlesTracked - baseline.totals.titlesTracked,
    },
  };
}
```

- [ ] **Step 5: Kör testet och bekräfta att det passerar**

Run: `npx vitest run functions/src/insights/window.test.ts`
Expected: PASS (5 tester).

- [ ] **Step 6: Commit**

```bash
git add functions/src/insights/types.ts functions/src/insights/window.ts functions/src/insights/window.test.ts
git commit -m "feat(insikter): ren computeWindowDeltas + WindowDeltas-typ

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Läs baseline + returnera `window` i `apiInsights`

**Files:**
- Modify: `functions/src/insights/api.ts`

Ingen enhetstest — `api.ts` är firebase-bunden och redan otestad i repot. Verifieras via `tsc`-bygget i functions och senare emulator/deploy.

- [ ] **Step 1: Lägg till imports i `functions/src/insights/api.ts`**

I import-blocket högst upp, lägg `FieldPath` till firestore-importen och lägg till window-importen:

```ts
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
```

och under de andra lokala importerna (nära `import { fetchPlausible } from './plausible';`):

```ts
import { computeWindowDeltas } from './window';
```

Lägg även till `WindowDeltas` i typ-importen från `./types` om den raden importerar typer (annars lämna — den används bara indirekt via returvärdet).

- [ ] **Step 2: Lägg till `readBaseline()` bredvid `readRollup()`**

Placera direkt efter `readRollup()`-funktionen:

```ts
/**
 * Baseline snapshot for the window: newest dated snapshot on or before `from`.
 * Date ids ("2026-…") sort before the live "daily" doc ("d"), so a `<= {date}`
 * bound excludes "daily" naturally. If history doesn't reach `from`, fall back
 * to the oldest dated snapshot (the dashboard then shows a "sedan {datum}" note).
 */
async function readBaseline(
  from: string,
): Promise<{ data: RollupData; date: string } | null> {
  const col = getFirestore().collection('insights');
  try {
    let snap = await col
      .where(FieldPath.documentId(), '<=', from)
      .orderBy(FieldPath.documentId(), 'desc')
      .limit(1)
      .get();
    if (snap.empty) {
      snap = await col.orderBy(FieldPath.documentId(), 'asc').limit(1).get();
    }
    if (snap.empty) return null;
    const doc = snap.docs[0];
    if (doc.id === 'daily') return null; // only the live doc exists — no history yet
    return { data: doc.data() as RollupData, date: doc.id };
  } catch (err) {
    logger.error('readBaseline failed', err);
    return null;
  }
}
```

- [ ] **Step 3: Läs baseline parallellt och beräkna `window` i handlern**

Hitta i `apiInsights`-handlern:

```ts
    const range = parseRange(req.query as Record<string, unknown>);

    const [rollup, plausible] = await Promise.all([readRollup(), fetchPlausible(range)]);
```

Ersätt med:

```ts
    const range = parseRange(req.query as Record<string, unknown>);

    const [rollup, plausible, baseline] = await Promise.all([
      readRollup(),
      fetchPlausible(range),
      readBaseline(range.from),
    ]);

    const window = rollup
      ? computeWindowDeltas(rollup, baseline?.data ?? null, baseline?.date ?? null, range.from)
      : null;
```

- [ ] **Step 4: Lägg `window` i svarsobjektet**

Hitta `const data: InsightsData = {` och lägg till `window,` (efter `plausible,`):

```ts
    const data: InsightsData = {
      generatedAt: new Date().toISOString(),
      range,
      rollup,
      plausible,
      window,
      partial: rollup === null || rollup.partial || plausible === null,
    };
```

- [ ] **Step 5: Verifiera att functions-projektet kompilerar**

Run: `cd functions && npm run build && cd ..`
Expected: `tsc` slutförs utan fel (genererar `functions/lib/`).

- [ ] **Step 6: Commit**

```bash
git add functions/src/insights/api.ts
git commit -m "feat(insikter): apiInsights returnerar window-delta från baseline-snapshot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Spegla typ + peka om frontend-resolvers

**Files:**
- Modify: `src/app/insikter/insights.types.ts`
- Modify: `src/app/insikter/metrics/resolvers.ts`
- Test: `src/app/insikter/metrics/resolvers.test.ts`

- [ ] **Step 1: Spegla `WindowDeltas` + `window`-fält i `src/app/insikter/insights.types.ts`**

Lägg `WindowDeltas`-interfacet (identiskt med functions-versionen) före `InsightsData`:

```ts
/** Net change between today's snapshot and a baseline snapshot (period metrics). */
export interface WindowDeltas {
  basisDate: string;   // document id of the baseline snapshot (YYYY-MM-DD)
  truncated: boolean;  // baseline newer than requested window start (history too shallow)
  deltas: {
    users: number;         // raw net change (may be negative)
    titlesTracked: number; // raw net change (may be negative)
  };
}
```

och lägg fältet i `InsightsData` (efter `plausible`-raden):

```ts
  window: WindowDeltas | null; // null until at least one prior snapshot exists
```

- [ ] **Step 2: Uppdatera testhjälparen + lägg fallerande testfall i `src/app/insikter/metrics/resolvers.test.ts`**

I `emptyData()` lägg till `window: null,` i default-objektet (efter `partial: false,`) så det matchar den nya typen:

```ts
function emptyData(over: Partial<InsightsData> = {}): InsightsData {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    range: { preset: '30d', from: '2026-05-03', to: '2026-06-02' },
    rollup: null,
    plausible: null,
    window: null,
    partial: false,
    ...over,
  };
}
```

Lägg sedan till ett nytt describe-block sist i filen:

```ts
describe('period metrics read window deltas and floor at 0', () => {
  it('newUsers and titlesAdded are NaN when window is null', () => {
    expect(DATA_RESOLVERS.newUsers(emptyData())).toEqual({ kind: 'scalar', value: NaN });
    expect(DATA_RESOLVERS.titlesAdded(emptyData())).toEqual({ kind: 'scalar', value: NaN });
  });

  it('reads the net deltas from window', () => {
    const d = emptyData({ window: { basisDate: '2026-06-11', truncated: false, deltas: { users: 2, titlesTracked: 19 } } });
    expect(DATA_RESOLVERS.newUsers(d)).toEqual({ kind: 'scalar', value: 2 });
    expect(DATA_RESOLVERS.titlesAdded(d)).toEqual({ kind: 'scalar', value: 19 });
  });

  it('floors a negative net delta to 0 (never a minus under an "added" label)', () => {
    const d = emptyData({ window: { basisDate: '2026-06-11', truncated: false, deltas: { users: 0, titlesTracked: -2 } } });
    expect(DATA_RESOLVERS.titlesAdded(d)).toEqual({ kind: 'scalar', value: 0 });
  });
});
```

- [ ] **Step 3: Kör testet och bekräfta att det fallerar**

Run: `npx vitest run src/app/insikter/metrics/resolvers.test.ts`
Expected: FAIL — `titlesAdded`/`newUsers` läser fortfarande Plausible, så netto-fallen ger NaN istället för 2/19/0.

- [ ] **Step 4: Peka om resolvers i `src/app/insikter/metrics/resolvers.ts`**

Ersätt raderna:

```ts
  newUsers: (d) => scalar(d.plausible?.goals.signed_up ?? NaN),
  activeVisitors: (d) => scalar(d.plausible?.visitors ?? NaN),
  titlesAdded: (d) => scalar(d.plausible?.goals.title_added_watchlist ?? NaN),
```

med:

```ts
  newUsers: (d) => scalar(Math.max(0, d.window?.deltas.users ?? NaN)),
  activeVisitors: (d) => scalar(d.plausible?.visitors ?? NaN), // pure web traffic — stays Plausible
  titlesAdded: (d) => scalar(Math.max(0, d.window?.deltas.titlesTracked ?? NaN)),
```

(`Math.max(0, NaN)` är `NaN`, så plattan visar fortfarande streck när `window` saknas.)

- [ ] **Step 5: Kör testet och bekräfta att det passerar**

Run: `npx vitest run src/app/insikter/metrics/resolvers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/insikter/insights.types.ts src/app/insikter/metrics/resolvers.ts src/app/insikter/metrics/resolvers.test.ts
git commit -m "feat(insikter): periodsiffror läser window-delta (golvat till 0)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Toolbar "sedan {datum}"-notis

**Files:**
- Modify: `src/app/insikter/components/Toolbar.tsx`

- [ ] **Step 1: Läs in window-context och rendera notisen**

Ersätt hela `src/app/insikter/components/Toolbar.tsx` med:

```tsx
'use client';

import { RangePicker } from './RangePicker';
import { useInsightsContext } from '../state/InsightsContext';

function formatTime(d: Date): string {
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

/** Top toolbar: range picker + last-fetched timestamp + truncated-window note. */
export function Toolbar({ lastFetchedAt }: { lastFetchedAt: Date | null }) {
  const data = useInsightsContext();
  const basis = data.window?.truncated ? data.window.basisDate : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <RangePicker />
      <div className="flex items-center gap-3 text-[12px] text-ink-3">
        {basis && <span>Periodsiffror jämförda mot {basis}</span>}
        <span>Senast hämtad: {lastFetchedAt ? formatTime(lastFetchedAt) : '—'}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifiera typecheck + att inget annat brister**

Run: `npm run typecheck`
Expected: inga fel (Toolbar:s `useInsightsContext()` returnerar `InsightsData` med det nya `window`-fältet).

- [ ] **Step 3: Commit**

```bash
git add src/app/insikter/components/Toolbar.tsx
git commit -m "feat(insikter): Toolbar visar 'jämförd mot {datum}' när historik är grund

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full verifiering + två-stegs deploy

**Files:** (inga ändringar — grindar + deploy)

- [ ] **Step 1: Kör hela frontend-grinden**

Run: `npm run lint && npm run typecheck && npm test`
Expected: lint rent, typecheck rent, alla tester passerar (inkl. nya `window.test.ts` + resolver-fall).

- [ ] **Step 2: Verifiera functions-bygget en sista gång**

Run: `cd functions && npm run build && cd ..`
Expected: `tsc` rent.

- [ ] **Step 3: Deploya Cloud Function FÖRST**

Den nya `window`-datan kommer från funktionen, och vanlig push-to-main deployar bara hosting (se memory: deploy-scope). Funktionen måste live före frontend.

Run: `firebase deploy --only functions:apiInsights`
Expected: `Deploy complete!`. Vid 401/auth-fel: följ Firebase re-auth-flödet (memory: reference_firebase_reauth) innan retry.

- [ ] **Step 4: Rök-testa API:t mot live-funktionen**

Verifiera att svaret nu innehåller `window` (öppna `/insikter` som admin och växla spann; "Titlar tillagda" ska visa ~19 för ett spann som korsar 13→14 juni, och Toolbar ska visa "jämförda mot 2026-06-10" för 30d/90d).

- [ ] **Step 5: Commit-eventuella kvarvarande + pusha frontend**

Allt är redan committat i Task 1–4. Pusha till main för hosting-deploy (kör gärna `/commit`-flödet så cachen purgas):

```bash
git push origin main
```

Expected: deploy.yml grön, Cloudflare-cache purgad, `/insikter` läser `window`.

---

## Self-Review (ifylld av planförfattaren)

**Spec coverage:**
- Net delta request-tid i api → Task 2. ✓
- Baseline-val (≤ from, fallback äldsta, daily-guard) → Task 2 Step 2. ✓
- Pure `computeWindowDeltas` + tester → Task 1. ✓
- API-kontrakt `window` i båda typfilerna → Task 1 (functions) + Task 3 (frontend). ✓
- Resolver-ompekning + golvning 0; activeVisitors kvar Plausible → Task 3 Step 4. ✓
- "sedan {datum}"-notis i Toolbar, en plats → Task 4. ✓
- Felhantering window=null/baseline-fel → Task 2 (try/catch, rollup-null-guard) + Task 3 (NaN-streck). ✓
- Två-stegs deploy (functions först) → Task 5. ✓

**Placeholder scan:** inga TBD/TODO; all kod fullständig.

**Type-consistency:** `WindowDeltas` identisk i båda typfilerna; `computeWindowDeltas(daily, baseline, baselineDate, requestedFrom)` används med samma signatur i Task 2 Step 3 som i Task 1 Step 4; `window`-fältet stavas lika överallt.
