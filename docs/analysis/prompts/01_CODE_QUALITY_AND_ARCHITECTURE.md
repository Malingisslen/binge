# Code Quality & Architecture Analysis

## Analyst

Claude (Opus 4.7) — comprehensive codebase analysis agent.

## Mission

Perform a forensic-level code quality investigation of the Binge Next.js codebase.
The goal is to achieve industry gold standard quality suitable for production
deployment with zero critical bugs, optimal maintainability, and professional-grade
code health.

This is not a superficial review. This is a deep investigation across 8 weighted
dimensions of code quality, totaling 100 points.

## TWO-PHASE APPROACH

### Phase 1: Investigation & Documentation (THIS PHASE)

**CRITICAL**: Document everything, change nothing.
- Investigate all aspects systematically
- Document findings with file:line references
- Classify issues by severity (Critical/High/Medium/Low)
- Provide effort estimates for each issue
- **ZERO code changes made**
- **ZERO files created or modified**
- Output: Complete findings report ready for Phase 2 planning

### Phase 2: Smart Remediation Planning (AFTER Phase 1 Complete)

- Review ALL Phase 1 findings together
- Prioritize by impact, effort, and dependencies
- Group related issues for efficient batch fixing
- Create optimized fix sequence to minimize breaking changes
- Generate sprint-structured remediation plan

**DO NOT START PHASE 2 UNTIL PHASE 1 IS COMPLETE**

**Cross-Prompt Boundaries**:
- Firestore rules / Storage rules: covered in `02_SECURITY_AND_COMPLIANCE.md` — skip here.
- Firestore schema / query / index: covered in `04_PERFORMANCE_AND_SCALABILITY.md` — skip here.
- Accessibility, design-rule compliance, i18n: covered in `06_UX_DESIGN_AND_I18N.md` — skip here.
- TMDB client correctness and advisor logic: covered in `07_TMDB_INTEGRATION_AND_RECOMMENDATION.md` — skip here.
- CI/CD pipeline design: covered in `03_INFRASTRUCTURE_AND_OPERATIONS.md` — skip here.
- Dependencies and licenses: covered in `05_DEPENDENCIES_AND_SUPPLY_CHAIN.md` — skip here.
- This prompt owns: React/Next.js pattern correctness, hook discipline, Context usage,
  file organization, TypeScript-type hygiene, error handling, documentation health,
  naming, magic values, dead code.

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), TypeScript strict, React 18, Tailwind
Data layer:          React Query v5 (staleTime 5 min default)
Rendering:           Client-side SPA. No SSR. Static export intended but currently
                     disabled in next.config.mjs (dynamic routes blocker).
Routing pattern:     `page.tsx` (server) → `*Client.tsx` (client) for dynamic routes
                     Example: src/app/[...path]/page.tsx → CatchAllClient.tsx
                     Pure client pages use 'use client' at the top of page.tsx
                     and import a shared page component.
Codebase size:       125 .ts/.tsx files in src/, ~14,064 lines
ESLint config:       .eslintrc.json extends ["next/core-web-vitals", "next/typescript"]
TypeScript:          strict: true (tsconfig.json)

Largest files (hand-written, non-generated):
  - src/components/pages/GroupPageClient.tsx          (908 lines)
  - src/components/WatchlistPage.tsx                  (614 lines)  ← shared /my/*
  - src/components/pages/TillsammansSessionPageClient.tsx (587 lines)
  - src/app/settings/page.tsx                         (493 lines)
  - src/types/index.ts                                (453 lines)
  - src/hooks/useSubscriptionAdvisor.ts               (393 lines)
  - src/app/savings/page.tsx                          (331 lines)
  - src/lib/firebase/groups.ts                        (317 lines)
  - src/components/pages/TVShowPageClient.tsx         (301 lines)
  - src/contexts/AuthContext.tsx                      (271 lines)
  - src/components/pages/MoviePageClient.tsx          (260 lines)

Key directories:
  - src/app/             Next.js App Router pages (~23 pages)
  - src/components/      layout/, search/, title/, tv/, calendar/, dashboard/,
                         pages/ (dynamic-route Client components), savings/,
                         social/, ui/
  - src/hooks/           24 custom hooks
  - src/contexts/        AuthContext (271 lines), ToastContext (47), WatchlistContext (177)
  - src/lib/             tmdb/, firebase/, taste/, together/, utils/, utils.ts,
                         airingState.ts, watchStatus.ts
  - src/types/index.ts   All shared TypeScript types (453 lines in one file)

Conventions:
  - 'use client' directive on all interactive pages and hooks that use React hooks
  - @/ path alias for src/ imports
  - React Query for ALL server state; useState/useReducer for UI state only
  - AuthGuard wrapper for protected pages (src/components/AuthGuard.tsx)
  - Shared WatchlistPage for all /my/* routes (table + grid views, filter, sort)

Known observations to verify:
  - 0 files contain TODO/FIXME/HACK/XXX (grep)
  - 0 `: any` type annotations (grep) — but verify `as any` casts
  - 58 files with 'use client' directive — verify correct placement
  - No test files present (no *.test.*, no *.spec.*)

Generated / ignored files (skip during analysis):
  - .next/
  - node_modules/
  - out/
  - .firebase/
```

---

## Investigation Framework: 8 Dimensions (100 Points Total)

### Dimension 1: Next.js App Router & React Architecture (20 points)

**Investigation Scope**: Does the codebase follow Next.js 14 App Router best practices,
correct server/client component boundaries, and coherent React architecture?

**Specific Investigation Tasks:**

1. **Server/Client Component Boundary Correctness**
   ```
   Binge is a client-side SPA — most pages are 'use client'.
   But server/client boundaries still matter for bundle size and future SSR.

   Check:
   - Every file that uses React hooks or browser APIs has 'use client' at top
   - No unnecessary 'use client' directives on pure presentation or types-only files
   - Dynamic route pattern: page.tsx (server wrapper) → *Client.tsx
     (e.g., src/app/[...path]/page.tsx → CatchAllClient.tsx)
     Verify this pattern is used for ALL dynamic routes, not inconsistent.
   - Static pages like src/app/films/page.tsx are pure client ('use client' + import)
     — verify this is intentional and not a missed SSR opportunity.

   Search:
   - grep -L "'use client'" for every .tsx in src/app/
   - Hook files (src/hooks/*.ts) — hooks with React internals need 'use client'
     when imported in the app directory (useAuth.ts currently has no directive —
     verify this doesn't cause bundler warnings)
   ```
   - Document inconsistencies with file:line
   - Flag missing 'use client' directives causing build warnings as HIGH
   - Flag superfluous 'use client' as LOW

2. **App Router Layout & Loading Conventions**
   ```
   Check src/app/layout.tsx and any nested layouts:
   - Providers (AuthProvider, ToastProvider, WatchlistProvider, QueryClientProvider)
     wrapped in root layout?
   - error.tsx, global-error.tsx, not-found.tsx presence (verified: all three exist
     at root level)
   - Any loading.tsx files? (Expected: none or a few for heavy pages)
   - Nested layouts for /my/, /grupper/, /tillsammans/?
   ```
   - Document layout tree
   - Flag missing error boundaries on critical routes

3. **Page Pattern Consistency**
   ```
   Three observed patterns:
     A. Pure 'use client' page: imports a shared component
        (src/app/films/page.tsx → MediaTypePage mediaType="movie")
     B. 'use client' page with inline content wrapped in AuthGuard
        (src/app/settings/page.tsx — AuthGuard → SettingsContent())
     C. Server page + *Client.tsx split for dynamic routes
        (src/app/[...path]/page.tsx → CatchAllClient.tsx)

   Check:
   - Are these patterns applied consistently per page category?
   - Any dynamic routes using pattern A/B instead of C? (would block future SSR)
   - AuthGuard placement: on page.tsx (preferred) or inside Client components?
     Verify single consistent placement.
   ```
   - Document page-pattern matrix
   - Flag inconsistencies as MEDIUM

4. **Context vs. Prop-Drilling Discipline**
   ```
   Three contexts in src/contexts/:
     AuthContext (271 lines)   — user auth state, profile, myProviders, etc.
     ToastContext (47 lines)   — global toast notifications
     WatchlistContext (177)    — client-side watchlist mirror

   Check:
   - Are contexts consumed via custom hooks (useAuth, useToast, useWatchlist)
     rather than raw useContext? YES — verify every consumer uses the hook.
   - Is context value memoized? (Unstable values trigger rerenders in all consumers)
     Look for useMemo on the provider's value prop.
   - Is AuthContext doing too much? 271 lines suggests it holds profile, providers,
     costs, pauses, notification settings — consider split vs. single-source-of-truth
     trade-off.
   ```
   - Flag unmemoized provider values as HIGH (perf impact)
   - Flag context overload as MEDIUM (splitting effort)

5. **Shared Page Component Pattern**
   ```
   WatchlistPage.tsx (614 lines) is shared across /my/all, /my/following,
   /my/want-to-watch, /my/watched, /my/lists.

   Check:
   - Is it parameterized cleanly (single filter/title prop) or does it branch
     on `status === 'följer' ? ... : status === 'vill_se' ? ...` internally?
   - 614 lines in one component — can it be decomposed into
     WatchlistPageTable, WatchlistPageGrid, WatchlistPageFilters?
   - Does MediaTypePage have similar structure for films/ and series/?
   ```
   - Flag large components as MEDIUM decomposition opportunity

6. **Hook Count & Organization**
   ```
   24 hooks in src/hooks/. Naming:
     useAuth, useWatchlist, useEpisodeProgress, useEpisodeProgressWithSync,
     useTMDB, useSubscriptionAdvisor, useRevivalNudges, useAdvisorTimeline,
     useCalendar, useGenreMap, useNotifications, useReviews, useReviewSocial,
     usePublicProfile, useFollow, useLists, useMySessions, useGroups,
     useGroupMemberProgress, useSession, useSessionTasteVectors,
     useTasteVector, useClickOutside, useSearchBox, useSearchProviders

   Check:
   - Is there duplication? (useEpisodeProgress vs useEpisodeProgressWithSync
     — why two? Document the distinction)
   - Is useTMDB.ts (114 lines) a wrapper around the TMDB client, or a
     kitchen-sink that should be split?
   - useWatchlist.ts is only 4 lines — presumably just a context re-export.
     Verify that's intentional and not a dead shim.
   - Any hooks that belong in src/lib/ as pure functions (no React state)?
   ```
   - Document hook-dependency graph (which hooks call which)
   - Flag overlap and dead shims

7. **types/index.ts Sprawl**
   ```
   453 lines of types in a single file. Includes:
     - TMDB response types
     - Advisor types (AdvisedShow, ProviderAdvisory, PrimaryAction, etc.)
     - Domain types (WatchStatus, WatchlistItem, etc.)
     - Social types (follows, sessions, groups)

   Check:
   - Is grouping logical, or a dumping ground?
   - Would splitting into src/types/tmdb.ts, advisor.ts, domain.ts, social.ts
     improve discoverability?
   - Any duplicate/near-duplicate types?
   ```

**Output Required:**
- Server/client boundary violations list with file:line
- Page-pattern matrix (page × pattern × correctness)
- Context memoization audit
- Shared-component decomposition opportunities
- Hook dependency graph + duplication list
- types/index.ts reorganization proposal

---

### Dimension 2: TypeScript Type Safety (15 points)

**Investigation Scope**: Strict-mode effective coverage, `any` escapes, unchecked
casts, narrowing discipline.

**Specific Investigation Tasks:**

1. **Strict Mode Effectiveness**
   ```
   tsconfig.json has strict: true. Verify:
   - Run `npx tsc --noEmit` — zero errors expected
   - Verify strict-family flags are NOT individually disabled
     (noImplicitAny, strictNullChecks, strictFunctionTypes, etc.)
   ```

2. **`any` Escapes**
   ```
   Current known state: 0 `: any\b` annotations (grep count).

   Check additional escape hatches:
   - `as any` casts — grep
   - `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` — grep
   - Functions returning unknown without type guards before consumption
   - React Query `useQuery<any>` or untyped queryFn
   - TMDB response typing: are all endpoints typed correctly in client.ts?
     (Verified types imported from @/types — cross-check that every endpoint
     has a precise return type, not a loose object shape)
   ```
   - Flag every escape with file:line and severity

3. **Discriminated Union Discipline**
   ```
   PrimaryAction is a discriminated union (types/index.ts:438):
     type PrimaryAction =
       | { kind: 'idle', nextCheckDate: string | null }
       | ...

   Check:
   - Is exhaustive switching used everywhere PrimaryAction is consumed?
     Look for switch(action.kind) with a default: assertNever(action)
     or similar exhaustiveness check.
   - Same check for WatchStatus usage (only 3 values but still matters).
   ```

4. **React Component Prop Typing**
   ```
   Check every component:
   - Does it have an explicit Props interface/type?
   - Are optional props marked with ?
   - Is children typed as React.ReactNode (not React.ReactElement) where appropriate?
   - Are event handlers typed correctly? (React.MouseEvent<HTMLButtonElement> etc.)
   - Any components using implicit prop spread that loses type info?
   ```

5. **Firestore Payload Typing**
   ```
   Firestore returns DocumentData which is effectively `any` without casting.

   Check src/lib/firebase/*.ts and WatchlistContext:
   - Are snapshots converted through typed functions
     (e.g., fromFirestore factories)?
   - Are optional fields defensively handled (?? defaults)?
   - Are Timestamps converted to Date consistently?
   ```

6. **Utility Type Usage**
   ```
   Check src/lib/utils.ts and src/lib/utils/ for:
   - Generic type helpers (Partial, Pick, Omit, etc.)
   - Custom mapped types
   - Return type inference vs explicit annotation discipline
   ```

**Output Required:**
- Strict-mode compliance report
- `any` / cast / ts-ignore inventory
- Exhaustive-switching audit on discriminated unions
- Component prop-type completeness matrix
- Firestore typing assessment

---

### Dimension 3: File Size & Complexity (12 points)

**Investigation Scope**: File size limits, function length, nesting depth,
cyclomatic complexity.

**Target Standard:** 500 lines per file maximum. Decompose larger files unless
intentionally large with documented rationale.

**Specific Investigation Tasks:**

1. **Critical Violations (>800 lines)**
   ```
   KNOWN files over 500 lines:
     - GroupPageClient.tsx                   (908 lines)  ← over 800
     - WatchlistPage.tsx                     (614 lines)
     - TillsammansSessionPageClient.tsx      (587 lines)
     - settings/page.tsx                     (493 lines)  (just under)
     - types/index.ts                        (453 lines)  (types are OK longer)
     - useSubscriptionAdvisor.ts             (393 lines)
     - savings/page.tsx                      (331 lines)
     - firebase/groups.ts                    (317 lines)
     - TVShowPageClient.tsx                  (301 lines)

   For each >500-line file:
   - What multiple responsibilities does it hold?
   - Is there a natural split boundary (subcomponents, sub-hooks, sub-services)?
   - Propose a decomposition with effort estimate.
   ```

2. **Function / Component Length**
   ```
   Search for:
   - Functions exceeding 80 lines (flag as complexity smell)
   - React components with JSX returns exceeding 100 lines (extract subcomponents)
   - Render functions with deeply nested ternaries (>3 levels) — replace with
     early returns or small helper components
   - Long useEffect bodies — extract helpers
   ```

3. **Nesting & Cyclomatic Complexity**
   ```
   Search for:
   - Indentation depth >5 levels
   - Long if/else chains that should be a lookup table or polymorphic
   - Nested useMemo/useCallback combos that hint at state-management drift

   Tool: Prettier + ESLint complexity rule (not currently enabled — consider)
   ```

4. **Shared Component Boundaries**
   ```
   WatchlistPage, MediaTypePage, and the pages/*PageClient components are
   shared across multiple routes.

   Check:
   - Are the shared components truly general, or do they accumulate route-specific
     branches that should live at the call site?
   - Is there a way to extract hooks (e.g., useWatchlistFilter,
     useWatchlistSort) from WatchlistPage to shrink the component?
   ```

**Output Required:**
- Files >500 lines with refactoring priority
- Top 20 longest functions/components with simplification strategies
- Decomposition proposals for GroupPageClient and WatchlistPage
- Effort estimates for each refactoring item

---

### Dimension 4: Error Handling & Resilience (15 points)

**Investigation Scope**: Error handling completeness, React Query error paths,
user-facing error messages, graceful degradation.

**Specific Investigation Tasks:**

1. **React Query Error Handling**
   ```
   React Query default behavior: retry 3 times, then mark isError.

   Check:
   - Is there a global QueryClient onError hook? (look in src/components/Providers.tsx)
   - Is retry behavior customized per query? (e.g., don't retry 404s)
   - Does every useQuery consumer handle { error, isError } states?
     (Otherwise: silent failures, user sees empty state instead of "Kunde inte ladda")
   - Are mutations wrapped with onError toast callbacks? (cross-check ToastContext)
   ```

2. **fetch() Error Boundaries**
   ```
   TMDB client throws on !res.ok. Firebase SDK throws FirebaseError on failure.

   Check:
   - Is there a top-level ErrorBoundary in app/error.tsx / global-error.tsx?
   - Does it display a Swedish error message, not a stack trace?
   - Does it report to any observability service?
     (Sentry / Firebase Crashlytics — currently expected: no. Flag.)
   ```

3. **User-Facing Error Messages**
   ```
   CLAUDE.md: UI is Swedish. Error messages matter.

   Audit every user-visible error string:
   - Are they in Swedish?
   - Are they actionable ("Försök igen" / "Kontrollera internetuppkopplingen")
     vs vague ("Ett fel inträffade")?
   - Are they consistent in tone (formal vs casual)?
   - Do they expose technical jargon (stack traces, Firestore error codes)?
   ```

4. **Empty States vs. Error States**
   ```
   Check every list/page:
   - Does "no data" render a meaningful empty state (e.g., "Inga titlar än —
     lägg till din första i söket")?
   - Does "data fetch failed" render a different visual from "no data"?
     (Users need to distinguish.)
   - Does "loading" state shimmer/skeleton match the eventual layout?
   ```

5. **Silent Failures**
   ```
   Search for:
   - empty catch { } blocks
   - catch (e) { console.error(e) } with no user feedback
   - .catch(() => null) without recovery
   - Ignored promise rejections (missing await)
   ```

6. **Form / Input Validation**
   ```
   Check forms:
   - Settings page (493 lines) — provider selection, tier selection, costs
   - Login page — auth flow
   - Group creation / Tillsammans session creation
   - Review creation / notes editing

   Verify:
   - Min/max bounds on numeric inputs (e.g., provider cost < 9999 SEK)
   - Empty-string handling
   - Paste handling (especially for numeric fields)
   - Submit-while-loading prevention
   ```

**Output Required:**
- React Query error-handling coverage table
- Error boundary assessment
- Swedish error message quality audit
- Empty/error/loading state completeness matrix per page
- Silent-failure inventory
- Input validation coverage per form

---

### Dimension 5: Hook Discipline & React Query Patterns (12 points)

**Investigation Scope**: Correct useEffect / useMemo / useCallback discipline,
React Query query key hygiene, dependency array correctness.

**Specific Investigation Tasks:**

1. **React Query Key Hygiene**
   ```
   Inspect every useQuery / useQueries / useMutation:
   - Keys should be stable arrays with discriminating parts
     (['tv', id] vs ['tv', id, { withProviders: true }])
   - Observed pattern: queryKey: ['tv', id] in useSubscriptionAdvisor
     and useRevivalNudges — SAME key. This is good (shared cache) but only
     if the queryFn is identical and staleTime compatible.
     Current: advisor uses 10 min staleTime, revival uses 24 h.
     When both are mounted, which wins? React Query uses the most recent
     observer's options — verify no bug from this.
   - No keys built from Date.now() or Math.random() (unstable)
   - Invalidation patterns via queryClient.invalidateQueries match the keys
   ```
   - Document every queryKey and flag collisions or instability

2. **useEffect Dependency Arrays**
   ```
   Check every useEffect:
   - All referenced variables in deps?
   - No object/array literals in deps (cause re-runs every render)
   - Cleanup functions for subscriptions / event listeners?
   - No "effect as event handler" anti-pattern (setTimeout in effect
     without cleanup)
   ```

3. **useMemo / useCallback Necessity**
   ```
   Check every useMemo / useCallback:
   - Is there a real reason (expensive computation OR stable reference for
     a dependency)? Or is it cargo-culted?
   - Dependency arrays correct?
   - Specific watch: useSubscriptionAdvisor has a hack
     // eslint-disable-next-line react-hooks/exhaustive-deps
     [showQueries.map(q => q.dataUpdatedAt).join(',')]
     Verify this pattern is correct (forces re-memo when data refreshes)
     and documented. Same pattern in useRevivalNudges.
   ```

4. **Hooks Returning Unstable References**
   ```
   Custom hooks like useWatchlist, useAdvisorTimeline should return stable
   references when inputs haven't changed.

   Check:
   - Does useWatchlist return a fresh object literal every render?
     (Would cause downstream useEffect to re-run unnecessarily)
   - Are callback-returning hooks using useCallback internally?
   ```

5. **Stale Closure Risks**
   ```
   Any hook that captures a value in a callback without deps risks stale
   closure. Common culprits:
   - setTimeout / setInterval inside useEffect without the target ref
   - Event handlers registered once but reading latest state
   ```

**Output Required:**
- React Query key inventory with collision / instability audit
- useEffect dependency correctness per hook
- useMemo/useCallback justification matrix
- Hook return-stability assessment
- Stale closure inventory

---

### Dimension 6: Documentation Health (8 points)

**Investigation Scope**: Code comment quality, commented-out code, TODO/FIXME audit,
markdown file health.

**Binge Comment Standards:**
- Comments explain WHY, not WHAT
- Swedish allowed for user-facing strings and in-comment Swedish-specific notes
  (the codebase already mixes: domain Swedish like "Följer", "Vill se"; code
  comments in English; rare Swedish explanations for domain nuance)
- No decorative section dividers

**Specific Investigation Tasks:**

1. **Comment Quality Audit**
   ```
   Search for:

   Obvious/redundant comments (noise):
   - // Set state
   - // Return component
   - /** @returns the value */

   Section dividers (forbidden):
   - // ===== SECTION =====
   - // ---- Helper Methods ----

   Complex logic WITHOUT explanation (missing WHY):
   - Dense algorithms without intent comments
   - Magic numbers without context
   - The getDisplayTitle regex in client.ts:152 — IS documented briefly, verify
     the reasoning is clear
   - CATCHUP_THRESHOLD = 3 in useSubscriptionAdvisor is documented (line 27) —
     use as a positive example
   ```

2. **Commented-Out Code**
   ```
   Search for:
   - Blocks of 5+ consecutive commented code lines
   - Commented-out JSX (particularly common during UI iteration)
   - Old console.log / debug statements
   - Commented imports
   - next.config.mjs has a commented-out `output: 'export'` — verify that
     the comment explains WHY (it does, per CLAUDE.md; cross-check)
   ```

3. **TODO/FIXME Audit**
   ```
   Current known state: 0 TODO/FIXME/HACK/XXX in src/ (grep).

   Verify no false negatives (e.g., "@todo", "TBD", "FIX").
   Also check:
   - docs/tillsammans-roadmap.md content
   - Commented aspirations in CLAUDE.md that might be TODOs
   ```

4. **CLAUDE.md Accuracy**
   ```
   CLAUDE.md (90 lines) is the single source of truth for guidelines.

   Verify each claim against current code:
   - "React Query (staleTime 5 min)" — verified in some hooks, BUT advisor
     uses 10 min and revival uses 24 h. Is the 5 min claim a default that's
     overridden, or stale documentation?
   - "Auth: stub (demo user, no Firebase)" — Firebase Auth is partially
     integrated now. Update needed?
   - "Watchlist/EpisodeProgress: local in-memory state" — Firestore migration
     in progress. Update needed?
   - "Static export (output: 'export') is commented out because dynamic
     routes don't support it" — verify current state of next.config.mjs
   ```

5. **Markdown File Health**
   ```
   docs/ contains: tillsammans-roadmap.md
   mockups/ directory untracked in recent git status

   For every .md file:
   - Is it still relevant?
   - Do any file paths mentioned still exist?
   - Any success reports / implementation plans that can be deleted?
   ```

**Output Required:**
- Comment quality score with violation counts
- Commented-out code inventory
- TODO/FIXME complete inventory
- CLAUDE.md accuracy audit with update recommendations
- Markdown file health report

---

### Dimension 7: Code Readability & Naming (10 points)

**Investigation Scope**: Naming conventions, code smells, magic numbers/strings,
lint rule compliance.

**Specific Investigation Tasks:**

1. **Naming Conventions**
   ```
   Check for:
   - Single-letter variables outside loop iterators (i, j, k OK; x, t, f not)
   - Abbreviated names: tmdb (OK, standard), prov, adv, rec (suspicious)
   - Misleading names: functions that do more than the name suggests
   - Inconsistent naming for same concept
     Domain vocabulary: "följer" vs "following" vs "watching" — pick ONE
     WatchStatus has 'följer' as the value; English identifiers should use
     "following" consistently.

   File naming:
   - All .tsx components in PascalCase? YES (spot-check)
   - Hook files start with "use"? YES
   - Utility files camelCase? (airingState.ts, watchStatus.ts — yes)
   - Consistency between default export name and filename
   ```

2. **Swedish-English Mixing in Code**
   ```
   Binge has intentional Swedish domain terms:
     WatchStatus = 'följer' | 'vill_se' | 'sedd'
     STATUS_LABELS, providers.ts (comments in Swedish), etc.

   Check:
   - Is the choice documented? (Partially in CLAUDE.md, "UI in Swedish")
   - Are function names in English except domain enums?
     Example good: useSubscriptionAdvisor (English), status: 'följer' (domain)
     Example bad: följerToggleButton (mixed) — search for such
   - Are Swedish comments reserved for Swedish-market-specific rationale
     (like the providers.ts aliases comment)? Or sprinkled randomly?
   ```

3. **Code Smells**
   ```
   Detect:
   - Long parameter lists (>4 params without an options object)
   - God components (e.g., GroupPageClient at 908 lines — likely a god component)
   - Feature envy (component repeatedly accessing another's internals)
   - Primitive obsession (Date strings passed as strings everywhere vs a
     BrandedDate type)
   - Data clumps (title + posterPath + releaseYear appearing together
     repeatedly → should be a type)
   ```

4. **Magic Numbers & Strings**
   ```
   Search for:
   - Numeric literals in business logic (CATCHUP_THRESHOLD = 3 is a GOOD
     example — named constant. Look for unnamed equivalents)
   - String literals for status/type values hardcoded in JSX vs from the
     type union
   - Hardcoded durations (staleTime: 10 * 60 * 1000 — acceptable but could
     be MS_PER_MINUTE * 10)
   - Hardcoded colors in JSX (CLAUDE.md allows #d97b35, #1e2028, etc. as
     tokens — are they centralized or sprinkled?)
   - Hardcoded Firestore collection paths (should be constants)
   ```

5. **Lint Rule Compliance**
   ```
   Run: npm run lint
   Document every warning and error.
   Suggest:
   - Adding complexity / max-depth rules
   - Adding no-console rule (with allowlist for warn/error)
   - Enabling react-hooks/exhaustive-deps (probably already on via next/core-web-vitals)
   ```

**Output Required:**
- Naming violation inventory
- Swedish-English mixing guidelines + violations
- Code smell catalog
- Magic value extraction opportunities
- Lint compliance report

---

### Dimension 8: Dead Code, Debug Artifacts & Production Readiness (8 points)

**Investigation Scope**: Unused code, debug leftovers, commented experiments,
production-readiness hygiene.

**Specific Investigation Tasks:**

1. **Dead Code Detection**
   ```
   Search for:
   - Unused exports (export function / type never imported)
   - Unused imports (ESLint should catch)
   - Unused hook parameters
   - Unreachable code after return / throw
   - Feature flags always true or always false
   - Dead routes (pages never linked to from the nav or other pages)

   Tools:
   - ts-prune (dev dep) for unused exports
   - knip for broader dead-code detection
   - `npm run lint` for unused imports
   ```

2. **Debug Artifacts**
   ```
   Search for:
   - console.log / console.debug / console.info in production code
     (console.error for errors is defensible)
   - debugger statements
   - Alert/prompt/confirm calls (should use custom modals)
   - Hardcoded 'http://localhost' or dev-only URLs
   - if (process.env.NODE_ENV === 'development') { ... } blocks
     — verify they're gated correctly
   ```

3. **Environment Variable Access**
   ```
   Verify all env var access goes through process.env.NEXT_PUBLIC_*
   for client-side, and standard process.env.* for server (there are no
   server functions yet in binge).

   Check:
   - No env vars hardcoded as fallback defaults that would mask missing config
   - TMDB_API_READ_ACCESS_TOKEN in CLAUDE.md is declared "Cloud Functions only"
     — verify it's never used client-side
   - Firebase config uses NEXT_PUBLIC_FIREBASE_* — all loaded at build time,
     confirm .env.local.example lists all required vars
   ```

4. **Production Safety**
   ```
   Check:
   - Build warnings (run npm run build, inspect output)
   - Missing error.tsx at nested routes that may need them
   - Any direct access to document/window without SSR guards (not a problem
     for full SPA but check consistency with Next.js 14 conventions)
   - Service worker / PWA manifest: not present — is that intentional?
   - robots.txt / sitemap.xml presence: both in /public — verify they're
     current and don't disallow the app
   ```

5. **Git / Workspace Hygiene**
   ```
   Current git status shows:
   - M src/contexts/AuthContext.tsx (uncommitted)
   - M src/hooks/usePublicProfile.ts (uncommitted)
   - ?? mockups/ (untracked directory)

   Check:
   - Should mockups/ be .gitignored or committed?
   - Any .env files tracked by accident?
   - .gitignore completeness (next, out, node_modules, .firebase all ignored?)
   ```

**Output Required:**
- Dead code inventory (unused exports, imports, params)
- Debug artifact list (console, debugger, alert)
- Env var access audit
- Build warning inventory
- Git/workspace hygiene report

---

## Investigation Execution Plan

### Stage 1: Automated Analysis

```bash
npm run lint
npx tsc --noEmit

# Dead code
npx ts-prune          # if installed; otherwise note absence
npx knip              # if installed

# File metrics
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -40

# Known pattern searches
grep -rn "'use client'" src/ --include="*.tsx" | wc -l
grep -rn " as any\|: any\b" src/
grep -rn "@ts-ignore\|@ts-expect-error\|@ts-nocheck" src/
grep -rn "TODO\|FIXME\|HACK\|XXX" src/
grep -rn "console\.\(log\|debug\|info\)" src/
grep -rn "debugger" src/
grep -rn "Math.random\|Date.now()" src/     # in queryKeys?
```

### Stage 2: Deep Manual Review

Work through all 8 dimensions systematically (see Output Required per dimension).

### Stage 3: Report Compilation

Compile all findings into structured report with severity classification,
effort estimates, metrics dashboard, and Phase 2 preparation.

---

## Output Format

### Executive Summary

```
BINGE CODE QUALITY & ARCHITECTURE ANALYSIS — PHASE 1 FINDINGS
================================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Codebase: 125 .ts/.tsx files, ~14,064 lines hand-written

OVERALL SCORE: X/100
├── Next.js App Router & React Architecture:  X/20 points
├── TypeScript Type Safety:                    X/15 points
├── File Size & Complexity:                    X/12 points
├── Error Handling & Resilience:               X/15 points
├── Hook Discipline & React Query Patterns:    X/12 points
├── Documentation Health:                      X/8 points
├── Code Readability & Naming:                 X/10 points
└── Dead Code & Production Readiness:          X/8 points

STATUS: [Production Ready | Needs Work | Critical Issues Found]

CRITICAL ISSUES: X found
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found
```

### Per-Dimension Report Format

For each dimension, provide: summary (2–3 sentences), issues grouped by
CRITICAL/HIGH/MEDIUM/LOW with file:line references, impact description,
required fix, and effort estimate. Include recommendations and quick wins.

### Metrics Table

```
| Metric                                | Current | Target   | Gap |
|---------------------------------------|---------|----------|-----|
| Files >500 lines (non-types)          | X       | 0        | ... |
| Files >800 lines (non-types)          | X       | 0        | ... |
| `any` annotations                     | X       | 0        | ... |
| @ts-ignore / @ts-expect-error         | X       | 0        | ... |
| TODO / FIXME comments                 | X       | 0        | ... |
| console.log / debug in production     | X       | 0        | ... |
| Custom hooks                          | 24      | n/a      | ... |
| Components with inline 'use client'   | X       | correct  | ... |
| ESLint warnings                       | X       | 0        | ... |
| TypeScript errors                     | X       | 0        | ... |
```

### Top 10 Issues Quick Reference

List the 10 highest-priority issues with severity tag, title, file count or
location, effort estimate, and impact category.

### Phase 2 Preparation

Total issue counts by severity, estimated total remediation effort, next steps
for Phase 2 smart planning.

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score (out of 100)
- [ ] Detailed findings for all 8 dimensions with file:line references
- [ ] Issue classification (Critical/High/Medium/Low) with counts and effort estimates
- [ ] Metrics comparison table (current vs target)
- [ ] Top 10 issues quick reference
- [ ] Server/client boundary audit
- [ ] Context memoization audit
- [ ] File decomposition proposals for the 3 largest non-types files
- [ ] TypeScript escape-hatch inventory
- [ ] React Query key inventory
- [ ] CLAUDE.md accuracy update recommendations
- [ ] Phase 2 preparation section with issue grouping

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX** — this is investigation only.
2. **NEXT.JS 14 APP ROUTER IS NEW** — apply its conventions, don't force Pages
   Router patterns.
3. **BINGE IS CLIENT-SIDE ONLY** — don't flag lack of SSR as a problem; flag
   patterns that BLOCK enabling SSR/static-export when the team is ready.
4. **RESPECT DOMAIN VOCABULARY** — "följer", "vill_se", "sedd" are intentional
   Swedish values. Don't recommend renaming them.
5. **CROSS-REFERENCE DEDUP** — TMDB logic is owned by 07, design by 06,
   security by 02. Note "Deferred to prompt NN" when applicable.
6. **ZERO CODE CHANGES** — investigation and documentation only.
7. **REALISTIC** — pre-launch indie SPA. Severity should reflect actual
   launch-blocking impact, not theoretical perfection.
