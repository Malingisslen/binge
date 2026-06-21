# External Ratings (OMDb: IMDb / Rotten Tomatoes / Metacritic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show IMDb rating (and Rotten Tomatoes / Metacritic when available) on movie and TV title pages, sourced from OMDb, behind a shared server-side cache so the OMDb key stays secret and the free tier (1,000/day) lasts indefinitely.

**Architecture:** A `titleRatings` **callable** Cloud Function takes an IMDb id, serves from a shared `titleRatings/{imdbId}` cache doc (45-day TTL), and only hits OMDb on a cold/stale entry — writing the result back via Admin SDK. Clients call it through a React Query hook and render a ratings row beside the existing TMDB score. The OMDb key never reaches the client bundle, and because the cache is shared across all users, total OMDb calls scale with *unique cold titles viewed*, not users × views.

**Tech Stack:** Firebase Cloud Functions v2 (`onCall`, `defineSecret`, `HttpsError`), firebase-admin Firestore, Next.js/React 19 client with React Query + lazy `httpsCallable`, Vitest for pure logic.

## Global Constraints

- Region for the function: `europe-west1`.
- Follow the existing callable pattern in `functions/src/submitReport/index.ts` (onCall, `request.auth?.uid`, `HttpsError`, re-export from `functions/src/index.ts`).
- Client invokes via the lazy dynamic-import pattern in `src/lib/firebase/reports.ts` (`await import('firebase/functions')`, `getFunctions(app, 'europe-west1')`, emulator connect guard) — there is no `fsdb()`-style helper for functions; mirror `reports.ts`.
- Pure logic (no firebase imports) lives in a `*.ts` sibling and is unit-tested; the callable entrypoint is verified manually.
- New client query key `'title-ratings'` must NOT be added to `PERSISTED_QUERY_PREFIXES` in `src/lib/queryClient.ts`.
- No hex colors / no `text-red-*` in components — design tokens only. UI copy in Swedish.
- Cache TTL: `RATINGS_TTL_DAYS = 45`.
- `imdb_id` source: movies → top-level `movie.imdb_id`; TV → `show.external_ids?.imdb_id` (already appended in `getTVShow`).
- Render IMDb as primary; show RT/Metacritic only when present (they are sparse for Nordic/foreign/older titles — never render an empty slot).

---

## File Structure

**New — pure logic (unit-tested):**
- `functions/src/titleRatings/parse.ts` — `parseOmdbRatings`, `isFresh`.
- `functions/src/titleRatings/parse.test.ts`
- `functions/src/titleRatings/types.ts` — `Ratings`, `RatingsDoc`.

**New — callable entrypoint (manually verified):**
- `functions/src/titleRatings/index.ts` — `onCall` function.

**New — client:**
- `src/lib/ratings/types.ts` — client `Ratings` type (mirror).
- `src/hooks/useTitleRatings.ts` — React Query + lazy callable.
- `src/components/title/RatingsRow.tsx` — the rendered row.
- `src/components/title/RatingsRow.test.tsx` — render logic (presence/absence of RT/Meta).

**Modified:**
- `functions/src/index.ts` — re-export the callable.
- `firestore.rules` — block client access to `titleRatings` (callable uses Admin SDK).
- `src/components/pages/MoviePageClient.tsx` — render `RatingsRow` in the `stats` row.
- `src/components/pages/TVShowPageClient.tsx` — same.
- `docs/analysis/EXTERNAL_ACTIONS.md` — record the `OMDB_API_KEY` secret.

---

## Task 1: Shared types + pure parser

**Files:**
- Create: `functions/src/titleRatings/types.ts`
- Create: `functions/src/titleRatings/parse.ts`
- Test: `functions/src/titleRatings/parse.test.ts`

**Interfaces:**
- Produces:
  - `interface Ratings { imdb: { score: number; votes: number } | null; rottenTomatoes: number | null; metacritic: number | null }`
  - `interface RatingsDoc extends Ratings { imdbId: string; checkedAt: number }`
  - `parseOmdbRatings(json: unknown): Ratings`
  - `isFresh(checkedAt: number, nowMs: number, ttlDays: number): boolean`

- [ ] **Step 1: Write the types**

```ts
// functions/src/titleRatings/types.ts
export interface Ratings {
  imdb: { score: number; votes: number } | null;
  rottenTomatoes: number | null; // percent, 0-100
  metacritic: number | null;     // 0-100
}

export interface RatingsDoc extends Ratings {
  imdbId: string;
  checkedAt: number; // epoch millis
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// functions/src/titleRatings/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseOmdbRatings, isFresh } from './parse';

describe('parseOmdbRatings', () => {
  it('parses a full OMDb response', () => {
    const json = {
      Response: 'True',
      imdbRating: '8.4',
      imdbVotes: '1,234,567',
      Metascore: '82',
      Ratings: [
        { Source: 'Internet Movie Database', Value: '8.4/10' },
        { Source: 'Rotten Tomatoes', Value: '91%' },
        { Source: 'Metacritic', Value: '82/100' },
      ],
    };
    expect(parseOmdbRatings(json)).toEqual({
      imdb: { score: 8.4, votes: 1234567 },
      rottenTomatoes: 91,
      metacritic: 82,
    });
  });

  it('returns nulls when Response is False', () => {
    expect(parseOmdbRatings({ Response: 'False', Error: 'Not found!' })).toEqual({
      imdb: null, rottenTomatoes: null, metacritic: null,
    });
  });

  it('handles missing RT/Metacritic gracefully (common for Nordic titles)', () => {
    const json = { Response: 'True', imdbRating: '7.1', imdbVotes: '900', Metascore: 'N/A', Ratings: [
      { Source: 'Internet Movie Database', Value: '7.1/10' },
    ] };
    expect(parseOmdbRatings(json)).toEqual({
      imdb: { score: 7.1, votes: 900 }, rottenTomatoes: null, metacritic: null,
    });
  });

  it('treats imdbRating "N/A" as null imdb', () => {
    expect(parseOmdbRatings({ Response: 'True', imdbRating: 'N/A', imdbVotes: 'N/A' }).imdb).toBeNull();
  });

  it('returns nulls for non-object input', () => {
    expect(parseOmdbRatings(null)).toEqual({ imdb: null, rottenTomatoes: null, metacritic: null });
  });
});

describe('isFresh', () => {
  const now = Date.parse('2026-06-20T00:00:00Z');
  it('fresh within TTL', () => {
    expect(isFresh(now - 10 * 86_400_000, now, 45)).toBe(true);
  });
  it('stale past TTL', () => {
    expect(isFresh(now - 50 * 86_400_000, now, 45)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run functions/src/titleRatings/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the parser**

```ts
// functions/src/titleRatings/parse.ts
import type { Ratings } from './types';

const NA = (v: unknown): v is 'N/A' => v === 'N/A';

function num(v: unknown): number | null {
  if (typeof v !== 'string' || NA(v)) return null;
  const n = Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "91%" -> 91, "82/100" -> 82, "8.4/10" -> 8.4 */
function fromRating(value: string): number | null {
  const pct = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return Number(pct[1]);
  const frac = value.match(/^(\d+(?:\.\d+)?)\/\d+$/);
  if (frac) return Number(frac[1]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseOmdbRatings(json: unknown): Ratings {
  const empty: Ratings = { imdb: null, rottenTomatoes: null, metacritic: null };
  if (!json || typeof json !== 'object') return empty;
  const o = json as Record<string, unknown>;
  if (o.Response !== 'True') return empty;

  const score = num(o.imdbRating);
  const votes = num(o.imdbVotes);
  const imdb = score != null ? { score, votes: votes ?? 0 } : null;

  let rottenTomatoes: number | null = null;
  let metacritic: number | null = num(o.Metascore);
  if (Array.isArray(o.Ratings)) {
    for (const r of o.Ratings as { Source?: string; Value?: string }[]) {
      if (r.Source === 'Rotten Tomatoes' && typeof r.Value === 'string') rottenTomatoes = fromRating(r.Value);
      if (r.Source === 'Metacritic' && typeof r.Value === 'string' && metacritic == null) metacritic = fromRating(r.Value);
    }
  }
  return { imdb, rottenTomatoes, metacritic };
}

export function isFresh(checkedAt: number, nowMs: number, ttlDays: number): boolean {
  return nowMs - checkedAt < ttlDays * 86_400_000;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run functions/src/titleRatings/parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/titleRatings/types.ts functions/src/titleRatings/parse.ts functions/src/titleRatings/parse.test.ts
git commit -m "feat(ratings): OMDb response parser + cache freshness check"
```

---

## Task 2: The `titleRatings` callable (entrypoint — manually verified)

**Files:**
- Create: `functions/src/titleRatings/index.ts`
- Modify: `functions/src/index.ts`
- Modify: `docs/analysis/EXTERNAL_ACTIONS.md`

**Interfaces:**
- Consumes: `parseOmdbRatings`, `isFresh` (Task 1).
- Produces: `export const titleRatings` — callable taking `{ imdbId: string }`, returning `RatingsDoc`.

- [ ] **Step 1: Implement the callable**

```ts
// functions/src/titleRatings/index.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { parseOmdbRatings, isFresh } from './parse';
import type { RatingsDoc } from './types';

const OMDB_API_KEY = defineSecret('OMDB_API_KEY');
const TTL_DAYS = 45;
const IMDB_RE = /^tt\d{6,}$/;

export const titleRatings = onCall(
  { region: 'europe-west1', secrets: [OMDB_API_KEY] },
  async (request): Promise<RatingsDoc> => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Logga in.');
    const imdbId = String((request.data as { imdbId?: unknown })?.imdbId ?? '');
    if (!IMDB_RE.test(imdbId)) throw new HttpsError('invalid-argument', 'Ogiltigt IMDb-id.');

    const db = getFirestore();
    const ref = db.collection('titleRatings').doc(imdbId);
    const now = Date.now();

    const snap = await ref.get();
    if (snap.exists) {
      const cached = snap.data() as RatingsDoc;
      if (isFresh(cached.checkedAt, now, TTL_DAYS)) return cached;
    }

    const key = process.env.OMDB_API_KEY;
    if (!key) throw new HttpsError('internal', 'OMDB_API_KEY saknas.');
    let ratings;
    try {
      const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${key}`);
      ratings = parseOmdbRatings(await res.json());
    } catch (err) {
      logger.warn(`titleRatings: OMDb fetch failed for ${imdbId}`, err);
      // Serve stale rather than failing the UI, if we have it.
      if (snap.exists) return snap.data() as RatingsDoc;
      throw new HttpsError('unavailable', 'Betyg kunde inte hämtas.');
    }

    const doc: RatingsDoc = { imdbId, checkedAt: now, ...ratings };
    await ref.set(doc);
    return doc;
  },
);
```

- [ ] **Step 2: Re-export**

In `functions/src/index.ts`:

```ts
export { titleRatings } from './titleRatings';
```

- [ ] **Step 3: Record the external action**

Append to `docs/analysis/EXTERNAL_ACTIONS.md`:

```markdown
## External Ratings (OMDb)

- `firebase functions:secrets:set OMDB_API_KEY` — OMDb API key (free tier 1,000/day;
  $1/mo Patreon lifts it). Required by the `titleRatings` callable.
- Callable function → `firebase deploy --only functions`. Rules → `firebase deploy --only firestore:rules`.
```

- [ ] **Step 4: Build + typecheck**

Run: `cd functions && npm run build`
Expected: compiles clean.

- [ ] **Step 5: Commit**

```bash
git add functions/src/titleRatings/index.ts functions/src/index.ts docs/analysis/EXTERNAL_ACTIONS.md
git commit -m "feat(ratings): titleRatings callable with shared 45-day cache"
```

---

## Task 3: Firestore rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add the rule**

Inside the documents match block:

```
// External ratings cache — written/read only by the titleRatings callable
// (Admin SDK bypasses rules); clients reach it through the callable, never directly.
match /titleRatings/{imdbId} {
  allow read, write: if false;
}
```

- [ ] **Step 2: Validate**

Run: `firebase deploy --only firestore:rules --dry-run`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add firestore.rules
git commit -m "feat(ratings): firestore rule blocking direct client access to titleRatings"
```

---

## Task 4: Client hook — `useTitleRatings`

**Files:**
- Create: `src/lib/ratings/types.ts`
- Create: `src/hooks/useTitleRatings.ts`

**Interfaces:**
- Produces:
  - client `Ratings` type (mirror of function type),
  - `useTitleRatings(imdbId: string | null | undefined): Ratings | null`

- [ ] **Step 1: Client types**

```ts
// src/lib/ratings/types.ts
export interface Ratings {
  imdb: { score: number; votes: number } | null;
  rottenTomatoes: number | null;
  metacritic: number | null;
}
export interface RatingsDoc extends Ratings {
  imdbId: string;
  checkedAt: number;
}
```

- [ ] **Step 2: Implement the hook**

```ts
// src/hooks/useTitleRatings.ts
import { useQuery } from '@tanstack/react-query';
import type { Ratings, RatingsDoc } from '@/lib/ratings/types';

/**
 * Fetch external ratings via the titleRatings callable. Query key 'title-ratings'
 * is intentionally NOT persisted (per-title data). Lazy-imports firebase/functions
 * to keep it out of first-load bundle (mirrors src/lib/firebase/reports.ts).
 */
export function useTitleRatings(imdbId: string | null | undefined): Ratings | null {
  const { data } = useQuery({
    queryKey: ['title-ratings', imdbId],
    enabled: !!imdbId,
    staleTime: 1000 * 60 * 60 * 24, // ratings barely move; 1 day client-side
    queryFn: async (): Promise<RatingsDoc> => {
      const { getFunctions, httpsCallable, connectFunctionsEmulator } = await import('firebase/functions');
      const app = (await import('@/lib/firebase/config')).default;
      const functions = getFunctions(app, 'europe-west1');
      if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
        try { connectFunctionsEmulator(functions, '127.0.0.1', 5001); } catch { /* idempotent */ }
      }
      const call = httpsCallable<{ imdbId: string }, RatingsDoc>(functions, 'titleRatings');
      return (await call({ imdbId: imdbId! })).data;
    },
  });
  return data ?? null;
}
```

> Confirm the import path `@/lib/firebase/config` matches what `reports.ts` uses (`./config` from inside `src/lib/firebase/`). Adjust the alias if needed.

- [ ] **Step 3: Typecheck + confirm not persisted**

Run: `npm run typecheck`
Confirm `'title-ratings'` is absent from `PERSISTED_QUERY_PREFIXES`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ratings/types.ts src/hooks/useTitleRatings.ts
git commit -m "feat(ratings): useTitleRatings client hook (callable + non-persisted)"
```

---

## Task 5: `RatingsRow` component

**Files:**
- Create: `src/components/title/RatingsRow.tsx`
- Test: `src/components/title/RatingsRow.test.tsx`

**Interfaces:**
- Consumes: client `Ratings` (Task 4).
- Produces: `<RatingsRow ratings={Ratings | null} imdbId={string} />` — renders IMDb span always (when present), RT/Meta only when non-null. Returns `null` if no ratings at all.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/title/RatingsRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingsRow } from './RatingsRow';

describe('RatingsRow', () => {
  it('renders IMDb score when present', () => {
    render(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 8.4, votes: 100 }, rottenTomatoes: null, metacritic: null }} />);
    expect(screen.getByText(/8\.4/)).toBeInTheDocument();
  });

  it('renders RT only when present', () => {
    const { rerender } = render(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 7, votes: 1 }, rottenTomatoes: 91, metacritic: null }} />);
    expect(screen.getByText(/91%/)).toBeInTheDocument();
    rerender(<RatingsRow imdbId="tt1" ratings={{ imdb: { score: 7, votes: 1 }, rottenTomatoes: null, metacritic: null }} />);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('renders nothing when no ratings at all', () => {
    const { container } = render(<RatingsRow imdbId="tt1" ratings={{ imdb: null, rottenTomatoes: null, metacritic: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when ratings is null (still loading)', () => {
    const { container } = render(<RatingsRow imdbId="tt1" ratings={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/title/RatingsRow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/title/RatingsRow.tsx
import type { Ratings } from '@/lib/ratings/types';

export function RatingsRow({ ratings, imdbId }: { ratings: Ratings | null; imdbId: string }) {
  if (!ratings || (!ratings.imdb && ratings.rottenTomatoes == null && ratings.metacritic == null)) {
    return null;
  }
  return (
    <>
      {ratings.imdb && (
        <span>
          <span className="k">imdb-betyg</span>
          <strong>{ratings.imdb.score.toFixed(1)} / 10</strong>
        </span>
      )}
      {ratings.rottenTomatoes != null && (
        <span>
          <span className="k">rotten</span>
          <strong>{ratings.rottenTomatoes}%</strong>
        </span>
      )}
      {ratings.metacritic != null && (
        <span>
          <span className="k">metacritic</span>
          <strong>{ratings.metacritic}</strong>
        </span>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/title/RatingsRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/title/RatingsRow.tsx src/components/title/RatingsRow.test.tsx
git commit -m "feat(ratings): RatingsRow component (IMDb primary, RT/Meta when present)"
```

---

## Task 6: Wire ratings into title pages

**Files:**
- Modify: `src/components/pages/MoviePageClient.tsx`
- Modify: `src/components/pages/TVShowPageClient.tsx`

**Interfaces:**
- Consumes: `useTitleRatings` (Task 4), `RatingsRow` (Task 5).

- [ ] **Step 1: Movie page**

In `MoviePageClient.tsx`, add the hook near the top and render `RatingsRow` inside the existing `stats` div (lines ~172–185), after the `tmdb` span:

```tsx
import { useTitleRatings } from '@/hooks/useTitleRatings';
import { RatingsRow } from '@/components/title/RatingsRow';

const ratings = useTitleRatings(movie.imdb_id);
// ...inside <div className="stats"> ...
<RatingsRow ratings={ratings} imdbId={movie.imdb_id ?? ''} />
```

- [ ] **Step 2: TV page**

In `TVShowPageClient.tsx`, using the nested id `show.external_ids?.imdb_id` (already computed as `imdbId` at line ~124):

```tsx
import { useTitleRatings } from '@/hooks/useTitleRatings';
import { RatingsRow } from '@/components/title/RatingsRow';

const ratings = useTitleRatings(imdbId);
// ...inside <div className="stats"> ...
<RatingsRow ratings={ratings} imdbId={imdbId ?? ''} />
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Open a popular movie (e.g. one with `imdb_id`). With the function deployed (or emulated) and `OMDB_API_KEY` set, confirm the IMDb/RT/Metacritic spans appear in the stats row. Open a Nordic/obscure title and confirm RT/Meta are simply absent (no empty slot, no error). Confirm a title without `imdb_id` renders the page unchanged.

- [ ] **Step 4: Typecheck + design guard + commit**

Run: `npm run typecheck && npx vitest run src/lib/design/consistency.test.ts`
Expected: PASS.

```bash
git add src/components/pages/MoviePageClient.tsx src/components/pages/TVShowPageClient.tsx
git commit -m "feat(ratings): show IMDb/RT/Metacritic on movie + TV title pages"
```

---

## Task 7: Pre-merge review + deploy

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run typecheck && npm test` (watch for `no-explicit-any` — ERROR in deploy.yml).

- [ ] **Step 2: Review subagents**

Dispatch `binge-security-reviewer` (new callable + rules + secret) and `binge-code-reviewer` on the staged diff. Address findings.

- [ ] **Step 3: Deploy in order**

```bash
firebase functions:secrets:set OMDB_API_KEY
firebase deploy --only firestore:rules
firebase deploy --only functions
# client ships on push to main
```

- [ ] **Step 4: Smoke test in prod, then push client to main.**

---

## Self-Review

**Spec coverage:** IMDb/RT/Metacritic on title pages (Tasks 5,6) ✓; shared cache keeps key secret + free tier durable (Task 2) ✓; IMDb primary, RT/Meta only-when-present (Task 5) ✓; per-title data not persisted (Task 4) ✓; movie vs TV imdb_id sources handled (Task 6) ✓.

**Placeholder scan:** the only external unknown (config import alias) is flagged as a confirm step in Task 4 Step 2, not a hidden TODO.

**Type consistency:** `Ratings` shape identical in `functions/src/titleRatings/types.ts` and `src/lib/ratings/types.ts`. `useTitleRatings` returns `Ratings | null`, consumed by `RatingsRow` (`ratings` prop typed `Ratings | null`). Callable signature `{ imdbId: string } -> RatingsDoc` matches client `httpsCallable` generic.
