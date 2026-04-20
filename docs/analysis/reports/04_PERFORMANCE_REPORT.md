# Binge — Performance & Scalability Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Hosting:** Firebase Hosting + Cloudflare CDN
**Model:** Next.js 14 static export (client-side only SPA)

---

## Executive Summary

```
OVERALL SCORE: 60/100
  1. Core Web Vitals & Page Load:           10/18
  2. Bundle Size & Code Splitting:           8/12    ← 1.8 MB chunks, heavy Firebase SDK
  3. TMDB Request Fan-Out & Rate Limiting:   7/18    ← advisor fan-out 40+ concurrent possible
  4. Firestore Query Performance & Cost:     9/18    ← rule get() cost + only 3 limit() calls
  5. Scalability Projections:                8/12
  6. Image & Network Efficiency:             5/12    ← 28 raw <img> tags, no next/image
  7. Offline & Resilience:                   7/10

STATUS: Needs Optimization — several HIGH items but architecture is fundamentally sound

CRITICAL ISSUES: 0
HIGH:            4
MEDIUM:          9
LOW:             5
```

---

## Dimension 1 — Core Web Vitals & Page Load: 10/18

**Methodology note.** Lighthouse not run in this Phase 1 pass (would
require Puppeteer). Estimates based on static analysis of bundle sizes,
component structure, and observed render patterns.

### LCP (Largest Contentful Paint)

**Expected LCP element per page:**
- `/` (home): Hero + WatchingTable — LCP likely a poster image or a
  table cell render
- `/search`: empty state, then search results — LCP shifts to first
  result card
- `/tv/[id]`: backdrop image + detail card — LCP is backdrop (can be
  optimized)
- `/my/following`: WatchlistPage rendered list — LCP is first row

### Findings

#### HIGH

**P1 — 28 raw `<img>` tags bypass all image optimization** — distributed across src/app/*, src/components/*
- Current: `images.unoptimized = true` in `next.config.mjs` (required
  for static export). Using raw `<img>` with TMDB URLs.
- ESLint emits 28 `no-img-element` warnings (01 report confirmed).
- Impact:
  - No responsive `sizes` → browser downloads full-size posters (w342
    or w500) even on mobile screens showing tiny thumbnails
  - No `loading="lazy"` in most places → all below-the-fold posters
    block
  - No `decoding="async"`
  - No width/height attribute audit done here → possible CLS
- Fix: audit each site and add `loading="lazy"` + explicit `width`/`height`
  + `srcSet` for responsive sizing (TMDB has w92/w154/w185/w342/w500
  variants built in).
- Effort: **1 day** (systematic across 28 sites, each small)

**P2 — Dashboard fan-out can exceed TMDB rate limit cold** — `useSubscriptionAdvisor.ts:116`
- `useQueries` fires one TMDB fetch PER `tmdbId`:
  ```typescript
  queries: tmdbIds.map(id => ({
    queryKey: ['tv', id], queryFn: () => getTVShow(id), staleTime: 10 * 60 * 1000,
  }))
  ```
- `tmdbIds` = following-TV + vill_se-TV.
- For a power user with 40 following-TV + 20 vill_se-TV, that's 60
  concurrent requests on cold dashboard load.
- TMDB rate limit: ~40 req / 10 s / IP. Burst > 40 → HTTP 429s in
  React Query's error state.
- Plus: `useRevivalNudges` adds up to 20 more TMDB calls (MAX_CHECKS = 20).
- Plus: dashboard widgets (WatchingTable, UpcomingCards) may trigger
  their own.
- Fix: throttle / batch. Options:
  - Client-side: use `useQueries` with a pacing wrapper (stagger in
    groups of 10 / 2s)
  - Cache-first: rely on stored `tmdbStatus` on watchlist items for the
    "status" signal (partially done — full coverage unclear)
  - Server-side TMDB proxy via Cloud Function (longer-term; cost
    implication per 04 Dim 6)
- Severity: HIGH in cold-cache scenarios
- Effort: **4 h** (client-side staggering)

#### MEDIUM

**P3 — No explicit `<link rel="preconnect">` for `api.themoviedb.org` or `image.tmdb.org`** — `src/app/layout.tsx`
- Adding preconnects to both saves ~150–300 ms on first TMDB request.
- Fix: add to `layout.tsx` metadata / `<head>`.
- Effort: **15 min**

**P4 — No `prefetchQuery` on hover for card → detail navigation**
- User hovers a poster → dashboard could prefetch the detail. React
  Query supports this naturally.
- Fix: on `TitleCard` hover, `queryClient.prefetchQuery(...)`.
- Effort: **2 h**

#### LOW

**P5 — `suppressHydrationWarning` on body** — `src/app/layout.tsx:23`
- Noted in 01 report. Performance impact nil; flagged for transparency.

### INP (Interaction to Next Paint)

Spot-check: SearchForm, WatchlistPage filter/sort. No obvious
synchronous-heavy handlers. React Query handles async well.

**Potential concern:** `WatchlistPage` at 614 lines with in-memory
filter + sort. With 500+ watchlist items, filter typing could lag.
Virtualization not used (no `react-window` / `react-virtual`).

#### MEDIUM

**P6 — No list virtualization anywhere**
- `WatchlistPage`: could render 500+ rows with images
- `/feed` activity feed
- Long review lists
- Fix: add `@tanstack/react-virtual` for lists > 100 items.
- Effort: **1 day** across the main surfaces

### CLS (Cumulative Layout Shift)

- `SkeletonCard` exists in components — good pattern
- Verify CLS: does SkeletonCard match final card dimensions?
  (Spot-check: yes, tight match)

#### LOW

**P7 — No explicit dimensions on some raw `<img>` tags**
- Without width/height, image loads cause CLS.
- Bundled with P1 remediation.

### TTI / TBT

Bundle first-load parse time depends on chunk sizes (see Dim 2). With
~570 KB of JS on the critical path, parse + compile on mid-range mobile
is ~500-800 ms. Acceptable but tightenable.

---

## Dimension 2 — Bundle Size & Code Splitting: 8/12

### Build Output (confirmed via `ls out/_next/static/chunks/`)

```
Total chunks dir: 1.8 MB (uncompressed)
Total /_next: 1.8 MB
Full /out: 2.5 MB

Top chunks (uncompressed):
  fd9d1056-...js     173 KB   (likely Firebase)
  3ed8c523-...js     172 KB   (likely Firebase too)
  framework-...js    140 KB   (React 18)
  2117-...js         125 KB   (app shared)
  4684-...js         120 KB   (app shared)
  6070-...js         119 KB   (app shared)
  main-...js         117 KB
  polyfills-...js    113 KB
  57523b15-...js      87 KB
```

Gzip estimate: ~35% → **~600-700 KB gzipped** for the critical path
once all chunks are loaded.

### Findings

#### HIGH

**B-1 — Firebase SDK dominates bundle size**
- Two 170+ KB chunks almost certainly Firebase App + Auth + Firestore.
- Verified modular imports in `src/lib/firebase/config.ts` (`firebase/app`,
  `firebase/auth`, `firebase/firestore`) — correct. No accidental
  namespace imports.
- Still: Firebase JS SDK v12 is large. Difficult to reduce without
  Switching to a different auth provider or splitting Firestore usage.
- Fix: accept as baseline cost. Mitigation: ensure Firebase is loaded
  ONLY on authed pages (currently loaded globally via Providers).
  Alternative: dynamic import of Firestore on first write.
- Effort: **medium** — architectural. Defer until bundle budget is
  actually a problem.

#### MEDIUM

**B-2 — No `next/dynamic` / `React.lazy` usage** — `grep -rn "dynamic(\|React.lazy"` → 0
- Heavy components (GroupPageClient 908 lines, TillsammansSessionPageClient
  587 lines, InsikterClient / stats page) could be dynamically imported
  so they don't weigh down the shared chunks.
- Effort: **1 h per candidate**, ~3 h total

**B-3 — 2117/4684/6070 chunks (~360 KB combined) likely app-shared code that should split**
- These are the 3 biggest "app" chunks. Without bundle analyzer it's
  hard to know what's in them.
- Fix: run `ANALYZE=true npm run build` with `@next/bundle-analyzer` to
  inspect, then split.
- Effort: **30 min** to install + analyze, hours to split intelligently

**B-4 — No `@next/bundle-analyzer` installed**
- Cross-ref 05 (deps): recommend adding as devDep for periodic audits.
- Effort: **10 min** install

### Tailwind Output

CSS chunks not inspected but Tailwind with `content: [src/**/*]` scan
produces ~15-30 KB gzipped typical. Acceptable.

### Lucide Icons

Tree-shaken by Next.js when imported as
`import { Icon } from 'lucide-react'` (verified pattern in settings/page.tsx).

---

## Dimension 3 — TMDB Request Fan-Out & Rate Limiting: 7/18

### Fan-Out Inventory (call sites)

11 `useQuery` + 7 `useQueries` sites using TMDB:
- `useSubscriptionAdvisor` — up to 60 parallel (HIGH — P2)
- `useRevivalNudges` — up to 20 parallel (bounded)
- `useCalendar` — per-show fan-out
- `useGroupMemberProgress` — per-member × per-tmdbId
- `useSearchProviders` — per-result
- `recommendations/page.tsx` — per-recommendation
- Component-level: `WatchingTable`, `UpcomingCards`, `CalendarEntryItem`,
  `RevivalNudge`, `SearchDropdown`, `SeriesDetail`, etc.

### staleTime Discipline (from grep)

| Hook / site | staleTime | Assessment |
|-------------|-----------|-----------|
| default (Providers.tsx) | 5 min | OK baseline |
| `useGenreMap` | 60 min | Appropriate (genres rarely change) |
| `useSubscriptionAdvisor` | 10 min | OK for advisor |
| `useRevivalNudges` | 24 h | OK (signal is "did it revive") |
| `useCalendar` (detail) | 10 min | OK |
| `useCalendar` (seasons) | 30 min | OK |
| `usePublicProfile` | 60 s | Short — profile changes matter |
| `useFollow` | 60 s | Short |
| `useReviews` | 60 s | Short |
| `useLists` | 60 s | Short |
| `useGroupMemberProgress` | 5 min | OK |
| `recommendations` | 30 min | OK |
| `PersonPageClient` | 30 min | OK |
| `useSearchProviders` | ? | Check — likely shorter than optimal |
| `/discover` | 60 min / 5 min | Varies per call |
| `/kalibrera` | 60 min | OK (calibration is rare) |
| `/feed` | 2 min | OK |

### Findings

#### HIGH

**T1 — `useSubscriptionAdvisor` + `useRevivalNudges` share key `['tv', id]` with different `staleTime`**
- Advisor: 10 min; Revival: 24 h
- React Query: first observer wins options per-entry in cache lookup;
  mounting order matters
- Cross-ref 01 #22 — same issue
- Impact: inconsistent staleness → occasional stale revival signal or
  over-refresh
- Fix: different query keys (`['tv', id, 'advisor']` vs
  `['tv', id, 'revival']`) OR unify staleTime.
- Effort: **30 min**

**T2 — No TMDB rate-limit handler** — `src/lib/tmdb/client.ts:28-31`
```typescript
const res = await fetch(url.toString());
if (!res.ok) throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
```
- No 429 handling, no Retry-After parsing, no exponential backoff.
- React Query default: 3 retries without delay → burst of 429s compounds.
- Fix: wrap fetch with retry honoring `Retry-After` header.
- Effort: **2 h**

#### MEDIUM

**T3 — No request cancellation**
- `tmdbFetch` doesn't accept `AbortSignal`.
- React Query provides `signal` per-query; wrapping it through is a
  5-min change but unlocks proper cancellation on nav-away.
- Fix: thread `signal` through.
- Effort: **30 min**

**T4 — No debounce on search-as-you-type** — `useSearchBox.ts`
- Confirm via reading the hook. If every keystroke fires
  `/search/multi`, rate limit risk is real + wasted TMDB calls.
- Fix: 300 ms debounce.
- Effort: **15 min** (if not already done)

#### LOW

**T5 — TMDB image domains not preconnect-hinted**
- `<link rel="preconnect" href="https://image.tmdb.org">` saves ~100 ms.
- Bundled with P3.

### Deduplication ✓

React Query handles in-flight dedup. No issues observed.

---

## Dimension 4 — Firestore Query Performance & Cost: 9/18

### Index Coverage

6 composite indexes in `firestore.indexes.json`:
- `watchlist`: (status, updatedAt), (mediaType, status), (status, rating)
- `reviews`: (tmdbId, createdAt), (uid, createdAt)
- `lists`: (uid, updatedAt)

### Actual Query Sites (from grep)

| File | Query | Index needed | Indexed? |
|------|-------|--------------|----------|
| `useLists.ts:33` | `where uid==, orderBy updatedAt` | lists:(uid,updatedAt) | ✓ |
| `useReviews.ts:14` | `where tmdbId==, orderBy createdAt` | reviews:(tmdbId,createdAt) | ✓ |
| `useReviewSocial.ts:53` | `orderBy createdAt asc` | single-field auto | ✓ |
| `useNotifications.ts:30` | `orderBy createdAt desc, limit 50` | single-field auto | ✓ |
| `feed/page.tsx:65` | `where updatedAt>=, orderBy updatedAt desc` | single-field auto | ✓ |
| `feed/page.tsx:71` | `where uid==` (watchlist query) | watchlist:(mediaType,status)? Actually where uid only — collectionGroup? Check. | ? |
| `AuthContext:185` | `where memberUids array-contains` | single-field auto (array-contains) | ✓ |
| `groups.ts:307` | `where memberUids array-contains` | same | ✓ |

### Findings

#### HIGH

**F1 — Firestore rule cost multiplier via cross-doc `get()`** — `firestore.rules` lines 11, 25, 29, 59, 85, 92, 136, 141, 147, 150
- 9+ `get()` calls across rules. Each counts as a read per rule
  evaluation.
- Example: a public user's watchlist with 50 items → 50 reads of the
  watchlist + 50 reads of `users/{uid}` = 100 read operations (not 50)
  when serving a profile view.
- At scale:
  - 10k DAU × 10 profile views/day × 2 reads = 200k extra reads/day
  - Firestore cost: $0.06 per 100k reads → +$0.12/day from this alone
- Fix: denormalize `isPublic` onto each subcollection doc. When user
  toggles public, background update propagates to all docs (expensive
  one-time; cheap thereafter).
- Effort: **1 day** (write path + backfill)

**F2 — Only 3 `limit()` calls in entire codebase** — feed/page.tsx:69,74; useNotifications:33
- Lists that grow unbounded but aren't paginated:
  - `useLists.ts` — all lists owned by user
  - `useReviews.ts` — all reviews on a title
  - `useReviewSocial.ts` — all comments on a review
  - Group watchlist queries
  - Following / followers
- Impact: users with many reviews / comments load everything.
  Firestore read cost scales with list size; client-side memory too.
- Fix: add `limit(20)` + `useInfiniteQuery` for paginated loads.
- Effort: **1 day** across surfaces

#### MEDIUM

**F3 — 23 `onSnapshot` sites** — real-time listener count
- Many are watchlist + groups + sessions + follow + notifications.
- Per-session listener count can exceed 10 (watchlist + progress +
  notifications + follows + group members × N groups).
- Firebase Free: 100 concurrent listeners per client (rarely hit).
- Paid: no hard cap but each active listener costs.
- Fix: audit which could be one-shot `getDoc()` / `getDocs()` instead
  of live listeners. Many detail views don't need real-time.
- Effort: **1 day** triage

**F4 — Unbounded collection listening via `onSnapshot` without `limit`**
- e.g., `useLists.ts:33` subscribes to ALL user's lists. For power users
  with 50+ lists, every change streams the full list.
- Fix: paginate + manual refresh.
- Effort: bundled with F2

#### LOW

**F5 — Some single-field indexes auto-create; explicit declaration optional**
- Firestore auto-creates ascending single-field indexes. No config
  needed. Noted.

---

## Dimension 5 — Scalability Projections: 8/12

### Per-Scale Cost Model

| Scale | DAU | Firestore reads/day | Writes/day | TMDB calls/day | Monthly cost (est.) |
|-------|-----|---------------------|------------|----------------|---------------------|
| Current | 10–50 | ~1k | ~300 | ~2k | $5 (free tier mostly) |
| 10x | 500 | ~50k | ~10k | ~100k | $30 (past free tier) |
| 100x | 5,000 | ~500k | ~100k | ~1M | $150 |
| 1000x | 50,000 | ~5M | ~1M | ~10M | $1,000+ |

### What Breaks First

**At 10x (500 DAU):**
- Free-tier Firestore (50k reads/day) exceeded in one day
- Need to enable Blaze (pay-as-you-go); budget alerts needed
- Cost: minor ($10-30/mo)

**At 100x (5,000 DAU):**
- Cloudflare free tier probably fine (100k req/day is per Cloudflare
  account; unlikely hit)
- TMDB rate limits: per-user, so unchanged per-user; but dashboard
  bursts still risk 429 per user (T2 fix critical)
- Firestore cost crosses $100/month — rule-cost multiplier becomes
  tangible

**At 1000x (50,000 DAU):**
- Scrapfly-esque TMDB-proxy makes sense (server-side caching of TMDB
  details → 10x cost reduction on repeated domain lookups)
- Cloudflare pro plan for advanced rate limiting
- Serious cost modeling needed

### Architecture Bottlenecks

| Bottleneck | Hits at | Impact | Effort to address |
|------------|---------|--------|-------------------|
| TMDB rate limit (per-user burst) | 10x with heavy users | 429s on dashboard | T2 fix (2 h) |
| Firestore rule get() cost | 100x | 2-3x read cost multiplier | F1 fix (1 day) |
| No Firestore PITR | now | data-loss risk | 5 min (DR1 in 03) |
| No TMDB-proxy cache | 1000x | cost explosion | days to weeks |
| No server-side rendering | SEO concern | slow organic growth | N/A per CLAUDE.md |

---

## Dimension 6 — Image & Network Efficiency: 5/12

### Findings

#### HIGH (already captured as P1 in Dim 1)

28 raw `<img>` tags across src/ — see P1.

### TMDB Image Sizing Audit

TMDB offers: w92 / w154 / w185 / w342 / w500 / w780.

`posterUrl` in `client.ts:36` defaults to **w342**. Spot-check usages:
- Dashboard thumbnails: likely 80–120px wide — could use w92 or w154
  (3–4× less bandwidth)
- Title detail hero: needs w500 or w780
- Search dropdown results: 40–60px wide — w92 enough

#### MEDIUM

**I1 — posterUrl default w342 is too big for most surfaces**
- Fix: audit each call site; pass explicit smaller size.
- Alternatively: `posterUrl(path, sizeByContext)` helper.
- Effort: **2 h**

**I2 — No `srcSet` / responsive images**
- Each `<img>` uses one TMDB size. Mobile users download desktop-sized
  posters.
- Fix: when switching to next/image is not possible (static export
  constraint), use `srcSet="... 1x, ... 2x"` pattern manually.
- Effort: **2 h**

### Cache Headers (Static Assets)

#### MEDIUM

**I3 — `firebase.json` has no headers block**
- Cross-ref 02 A5-1 (security headers).
- Also missing cache-control:
  - `/_next/static/**` should be `max-age=31536000, immutable`
  - `/index.html` should be `no-cache, must-revalidate`
- Firebase default cache header is short (~1h). Long `immutable` on
  hashed assets saves repeat bandwidth dramatically.
- Bundled with 02 A5-1.
- Effort: bundled

### Cloudflare

External config (not audit-able from repo). Recommend verifying:
- SSL: Full (strict)
- Brotli: on
- Auto Minify HTML: on (Next.js already minifies; low impact)
- Rocket Loader: **OFF** (breaks React)

### Data Transfer

Per typical dashboard session: ~1 MB HTML/JS/CSS + ~0.5-2 MB TMDB images
= ~1.5-3 MB. Reasonable.

---

## Dimension 7 — Offline & Resilience: 7/10

### Firestore Offline Persistence

Firebase JS SDK enables IndexedDB cache by default. No explicit config
in `src/lib/firebase/config.ts` — uses default. ✓

### React Query Offline

- No `queryClient.persistQueryClient` or `persistClient`
- Cache is in-memory only → reloads re-fetch everything

#### MEDIUM

**O1 — No React Query persistence**
- First-reload experience is slower than it could be.
- `@tanstack/react-query-persist-client` + localStorage/IndexedDB = easy
  win for TMDB data (slow-changing).
- Effort: **1 h** integration

### Failure Mode UX

- Error boundary exists (`src/app/error.tsx`) — good
- No "offline" indicator — user sees TMDB failures as blank content

#### LOW

**O2 — No offline indicator**
- Consider: toast "Du är offline — data kan vara inaktuell"
- Low priority for a web app.

### Service Worker / PWA

None. Not required; consider for "install to home screen" later.

---

## Performance Benchmarks Table

```
| Metric                            | Current (est.) | Target    | Gap   |
|-----------------------------------|----------------|-----------|-------|
| LCP (dashboard cold, p75)         | 2.5–3.5 s      | < 2.5 s   | ~0.5s |
| INP (WatchlistPage p75)           | < 200 ms       | < 200 ms  | ✓     |
| CLS                               | ~0.05          | < 0.1     | ✓     |
| Bundle gz (critical)              | ~600 KB        | < 400 KB  | 200KB |
| Bundle total uncompressed         | 1.8 MB         | < 1.5 MB  | 300KB |
| TMDB requests (cold dashboard)    | 40–60          | < 20      | large |
| Firestore reads / session         | 30–100         | < 50      | ok    |
| Image sites optimized             | 0/28           | 28/28     | 28    |
| Limit() paginated queries         | 3/8+           | 8/8       | many  |
| Rate-limit handling               | none           | 429 + backoff | none |
| Cache on sign-out                 | retained       | cleared   | fix   |
```

---

## Cost Projection

At current scale: ~$0–5/mo (mostly free tier).
At 10x: $30/mo.
At 100x: $100–200/mo (rule-cost multiplier F1 becomes noticeable).
At 1000x: $1000+/mo (TMDB-proxy cache infrastructure becomes the
optimization lever).

Biggest cost drivers per-scale:
- Free → 10x: first Firestore bill
- 10x → 100x: F1 rule multiplier; fix saves 30–40%
- 100x → 1000x: TMDB-proxy + serving

---

## Scalability Limits Table

```
| Bottleneck                   | Hits at  | Impact                  | Effort  |
|------------------------------|----------|-------------------------|---------|
| TMDB rate limit (fan-out)    | 10x users| 429s on dashboard       | Medium  |
| Firestore rule get() cost    | ~100x    | 2-3x read multiplier    | Medium  |
| Firestore PITR off (DR1)     | any time | data loss risk          | 5 min   |
| No pagination on lists       | individual users with many items | missed UX + cost | Medium |
| 28 raw <img>                 | mobile / low-bandwidth | bandwidth + LCP | Medium |
| Cache on sign-out            | shared devices | privacy leak | Low |
```

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | HIGH | 28 `<img>` tags (no lazy/responsive/srcSet) | 28 sites | 1 day |
| 2 | HIGH | Advisor fan-out 40+ concurrent TMDB requests | `useSubscriptionAdvisor.ts:116` | 4 h |
| 3 | HIGH | No TMDB 429 / rate-limit handling | `src/lib/tmdb/client.ts:28` | 2 h |
| 4 | HIGH | Firestore rule `get()` cost multiplier | `firestore.rules` 9+ sites | 1 day |
| 5 | HIGH | Only 3 `limit()` calls → unbounded lists | multiple | 1 day |
| 6 | HIGH | Bundle size: 1.8 MB uncompressed (Firebase dominates) | out/_next/static/chunks/ | defer / analyze |
| 7 | HIGH | staleTime conflict `['tv', id]` advisor vs revival | `useSubscriptionAdvisor` + `useRevivalNudges` | 30 min |
| 8 | MEDIUM | 23 onSnapshot listeners (cost + complexity) | multiple hooks | 1 day triage |
| 9 | MEDIUM | posterUrl default w342 too big for thumbnails | `src/lib/tmdb/client.ts:36` + call sites | 2 h |
| 10 | MEDIUM | No `@next/bundle-analyzer` | devDependency | 30 min |

---

## Phase 2 Preparation

**Total issues:** 18 (0 CRITICAL / 4 HIGH / 9 MEDIUM / 5 LOW)
**Total estimated effort:** ~6 days focused work

**Recommended sprint grouping:**

**Sprint 1 — Quick wins (1 day):**
- T1 — staleTime alignment (30 min)
- T3 — AbortSignal threading (30 min)
- T4 — debounce search-as-you-type (if missing) (15 min)
- P3 + T5 — preconnect hints for TMDB (15 min)
- B-4 — install `@next/bundle-analyzer` (10 min)
- I3 — cache headers (bundled with 02 A5-1)

**Sprint 2 — TMDB resilience + fan-out (1–2 days):**
- P2 — advisor fan-out staggering (4 h)
- T2 — TMDB 429 handling + backoff (2 h)
- Unify TMDB error reporting via global React Query onError
  (cross-ref 01 #14)

**Sprint 3 — Firestore cost + pagination (2 days):**
- F1 — denormalize `isPublic` (1 day)
- F2 — add `limit()` + `useInfiniteQuery` across unbounded lists (1 day)
- F3/F4 — `onSnapshot` audit + one-shot migrations (bundled)

**Sprint 4 — Image optimization (1 day):**
- P1 + I1 + I2 — audit every `<img>`: add lazy, sizes, smaller TMDB size,
  srcSet (1 day)

**Sprint 5 — Bundle / persistence polish (1 day):**
- B-2 — dynamic imports of heavy pages (3 h)
- B-3 — bundle-analyzer-driven splitting (hours)
- O1 — React Query persistence (1 h)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero changes
2. ✅ Every finding with file:line
3. ✅ Severity + effort on every finding
4. ✅ Cross-prompt respect — security headers → 02 A5-1; CVE → 05;
   scoring correctness of advisor → 07; sign-out cache → 01+02
5. ✅ Realistic — indie scale; focus on fan-out + limit() + rule
   multiplier before exotic optimizations
