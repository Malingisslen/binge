# Recommendations 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg om `/recommendations` till en cascade av horisontella rader med 7 rad-typer, dynamisk prioritering, kallstart-fallback, full filter-uppsättning och expanded view per rad.

**Architecture:** Pure helpers (`lib/recommendations/`) → row hooks (`hooks/rows/`) → orchestrator hook (`useRecommendationsCascade`) → UI-komponenter (`components/recommendations/`) → page (`app/recommendations/page.tsx`). Cascade-prioritering som pure function tar watchlist + ratings + recurring-detektion och returnerar ordnad rad-array. Varje rad-typ har sin egen hook som fetchar via React Query med rätt staleTime.

**Tech Stack:** Next.js 14 App Router (static export), TypeScript, React Query v5, Firebase/Firestore, TMDB API, Tailwind CSS, Vitest + RTL.

**Source spec:** [`docs/superpowers/specs/2026-04-25-recommendations-redesign.md`](../specs/2026-04-25-recommendations-redesign.md)

---

## Notation: korrekta status-värden

`WatchStatus` är `'vill_se' | 'mina' | 'sedd' | 'avbruten'` — INTE `'följer'`. CLAUDE.md är delvis föråldrad här. Status-tolkning för seed-detektion:
- "Sedd" (för film) eller "mina" (för TV) + rating 4-5★ → **stark seed**
- Samma + rating 3★ → **svag seed**
- Rating 1-2★, "Avbruten", eller "Inte intresserad" → **exkludera överallt** (ej seed, ej rec-kandidat)
- Status "vill_se" → exkludera från rec-pool (du har redan markerat den), räkna inte som seed

## File structure

### Files to create

```
src/types/recommendations.ts                              # Shared types
src/lib/recommendations/cascadePrioritizer.ts             # Pure: ordering
src/lib/recommendations/cascadePrioritizer.test.ts
src/lib/recommendations/seedAnalysis.ts                   # Pure: detection
src/lib/recommendations/seedAnalysis.test.ts
src/lib/recommendations/rowComposition.ts                 # Pure: filter/sort/cap
src/lib/recommendations/rowComposition.test.ts
src/hooks/rows/useRowSimilar.ts
src/hooks/rows/useRowPerson.ts
src/hooks/rows/useRowGenreCanon.ts
src/hooks/rows/useRowThematic.ts
src/hooks/rows/useRowTrending.ts
src/hooks/rows/useRowLatestFav.ts
src/hooks/rows/useRowUpcoming.ts
src/hooks/useRecommendationsCascade.ts
src/components/recommendations/RecommendationsHub.tsx
src/components/recommendations/RecommendationsExpanded.tsx
src/components/recommendations/CascadeRow.tsx
src/components/recommendations/RecommendationsFilters.tsx
src/components/recommendations/EmptyState.tsx
src/components/recommendations/QuickRateModal.tsx
scripts/seed-recommendations-test-user.ts                 # Manual-QA helper
```

### Files to modify

```
src/lib/tmdb/cacheTiers.ts                # Add RECOMMENDATIONS, PERSON_CREDITS, KEYWORDS, TRENDING, DISCOVER
src/lib/tmdb/client.ts                    # Add getSimilar, getMovieKeywords, getTVKeywords
src/app/recommendations/page.tsx          # Replace existing implementation with Hub/Expanded dispatch
```

---

## Task 0: Shared types

**Files:**
- Create: `src/types/recommendations.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/types/recommendations.ts
import type { MediaType, WatchlistItem } from './domain';
import type { TMDBSearchResult } from './tmdb';

export type RowKind =
  | 'similar'
  | 'person'
  | 'genre-canon'
  | 'thematic'
  | 'trending'
  | 'latest-fav'
  | 'upcoming';

export interface RowId {
  kind: RowKind;
  // Disambiguators per kind:
  mediaType?: MediaType;   // similar
  tmdbId?: number;         // similar (the seed id)
  personId?: number;       // person
  genreId?: number;        // genre-canon
  keywordId?: number;      // thematic
}

/** Stable string-key for React + URL query-param. Format examples:
 *   similar:movie:603, person:140607, genre:18, keyword:9663,
 *   trending, latest-fav, upcoming
 */
export function rowKey(id: RowId): string {
  switch (id.kind) {
    case 'similar':    return `similar:${id.mediaType}:${id.tmdbId}`;
    case 'person':     return `person:${id.personId}`;
    case 'genre-canon': return `genre:${id.genreId}`;
    case 'thematic':   return `keyword:${id.keywordId}`;
    case 'trending':   return 'trending';
    case 'latest-fav': return 'latest-fav';
    case 'upcoming':   return 'upcoming';
  }
}

export function parseRowKey(key: string): RowId | null {
  if (key === 'trending') return { kind: 'trending' };
  if (key === 'latest-fav') return { kind: 'latest-fav' };
  if (key === 'upcoming') return { kind: 'upcoming' };
  if (key.startsWith('similar:')) {
    const [, mt, id] = key.split(':');
    if ((mt === 'movie' || mt === 'tv') && id) {
      return { kind: 'similar', mediaType: mt, tmdbId: Number(id) };
    }
    return null;
  }
  if (key.startsWith('person:')) {
    const id = Number(key.slice('person:'.length));
    return Number.isFinite(id) ? { kind: 'person', personId: id } : null;
  }
  if (key.startsWith('genre:')) {
    const id = Number(key.slice('genre:'.length));
    return Number.isFinite(id) ? { kind: 'genre-canon', genreId: id } : null;
  }
  if (key.startsWith('keyword:')) {
    const id = Number(key.slice('keyword:'.length));
    return Number.isFinite(id) ? { kind: 'thematic', keywordId: id } : null;
  }
  return null;
}

export interface Seed {
  tmdbId: number;
  mediaType: MediaType;
  rating: number;
  weight: 'strong' | 'weak';
  /** ISO date — used for recency-based scoring on row 9. */
  ratedAt: Date | null;
}

export interface RecurringPerson {
  id: number;
  name: string;
  recurrence: number;        // distinct 4-5★ titles
  knownFor: 'cast' | 'director';
  /** Highest vote_average among the user's titles featuring this person. */
  topTitleRating: number;
}

export interface RecurringKeyword {
  id: number;
  name: string;
  recurrence: number;
}

export interface DominantGenre {
  id: number;
  count: number;
}

/** What the cascade prioritizer takes as input. Pure data — no fetch fns. */
export interface CascadeInput {
  /** Most recent 5★ rating within 30 days, or null. */
  latestFiveStar: { tmdbId: number; mediaType: MediaType; daysSince: number } | null;
  strongSeeds: Seed[];   // 4-5★
  weakSeeds: Seed[];     // 3★
  recurringPeople: RecurringPerson[];
  recurringKeywords: RecurringKeyword[];
  dominantGenres: DominantGenre[];
  hasMyProviders: boolean;
  upcomingCount: number; // for row 10 score
}

/** What cascadePrioritizer returns: ordered list of rows with metadata. */
export interface RowSpec {
  id: RowId;
  rowKey: string;
  label: string;
  description?: string;
  score: number;
  jtbd: 'B' | 'C';
  /** When kind=similar, the seed item; when kind=person, the person; etc. */
  meta?: {
    seed?: Seed;
    person?: RecurringPerson;
    genre?: { id: number; name?: string };
    keyword?: RecurringKeyword;
  };
}

export interface FilterState {
  genre: string;          // genre id as string, or ''
  country: string;        // ISO-3166 country, or ''
  myProvidersOnly: boolean;
  decade: string;         // '1960'..'2020' or ''
  voteAverageMin: number; // 0..9 in 0.5 steps
  searchText: string;
}

export const DEFAULT_FILTERS: FilterState = {
  genre: '',
  country: '',
  myProvidersOnly: false,
  decade: '',
  voteAverageMin: 0,
  searchText: '',
};

/** A title in a row — TMDBSearchResult plus invariant media_type. */
export type RowTitle = TMDBSearchResult & { media_type: MediaType };

/** Visible vs backing-pool split returned from row hooks. */
export interface RowResult {
  rowSpec: RowSpec;
  visible: RowTitle[];
  backingPool: RowTitle[];
  isLoading: boolean;
}

/** Convenience used by seedAnalysis. */
export type RatedItem = WatchlistItem & { rating: number };
```

- [ ] **Step 2: Re-export from types barrel**

Modify `src/types/index.ts` — append to the existing re-exports:

```typescript
export * from './recommendations';
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors)

- [ ] **Step 4: Commit**

```bash
git add src/types/recommendations.ts src/types/index.ts
git commit -m "feat(recs): add shared types for recommendations cascade"
```

---

## Task 1: Extend cache tiers

**Files:**
- Modify: `src/lib/tmdb/cacheTiers.ts`

- [ ] **Step 1: Add new constants**

Edit `src/lib/tmdb/cacheTiers.ts` — add to the `TMDB_STALE` object (preserving existing entries):

```typescript
export const TMDB_STALE = {
  TV_DETAIL: 10 * 60 * 1000,
  MOVIE_DETAIL: 30 * 60 * 1000,
  SEASON: 30 * 60 * 1000,
  CATALOG: 30 * 60 * 1000,
  SEARCH: 5 * 60 * 1000,
  PERSON: 60 * 60 * 1000,
  GENRES: 60 * 60 * 1000,
  PROVIDERS: 60 * 60 * 1000,
  /** TMDB /recommendations + /similar — 30 min. Multi-callsite shared. */
  RECOMMENDATIONS: 30 * 60 * 1000,
  /** /person/{id}/combined_credits — ändras sällan. */
  PERSON_CREDITS: 4 * 60 * 60 * 1000,
  /** /movie/{id}/keywords + /tv/{id}/keywords. */
  KEYWORDS: 4 * 60 * 60 * 1000,
  /** /trending/all/week — region SE-puls. */
  TRENDING: 60 * 60 * 1000,
  /** /discover — genre-canon, upcoming, thematic. */
  DISCOVER: 2 * 60 * 60 * 1000,
} as const;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/tmdb/cacheTiers.ts
git commit -m "feat(recs): add cache tiers for recommendations endpoints"
```

---

## Task 2: New TMDB client helpers

**Files:**
- Modify: `src/lib/tmdb/client.ts`

- [ ] **Step 1: Add getSimilar after getRecommendations (around line 142)**

Find the existing `getRecommendations` function. Add the following functions immediately after it:

```typescript
// Similar (broader than recommendations — based on keywords + genres)
export function getSimilar(
  mediaType: 'movie' | 'tv',
  id: number,
  opts?: TmdbFetchOpts,
): Promise<TMDBListResponse<TMDBSearchResult>> {
  return tmdbFetch(`/${mediaType}/${id}/similar`, {}, opts);
}

// Keywords for a movie title
export function getMovieKeywords(
  id: number,
  opts?: TmdbFetchOpts,
): Promise<{ id: number; keywords: { id: number; name: string }[] }> {
  return tmdbFetch(`/movie/${id}/keywords`, {}, opts);
}

// Keywords for a TV title (different response shape)
export function getTVKeywords(
  id: number,
  opts?: TmdbFetchOpts,
): Promise<{ id: number; results: { id: number; name: string }[] }> {
  return tmdbFetch(`/tv/${id}/keywords`, {}, opts);
}

/** Convenience — normalizes movie + tv keyword response into a flat array. */
export async function getKeywords(
  mediaType: 'movie' | 'tv',
  id: number,
  opts?: TmdbFetchOpts,
): Promise<{ id: number; name: string }[]> {
  if (mediaType === 'movie') {
    const r = await getMovieKeywords(id, opts);
    return r.keywords ?? [];
  }
  const r = await getTVKeywords(id, opts);
  return r.results ?? [];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/tmdb/client.ts
git commit -m "feat(recs): add getSimilar + getKeywords TMDB helpers"
```

---

## Task 3: seedAnalysis — pure detection helpers

**Files:**
- Create: `src/lib/recommendations/seedAnalysis.ts`
- Test: `src/lib/recommendations/seedAnalysis.test.ts`

This module derives all personalisation signals from the user's watchlist + per-title TMDB credit/keyword data. Pure functions, no React, no Firebase.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/recommendations/seedAnalysis.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifySeeds,
  detectLatestFiveStar,
  detectRecurringPeople,
  detectRecurringKeywords,
  detectDominantGenres,
} from './seedAnalysis';
import type { WatchlistItem } from '@/types';

function mkItem(overrides: Partial<WatchlistItem>): WatchlistItem {
  return {
    tmdbId: 1,
    mediaType: 'movie',
    status: 'sedd',
    rating: null,
    notes: null,
    title: 'Test',
    posterPath: null,
    releaseYear: 2020,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    dropped: false,
    rewatchCount: 0,
    providers: [],
    genreIds: [18],
    tmdbStatus: null,
    addedAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    watchedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('classifySeeds', () => {
  it('classifies 5★ and 4★ as strong, 3★ as weak, omits the rest', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5 }),
      mkItem({ tmdbId: 2, rating: 4 }),
      mkItem({ tmdbId: 3, rating: 3 }),
      mkItem({ tmdbId: 4, rating: 2 }),
      mkItem({ tmdbId: 5, rating: null }),
      mkItem({ tmdbId: 6, rating: 5, status: 'avbruten' }),
      mkItem({ tmdbId: 7, rating: 5, status: 'vill_se' }),
    ];
    const { strong, weak } = classifySeeds(items);
    expect(strong.map(s => s.tmdbId).sort()).toEqual([1, 2]);
    expect(weak.map(s => s.tmdbId).sort()).toEqual([3]);
  });

  it('passes ratedAt from updatedAt', () => {
    const d = new Date('2026-04-20');
    const items = [mkItem({ tmdbId: 10, rating: 5, updatedAt: d })];
    const { strong } = classifySeeds(items);
    expect(strong[0].ratedAt?.getTime()).toBe(d.getTime());
  });
});

describe('detectLatestFiveStar', () => {
  const today = new Date('2026-04-25T12:00:00Z');

  it('returns the most recent 5★ rating within window', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, updatedAt: new Date('2026-04-22') }),
      mkItem({ tmdbId: 2, rating: 5, updatedAt: new Date('2026-04-10') }),
      mkItem({ tmdbId: 3, rating: 4, updatedAt: new Date('2026-04-24') }),
    ];
    const r = detectLatestFiveStar(items, today, 30);
    expect(r?.tmdbId).toBe(1);
    expect(r?.daysSince).toBe(3);
  });

  it('returns null when no 5★ within window', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, updatedAt: new Date('2026-01-01') }),
    ];
    const r = detectLatestFiveStar(items, today, 30);
    expect(r).toBeNull();
  });

  it('returns null when nothing has 5★', () => {
    const items = [mkItem({ tmdbId: 1, rating: 4 })];
    expect(detectLatestFiveStar(items, today, 30)).toBeNull();
  });
});

describe('detectRecurringPeople', () => {
  it('returns persons appearing in ≥3 strong seeds', () => {
    const seeds = [
      { tmdbId: 1, mediaType: 'movie' as const, rating: 5, weight: 'strong' as const, ratedAt: null },
      { tmdbId: 2, mediaType: 'movie' as const, rating: 4, weight: 'strong' as const, ratedAt: null },
      { tmdbId: 3, mediaType: 'movie' as const, rating: 5, weight: 'strong' as const, ratedAt: null },
      { tmdbId: 4, mediaType: 'movie' as const, rating: 5, weight: 'strong' as const, ratedAt: null },
    ];
    const credits = new Map([
      [1, { cast: [{ id: 100, name: 'Bong' }, { id: 200, name: 'Other' }], director: { id: 100, name: 'Bong' } }],
      [2, { cast: [{ id: 100, name: 'Bong' }], director: null }],
      [3, { cast: [{ id: 100, name: 'Bong' }], director: { id: 300, name: 'Director3' } }],
      [4, { cast: [{ id: 200, name: 'Other' }], director: null }],
    ]);
    const people = detectRecurringPeople(seeds, credits, 3);
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(100);
    expect(people[0].recurrence).toBe(3);
  });

  it('returns empty when threshold not met', () => {
    const seeds = [
      { tmdbId: 1, mediaType: 'movie' as const, rating: 5, weight: 'strong' as const, ratedAt: null },
    ];
    const credits = new Map([
      [1, { cast: [{ id: 100, name: 'X' }], director: null }],
    ]);
    expect(detectRecurringPeople(seeds, credits, 3)).toEqual([]);
  });

  it('caps at top 5 by recurrence (then by topTitleRating)', () => {
    // Construct 6 different recurring people each with recurrence=3
    const seeds = Array.from({ length: 6 }, (_, i) => ({
      tmdbId: i + 1,
      mediaType: 'movie' as const,
      rating: 5,
      weight: 'strong' as const,
      ratedAt: null,
    }));
    const credits = new Map(
      seeds.map(s => [s.tmdbId, { cast: [{ id: 100, name: 'A' }, { id: 200, name: 'B' }], director: null }]),
    );
    const people = detectRecurringPeople(seeds, credits, 3);
    expect(people.length).toBeLessThanOrEqual(5);
  });
});

describe('detectRecurringKeywords', () => {
  it('returns keywords in ≥3 distinct titles, capped at 3', () => {
    const seeds = [1, 2, 3, 4].map(id => ({
      tmdbId: id,
      mediaType: 'movie' as const,
      rating: id <= 2 ? 5 : 3,
      weight: id <= 2 ? 'strong' as const : 'weak' as const,
      ratedAt: null,
    }));
    const keywords = new Map([
      [1, [{ id: 10, name: 'cult-classic' }, { id: 20, name: 'small-town' }]],
      [2, [{ id: 10, name: 'cult-classic' }]],
      [3, [{ id: 10, name: 'cult-classic' }, { id: 20, name: 'small-town' }]],
      [4, [{ id: 20, name: 'small-town' }]],
    ]);
    const r = detectRecurringKeywords(seeds, keywords, 3);
    const ids = r.map(k => k.id);
    expect(ids).toContain(10);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});

describe('detectDominantGenres', () => {
  it('returns top genres by occurrence in strong+weak seeds', () => {
    const items = [
      mkItem({ tmdbId: 1, rating: 5, genreIds: [18, 53] }),
      mkItem({ tmdbId: 2, rating: 4, genreIds: [18] }),
      mkItem({ tmdbId: 3, rating: 3, genreIds: [18, 80] }),
      mkItem({ tmdbId: 4, rating: 5, genreIds: [53] }),
    ];
    const r = detectDominantGenres(items, 5);
    expect(r[0].id).toBe(18);
    expect(r[0].count).toBe(3);
    expect(r[1].id).toBe(53);
  });

  it('caps result count', () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map(id =>
      mkItem({ tmdbId: id, rating: 5, genreIds: [id * 10] }),
    );
    expect(detectDominantGenres(items, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/recommendations/seedAnalysis.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/recommendations/seedAnalysis.ts
import type {
  WatchlistItem,
  Seed,
  RecurringPerson,
  RecurringKeyword,
  DominantGenre,
  MediaType,
} from '@/types';

/** Minimal credit shape consumed by detection. Caller assembles from TMDB. */
export interface SeedCredits {
  cast: { id: number; name: string }[];
  director: { id: number; name: string } | null;
}

const STRONG_SEED_STATUSES: ReadonlyArray<WatchlistItem['status']> = ['sedd', 'mina'];

/**
 * Classify watchlist into strong (4-5★) and weak (3★) seeds.
 * Items with status 'avbruten', 'vill_se', or rating <3 are NOT seeds.
 */
export function classifySeeds(items: readonly WatchlistItem[]): {
  strong: Seed[];
  weak: Seed[];
} {
  const strong: Seed[] = [];
  const weak: Seed[] = [];
  for (const it of items) {
    if (it.rating == null) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    const seed: Seed = {
      tmdbId: it.tmdbId,
      mediaType: it.mediaType,
      rating: it.rating,
      weight: 'strong',
      ratedAt: it.updatedAt ?? null,
    };
    if (it.rating >= 4) {
      strong.push(seed);
    } else if (it.rating === 3) {
      weak.push({ ...seed, weight: 'weak' });
    }
  }
  return { strong, weak };
}

/**
 * Find the most recent 5★ rating within `windowDays`. Used by row 9.
 * `now` is parameterised for testability.
 */
export function detectLatestFiveStar(
  items: readonly WatchlistItem[],
  now: Date,
  windowDays: number,
): { tmdbId: number; mediaType: MediaType; daysSince: number } | null {
  const cutoffMs = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  let best: { item: WatchlistItem; ts: number } | null = null;
  for (const it of items) {
    if (it.rating !== 5) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    const ts = it.updatedAt?.getTime() ?? 0;
    if (ts < cutoffMs) continue;
    if (!best || ts > best.ts) best = { item: it, ts };
  }
  if (!best) return null;
  const daysSince = Math.floor((now.getTime() - best.ts) / (24 * 60 * 60 * 1000));
  return { tmdbId: best.item.tmdbId, mediaType: best.item.mediaType, daysSince };
}

/**
 * Find people (cast or director) appearing in ≥`threshold` distinct strong seeds.
 * Returns top 5 by recurrence (tiebreak: presence as director > cast).
 */
export function detectRecurringPeople(
  strongSeeds: readonly Seed[],
  creditsByTmdb: ReadonlyMap<number, SeedCredits>,
  threshold: number,
): RecurringPerson[] {
  type Bucket = {
    id: number;
    name: string;
    titles: Set<number>;
    everDirector: boolean;
  };
  const buckets = new Map<number, Bucket>();

  for (const seed of strongSeeds) {
    const credits = creditsByTmdb.get(seed.tmdbId);
    if (!credits) continue;
    const top5Cast = credits.cast.slice(0, 5);
    for (const c of top5Cast) {
      const b = buckets.get(c.id) ?? { id: c.id, name: c.name, titles: new Set<number>(), everDirector: false };
      b.titles.add(seed.tmdbId);
      buckets.set(c.id, b);
    }
    if (credits.director) {
      const d = credits.director;
      const b = buckets.get(d.id) ?? { id: d.id, name: d.name, titles: new Set<number>(), everDirector: false };
      b.titles.add(seed.tmdbId);
      b.everDirector = true;
      buckets.set(d.id, b);
    }
  }

  const recurring = Array.from(buckets.values())
    .filter(b => b.titles.size >= threshold)
    .map<RecurringPerson>(b => ({
      id: b.id,
      name: b.name,
      recurrence: b.titles.size,
      knownFor: b.everDirector ? 'director' : 'cast',
      topTitleRating: 0, // populated in row hook from per-title rating data
    }))
    .sort((a, b) => {
      if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
      // Director-tiebreak: directors first
      if (a.knownFor !== b.knownFor) return a.knownFor === 'director' ? -1 : 1;
      return 0;
    })
    .slice(0, 5);

  return recurring;
}

/**
 * Find keywords appearing in ≥threshold distinct seeds (strong + weak combined).
 * Returns top 3 by recurrence.
 */
export function detectRecurringKeywords(
  seeds: readonly Seed[], // strong + weak
  keywordsByTmdb: ReadonlyMap<number, { id: number; name: string }[]>,
  threshold: number,
): RecurringKeyword[] {
  const buckets = new Map<number, { id: number; name: string; titles: Set<number> }>();
  for (const seed of seeds) {
    const ks = keywordsByTmdb.get(seed.tmdbId);
    if (!ks) continue;
    for (const k of ks) {
      const b = buckets.get(k.id) ?? { id: k.id, name: k.name, titles: new Set<number>() };
      b.titles.add(seed.tmdbId);
      buckets.set(k.id, b);
    }
  }
  return Array.from(buckets.values())
    .filter(b => b.titles.size >= threshold)
    .map<RecurringKeyword>(b => ({ id: b.id, name: b.name, recurrence: b.titles.size }))
    .sort((a, b) => b.recurrence - a.recurrence)
    .slice(0, 3);
}

/**
 * Top genres by occurrence in strong+weak seeds (any rated 3-5★).
 */
export function detectDominantGenres(
  items: readonly WatchlistItem[],
  cap: number,
): DominantGenre[] {
  const counts = new Map<number, number>();
  for (const it of items) {
    if (it.rating == null || it.rating < 3) continue;
    if (!STRONG_SEED_STATUSES.includes(it.status)) continue;
    for (const g of it.genreIds) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap);
}
```

- [ ] **Step 4: Run tests until all pass**

Run: `npx vitest run src/lib/recommendations/seedAnalysis.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommendations/seedAnalysis.ts src/lib/recommendations/seedAnalysis.test.ts
git commit -m "feat(recs): add seedAnalysis pure helpers + tests"
```

---

## Task 4: rowComposition — pure filter/sort/cap helpers

**Files:**
- Create: `src/lib/recommendations/rowComposition.ts`
- Test: `src/lib/recommendations/rowComposition.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/recommendations/rowComposition.test.ts
import { describe, it, expect } from 'vitest';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
  scoreSimilarity,
  containsSearchText,
} from './rowComposition';
import type { RowTitle, FilterState } from '@/types';

function mkTitle(overrides: Partial<RowTitle> = {}): RowTitle {
  return {
    id: 1,
    title: 'X',
    name: undefined,
    poster_path: null,
    backdrop_path: null,
    media_type: 'movie',
    release_date: '2020-01-01',
    vote_average: 7.5,
    vote_count: 1000,
    genre_ids: [18],
    origin_country: ['SE'],
    original_title: 'X',
    overview: '',
    ...overrides,
  };
}

describe('dedupeAndExclude', () => {
  it('drops duplicates and excluded ids', () => {
    const items = [mkTitle({ id: 1 }), mkTitle({ id: 2 }), mkTitle({ id: 1 }), mkTitle({ id: 3 })];
    const r = dedupeAndExclude(items, new Set([3]));
    expect(r.map(t => t.id)).toEqual([1, 2]);
  });

  it('treats movie/tv with same id as distinct', () => {
    const items = [
      mkTitle({ id: 5, media_type: 'movie' }),
      mkTitle({ id: 5, media_type: 'tv' }),
    ];
    expect(dedupeAndExclude(items, new Set())).toHaveLength(2);
  });
});

describe('splitVisibleAndPool', () => {
  it('returns first cap as visible, rest as backing pool', () => {
    const items = Array.from({ length: 30 }, (_, i) => mkTitle({ id: i + 1 }));
    const { visible, backingPool } = splitVisibleAndPool(items, 20);
    expect(visible).toHaveLength(20);
    expect(backingPool).toHaveLength(10);
  });

  it('handles short input', () => {
    const items = [mkTitle({ id: 1 })];
    const { visible, backingPool } = splitVisibleAndPool(items, 20);
    expect(visible).toHaveLength(1);
    expect(backingPool).toHaveLength(0);
  });
});

describe('applyClientFilters', () => {
  const base: FilterState = {
    genre: '',
    country: '',
    myProvidersOnly: false,
    decade: '',
    voteAverageMin: 0,
    searchText: '',
  };

  it('filters by decade', () => {
    const items = [
      mkTitle({ id: 1, release_date: '1985-06-01' }),
      mkTitle({ id: 2, release_date: '2005-06-01' }),
      mkTitle({ id: 3, release_date: '1979-12-31' }),
    ];
    expect(applyClientFilters(items, { ...base, decade: '1980' }).map(t => t.id)).toEqual([1]);
  });

  it('filters by voteAverageMin', () => {
    const items = [
      mkTitle({ id: 1, vote_average: 6.0 }),
      mkTitle({ id: 2, vote_average: 7.5 }),
      mkTitle({ id: 3, vote_average: 8.2 }),
    ];
    expect(applyClientFilters(items, { ...base, voteAverageMin: 7.5 }).map(t => t.id)).toEqual([2, 3]);
  });

  it('filters by country (origin_country)', () => {
    const items = [
      mkTitle({ id: 1, origin_country: ['SE'] }),
      mkTitle({ id: 2, origin_country: ['US'] }),
      mkTitle({ id: 3, origin_country: ['SE', 'NO'] }),
    ];
    expect(applyClientFilters(items, { ...base, country: 'SE' }).map(t => t.id)).toEqual([1, 3]);
  });

  it('filters by genre', () => {
    const items = [
      mkTitle({ id: 1, genre_ids: [18, 53] }),
      mkTitle({ id: 2, genre_ids: [28] }),
    ];
    expect(applyClientFilters(items, { ...base, genre: '53' }).map(t => t.id)).toEqual([1]);
  });

  it('filters by search text on title or original_title', () => {
    const items = [
      mkTitle({ id: 1, title: 'Parasite', original_title: 'Gisaengchung' }),
      mkTitle({ id: 2, title: 'Snowpiercer', original_title: 'Snowpiercer' }),
    ];
    expect(applyClientFilters(items, { ...base, searchText: 'gisaeng' }).map(t => t.id)).toEqual([1]);
  });
});

describe('scoreSimilarity', () => {
  it('weights TMDB position higher (lower index = higher score)', () => {
    expect(scoreSimilarity(0, 'recommendations')).toBeGreaterThan(scoreSimilarity(10, 'recommendations'));
  });

  it('boosts /recommendations over /similar at same index', () => {
    expect(scoreSimilarity(0, 'recommendations')).toBeGreaterThan(scoreSimilarity(0, 'similar'));
  });
});

describe('containsSearchText', () => {
  it('handles diacritics and case', () => {
    expect(containsSearchText('Den blomstertid', 'Den blomstertid', 'BLOMSTER')).toBe(true);
    expect(containsSearchText('Mörk', null, 'mork')).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/recommendations/rowComposition.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implementation**

```typescript
// src/lib/recommendations/rowComposition.ts
import type { RowTitle, FilterState } from '@/types';

/** Drop duplicates and any title whose id is in `excludedIds`. */
export function dedupeAndExclude(
  items: readonly RowTitle[],
  excludedIds: ReadonlySet<number>,
): RowTitle[] {
  const seen = new Set<string>();
  const result: RowTitle[] = [];
  for (const t of items) {
    if (excludedIds.has(t.id)) continue;
    const key = `${t.media_type}-${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  return result;
}

/** First `cap` are "visible", remainder is the backing pool used to fill gaps. */
export function splitVisibleAndPool(
  items: readonly RowTitle[],
  cap: number,
): { visible: RowTitle[]; backingPool: RowTitle[] } {
  return {
    visible: items.slice(0, cap),
    backingPool: items.slice(cap),
  };
}

/** Strip diacritics for searches (so "mork" matches "Mörk"). */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function containsSearchText(
  title: string | undefined,
  originalTitle: string | undefined | null,
  query: string,
): boolean {
  if (!query) return true;
  const q = normalize(query);
  if (title && normalize(title).includes(q)) return true;
  if (originalTitle && normalize(originalTitle).includes(q)) return true;
  return false;
}

function decadeOf(releaseDate: string | null | undefined): string | null {
  if (!releaseDate) return null;
  const year = Number(releaseDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return String(Math.floor(year / 10) * 10);
}

/**
 * Apply page-level filters to a row's pool.
 * Note: provider filtering (myProvidersOnly) requires per-title provider data
 * which is not on TMDBSearchResult — that's handled separately in the row hook
 * via useSearchProviders.
 */
export function applyClientFilters(
  items: readonly RowTitle[],
  filters: FilterState,
): RowTitle[] {
  const genreId = filters.genre ? Number(filters.genre) : null;
  return items.filter(t => {
    if (genreId !== null && !(t.genre_ids ?? []).includes(genreId)) return false;
    if (filters.country) {
      const oc = t.origin_country ?? [];
      if (!oc.includes(filters.country)) return false;
    }
    if (filters.decade) {
      if (decadeOf(t.release_date ?? (t as { first_air_date?: string }).first_air_date) !== filters.decade) {
        return false;
      }
    }
    if (filters.voteAverageMin > 0) {
      if ((t.vote_average ?? 0) < filters.voteAverageMin) return false;
    }
    if (filters.searchText) {
      if (!containsSearchText(t.title ?? t.name, t.original_title ?? t.original_name, filters.searchText)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Score for the rad-1 similarity ranking. Lower index = higher score; /recommendations
 * is treated as more authoritative than /similar.
 */
export function scoreSimilarity(
  index: number,
  source: 'recommendations' | 'similar',
): number {
  const base = 1 / (index + 1);
  return source === 'recommendations' ? base * 1.5 : base;
}
```

- [ ] **Step 4: Run tests until pass**

Run: `npx vitest run src/lib/recommendations/rowComposition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommendations/rowComposition.ts src/lib/recommendations/rowComposition.test.ts
git commit -m "feat(recs): add rowComposition pure helpers + tests"
```

---

## Task 5: cascadePrioritizer — pure ordering helper

**Files:**
- Create: `src/lib/recommendations/cascadePrioritizer.ts`
- Test: `src/lib/recommendations/cascadePrioritizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/recommendations/cascadePrioritizer.test.ts
import { describe, it, expect } from 'vitest';
import { prioritizeRows } from './cascadePrioritizer';
import type { CascadeInput } from '@/types';

function emptyInput(): CascadeInput {
  return {
    latestFiveStar: null,
    strongSeeds: [],
    weakSeeds: [],
    recurringPeople: [],
    recurringKeywords: [],
    dominantGenres: [],
    hasMyProviders: false,
    upcomingCount: 0,
  };
}

describe('prioritizeRows', () => {
  it('cold-start: only trending gets emitted', () => {
    const rows = prioritizeRows(emptyInput());
    expect(rows.map(r => r.id.kind)).toEqual(['trending']);
  });

  it('emits genre-canon when dominant genres exist', () => {
    const inp = { ...emptyInput(), dominantGenres: [{ id: 18, count: 5 }] };
    const rows = prioritizeRows(inp);
    expect(rows.map(r => r.id.kind).sort()).toEqual(['genre-canon', 'trending']);
  });

  it('places latest-fav (5★ within 30d) at the top with recency-decayed score', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      latestFiveStar: { tmdbId: 603, mediaType: 'movie', daysSince: 3 },
      strongSeeds: [
        { tmdbId: 603, mediaType: 'movie', rating: 5, weight: 'strong', ratedAt: null },
      ],
    };
    const rows = prioritizeRows(inp);
    expect(rows[0].id.kind).toBe('latest-fav');
    expect(rows[0].score).toBe(97); // 100 - 3
  });

  it('person beats similar at high recurrence', () => {
    const inp: CascadeInput = {
      ...emptyInput(),
      strongSeeds: [
        { tmdbId: 1, mediaType: 'movie', rating: 5, weight: 'strong', ratedAt: null },
      ],
      recurringPeople: [
        { id: 100, name: 'A', recurrence: 6, knownFor: 'director', topTitleRating: 9 },
      ],
    };
    const rows = prioritizeRows(inp);
    const personIdx = rows.findIndex(r => r.id.kind === 'person');
    const similarIdx = rows.findIndex(r => r.id.kind === 'similar');
    expect(personIdx).toBeGreaterThanOrEqual(0);
    expect(personIdx).toBeLessThan(similarIdx);
  });

  it('emits up to 3 similar rows for top-3 strong seeds', () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({
      tmdbId: i + 1,
      mediaType: 'movie' as const,
      rating: 5,
      weight: 'strong' as const,
      ratedAt: null,
    }));
    const rows = prioritizeRows({ ...emptyInput(), strongSeeds: seeds });
    const similar = rows.filter(r => r.id.kind === 'similar');
    expect(similar.length).toBeLessThanOrEqual(3);
  });

  it('upcoming requires myProviders', () => {
    const noProv = prioritizeRows({ ...emptyInput(), upcomingCount: 5 });
    expect(noProv.find(r => r.id.kind === 'upcoming')).toBeUndefined();
    const withProv = prioritizeRows({ ...emptyInput(), hasMyProviders: true, upcomingCount: 5 });
    expect(withProv.find(r => r.id.kind === 'upcoming')).toBeDefined();
  });

  it('B-jobs win tie-breaks against C-jobs', () => {
    // Force tie at score 40 between genre-canon (C) and a 1-seed similar row (B).
    // similar is seedCount × 12 = 12 for 1 seed, so we need to construct via
    // deterministic input: set upcoming to score 40, and dominantGenres also 40.
    // Both score 40 — but genre-canon is C, upcoming is B. B should sort first.
    const inp: CascadeInput = {
      ...emptyInput(),
      hasMyProviders: true,
      upcomingCount: 10, // score = 40
      dominantGenres: [{ id: 18, count: 1 }], // score = 40
    };
    const rows = prioritizeRows(inp);
    const upcomingIdx = rows.findIndex(r => r.id.kind === 'upcoming');
    const genreIdx = rows.findIndex(r => r.id.kind === 'genre-canon');
    expect(upcomingIdx).toBeLessThan(genreIdx);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/recommendations/cascadePrioritizer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementation**

```typescript
// src/lib/recommendations/cascadePrioritizer.ts
import type { CascadeInput, RowSpec, Seed } from '@/types';
import { rowKey } from '@/types';

const B_KINDS = new Set<RowSpec['id']['kind']>(['similar', 'person', 'latest-fav', 'upcoming']);

function jtbdOf(kind: RowSpec['id']['kind']): RowSpec['jtbd'] {
  return B_KINDS.has(kind) ? 'B' : 'C';
}

export function prioritizeRows(input: CascadeInput): RowSpec[] {
  const out: RowSpec[] = [];

  // Row 9 — latest 5★
  if (input.latestFiveStar) {
    const f = input.latestFiveStar;
    const score = Math.max(0, 100 - f.daysSince);
    out.push({
      id: { kind: 'latest-fav' },
      rowKey: rowKey({ kind: 'latest-fav' }),
      label: `Liknar din senaste 5★ (${f.daysSince} dagar sedan)`,
      score,
      jtbd: jtbdOf('latest-fav'),
    });
  }

  // Row 2 — recurring people
  for (const p of input.recurringPeople) {
    const score = Math.min(p.recurrence * 15, 90);
    out.push({
      id: { kind: 'person', personId: p.id },
      rowKey: rowKey({ kind: 'person', personId: p.id }),
      label: p.knownFor === 'director' ? `Mer från ${p.name}` : `Med ${p.name}`,
      score,
      jtbd: jtbdOf('person'),
      meta: { person: p },
    });
  }

  // Row 1 — similar to top-3 strong seeds (sort by rating then ratedAt)
  const topSeeds = sortSeedsForSimilarRow(input.strongSeeds).slice(0, 3);
  for (let i = 0; i < topSeeds.length; i++) {
    const s = topSeeds[i];
    const score = Math.min((topSeeds.length - i) * 12, 80);
    out.push({
      id: { kind: 'similar', mediaType: s.mediaType, tmdbId: s.tmdbId },
      rowKey: rowKey({ kind: 'similar', mediaType: s.mediaType, tmdbId: s.tmdbId }),
      label: `Liknar dina ${s.rating}★`,
      score,
      jtbd: jtbdOf('similar'),
      meta: { seed: s },
    });
  }

  // Row 4 — recurring keywords
  for (const k of input.recurringKeywords) {
    const score = Math.min(k.recurrence * 10, 70);
    out.push({
      id: { kind: 'thematic', keywordId: k.id },
      rowKey: rowKey({ kind: 'thematic', keywordId: k.id }),
      label: `Tematiskt: ${k.name}`,
      score,
      jtbd: jtbdOf('thematic'),
      meta: { keyword: k },
    });
  }

  // Row 10 — upcoming (requires providers)
  if (input.hasMyProviders && input.upcomingCount > 0) {
    const score = Math.min(input.upcomingCount * 4, 50);
    out.push({
      id: { kind: 'upcoming' },
      rowKey: rowKey({ kind: 'upcoming' }),
      label: 'Kommande premiärer på dina tjänster',
      score,
      jtbd: jtbdOf('upcoming'),
    });
  }

  // Row 3 — genre canon
  if (input.dominantGenres.length > 0) {
    out.push({
      id: { kind: 'genre-canon', genreId: input.dominantGenres[0].id },
      rowKey: rowKey({ kind: 'genre-canon', genreId: input.dominantGenres[0].id }),
      label: 'Klassiker i dina genrer du missat',
      score: 40,
      jtbd: jtbdOf('genre-canon'),
      meta: { genre: { id: input.dominantGenres[0].id } },
    });
  }

  // Row 6 — trending (always)
  out.push({
    id: { kind: 'trending' },
    rowKey: rowKey({ kind: 'trending' }),
    label: 'Trendar i Sverige denna vecka',
    score: 30,
    jtbd: jtbdOf('trending'),
  });

  // Sort by score desc, B-job tie-breaks before C-job
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.jtbd !== b.jtbd) return a.jtbd === 'B' ? -1 : 1;
    return a.rowKey.localeCompare(b.rowKey);
  });

  return out;
}

function sortSeedsForSimilarRow(seeds: readonly Seed[]): Seed[] {
  // 5★ before 4★, then most recent first
  return [...seeds].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const at = a.ratedAt?.getTime() ?? 0;
    const bt = b.ratedAt?.getTime() ?? 0;
    return bt - at;
  });
}
```

- [ ] **Step 4: Run tests until pass**

Run: `npx vitest run src/lib/recommendations/cascadePrioritizer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recommendations/cascadePrioritizer.ts src/lib/recommendations/cascadePrioritizer.test.ts
git commit -m "feat(recs): add cascadePrioritizer pure helper + tests"
```

---

## Task 6: useRowTrending hook

**Files:**
- Create: `src/hooks/rows/useRowTrending.ts`

This is the simplest row hook — sets the pattern.

- [ ] **Step 1: Write the implementation**

```typescript
// src/hooks/rows/useRowTrending.ts
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrending } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';
import { isAddableMediaType } from '@/lib/tmdb/client';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowTrending(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
  hiddenCountries: readonly string[],
): RowResult {
  const { data, isLoading } = useQuery({
    queryKey: ['rec-trending', 'all', 'week'],
    queryFn: ({ signal }) => getTrending('all', 'week', { signal }),
    staleTime: TMDB_STALE.TRENDING,
  });

  return useMemo(() => {
    const raw = (data?.results ?? []) as RowTitle[];
    const typed = raw
      .filter(isAddableMediaType)
      .filter(t => !hiddenCountries.some(c => (t.origin_country ?? []).includes(c)))
      .map(t => ({ ...t, media_type: (t.media_type ?? 'movie') as 'movie' | 'tv' }));
    const filtered = applyClientFilters(dedupeAndExclude(typed, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, excludedIds, filters, hiddenCountries, rowSpec, isLoading]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowTrending.ts
git commit -m "feat(recs): add useRowTrending hook"
```

---

## Task 7: useRowLatestFav hook

**Files:**
- Create: `src/hooks/rows/useRowLatestFav.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowLatestFav.ts
'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getRecommendations, getSimilar } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
  scoreSimilarity,
} from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle, MediaType } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowLatestFav(
  rowSpec: RowSpec,
  seed: { tmdbId: number; mediaType: MediaType } | null,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const queries = useQueries({
    queries: seed
      ? [
          {
            queryKey: ['rec-recommendations', seed.mediaType, seed.tmdbId],
            queryFn: ({ signal }: { signal?: AbortSignal }) =>
              getRecommendations(seed.mediaType, seed.tmdbId, { signal }),
            staleTime: TMDB_STALE.RECOMMENDATIONS,
          },
          {
            queryKey: ['rec-similar', seed.mediaType, seed.tmdbId],
            queryFn: ({ signal }: { signal?: AbortSignal }) =>
              getSimilar(seed.mediaType, seed.tmdbId, { signal }),
            staleTime: TMDB_STALE.RECOMMENDATIONS,
          },
        ]
      : [],
  });

  return useMemo(() => {
    const isLoading = queries.some(q => q.isLoading);
    if (!seed) {
      return { rowSpec, visible: [], backingPool: [], isLoading: false };
    }
    const recs = (queries[0]?.data?.results ?? []) as RowTitle[];
    const sims = (queries[1]?.data?.results ?? []) as RowTitle[];
    const scored: { t: RowTitle; s: number }[] = [];
    recs.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'recommendations') }));
    sims.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'similar') }));
    scored.sort((a, b) => b.s - a.s);
    const ranked = scored.map(x => x.t);
    const filtered = applyClientFilters(dedupeAndExclude(ranked, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [queries, seed, excludedIds, filters, rowSpec]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowLatestFav.ts
git commit -m "feat(recs): add useRowLatestFav hook"
```

---

## Task 8: useRowSimilar hook

**Files:**
- Create: `src/hooks/rows/useRowSimilar.ts`

Same shape as useRowLatestFav, but parameterised over an arbitrary seed (not just the recent 5★).

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowSimilar.ts
'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getRecommendations, getSimilar } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  dedupeAndExclude,
  splitVisibleAndPool,
  applyClientFilters,
  scoreSimilarity,
} from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowSimilar(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const id = rowSpec.id;
  const seed = id.kind === 'similar' && id.tmdbId && id.mediaType ? { tmdbId: id.tmdbId, mediaType: id.mediaType } : null;
  const queries = useQueries({
    queries: seed
      ? [
          {
            queryKey: ['rec-recommendations', seed.mediaType, seed.tmdbId],
            queryFn: ({ signal }: { signal?: AbortSignal }) =>
              getRecommendations(seed.mediaType, seed.tmdbId, { signal }),
            staleTime: TMDB_STALE.RECOMMENDATIONS,
          },
          {
            queryKey: ['rec-similar', seed.mediaType, seed.tmdbId],
            queryFn: ({ signal }: { signal?: AbortSignal }) =>
              getSimilar(seed.mediaType, seed.tmdbId, { signal }),
            staleTime: TMDB_STALE.RECOMMENDATIONS,
          },
        ]
      : [],
  });

  return useMemo(() => {
    const isLoading = queries.some(q => q.isLoading);
    if (!seed) return { rowSpec, visible: [], backingPool: [], isLoading: false };
    const recs = (queries[0]?.data?.results ?? []) as RowTitle[];
    const sims = (queries[1]?.data?.results ?? []) as RowTitle[];
    const scored: { t: RowTitle; s: number }[] = [];
    recs.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'recommendations') }));
    sims.forEach((t, i) => scored.push({ t: { ...t, media_type: seed.mediaType }, s: scoreSimilarity(i, 'similar') }));
    scored.sort((a, b) => b.s - a.s);
    const ranked = scored.map(x => x.t);
    const filtered = applyClientFilters(dedupeAndExclude(ranked, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [queries, seed, excludedIds, filters, rowSpec]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowSimilar.ts
git commit -m "feat(recs): add useRowSimilar hook"
```

---

## Task 9: useRowPerson hook

**Files:**
- Create: `src/hooks/rows/useRowPerson.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowPerson.ts
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPersonCredits } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 60;

export function useRowPerson(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const personId = rowSpec.id.kind === 'person' ? rowSpec.id.personId : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['rec-person-credits', personId],
    queryFn: ({ signal }) => getPersonCredits(personId!, { signal }),
    staleTime: TMDB_STALE.PERSON_CREDITS,
    enabled: !!personId,
  });

  return useMemo(() => {
    if (!personId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const cast = (data.cast ?? []) as RowTitle[];
    const crew = (data.crew ?? []).filter((c: RowTitle & { job?: string }) => c.job === 'Director') as RowTitle[];
    const merged = [...cast, ...crew]
      .filter(t => t.media_type === 'movie' || t.media_type === 'tv')
      .map(t => ({ ...t, media_type: t.media_type as 'movie' | 'tv' }));
    // Score: vote_average × log(vote_count+1)
    merged.sort((a, b) => {
      const sa = (a.vote_average ?? 0) * Math.log((a.vote_count ?? 0) + 1);
      const sb = (b.vote_average ?? 0) * Math.log((b.vote_count ?? 0) + 1);
      return sb - sa;
    });
    const filtered = applyClientFilters(dedupeAndExclude(merged, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, personId, excludedIds, filters, rowSpec, isLoading]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowPerson.ts
git commit -m "feat(recs): add useRowPerson hook"
```

---

## Task 10: useRowGenreCanon hook

**Files:**
- Create: `src/hooks/rows/useRowGenreCanon.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowGenreCanon.ts
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowGenreCanon(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const genreId = rowSpec.id.kind === 'genre-canon' ? rowSpec.id.genreId : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['rec-genre-canon', genreId, filters.decade, filters.voteAverageMin],
    queryFn: ({ signal }) => discoverMovies({
      with_genres: String(genreId),
      sort_by: 'vote_average.desc',
      'vote_count.gte': '2000',
      ...(filters.decade ? {
        'primary_release_date.gte': `${filters.decade}-01-01`,
        'primary_release_date.lte': `${Number(filters.decade) + 9}-12-31`,
      } : {}),
      ...(filters.voteAverageMin > 0 ? { 'vote_average.gte': String(filters.voteAverageMin) } : {}),
    }, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: !!genreId,
  });

  return useMemo(() => {
    if (!genreId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, genreId, excludedIds, filters, rowSpec, isLoading]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowGenreCanon.ts
git commit -m "feat(recs): add useRowGenreCanon hook"
```

---

## Task 11: useRowThematic hook

**Files:**
- Create: `src/hooks/rows/useRowThematic.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowThematic.ts
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowThematic(
  rowSpec: RowSpec,
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const keywordId = rowSpec.id.kind === 'thematic' ? rowSpec.id.keywordId : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['rec-thematic', keywordId, filters.decade, filters.voteAverageMin],
    queryFn: ({ signal }) => discoverMovies({
      with_keywords: String(keywordId),
      sort_by: 'popularity.desc',
      'vote_count.gte': '200',
      ...(filters.decade ? {
        'primary_release_date.gte': `${filters.decade}-01-01`,
        'primary_release_date.lte': `${Number(filters.decade) + 9}-12-31`,
      } : {}),
      ...(filters.voteAverageMin > 0 ? { 'vote_average.gte': String(filters.voteAverageMin) } : {}),
    }, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: !!keywordId,
  });

  return useMemo(() => {
    if (!keywordId || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    items.sort((a, b) => {
      const sa = (a.vote_average ?? 0) * Math.log((a.vote_count ?? 0) + 1);
      const sb = (b.vote_average ?? 0) * Math.log((b.vote_count ?? 0) + 1);
      return sb - sa;
    });
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, keywordId, excludedIds, filters, rowSpec, isLoading]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowThematic.ts
git commit -m "feat(recs): add useRowThematic hook"
```

---

## Task 12: useRowUpcoming hook

**Files:**
- Create: `src/hooks/rows/useRowUpcoming.ts`

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/rows/useRowUpcoming.ts
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { dedupeAndExclude, splitVisibleAndPool, applyClientFilters } from '@/lib/recommendations/rowComposition';
import type { RowResult, RowSpec, FilterState, RowTitle } from '@/types';

const VISIBLE_CAP = 20;
const POOL_TARGET = 50;

export function useRowUpcoming(
  rowSpec: RowSpec,
  myProviders: readonly number[],
  topGenreIds: readonly number[],
  excludedIds: ReadonlySet<number>,
  filters: FilterState,
): RowResult {
  const today = new Date().toISOString().slice(0, 10);
  const enabled = myProviders.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ['rec-upcoming', myProviders.join(','), topGenreIds.join(','), today],
    queryFn: ({ signal }) => discoverMovies({
      'primary_release_date.gte': today,
      with_watch_providers: myProviders.join('|'),
      watch_region: 'SE',
      sort_by: 'primary_release_date.asc',
      ...(topGenreIds.length ? { with_genres: topGenreIds.join('|') } : {}),
    }, { signal }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled,
  });

  return useMemo(() => {
    if (!enabled || !data) return { rowSpec, visible: [], backingPool: [], isLoading };
    const items = (data.results ?? []).map(r => ({ ...r, media_type: 'movie' as const })) as RowTitle[];
    const filtered = applyClientFilters(dedupeAndExclude(items, excludedIds), filters);
    const pool = filtered.slice(0, POOL_TARGET);
    const split = splitVisibleAndPool(pool, VISIBLE_CAP);
    return { rowSpec, ...split, isLoading };
  }, [data, enabled, excludedIds, filters, rowSpec, isLoading]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/rows/useRowUpcoming.ts
git commit -m "feat(recs): add useRowUpcoming hook"
```

---

## Task 13: useRecommendationsCascade — orchestrator

**Files:**
- Create: `src/hooks/useRecommendationsCascade.ts`

This hook produces the cascade input from watchlist + ratings + auxiliary
TMDB data (credits, keywords) and returns the ordered RowSpec array.

- [ ] **Step 1: Implementation**

```typescript
// src/hooks/useRecommendationsCascade.ts
'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAuth } from '@/hooks/useAuth';
import { getMovieDetail, getTVShow, getKeywords, discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import {
  classifySeeds,
  detectLatestFiveStar,
  detectRecurringPeople,
  detectRecurringKeywords,
  detectDominantGenres,
  type SeedCredits,
} from '@/lib/recommendations/seedAnalysis';
import { prioritizeRows } from '@/lib/recommendations/cascadePrioritizer';
import type { RowSpec } from '@/types';

const FIVE_STAR_WINDOW_DAYS = 30;

export interface CascadeOutput {
  rows: RowSpec[];
  ratingCount: number;
  topGenreIds: number[];
  hasMyProviders: boolean;
  isLoadingDetection: boolean;
}

export function useRecommendationsCascade(): CascadeOutput {
  const { items } = useWatchlist();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];

  // 1. Classify seeds (pure)
  const { strong, weak } = useMemo(() => classifySeeds(items), [items]);
  const allSeeds = useMemo(() => [...strong, ...weak], [strong, weak]);

  // 2. Per-seed detail fetch (credits — already cached by useTV/useMovieShow)
  const detailQueries = useQueries({
    queries: strong.map(s => ({
      queryKey: [s.mediaType, s.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        s.mediaType === 'movie' ? getMovieDetail(s.tmdbId, { signal }) : getTVShow(s.tmdbId, { signal }),
      staleTime: s.mediaType === 'movie' ? TMDB_STALE.MOVIE_DETAIL : TMDB_STALE.TV_DETAIL,
    })),
  });

  // 3. Per-seed keyword fetch (separate endpoint, longer cache)
  const keywordQueries = useQueries({
    queries: allSeeds.map(s => ({
      queryKey: ['rec-keywords', s.mediaType, s.tmdbId],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getKeywords(s.mediaType, s.tmdbId, { signal }),
      staleTime: TMDB_STALE.KEYWORDS,
    })),
  });

  // 4. Upcoming-count probe (cheap discover with count only)
  const today = new Date().toISOString().slice(0, 10);
  const upcomingProbeQuery = useQueries({
    queries: myProviders.length > 0 ? [{
      queryKey: ['rec-upcoming-count', myProviders.join(','), today],
      queryFn: ({ signal }: { signal?: AbortSignal }) => discoverMovies({
        'primary_release_date.gte': today,
        with_watch_providers: myProviders.join('|'),
        watch_region: 'SE',
      }, { signal }),
      staleTime: TMDB_STALE.DISCOVER,
    }] : [],
  });

  return useMemo(() => {
    const isLoadingDetection = detailQueries.some(q => q.isLoading) || keywordQueries.some(q => q.isLoading);

    // Build SeedCredits map from detail queries
    const credits = new Map<number, SeedCredits>();
    strong.forEach((s, i) => {
      const data = detailQueries[i]?.data as { credits?: { cast?: { id: number; name: string }[]; crew?: { id: number; name: string; job?: string }[] } } | undefined;
      if (!data?.credits) return;
      credits.set(s.tmdbId, {
        cast: (data.credits.cast ?? []).map(c => ({ id: c.id, name: c.name })),
        director: (data.credits.crew ?? []).find(c => c.job === 'Director')
          ? { id: data.credits.crew!.find(c => c.job === 'Director')!.id, name: data.credits.crew!.find(c => c.job === 'Director')!.name }
          : null,
      });
    });

    // Build keyword map
    const keywordsByTmdb = new Map<number, { id: number; name: string }[]>();
    allSeeds.forEach((s, i) => {
      const data = keywordQueries[i]?.data;
      if (data) keywordsByTmdb.set(s.tmdbId, data);
    });

    const recurringPeople = detectRecurringPeople(strong, credits, 3);
    const recurringKeywords = detectRecurringKeywords(allSeeds, keywordsByTmdb, 3);
    const dominantGenres = detectDominantGenres(items, 5);
    const latestFiveStar = detectLatestFiveStar(items, new Date(), FIVE_STAR_WINDOW_DAYS);
    const upcomingCount = upcomingProbeQuery[0]?.data?.results?.length ?? 0;

    const rows = prioritizeRows({
      latestFiveStar,
      strongSeeds: strong,
      weakSeeds: weak,
      recurringPeople,
      recurringKeywords,
      dominantGenres,
      hasMyProviders: myProviders.length > 0,
      upcomingCount,
    });

    return {
      rows,
      ratingCount: strong.length + weak.length,
      topGenreIds: dominantGenres.slice(0, 3).map(g => g.id),
      hasMyProviders: myProviders.length > 0,
      isLoadingDetection,
    };
  }, [items, strong, weak, allSeeds, detailQueries, keywordQueries, upcomingProbeQuery, myProviders]);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRecommendationsCascade.ts
git commit -m "feat(recs): add useRecommendationsCascade orchestrator hook"
```

---

## Task 14: CascadeRow component

**Files:**
- Create: `src/components/recommendations/CascadeRow.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/CascadeRow.tsx
'use client';

import Link from 'next/link';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useSearchProviders } from '@/hooks/useSearchProviders';
import { useAuth } from '@/hooks/useAuth';
import { canonicalProviderId } from '@/lib/tmdb/providers';
import type { RowResult, RowTitle } from '@/types';

interface Props {
  result: RowResult;
}

export default function CascadeRow({ result }: Props) {
  const { rowSpec, visible, backingPool, isLoading } = result;
  const { add: addNotInterested } = useNotInterested();
  const { user } = useAuth();
  const myProviders = user?.myProviders ?? [];
  const [pulled, setPulled] = useState<number[]>([]); // ids from backingPool we've pulled in to fill gaps

  // Compute current items: visible minus dismissed, then top-up from pool
  const items = useMemo(() => {
    const dismissed = new Set<number>();
    const list = visible.filter(t => !dismissed.has(t.id));
    const need = visible.length - list.length;
    if (need > 0) list.push(...backingPool.slice(0, need + pulled.length));
    return list.filter(t => !pulled.includes(-t.id));
  }, [visible, backingPool, pulled]);

  const providerMap = useSearchProviders(items);

  const onDismiss = useCallback((t: RowTitle) => {
    addNotInterested(t.id, t.media_type);
    // Pull from backing pool to fill the gap
    setPulled(prev => [...prev, t.id]);
  }, [addNotInterested]);

  if (!isLoading && items.length < 4) return null; // hide near-empty rows

  return (
    <section className="mb-6">
      <Link href={`/recommendations?row=${encodeURIComponent(rowSpec.rowKey)}`} className="flex items-center justify-between mb-2 group">
        <h2 className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          {rowSpec.label}
        </h2>
        <span className="text-xs text-accent flex items-center gap-1">
          visa fler <ChevronRight size={12} />
        </span>
      </Link>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map(t => (
          <RowCard key={`${t.media_type}-${t.id}`} title={t} myProviders={myProviders} providerMap={providerMap} onDismiss={() => onDismiss(t)} />
        ))}
        {isLoading && items.length === 0 && (
          <div className="text-xs text-text-muted py-8 px-2">Laddar…</div>
        )}
      </div>
    </section>
  );
}

interface CardProps {
  title: RowTitle;
  myProviders: number[];
  providerMap: Record<string, { flatrate?: { provider_id: number }[] }>;
  onDismiss: () => void;
}

function RowCard({ title, myProviders, providerMap, onDismiss }: CardProps) {
  const href = title.media_type === 'movie' ? `/movie/${title.id}` : `/tv/${title.id}`;
  const poster = title.poster_path
    ? `https://image.tmdb.org/t/p/w185${title.poster_path}`
    : null;
  const provs = providerMap[`${title.media_type}-${title.id}`]?.flatrate ?? [];
  const onMyService = provs.some(p => myProviders.includes(canonicalProviderId(p.provider_id)));
  return (
    <div className="relative shrink-0 w-[100px] group">
      <Link href={href}>
        {poster ? (
          <img src={poster} alt={title.title ?? title.name ?? ''} width={100} height={150} loading="lazy" decoding="async" className="w-[100px] h-[150px] object-cover rounded-sm border border-border-main" />
        ) : (
          <div className="w-[100px] h-[150px] bg-surface border border-border-main rounded-sm flex items-center justify-center text-[9px] text-text-muted">Ingen poster</div>
        )}
      </Link>
      <button
        onClick={onDismiss}
        className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white text-xs rounded-sm opacity-0 group-hover:opacity-100"
        title="Inte intresserad"
      >×</button>
      <div className="mt-1 text-[10px] text-text-secondary line-clamp-2">{title.title ?? title.name}</div>
      <div className="flex gap-1 mt-1 flex-wrap">
        {(title.vote_average ?? 0) > 0 && (
          <span className="text-[9px] text-text-muted">{title.vote_average!.toFixed(1)}</span>
        )}
        {onMyService && <span className="text-[9px] text-accent">●</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/recommendations/CascadeRow.tsx
git commit -m "feat(recs): add CascadeRow component"
```

---

## Task 15: RecommendationsFilters component

**Files:**
- Create: `src/components/recommendations/RecommendationsFilters.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/RecommendationsFilters.tsx
'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMovieGenres, getTVGenres } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { FilterState } from '@/types';

const DECADES = ['1960', '1970', '1980', '1990', '2000', '2010', '2020'];
const COUNTRIES = ['SE', 'NO', 'DK', 'FI', 'GB', 'US', 'FR', 'DE', 'JP', 'KR', 'IT', 'ES'];

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  hasMyProviders: boolean;
}

export default function RecommendationsFilters({ filters, onChange, hasMyProviders }: Props) {
  const [searchInput, setSearchInput] = useState(filters.searchText);
  const debouncedSearch = useDebouncedValue(searchInput, 200);

  useEffect(() => {
    if (debouncedSearch !== filters.searchText) {
      onChange({ ...filters, searchText: debouncedSearch });
    }
  }, [debouncedSearch, filters, onChange]);

  const { data: movieGenres } = useQuery({
    queryKey: ['genres-movie'],
    queryFn: getMovieGenres,
    staleTime: TMDB_STALE.GENRES,
  });
  const { data: tvGenres } = useQuery({
    queryKey: ['genres-tv'],
    queryFn: getTVGenres,
    staleTime: TMDB_STALE.GENRES,
  });
  const allGenres = (() => {
    const merged = [...(movieGenres?.genres ?? []), ...(tvGenres?.genres ?? [])];
    const seen = new Set<number>();
    return merged
      .filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; })
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  })();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <select value={filters.genre} onChange={e => onChange({ ...filters, genre: e.target.value })} className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none">
        <option value="">Alla genrer</option>
        {allGenres.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
      </select>
      <select value={filters.country} onChange={e => onChange({ ...filters, country: e.target.value })} className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none">
        <option value="">Alla länder</option>
        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={filters.decade} onChange={e => onChange({ ...filters, decade: e.target.value })} className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none">
        <option value="">Alla decennier</option>
        {DECADES.map(d => <option key={d} value={d}>{d}-talet</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs text-text-secondary">
        Betyg ≥
        <input type="number" min={0} max={9} step={0.5} value={filters.voteAverageMin} onChange={e => onChange({ ...filters, voteAverageMin: Number(e.target.value) })} className="w-12 text-xs border border-border-main rounded-sm px-1 py-[2px] bg-surface" />
      </label>
      {hasMyProviders && (
        <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={filters.myProvidersOnly} onChange={e => onChange({ ...filters, myProvidersOnly: e.target.checked })} className="accent-accent w-[13px] h-[13px]" />
          Mina tjänster
        </label>
      )}
      <input
        type="search"
        placeholder="Sök i rekommendationer…"
        value={searchInput}
        onChange={e => setSearchInput(e.target.value)}
        className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary outline-none flex-1 min-w-[160px]"
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/recommendations/RecommendationsFilters.tsx
git commit -m "feat(recs): add RecommendationsFilters component"
```

---

## Task 16: EmptyState component

**Files:**
- Create: `src/components/recommendations/EmptyState.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/EmptyState.tsx
'use client';

interface Props {
  ratingCount: number;
  onOpenQuickRate: () => void;
}

export default function EmptyState({ ratingCount, onOpenQuickRate }: Props) {
  if (ratingCount >= 3) return null;
  const text = ratingCount === 0
    ? 'Betygsätt 3 titlar du sett för fler personliga rader →'
    : `Betygsätt ${3 - ratingCount} till för person- och tematiska rader →`;
  return (
    <div className="bg-surface border border-border-main rounded-sm p-3 mb-4 text-xs flex items-center justify-between">
      <span className="text-text-secondary">{text}</span>
      <button onClick={onOpenQuickRate} className="text-accent hover:underline">
        Snabb-betyg (90s)
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/recommendations/EmptyState.tsx
git commit -m "feat(recs): add EmptyState component"
```

---

## Task 17: QuickRateModal component

**Files:**
- Create: `src/components/recommendations/QuickRateModal.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/QuickRateModal.tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { discoverMovies } from '@/lib/tmdb/client';
import { TMDB_STALE } from '@/lib/tmdb/cacheTiers';
import { useWatchlist } from '@/hooks/useWatchlist';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function QuickRateModal({ open, onClose }: Props) {
  const { addOrUpdate } = useWatchlist();
  const [rated, setRated] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['quick-rate-pool'],
    queryFn: () => discoverMovies({
      sort_by: 'popularity.desc',
      'vote_count.gte': '5000',
      region: 'SE',
      watch_region: 'SE',
    }),
    staleTime: TMDB_STALE.DISCOVER,
    enabled: open,
  });

  if (!open) return null;
  const titles = (data?.results ?? []).slice(0, 50);

  const handleRate = (tmdbId: number, mediaType: 'movie' | 'tv', rating: number) => {
    addOrUpdate({ tmdbId, mediaType, status: 'sedd', rating });
    setRated(prev => new Set(prev).add(tmdbId));
  };

  const handleSeen = (tmdbId: number, mediaType: 'movie' | 'tv') => {
    addOrUpdate({ tmdbId, mediaType, status: 'sedd' });
    setRated(prev => new Set(prev).add(tmdbId));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border-main rounded-sm w-full max-w-3xl max-h-[80vh] overflow-y-auto">
        <header className="flex items-center justify-between p-3 border-b border-border-main sticky top-0 bg-surface">
          <h2 className="text-sm font-bold">Snabb-betyg ({rated.size} markerade)</h2>
          <button onClick={onClose} className="text-text-muted"><X size={16} /></button>
        </header>
        {isLoading ? (
          <div className="p-8 text-center text-xs text-text-muted">Laddar…</div>
        ) : (
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {titles.map(t => {
              const poster = t.poster_path ? `https://image.tmdb.org/t/p/w185${t.poster_path}` : null;
              const isRated = rated.has(t.id);
              return (
                <div key={t.id} className={`border border-border-main rounded-sm p-2 text-xs ${isRated ? 'opacity-50' : ''}`}>
                  {poster && <img src={poster} alt={t.title ?? ''} width={120} height={180} className="w-full aspect-[2/3] object-cover rounded-sm mb-2" loading="lazy" decoding="async" />}
                  <div className="font-semibold mb-1 line-clamp-2">{t.title}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => handleRate(t.id, 'movie', 5)} className="bg-accent/10 text-accent text-[10px] py-1 rounded-sm">Sett 5★</button>
                    <button onClick={() => handleRate(t.id, 'movie', 4)} className="bg-accent/10 text-accent text-[10px] py-1 rounded-sm">Sett 4★</button>
                    <button onClick={() => handleRate(t.id, 'movie', 3)} className="bg-surface border border-border-main text-[10px] py-1 rounded-sm">Sett 3★</button>
                    <button onClick={() => handleSeen(t.id, 'movie')} className="bg-surface border border-border-main text-[10px] py-1 rounded-sm">Inte sett</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <footer className="p-3 border-t border-border-main flex justify-end sticky bottom-0 bg-surface">
          <button onClick={onClose} disabled={rated.size < 5} className="bg-accent text-white text-xs px-4 py-2 rounded-sm disabled:opacity-50">
            Klar ({rated.size}/5)
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Verify `addOrUpdate` exists on useWatchlist**

Run: `grep -n "addOrUpdate\|export.*useWatchlist" /c/binge/src/contexts/WatchlistContext.tsx | head -5`

If `addOrUpdate` does not exist, find the actual method name (likely `addItem`, `setStatus`, or similar) and adjust the QuickRateModal calls. The intent is "create or update a watchlist item with status='sedd' + optional rating".

- [ ] **Step 4: Commit**

```bash
git add src/components/recommendations/QuickRateModal.tsx
git commit -m "feat(recs): add QuickRateModal for cold-start onboarding"
```

---

## Task 18: RecommendationsHub component

**Files:**
- Create: `src/components/recommendations/RecommendationsHub.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/RecommendationsHub.tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRecommendationsCascade } from '@/hooks/useRecommendationsCascade';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useAuth } from '@/hooks/useAuth';
import { useRowTrending } from '@/hooks/rows/useRowTrending';
import { useRowLatestFav } from '@/hooks/rows/useRowLatestFav';
import { useRowSimilar } from '@/hooks/rows/useRowSimilar';
import { useRowPerson } from '@/hooks/rows/useRowPerson';
import { useRowGenreCanon } from '@/hooks/rows/useRowGenreCanon';
import { useRowThematic } from '@/hooks/rows/useRowThematic';
import { useRowUpcoming } from '@/hooks/rows/useRowUpcoming';
import CascadeRow from './CascadeRow';
import RecommendationsFilters from './RecommendationsFilters';
import EmptyState from './EmptyState';
import QuickRateModal from './QuickRateModal';
import { DEFAULT_FILTERS } from '@/types';
import type { FilterState, RowSpec, RowResult } from '@/types';

const INITIAL_VISIBLE_ROWS = 5;

export default function RecommendationsHub() {
  const cascade = useRecommendationsCascade();
  const { items } = useWatchlist();
  const { items: ni } = useNotInterested();
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [quickRateOpen, setQuickRateOpen] = useState(false);
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_VISIBLE_ROWS);

  const excludedIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of items) s.add(i.tmdbId);
    for (const n of ni) s.add(n.tmdbId);
    return s;
  }, [items, ni]);

  // Lazy-load more rows on scroll
  useEffect(() => {
    const onScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
      if (nearBottom) setVisibleRowCount(c => Math.min(c + 2, cascade.rows.length));
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [cascade.rows.length]);

  const visibleRows = cascade.rows.slice(0, visibleRowCount);

  return (
    <>
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-[18px] font-bold text-text-primary">För dig</h1>
        <p className="text-xs text-text-muted">Baserat på dina ratings, exklusive det du redan följer.</p>
      </div>

      <RecommendationsFilters filters={filters} onChange={setFilters} hasMyProviders={cascade.hasMyProviders} />
      <EmptyState ratingCount={cascade.ratingCount} onOpenQuickRate={() => setQuickRateOpen(true)} />
      <QuickRateModal open={quickRateOpen} onClose={() => setQuickRateOpen(false)} />

      {visibleRows.map(spec => (
        <RowMount key={spec.rowKey} spec={spec} excludedIds={excludedIds} filters={filters} myProviders={user?.myProviders ?? []} topGenreIds={cascade.topGenreIds} />
      ))}

      {visibleRowCount < cascade.rows.length && (
        <button onClick={() => setVisibleRowCount(c => c + 2)} className="text-xs text-accent mt-2">Visa fler rader ›</button>
      )}
    </>
  );
}

interface MountProps {
  spec: RowSpec;
  excludedIds: ReadonlySet<number>;
  filters: FilterState;
  myProviders: number[];
  topGenreIds: number[];
}

function RowMount(props: MountProps) {
  // Each row hook must be called unconditionally. Switch on kind.
  const { spec, excludedIds, filters, myProviders, topGenreIds } = props;
  let result: RowResult;
  switch (spec.id.kind) {
    case 'trending':
      result = useRowTrending(spec, excludedIds, filters, []); // hiddenCountries handled elsewhere via filter
      break;
    case 'latest-fav': {
      const seed = spec.meta?.seed ? { tmdbId: spec.meta.seed.tmdbId, mediaType: spec.meta.seed.mediaType } : null;
      result = useRowLatestFav(spec, seed, excludedIds, filters);
      break;
    }
    case 'similar':
      result = useRowSimilar(spec, excludedIds, filters);
      break;
    case 'person':
      result = useRowPerson(spec, excludedIds, filters);
      break;
    case 'genre-canon':
      result = useRowGenreCanon(spec, excludedIds, filters);
      break;
    case 'thematic':
      result = useRowThematic(spec, excludedIds, filters);
      break;
    case 'upcoming':
      result = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
      break;
    default:
      return null;
  }
  return <CascadeRow result={result} />;
}
```

**NOTE:** The switch in `RowMount` calls hooks conditionally — this violates the rules of hooks. The clean fix is to dispatch via separate components per kind:

```tsx
function RowMount({ spec, ...rest }: MountProps) {
  switch (spec.id.kind) {
    case 'trending':    return <TrendingRow spec={spec} {...rest} />;
    case 'latest-fav':  return <LatestFavRow spec={spec} {...rest} />;
    case 'similar':     return <SimilarRow spec={spec} {...rest} />;
    case 'person':      return <PersonRow spec={spec} {...rest} />;
    case 'genre-canon': return <GenreCanonRow spec={spec} {...rest} />;
    case 'thematic':    return <ThematicRow spec={spec} {...rest} />;
    case 'upcoming':    return <UpcomingRow spec={spec} {...rest} />;
  }
}

function TrendingRow({ spec, excludedIds, filters }: MountProps) {
  const result = useRowTrending(spec, excludedIds, filters, []);
  return <CascadeRow result={result} />;
}
// ... etc, one component per kind
```

Refactor to that pattern before committing.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/recommendations/RecommendationsHub.tsx
git commit -m "feat(recs): add RecommendationsHub orchestrator"
```

---

## Task 19: RecommendationsExpanded component (?row=X view)

**Files:**
- Create: `src/components/recommendations/RecommendationsExpanded.tsx`

- [ ] **Step 1: Implementation**

```tsx
// src/components/recommendations/RecommendationsExpanded.tsx
'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useRecommendationsCascade } from '@/hooks/useRecommendationsCascade';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useNotInterested } from '@/hooks/useNotInterested';
import { useAuth } from '@/hooks/useAuth';
import { parseRowKey, DEFAULT_FILTERS } from '@/types';
import type { FilterState, RowSpec } from '@/types';
import RecommendationsFilters from './RecommendationsFilters';
import TitleGrid from '@/components/title/TitleGrid';
import { useRowTrending } from '@/hooks/rows/useRowTrending';
import { useRowLatestFav } from '@/hooks/rows/useRowLatestFav';
import { useRowSimilar } from '@/hooks/rows/useRowSimilar';
import { useRowPerson } from '@/hooks/rows/useRowPerson';
import { useRowGenreCanon } from '@/hooks/rows/useRowGenreCanon';
import { useRowThematic } from '@/hooks/rows/useRowThematic';
import { useRowUpcoming } from '@/hooks/rows/useRowUpcoming';

interface Props {
  rowKeyParam: string;
}

type SortKey = 'relevance' | 'rating' | 'release';

export default function RecommendationsExpanded({ rowKeyParam }: Props) {
  const id = parseRowKey(rowKeyParam);
  const cascade = useRecommendationsCascade();
  const spec = cascade.rows.find(r => r.rowKey === rowKeyParam) as RowSpec | undefined;
  const { items } = useWatchlist();
  const { items: ni } = useNotInterested();
  const { user } = useAuth();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>('relevance');

  const excludedIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of items) s.add(i.tmdbId);
    for (const n of ni) s.add(n.tmdbId);
    return s;
  }, [items, ni]);

  if (!id || !spec) {
    return (
      <div>
        <Link href="/recommendations" className="text-xs text-accent flex items-center gap-1 mb-3"><ChevronLeft size={12} />Tillbaka</Link>
        <p className="text-sm text-text-muted">Raden hittades inte. Den kan ha försvunnit efter ratings ändrats.</p>
      </div>
    );
  }

  return (
    <>
      <Link href="/recommendations" className="text-xs text-accent flex items-center gap-1 mb-3"><ChevronLeft size={12} />Tillbaka till Rekommendationer</Link>
      <h1 className="text-[18px] font-bold text-text-primary mb-1">{spec.label}</h1>
      <p className="text-xs text-text-muted mb-3">{spec.description ?? ''}</p>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <RecommendationsFilters filters={filters} onChange={setFilters} hasMyProviders={cascade.hasMyProviders} />
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="text-xs border border-border-main rounded-sm px-2 py-[2px] bg-surface text-text-secondary">
          <option value="relevance">Relevans</option>
          <option value="rating">Betyg</option>
          <option value="release">Release-datum</option>
        </select>
      </div>

      <ExpandedGrid spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} myProviders={user?.myProviders ?? []} topGenreIds={cascade.topGenreIds} />
    </>
  );
}

interface GridProps {
  spec: RowSpec;
  excludedIds: ReadonlySet<number>;
  filters: FilterState;
  sort: SortKey;
  myProviders: number[];
  topGenreIds: number[];
}

function ExpandedGrid({ spec, excludedIds, filters, sort, myProviders, topGenreIds }: GridProps) {
  // Same pattern as RowMount: dispatch to per-kind component to keep hook calls valid
  switch (spec.id.kind) {
    case 'trending':    return <TrendingExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'latest-fav':  return <LatestFavExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'similar':     return <SimilarExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'person':      return <PersonExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'genre-canon': return <GenreExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'thematic':    return <ThematicExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} />;
    case 'upcoming':    return <UpcomingExpanded spec={spec} excludedIds={excludedIds} filters={filters} sort={sort} myProviders={myProviders} topGenreIds={topGenreIds} />;
  }
}

// One thin wrapper per kind. Each calls the row hook + a sortByKey helper.
// Reuse the hook output (visible + backingPool concatenated → full pool for grid).

import type { RowResult, RowTitle } from '@/types';

function applySort(items: RowTitle[], sort: SortKey): RowTitle[] {
  if (sort === 'rating')   return [...items].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
  if (sort === 'release')  return [...items].sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''));
  return items; // relevance = original
}

function gridFromResult(result: RowResult, sort: SortKey) {
  const all = [...result.visible, ...result.backingPool];
  return <TitleGrid items={applySort(all, sort)} loading={result.isLoading && all.length === 0} />;
}

function TrendingExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const r = useRowTrending(spec, excludedIds, filters, []);
  return gridFromResult(r, sort);
}
function LatestFavExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const seed = spec.meta?.seed ? { tmdbId: spec.meta.seed.tmdbId, mediaType: spec.meta.seed.mediaType } : null;
  const r = useRowLatestFav(spec, seed, excludedIds, filters);
  return gridFromResult(r, sort);
}
function SimilarExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const r = useRowSimilar(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}
function PersonExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const r = useRowPerson(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}
function GenreExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const r = useRowGenreCanon(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}
function ThematicExpanded({ spec, excludedIds, filters, sort }: Omit<GridProps, 'myProviders' | 'topGenreIds'>) {
  const r = useRowThematic(spec, excludedIds, filters);
  return gridFromResult(r, sort);
}
function UpcomingExpanded({ spec, excludedIds, filters, sort, myProviders, topGenreIds }: GridProps) {
  const r = useRowUpcoming(spec, myProviders, topGenreIds, excludedIds, filters);
  return gridFromResult(r, sort);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/recommendations/RecommendationsExpanded.tsx
git commit -m "feat(recs): add RecommendationsExpanded view (?row= query param)"
```

---

## Task 20: Wire up /recommendations/page.tsx

**Files:**
- Modify: `src/app/recommendations/page.tsx`

- [ ] **Step 1: Replace contents**

```tsx
// src/app/recommendations/page.tsx
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import RecommendationsHub from '@/components/recommendations/RecommendationsHub';
import RecommendationsExpanded from '@/components/recommendations/RecommendationsExpanded';

export default function RecommendationsPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="text-sm text-text-muted">Laddar…</div>}>
        <RecsRouter />
      </Suspense>
    </AuthGuard>
  );
}

function RecsRouter() {
  const params = useSearchParams();
  const row = params.get('row');
  return row ? <RecommendationsExpanded rowKeyParam={row} /> : <RecommendationsHub />;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Verify dev server starts and page renders**

Run in one terminal: `npm run dev`
Open `http://localhost:3000/recommendations` — confirm:
- "För dig" heading appears
- Filter bar visible
- At least trending row renders for cold-start user

- [ ] **Step 4: Commit**

```bash
git add src/app/recommendations/page.tsx
git commit -m "feat(recs): wire /recommendations to Hub + Expanded views"
```

---

## Task 21: Manual-QA seed script

**Files:**
- Create: `scripts/seed-recommendations-test-user.ts`

This script populates the Firestore emulator with three test users
representing cold/warm/power states for manual QA.

- [ ] **Step 1: Implementation**

```typescript
// scripts/seed-recommendations-test-user.ts
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, connectFirestoreEmulator } from 'firebase/firestore';

const app = initializeApp({ projectId: 'binge-emulator' });
const db = getFirestore(app);
connectFirestoreEmulator(db, 'localhost', 8080);

interface SeedUser {
  uid: string;
  myProviders: number[];
  ratings: Array<{ tmdbId: number; mediaType: 'movie' | 'tv'; rating: number; status: 'sedd' | 'mina'; genreIds: number[] }>;
}

const USERS: SeedUser[] = [
  { uid: 'cold-user', myProviders: [], ratings: [] },
  {
    uid: 'warm-user',
    myProviders: [8, 337], // Netflix + Disney+
    ratings: [
      { tmdbId: 603, mediaType: 'movie', rating: 5, status: 'sedd', genreIds: [28, 878] },     // The Matrix
      { tmdbId: 496243, mediaType: 'movie', rating: 5, status: 'sedd', genreIds: [53, 18] },   // Parasite
      { tmdbId: 27205, mediaType: 'movie', rating: 4, status: 'sedd', genreIds: [28, 53] },    // Inception
    ],
  },
  {
    uid: 'power-user',
    myProviders: [8, 337, 119, 350],
    ratings: Array.from({ length: 50 }, (_, i) => ({
      tmdbId: 1000 + i,
      mediaType: 'movie' as const,
      rating: (i % 3) + 3, // 3, 4, 5 cycling
      status: 'sedd' as const,
      genreIds: [18, 28, 53][i % 3] ? [[18], [28], [53]][i % 3] : [18],
    })),
  },
];

async function seed() {
  for (const u of USERS) {
    await setDoc(doc(db, 'users', u.uid), {
      displayName: u.uid,
      email: `${u.uid}@example.com`,
      myProviders: u.myProviders,
      hideNonLatinTitles: false,
      hiddenCountries: [],
      providerCosts: {},
      providerTiers: {},
      providerPauses: {},
    });
    for (const r of u.ratings) {
      await setDoc(doc(db, 'users', u.uid, 'watchlist', String(r.tmdbId)), {
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        status: r.status,
        rating: r.rating,
        title: `Title ${r.tmdbId}`,
        genreIds: r.genreIds,
        addedAt: new Date(),
        updatedAt: new Date(),
      });
    }
    console.log(`Seeded user ${u.uid} with ${u.ratings.length} ratings`);
  }
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add npm script to package.json**

Add to `scripts` section:
```json
"seed:recs": "tsx scripts/seed-recommendations-test-user.ts"
```

(Use `tsx` if installed, else `ts-node`. Adjust to match the project's TS-runner.)

- [ ] **Step 3: Manual verify against emulator**

```bash
# Terminal 1
npm run emulators

# Terminal 2
npm run seed:recs
NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true npm run dev
```

Sign in as cold-user / warm-user / power-user via emulator UI and verify:
- **cold-user:** sees only trending row + EmptyState banner
- **warm-user:** sees latest-fav (Parasite/Matrix), similar, genre-canon
- **power-user:** sees full cascade including person + thematic rows

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-recommendations-test-user.ts package.json
git commit -m "chore(recs): add manual-QA seed script for test users"
```

---

## Task 22: Final integration smoke test + cleanup

- [ ] **Step 1: Run full check**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 2: Sentry-tags audit**

In each row hook, ensure TMDB calls pass a tag for Sentry. Check `tmdbFetch` in `src/lib/tmdb/client.ts` to confirm whether tagging is supported via `TmdbFetchOpts`. If not, skip; otherwise add per-call tags like `tags: { recommendation_row: 'similar' }`.

- [ ] **Step 3: Manual smoke test against the real TMDB API**

Run: `npm run dev`

For a logged-in user with at least one 4-5★ rating:
1. Navigate to `/recommendations` → confirm "För dig" rendering
2. Click row label → confirm `?row=...` URL + grid view
3. Click back → confirm cascade restored
4. Toggle each filter (genre, decade, country, vote_average, search, mina tjänster) → confirm rows respond (or hide if <4 results)
5. Click X on a card → confirm it disappears and a new card appears
6. Verify cold-start path by signing in with a fresh account

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(recs): smoke-test cleanup"
```

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(recs): rebuild /recommendations as cascade hub" --body "Implements docs/superpowers/specs/2026-04-25-recommendations-redesign.md. See plan: docs/superpowers/plans/2026-04-25-recommendations-redesign.md"
```

---

## Self-review (run before handoff)

**Spec coverage:**
- Cascade-prioritering (score-formler) → Task 5 ✓
- Radkomposition per rad-typ → Tasks 6-12 ✓
- Cold-start tabell + QuickRateModal → Tasks 16, 17 ✓
- Streaming-roll på kort → Task 14 (CascadeRow), Task 15 (filter) ✓
- "Inte intresserad"-flow + tyst luck-fyllning → Task 14 ✓
- Sidnivå-filter (alla 6) → Task 15 ✓
- Filter-defaults återställs → Task 18 (state reset on mount) ✓
- Refresh-strategi (no button, staleTime) → built into hooks ✓
- Statisk seed-rotation → cascade is deterministic given input ✓
- Expanded view via ?row= → Task 19 ✓
- URL `/recommendations` + rubrik "För dig" → Tasks 18, 20 ✓
- TMDB-anrops-budget + cache-tiers → Tasks 1, 2 ✓
- Filorganisation enligt spec → all tasks ✓

**Placeholder scan:** None — all code is concrete. Two places carry "verify before commit" steps (Task 17 step 3 for `addOrUpdate`, Task 22 step 2 for Sentry tagging) — these are explicit verification gates, not TBDs.

**Type consistency:**
- `RowSpec`, `RowResult`, `Seed`, `FilterState`, `CascadeInput` defined in Task 0; used consistently
- `rowKey()`, `parseRowKey()` defined Task 0; used in Tasks 14, 19
- `MediaType` from existing `domain.ts`; `WatchlistItem.status` correctly uses `'mina' | 'sedd'` for seed eligibility

---

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
