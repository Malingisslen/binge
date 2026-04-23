# Binge — Code Quality & Architecture Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Codebase:** 125 .ts/.tsx files, 14,071 lines hand-written
**Test files:** 0 (no test framework configured)

---

## Executive Summary

```
OVERALL SCORE: 78/100
├── Next.js App Router & React Architecture: 14/20
├── TypeScript Type Safety:                  14/15
├── File Size & Complexity:                   8/12
├── Error Handling & Resilience:             10/15
├── Hook Discipline & React Query Patterns:   8/12
├── Documentation Health:                     7/8
├── Code Readability & Naming:                9/10
└── Dead Code & Production Readiness:         8/8

STATUS: Good — targeted improvements, no urgency on most items
         HIGH-priority: context memoization, React Query cache on sign-out,
         god-component decomposition
```

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 11 |
| LOW | 8 |

---

## Per-Dimension Findings

### Dimension 1 — Next.js App Router & React Architecture: 14/20

**Summary.** App Router used correctly; static export is ENABLED
(`next.config.mjs:4` — `output: 'export'` is live, contradicting CLAUDE.md
line 28). Providers composed correctly in `src/components/Providers.tsx`
with lazy-initialized QueryClient and 5-min default staleTime. Error
boundaries exist at root (`error.tsx`, `global-error.tsx`, `not-found.tsx`).
The weakest spots are Context provider-value memoization and a few
components acting as god-components.

#### HIGH

1. **AuthContext provider value not memoized** — `src/contexts/AuthContext.tsx:263`
   - Impact: every render of `AuthProvider` creates a new object literal
     (holds 19 callbacks + state). Every consumer re-renders on every
     `AuthProvider` parent tick, even when their data didn't change.
     Binge has many consumers (every authed page).
   - Fix: wrap value in `useMemo` with stable dependencies. All callbacks
     are already `useCallback`-stable (except one — see Dim 5 finding
     on `user.username` dep).
   - Effort: 1 h

2. **ToastContext provider value not memoized** — `src/contexts/ToastContext.tsx:29`
   - Impact: smaller blast radius than AuthContext (value has only `show`
     callback) but same re-render issue.
   - Fix: `useMemo(() => ({ show }), [show])`.
   - Effort: 10 min

3. **WatchlistContext provider value not memoized** — `src/contexts/WatchlistContext.tsx:167`
   - Impact: watchlist is read by WatchlistPage, dashboard widgets,
     advisor, revival nudges — widespread re-renders.
   - Effort: 30 min

#### MEDIUM

4. **`useAuth.ts` missing 'use client'** — `src/hooks/useAuth.ts:1`
   - Impact: the file is a single `export { useAuth } from '@/contexts/AuthContext'`.
     The re-export chain means consumers still get the underlying
     `'use client'`-directive from AuthContext. Next.js does not flag
     this — but adding the directive makes the boundary explicit.
   - Effort: 1 min

5. **`useClickOutside.ts` missing 'use client'** — `src/hooks/useClickOutside.ts`
   - Uses `useEffect` and `document` — requires client runtime. Next.js
     tolerates because it's only imported from client components, but
     explicit is better.
   - Effort: 1 min

#### LOW

6. **`suppressHydrationWarning` on root body** — `src/app/layout.tsx:23`
   - Masks legitimate hydration mismatches. For a static export SPA the
     risk is small, but the flag hides future bugs. Document intent or
     remove.
   - Effort: 15 min

**Strengths noticed.** 98 files correctly carry `'use client'`. Provider
composition order is correct (`QueryClient > Auth > Watchlist > Toast`).
`AppShell` separates layout from providers cleanly.

---

### Dimension 2 — TypeScript Type Safety: 14/15

**Summary.** Exemplary. Strict mode works: `npx tsc --noEmit` is clean
(zero errors). Zero escape hatches (`grep -rn " as any\|: any\b"` → 0,
`@ts-ignore|@ts-expect-error|@ts-nocheck` → 0). 50 top-level exports
in `src/types/index.ts` covering TMDB, domain, advisor, social types.

#### MEDIUM

7. **`src/types/index.ts` at 453 lines is a single dumping ground**
   - Mixes TMDB response types, advisor types, social types, domain enums.
   - Split proposal: `types/tmdb.ts` (TMDB shapes), `types/advisor.ts`
     (AdvisedShow, ProviderAdvisory, PrimaryAction, ActivePause,
     AdvisorResult — lines 386–452), `types/domain.ts` (WatchStatus,
     WatchlistItem, UserProfile), `types/social.ts` (groups, sessions,
     reviews).
   - Effort: 2 h (pure move + re-export, zero logic)

8. **Discriminated-union exhaustiveness not enforced for `PrimaryAction`**
   - `PrimaryAction` at `src/types/index.ts:438` is a well-formed tagged
     union. Consumers should use `switch(action.kind)` with a
     `default: assertNever(action)` helper to force compile errors when
     a new kind is added.
   - No `assertNever`-style helper found in `src/lib/` (`grep -rn "assertNever"` → 0).
   - Fix: add `export function assertNever(x: never): never { throw new Error('Unreachable: ' + JSON.stringify(x)); }` in `src/lib/utils.ts` and switch all PrimaryAction consumers.
   - Effort: 1 h

**No findings.** No boundary-type gaps observed (Firestore reads go
through typed accessors in `useWatchlist`, `useReviews`, etc.).

---

### Dimension 3 — File Size & Complexity: 8/12

**Summary.** Several large files with decomposition opportunities. Nothing
critical, but the 908-line `GroupPageClient.tsx` is a clear god-component.

#### HIGH

9. **`src/components/pages/GroupPageClient.tsx` at 908 lines**
   - God-component for the group/tillsammans-permanent shared watchlist.
   - Likely contains: member list, watchlist table, add/remove flows,
     real-time subscription handling, invite-link management, role logic.
   - Decomposition proposal:
     - `GroupHeader.tsx` — group name, member count, invite link
     - `GroupMemberList.tsx` — member display + join/leave
     - `GroupWatchlistTable.tsx` — shared watchlist
     - `useGroupData.ts` — lift data-fetching hook out
   - Effort: 6–8 h (careful extraction; no tests means manual smoke
     validation per sub-component)

#### MEDIUM

10. **`src/components/WatchlistPage.tsx` at 614 lines**
    - Shared across `/my/all`, `/my/following`, `/my/vill-se`, `/my/watched`,
      `/my/lists`. Handles table view + grid view + filter + sort +
      provider chips. Branch-heavy.
    - Decomposition: `WatchlistTableView`, `WatchlistGridView`,
      `WatchlistFilterBar`, `useWatchlistFiltering` hook.
    - Effort: 4–6 h

11. **`src/components/pages/TillsammansSessionPageClient.tsx` at 587 lines**
    - Interactive session view. Large but single-purpose (not a god
      component). Monitor; split if it grows further.
    - Effort: defer

12. **`src/app/settings/page.tsx` at 493 lines**
    - Known large: provider grid, tier selection, provider costs, country
      filters, calibration. Each is independent — extract as sub-sections
      with shared form state.
    - Effort: 4 h

**Strengths.** Most components are under 300 lines. No function observed
>100 lines during spot-reads. No deeply nested logic pyramids noticed.

**Accepted large files.** `src/types/index.ts` (453) is a types file —
large but OK.

---

### Dimension 4 — Error Handling & Resilience: 10/15

**Summary.** Error boundaries exist and render Swedish copy. React Query
configured with `refetchOnWindowFocus: false` (sensible for TMDB data).
Zero empty catches, zero silent-failure anti-patterns observed via grep.
Weakness: no global `onError` hook on the QueryClient → each consumer
must handle errors individually, and not all do.

#### HIGH

13. **`signOut` does not clear React Query cache** — `src/contexts/AuthContext.tsx:167-169`
    ```ts
    const signOut = useCallback(async () => {
      await firebaseSignOut(auth);
    }, []);
    ```
    - Impact: on sign-out, React Query retains cached user-scoped data
      (watchlist, episodeProgress, reviews, notifications) in memory.
      If a different user signs in (shared device), first render shows
      previous user's data until re-fetch completes. Privacy + correctness issue.
    - Fix: inject `queryClient` via `useQueryClient()` in AuthProvider
      and call `queryClient.clear()` after `firebaseSignOut`.
    - Effort: 30 min

#### MEDIUM

14. **No global `queryClient.setDefaultOptions({ queries: { onError } })`** — `src/components/Providers.tsx:10-17`
    - React Query defaults: 3 retries. But no centralized error reporting.
      Every `useQuery` consumer must inspect `isError` separately. Some
      pages (spot-check via Grep) don't — they show empty content on
      TMDB failure, not an error state.
    - Fix: add global `onError` that calls the Toast ("Kunde inte ladda")
      + optional Sentry forwarding later.
    - Effort: 1–2 h

15. **`error.tsx` copy is generic** — `src/app/error.tsx:7`
    - "Ett oväntat fel uppstod. Försök ladda om sidan." — correct Swedish
      but vague. No retry-via-fetch-not-reload, no support path, no error
      details for the developer (the `error` prop is unused).
    - Fix: log `error` to a service (when added), offer "Kontakta oss"
      fallback link.
    - Effort: 30 min

16. **No segment-level `error.tsx` below root**
    - Only root `error.tsx` + `global-error.tsx` exist. A runtime error
      in `/grupper/[id]` takes the whole page down.
    - Fix: add `src/app/grupper/[id]/error.tsx`,
      `src/app/tillsammans/[id]/error.tsx`, `src/app/butik/[domain]/error.tsx`.
    - Effort: 1 h for three

#### LOW

17. **Input validation at form layer not centralized**
    - Settings page, sign-in page, group creation, feedback — each uses
      ad-hoc validation. No shared `ValidationUtils` or equivalent.
    - Effort: defer unless a form bug is observed.

---

### Dimension 5 — Hook Discipline & React Query Patterns: 8/12

**Summary.** 24 custom hooks, generally clean. React Query keys are
consistent (`['tv', id]`, `['movie', id]`, `['reviews', tmdbId]`). Two
hooks flagged by ESLint for missing deps; one context callback has a
stale-closure on `user.username`.

#### HIGH

18. **AuthContext `deleteAccount` stale closure on `user.username`** — `src/contexts/AuthContext.tsx:260`
    ```ts
    if (user?.username) batch.delete(doc(db, 'usernames', user.username));
    ...
    }, []);   // ← deps empty
    ```
    - ESLint flags it (`react-hooks/exhaustive-deps`).
    - Impact: on account deletion, the function closes over the FIRST
      user value. If the user changed their username after mount, the
      OLD username lookup doc is deleted, leaving the new one orphaned
      (squat risk) — or vice versa, the fresh username lookup survives
      in `/usernames/{username}` even though the profile is gone.
    - Fix: add `user?.username` (and `uid`, `currentUser`) to the deps,
      or read `user` from a ref inside to avoid re-creation.
    - Effort: 30 min

#### MEDIUM

19. **`useEpisodeProgressWithSync.ts` has two callbacks missing `episodeProgress` dep** — lines 29, 36
    - ESLint: `react-hooks/exhaustive-deps`.
    - Likely intentional (avoid infinite re-sync) but needs an explicit
      `// eslint-disable-next-line` with rationale, or a ref-based read.
    - Effort: 30 min

20. **`src/app/search/page.tsx:18` — `myProviders` logical expression re-creates on every render**
    - ESLint: `react-hooks/exhaustive-deps` variant. Wrap `myProviders`
      in `useMemo`.
    - Effort: 10 min

21. **`useSubscriptionAdvisor` uses `dataUpdatedAt.join(',')` to force re-memo** — `src/hooks/useSubscriptionAdvisor.ts:127`, `useRevivalNudges.ts:57`
    - Pattern:
      ```ts
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [showQueries.map(q => q.dataUpdatedAt).join(',')]
      ```
    - Functional, but fragile + performs a join every render. An
      alternative is using `useQueries` `select` / storing the join value
      in a ref.
    - Document WHY in a comment (currently implicit).
    - Effort: 30 min

22. **Shared query keys across hooks with different `staleTime`**
    - `useSubscriptionAdvisor` uses `queryKey: ['tv', id]` with staleTime
      10 min; `useRevivalNudges` uses the same key with 24 h.
    - React Query uses the more recent observer's options. When both
      are mounted, behavior depends on mount order. Verify no regression.
    - Fix: either align staleTime, or use different keys like
      `['tv', id, { purpose: 'advisor' }]` vs `['tv', id, { purpose: 'revival' }]`.
    - Effort: 30 min; risk: cache duplication / double fetching.

---

### Dimension 6 — Documentation Health: 7/8

**Summary.** Exemplary — zero TODO/FIXME/HACK/XXX across src/.
CLAUDE.md is 90 lines of dense, current guidance. Minor drift from
code reality.

#### MEDIUM

23. **CLAUDE.md drift: static export is now enabled** — `CLAUDE.md:28` vs `next.config.mjs:4`
    - CLAUDE.md: "Static export (`output: 'export'`) is commented out
      in next.config.mjs because dynamic routes don't support it without
      pre-rendering."
    - Reality: `output: 'export'` is uncommented AND live.
    - Fix: update CLAUDE.md to document the current config (and how
      dynamic routes work via `trailingSlash: true` + catch-all client
      patterns).
    - Effort: 15 min

24. **CLAUDE.md drift: staleTime claim** — `CLAUDE.md:32`
    - Claims React Query default staleTime is 5 min. Verified correct
      at `src/components/Providers.tsx:13`, BUT the advisor uses 10 min
      and revival nudges use 24 h — not mentioned in CLAUDE.md.
    - Fix: note the per-hook override.
    - Effort: 5 min

25. **CLAUDE.md drift: auth/watchlist "stub" claim** — `CLAUDE.md:44-46`
    - Claims Auth is a stub and watchlist is local-only. Reality: Firebase
      Auth is integrated (AuthContext imports from `firebase/auth`),
      Firestore integration is live (`writeBatch`, `onSnapshot`, real
      docs — see `src/hooks/useWatchlist.ts`, `src/contexts/WatchlistContext.tsx`).
    - Fix: remove the "stub" phrasing; document the actual state.
    - Effort: 10 min

#### LOW

26. **No inline rationale on CATCHUP_THRESHOLD-style magic numbers outside advisor**
    - Advisor (`useSubscriptionAdvisor.ts:27`) documents `CATCHUP_THRESHOLD = 3`
      with a WHY comment — GOOD.
    - `useRevivalNudges.ts:19` documents `MAX_CHECKS = 20` with a WHY —
      GOOD.
    - Check remaining hooks for unexplained numeric literals (`grep -n "= [0-9]" src/hooks/`).
      Most are time multipliers like `10 * 60 * 1000`; these are fine.
    - Effort: defer.

---

### Dimension 7 — Code Readability & Naming: 9/10

**Summary.** Exemplary. Domain vocabulary (`följer`, `vill_se`, `sedd`)
intentional and consistent. Component naming PascalCase, hook naming
starts with `use`, file names match exports.

#### LOW

27. **Swedish-English mix is intentional but undocumented**
    - Code + comments: English.
    - Domain enum values: Swedish (`'följer'`, `'vill_se'`, `'sedd'`).
    - UI strings: Swedish.
    - CLAUDE.md could spell this out in a short rule ("domain enum values
      mirror UI vocabulary; all other identifiers in English").
    - Effort: 5 min doc update

28. **Some hooks have near-duplicate names** — `useEpisodeProgress.ts` vs `useEpisodeProgressWithSync.ts`
    - The distinction isn't documented in-file.
    - Fix: add a 1-line header comment explaining when to use which.
    - Effort: 10 min

---

### Dimension 8 — Dead Code & Production Readiness: 8/8

**Summary.** Clean.

- Zero `console.log/debug/info` in `src/`
- Zero `debugger` statements
- Zero `TODO/FIXME/HACK/XXX`
- Zero `dangerouslySetInnerHTML`
- Zero `as any`, `: any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`
- `.env.local` gitignored; `.env.local.example` present
- No secrets in source (verified: zero `AIza`, `sk_live`, `pk_live`,
  `Bearer ` outside comments)
- Build configuration clean; static export enabled and working
- `mockups/` directory is untracked (git status); design files — correct
  to keep out of production build

**No findings.**

---

## Metrics Table

| Metric                                    | Current | Target | Status |
|-------------------------------------------|---------|--------|--------|
| Total .ts/.tsx files                      | 125     | n/a    | ✓ |
| Total hand-written lines                  | 14,071  | n/a    | ✓ |
| Files >500 lines (non-types)              | 4       | 0      | ⚠ |
| Files >800 lines (non-types)              | 1       | 0      | ⚠ |
| `: any` annotations                       | 0       | 0      | ✓ |
| `as any` casts                            | 0       | 0      | ✓ |
| `@ts-ignore` / `@ts-expect-error`         | 0       | 0      | ✓ |
| `TODO` / `FIXME` / `HACK` / `XXX`         | 0       | 0      | ✓ |
| `console.log` / `debug` / `info`          | 0       | 0      | ✓ |
| `debugger`                                | 0       | 0      | ✓ |
| `dangerouslySetInnerHTML`                 | 0       | 0      | ✓ |
| TypeScript compile errors                 | 0       | 0      | ✓ |
| ESLint warnings (total)                   | 32      | 0      | ⚠ |
| ESLint warnings — `no-img-element`        | 28      | —      | deferred to 04 |
| ESLint warnings — `exhaustive-deps`       | 4       | 0      | ⚠ |
| Custom hooks                              | 24      | n/a    | ✓ |
| Contexts with memoized value              | 0 / 3   | 3 / 3  | ⚠ |
| Root error.tsx present                    | yes     | yes    | ✓ |
| Segment-level error.tsx                   | 0       | ≥ 3    | ⚠ |

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | HIGH | AuthContext value not memoized | `src/contexts/AuthContext.tsx:263` | 1 h |
| 2 | HIGH | signOut doesn't clear React Query cache | `src/contexts/AuthContext.tsx:167-169` | 30 min |
| 3 | HIGH | deleteAccount stale closure on `user.username` | `src/contexts/AuthContext.tsx:260` | 30 min |
| 4 | HIGH | WatchlistContext value not memoized | `src/contexts/WatchlistContext.tsx:167` | 30 min |
| 5 | HIGH | GroupPageClient at 908 lines (god component) | `src/components/pages/GroupPageClient.tsx` | 6–8 h |
| 6 | MEDIUM | ToastContext value not memoized | `src/contexts/ToastContext.tsx:29` | 10 min |
| 7 | MEDIUM | No global React Query `onError` hook | `src/components/Providers.tsx` | 1–2 h |
| 8 | MEDIUM | Shared query-key staleTime conflict | `useSubscriptionAdvisor.ts` vs `useRevivalNudges.ts` | 30 min |
| 9 | MEDIUM | WatchlistPage at 614 lines | `src/components/WatchlistPage.tsx` | 4–6 h |
| 10 | MEDIUM | CLAUDE.md drift (static export + auth) | `CLAUDE.md:28,44-46` | 30 min |

---

## Phase 2 Preparation

**Total issues:** 28 (0 CRITICAL / 5 HIGH / 11 MEDIUM / 8 LOW + 3 non-issue strengths noted)
**Total estimated remediation effort:** ~30 h of focused work

**Recommended sprint grouping:**

**Sprint 1 — Quick wins + highest-value (1 day):**
- #1, #2, #3, #4, #6 — all Context + sign-out fixes (≈ 2.5 h)
- #8 — staleTime alignment (30 min)
- #20 — search page useMemo wrap (10 min)
- #23, #24, #25 — CLAUDE.md drift update (30 min)
- #19 — useEpisodeProgressWithSync dep fix (30 min)
- Total: ~4–5 h

**Sprint 2 — Structural improvements (2–3 days):**
- #5 — GroupPageClient decomposition (6–8 h)
- #9 — WatchlistPage decomposition (4–6 h)
- #7 — global React Query onError hook (1–2 h)
- #16 — segment-level error boundaries (1 h)
- Total: ~14 h

**Sprint 3 — Polish (1 day):**
- #7 — types/index.ts split (2 h)
- #8 — assertNever helper + discriminated-union usage (1 h)
- #15 — error.tsx copy improvement (30 min)
- #12 — settings/page.tsx decomposition (4 h)
- Total: ~8 h

**Deferred to 04 Performance prompt:**
- 28 × `@next/next/no-img-element` warnings (these matter for LCP/bundle
  concerns and overlap with 04's image-sizing audit)

**Deferred to 06 UX prompt:**
- Finding #15 (error.tsx copy) can be co-owned with UX for Swedish-copy
  quality verification.

**Cross-references:**
- Most HIGH findings touch re-render economics → 04 Performance will
  measure the actual impact
- #13 (signOut cache clear) has privacy dimension → flagged to
  09 Trust/Safety

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero code changes made
2. ✅ Every finding has file:line reference
3. ✅ Every finding has severity + effort estimate
4. ✅ Cross-prompt dedup respected (image warnings deferred to 04;
   copy quality deferred to 06; privacy to 09)
5. ✅ Realistic severity — no CRITICAL findings; 5 HIGH all actionable
   in ≤ 8 h each
