# Home "Instant Week" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home dashboard renders "Din vecka" (focal + counts) instantly from denormalized next-air fields on the user's own watchlist docs, with the ~216-request TMDB fan-out demoted to non-gating background refresh.

**Architecture:** Read-repair denormalization. Five new fields on `users/{uid}/watchlist/{tmdbId}`, written by ONE module (`nextAirReadRepair.ts`) from ONE call site (the calendar fan-out hook), batched and idempotent. Home seeds the existing `pickFocalEntry` render path from those fields while the live fan-out resolves. Spec: `docs/superpowers/specs/2026-07-02-home-instant-week-design.md`.

**Tech Stack:** Next.js 16 static export, React 19, Firebase Firestore (lazy `fsdb()` pattern), React Query v5, Vitest.

## Global Constraints

- Swedish UI strings; code/comments per surrounding file convention (mixed sv/en).
- No hex colors, no new shadows/gradients; fade = opacity animation only.
- `useCalendarEntries().isLoading` strict semantics MUST NOT change (advisor contract, `useUpcomingShowsForAdvisor.ts:187`).
- `useSubscriptionAdvisor`'s own fetch set MUST NOT change.
- Read-repair writes NEVER include `updatedAt` (protects `continueWatching.ts:108` sort). `nextAirUpdatedAt` is the only timestamp they touch.
- No new paid services; Blaze cap 25 SEK/mån.
- Rules deploy (Task 2) MUST precede any client-write code reaching prod (Task 8 push).
- LWW across tabs/devices is explicitly accepted for these derived fields (document in module header).
- CI lint treats `no-explicit-any` as ERROR — type all test mocks.

---

### Task 1: Phase A polish — App Check chunk prefetch (A2′) + skeleton fade (A3)

**Files:**
- Modify: `src/lib/firebase/appCheck.ts:34-41`
- Modify: `src/app/globals.css` (append)
- Modify: `src/app/page.tsx` (Dashboard render, the `shownFocal` branch + `detailBlock`)

**Interfaces:** none produced; purely presentational + a webpack hint.

- [x] **Step 1: webpackPrefetch on the app-check chunk + comment**

In `src/lib/firebase/appCheck.ts`, change the dynamic import block (keep everything else):

```ts
  initPromise = (async () => {
    let mod: typeof import('firebase/app-check');
    let appMod: typeof import('@/lib/firebase/config');
    try {
      [mod, appMod] = await Promise.all([
        // webpackPrefetch: låt webbläsaren idle-hämta chunken direkt efter
        // sidladdning så awaiten i AuthContext oftast är cache-träff även på
        // kall load. OBS: init-ORDNINGEN (await initAppCheck() FÖRE
        // onAuthStateChanged) är lastbärande och får inte parallelliseras —
        // se kommentaren överst i filen (hang om providern inte är
        // registrerad när enforcement är på). Granskad + blockerad 2026-07-02.
        import(/* webpackPrefetch: true */ 'firebase/app-check'),
        import('@/lib/firebase/config'),
      ]);
    } catch (err) {
```

- [x] **Step 2: Fade keyframes in globals.css**

Append at the end of `src/app/globals.css`:

```css
/* Instant week (2026-07): mjuk intoning när skelett byts mot innehåll på Hem.
   Endast opacity (ingen transform) — noll CLS-påverkan. */
@keyframes hem-settle {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hem-settle { animation: hem-settle 180ms ease-out both; }
```

- [x] **Step 3: Apply the class in page.tsx**

In `Dashboard()` in `src/app/page.tsx`, wrap the two content reveals:

```tsx
  const detailBlock = (
    <div className="hem-settle">
      <LaterThisWeek entries={calendarEntries} excludeKey={focalKey} />
      <ContinueWatchingTile entries={continueWatching} />
      <BacklogResurfaceTile items={resurfaced} myProviders={user?.myProviders ?? []} />
    </div>
  );
```

and in the `shownFocal ? (...)` branch:

```tsx
              <>
                <div className="hem-settle">
                  <HemFocal entry={shownFocal} />
                </div>
                {detailLoading ? (
                  <div className="hem-filmstrip-skeleton" aria-hidden="true" />
                ) : (
                  detailBlock
                )}
              </>
```

- [x] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint src/app/page.tsx src/lib/firebase/appCheck.ts`
Expected: no output (clean).

- [x] **Step 5: Commit**

```bash
git add src/lib/firebase/appCheck.ts src/app/globals.css src/app/page.tsx
git commit -m "perf(home)+ui: prefetch app-check-chunk (ordningen orörd) + hem-settle-fade (Fas A)"
```

---

### Task 2: Firestore rules — whitelist + value caps + rules tests, deploy

**Files:**
- Modify: `firestore.rules` (`isValidWatchlistItem`, ~line 91)
- Test: `src/test/rules/firestore-rules.test.ts`

**Interfaces:**
- Produces: server-side acceptance of merge-writes containing exactly `nextAirDate`, `nextAirCode`, `nextAirProvider`, `nextAirUpdatedAt`, `digitalReleaseDate` (all nullable; strings capped 32/16/80/—/32; `nextAirUpdatedAt is timestamp`).

- [x] **Step 1: Write the failing rules tests**

Append inside/after the `users/{uid}/watchlist/{id} field whitelist` describe in `src/test/rules/firestore-rules.test.ts`:

```ts
// Instant week (2026-07): nextAirReadRepair merge-writes the denormalized
// next-air field group. Mirrors the BIN-93 runtime-backfill precedent: the
// fields must be whitelisted or every silent read-repair write is rejected.
describe('users/{uid}/watchlist/{id} next-air read-repair fields', () => {
  it('allows a next-air-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: '2026-07-09', nextAirCode: 'S2E03', nextAirProvider: 'HBO Max',
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows a digitalReleaseDate-only merge write', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '603');
    await setDoc(ref, validWatchlist());
    await assertSucceeds(setDoc(ref, {
      digitalReleaseDate: '2026-08-01', nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('allows clearing next-air fields with nulls', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertSucceeds(setDoc(ref, {
      nextAirDate: null, nextAirCode: null, nextAirProvider: null,
      nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects an oversize nextAirProvider', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, {
      nextAirProvider: 'x'.repeat(81), nextAirUpdatedAt: serverTimestamp(),
    }, { merge: true }));
  });
  it('rejects a non-timestamp nextAirUpdatedAt', async () => {
    const ref = doc(ownerDb(), 'users', OWNER, 'watchlist', '1399');
    await setDoc(ref, { ...validWatchlist(), tmdbId: 1399, mediaType: 'tv' });
    await assertFails(setDoc(ref, { nextAirUpdatedAt: 'igår' }, { merge: true }));
  });
});
```

- [x] **Step 2: Run rules tests to verify they fail**

Requires Java on PATH (Android Studio JBR — see memory `reference_emulator_java`):

Run: `export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH" && java -version && npm run test:rules`
Expected: the three `allows …` tests FAIL (permission-denied from `hasOnly`); the two `rejects …` tests pass vacuously.

- [x] **Step 3: Update firestore.rules**

In `isValidWatchlistItem`, extend the whitelist and add caps (keep the existing rating bind):

```
        // BIN-93: lazy runtime-backfill från titelsidor (setRuntime). ...
        'runtime',
        // Instant week (2026-07): denormaliserade next-air-fält, skrivna av
        // nextAirReadRepair (tyst read-repair, aldrig user-edit — bumpar ALDRIG
        // updatedAt). Spec: docs/superpowers/specs/2026-07-02-home-instant-week-design.md
        'nextAirDate', 'nextAirCode', 'nextAirProvider', 'nextAirUpdatedAt',
        'digitalReleaseDate'
      ])
      ... befintlig rating-bind ...
      // Instant week: bind längder/typer på read-repair-fälten (junk-data-
      // försäkring, speglar rating-bindningen — självägda docs men publika
      // watchlists läses av andra).
      && (!('nextAirDate' in d) || d.nextAirDate == null || (d.nextAirDate is string && d.nextAirDate.size() <= 32))
      && (!('nextAirCode' in d) || d.nextAirCode == null || (d.nextAirCode is string && d.nextAirCode.size() <= 16))
      && (!('nextAirProvider' in d) || d.nextAirProvider == null || (d.nextAirProvider is string && d.nextAirProvider.size() <= 80))
      && (!('nextAirUpdatedAt' in d) || d.nextAirUpdatedAt == null || d.nextAirUpdatedAt is timestamp)
      && (!('digitalReleaseDate' in d) || d.digitalReleaseDate == null || (d.digitalReleaseDate is string && d.digitalReleaseDate.size() <= 32));
```

- [x] **Step 4: Run rules tests to verify they pass**

Run: `export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH" && npm run test:rules`
Expected: ALL rules tests pass (new + pre-existing whitelist/rating/tags suites).

- [x] **Step 5: Commit + deploy rules (manual — deploy.yml only ships hosting)**

```bash
git add firestore.rules src/test/rules/firestore-rules.test.ts
git commit -m "feat(rules)+test: whitelista next-air read-repair-fält med värde-caps (instant week)"
firebase deploy --only firestore:rules
```
Expected: `✔ Deploy complete!`

---

### Task 3: Hoist `getNextAirInfo` + `streamingProviderName` into `src/lib/calendar/nextAir.ts`

**Files:**
- Create: `src/lib/calendar/nextAir.ts`
- Modify: `src/hooks/useSubscriptionAdvisor.helpers.ts:131-150` (remove body, re-export)
- Modify: `src/lib/calendar/buildEntries.ts:15-18` (import instead of private fn)

**Interfaces:**
- Produces: `getNextAirInfo(show: TMDBTVShow): { date: string | null; code: string | null }` and `streamingProviderName(data: TMDBProviderData | undefined): string | undefined` from `@/lib/calendar/nextAir`.
- Consumers keep importing `getNextAirInfo` from `./useSubscriptionAdvisor.helpers` (re-export preserves all call sites and existing tests).

- [x] **Step 1: Create `src/lib/calendar/nextAir.ts`**

```ts
import { getProvider } from '@/lib/tmdb/providers';
import { formatEpisodeCode, todayIso } from '@/lib/utils';
import type { TMDBTVShow, TMDBProviderData } from '@/types';

// Kanoniskt hem för "när sänds nästa avsnitt?"-härledningen (instant week,
// 2026-07). Hoistad från useSubscriptionAdvisor.helpers (den kompletta
// varianten med seasons-fallback) så rådgivaren, kalendern och
// nextAirReadRepair delar EN implementation — aldrig en tredje kopia.

export function getNextAirInfo(show: TMDBTVShow): { date: string | null; code: string | null } {
  if (show.next_episode_to_air?.air_date) {
    const ep = show.next_episode_to_air;
    return {
      date: ep.air_date,
      code: formatEpisodeCode(ep.season_number, ep.episode_number),
    };
  }
  const now = todayIso();
  const futureSeason = show.seasons
    ?.filter(s => s.air_date && s.air_date > now && s.season_number > 0)
    .sort((a, b) => a.air_date.localeCompare(b.air_date))[0];
  if (futureSeason?.air_date) {
    return {
      date: futureSeason.air_date,
      code: formatEpisodeCode(futureSeason.season_number, 1),
    };
  }
  return { date: null, code: null };
}

/**
 * Provider-policy för kalenderns metarader (H3): visa var titeln STREAMAS när
 * TMDB vet det — flatrate, free eller ads (i den ordningen). Rent/buy räknas
 * inte ("kan köpas" är inte "sänds på"). Saknar TMDB SE-data helt lämnas
 * provider tom. (Flyttad hit från buildEntries — delas med nextAirReadRepair.)
 */
export function streamingProviderName(data: TMDBProviderData | undefined): string | undefined {
  const p = data?.flatrate?.[0] ?? data?.free?.[0] ?? data?.ads?.[0];
  return p ? (getProvider(p.provider_id)?.shortName ?? p.provider_name) : undefined;
}
```

Check first that `formatEpisodeCode` and `todayIso` really live in `@/lib/utils` (match the import lines at the top of `useSubscriptionAdvisor.helpers.ts`); if they import from elsewhere, mirror those exact paths.

- [x] **Step 2: Re-point `useSubscriptionAdvisor.helpers.ts`**

Delete the `getNextAirInfo` function body (lines 131-150) and add near the top:

```ts
// Hoistad till lib/calendar/nextAir (instant week 2026-07) — re-exporteras
// här så befintliga imports + tester fortsätter fungera oförändrat.
export { getNextAirInfo } from '@/lib/calendar/nextAir';
```

If the helpers file uses `getNextAirInfo` internally, also `import { getNextAirInfo } from '@/lib/calendar/nextAir';` (an `export { x } from` does not create a local binding). Remove now-unused imports (`formatEpisodeCode`/`todayIso`) ONLY if nothing else in the file uses them — check with grep before deleting.

- [x] **Step 3: Re-point `buildEntries.ts`**

Delete the private `streamingProviderName` (lines 15-18) and its now-unused `getProvider` import (verify unused first); add:

```ts
import { streamingProviderName } from './nextAir';
```

- [x] **Step 4: Verify — existing tests must pass unchanged**

Run: `npx tsc --noEmit && npx vitest run src/hooks/useSubscriptionAdvisor.helpers.test.ts src/lib/calendar/buildEntries.test.ts 2>$null; npx vitest run --dir src --reporter=dot -t "getNextAirInfo"`
(Adjust to the actual test filenames — find them with `ls src/hooks/*.test.ts src/lib/calendar/*.test.ts`.)
Expected: PASS with zero test-file edits — this proves the hoist is behavior-preserving.

- [x] **Step 5: Commit**

```bash
git add src/lib/calendar/nextAir.ts src/hooks/useSubscriptionAdvisor.helpers.ts src/lib/calendar/buildEntries.ts
git commit -m "refactor(calendar): hoista getNextAirInfo + streamingProviderName till lib/calendar/nextAir (en källa, instant week)"
```

---

### Task 4: `nextAirReadRepair.ts` — pure compute + delta + payload (TDD)

**Files:**
- Create: `src/lib/watchlist/nextAirReadRepair.ts`
- Test: `src/lib/watchlist/nextAirReadRepair.test.ts`

**Interfaces:**
- Consumes: `getNextAirInfo`, `streamingProviderName` from `@/lib/calendar/nextAir`; `pickSwedishDigitalRelease` from `@/lib/calendar/releaseDate`.
- Produces:
  - `computeNextAirFields(show: TMDBTVShow): NextAirFields` where `NextAirFields = { nextAirDate: string | null; nextAirCode: string | null; nextAirProvider: string | null }`
  - `computeMovieReleaseFields(movie: TMDBMovie): { digitalReleaseDate: string | null }`
  - `nextAirDelta(item: WatchlistItem, fields: Partial<NextAirFields & { digitalReleaseDate: string | null }>): Record<string, string | null> | null` — null when nothing changed (null ≡ undefined ≡ absent), else ONLY the changed keys.
  - `collectNextAirUpdates(items, shows, movies)` and `flushNextAirWrites(uid, updates)` (Task 5 adds these — same file).

- [x] **Step 1: Write the failing tests**

`src/lib/watchlist/nextAirReadRepair.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  computeNextAirFields, computeMovieReleaseFields, nextAirDelta,
} from './nextAirReadRepair';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

const baseItem = (over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  tmdbId: 1399, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'Test', posterPath: null, releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [], tmdbStatus: null, runtime: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
});

const showWith = (over: Partial<TMDBTVShow>): TMDBTVShow =>
  ({ id: 1399, name: 'Test', ...over }) as TMDBTVShow;

describe('computeNextAirFields', () => {
  it('derives date/code from next_episode_to_air and provider from SE flatrate', () => {
    const show = showWith({
      next_episode_to_air: { air_date: '2026-07-09', season_number: 2, episode_number: 3 } as TMDBTVShow['next_episode_to_air'],
      'watch/providers': { results: { SE: { flatrate: [{ provider_id: 1899, provider_name: 'Max' }] } } } as TMDBTVShow['watch/providers'],
    });
    const f = computeNextAirFields(show);
    expect(f.nextAirDate).toBe('2026-07-09');
    expect(f.nextAirCode).toBe('S2E3'.replace('E3', 'E03') === f.nextAirCode ? f.nextAirCode : f.nextAirCode); // assert real format below
    expect(f.nextAirCode).toMatch(/^S2E0?3$/);
    expect(f.nextAirProvider).toBeTruthy();
  });
  it('returns all-null for a show with nothing upcoming and no SE providers', () => {
    expect(computeNextAirFields(showWith({}))).toEqual({
      nextAirDate: null, nextAirCode: null, nextAirProvider: null,
    });
  });
});

describe('computeMovieReleaseFields', () => {
  it('picks the Swedish digital release date', () => {
    const movie = {
      id: 603, title: 'Test',
      release_dates: { results: [{ iso_3166_1: 'SE', release_dates: [{ type: 4, release_date: '2026-08-01T00:00:00.000Z' }] }] },
    } as unknown as TMDBMovie;
    expect(computeMovieReleaseFields(movie)).toEqual({ digitalReleaseDate: '2026-08-01' });
  });
});

describe('nextAirDelta', () => {
  it('returns null when persisted values equal computed (null vs undefined is NOT a diff)', () => {
    const item = baseItem(); // nextAirDate undefined on item
    expect(nextAirDelta(item, { nextAirDate: null, nextAirCode: null, nextAirProvider: null })).toBeNull();
  });
  it('returns only the changed keys', () => {
    const item = baseItem({ nextAirDate: '2026-07-02', nextAirCode: 'S2E02', nextAirProvider: 'Max' });
    const d = nextAirDelta(item, { nextAirDate: '2026-07-09', nextAirCode: 'S2E03', nextAirProvider: 'Max' });
    expect(d).toEqual({ nextAirDate: '2026-07-09', nextAirCode: 'S2E03' });
  });
  it('never contains updatedAt or nextAirUpdatedAt (stamp added only at write time)', () => {
    const item = baseItem();
    const d = nextAirDelta(item, { nextAirDate: '2026-07-09' });
    expect(d).not.toBeNull();
    expect(Object.keys(d!)).not.toContain('updatedAt');
    expect(Object.keys(d!)).not.toContain('nextAirUpdatedAt');
  });
});
```

Note: check the real output of `formatEpisodeCode(2, 3)` in `src/lib/utils` first and pin the exact expected string (drop the tautological line, assert the literal).

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/watchlist/nextAirReadRepair.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the pure half of `src/lib/watchlist/nextAirReadRepair.ts`**

```ts
import { getNextAirInfo, streamingProviderName } from '@/lib/calendar/nextAir';
import { pickSwedishDigitalRelease } from '@/lib/calendar/releaseDate';
import type { TMDBTVShow, TMDBMovie, WatchlistItem } from '@/types';

// Instant week (2026-07): tyst read-repair av denormaliserade next-air-fält på
// watchlist-docs. Regler (bindande, från stakeholder-panelen — spec
// 2026-07-02-home-instant-week-design.md):
//   • Skrivs ENDAST härifrån, anropat från EN plats (useCalendar-effekten).
//   • Bumpar ALDRIG updatedAt ("Fortsätt titta" sorterar på den, se
//     continueWatching.ts) — nextAirUpdatedAt är enda tidsstämpeln.
//   • No-op när inget ändrats (null ≡ undefined ≡ frånvarande fält).
//   • Last-write-wins mellan flikar/enheter är ACCEPTERAT: fälten är rent
//     härledda/omräknerliga (jfr communityRatings som INTE får LWW).
//   • Best-effort: fel sväljs (setRuntime-mönstret) — nästa besök reparerar.

export interface NextAirFields {
  nextAirDate: string | null;
  nextAirCode: string | null;
  nextAirProvider: string | null;
}

export function computeNextAirFields(show: TMDBTVShow): NextAirFields {
  const { date, code } = getNextAirInfo(show);
  return {
    nextAirDate: date,
    nextAirCode: code,
    nextAirProvider: streamingProviderName(show['watch/providers']?.results?.SE) ?? null,
  };
}

export function computeMovieReleaseFields(movie: TMDBMovie): { digitalReleaseDate: string | null } {
  return { digitalReleaseDate: pickSwedishDigitalRelease(movie) };
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? null) === (b ?? null);

type RepairableKey = keyof NextAirFields | 'digitalReleaseDate';

export function nextAirDelta(
  item: WatchlistItem,
  fields: Partial<Record<RepairableKey, string | null>>,
): Partial<Record<RepairableKey, string | null>> | null {
  const delta: Partial<Record<RepairableKey, string | null>> = {};
  for (const key of Object.keys(fields) as RepairableKey[]) {
    if (!same(item[key], fields[key])) delta[key] = fields[key] ?? null;
  }
  return Object.keys(delta).length > 0 ? delta : null;
}
```

(`item[key]` requires the Task 5 type additions on `WatchlistItem`; implement Task 5 Step 1 first if tsc complains, or temporarily cast — prefer doing Task 5 Step 1 immediately after.)

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/watchlist/nextAirReadRepair.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/watchlist/nextAirReadRepair.ts src/lib/watchlist/nextAirReadRepair.test.ts
git commit -m "feat(watchlist)+test: nextAirReadRepair — ren compute/delta för next-air-denormalisering (instant week)"
```

---

### Task 5: Wire the write path — types, docToItem, collect/flush, one call site in useCalendar

**Files:**
- Modify: `src/types/domain.ts:57-71` (WatchlistItem)
- Modify: `src/contexts/WatchlistContext.tsx:12-39` (docToItem)
- Modify: `src/lib/watchlist/nextAirReadRepair.ts` (append collect/flush)
- Modify: `src/hooks/useCalendar.ts` (one effect)
- Test: extend `src/lib/watchlist/nextAirReadRepair.test.ts`

**Interfaces:**
- Produces on `WatchlistItem`: `nextAirDate?: string | null; nextAirCode?: string | null; nextAirProvider?: string | null; nextAirUpdatedAt?: Date | null; digitalReleaseDate?: string | null`.
- Produces: `collectNextAirUpdates(items: WatchlistItem[], shows: TMDBTVShow[], movies: TMDBMovie[]): Array<{ tmdbId: number; delta: Record<string, string | null> }>` (pure, testable) and `flushNextAirWrites(uid: string, updates: ReturnType<typeof collectNextAirUpdates>): Promise<void>` (Firestore, thin, untested-by-unit-test — the `buildStatusUpdate`/`setDoc` split precedent).

- [x] **Step 1: Type + docToItem additions**

`src/types/domain.ts`, after `runtime?: number | null;`:

```ts
  // Instant week (2026-07): denormaliserad next-air-data, skriven av
  // nextAirReadRepair (tyst read-repair — bumpar ALDRIG updatedAt). Hem-heron
  // seedas härifrån innan TMDB-fan-outen löst. null = "TMDB säger inget
  // kommande"; undefined = aldrig reparerad (fall tillbaka på live-datat).
  nextAirDate?: string | null;
  nextAirCode?: string | null;
  nextAirProvider?: string | null;
  nextAirUpdatedAt?: Date | null;
  digitalReleaseDate?: string | null;
```

`src/contexts/WatchlistContext.tsx` `docToItem`, after the `runtime` line:

```ts
    nextAirDate: (data.nextAirDate as string | undefined) ?? null,
    nextAirCode: (data.nextAirCode as string | undefined) ?? null,
    nextAirProvider: (data.nextAirProvider as string | undefined) ?? null,
    nextAirUpdatedAt: data.nextAirUpdatedAt ? toDate(data.nextAirUpdatedAt) : null,
    digitalReleaseDate: (data.digitalReleaseDate as string | undefined) ?? null,
```

- [x] **Step 2: Failing test for collectNextAirUpdates**

Append to `nextAirReadRepair.test.ts`:

```ts
import { collectNextAirUpdates } from './nextAirReadRepair';

describe('collectNextAirUpdates', () => {
  const show = showWith({
    next_episode_to_air: { air_date: '2026-07-09', season_number: 2, episode_number: 3 } as TMDBTVShow['next_episode_to_air'],
  });
  it('emits a delta for a stale item and nothing for a fresh one', () => {
    const stale = baseItem({ tmdbId: 1399 });
    const fresh = baseItem({ tmdbId: 42, nextAirDate: null, nextAirCode: null, nextAirProvider: null });
    const freshShow = showWith({ id: 42 });
    const updates = collectNextAirUpdates([stale, fresh], [show, freshShow], []);
    expect(updates).toHaveLength(1);
    expect(updates[0].tmdbId).toBe(1399);
    expect(updates[0].delta.nextAirDate).toBe('2026-07-09');
  });
  it('ignores shows not in the library', () => {
    expect(collectNextAirUpdates([], [show], [])).toHaveLength(0);
  });
});
```

Run: `npx vitest run src/lib/watchlist/nextAirReadRepair.test.ts` — expected FAIL (not exported).

- [x] **Step 3: Append collect/flush to nextAirReadRepair.ts**

```ts
export interface NextAirUpdate {
  tmdbId: number;
  delta: Partial<Record<RepairableKey, string | null>>;
}

export function collectNextAirUpdates(
  items: WatchlistItem[],
  shows: TMDBTVShow[],
  movies: TMDBMovie[],
): NextAirUpdate[] {
  const byId = new Map(items.map(i => [i.tmdbId, i]));
  const updates: NextAirUpdate[] = [];
  for (const show of shows) {
    const item = byId.get(show.id);
    if (!item || item.mediaType !== 'tv') continue;
    const delta = nextAirDelta(item, computeNextAirFields(show));
    if (delta) updates.push({ tmdbId: show.id, delta });
  }
  for (const movie of movies) {
    const item = byId.get(movie.id);
    if (!item || item.mediaType !== 'movie') continue;
    const delta = nextAirDelta(item, computeMovieReleaseFields(movie));
    if (delta) updates.push({ tmdbId: movie.id, delta });
  }
  return updates;
}

// Session-dedupe: en (uid, tmdbId) skrivs högst en gång per session — skyddar
// mot StrictMode-dubbeleffekter och re-render-churn. Markeras FÖRE await så
// en parallell flush inte dubblerar; en misslyckad batch får vänta till nästa
// session (best-effort, setRuntime-mönstret).
const writtenThisSession = new Set<string>();

export async function flushNextAirWrites(uid: string, updates: NextAirUpdate[]): Promise<void> {
  const pending = updates.filter(u => !writtenThisSession.has(`${uid}:${u.tmdbId}`));
  if (pending.length === 0) return;
  pending.forEach(u => writtenThisSession.add(`${uid}:${u.tmdbId}`));
  try {
    // Top-level `import { fsdb } from '@/lib/firebase/db';` i modulhuvudet —
    // db.ts är redan lat internt, så detta drar INTE in Firestore i bundlen.
    const { db, doc, writeBatch, serverTimestamp } = await fsdb();
    // Firestore-batchtak är 500 ops; chunka vid 450 (AuthContext-precedent).
    for (let i = 0; i < pending.length; i += 450) {
      const batch = writeBatch(db);
      for (const u of pending.slice(i, i + 450)) {
        batch.set(
          doc(db, 'users', uid, 'watchlist', String(u.tmdbId)),
          // OBS: ALDRIG updatedAt här — se modulhuvudet.
          { ...u.delta, nextAirUpdatedAt: serverTimestamp() },
          { merge: true },
        );
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[watchlist] next-air read-repair misslyckades:', err);
  }
}
```

(Import style: prefer a top-level `import { fsdb } from '@/lib/firebase/db';` — it's the standard pattern and db.ts is already lazy inside; use `const kit = await fsdb();` then destructure.)

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/watchlist/nextAirReadRepair.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [x] **Step 5: One call site in useCalendar.ts**

Add imports at the top of `src/hooks/useCalendar.ts`:

```ts
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { collectNextAirUpdates, flushNextAirWrites } from '@/lib/watchlist/nextAirReadRepair';
```

Inside `useCalendarEntries`, get `items` and `uid` (the hook already calls `useWatchlist()` — extend the destructure):

```ts
  const { getByStatus, items } = useWatchlist();
  const { uid } = useAuth();
```

After the `movies` memo, add the single read-repair effect:

```ts
  // Instant week (2026-07): ENDA anropsplatsen för next-air read-repair.
  // Debounce 1200 ms koalescerar fan-out-bursten till en batch; effekten
  // re-körs när fler shows/movies löser och omplanerar med större mängd.
  // Session-dedupe + no-op-diff bor i nextAirReadRepair. Avmontering
  // avbryter pending flush — best-effort, nästa besök reparerar.
  useEffect(() => {
    if (!uid || !enabled) return;
    const updates = collectNextAirUpdates(items, shows, movies);
    if (updates.length === 0) return;
    const t = setTimeout(() => { void flushNextAirWrites(uid, updates); }, 1200);
    return () => clearTimeout(t);
  }, [uid, enabled, items, shows, movies]);
```

CRITICAL: do NOT touch the `isLoading` computation (lines 153-161) or any query definition in this file.

- [x] **Step 6: Full verify**

Run: `npx tsc --noEmit && npx eslint src/hooks/useCalendar.ts src/lib/watchlist/nextAirReadRepair.ts src/contexts/WatchlistContext.tsx src/types/domain.ts && npm test`
Expected: clean; full suite (1338+) passes.

- [x] **Step 7: Commit**

```bash
git add src/types/domain.ts src/contexts/WatchlistContext.tsx src/lib/watchlist/nextAirReadRepair.ts src/lib/watchlist/nextAirReadRepair.test.ts src/hooks/useCalendar.ts
git commit -m "feat(watchlist): next-air read-repair — batchad, idempotent, aldrig updatedAt (instant week)"
```

---

### Task 6: Home seed read path — instant focal from denormalized fields

**Files:**
- Create: `src/lib/calendar/seedEntries.ts`
- Test: `src/lib/calendar/seedEntries.test.ts`
- Modify: `src/app/page.tsx` (Dashboard)

**Interfaces:**
- Consumes: `WatchlistItem` next-air fields (Task 5), `CalendarEntry` union from `@/lib/calendar/types`.
- Produces: `seedCalendarEntries(items: WatchlistItem[]): CalendarEntry[]` — thin, upcoming-only entries feeding the SAME `pickFocalEntry`/`HemHero`/`HemFocal` path.

- [x] **Step 1: Failing tests**

`src/lib/calendar/seedEntries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { seedCalendarEntries } from './seedEntries';
import type { WatchlistItem } from '@/types';

const item = (over: Partial<WatchlistItem>): WatchlistItem => ({
  tmdbId: 1399, mediaType: 'tv', status: 'mina', rating: null, notes: null,
  title: 'Test', posterPath: '/p.jpg', releaseYear: null, totalSeasons: null,
  lastWatchedSeason: null, lastWatchedEpisode: null, dropped: false,
  rewatchCount: 0, providers: [], providersCheckedAt: null, visibility: null,
  genreIds: [18], tmdbStatus: null, runtime: null,
  addedAt: new Date(0), updatedAt: new Date(0), watchedAt: null,
  ...over,
});

describe('seedCalendarEntries', () => {
  it('builds an episode entry from denormalized next-air fields', () => {
    const entries = seedCalendarEntries([item({
      nextAirDate: '2999-01-05', nextAirCode: 'S2E03', nextAirProvider: 'HBO Max',
    })]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.kind).toBe('episode');
    expect(e.airDate).toBe('2999-01-05');
    if (e.kind === 'episode') {
      expect(e.season).toBe(2);
      expect(e.episode).toBe(3);
      expect(e.provider).toBe('HBO Max');
    }
  });
  it('builds a movie entry from digitalReleaseDate (vill_se only)', () => {
    const entries = seedCalendarEntries([item({
      tmdbId: 603, mediaType: 'movie', status: 'vill_se', digitalReleaseDate: '2999-02-01',
    })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('movie');
  });
  it('skips past dates, unparsable codes, dropped items and unrepaired items', () => {
    expect(seedCalendarEntries([
      item({ nextAirDate: '2000-01-01', nextAirCode: 'S1E01' }),          // past
      item({ tmdbId: 2, nextAirDate: '2999-01-05', nextAirCode: 'kaos' }), // unparsable
      item({ tmdbId: 3, nextAirDate: '2999-01-05', nextAirCode: 'S1E01', dropped: true }),
      item({ tmdbId: 4 }),                                                 // never repaired
    ])).toHaveLength(0);
  });
});
```

Run: `npx vitest run src/lib/calendar/seedEntries.test.ts` — expected FAIL (module not found).

- [x] **Step 2: Implement `src/lib/calendar/seedEntries.ts`**

```ts
import { formatEpisodeCode } from '@/lib/utils';
import type { WatchlistItem } from '@/types';
import type { CalendarEntry } from './types';

// Instant week (2026-07): tunna kalender-seeds från de denormaliserade
// next-air-fälten på watchlist-items. Matar SAMMA pickFocalEntry/HemHero-
// render-väg som de fulla TMDB-entrisarna — en render-väg, två datakällor.
// Live-fan-outen ersätter seedsen per titel när den löst (page.tsx unionerar
// med live-företräde). Endast framtida datum: ett passerat nextAirDate
// betyder bara att read-repairen inte hunnit ikapp — aldrig ett "i dag"-hero.

const CODE_RE = /^S(\d+)E(\d+)$/;

export function seedCalendarEntries(items: WatchlistItem[], now: Date = new Date()): CalendarEntry[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${m}-${d}`;

  const out: CalendarEntry[] = [];
  for (const item of items) {
    if (item.dropped) continue;
    if (item.mediaType === 'tv' && item.status === 'mina' && item.nextAirDate && item.nextAirDate >= todayKey) {
      const match = CODE_RE.exec(item.nextAirCode ?? '');
      if (!match) continue;
      const season = Number(match[1]);
      const episode = Number(match[2]);
      out.push({
        kind: 'episode',
        mediaType: 'tv',
        tmdbId: item.tmdbId,
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: null,
        season,
        episode,
        episodeCode: formatEpisodeCode(season, episode),
        episodeName: undefined,
        episodeOverview: undefined,
        airDate: item.nextAirDate,
        provider: item.nextAirProvider ?? undefined,
        runtime: undefined,
        isPremiere: episode === 1,
        isFinale: false,
        genreIds: item.genreIds,
      });
    } else if (item.mediaType === 'movie' && item.status === 'vill_se' && item.digitalReleaseDate && item.digitalReleaseDate >= todayKey) {
      out.push({
        kind: 'movie',
        mediaType: 'movie',
        releaseType: 'digital',
        tmdbId: item.tmdbId,
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: null,
        airDate: item.digitalReleaseDate,
        provider: undefined,
        overview: undefined,
        runtime: undefined,
        genreIds: item.genreIds,
      });
    }
  }
  return out;
}
```

Check `src/lib/calendar/types.ts` for the exact `EpisodeEntry`/`MovieEntry` required/optional properties and match them precisely (adjust optional keys rather than inventing).

- [x] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/calendar/seedEntries.test.ts`
Expected: PASS.

- [x] **Step 4: Use seeds in Dashboard (page.tsx)**

In `Dashboard()`:

```tsx
import { seedCalendarEntries } from '@/lib/calendar/seedEntries';
```

Replace the entries/focal derivation:

```tsx
  // Instant week: medan fan-outen löser unioneras tunna seeds (denormaliserad
  // next-air-data från watchlisten) med live-entries — live vinner per titel.
  // Efter full load används ENBART live-datat. Samma pickFocalEntry-väg.
  const effectiveEntries = useMemo(() => {
    if (!calendarLoading) return calendarEntries;
    const liveIds = new Set(calendarEntries.map(e => e.tmdbId));
    const seeds = seedCalendarEntries(items).filter(s => !liveIds.has(s.tmdbId));
    return [...calendarEntries, ...seeds];
  }, [calendarLoading, calendarEntries, items]);

  const { focal, totalThisWeek } = useMemo(() => {
    const focal = pickFocalEntry(effectiveEntries);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);
    const totalThisWeek = effectiveEntries.filter(e => {
      const d = new Date(e.airDate + 'T00:00:00');
      return d >= today && d < weekAhead;
    }).length;
    return { focal, totalThisWeek };
  }, [effectiveEntries]);
```

(`continueWatching` MUST keep using the raw `calendarEntries` — seeds carry no aired-episode history; check its memo still reads `calendarEntries`.)

JustWatch attribution (Legal condition 8): the credit must be in view as soon as a seed focal shows a provider name. Change the gate:

```tsx
      {hasLibrary && (shownFocal != null || !detailLoading) && (
        <div style={{ marginTop: 16 }}>
          <JustWatchCredit />
        </div>
      )}
```

- [x] **Step 5: Full verify**

Run: `npx tsc --noEmit && npx eslint src/app/page.tsx src/lib/calendar/seedEntries.ts && npm test`
Expected: clean, full suite passes.

- [x] **Step 6: Commit**

```bash
git add src/lib/calendar/seedEntries.ts src/lib/calendar/seedEntries.test.ts src/app/page.tsx
git commit -m "feat(home): seeda Din vecka-heron momentant från denormaliserad next-air-data (instant week)"
```

---

### Task 7: Docs — data-export-format.md field table

**Files:**
- Modify: `docs/data-export-format.md` (watchlist field enumeration, ~line 47)

- [x] **Step 1: Update the watchlist field list**

Find the watchlist sub-field enumeration (grep `rewatchCount` in the file) and extend it to also name: `providers`, `providersCheckedAt` (pre-existing documentation gap), `runtime`, `nextAirDate`, `nextAirCode`, `nextAirProvider`, `nextAirUpdatedAt`, `digitalReleaseDate` — described as "TMDB-metadata cachead som bekvämlighet (denormaliserad; ingår i exporten)". Match the file's existing prose style.

- [x] **Step 2: Commit**

```bash
git add docs/data-export-format.md
git commit -m "docs(gdpr): dokumentera denormaliserade TMDB-fält i watchlist-exporten (instant week + befintlig providers-lucka)"
```

---

### Task 8: Review gates, ship, live re-measure

**Files:** none new — verification and deploy.

- [x] **Step 1: Commit-gate reviewers (opus, per global model rule)**

Dispatch `binge-code-reviewer` AND `binge-security-reviewer` AND `binge-test-reviewer` (model: opus) over the accumulated diff (`git diff 168e07e..HEAD` scope: this plan's commits). Blocking findings → fix, new commit, re-review. Key review pointers: acceptance criteria 1-9 in the spec; especially no-`updatedAt` (criterion 2), advisor untouched (criterion 5), rules already deployed (criterion 1).

- [x] **Step 2: Full local gates**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: all green.

- [x] **Step 3: Ship via /commit flow**

Push to main (deploy.yml runs quality gates + hosting deploy; rules were already deployed in Task 2). Wait for the run to complete (~15-20 min), then purge Cloudflare.

- [x] **Step 4: Live re-measure (Chrome MCP, logged-in binge.nu)**

Reload `https://binge.nu`, then evaluate: time/order of hero content vs TMDB request count (baseline: hero at ~19/216 requests; target: hero + weekly count correct BEFORE any TMDB response, i.e. from the Firestore snapshot). Also verify in the network log that repeat reloads produce ~0 next-air Firestore writes (idempotence in prod).

- [x] **Step 5: Update memory + mark BIN-402 unaffected**

Update `project_home_perf_progressive_hero.md` memory: Phase B shipped, note the denormalized fields exist and the sweep ticket BIN-402 now has real fields to cover.
