# Binge.nu — UI/UX Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed findings from `design-audit/UI-UX-Audit.md` — one functional bug (calendar drops upcoming episodes), several consistency/correctness issues, UI polish, and stale design docs.

**Architecture:** Each task is self-contained and independently committable. Logic-bearing fixes follow TDD (extract pure helper → failing test → implement → pass). UI/CSS/doc fixes are direct edits with exact diffs + manual/typecheck verification. Phases A (functional) → B (polish) → C (docs/housekeeping) can be executed in any order; within a phase, tasks are independent unless noted.

**Tech Stack:** Next.js 14 (App Router, static export), TypeScript, Tailwind, React Query v5, Firebase, Vitest + @testing-library/react + jsdom.

**Verification commands (run from `C:\binge`):**
- `npm run typecheck` — tsc --noEmit
- `npm test` — Vitest run
- `npm run lint` — ESLint
- `npm run build` — production static export (heavy; run before final merge)

---

## File Structure (what each task touches)

| Task | Files |
|---|---|
| A1 Calendar upcoming episode | **Create** `src/lib/calendar/buildEntries.ts`, `src/lib/calendar/buildEntries.test.ts`; **Modify** `src/hooks/useCalendar.ts` |
| A2 `/my/series` count | **Modify** `src/components/WatchlistPage.tsx` |
| A3 Stats denominator | **Modify** `src/app/stats/page.tsx` |
| A4 Legal doubled titles | **Modify** `src/app/villkor/page.tsx`, `src/app/integritet/page.tsx`, `src/app/community-guidelines/page.tsx` |
| A5 Missing page titles | **Modify** `src/components/pages/UserProfilePageClient.tsx`, `src/components/pages/ListPageClient.tsx`; **Create** `src/app/tillsammans/ny/layout.tsx`; **Modify** the 6 `src/app/my/*/page.tsx` (or add `usePageMeta`) |
| A6 "Kort" default-view | **Modify** `src/types/domain.ts`, `src/components/settings/DisplaySection.tsx` |
| A7 HBO Max / Max dedupe | **Modify** `src/lib/tmdb/providers.ts` |
| A8 Nav active state on /discover | **Modify** the Subnav component (`src/components/layout/Subnav.tsx`) |
| B1 Rating empty-state text | **Modify** `src/components/WatchlistPage.tsx` |
| B2 Redundant filter tabs | **Modify** `src/components/WatchlistPage.tsx` |
| B3 Groups single CTA | **Modify** `src/app/grupper/page.tsx` |
| B4 "Ta bort" as button | **Modify** `src/app/my/lists/page.tsx` |
| B5 Provider page heading/title | **Modify** `src/components/pages/ProviderPageClient.tsx` |
| B6 Season progress loading state | **Modify** `src/components/pages/SeasonPageClient.tsx` |
| C1 Shared PageHeader | **Create** `src/components/layout/PageHeader.tsx`; **Modify** ~9 outlier pages |
| C2 CLAUDE.md rewrite | **Modify** `CLAUDE.md` |
| C3 Dead tokens / hover transform | **Modify** `tailwind.config.ts`, `src/app/globals.css` |

---

# PHASE A — Functional & correctness

## Task A1: Calendar — surface upcoming episodes from `next_episode_to_air`

**Root cause:** `useCalendar.ts` builds entries only from a single fetched season's `episodes[]` (skipping any without `air_date`) and fetches that season using `number_of_seasons` (a count) as the season *number*. The authoritative `show.next_episode_to_air` is never consulted, so upcoming episodes (e.g. Sullivan's Crossing S4E10 / 2026-05-31) vanish from the grid, the date-strip and the home hero — while the TV-detail page and advisor (which read `next_episode_to_air`) show them.

**Files:**
- Create: `src/lib/calendar/buildEntries.ts`
- Test: `src/lib/calendar/buildEntries.test.ts`
- Modify: `src/hooks/useCalendar.ts:13-29` (move type), `:73-79` (seasonNum), `:113-159` (use pure fn)

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar/buildEntries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCalendarEntries, type SeasonDatum } from './buildEntries';
import type { TMDBTVShow, TMDBEpisode } from '@/types';

function ep(partial: Partial<TMDBEpisode>): TMDBEpisode {
  return {
    id: 1, episode_number: 1, season_number: 1, name: 'Ep', overview: '',
    air_date: '2026-05-25', still_path: null, vote_average: 0, runtime: 44,
    ...partial,
  };
}

function show(partial: Partial<TMDBTVShow>): TMDBTVShow {
  return {
    id: 100, name: 'Test Show', original_name: 'Test Show', number_of_seasons: 4,
    poster_path: '/p.jpg', backdrop_path: '/b.jpg', genres: [{ id: 18, name: 'Drama' }],
    status: 'Returning Series', seasons: [], next_episode_to_air: null,
    last_episode_to_air: null,
    // @ts-expect-error — test fixture only needs the fields buildCalendarEntries reads
    'watch/providers': { results: { SE: { flatrate: [] } } },
    ...partial,
  } as TMDBTVShow;
}

describe('buildCalendarEntries', () => {
  it('seeds an entry from next_episode_to_air when the season array lacks it', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31', name: 'Finale' }) }),
      season: { episodes: [ep({ season_number: 4, episode_number: 9, air_date: '2026-05-24' })] },
    }];
    const entries = buildCalendarEntries(data);
    const upcoming = entries.find(e => e.season === 4 && e.episode === 10);
    expect(upcoming).toBeDefined();
    expect(upcoming!.airDate).toBe('2026-05-31');
  });

  it('does not duplicate when the season array already contains the upcoming episode', () => {
    const e10 = ep({ season_number: 4, episode_number: 10, air_date: '2026-05-31' });
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: e10 }),
      season: { episodes: [e10] },
    }];
    const entries = buildCalendarEntries(data);
    expect(entries.filter(e => e.season === 4 && e.episode === 10)).toHaveLength(1);
  });

  it('handles a null next_episode_to_air without crashing', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '2026-05-26' })] },
    }];
    expect(buildCalendarEntries(data)).toHaveLength(1);
  });

  it('skips episodes with no air_date', () => {
    const data: SeasonDatum[] = [{
      showId: 100,
      show: show({ next_episode_to_air: null }),
      season: { episodes: [ep({ episode_number: 1, air_date: '' })] },
    }];
    expect(buildCalendarEntries(data)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- buildEntries`
Expected: FAIL — `Cannot find module './buildEntries'`.

- [ ] **Step 3: Create the pure implementation**

Create `src/lib/calendar/buildEntries.ts`:

```ts
import { getProvider } from '@/lib/tmdb/providers';
import { formatEpisodeCode } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import type { TMDBTVShow, TMDBEpisode } from '@/types';
import type { CalendarEntry } from '@/hooks/useCalendar';

export interface SeasonDatum {
  showId: number;
  show: TMDBTVShow;
  season: { episodes: TMDBEpisode[] } | null;
}

/**
 * Bygger CalendarEntry[] från hämtade säsonger PLUS show.next_episode_to_air.
 * Seedingen från next_episode_to_air är fixen för att kommande avsnitt inte
 * ska tappas när TMDB:s säsong-episodes-array släpar efter show-nivåns
 * next_episode_to_air. Dedupe på `${tmdbId}-S{n}E{n}` så ett seedat avsnitt
 * aldrig dubblerar ett som redan finns i säsong-arrayen.
 */
export function buildCalendarEntries(seasonData: SeasonDatum[]): CalendarEntry[] {
  const result: CalendarEntry[] = [];
  const seen = new Set<string>();
  const key = (id: number, s: number, e: number) => `${id}-S${s}E${e}`;

  for (const item of seasonData) {
    const { show } = item;
    const flatrate = show['watch/providers']?.results?.SE?.flatrate?.[0];
    const providerName = flatrate
      ? (getProvider(flatrate.provider_id)?.shortName ?? flatrate.provider_name)
      : undefined;
    const showGenreIds = show.genres?.map(g => g.id) ?? [];
    const episodes = item.season?.episodes ?? [];
    const finaleEp = episodes.length > 0
      ? Math.max(...episodes.map(e => e.episode_number))
      : 0;

    const push = (ep: TMDBEpisode) => {
      if (!ep.air_date) return;
      const k = key(show.id, ep.season_number, ep.episode_number);
      if (seen.has(k)) return;
      seen.add(k);
      result.push({
        tmdbId: show.id,
        title: preferOriginalTitle(show.name, show.original_name),
        posterPath: show.poster_path,
        backdropPath: ep.still_path ?? show.backdrop_path ?? null,
        season: ep.season_number,
        episode: ep.episode_number,
        episodeCode: formatEpisodeCode(ep.season_number, ep.episode_number),
        episodeName: ep.name,
        episodeOverview: ep.overview ?? undefined,
        airDate: ep.air_date,
        provider: providerName,
        runtime: ep.runtime ?? undefined,
        isPremiere: ep.episode_number === 1,
        isFinale: finaleEp > 0 && ep.episode_number === finaleEp,
        genreIds: showGenreIds,
      });
    };

    for (const ep of episodes) push(ep);
    if (show.next_episode_to_air) push(show.next_episode_to_air);
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- buildEntries`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the hook to the pure function + fix the season number**

In `src/hooks/useCalendar.ts`:

1. Add the import near the top (after line 10):
```ts
import { buildCalendarEntries } from '@/lib/calendar/buildEntries';
```

2. Replace `seasonNum` derivation (line 76) so it targets the airing season, not the count:
```ts
      seasonNum: show.next_episode_to_air?.season_number ?? show.number_of_seasons,
```

3. Replace the entire inline entries `useMemo` body (lines 113-159) with:
```ts
  const entries: CalendarEntry[] = useMemo(
    () => buildCalendarEntries(seasonData),
    [seasonData]
  );
```
(Leave the `CalendarEntry` interface export at lines 13-29 in place — `buildEntries.ts` type-imports it, so the runtime dependency stays one-way: hook → buildEntries.)

- [ ] **Step 6: Verify nothing else broke**

Run: `npm run typecheck && npm test`
Expected: PASS. (`formatEpisodeCode`, `preferOriginalTitle`, `getProvider` are pure and already imported by the old hook code, so they resolve.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar/buildEntries.ts src/lib/calendar/buildEntries.test.ts src/hooks/useCalendar.ts
git commit -m "fix(calendar): surface upcoming episodes from next_episode_to_air

Calendar only built entries from a single fetched season's episode array
(skipping ones without air_date) and fetched that season using
number_of_seasons as a season number. Upcoming episodes TMDB exposes only
via show.next_episode_to_air were silently dropped from the grid/strip/home.
Extract a pure buildCalendarEntries() that also seeds from next_episode_to_air
(deduped), and fetch the actual airing season."
```

---

## Task A2: `/my/series` — reconcile the 194-vs-173 count

**Root cause:** the subtitle (`buildStandfirst`) counts all `status==='mina'` items including stray **movie** items, but the rendered card sections (`followingSections`) are **TV-only** (`WatchlistPage.tsx:150`). The 21-item gap is movie items counted but never rendered. Also `totalCount` (`:133`) doesn't exclude dropped items the way `filtered` does.

**Files:** Modify `src/components/WatchlistPage.tsx:133,158`

- [ ] **Step 1: Align `totalCount` with `filtered`'s dropped-exclusion**

Replace line 133:
```ts
  const totalCount = status ? items.filter(i => i.status === status).length : items.length;
```
with:
```ts
  const totalCount = status
    ? items.filter(i => i.status === status && (status !== 'mina' || !i.dropped)).length
    : items.length;
```

- [ ] **Step 2: Make the subtitle count the TV-only set that the 'mina' view actually renders**

Replace line 158:
```ts
  const standfirst = buildStandfirst(filtered.length, totalCount, status, mediaFilter);
```
with:
```ts
  // På /my/series (status==='mina') renderas endast TV-titlar i sektionerna
  // (followingSections filtrerar bort movie-items). Räkna samma mängd i
  // standfirst så subtitle (194) inte säger mer än sektionerna visar (173).
  const tvVisibleCount = filtered.filter(i => i.mediaType === 'tv').length;
  const standfirst = status === 'mina'
    ? buildStandfirst(tvVisibleCount, tvVisibleCount, status, mediaFilter)
    : buildStandfirst(filtered.length, totalCount, status, mediaFilter);
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS. Manual: load `/my/series` — subtitle count now equals the sum of the section badges.

- [ ] **Step 4: Commit**

```bash
git add src/components/WatchlistPage.tsx
git commit -m "fix(library): /my/series subtitle counts TV-only set that is rendered

Subtitle counted all 'mina'-status items (incl. stray movie items) while the
card sections render TV only, producing 194 vs 173. Count the rendered TV set
for the 'mina' subtitle and exclude dropped items from totalCount."
```

> **Note for reviewer:** the deeper question is *why* movie items have `status==='mina'` (legacy/migration data — see CLAUDE.md migration notes and `FollowingCardSections.tsx:9-15`, whose doc-comment claims non-TV titles fold into "Ligger efter" but `WatchlistPage.tsx:150` filters them out). If those movie items should be surfaced rather than hidden, that's a separate, larger change; this task only reconciles the visible count.

---

## Task A3: Stats — fix the "Baserat på 0 av N titlar" denominator

**Root cause:** the bars aggregate `item.providers`, but the note's denominator counts `item.providersCheckedAt` (`stats/page.tsx:53`) — a field `addItem` never sets (only the taste-backfill writes it). So users who added titles without running backfill see "0" even though bars render counts.

**Files:** Modify `src/app/stats/page.tsx:53`

- [ ] **Step 1: Count items that actually have provider data**

Replace line 53:
```ts
    const withProviderData = items.filter(i => i.providersCheckedAt != null).length;
```
with:
```ts
    // "Med streaming-data" = titlar vi faktiskt har SE-providers för. Räkna
    // providers-arrayen (som staplarna använder) ELLER providersCheckedAt —
    // addItem sätter providers men inte providersCheckedAt, så enbart
    // providersCheckedAt gav felaktigt "0 av N" trots att staplar visas.
    const withProviderData = items.filter(
      i => (i.providers?.length ?? 0) > 0 || i.providersCheckedAt != null
    ).length;
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: PASS. Manual: `/stats` "Streamingtjänster" note no longer says "0 av N" when bars are populated.

- [ ] **Step 3: Commit**

```bash
git add src/app/stats/page.tsx
git commit -m "fix(stats): count items with providers for the streaming-data denominator

The 'Baserat på 0 av N titlar' note counted providersCheckedAt, which addItem
never sets, contradicting the populated per-service bars. Count items with a
non-empty providers array too."
```

---

## Task A4: Legal pages — remove the doubled "— Binge.nu" title suffix

**Root cause:** the root layout defines `title.template = '%s — Binge.nu'`. Each legal `page.tsx` exports `metadata.title` that *already* ends in "— Binge.nu", so the template wraps it again → "Användarvillkor — Binge.nu — Binge.nu". The sibling `layout.tsx` files already set the correct bare title.

**Files:** Modify `src/app/villkor/page.tsx:5-9`, `src/app/integritet/page.tsx`, `src/app/community-guidelines/page.tsx`

- [ ] **Step 1: Drop the redundant `title` from each legal `page.tsx` metadata**

In `src/app/villkor/page.tsx`, change the metadata export (lines 5-9) to keep only `description` (the bare title comes from `villkor/layout.tsx` + the root template):
```ts
export const metadata: Metadata = {
  description:
    'Villkor för användning av Binge.nu — bevakningstjänst för film och TV-serier i Sverige.',
};
```

Apply the same edit to `src/app/integritet/page.tsx` and `src/app/community-guidelines/page.tsx` — **delete the `title:` line, keep `description`.** (Verify each sibling `layout.tsx` already sets the intended bare title; `villkor/layout.tsx:4` sets `'Användarvillkor'`. If a `layout.tsx` is missing for integritet/community-guidelines, instead strip the suffix from the page title — e.g. `title: 'Integritetspolicy'` — so the root template adds it once.)

- [ ] **Step 2: Verify**

Run: `npm run build` then inspect — or manual: load `/villkor`, `/integritet`, `/community-guidelines`; the browser tab title reads "… — Binge.nu" exactly once.

- [ ] **Step 3: Commit**

```bash
git add src/app/villkor/page.tsx src/app/integritet/page.tsx src/app/community-guidelines/page.tsx
git commit -m "fix(meta): stop doubling '— Binge.nu' on legal page titles

Page-level metadata hard-coded the suffix the root title template also adds.
Drop the redundant title; the bare layout title + template render it once."
```

---

## Task A5: Add per-page titles to profiles, lists, tillsammans, and /my/* sub-routes

**Root cause:** `/user/[username]`, `/list/[id]` (catch-all client routes) and `/tillsammans/ny` (client page, no layout metadata) never set a title, so they show the generic root default. All `/my/*` sub-routes inherit `my/layout.tsx`'s single "Mina listor". `usePageMeta` (`:88`) appends "— Binge.nu", so callers pass a **bare** title.

**Files:** Modify `src/components/pages/UserProfilePageClient.tsx`, `src/components/pages/ListPageClient.tsx`; Create `src/app/tillsammans/ny/layout.tsx`; add `usePageMeta` to the 6 `/my/*` pages.

- [ ] **Step 1: Title the public profile**

In `src/components/pages/UserProfilePageClient.tsx`, add the import (after line 4):
```ts
import { usePageMeta } from '@/hooks/usePageMeta';
```
Then, immediately after the data/hook calls and **before** the early returns (after line 37, `const taste = ...`), add (hooks must run unconditionally):
```ts
  const metaTitle = data && 'profile' in data ? data.profile.displayName : `@${username}`;
  usePageMeta({ title: metaTitle });
```

- [ ] **Step 2: Title the list page**

In `src/components/pages/ListPageClient.tsx`, add the import (after line 11):
```ts
import { usePageMeta } from '@/hooks/usePageMeta';
```
Then, after the data hooks and **before** the early returns (after line 22, `const isOwner = ...`), add:
```ts
  usePageMeta({ title: list?.title ?? 'Lista' });
```

- [ ] **Step 3: Title the Tillsammans create page**

Create `src/app/tillsammans/ny/layout.tsx` (the page is a client component and can't export `metadata`):
```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tillsammans ikväll',
  robots: { index: false, follow: false },
};

export default function TillsammansNyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 4: Title each /my/* sub-route**

Each `/my/*` page renders `WatchlistPage` with a `title` prop. Add a matching `usePageMeta` call in each `src/app/my/<route>/page.tsx`. Example for `src/app/my/series/page.tsx`:
```tsx
'use client';
import { usePageMeta } from '@/hooks/usePageMeta';
// ...existing imports...

export default function MySeriesPage() {
  usePageMeta({ title: 'Följer' });
  return <WatchlistPage status="mina" title="Följer" />; // existing markup
}
```
Apply with the page's own label as the bare title: `Följer` (series), `Mina filmer` (films), `Vill se` (want-to-watch), `Avbrutna` (avbrutna), `Hela biblioteket` (all), `Mina listor` (lists). Add `'use client'` only if not already present (these are already client pages).

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: PASS. Manual: each tab title is now specific and single-suffixed; private/not-found profiles fall back to `@username`.

- [ ] **Step 6: Commit**

```bash
git add src/components/pages/UserProfilePageClient.tsx src/components/pages/ListPageClient.tsx src/app/tillsammans/ny/layout.tsx src/app/my
git commit -m "fix(meta): per-page titles for profiles, lists, tillsammans, /my/* routes

Shareable/public pages and all /my/* sub-routes inherited the generic root
title. Add usePageMeta (bare titles; the hook appends the suffix) and a
tillsammans/ny layout."
```

> **Optional enhancement (separate commit):** public profiles are shareable — pass `indexable: profileIsPublic` to `usePageMeta` in Step 1 so public profiles become crawlable while private ones stay noindex. Skipped here to keep the privacy surface unchanged; raise with product first.

---

## Task A6: Settings "Visning" — add the missing "Kort" mode

**Root cause:** the library has 3 view modes (`'table' | 'grid' | 'cards'`) but `UserProfile.defaultView` is typed `'table' | 'grid'` (`domain.ts:97`), so the settings toggle (`DisplaySection.tsx:16,26`) can only offer two.

**Files:** Modify `src/types/domain.ts:97`, `src/components/settings/DisplaySection.tsx:16,26`

- [ ] **Step 1: Widen the type**

In `src/types/domain.ts`, change line 97:
```ts
  defaultView: 'table' | 'grid';
```
to:
```ts
  defaultView: 'table' | 'grid' | 'cards';
```
(Existing stored values `'table'`/`'grid'` remain valid — no migration needed. Confirm `updateDefaultView` in `AuthContext`/`useAuth` types its arg as `UserProfile['defaultView']`; if it hard-codes the union, widen it there too.)

- [ ] **Step 2: Add the option to the toggle**

In `src/components/settings/DisplaySection.tsx`, change line 16:
```ts
        {(['table', 'grid'] as const).map(v => (
```
to:
```ts
        {(['table', 'cards', 'grid'] as const).map(v => (
```
and change the label expression (line 26):
```ts
            {v === 'table' ? 'Tabell' : 'Rutnät'}
```
to:
```ts
            {v === 'table' ? 'Tabell' : v === 'cards' ? 'Kort' : 'Rutnät'}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS. Manual: Settings → Visning shows Tabell / Kort / Rutnät; selecting Kort persists and applies on non-'mina' library tabs (`WatchlistPage.tsx:102`).

- [ ] **Step 4: Commit**

```bash
git add src/types/domain.ts src/components/settings/DisplaySection.tsx
git commit -m "feat(settings): add 'Kort' to the default-view toggle

Library supports table/cards/grid but defaultView was typed table|grid, so the
Visning setting was missing the Kort mode. Widen the type and add the option."
```

---

## Task A7: Dedupe HBO Max / Max in the provider list

**Root cause:** `providers.ts` has two separate flatrate entries — id `384` "HBO Max" and id `1899` "Max" — with no alias link, so the service picker (`/tillsammans/ny`) shows both.

**Files:** Modify `src/lib/tmdb/providers.ts:47-92`

- [ ] **Step 1: Pick the canonical entry and alias the other**

> **Decision:** As of 2026 the service is branded **"HBO Max"** again, so keep id `384` (HBO Max) as canonical and fold `1899` into it. (If the team prefers "Max", do the inverse — the mechanics are identical.)

In `src/lib/tmdb/providers.ts`, add `aliases: [1899]` to the HBO Max entry (line 48):
```ts
  {
    id: 384, name: 'HBO Max', shortName: 'HBO', color: '#7B2FBE', type: 'flatrate', defaultMonthlyCost: 149,
    aliases: [1899],
    tiers: [
      { id: 'ads', name: 'Basic med reklam', cost: 89 },
      { id: 'standard', name: 'Standard', cost: 149 },
      { id: 'premium', name: 'Premium', cost: 189 },
    ],
  },
```
Then **delete** the separate `Max` entry (lines 85-92, the `{ id: 1899, name: 'Max', ... }` block). The `PROVIDER_MAP` builder (`:123-130`) already maps every alias id to the canonical provider, so `getProvider(1899)` returns HBO Max and the picker (which iterates `SWEDISH_PROVIDERS`) shows it once.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: PASS (check no existing provider test asserts id 1899 is its own entry; if one does, update it to expect the alias).
Manual: `/tillsammans/ny` shows a single HBO Max checkbox.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tmdb/providers.ts
git commit -m "fix(providers): dedupe HBO Max (384) and Max (1899) into one entry

TMDB exposes both ids; collapse 1899 as an alias of the canonical HBO Max so
the service picker and provider mapping no longer show a duplicate."
```

---

## Task A8: Fix nav active-state on `/discover`

**Root cause:** the top Subnav highlights "Rekommendationer" while on `/discover` (Utforska has no own nav item / its path isn't matched).

**Files:** Modify the Subnav component (`src/components/layout/Subnav.tsx` — confirm exact path).

- [ ] **Step 1: Locate the active-link logic**

Run: `npm run lint -- --no-eslintrc 2>/dev/null; grep -rn "Rekommendationer\|pathname" src/components/layout/Subnav.tsx` (or open the file). Identify how the active item is computed (likely `pathname.startsWith(item.href)` against a links array containing `/recommendations`).

- [ ] **Step 2: Decide and implement**

`/discover` is conceptually "Utforska", distinct from "Rekommendationer". Two acceptable fixes — pick one:
- **(a) Give Utforska its own nav entry** if product wants it discoverable: add `{ label: 'Utforska', href: '/discover' }` to the links array next to Rekommendationer.
- **(b) Stop mis-highlighting**: ensure the active-match for the Rekommendationer item is `pathname.startsWith('/recommendations')` (exact-prefix) so `/discover` doesn't match it; `/discover` then shows no active nav item (acceptable, it's reached via links not the nav).

Implement (b) if no nav entry for Utforska is desired: change the active check so each link matches only its own `href` prefix, not a broader catch.

- [ ] **Step 3: Verify**

Manual: navigate to `/discover` — "Rekommendationer" is no longer underlined as active (or "Utforska" is, if you chose (a)). Navigate to `/recommendations` — it is active.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Subnav.tsx
git commit -m "fix(nav): /discover no longer mis-highlights the Rekommendationer tab"
```

---

# PHASE B — UI polish

## Task B1: Table rating empty-state — show "Ej betygsatt"

**Root cause:** the table BETYG cell (`WatchlistPage.tsx:438-448`) always renders the readonly 5-outline `RatingStars` widget for unrated rows; orange-stroked hollow stars can read as "rated". The card view shows "Ej betygsatt" text instead.

**Files:** Modify `src/components/WatchlistPage.tsx:438-449`

- [ ] **Step 1: Conditionally render the empty state (keep inline rating editable when rated)**

Replace the BETYG `<td>` body (lines 439-448) with:
```tsx
                      <span className="inline-flex items-center gap-[4px]">
                        <RatingStars
                          rating={item.rating}
                          onChange={r => updateRating(item.tmdbId, r)}
                          size="sm"
                          dim={item.rating === null}
                        />
                        {item.rating !== null && (
                          <span className="text-xxs text-text-muted">{item.rating.toFixed(1)}</span>
                        )}
                      </span>
```
Add a `dim?: boolean` prop to `RatingStars` (`src/components/title/RatingStars.tsx`): when `dim` is true and the rating is null, render the outline stars in `text-text-muted` instead of `text-accent` (change the wrapper `className` at line ~20 to `dim ? 'text-text-muted' : 'text-accent'`). This keeps inline rating working but stops an unrated row from looking pre-rated.

> Alternative (simpler, if inline-rate-from-table isn't valued): replace the stars with `<span className="text-xxs text-text-muted/60">Ej betygsatt</span>` when `item.rating === null`, mirroring `WatchlistCard.tsx:104-111`.

- [ ] **Step 2: Verify**

Run: `npm run typecheck`. Manual: `/my/want-to-watch` (all unrated) — stars are visibly muted (or "Ej betygsatt"), distinct from rated rows.

- [ ] **Step 3: Commit**

```bash
git add src/components/WatchlistPage.tsx src/components/title/RatingStars.tsx
git commit -m "polish(library): dim the table rating widget for unrated rows"
```

## Task B2: Hide redundant type-filter tabs on type-specific lists

**Root cause:** `/my/films` (and other type-specific lists) still render the "Alla/Serier/Film" tabs (`WatchlistPage.tsx:206-219`).

**Files:** Modify `src/components/WatchlistPage.tsx:206`

- [ ] **Step 1:** The tabs are already gated on `status !== 'mina'`. Extend the guard so they also hide on the film-only (`'sedd'`) status. Change line 206 `{status !== 'mina' && (` to:
```tsx
        {status !== 'mina' && status !== 'sedd' && (
```
(Leaves the tabs on `/my/all` and `/my/vill-se` where mixed types are expected; hides them on `/my/films`.)

- [ ] **Step 2: Verify** — Manual: `/my/films` no longer shows a "Serier" filter; `/my/all` still does.
- [ ] **Step 3: Commit**
```bash
git add src/components/WatchlistPage.tsx
git commit -m "polish(library): hide type-filter tabs on the film-only list"
```

## Task B3: Groups empty state — single CTA

**Root cause:** the always-present header "Ny grupp" button (`grupper/page.tsx:32-36`) plus the empty-state "Skapa din första grupp" button (`:45-51`) are two CTAs in different styles for the same action.

**Files:** Modify `src/app/grupper/page.tsx:32-37`

- [ ] **Step 1:** Hide the header action while there are no groups, so the empty-state card is the sole CTA. Wrap the header `actions` div (lines 32-36):
```tsx
        {groups.length > 0 && (
          <div className="actions">
            <Link href="/grupper/ny" className="btn">
              <Plus size={12} /> Ny grupp
            </Link>
          </div>
        )}
```
- [ ] **Step 2: Verify** — Manual: with 0 groups only the empty-state CTA shows; with ≥1 group the header button returns.
- [ ] **Step 3: Commit**
```bash
git add src/app/grupper/page.tsx
git commit -m "polish(groups): single CTA in the empty state"
```

## Task B4: "Ta bort" as a button on `/my/lists`

**Files:** Modify `src/app/my/lists/page.tsx` (the list-row "Ta bort").

- [ ] **Step 1:** Open `src/app/my/lists/page.tsx`, find the row "Ta bort" control (a plain red text link). Give it the bordered danger-button class used elsewhere, e.g.:
```tsx
className="px-2 py-[2px] text-xxs border border-border-main bg-surface text-danger rounded-sm cursor-pointer font-[inherit] hover:bg-surface-hover"
```
(Match the existing danger token; if no `text-danger` token exists, use the accent-deep/red used by the friends remove button for consistency.)
- [ ] **Step 2: Verify** — Manual: the remove control reads as a button, not a text link.
- [ ] **Step 3: Commit**
```bash
git add src/app/my/lists/page.tsx
git commit -m "polish(lists): render list-row remove as a button"
```

## Task B5: Provider page — logo + real title

**Files:** Modify `src/components/pages/ProviderPageClient.tsx` (`:80-86`).

- [ ] **Step 1:** It already sets `document.title` manually (`:80-81`) — switch it to `usePageMeta({ title: providerName })` for consistency with the other catch-all clients, and render the provider's brand mark/dot beside the heading using the existing `ProviderDot`/color from `getProvider(id)`. Replace the plain `<h1 className="text-[18px] font-bold">{providerName}</h1>` with a flex row containing a `ProviderDot color={provider.color}` and the name (or migrate to the shared PageHeader from Task C1 with an `icon`).
- [ ] **Step 2: Verify** — Manual: `/provider/8` shows a Netflix-colored mark + correct tab title.
- [ ] **Step 3: Commit**
```bash
git add src/components/pages/ProviderPageClient.tsx
git commit -m "polish(provider): brand mark + usePageMeta title on provider browse page"
```

## Task B6: Season page — loading state for progress

**Root cause:** `SeasonPageClient` renders "0/10 / all-unwatched" before `episodeProgress` hydrates, then resolves to the correct count — a load-flash.

**Files:** Modify `src/components/pages/SeasonPageClient.tsx`

- [ ] **Step 1:** Identify the hook supplying watched progress (likely `useWatchlist`/`useEpisodeProgress`). Gate the "N/M avsnitt sedda" header and per-episode checkmarks on that query's loading flag: while loading, render a small skeleton (e.g. `—/M` and muted rows) instead of `0/M` with empty checks. Reuse the repo's existing skeleton classes (see `globals.css` skeletons / `hem-focal-skeleton`).
- [ ] **Step 2: Verify** — Manual: hard-reload `/tv/211564/season/1/` — it shows a loading state, not a "0/10" flash, before settling on "10/10".
- [ ] **Step 3: Commit**
```bash
git add src/components/pages/SeasonPageClient.tsx
git commit -m "polish(season): loading state so progress doesn't flash 0/N"
```

---

# PHASE C — Design-system docs & housekeeping

## Task C1: Extract a shared `PageHeader` component

**Root cause:** no shared header component; three ad-hoc patterns (canonical `.crumb`+`.page-h1`+`.stand`; bare `text-[18px] font-bold`; small-title+icon). 19 bare-title occurrences.

**Files:** Create `src/components/layout/PageHeader.tsx`; migrate outliers: `FriendsPageClient.tsx:60`, `my/lists/page.tsx:33`, `MediaTypePage.tsx:52`, `ListPageClient.tsx:62`, `PersonPageClient.tsx:70`, `ProviderPageClient.tsx:86`, `SeasonPageClient.tsx:41`, `RecommendationsExpanded.tsx:99`, `admin/reports/page.tsx:88`, and the icon pages `grupper/ny:65-67`, `tillsammans/ny:80-82`, `kalibrera:94-96`.

- [ ] **Step 1: Create the component**
```tsx
// src/components/layout/PageHeader.tsx
import type { ReactNode } from 'react';

export function PageHeader({
  crumb, title, standfirst, icon, actions,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  standfirst?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      {crumb && <div className="crumb">{crumb}</div>}
      <h1 className="page-h1">
        {icon && <span className="inline-flex items-center mr-2 align-middle">{icon}</span>}
        {title}
      </h1>
      {standfirst && <p className="stand">{standfirst}</p>}
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
```
- [ ] **Step 2: Migrate one outlier and verify it renders identically to canonical pages**, e.g. replace `FriendsPageClient.tsx:60`'s `<h1 className="text-[18px] font-bold text-text-primary">Vänner</h1>` block with `<PageHeader crumb="Vänner" title="Vänner" standfirst="…" />`. Repeat per file. For the icon pages, pass `icon={<Users size={…} />}` etc.
- [ ] **Step 3:** Run `npm run typecheck && npm run lint`. Manual: spot-check Friends/Lists/Person/Films/Series now use the 44px `.page-h1` + eyebrow, matching the library pages.
- [ ] **Step 4: Commit** (consider one commit per ~3 files for reviewability)
```bash
git add src/components/layout/PageHeader.tsx src/components/pages src/app
git commit -m "refactor(ui): shared PageHeader; migrate small-title outliers to canonical header"
```
> Optional guardrail: add an ESLint `no-restricted-syntax` rule flagging raw `<h1 className="text-[18px] font-bold">` to prevent regressions.

## Task C2: Rewrite CLAUDE.md Design Constraints (highest-leverage)

**Root cause:** the documented design system describes the pre-"Direction H" design and contradicts the shipped code on every point (sidebar, fonts, base size, shadows, radius, accent, color format). Future contributors/agents will "correct" code toward the dead spec.

**Files:** Modify `CLAUDE.md` (Design Constraints section).

- [ ] **Step 1:** Rewrite the "Design Constraints" section to describe the shipped system, sourced from `tailwind.config.ts` (header lines 1-15), `src/app/globals.css` (`:root` tokens, `.app-topbar`, `.subnav`, `.canvas`, `.crumb`/`.page-h1`/`.stand`) and `docs/design_handoff_direction_h_schemat/`:
  - **Layout:** light sticky top-nav (`AppTopbar` + `WeekStrip` + `Subnav`) over a centered `max-width:1320px` `.canvas` — **no dark sidebar**.
  - **Type:** base 15px; sans = Albert Sans, mono = JetBrains Mono (note `--mono` is being phased out — see C3).
  - **Color:** oklch CSS variables (not hex). **Two-accent system:** saffran/orange `--acc` (now/decisive/live) and plum `--cal-deep`/`--cal-soft` (today/time-position). Surfaces/page via `--surface`/`--page` tokens.
  - **Shadows:** two allowed (`lift`, `pop`); radius up to 8px.
  - **Posters:** per-genre duotone via SVG filters, full-color reveal on hover.
  - Keep the still-true rules: no `next/image`; explicit `<img>` width/height + lazy/async; TMDB attribution; Swedish UI.
- [ ] **Step 2: Verify** — Re-read the section against the live app; every statement should match what ships.
- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: rewrite Design Constraints to match the shipped Direction H system"
```

## Task C3: Remove dead tokens & reconcile the hover-transform rule

**Files:** Modify `tailwind.config.ts:73-77,93`, `src/app/globals.css:54-57,1074,1464,1828`.

- [ ] **Step 1: Delete dead sidebar tokens** — remove `width.sidebar` (`tailwind.config.ts:93`) and the `sidebar-bg`/`text-sidebar*` color tokens (`:73-77`), now that the layout uses a top-nav. Run `grep -rn "sidebar" src/` first to confirm no live usage; fix any stragglers.
- [ ] **Step 2: Reconcile hover-transform** — the redesign uses `transform: translateY(-1/-2px)` card lifts (`globals.css:1074,1464,1828`), which the old "no transform on hover" rule forbade. **Decision:** since C2 documents Direction H as the source of truth and the lifts are intentional, **keep them and ensure C2's doc permits subtle hover lifts** (no code change) — OR, if product wants to keep the no-transform rule, remove the three `translateY` lifts and rely on the existing `border-color` hover. Pick one and make doc + code agree.
- [ ] **Step 3 (optional): remove the `--mono` alias** (`globals.css:54-57`) and the `font-family: var(--mono)` usages it flags as removable, per the in-code note.
- [ ] **Step 4: Verify** — `npm run build` succeeds; no visual regression on hover.
- [ ] **Step 5: Commit**
```bash
git add tailwind.config.ts src/app/globals.css
git commit -m "chore(design): remove dead sidebar tokens; reconcile hover-transform with docs"
```

## Task C4: Finalize legal docs (pre-launch)

- [ ] Replace the "Version 0.1 (utkast)" / draft banner on `/villkor`, `/integritet`, `/community-guidelines` once legally reviewed (content in `src/app/<page>/page.tsx` via `LegalPageShell` props `version`/`draft`). Tracking item — no code change until review is done.

---

## Self-review checklist (done while writing)

- **Spec coverage:** every 🔴/🟠 finding maps to a task (A1 calendar, A2 count, A3 stats, A4+A5 titles, A6 view-mode, A7 providers, A8 nav); 🟡 polish → B1-B6; cross-cutting → C1-C4. The three *refuted* findings (table "filled stars", country defaults, season 0/10) are intentionally NOT bug-fix tasks — B1 addresses the real (minor) star empty-state, B6 the season load-flash; country defaults need no change.
- **Type consistency:** `buildCalendarEntries`/`SeasonDatum` names match across A1 test + impl + hook wiring; `defaultView` union widened in A6 before DisplaySection uses `'cards'`; `usePageMeta` callers pass bare titles (hook adds suffix) per A4/A5.
- **No placeholders:** logic tasks (A1-A3, A6, A7) carry complete code + tests; UI/CSS tasks carry exact class strings and line targets. A8/B4/B5/B6/C-tasks include a "locate" step where the precise current source wasn't read in planning — each names the file, the target, and the concrete change + verification.

---

## Suggested execution order
1. **A1** (the one real functional bug) — ship first.
2. **C2** (rewrite CLAUDE.md) — cheap, prevents future drift, unblocks confident work on the rest.
3. A3, A4, A6, A7 (small, high-confidence, isolated).
4. A2, A5, A8 (touch shared components / multiple files).
5. Phase B polish, then C1 (refactor) + C3/C4.
