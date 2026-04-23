# Performance & Scalability Analysis

**Prompt 04 of 11 — Binge Analysis Series**

---

## Header

```
Analyst:        Claude (Opus 4.7)
Scope:          Web performance (Core Web Vitals), React Query cache strategy,
                bundle size, TMDB rate-limit & request fan-out, Firebase schema
                + queries + indexes, scalability projections for a web SPA.
Consolidates:   Performance, Scalability, Firebase data-layer analysis.
Cross-prompt:   Security rules → 02. Dependencies → 05. Monitoring SDKs → 03.
                TMDB client correctness → 07. CI/CD → 03.
```

**Mission:** Elite web performance and future-proof scaling. Sub-2.5s LCP (p75),
< 200ms INP (p75), minimal bundle size, cost-efficient TMDB and Firestore usage,
and an architecture that handles 100x–1000x user growth without rewrites.

---

## Two-Phase Approach

### Phase 1: Investigation Only (Your Current Task)

No code changes. No config edits. No optimizations. Your deliverable is a
comprehensive findings report with file:line references, metrics, and projections.

Do not:
- Edit any source files
- Modify Firestore indexes or rules
- Change any configurations or assets
- Suggest "let me fix this quickly"

### Phase 2: Smart Optimization Plan (After Phase 1)

Only after Phase 1 is 100% complete:
1. Analyze all findings holistically
2. Prioritize by user impact, cost savings, and effort
3. Group related optimizations to avoid conflicting changes
4. Sequence work to prevent regressions
5. Produce a phased roadmap (now / 10x / 100x / 1000x)

Investigation first. Planning second.

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), React 18, Tailwind
Rendering:           Client-side only SPA. No SSR. Static export disabled.
                     Build outputs server bundles that are served as static
                     via a /_/index.html catch-all rewrite (firebase.json).
Data layer:          React Query v5
                     Default staleTime: 5 min (per CLAUDE.md claim)
                     Advisor TV detail: staleTime 10 min
                     Revival nudges TV detail: staleTime 24 h
External API:        TMDB API v3 (client-side, ~40 req/10s IP limit)
Firebase services:   Firestore, Auth
                     NO Storage, NO Cloud Functions, NO FCM, NO Remote Config
Firestore indexes:   6 composite indexes (firestore.indexes.json, 53 lines):
                       - watchlist: (status ASC, updatedAt DESC)
                       - watchlist: (mediaType ASC, status ASC)
                       - watchlist: (status ASC, rating DESC)
                       - reviews:   (tmdbId ASC, createdAt DESC)
                       - reviews:   (uid ASC, createdAt DESC)
                       - lists:     (uid ASC, updatedAt DESC)
Firestore rules:     Extensive use of cross-doc get() for public-read checks
                     (each get() pays a read cost — see 02 for security; this
                     prompt owns the cost analysis)

Key collections (from firestore.rules):
  User-scoped:
    users/{uid}
    users/{uid}/watchlist/{tmdbId}
    users/{uid}/episodeProgress/{tmdbId}
    users/{uid}/notifications/{notifId}
    users/{uid}/following/{targetUid}
    users/{uid}/followers/{followerUid}
  Global:
    usernames/{username}        (1 doc per user)
    reviews/{reviewId}          (many per user, public)
      reviews/*/likes/{uid}
      reviews/*/comments/{cid}
    lists/{listId}              (optional public lists)
    sessions/{sessionId}         (Tillsammans watch-together)
      sessions/*/participants/{pid}
      sessions/*/swipes/{tmdbId}
    groups/{groupId}             (permanent groups)
      groups/*/members/{memberUid}
      groups/*/watchlist/{tmdbId}

Critical hot paths (high-fan-out):
  - Dashboard / homepage: WatchingTable, UpcomingCards, RevivalNudge,
    SubscriptionAdvisorWidget — each fetches multiple TMDB details
  - Advisor: useSubscriptionAdvisor fetches TV details for EVERY följer TV
    + vill_se TV item via useQueries (potentially dozens of concurrent fetches)
  - Revival nudges: useRevivalNudges fetches up to MAX_CHECKS = 20 watched-TV
    details (bounded)
  - Search results: TMDB /search/multi returns 20 results per page + each
    result may trigger follow-up watch/providers fetches on card render

Known user experience expectations:
  - "Prisjakt for media" — dense tables, lots of data per screen, fast
  - Browser tab usage model — users keep tabs open, don't tolerate heavy pages
  - Swedish audience — mostly desktop + mobile Chrome / Safari

Generated file exclusions:
  - .next/, node_modules/, out/, .firebase/
```

---

## Analysis Framework: 7 Dimensions (100 Points Total)

### Dimension 1: Core Web Vitals & Page Load (18 points)

**Target:** p75 LCP < 2.5s, p75 INP < 200ms, p75 CLS < 0.1. On mid-range mobile.

**1A. Largest Contentful Paint (LCP)**

Investigate:
- What is the LCP element on the dashboard page? Likely: the first poster
  image in WatchingTable or a hero widget.
- Are images lazy-loaded? Check for `<img loading="lazy">` or next/image
- Is next/image used at all? (CLAUDE.md: static export disabled; next/image
  may not work without a custom loader for static export.)
- Poster URLs: posterUrl returns `https://image.tmdb.org/t/p/w342/...`
  — are sizes chosen appropriately (w92 for thumbnails, w342 default)?
- Above-the-fold content blocking on TMDB fetches (render cost):
  is there skeleton UI while loading?
- Font loading: system-ui stack per CLAUDE.md — no webfonts = good, no FOUT/FOIT

Performance targets:
- LCP p75: < 2.5s
- TTFB: < 800ms (Firebase Hosting + Cloudflare handle this)

**1B. Interaction to Next Paint (INP)**

Investigate:
- Main-thread bottlenecks on interaction
- Long tasks (> 50ms) during list rendering
- WatchlistPage (614 lines) filter/sort — any visible lag with 200+ items?
- Large lists: virtualization via react-window / react-virtualized? (Currently
  expected: no — verify)
- Heavy synchronous work in event handlers
- React DevTools profiler "why did this render"

**1C. Cumulative Layout Shift (CLS)**

Investigate:
- Images without explicit dimensions (cause layout shift on load)
- Async-loaded content pushing below content (advisor widget popping in)
- Font loading shifts — mitigated by system-font stack
- Skeleton UI matching eventual layout dimensions

**1D. Time to Interactive (TTI) & Total Blocking Time (TBT)**

Investigate:
- JavaScript bundle parse+execute time (blocking)
- React Query hydration — but since no SSR, nothing to hydrate; client
  starts cold
- Third-party scripts (Cloudflare analytics? Firebase SDK? Google
  Analytics?) — each one is a main-thread hit

Output required:
- Estimated Core Web Vitals for dashboard, /search, /my/following, /savings
- Blocking operations with file:line references
- Lazy-loading opportunities
- Virtualization opportunities (WatchlistPage, search results)

---

### Dimension 2: Bundle Size & Code Splitting (12 points)

**Target:** Initial bundle < 200KB gzipped, aggressive code splitting per route.

Investigate:

1. **Total bundle size**
   ```
   Build and inspect `.next/static/chunks/`:
   - main-*.js size
   - framework-*.js size (React, React Query, Firebase SDK — each is large)
   - per-page bundle sizes
   ```

2. **Next.js automatic code splitting**
   ```
   Each page under src/app/ should generate its own chunk.
   Verify the chunk sizes via `next build` output table.
   Largest chunks likely:
   - /settings (493 lines, imports SWEDISH_PROVIDERS + COUNTRIES)
   - /savings (331 lines)
   - /grupper/[id] (908-line GroupPageClient)
   ```

3. **Firebase SDK size**
   ```
   firebase v12.11.0 is HEAVY. Modular imports mitigate:
   - firebase/app (always)
   - firebase/auth (auth pages)
   - firebase/firestore (everywhere watchlist/groups/etc.)

   Check src/lib/firebase/config.ts — only imports initializeApp, getAuth,
   getFirestore. Good — no accidental kitchen-sink import.

   But verify:
   - No `import firebase from 'firebase'` (old namespace import)
   - All imports from `firebase/<module>` not `firebase/compat/*`
   ```

4. **React Query size**
   ```
   @tanstack/react-query v5 is ~12-15 KB gzipped. Acceptable.
   Verify no devtools in production bundle:
   - @tanstack/react-query-devtools is NOT in dependencies (verify
     package.json) — if added, ensure dynamic import
   ```

5. **Lucide icons**
   ```
   lucide-react v1.6.0 — every icon imported individually:
     import { Search, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
   This is tree-shakable. Verify settings page and other heavy importers
   don't over-import.
   ```

6. **Tailwind CSS**
   ```
   Tailwind output depends on content scan. Verify:
   - tailwind.config.js content paths cover src/**/*
   - No safelist bloat
   - CSS size post-build: typically 10-30 KB gzipped for a mid-size app
   ```

7. **Dynamic imports**
   ```
   Search for:
   - React.lazy() usage
   - next/dynamic() usage
   Currently expected: minimal.
   Opportunity: heavy components like GroupPageClient, advisor widgets
   could be dynamically imported if they're not on the critical path.
   ```

Output required:
- Bundle size breakdown (per-route and overall)
- Largest dependencies by size
- Code-splitting opportunities with estimated size savings
- next/image vs raw <img> decision (static export constraint)

---

### Dimension 3: TMDB Request Fan-Out & Rate Limiting (18 points)

**Target:** Efficient TMDB usage, respect the ~40 req/10s/IP limit, minimal
waste.

This dimension is about the CLIENT-SIDE cost of TMDB calls. Correctness of
the TMDB client is owned by 07.

Investigate:

1. **Request fan-out on key pages**
   ```
   Count the TMDB requests triggered by opening each critical page cold:

   Dashboard (/):
     - WatchingTable: N items × ? TMDB calls (TV detail?)
     - UpcomingCards: typically another fetch
     - RevivalNudge (MAX_CHECKS = 20): up to 20 × getTVShow (staleTime 24h)
     - SubscriptionAdvisorWidget: uses useSubscriptionAdvisor
     - useSubscriptionAdvisor: tmdbIds = following-TV + vill_se-TV, each
       triggers getTVShow (staleTime 10 min)
     For a user with 20 following-TV + 5 vill_se-TV + 10 recently-watched-TV
     with cached status: up to ~45 parallel TMDB calls on dashboard load.
     This exceeds the 40 req/10s limit.

   /search/[query]:
     - /search/multi returns 20 results
     - Each result in search UI may trigger getWatchProviders (separate call)

   /tv/{id} and /movie/{id}:
     - 1 detail call (with append_to_response)
     - Recommendations from appended response (not separate call) ✓
     - Cast images: covered by appended credits

   /recommendations:
     - Depends on taste-vector pipeline + TMDB fan-out — investigate

   /savings:
     - Uses useSubscriptionAdvisor — same fan-out as dashboard

   /discover:
     - Single /discover/{movie|tv} call initially
     - Paginate?
   ```

2. **Rate limit handling**
   ```
   Current: NONE (client.ts:28 throws on !res.ok, no 429 handling,
   no Retry-After parsing, no client-side throttle).

   TMDB rate limit: 40 req / 10s per IP (may have been removed — TMDB's
   documented stance fluctuates; assume worst case for safety).

   Risk: dashboard load can exceed this. Users see 429s → error states.
   ```

3. **Request deduplication (React Query)**
   ```
   React Query automatically dedupes in-flight requests with the same key.
   Verify:
   - Advisor + revival nudges both use queryKey ['tv', id] — same key,
     deduped ✓
   - But they use different staleTime (10m vs 24h) — React Query uses
     the FIRST observer's options by default? Or merges? Verify behavior.
   ```

4. **Caching strategy**
   ```
   React Query default: staleTime 0, gcTime 5 min.
   Hooks specify:
     Advisor TV detail: staleTime 10 min
     Revival TV detail: staleTime 24 h
     useTMDB (main hook): verify
     useSearchProviders: verify

   For TMDB data, longer staleTime is usually fine (titles don't change
   often). Cost: cache memory. Worth it.

   Opportunity: bump useTMDB staleTime to 60 min for standard title
   details; keep 24 h for revival (which is explicitly "what changed?").
   ```

5. **Redundant TMDB calls**
   ```
   Search for:
   - Same title fetched in multiple contexts with different staleTime
     (cache fragmentation)
   - getMovie / getTVShow called separately when the detail is already
     cached (should be transparent with React Query, verify)
   - Watchlist items store cached metadata (title, posterPath, etc.) —
     is the cached version used, avoiding a refetch?
   ```

6. **Prefetching**
   ```
   Search for queryClient.prefetchQuery usage:
   - On hover/focus of a list item, prefetch the detail?
   - On route transition, prefetch the next page?
   Currently expected: minimal.
   ```

7. **Batch / debounce**
   ```
   Search inputs:
   - useSearchBox — is the query debounced (e.g., 300ms)?
   - Without debounce, every keystroke fires /search/multi
   ```

Output required:
- Request fan-out count per critical page
- Rate-limit risk assessment (which pages can exceed 40/10s)
- Cache strategy assessment + staleTime recommendations
- Deduplication verification
- Prefetching opportunities
- Debounce audit on search inputs

---

### Dimension 4: Firestore Query Performance & Cost (18 points)

**Target:** Efficient schema, all queries indexed, bounded reads, no N+1.

**Note:** Security rules are covered in 02. This dimension focuses on schema,
queries, and cost.

**4A. Collection & Document Structure**

Investigate:
- Document sizes: spot-check the largest expected docs
  - users/{uid} — profile + myProviders + providerCosts + providerPauses +
    notification settings. Likely < 100KB even for heavy users.
  - users/{uid}/watchlist/{tmdbId} — status + cached metadata + rating +
    notes + tvProgress. Per-item ~1–5KB. 1000 items → 5MB total (acceptable
    when paginated).
  - groups/{groupId} — memberUids array, defaults, inviteToken. Verify
    memberUids doesn't grow unbounded. Firestore array limit: 20K elements
    / 1MB doc. A group with 100 members is trivial.
- Unbounded growth risks:
  - reviews/{reviewId} — one per rating; scales per user × titles. OK
    (separate docs).
  - sessions/{sessionId}/swipes/{tmdbId} — one per swipe; bounded per
    session (users stop swiping).
  - users/{uid}/notifications — can grow unbounded. Is there a cleanup?
    Retention policy? (Cross-ref 03 DR for retention; here flag the
    scaling concern.)

**4B. Query Patterns & Indexing**

Cross-reference every Firestore query in the codebase against firestore.indexes.json:

Current indexes (from firestore.indexes.json):
```
watchlist: (status ASC, updatedAt DESC)
watchlist: (mediaType ASC, status ASC)
watchlist: (status ASC, rating DESC)
reviews:   (tmdbId ASC, createdAt DESC)
reviews:   (uid ASC, createdAt DESC)
lists:     (uid ASC, updatedAt DESC)
```

Verify queries in src/:
- WatchlistPage: what filters does it support? (status, mediaType, provider,
  genre?) — each filter combo needs an index or a client-side filter.
- Reviews page: query by tmdbId (for per-title reviews) and by uid (for
  my reviews) — both indexed ✓
- Lists page: query by uid — indexed ✓
- Notifications: likely order by createdAt DESC — single-field, auto-indexed
- Episode progress: per-item read by tmdbId (doc lookup, no query)
- Groups: query by uid? (groupId in user's memberships) — verify pattern

N+1 risks:
- Dashboard loading groups: for each group in user's list, fetch group doc
  + member docs + watchlist entries. Is this batched or sequential?
- Following list: fetch each followed user's profile for display? Or
  denormalize display name into the following doc?

Pagination:
- WatchlistPage: is there pagination, or load-all? With 1000 items this
  matters. Verify.
- Reviews: pagination via startAfter cursor?
- Infinite scroll via React Query useInfiniteQuery?

**4C. Hot Spots & Write Contention**

- Group watchlist: multiple members write simultaneously — last-write-wins
  OK for low-contention doc
- Session swipes: per-tmdbId doc, updated per swipe. Low contention.
- users/{uid}: single doc, single writer (owner). No contention.

**4D. Cost of Cross-Doc get() in Rules**

Firestore rules use get() 9+ times (see 02). Each get() is a billable read.
Estimate:
- Loading a public user's watchlist: 1 query (list) + 1 get() per read
  via the public-read path (rules line 11 uses get() per watchlist doc!).
  Actually: rules are evaluated PER-OPERATION, so if you read 50 watchlist
  items, 50 get()s fire on the user doc. Firestore DOES cache the result
  of a single rule evaluation, but across multiple reads in the same
  request it may or may not cache — verify current Firestore behavior.

This can be a real cost multiplier. Cross-ref 02 for rule structure;
own the cost analysis here.

**4E. Listener Usage**

- onSnapshot vs get(): real-time vs one-shot
- Count concurrent listeners per typical user session
- Each active listener = ongoing read charge when data changes

Search for `onSnapshot(` across src/:
- Tillsammans session live updates? (likely yes — swipes in real time)
- Group watchlist updates? (likely yes)
- User notifications? (verify)

Output required:
- Firestore collection map with document size estimates and growth model
- Query coverage check (every query × required index × present?)
- N+1 query problems with file:line
- Pagination gaps
- Cross-doc get() cost estimate
- Real-time listener inventory
- Cost projection at 1x / 10x / 100x / 1000x users

---

### Dimension 5: Scalability Projections (12 points)

**Target:** Architecture supports 10x–1000x user growth with predictable cost.

**5A. Growth capacity**

For each scale level, what breaks first?

**10x (say 1,000 users)**:
- TMDB rate limits per IP unchanged (per-user limit is lower anyway)
- Firestore: linear cost growth; no structural issues
- Cloudflare free tier: 100k req/day free — verify current scale

**100x (say 10,000 users)**:
- Firebase free tier (Spark) quota: 50k reads/day/project — quickly exceeded.
  Blaze plan required (PAYG).
- Firestore read cost: if rules-based get() multiplies reads by 3-5x,
  cost becomes a concern
- TMDB: no issue (rate limit is per-IP, users hit their own)
- Cloudflare: move to Pro ($20/mo) if needed for additional features

**1000x (say 100,000 users)**:
- Firestore costs start to matter ($0.06 per 100k reads)
- Firestore document limit (1 write/sec to same doc) — any hot docs?
- Firestore: Cloud Firestore scales well; no structural rewrite needed
- TMDB: consider a backend cache / proxy (Cloudflare Workers or Cloud
  Function) to reduce per-user TMDB calls
- Cloudflare Enterprise features become interesting

**5B. Firebase limits to watch**

- 1MB document size: verify no document approaches this (users, groups
  with memberUids arrays)
- 500 batch write limit: any batched writes approaching this?
- 1 write/sec per doc: users/{uid} has many fields updated on various flows
  — collision possible during heavy use
- Firestore composite index limit: 200 per database (currently 6 indexes,
  plenty of headroom)
- Cloud Functions execution limits: N/A (no functions)

**5C. Cost model**

Estimate per-user-per-day:
- Firestore reads: dashboard + 2-3 detail views + advisor re-run =
  maybe 50-100 reads/day/active user
- Firestore writes: watchlist changes + episode progress + notes =
  5-20 writes/day/active user
- Firebase Hosting egress: depends on bundle size (cross-ref Dim 2)
- TMDB: 100-200 requests/day/active user

At 10k DAU:
- 500k–1M Firestore reads/day → $0.30-0.60/day = $10-20/month
- 50k–200k Firestore writes/day → $0.90-3.60/day = $30-100/month
- Hosting egress: depends

Produce a specific cost projection table with the team's actual user
assumptions.

**5D. Architecture bottlenecks**

- Single Firebase project (cross-ref 03 SPOF)
- No TMDB proxy / cache (scale-sensitive)
- Client-side only rendering (no pre-render, no CDN-cached detail pages
  — every detail page is a fresh fetch from TMDB)

Future-proofing:
- Would adding a lightweight Cloud Function TMDB proxy save significant
  cost + give per-user rate limiting? Probably yes at 10x+.
- Would pre-rendering popular titles as static HTML (via periodic
  regeneration) improve SEO + reduce TMDB load? Yes, but requires
  infrastructure.

Output required:
- Scalability limits table at 10x / 100x / 1000x users
- Cost projection table (Firestore reads, writes, egress)
- Architecture bottlenecks with scale threshold
- Feature extensibility assessment

---

### Dimension 6: Image & Network Efficiency (12 points)

**Target:** Right-sized images, effective CDN caching, minimal waste.

**6A. TMDB image sizing**

Helpers in client.ts:
- posterUrl: default w342, options w92-w780
- stillUrl: default w300, options w185-w500
- backdropUrl: default w1280, options w300-w1280, original
- logoUrl: default w92
- profileUrl: default w185

Investigate:
- Are card thumbnails using w92 or w154 (NOT w342)?
- Are hero backdrops using w1280 or w780 (NOT original)?
- Grep for posterUrl() / backdropUrl() calls and the size passed:
  mismatches between display size and requested TMDB size = wasted bytes

**6B. Image loading strategy**

- next/image: works only with configured loaders; static export + TMDB
  URLs would need a custom loader. Currently likely raw <img>.
- loading="lazy" on below-the-fold images
- decoding="async" for non-critical images
- Modern formats: TMDB only serves JPEG/PNG (no WebP/AVIF via standard
  paths). Cloudflare Polish Pro can convert → Pro plan feature.

**6C. Cloudflare CDN**

Verify Cloudflare settings:
- SSL: Full (strict)
- Auto Minify: HTML/CSS/JS enabled?
- Brotli compression enabled?
- Cache Rules: appropriate TTLs for static assets (Next.js versioned
  assets should be cache-forever; HTML should revalidate)
- Page Rules / Cache Rules: any that might be too aggressive or too loose?

**6D. Hosting cache headers**

firebase.json has no headers block. Default hosting cache headers:
- Immutable assets (with hash in name): Firebase sets cache-control max-age=3600
  (1 hour) — too short for hashed assets, wastes CDN hits

Recommend:
- Add headers block for /_next/static/**: Cache-Control: max-age=31536000, immutable
- For /index.html: Cache-Control: no-cache, must-revalidate

**6E. Data transfer estimate**

Per session:
- Initial bundle: X KB (measure)
- Poster images on dashboard: 20 images × 20 KB (w342) = 400 KB
- TMDB detail views: 50-100 KB each
- Typical session: 2-5 MB total

Output required:
- Image size vs display size mismatch inventory
- Lazy-loading opportunities
- Cloudflare configuration review checklist
- Hosting cache-header recommendations
- Data transfer per session estimate

---

### Dimension 7: Offline & Resilience (10 points)

**Target:** Core features function when network is slow / offline; graceful
degradation on API failures.

**7A. Firestore offline persistence**

Firebase Firestore SDK enables offline persistence by default on web
(IndexedDB cache). Verify:
- No `disableNetwork()` calls
- No explicit `Persistence.NONE` setting
- Cache size limits (default is ~40MB, configurable)

**7B. React Query offline / cache**

- React Query persists nothing to disk by default — all cache is in memory
- On reload, every TMDB request fires again (unless user never reloads)

Recommendation (Phase 2): @tanstack/react-query-persist-client with
localStorage / IndexedDB backing. For TMDB data (slow-changing), this is
high-value.

**7C. What works offline now?**

Without explicit offline strategy:
- First visit offline: app doesn't load (no service worker)
- Subsequent visits offline: app shell may be cached by Cloudflare /
  browser; Firestore offline persistence shows cached user data; TMDB
  calls fail → empty states

Document the matrix:
- Sign in: offline → fails (Firebase Auth needs network)
- View watchlist: offline → works (Firestore cache)
- View title detail: offline → partial (cached TMDB data if previously
  fetched via React Query session; otherwise fails)
- Add to watchlist: offline → queues in Firestore offline write queue,
  syncs when back online ✓
- Advisor: offline → likely empty (depends on TMDB cache state)

**7D. TMDB failure modes**

When TMDB is down or slow:
- Pages show loading spinners indefinitely? (Verify timeouts — currently
  none in client.ts)
- Is there a retry policy? React Query defaults: 3 retries with exponential
  backoff
- Does the advisor show a "TMDB unavailable" message?
- Cross-ref 07 Dim 5 for deeper fallback analysis

**7E. Service Worker / PWA**

Currently: NONE.

For a "Prisjakt for media" app that users want to pin, PWA support
(install to home screen, offline shell) is a medium-value future feature.
Not a launch blocker.

Output required:
- Offline functionality matrix (feature × works offline × notes)
- React Query persistence recommendation
- TMDB failure mode UX assessment
- PWA readiness assessment

---

## Investigation Process

### Stage 1: Automated Profiling

```bash
npm run build                            # See per-page bundle sizes
npx @next/bundle-analyzer                # If installable

# Lighthouse / Chrome DevTools:
# - Performance tab: record dashboard load
# - Network tab: count TMDB + Firestore requests
# - Coverage tab: unused JS/CSS

# Firestore cost:
# - Firebase Console → Firestore → Usage
# - GCP Console → Logs Explorer for detailed breakdown

# Cloudflare: /cdn-cgi/trace, check headers on curl
```

### Stage 2: Deep Investigation

1. **Core Web Vitals** (1.5h): dashboard LCP audit, INP on WatchlistPage,
   CLS on advisor widget.
2. **Bundle Size** (1h): per-route, per-dependency, opportunities.
3. **TMDB Fan-Out** (1.5h): count requests per page, identify rate-limit
   risks.
4. **Firestore** (2h): query-index alignment, N+1 patterns, cost of
   rule get()s, listener inventory.
5. **Scalability Projection** (1h): 10x/100x/1000x, cost model.
6. **Image & Network** (0.5h): size audit, cache headers.
7. **Offline** (0.5h): persistence audit, failure modes.

### Stage 3: Report Compilation

Compile all findings with metrics and file:line references. Score each
dimension. Build performance + cost + scalability tables. Classify issues.

---

## Output Format

### Executive Summary

```
BINGE PERFORMANCE & SCALABILITY ANALYSIS — PHASE 1
====================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Firebase Project: binge-nu
Target platforms: Web (desktop + mobile)

OVERALL SCORE: X/100
  1. Core Web Vitals & Page Load:           X/18
  2. Bundle Size & Code Splitting:          X/12
  3. TMDB Request Fan-Out & Rate Limiting:  X/18
  4. Firestore Query Performance & Cost:    X/18
  5. Scalability Projections:               X/12
  6. Image & Network Efficiency:            X/12
  7. Offline & Resilience:                  X/10

STATUS: [Elite | Good | Needs Optimization | Critical Issues]

CRITICAL ISSUES: X found
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found
```

### Performance Benchmarks Table

```
| Metric                          | Current (est.) | Target    | Gap       |
|---------------------------------|----------------|-----------|-----------|
| LCP (p75, dashboard)            | X.Xs           | < 2.5s    | ± X.Xs    |
| INP (p75, WatchlistPage)        | XXms           | < 200ms   | ± XXms    |
| CLS (p75)                       | 0.XX           | < 0.1     | ± 0.XX    |
| Initial JS bundle (gzipped)     | XXX KB         | < 200KB   | ± XX KB   |
| TMDB requests (cold dashboard)  | XX             | < 10      | + XX      |
| Firestore reads (session)       | XXX            | < 50      | + XXX     |
| Data transfer (session)         | XXmb           | < 5MB     | ± XX mb   |
```

### Firestore Collection / Query Map

For each collection:
- Path, scope (user-scoped vs global)
- Fields with types
- Average doc size, expected count growth
- Queries hitting this collection + index status
- Issues (unbounded growth, missing index, rule-get() cost)

### TMDB Request Fan-Out Per Page

```
| Page            | Requests (cold) | Requests (warm) | Rate-limit risk |
|-----------------|-----------------|-----------------|-----------------|
| /               | XX              | X               | H/M/L           |
| /search         | XX              | X               | H/M/L           |
| /tv/{id}        | XX              | X               | H/M/L           |
| /savings        | XX              | X               | H/M/L           |
```

### Cost Projection

```
| Scale    | DAU     | Firestore reads/day | Est. monthly cost | Per-user/mo |
|----------|---------|---------------------|-------------------|-------------|
| Current  | X       | X,XXX               | $XX               | $X.XX       |
| 10x      | X0      | XX,XXX              | $XXX              | $X.XX       |
| 100x     | X00     | XXX,XXX             | $X,XXX            | $X.XX       |
| 1000x    | X,000   | X,XXX,XXX           | $XX,XXX           | $X.XX       |
```

### Scalability Limits Table

```
| Bottleneck                   | Hits at  | Impact                  | Effort  |
|------------------------------|----------|-------------------------|---------|
| TMDB rate limit (fan-out)    | Now      | 429s on dashboard       | Medium  |
| Firestore rule get() cost    | ~10x DAU | 3-5x read multiplier    | Medium  |
| No Firestore PITR            | Now      | Data loss risk          | Low     |
| ...                          | ...      | ...                     | ...     |
```

### Detailed Findings by Dimension

Standard format:
```
## DIMENSION NAME — Score: X/Y

### Summary
[2–3 sentence overview]

### Issues Found
#### CRITICAL
1. **[Title]** — [file:line]
   - Impact, Current, Best Practice, Scale Threshold, Effort

#### HIGH / MEDIUM / LOW
[Same format]

### Quick Wins
- [High impact, low effort items]
```

### Remediation Roadmap

Group findings into phases:
- **Immediate** (CRITICAL + quick wins)
- **Short-term** (HIGH, 10x readiness)
- **Medium-term** (MEDIUM, 100x readiness)
- **Long-term** (1000x architecture decisions)

---

## Binge-Specific Performance Checks

1. **Advisor fan-out bomb**
   - useSubscriptionAdvisor queries EVERY tracked TV show in parallel
   - 40-show following list = 40 concurrent TMDB requests on dashboard load
   - TMDB rate-limit risk: HIGH
   - Mitigation: batch or stagger, or cache tmdbStatus on Firestore item
     (already done via tmdbStatus field) and read from cache

2. **Static export re-enablement**
   - CLAUDE.md notes that `output: 'export'` is disabled due to dynamic
     routes
   - Re-enabling would unlock: true static hosting, better CDN behavior,
     smaller server-bundle-as-static waste
   - Effort: medium (needs catch-all pre-rendering strategy or route-specific
     exports)

3. **Firestore rule cost multiplier**
   - Public-read paths via get() multiply read cost 2-3x
   - For a public-profile view of a user with 50 watchlist items, reads
     could be 50 × 2 = 100 reads instead of 50
   - Mitigation: denormalize the isPublic flag onto each subcollection doc,
     or accept the cost

4. **WatchingTable rendering**
   - Dashboard table with many rows — virtualize or paginate?

5. **Cloudflare unknown config**
   - Investigate Cloudflare settings for: cache rules, Polish, Brotli,
     Minify, Rocket Loader (DO NOT enable — breaks React), WAF rules

---

## Phase 1 Completion Criteria

Investigation complete when:

1. All 7 dimensions scored and documented
2. Dashboard LCP/INP/CLS estimated
3. Bundle size breakdown produced (per route, per dependency)
4. TMDB request counts per page documented
5. All Firestore queries mapped to indexes (coverage verified)
6. Firestore cost projection at 4 scale levels
7. Scalability bottlenecks identified with scale thresholds
8. Offline capability matrix complete
9. Image / network efficiency audited
10. All issues classified by severity with effort estimates
11. Zero code changes made
12. Phase 2 roadmap structure prepared

**Phase 1 Output:** Comprehensive performance and scalability findings report.

---

## Begin Phase 1 Investigation

Execute comprehensive performance and scalability investigation. Profile
dashboard load, audit bundles, map TMDB and Firestore fan-out, project
costs at scale. Document every finding with file:line references and
metrics. Change nothing.
