# Cineasterna Library Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a "Finns på Cineasterna (via ditt bibliotek)" badge on film pages for titles available on Cineasterna (Sweden's library streaming service), sourced from Cineasterna's JSON backend and matched to TMDB exactly via IMDb id.

**Architecture:** A weekly Cloud Function performs Cineasterna's session handshake, pulls the Swedish title catalogue from `backend.cineasterna.com` (each title carries an `imdb_id`), resolves each IMDb id to a TMDB movie id via TMDB `/find` (caching resolved ids), and writes a single `cineasternaCatalog/current` doc holding the set of available TMDB ids (+ rental info). A rot guard refuses to overwrite if the fetched count collapses. Clients load that one catalog doc (persisted, like `genres`) and check membership to render the badge. Matching is exact (IMDb id), so there are no false "available" claims.

**Tech Stack:** Firebase Cloud Functions v2 (`onSchedule`, `defineSecret`), firebase-admin Firestore, plain `fetch` to Cineasterna + TMDB, Next.js/React 19 client with React Query, Vitest for pure logic.

## Global Constraints

- Region: `europe-west1`. Function config: `{ schedule, region, timeoutSeconds: 300, memory: '512MiB' }`.
- `getFirestore()` at usage time, not module level.
- Pure logic (no firebase imports) in sibling `*.ts`, unit-tested; IO/entrypoint manually verified.
- Cineasterna is **film-only** → badge renders on `MoviePageClient` only, never TV.
- Matching is **exact via IMDb id** → TMDB `/find/{imdbId}?external_source=imdb_id`. No fuzzy title matching.
- **Generic flag** (availability is technically per-library; Binge can't know the user's library): copy is "Finns på Cineasterna (via ditt bibliotek)".
- The catalog query key `'cineasterna-catalog'` **IS** added to `PERSISTED_QUERY_PREFIXES` — it is small shared catalog data (a few thousand ids ≈ tens of KB), the intended use of that allowlist. This is the one exception to the no-persist rule; per-title data still must never be persisted.
- **Rot guard:** if a sync returns 0 titles, or < 50% of the previous count, do NOT overwrite the catalog; write a health alert to the admin instead.
- UI copy in Swedish. Design tokens only.
- Attribution / politeness: weekly cadence, sequential fetches, set a descriptive `User-Agent`. Cineasterna `robots.txt` permits crawling (verified 2026-06-20).

## Discovered API facts (from the 2026-06-20 spike)

- Base: `https://backend.cineasterna.com`. All calls need `portal_sessionid` (from a `renew_portal_csrftoken` POST + `get_config` GET handshake — exact mechanism is Task 3 Step 1).
- National feed: `GET /library/title/get_new_titles?country_iso=se&num_titles=N&portal_sessionid=...` → `{ success, titles: [...] }`.
- Title object fields: `name`, `name_en`, `description`, `id` (cineasterna id), `rating`, **`imdb_id`** (e.g. `"tt27052428"`), `genres[]`, `release_date`, `duration`, `country_iso`, `is_rentable`, `rental_price_amount`, `rental_price_currency`.
- `GET /library/title/get_titles` exists but is library-scoped (returns `{success:false,error_code:"INVALID_PARAMS"}` without the right params) — Task 3 Step 1 confirms the param set + whether a large `get_new_titles?num_titles=` returns the full national catalogue.

---

## File Structure

**New — pure logic (unit-tested):**
- `functions/src/cineasterna/parse.ts` — `parseTitles`, `dedupeByImdb`, `detectRot`.
- `functions/src/cineasterna/parse.test.ts`
- `functions/src/cineasterna/types.ts`

**New — IO / entrypoint (manually verified):**
- `functions/src/cineasterna/api.ts` — session handshake + paged catalogue fetch.
- `functions/src/cineasterna/resolve.ts` — IMDb→TMDB resolver (TMDB `/find`).
- `functions/src/cineasterna/index.ts` — the `onSchedule` cron.

**Modified:**
- `functions/src/index.ts` — re-export the cron.
- `firestore.rules` — `cineasternaCatalog` public read, write false.
- `src/hooks/useCineasternaCatalog.ts` — **new** client hook.
- `src/lib/queryClient.ts` — add `'cineasterna-catalog'` to the persist allowlist.
- `src/components/pages/MoviePageClient.tsx` — render the badge.
- `docs/analysis/EXTERNAL_ACTIONS.md` — note TMDB key reuse (no new secret beyond TMDB).

---

## Task 1: Types + pure parser

**Files:**
- Create: `functions/src/cineasterna/types.ts`
- Create: `functions/src/cineasterna/parse.ts`
- Test: `functions/src/cineasterna/parse.test.ts`

**Interfaces:**
- Produces:
  - `interface CineasternaTitle { imdbId: string; name: string; rentable: boolean; rentalAmount: number | null; rentalCurrency: string | null }`
  - `interface CatalogDoc { tmdbIds: number[]; rental: Record<string, { amount: number; currency: string }>; count: number; updatedAt: number }`
  - `parseTitles(json: unknown): CineasternaTitle[]`
  - `dedupeByImdb(titles: CineasternaTitle[]): CineasternaTitle[]`
  - `detectRot(prevCount: number, newCount: number): boolean` (true = rot, refuse overwrite)

- [ ] **Step 1: Write the types**

```ts
// functions/src/cineasterna/types.ts
export interface CineasternaTitle {
  imdbId: string;
  name: string;
  rentable: boolean;
  rentalAmount: number | null;
  rentalCurrency: string | null;
}

export interface CatalogDoc {
  tmdbIds: number[];
  rental: Record<string, { amount: number; currency: string }>; // keyed by tmdbId
  count: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// functions/src/cineasterna/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseTitles, dedupeByImdb, detectRot } from './parse';

const apiResponse = {
  success: true,
  titles: [
    { name: 'Orwell: 2+2=5', imdb_id: 'tt27052428', is_rentable: false, rental_price_amount: null, rental_price_currency: null },
    { name: 'Pillion', imdb_id: 'tt32321317', is_rentable: true, rental_price_amount: 49, rental_price_currency: 'SEK' },
    { name: 'No imdb', imdb_id: '', is_rentable: false, rental_price_amount: null, rental_price_currency: null },
    { name: 'Null imdb', imdb_id: null, is_rentable: false, rental_price_amount: null, rental_price_currency: null },
  ],
};

describe('parseTitles', () => {
  it('keeps only titles with a valid imdb_id', () => {
    const out = parseTitles(apiResponse);
    expect(out.map((t) => t.imdbId)).toEqual(['tt27052428', 'tt32321317']);
  });
  it('captures rental info', () => {
    const pillion = parseTitles(apiResponse).find((t) => t.imdbId === 'tt32321317')!;
    expect(pillion).toMatchObject({ rentable: true, rentalAmount: 49, rentalCurrency: 'SEK' });
  });
  it('returns [] on failure/garbage', () => {
    expect(parseTitles({ success: false })).toEqual([]);
    expect(parseTitles(null)).toEqual([]);
  });
});

describe('dedupeByImdb', () => {
  it('collapses duplicate imdb ids (union of national + library feeds)', () => {
    const t = (imdbId: string): import('./types').CineasternaTitle => ({ imdbId, name: imdbId, rentable: false, rentalAmount: null, rentalCurrency: null });
    expect(dedupeByImdb([t('tt1'), t('tt1'), t('tt2')]).map((x) => x.imdbId)).toEqual(['tt1', 'tt2']);
  });
});

describe('detectRot', () => {
  it('flags a collapse to zero', () => {
    expect(detectRot(1000, 0)).toBe(true);
  });
  it('flags a >50% drop', () => {
    expect(detectRot(1000, 400)).toBe(true);
  });
  it('allows a normal change', () => {
    expect(detectRot(1000, 1010)).toBe(false);
    expect(detectRot(1000, 600)).toBe(false);
  });
  it('allows the first-ever run (prev 0)', () => {
    expect(detectRot(0, 500)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run functions/src/cineasterna/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the parser**

```ts
// functions/src/cineasterna/parse.ts
import type { CineasternaTitle } from './types';

const IMDB_RE = /^tt\d{6,}$/;

export function parseTitles(json: unknown): CineasternaTitle[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as { success?: unknown; titles?: unknown };
  if (o.success !== true || !Array.isArray(o.titles)) return [];
  const out: CineasternaTitle[] = [];
  for (const t of o.titles as Record<string, unknown>[]) {
    const imdbId = typeof t.imdb_id === 'string' ? t.imdb_id : '';
    if (!IMDB_RE.test(imdbId)) continue;
    const amount = t.rental_price_amount;
    out.push({
      imdbId,
      name: typeof t.name === 'string' ? t.name : '',
      rentable: t.is_rentable === true,
      rentalAmount: typeof amount === 'number' ? amount : null,
      rentalCurrency: typeof t.rental_price_currency === 'string' ? t.rental_price_currency : null,
    });
  }
  return out;
}

export function dedupeByImdb(titles: CineasternaTitle[]): CineasternaTitle[] {
  const seen = new Map<string, CineasternaTitle>();
  for (const t of titles) if (!seen.has(t.imdbId)) seen.set(t.imdbId, t);
  return [...seen.values()];
}

/** True = suspected scraper rot; caller must refuse to overwrite the catalog. */
export function detectRot(prevCount: number, newCount: number): boolean {
  if (prevCount <= 0) return false;        // first run / no baseline
  if (newCount === 0) return true;
  return newCount < prevCount * 0.5;       // >50% drop is implausible
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run functions/src/cineasterna/parse.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/cineasterna/types.ts functions/src/cineasterna/parse.ts functions/src/cineasterna/parse.test.ts
git commit -m "feat(cineasterna): title parser + rot guard"
```

---

## Task 2: IMDb→TMDB resolver

**Files:**
- Create: `functions/src/cineasterna/resolve.ts`

**Interfaces:**
- Produces: `resolveTmdbId(imdbId: string): Promise<number | null>` — TMDB movie id via `/find`, or null.

- [ ] **Step 1: Implement the resolver**

```ts
// functions/src/cineasterna/resolve.ts
import { logger } from 'firebase-functions/v2';

const BASE = 'https://api.themoviedb.org/3';

/** Resolve an IMDb id to a TMDB *movie* id (Cineasterna is film-only). */
export async function resolveTmdbId(imdbId: string): Promise<number | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) { logger.error('cineasterna: TMDB_API_KEY not set'); return null; }
  try {
    const res = await fetch(`${BASE}/find/${imdbId}?api_key=${key}&external_source=imdb_id`);
    if (!res.ok) { logger.warn(`cineasterna: TMDB /find ${imdbId} -> ${res.status}`); return null; }
    const json = await res.json();
    const movie = Array.isArray(json?.movie_results) ? json.movie_results[0] : null;
    return movie && typeof movie.id === 'number' ? movie.id : null;
  } catch (err) {
    logger.warn(`cineasterna: TMDB /find failed for ${imdbId}`, err);
    return null;
  }
}
```

- [ ] **Step 2: Build + commit**

Run: `cd functions && npm run build`

```bash
git add functions/src/cineasterna/resolve.ts
git commit -m "feat(cineasterna): exact IMDb->TMDB resolver via /find"
```

---

## Task 3: Cineasterna API client (IO — manually verified)

**Files:**
- Create: `functions/src/cineasterna/api.ts`

**Interfaces:**
- Consumes: `parseTitles`, `dedupeByImdb` (Task 1).
- Produces: `fetchCatalog(): Promise<CineasternaTitle[]>` — session handshake + full Swedish catalogue, deduped.

- [ ] **Step 1: Confirm the two open API details (use the browser/devtools once)**

1. **Session handshake:** how `portal_sessionid` is obtained. Watch the first calls on `https://www.cineasterna.com/sv/`: a `POST /renew_portal_csrftoken` then `GET /configuration/configuration/get_config`. Determine whether `portal_sessionid` comes back in a response body, a `Set-Cookie`, or is client-generated. Replicate it in `getSession()` below.
2. **Full catalogue:** test whether `get_new_titles?country_iso=se&num_titles=10000` returns the entire national catalogue (preferred — one call, no library needed). If it caps, capture the library-scoped `get_titles` params by selecting a library in the SPA and reading the network request. Record the working request.

- [ ] **Step 2: Implement the client (against confirmed details)**

```ts
// functions/src/cineasterna/api.ts
import { logger } from 'firebase-functions/v2';
import { parseTitles, dedupeByImdb } from './parse';
import type { CineasternaTitle } from './types';

const BASE = 'https://backend.cineasterna.com';
const UA = 'binge.nu catalog sync (+https://binge.nu)';

/** Obtain a portal_sessionid via the handshake confirmed in Step 1. */
async function getSession(): Promise<string | null> {
  try {
    // Confirmed in Step 1 — example shape; adjust to the real mechanism:
    const res = await fetch(`${BASE}/renew_portal_csrftoken`, { method: 'POST', headers: { 'User-Agent': UA } });
    const json = await res.json().catch(() => ({}));
    const sid = json?.portal_sessionid ?? null;
    return typeof sid === 'string' ? sid : null;
  } catch (err) {
    logger.error('cineasterna: session handshake failed', err);
    return null;
  }
}

/** Pull the full Swedish catalogue (national feed, large page). */
export async function fetchCatalog(): Promise<CineasternaTitle[]> {
  const sid = await getSession();
  if (!sid) return [];
  const url = `${BASE}/library/title/get_new_titles?country_iso=se&num_titles=10000&portal_sessionid=${sid}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) { logger.warn(`cineasterna: get_new_titles -> ${res.status}`); return []; }
  const titles = parseTitles(await res.json());
  return dedupeByImdb(titles);
}
```

> If Step 1 shows the national feed caps below the full catalogue, extend `fetchCatalog` to also fetch one major library's `get_titles` (paged) and `dedupeByImdb` the union. Keep the function's return contract identical.

- [ ] **Step 3: Manual verification**

Invoke `fetchCatalog()` (emulator/local script with `TMDB_API_KEY` set is not needed here — this only hits Cineasterna). Confirm it returns a few hundred+ titles with valid `imdbId`s.

- [ ] **Step 4: Commit**

```bash
git add functions/src/cineasterna/api.ts
git commit -m "feat(cineasterna): catalogue fetch + session handshake"
```

---

## Task 4: The weekly cron (entrypoint — manually verified)

**Files:**
- Create: `functions/src/cineasterna/index.ts`
- Modify: `functions/src/index.ts`
- Modify: `docs/analysis/EXTERNAL_ACTIONS.md`

**Interfaces:**
- Consumes: `fetchCatalog` (Task 3), `resolveTmdbId` (Task 2), `detectRot` (Task 1).
- Produces: `export const cineasternaCatalogSync`.

- [ ] **Step 1: Implement the cron**

```ts
// functions/src/cineasterna/index.ts
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { fetchCatalog } from './api';
import { resolveTmdbId } from './resolve';
import { detectRot } from './parse';
import type { CatalogDoc } from './types';

const TMDB_API_KEY = defineSecret('TMDB_API_KEY');
const ADMIN_UID = defineSecret('ADMIN_UID');

export const cineasternaCatalogSync = onSchedule(
  { schedule: 'every 168 hours', region: 'europe-west1', timeoutSeconds: 300, memory: '512MiB', secrets: [TMDB_API_KEY, ADMIN_UID] },
  async () => {
    const db = getFirestore();
    const ref = db.collection('cineasternaCatalog').doc('current');

    const titles = await fetchCatalog();
    const prev = (await ref.get()).data() as CatalogDoc | undefined;

    // Reuse prior imdb->tmdb resolutions to avoid re-hitting TMDB for known titles.
    const mapRef = db.collection('cineasternaCatalog').doc('imdbMap');
    const imdbMap = ((await mapRef.get()).data()?.map ?? {}) as Record<string, number | null>;

    const tmdbIds: number[] = [];
    const rental: CatalogDoc['rental'] = {};
    for (const t of titles) {
      let tmdbId = imdbMap[t.imdbId];
      if (tmdbId === undefined) { tmdbId = await resolveTmdbId(t.imdbId); imdbMap[t.imdbId] = tmdbId; }
      if (tmdbId == null) continue;
      tmdbIds.push(tmdbId);
      if (t.rentable && t.rentalAmount != null && t.rentalCurrency) {
        rental[String(tmdbId)] = { amount: t.rentalAmount, currency: t.rentalCurrency };
      }
    }

    if (detectRot(prev?.count ?? 0, tmdbIds.length)) {
      logger.error('cineasterna: rot detected, refusing overwrite', { prev: prev?.count, now: tmdbIds.length });
      const adminUid = process.env.ADMIN_UID;
      if (adminUid) {
        await db.collection('users').doc(adminUid).collection('notifications').add({
          kind: 'system', title: 'Cineasterna-synk misslyckades',
          body: `Hämtade ${tmdbIds.length} titlar (förra: ${prev?.count}). Behöll gammal katalog — kontrollera API:t.`,
          actionUrl: '/insikter', read: false, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    const doc: CatalogDoc = { tmdbIds, rental, count: tmdbIds.length, updatedAt: Date.now() };
    await ref.set(doc);
    await mapRef.set({ map: imdbMap });
    logger.info('cineasterna: catalog written', { count: tmdbIds.length });
  },
);
```

- [ ] **Step 2: Re-export**

In `functions/src/index.ts`: `export { cineasternaCatalogSync } from './cineasterna';`

- [ ] **Step 3: Record external action**

Append to `docs/analysis/EXTERNAL_ACTIONS.md`:

```markdown
## Cineasterna catalog sync

- Reuses the existing `TMDB_API_KEY` secret (for /find) + `ADMIN_UID` (rot alert). No new external account.
- Cron in `functions/` → `firebase deploy --only functions`; rules → `firebase deploy --only firestore:rules`.
- Source: undocumented but robots-permitted JSON API at backend.cineasterna.com. If it changes shape, the rot guard preserves the last good catalog and alerts the admin.
```

- [ ] **Step 4: Build + manual verify (staged)**

Run: `cd functions && npm run build`. Deploy to the project, "Run now" in Cloud Scheduler, confirm logs show a sane `count` and `cineasternaCatalog/current` exists with `tmdbIds`.

- [ ] **Step 5: Commit**

```bash
git add functions/src/cineasterna/index.ts functions/src/index.ts docs/analysis/EXTERNAL_ACTIONS.md
git commit -m "feat(cineasterna): weekly catalog sync cron with rot guard"
```

---

## Task 5: Firestore rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add the rule**

```
// Cineasterna availability catalog — written by the cineasternaCatalogSync cron
// (Admin SDK bypasses rules), public read (it's catalog data, no PII).
match /cineasternaCatalog/{doc} {
  allow read: if true;
  allow write: if false;
}
```

- [ ] **Step 2: Validate + commit**

Run: `firebase deploy --only firestore:rules --dry-run`

```bash
git add firestore.rules
git commit -m "feat(cineasterna): firestore rule (public read catalog, no client write)"
```

---

## Task 6: Client hook + persist allowlist

**Files:**
- Create: `src/hooks/useCineasternaCatalog.ts`
- Modify: `src/lib/queryClient.ts`

**Interfaces:**
- Produces: `useCineasternaCatalog(): { has: (tmdbId: number) => boolean; rentalFor: (tmdbId: number) => { amount: number; currency: string } | null }`

- [ ] **Step 1: Add the query key to the persist allowlist**

In `src/lib/queryClient.ts`, add `'cineasterna-catalog'` to `PERSISTED_QUERY_PREFIXES`:

```ts
const PERSISTED_QUERY_PREFIXES = new Set([
  'genres-movie', 'genres-tv',
  'trending', 'popular-movies', 'popular-tv', 'discover-movies', 'discover-tv',
  'cineasterna-catalog', // small shared catalog (~tens of KB); safe to persist
]);
```

- [ ] **Step 2: Implement the hook**

```ts
// src/hooks/useCineasternaCatalog.ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fsdb } from '@/lib/firebase/db';

interface CatalogDoc {
  tmdbIds: number[];
  rental: Record<string, { amount: number; currency: string }>;
}

export function useCineasternaCatalog() {
  const { data } = useQuery({
    queryKey: ['cineasterna-catalog'],
    staleTime: 1000 * 60 * 60 * 24, // catalog refreshes weekly server-side
    queryFn: async (): Promise<CatalogDoc | null> => {
      const { db, doc, getDoc } = await fsdb();
      const snap = await getDoc(doc(db, 'cineasternaCatalog', 'current'));
      return snap.exists() ? (snap.data() as CatalogDoc) : null;
    },
  });
  const set = useMemo(() => new Set(data?.tmdbIds ?? []), [data]);
  return {
    has: (tmdbId: number) => set.has(tmdbId),
    rentalFor: (tmdbId: number) => data?.rental?.[String(tmdbId)] ?? null,
  };
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/hooks/useCineasternaCatalog.ts src/lib/queryClient.ts
git commit -m "feat(cineasterna): client catalog hook (persisted) + membership lookup"
```

---

## Task 7: Render the badge on film pages

**Files:**
- Modify: `src/components/pages/MoviePageClient.tsx`

**Interfaces:**
- Consumes: `useCineasternaCatalog` (Task 6).

- [ ] **Step 1: Render the badge in the provider area**

```tsx
import { useCineasternaCatalog } from '@/hooks/useCineasternaCatalog';

const cineasterna = useCineasternaCatalog();
const onCineasterna = cineasterna.has(movie.id);
const cineRental = cineasterna.rentalFor(movie.id);
// ...near the providers row:
{onCineasterna && (
  <a
    href="https://www.cineasterna.com/sv/"
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 rounded-sm bg-bg-2 text-ink-2 px-2 py-1 text-[12px]"
  >
    Finns på Cineasterna (via ditt bibliotek)
    {cineRental && <span className="text-ink-3">· hyr {cineRental.amount} {cineRental.currency}</span>}
  </a>
)}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`. With the catalog doc seeded (run the cron, or hand-write a `cineasternaCatalog/current` doc with a known movie's TMDB id), open that movie → the badge appears. Open a mainstream blockbuster not on Cineasterna → no badge. Confirm TV pages are unaffected.

- [ ] **Step 3: Typecheck + design guard + commit**

Run: `npm run typecheck && npx vitest run src/lib/design/consistency.test.ts`

```bash
git add src/components/pages/MoviePageClient.tsx
git commit -m "feat(cineasterna): finns-på-Cineasterna badge on film pages"
```

---

## Task 8: Pre-merge review + deploy

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm test` (watch `no-explicit-any`).
- [ ] **Step 2:** Dispatch `binge-security-reviewer` (new rules + external fetch) and `binge-code-reviewer`. Address findings.
- [ ] **Step 3:** Deploy: `firebase deploy --only firestore:rules` then `firebase deploy --only functions` (TMDB_API_KEY + ADMIN_UID already set from earlier plans). "Run now" the cron, verify catalog doc, then push client to main.

---

## Self-Review

**Spec coverage:** availability badge (Tasks 6,7) ✓; exact IMDb→TMDB match, no fuzzy claims (Task 2) ✓; clean API not scrape (Task 3) ✓; rot guard preserves last good catalog + alerts (Tasks 1,4) ✓; generic per-library-aware copy (Task 7) ✓; film-only (Task 7 movie page only) ✓; catalog persisted correctly, per-title data still not (Task 6) ✓.

**Placeholder scan:** the two genuine API unknowns (session handshake mechanism; full-catalogue endpoint vs national-feed cap) are explicit confirm-steps in Task 3 Step 1 — surfaced, not hidden. The handshake code is written against the observed shape with an adjust note.

**Type consistency:** `CineasternaTitle` and `CatalogDoc` shared from `types.ts`; `fetchCatalog(): CineasternaTitle[]` consumed in the cron; `detectRot(prev, new)` signature matches; client `CatalogDoc` mirror (tmdbIds, rental) matches what the cron writes; `useCineasternaCatalog().has/rentalFor` consumed in Task 7.
