# Archived knowledge — relocated from binge-code-reviewer.knowledge.md.
Append-only historical record. Entries are verbatim, original order.


## Relocated 2026-07-04 — consolidation batch (2026-06-14 → 2026-06-26; lessons distilled into the active file's principles; 6 thread-linked entries kept raw)

### 2026-06-14 — prefetchQuery accepts staleTime; per-title prefetch data never persisted
`queryClient.prefetchQuery` takes a `FetchQueryOptions` object that includes `staleTime`. Passing
it there makes prefetch respect the same freshness window as the consuming `useQuery`, so the cache
hit is guaranteed when the user navigates. Confirmed that per-title keys (`'tv'`, `'movie'`) are
not in `PERSISTED_QUERY_PREFIXES`, so prefetch data never bloats localStorage — this is the correct
invariant and should be preserved.

### 2026-06-14 — useEffect cleanup returning a memoized cancel callback is valid
`useEffect(() => cancel, [cancel])` — where `cancel` is a `useCallback` — is idiomatic for
clearing a `useRef`-backed timer on unmount. The returned function IS the cleanup; no wrapping
lambda needed. This pattern is leak-free for hover-intent timers.

### 2026-06-14 — Invalid-id early-return in generateMetadata must also be noindex
In `/movie/[id]`, `/tv/[id]`, `/person/[id]` the guard `if (!Number.isFinite(id)) return {}`
falls through to the root layout's `robots: { index: true }` + `alternates: { canonical: '/' }`.
Non-numeric ids are never in `generateStaticParams` so they land in the catch-all SPA shell —
but if Next ever renders the static-export shell for them, `return {}` is an indexable
homepage-duplicate. The correct fix is the same pattern as the TMDB-fail catch:
`return { robots: { index: false, follow: false }, alternates: { canonical: <self-url> } }`.
(Title is moot since the page body will call `notFound()` anyway.)

### 2026-06-14 — Dead exported helpers (not yet consumed) are acceptable in prefetch modules
`currentSeasonToPrefetch` and `seasonPrefetchSpec` are exported from `prefetch.ts` but have no
call-sites yet. They are infrastructure for a planned follow-up (season prefetch on TV detail page).
Flag as untested but do not block — they carry no risk until wired up.

### 2026-06-14 — Synchronous-ref pattern for concurrent-blur races in AuthContext
When multiple UI controls can blur in rapid succession (e.g. tabbing through cost inputs),
the fix is: keep a `useRef` mirror of the field, update the ref SYNCHRONOUSLY before the
`await updateUserField(...)` call, and read from the ref in the next blur. A `useEffect`
syncs the ref back when the profile loads from Firestore. Key invariant to verify: does
`updateUserField` call `setUser(prev => ...)` AFTER the await? Yes — so the useEffect
re-sync fires only after the round-trip, and in-flight edits to the ref are never clobbered
mid-flight. Watch for sibling writes that bypass the ref (e.g. `updateProviderTier` also
writes `providerCosts` directly via setDoc + setUser — the ref will be stale if called
concurrently, but that race is benign because tier-set is not triggered by blur).

### 2026-06-14 — danger-soft border on danger-soft background is invisible
When migrating `border-red-200 bg-red-50` to danger tokens, `border-red-200` is a mid-tone
separator (visibly darker than red-50). The correct danger mapping is `border-danger bg-danger-soft`
— NOT `border-danger-soft bg-danger-soft`, which renders the border invisible (same oklch value
for both). Always use `border-danger` when you need a visible outline against a `bg-danger-soft`
panel. `border-danger-soft` is only appropriate when the container itself is NOT `bg-danger-soft`
(e.g. a very subtle hover ring on a white card).

### 2026-06-14 — Delegated document-level listeners: pointer-to-whitespace gap is benign with pointerover
When a document-level `pointerover` listener drives hover-intent, moving the pointer from an anchor
to empty whitespace fires `pointerover` on the nearest DOM ancestor (often `body` or the page root),
which is not an `<a>` element, so `titlePathOf` returns null and `clearTimer()` is called. This
covers the vast majority of "leaving a link" cases without needing a separate `pointerleave` listener.
The one genuinely uncovered edge case is moving the pointer OUTSIDE the browser viewport — there is no
`pointerover` event at the document boundary, so the timer can fire after the pointer has left the
window. In practice the prefetch fires ~150 ms later into an already-settled cache; it is benign
(the semaphore caps concurrency, `staleTime` deduplicates, no Firestore is touched). Do not flag this
as a blocker — the old per-card hook had the same gap (pointerleave does not fire when you ALT-TAB
either). Only flag if the architecture changes to a long-lived timer (> 1 s).

### 2026-06-14 — Exhaustion-report useEffect before early return null is safe; bounce-back is not a risk
The pattern in RecRow: `useContext` + `useEffect(() => report(...), [tappedOut])` placed ABOVE
`if (!isLoading && items.length === 0) return null` is rules-of-hooks correct — all hooks run
unconditionally, the early return is a render gate only. The "no bounce-back" comment in the code
is accurate: there is no cleanup function in the effect, so unmount does NOT call `report(key, false)`.
The hub's `reportExhaustion` callback is stable (`useCallback([], [])`), so the effect never re-fires
spuriously from a stale callback reference.

### 2026-06-14 — "show more rows" pagination counter uses filteredRows.length (not orderedRows), correct
In RecommendationsHub the "visa fler rader" button guard is `visibleRowCount < filteredRows.length`
(not `orderedRows.length`). This is intentional and correct: exhausted demotion reorders but does not
remove rows; `orderedRows.length === filteredRows.length` always, so either would work. Using
`filteredRows` is fine — just note this invariant if refactoring.

### 2026-06-14 — VISIBLE_CAP/POOL_TARGET in row hooks do not match ROW_VISIBLE in RecRow (known, not a bug)
`useRowLatestFav` and `useRowSimilar` use `VISIBLE_CAP=20` / `POOL_TARGET=100` as hook-level caps,
while `RecRow` displays `ROW_VISIBLE=6` at a time via `rotatePool`. The hook's VISIBLE_CAP/POOL_TARGET
cap the hook's `RowResult.visible/backingPool` split — RecRow then merges both and rotates over the
full merged pool. The exhaustion logic in RecRow uses `merged.length` (visible + backingPool), so
rotation window count and exhaustion threshold are derived from the actual post-composeSimilarPool
pool size (max ~20 after depth+vote-floor gating), not from the 100-item POOL_TARGET. No off-by-one.

### 2026-06-14 — composeSimilarPool applies vote floor INSIDE the depth cap, not after
In `composeSimilarPool`, `recs.slice(0, recDepth)` takes the first 10, THEN `passesFloor` filters
them. This means the effective pool can be smaller than `recDepth` if the top-10 has low-vote titles.
This is intentional (kills junk at any rank), but note: a title at rank 5 with 25 votes is dropped
even though a title at rank 6 with 500 votes was never examined (it was already excluded by the depth
cap). The depth cap is the primary signal quality gate; the floor is secondary hygiene only for /similar
catalog-dump junk. This is the intended behavior per the code comment.

### 2026-06-14 — ProviderAdvisory status union is exactly {active|upcoming|free|pause}; !='free' = all paid
The status-assignment block in useSubscriptionAdvisor.ts:220-225 is an exhaustive if/else-if/else chain
with no default catch-all that could introduce an unknown value: active → upcoming → free → pause (else).
So `p.status !== 'free'` reliably captures the full paid set (active + upcoming + pause). Confirmed when
reviewing BIN-17 (findCatchupCandidate broadening). Also confirmed: DiagnosisCard's catchup copy
("Inget kan pausas just nu") is still accurate even when the candidate has status 'pause' in the advisor
model, because 'pause' means "nothing airing" (suitable for pausing) while the catchup nudge fires BECAUSE
the user has unfinished backlog — the two concepts are orthogonal and the copy correctly describes the
recommended sequence (catch up, then pause).

### 2026-06-15 — Budget counter pre-increment before await is correct in single-threaded Node.js
In buildFetch.ts the `networkFetches++` happens BEFORE `await fetcher(...)`. This looks like it could
race (two concurrent calls both pass the `>= budget` check before either increments), but Node.js is
single-threaded: between `fetchForBuild` calls the event loop yields only at `await` points. Since
the guard + increment are synchronous (no await between them), the counter is always accurate even
when Next processes many pages that call `fetchForBuild` concurrently in the same worker. The
per-worker (not global-across-workers) scope is intentional and documented — N workers → N×budget
fetches total, but wall-clock is bounded by a single worker's budget, which is the actual guarantee.

### 2026-06-15 — RUNBOOK.md operational notes can reference removed env vars; update when reviewing infra changes
When a build-pipeline env var is replaced (e.g. TMDB_CACHE_BUST → TMDB_BUILD_REFRESH_BUDGET),
docs/RUNBOOK.md incident playbooks that mention the old var become stale. The stale text is
non-breaking (the var simply has no effect if set), but the runbook entry will mislead an on-call
operator. Flag as an advisory (not a blocker) and suggest a follow-up update to the relevant
runbook section.

### 2026-06-18 — Firestore documentId() range + orderBy on same field: no composite index
`where(FieldPath.documentId(), '<=', x).orderBy(FieldPath.documentId(), 'desc')` is a single-field
query on the document ID — Firestore does not require a composite index when the WHERE field and the
orderBy field are the same (including the special documentId() path). Confirmed: no index required.

### 2026-06-18 — 'daily' doc sorts AFTER all YYYY-MM-DD date strings lexicographically
In the `insights` collection, the live rollup doc has id `'daily'`. Because `'d'` (0x64) > `'2'`
(0x32), `'daily' > '2099-12-31'` in lexicographic order. This means:
- A `where(docId() <= dateString)` query naturally excludes `'daily'` — no extra filter needed.
- The asc fallback `orderBy(docId(), 'asc').limit(1)` returns the earliest date doc when any exist,
  or `'daily'` when it is the ONLY document. The `if (doc.id === 'daily') return null` guard handles
  that sole case correctly.
- Both query paths together cover all states of the collection.

### 2026-06-18 — Math.max(0, NaN) === NaN; use formatScalar's isFinite guard, not Math.max, for NaN dash
`Math.max(0, NaN)` returns `NaN`, not `0`. The resolvers intentionally exploit this: when `window`
is null, `d.window?.deltas.users ?? NaN` evaluates to `NaN`, and `Math.max(0, NaN)` propagates NaN
through to `formatScalar`, which renders `'–'` via `!Number.isFinite(value)`. This is the correct
two-part contract: `Math.max` only clamps genuine negative numbers (e.g. -2 → 0); NaN passes through
as the "no data" sentinel. Do not "fix" this by changing `?? NaN` to `?? 0` — that would suppress
the dash and show `0` when there is genuinely no window data yet.

### 2026-06-18 — Insikter window read cost: 1 read steady-state, 2 reads cold-start
`readBaseline()` costs 1 Firestore read in steady state (primary query finds a dated snapshot) and
2 reads during the brief cold-start period before any dated snapshot exists (primary returns empty →
fallback asc query). The design budget of "~1 extra read per request" is accurate for steady state.
Flag as advisory (not blocker) if documentation says exactly 1 but the implementation can be 2.

### 2026-06-20 — collectionGroup + orderBy('__name__') + select(field) needs a composite index
`db.collectionGroup(kind).select('followedAt').orderBy('__name__').limit(N)` mixes a non-__name__
projection field (`followedAt`) with an `orderBy('__name__')`. In Firestore Admin SDK the `select()`
call does NOT affect the index requirement — what matters is whether the ORDER BY and WHERE fields
can be served by a single-field index. `orderBy('__name__')` alone on a collection (non-group) needs
no composite index. On a COLLECTION GROUP, however, Firestore requires a collection-group-scoped
index on `__name__` (or the special `FieldPath.documentId()`) for cross-collection ordering — this
index is auto-created by Firestore for every collection group, so in practice it does not require a
manual entry in `firestore.indexes.json`. The `select('followedAt')` projection is purely a bandwidth
optimization on reads; it does not introduce a composite-index requirement because `followedAt` is
not in any WHERE or ORDER clause. Confirmed: the query is safe to issue without adding an explicit
index entry. However, if a future version adds `orderBy('followedAt')` alongside `orderBy('__name__')`
that WOULD require a composite index — add it to `firestore.indexes.json` at that point.

### 2026-06-20 — recursiveDelete in serial loop is correct but can timeout at scale
`db.recursiveDelete(ref)` must be called serially (one await per session) because it internally
walks subcollections via repeated RPCs, and Firestore Admin does not expose a concurrency-safe
parallel form. This means a function with timeoutSeconds=300 could time out if there are many
expired sessions (e.g., 500+ sessions × ~500ms each = >4 minutes). At Binge's current scale this
is acceptable; flag as advisory if the sessions collection grows significantly. The fix would be
to fan-out via Cloud Tasks (one task per session ref) rather than looping in a single invocation.

### 2026-06-20 — collectionGroup query scope is forward-compatible only if collection name is unique
A `db.collectionGroup('notifications')` sweep correctly matches only `users/{uid}/notifications/*`
today (only write path is episodeNotify). If any future feature adds a `notifications` subcollection
under a different top-level collection (e.g., `groups/{id}/notifications`), the retention sweep
will also reap those docs. Always check that collection names used in collectionGroup queries
remain unique across the data model when adding new subcollections.

### 2026-06-20 — Session expiresAt vs SESSION_MAX_AGE_MS: intentional two-tier threshold
isExpiredSession uses a strict `expiresAt < nowMs` for new sessions (app sets expiresAt = now+7d)
and `createdAt < nowMs - 30d` for legacy sessions. The 7-day TTL < 30-day legacy backstop is
intentional: `expiresAt` IS the session's designed lifetime; the 30-day threshold only applies to
docs written before the expiresAt field existed. Do not "align" the constants — they serve
different purposes.

### 2026-06-20 — HttpsError thrown inside Admin SDK runTransaction does NOT retry
`firebase-admin`'s `runTransaction` retries on gRPC status codes (numeric: 10=ABORTED, 8=RESOURCE_EXHAUSTED,
etc.) via `isRetryableTransactionError(err)`. `HttpsError` from `firebase-functions/v2/https` uses a
STRING code (e.g. `'resource-exhausted'`), which never matches a numeric `switch` case — so it falls
through to `default: return false`. Throwing `HttpsError` inside a transaction callback aborts cleanly
without retry loops. This is the correct pattern for business-logic rejections (e.g. cooldown enforcement)
inside a Firestore transaction on Functions v2.

### 2026-06-20 — getFunctions returns a cached singleton per (app, region); connectFunctionsEmulator does not throw on repeat calls
`getFunctions(app, region)` is backed by Firebase's component provider, which caches instances in a Map
keyed by the normalized region identifier. Calling it multiple times with the same (app, region) always
returns the same object. `connectFunctionsEmulator` on that instance just overwrites `emulatorOrigin` —
no guard, no throw. A `try/catch` around `connectFunctionsEmulator` labeled "already connected (HMR)" is
dead code (the SDK never throws there), but harmless. The emulator wiring is idempotent because the value
is always the same. Prefer a module-level lazy-init pattern (like `fsdb()`) for new callables to avoid
re-calling `connectFunctionsEmulator` on every invocation.

### 2026-06-20 — Firestore rules cannot count batch siblings; server-callable is the correct fix
The BIN-25 `getAfter(...).lastReportAt == request.time` pattern gated per-batch, not per-report. A
`writeBatch` of N `report.set()` + 1 `throttle.set()` satisfies the rule for ALL N report documents
because each document's create rule sees `getAfter(throttle).lastReportAt == request.time` as true for
the whole batch simultaneously. Firestore security rules have no way to count sibling writes in the same
batch. The canonical fix is: lock the client rule (`allow create: if false`) and route creation through
an Admin SDK callable that enforces the limit in a `runTransaction`.

### 2026-06-20 — border-l on <tr> inside border-collapse table is non-standard and unreliable
CSS `border-collapse: collapse` applies to table CELLS (`<td>`/`<th>`), not rows (`<tr>`). `border-left`
on a `<tr>` element is not part of the CSS table model and browsers handle it inconsistently — some ignore
it entirely, some pass it through to the first cell. The savings-page accent-stripe pattern (`border-l-[3px]
border-l-accent` for the top-ranked row) must be placed on the FIRST `<td>` of that row, not on the `<tr>`
itself. The `border-b` on `<tr>` works (most browsers propagate bottom border to cells in collapsed mode)
but `border-l` does not have the same support. Reference: CoverageOptimizer.tsx BIN-87 review.

### 2026-06-20 — JustWatchCredit guard must include free/ads providers (BIN-90)
Both `MoviePageClient` and `TVShowPageClient` guard `<JustWatchCredit />` with
`subscription.length > 0 || hasRentBuy`. When a title appears ONLY in `free` or `ads`
categories (subscription is empty, no rent/buy), `FreeWatchBadge` renders provider names
but JustWatchCredit is hidden — violating TMDB's attribution requirement (which requires
JustWatch credit on every surface that shows provider data). The guard must be broadened to
`subscription.length > 0 || hasRentBuy || free.length > 0 || ads.length > 0`.

### 2026-06-20 — hasFreeProvider exported but not consumed (BIN-90)
`hasFreeProvider(ids: number[])` in `providers.ts` is exported and tested but has no
call-sites in production code. TitleCard uses `mapped?.isFree` directly (reading from
`PROVIDER_MAP.get(id)?.isFree`), which is correct for its purpose (it has the full mapped
object). `hasFreeProvider` is future infrastructure for surfaces that only have a flat id
array. Treat as advisory (same pattern as `currentSeasonToPrefetch`/`seasonPrefetchSpec`)
— no risk until wired up, but flag as untested in production path.

### 2026-06-20 — useAuth() must be called before any conditional early return (Rules of Hooks)
In components that gate on `providers.length === 0` (or any early return), `useAuth()` must come
BEFORE the early return, not after. BIN-46 introduced `const { user } = useAuth()` in
`ProvidersByValue` at line 37, then placed `if (providers.length === 0) return null` at line 38.
This is correct ordering (hook first, guard second). Any refactor that reorders these will violate
Rules of Hooks. Verify this ordering whenever an early-return guard is added to a component that
uses `useAuth`.

### 2026-06-20 — defaultValue on uncontrolled date input goes stale after Firestore round-trip on same page
React's uncontrolled inputs (`defaultValue`) are seeded once on mount and never updated by React thereafter.
In WatchedDateEditor (BIN-91), the input uses `defaultValue={toInputValue(watchedAt) || today}`. After the
user picks a date and the Firestore write round-trips, the parent `watchlistItem.watchedAt` updates via
the onSnapshot listener — but the input's displayed value does NOT update, because defaultValue is
already mounted. This is a cosmetic issue: the DISPLAYED date can lag by one Firestore round-trip (~100–300ms)
after the user makes a selection. In practice the mismatch is imperceptible because the UI re-renders with
the Firestore-confirmed value only after the round-trip anyway, and by then the user has already moved on.
The clean fix is: add `key={toInputValue(watchedAt) || today}` to the input so React remounts it when the
stored date changes. Without a key, the component is idempotent from the user's perspective (they just
picked the date they see), but a date change from another device/tab will not update the display.
Flag as advisory (not blocker) when the use-case is single-device; flag as bug if multi-device sync is in scope.

### 2026-06-20 — Legacy bridge token `text-red` is NOT a danger alias; use `text-danger-ink`
`tailwind.config.ts` defines `text-red` nowhere in its bridge aliases. The alias `text-red` in
`ProvidersByValue.tsx` line 84 (for high kr/serie values) is an undeclared class that produces no
colour output. The correct token for error/warning colouring is `text-danger-ink` (for text on
a danger surface) or `text-danger` (for standalone red text, which maps to `--danger`).
The `danger` token group is: `danger` / `danger-soft` / `danger-ink`. Never `text-red-*` or
ad-hoc `text-red` without a defined token. Note: `text-red` (not `text-red-*`) is the undeclared
class seen in ProvidersByValue; `text-red-*` Tailwind classes (with shade suffix) are also banned
per CLAUDE.md, but this specific one was no suffix at all — it just silently produces nothing.

### 2026-06-20 — availableGenres base-set should be status-only, NOT status+mediaFilter (BIN-44 design)
`availableGenres` in WatchlistPage is intentionally derived from the status-only base set (ignoring
`mediaFilter`, `genreFilter`, `minRating`, `providerFilterId`, `searchQuery`). This is correct for
the stated goal: "chips must not vanish when the user is actively filtering" — if chips were derived
from `filtered`, every toggle would remove its own chip. The deliberate trade-off is that on the
`/my/all` mixed view, switching `mediaFilter` to 'movie' does NOT hide TV-only genre chips (and
vice versa). This is benign: clicking a TV-genre chip on a movie-filtered list simply returns 0
results and `buildStandfirst` correctly says "Inga filmer matchar dina filter". Do NOT add
`mediaFilter` to `availableGenres`'s dependency array or input filter — that breaks the
no-vanishing-chips invariant. Flag as advisory if Malin finds the TV-genre-on-movie-filter
confusion jarring, but it is not a logic error.

### 2026-06-20 — genre+rating filter placed BEFORE behind-filter in WatchlistPage filtered memo (correct ordering)
`itemPassesGenreRating` runs before `behindIds` filter in the `filtered` useMemo chain. This is
correct: both axes narrow the same result set sequentially; neither depends on the other's output.
The `behindIds` filter is the most expensive to compute (requires advisor settle) and runs last —
but since it's a simple Set lookup, order doesn't affect correctness, only style. The deps array
`[items, status, mediaFilter, sort, searchQuery, providerFilterId, genreFilter, minRating, behindIds]`
is complete; no missing deps.

### 2026-06-20 — Legacy bridge tokens on new components must be flagged; Direction-H names preferred
`text-text-muted`, `text-text-primary`, `border-border-main` are legacy bridge aliases retained in
`tailwind.config.ts` (remapped to `--ink-3`, `--ink`, `--rule` respectively). They work at runtime but
are double-prefixed artifacts of the old naming and are slated for removal. New components in
`src/components/home/` should use the Direction-H primary names (`text-ink-3`, `text-ink`, `border-rule`)
or the shorter legacy aliases (`text-muted`, `text-primary`, `border-main`) — whichever the surrounding
codebase already uses for consistency. Do not introduce new usage of `text-text-*` or `border-border-*`
double-prefixed forms. Flag as a medium finding (convention violation, not a runtime bug).

### 2026-06-20 — CORRECTION: text-text-muted/text-text-primary/border-border-main ARE valid Tailwind classes
`tailwind.config.ts` lines 69-73 define color tokens named `text-primary`, `text-secondary`, `text-muted`,
`border-main`, `border-light`. When Tailwind generates utilities for these, it prefixes them: `text-text-primary`,
`text-text-muted`, `border-border-main`. These double-prefixed forms are real, valid, resolving Tailwind classes
— they are NOT undeclared. They appear throughout production code: `WillSeePerProvider.tsx`,
`ProvidersByValue.tsx`, `BacklogResurfaceTile.tsx`. Do NOT flag them as undeclared tokens. The style advisory
(preferring the shorter primary tokens `text-ink-3`, `text-ink`, `border-rule`) may still be noted as a
convention nit but must NOT be called a bug or a missing-token error. A prior review incorrectly flagged
these as invalid in `ContinueWatchingTile.tsx` — retracted on 2026-06-20.

### 2026-06-20 — pickContinueWatching: librarySubState default knownBehind=false means 'ligger_efter' only triggers via tmdbStatus+totalSeasons, never via advisor data on home
`librarySubState(item)` with no extra args returns `'ligger_efter'` only when `item.tmdbStatus` is
an ended/canceled value AND `item.lastWatchedSeason < item.totalSeasons`. This matches the stated
design intention (no fan-out, persisted-only). Advisors that DO have real aired-data can call
`librarySubState(item, true/false, ...)` — but on the home page that data is not fetched. The
`behind: sub === 'ligger_efter'` flag in ContinueWatchingTile is therefore accurate to what
`librarySubState` can derive without TMDB. The `'paborjad'` bucket (Returning Series, user has watched
some episodes) will never be classified as 'ligger_efter' on home even if the user is genuinely behind
— this is the correct and documented cost trade-off.

### 2026-06-20 — h2 section headings in home tiles: use design-token text classes, not bare inline sizes
In `ContinueWatchingTile.tsx` the section `<h2>` uses `text-[11px]` (arbitrary size) and
`text-text-muted` (double-prefixed legacy alias). Both should use the canonical Tailwind token:
`text-xs` (maps to 11px in Direction-H config) and `text-ink-3` (the primary token for muted text).
Compare with `LaterThisWeek`, `BacklogResurfaceTile`, etc. for the codebase's established pattern.

### 2026-06-20 — Multi-branch section render: ALL branches must thread optional props, not just the special-case branch
In `FollowingCardSections.tsx`, `LIBRARY_SUB_STATE_ORDER.map()` has two render branches: the
`key === 'avslutad'` branch (collapsed, conditional SectionGrid) and the default branch (always-open
SectionGrid). When new optional props are added and threaded through the avslutad branch, the default
branch at the end of the `map()` callback ALSO needs the same props. Omitting them from the default
branch silently drops the feature for all non-avslutad sections (ligger_efter, paborjad, ej_paborjad).
Pattern: always search for ALL call-sites of the inner component when adding props; a single
`map()` with multiple `return` paths has as many call-sites as it has `return` statements.

### 2026-06-20 — role=checkbox on a div requires tabIndex={0} for keyboard accessibility
A `<div role="checkbox">` is an interactive ARIA widget. Without `tabIndex={0}` it is not reachable
via Tab key and assistive technologies cannot focus it. Always pair `role="checkbox"` with `tabIndex={0}`
(and a `onKeyDown` handler for Space/Enter if click-only behavior is the default, though click-on-space
is provided by many browsers for role=checkbox). This applies to both WatchlistCard and the grid-view
div in WatchlistPage's grid render path.

### 2026-06-20 — .select primitive: saffron focus ring is acceptable; appearance reset is advisory only
BIN-47 introduced a shared `.select` CSS primitive in `globals.css`. Confirmed correct pattern:
- All CSS values use `var(--*)` tokens — no hex.
- The `:focus-visible` ring uses `var(--acc)` / `var(--acc-soft)` (saffron). This is acceptable:
  focus rings are functional interaction-emphasis (keyboard navigation feedback), not a CTA or
  live-indicator semantic use. Browser convention (Chrome, Firefox) uses the brand accent for
  focus rings universally. The two-accent rule (saffran = "nu/live/CTA", plum = "idag") governs
  decorative/semantic use, not functional a11y states. Do NOT flag saffron focus rings as
  two-accent violations.
- No `appearance: none` in `.select`. The native OS dropdown arrow is deliberately retained
  (retains affordance without needing a custom SVG chevron; aligns with Direction H's
  "functional, not decorative" stance). This is acceptable. Only flag `appearance: none` absence
  if a design token for a custom arrow is later added.
- Consumer pattern: layout modifiers (`w-full`, `max-w-[180px]`) are kept; visual classes
  (`bg-white`, `rounded-sm`, `border-border-main`, `outline-none`, `font-[inherit]`) are dropped.
  Any future select must follow the same pattern — class="select" + layout-only modifiers only.

### 2026-06-21 — role=tooltip requires aria-describedby on the trigger for full ARIA compliance
A `<div role="tooltip" id="X">` is only surfaced to AT users if the triggering element has
`aria-describedby="X"`. Without the wiring, screen readers cannot find the tooltip via the
relationship — they only find it if they happen to navigate to it as a focusable/readable DOM
node. For `position: fixed` tooltips that are rendered in a portal-like pattern (lifted to a
component root), each trigger cell must have `aria-describedby` pointing to a stable `id` on the
tooltip div (or a dynamically generated id). Since the tooltip is ephemeral (conditionally
rendered), the id must be set when the tooltip is shown, and `aria-describedby` on the trigger
must be set at the same time (or the trigger must use `aria-label` as the sole AT signal, which
is what BIN-45 actually does — `aria-label` on each `<Link>` is the AT path, and the tooltip is
explicitly a pointer/focus visual enhancement only). The visual `role="tooltip"` div without
`aria-describedby` is a partial implementation — acceptable when `aria-label` on the trigger
already conveys the full information to AT, but should be flagged as a known gap in a formal
a11y audit.

### 2026-06-21 — position:fixed inside overflow-x-auto is safe when no ancestor has CSS transform/filter/perspective
A `position: fixed` element is re-parented to the viewport coordinate system and escapes
`overflow` clipping — UNLESS any ancestor has `transform`, `filter`, `perspective`, or
`will-change: transform` set (those create a new containing block for fixed descendants).
When reviewing `position: fixed` tooltips/dropdowns, check the ancestor chain for any such
property before flagging "clip escape won't work." In AdvisorTimeline, the `overflow-x-auto`
wrapper has no transform ancestor up to AppShell root, so `position: fixed` does escape the
overflow clip as intended. The `DuotoneFilters` SVG `<filter>` defs live in an SVG element
that is itself not a CSS containing block for the component tree — only CSS `filter` on a
containing HTML element (not an SVG `<filter>` definition) would re-parent fixed descendants.

### 2026-06-21 — React Query disabled query (enabled:false): isLoading is false, not true
When `enabled: !!uid` and `uid` is null, React Query v5 sets `status = 'pending'` but
`fetchStatus = 'idle'`. The derived `isLoading` flag is `status === 'pending' && fetchStatus === 'fetching'`
— so `isLoading` is `false` for a disabled query. This means a hook that returns `isLoading` as
its loading indicator will correctly NOT block the UI when the user is unauthenticated. Do NOT
substitute `isPending` (which is just `status === 'pending'`, i.e. true for disabled queries too)
unless you explicitly want to gate on the pending state regardless of whether a fetch is in flight.
Confirmed in useAllEpisodeProgress: `episodesLoading` is false for unauthenticated visitors, which
is correct (diary page is auth-gated upstream anyway).

### 2026-06-21 — flattenEpisodeProgress: dot-notation corrupt keys are skipped via Number() → NaN
Old Firestore writes (pre-BIN-103 bug) stored episode progress with dot-notation season keys like
`'seasons.1.5'` instead of the integer key `'1'`. The defensive parser in `flattenEpisodeProgress`
handles this via `Number(sKey)` — `Number('seasons.1.5')` is `NaN`, and `!Number.isFinite(NaN)` skips
the entry. No explicit dot-check is needed. The same NaN path handles any other non-numeric season
key that could appear from past or future schema bugs. Verify this guard whenever the episodeProgress
write path changes.

### 2026-06-21 — Dead ternary when singular == plural in Swedish: flag as nit only
`${total} ${total === 1 ? 'inlägg' : 'inlägg'}` — "inlägg" is both singular and plural in Swedish,
so the ternary is semantically correct but both branches are identical dead code. This is a nit (no
runtime effect), not a bug. Do not block on it; note it so it can be cleaned up. The same applies to
other Swedish words that don't inflect (e.g. "avsnitt"). Only flag when the two branches differ
(indicating a real pluralisation intent) and one is wrong.

### 2026-06-21 — calendar-present branch in pickContinueWatching hardcodes behind:true; persisted-only behind derivation is lost
In `continueWatching.ts`, when `airedPos` is present the calendar branch always pushes `behind: true`
for any show that has unwatched aired episodes. This means a show where `librarySubState` would return
`'paborjad'` (Returning Series, genuinely active) gets `behind: true` just because one episode has aired
since the user's last watch. The practical consequence is that "behind"-sort-to-top fires for every show
in the calendar-present path, not only shows the persisted logic considered behind. This over-fires the
"behind" label but does not cause false inclusions or false exclusions (correctness is fine). It is a
medium finding: the UX sort ordering can be wrong (a freshly-active Returning Series appears at the top
labelled as "behind" when only the next episode has just dropped). The fix is to derive `behind` in the
calendar branch from `comparePos` relative to what was known, or keep the persisted `sub === 'ligger_efter'`
when the calendar doesn't add new evidence — i.e. `behind: comparePos(watchedPos(item), airedPos) > 0`
is always true at that code point (we already checked ≥0 would continue), but the intent of the flag
is "meaningfully behind" not "any unwatched aired episode". Treat as medium (UX sort order) not a blocker.

### 2026-06-21 — promptRating reads current BEFORE addItem write; rating gate is intentionally pre-write
In `useMarkSeen.ts`, `const current = getItem(tmdbId)` is called synchronously at the start of the
callback, before the `await addItem(...)` call. `promptRating()` therefore reads `current?.rating`
from the pre-write snapshot. This is CORRECT for the gate: we want to know whether the user already
had a rating at the moment they chose "sedd" — if they did, we skip the nudge. The Firestore
onSnapshot-driven context update happens asynchronously after `addItem` resolves, so `getItem` would
still return the old value even if called after the await. The design is sound; do not flag as stale.

### 2026-06-21 — showRating toast: onRate closure captured in state is safe; no stale-ref risk
`showRating(message, onRate)` stores the `onRate` callback directly in a `Toast` state object.
The render lambda `(n) => { t.onRate!(n); dismiss(t.id); }` closes over `t`, which is the object
from the current `toasts` state snapshot at render time. The `onRate` function itself is created at
call-site and closes over stable references (`updateRating` useCallback, `tmdbId`, `mediaType`).
There is no stale-closure issue. Do not flag this pattern.

### 2026-06-21 — ToastContext rating toast: X close button only appears on onRate toasts; regular toasts rely on auto-dismiss only
The X close button in `ToastContext.tsx` is rendered only when `t.onRate` is set (rating toast).
Regular `show()` toasts have no manual dismiss button — they auto-dismiss after 2.5 s or 6 s. This
is the established pattern and is intentional (regular toasts are ephemeral confirmations, not action
toasts). Only flag if a regular toast needs a dismiss affordance for accessibility (aria-live=polite
handles AT announcement; manual dismiss is not required for simple status toasts).

### 2026-06-22 — TMDB /collection/{id} parts array omits media_type; TMDBSearchResult.media_type is required in the type
TMDB's `/collection/{id}` endpoint returns `parts` as movie objects without a `media_type` field.
`TMDBSearchResult` declares `media_type: 'movie' | 'tv' | 'person'` as required (non-optional).
Code that reads `part.media_type` or passes a `parts` element where `media_type` is required will
compile with `any` casts or TS errors, and at runtime the value is `undefined`. The correct fix is
to either (a) declare a narrower `TMDBCollectionPart` interface that omits `media_type`, or (b) make
`media_type` optional on `TMDBSearchResult` and add a discriminant helper. Callers that hardcode
`mediaType: 'movie'` in the `addItem` call (as `CollectionSection.addAllUnseen` does) are correct
for the domain — collections are always movies — but the type mismatch stays a risk if `parts` is
ever passed to a consumer that reads `media_type` from the element rather than from context.

### 2026-06-22 — subsYouOwn computed after movie-load early-return but before mounted guard; safe ordering rule
In `MoviePageClient`, `subsYouOwn` is a derived `const` computed after the early-return guards
(`if (isLoading) ... if (!movie) ...`) but before the component body renders. The `mounted` gate on
`myProviderIds` is correct (`mounted ? user?.myProviders ?? [] : []`). The ordering is safe because
the derived constants all depend on `movie` (which is confirmed non-null by the early returns above)
and on `mounted` (gated inline). The pattern is fine; confirm it whenever adding computed vars between
the early returns and the JSX in MoviePageClient.

### 2026-06-22 — discoverMovies/discoverTV already inject watch_region=SE; build-time calls need no extra param
`discoverMovies` and `discoverTV` in `src/lib/tmdb/client.ts` apply `{ region: 'SE', watch_region: 'SE', ...params }` as
defaults. Build-time calls in `src/app/provider/[id]/page.tsx` pass `with_watch_providers` and `sort_by` without
`watch_region` — this is correct; the function already injects it. Do NOT flag missing watch_region in callers of
these two helpers; only flag it for raw `tmdbFetch` calls.

### 2026-06-22 — SEO provider route: initialItems seeds only movies (not tv) when initialTab='movies'; this is correct
`fetchPopular` returns `{ movies, tv }` but `ProviderPage` passes only `movies` (mapped to `media_type:'movie'`) as
`initialItems` to `ProviderPageClient`. Since `initialTab='movies'` is also passed, the client's second `useEffect`
(the accumulator) initialises `allResults` from `initialItems` on mount for the movies tab. TV items are not seeded
because the initial tab is 'movies' and the TV fetch fires client-side only. This is intentional — seeding both would
waste bytes on a tab the user hasn't visited. Correct as-is.

### 2026-06-22 — firstReset ref skips mount-run of reset effect; safe only when initialTab matches tab state
The `firstReset` ref pattern (`if (firstReset.current) { firstReset.current = false; return; }`) in `ProviderPageClient`
prevents the reset effect from wiping `initialItems` on mount. The deps array is `[tab, providerId]`. React runs effects
once on mount (deps-change from no-value to initial value). Since both `tab` and `providerId` are initialised from props
at the same time, the mount-run is always skipped. The guard is safe. A subsequent prop-change (e.g. navigating to a
different provider) correctly triggers the reset because `firstReset.current` is false by then. One subtle edge case:
if the component is remounted with different `id` props (DynamicRouter uses `key={segments[1]}`), the `firstReset` ref
resets to `true` on the new instance because `useRef(true)` runs fresh — this is correct (new mount = seed preserved).

### 2026-06-22 — dynamicParams=false + generateStaticParams: non-listed ids fall to catch-all in static export
`dynamicParams = false` in a static export (`output: 'export'`) means Next does NOT render pages for params outside
`generateStaticParams`. Those ids are NOT 404ed at build time — the `src/app/[...path]/page.tsx` catch-all covers them
at runtime via the Firebase Hosting `** → /_/index.html` SPA rewrite. This matches the established pattern for `/movie/[id]`,
`/tv/[id]`, `/person/[id]`. The 12 SEO provider ids get their own pre-rendered HTML; all other provider ids fall through
to the SPA shell (served noindex by the catch-all). No `firebase.json` rewrite change is needed because the SPA wildcard
already covers them. DynamicRouter.tsx already has the `provider` dispatch branch. Both conditions satisfied.

### 2026-06-22 — React Query hashKey uses JSON.stringify; array in queryKey is stable by value, not reference
`hashKey` in `@tanstack/query-core` uses `JSON.stringify` with a plain-object key-sorter. Arrays are serialized
element-by-element, so `['friends-saw', 42, ['uid1','uid2']]` always produces the same hash string regardless
of whether the array instance is the same object or a fresh `.slice()`. A `capped = followingUids.slice(0, N)`
that returns the same UIDs produces the same query key even though it is a new array reference every render.
There is NO refetch storm. The hash only changes when the UID list contents actually change. Confirmed for
TanStack Query v5.

### 2026-06-22 — enabled gate prevents queryFn execution but does not narrow the captured closure type
When `useQuery({ enabled: !!uid && tmdbId != null, queryFn: async () => { ... String(tmdbId) ... } })` is used,
the `enabled` guard prevents React Query from calling `queryFn` when `tmdbId` is null. However TypeScript does not
narrow the captured `tmdbId` variable inside the async closure — it remains `number | null` in the type system.
`String(null)` would produce the string `"null"` at runtime if the guard were somehow bypassed. This is a type
soundness gap (runtime-safe, TypeScript-unsound). The clean fix is to add a runtime guard at the top of `queryFn`:
`if (tmdbId == null) return [];`. This both satisfies TypeScript's type narrowing and adds a second safety layer.
Flag as medium when `tmdbId` is `number | null` at the hook call-site.

### 2026-06-22 — Promise.allSettled + flatMap(r => r.status==='fulfilled' && r.value ? [r.value] : []) is correct pattern
`Promise.allSettled` never rejects; each element is `{status:'fulfilled',value:T} | {status:'rejected',reason:unknown}`.
`flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])` correctly:
- drops all rejected settlements (permission-denied from Firestore rules, network errors)
- drops fulfilled-but-null results (user does not have this title in their watchlist)
- returns only fulfilled non-null values
This is the canonical fan-out filter for Firestore reads where some docs are expected to be denied or absent.
The `r.value` truthiness check works because null is falsy and valid FriendWhoSaw objects are truthy (objects).
It would fail silently for falsy non-null values (0, '', false) — but FriendWhoSaw is always a plain object, so this is safe.

### 2026-06-22 — 'mina' status label on a film page is misleading; status is not media-type-scoped in FriendWhoSaw
`useFriendsWhoSaw` returns raw `status` from the watchlist doc without knowledge of media type. On a film page,
a friend's status of `'mina'` (TV-only concept) would display as "följer" via the `label()` switch. This cannot
happen in practice today (films cannot have status 'mina' per the status model since 2026-06), but the
`FriendWhoSaw.status` field is typed as `string`, not the `WatchStatus` union, so future schema drift could
surface it. The label function's `default: return ''` fallback makes this a silent blank rather than a wrong
string — acceptable, but worth noting if the status model ever broadens.

### 2026-06-22 — Dark-mode FOUC prevention: inline script + lazy useState + suppressHydrationWarning is the correct pattern
The canonical FOUC-free dark mode setup for Next.js static export (no server):
1. A blocking inline `<script>` in `<head>` reads `localStorage['binge:theme']`, resolves 'system' via
   `matchMedia('(prefers-color-scheme:dark)').matches`, and sets `document.documentElement.dataset.theme='dark'`
   before first paint. The script does NOT remove the attribute on light — it simply never sets it.
2. `ThemeProvider` uses `useState<ThemeMode>(readStored)` with a lazy-init function that mirrors the script's
   localStorage read exactly. This means React's initial `mode` state matches what the script decided — no
   divergence on mount.
3. `useEffect(() => applyTheme(mode), [mode])` fires post-render. For light mode it calls
   `delete document.documentElement.dataset.theme` (correct — `delete element.dataset.foo` removes the attribute).
   For dark it sets the attribute again (idempotent — was already set by the script).
4. `<html suppressHydrationWarning>` is required because the inline script mutates `dataset.theme` before React
   hydrates, creating a server/client mismatch on the `<html>` element. Without it, React would warn or revert.
   `<body suppressHydrationWarning>` is also present for the same reason (the returning-user script mutates class).
5. The matchMedia listener effect returns `mq.removeEventListener('change', onChange)` as cleanup and is
   gated on `mode === 'system'` — no leak when mode is 'light' or 'dark'.
6. Hex values in `manifest.json` (`background_color`, `theme_color`) and in the `viewport` export
   (`themeColor: '#f9f7f1'`) are NOT CLAUDE.md violations — those fields are outside component .tsx code
   and are required to be hex/CSS strings by the Web App Manifest + Next.js Viewport API specs.
7. The dark block in globals.css must override every token from `:root` that has a visual meaning in both modes.
   `--sans`/`--mono` are font-family aliases and correctly omitted from the dark block (typography is not
   theme-sensitive). Omitting a color token from the dark block means it inherits the light value — always verify
   coverage when adding new tokens to `:root`.

### 2026-06-22 — CSV import dry-run: importable is a render-derived array, not memoized; correct in this pattern
In ImportContent, `importable` is a plain `const` computed each render from `analyzed` state. It is listed in
`runImport`'s `useCallback` dep array. This is correct: because `setAnalyzed` always produces a new array
reference, `importable` changes exactly when analysis results change, and `runImport` is regenerated accordingly.
There is no stale-closure risk. If `importable` were accidentally memoized with a stale dep array, the sequential
`addItem` loop could write an old set of items — always verify the `useCallback` dep list includes `importable`
when this pattern is used in import/batch-write flows.

### 2026-06-22 — Sequential addItem loop in import: no concurrency race; addItem itself is async-safe
The `for...of await addItem(...)` loop in `runImport` is intentionally sequential. Each `addItem` call awaits
the Firestore `setDoc` before proceeding. This is consistent with WatchlistContext's `firstSnapshotSettledRef`
logic: concurrent addItem calls during cold-load each increment `pendingAddCountRef` correctly (JS single-threaded
event loop: increments are synchronous before the `await fsdb()` yield). Sequential is also the safer choice
when writing ≤1000 docs because it avoids Firestore write-rate throttling and the 8-slot TMDB semaphore is
not involved in the write path at all.

### 2026-06-22 — summaryText double-count when topProviderId is a user-owned service
In CollectionSection's `summaryText`, when `commonProviderId` is null the function emits two
separate bits: `onYourServices` ("N på tjänster du har") and `topProviderCount` ("M på Netflix").
If the top provider IS one the user owns, both bits reference overlapping films — a user sees
e.g. "4 osedda — 3 på tjänster du har · 3 på Netflix" where the Netflix 3 are a subset of the
"tjänster du har" 3. This is a display/clarity issue, not a logic error. The clean fix is: only
show `topProviderId` when it is NOT in `myProviderIds` (i.e. it is a service the user does not
already own — actionable "you could add this"). Flag as medium on new collection streaming
summaries. The pure logic in `summarizeCollectionStreaming` is correct; the UI assembly in
`summaryText` is where the overlap surfaces.

### 2026-06-22 — useQueries with enabled:false fires no fetches; isLoading=false for idle queries (v5)
`useQueries({ queries: [...{ enabled: false }] })` in TanStack Query v5 sets each query to
`status='pending', fetchStatus='idle'`. `isLoading` is `status==='pending' && fetchStatus==='fetching'`
so it is false for disabled queries. Zero network calls are made until `enabled` flips to true.
The CollectionSection `enabled: mounted && showStreaming` pattern is therefore correct: the
default page view (showStreaming=false) makes zero extra TMDB calls regardless of collection size.
The `streamingLoading = showStreaming && streamingQueries.some(q => q.isLoading)` guard is also
correct — the `showStreaming &&` prefix prevents a spurious loading state before the first click.

### 2026-06-23 — findByImdbId and similar one-shot helpers in client.ts omit AbortSignal; advisory only for import flows
`findByImdbId` (and any future one-shot lookup helper) accepts `opts?: TmdbFetchOpts` but the
import analyze loop calls it without forwarding a signal: `await findByImdbId(row.imdbId)`.
Because the analyze loop is triggered by a user button click and runs inside `Promise.all`, there
is no React Query `ctx.signal` to thread. The practical risk is low (at most ~1000 in-flight
TMDB calls, all capped by the 8-slot semaphore, and the user cannot navigate away mid-import
without losing state anyway). Flag as advisory, not a blocker. The fix, if desired, would be to
create an `AbortController` in the `analyze` callback and pass its signal to both `findByImdbId`
and `searchMulti`, then abort on component unmount via a `useEffect` cleanup.

### 2026-06-23 — Comment says "ratio > 0.6" but gate is `ratio < 0.5`; functionally the correct threshold
In `matchTitle.ts` the BIN-144 comment reads "Kräv ratio > 0.6 så delsträng+år ensamt inte
klarar tröskeln" but the actual gate is `if (ratio < 0.5) return 0`. These two values describe
DIFFERENT thresholds: > 0.6 would require a tighter match than < 0.5. The CORRECT threshold is
< 0.5 (the code): it correctly disqualifies "Up" (2/13 ≈ 0.15) and "Her" (3/14 ≈ 0.21) and
passes "Matrix"/"The Matrix" (6/10 = 0.6 ≥ 0.5). At threshold 0.5, substring + exact year = 1.0
exactly meets MATCH_THRESHOLD, so the first case that slips through at ratio=0.5 itself scores
exactly 1.0 — acceptable given the conservative design (the exact-year requirement is still present).
The comment is wrong, not the code. Flag as a stale-comment nit; the comment should say
"Kräv ratio >= 0.5" to match the code.

### 2026-06-23 — importFailed (and similar per-run counters) must be reset in onFile, not only in runImport
When a per-run error counter (`importFailed`) is introduced alongside `imported`, both must be reset when the
user picks a new file (`onFile`). Resetting only `imported` leaves a stale failure count from a previous run
visible in the `stage === 'done'` view on a subsequent successful import. Pattern: any state that is written
inside `runImport` and read in the done-view must also be cleared in `onFile`. The local `failed` variable
inside `runImport` correctly starts at 0 each call, but `setImportFailed(failed)` is only called on the
catch path — if the second run has zero failures, the state setter is never called and the old value persists.
Fix: add `setImportFailed(0)` alongside `setImported(0)` in the `onFile` callback.

### 2026-06-23 — WIKIPEDIA_HOST regex allows one optional label only; multi-level subdomains correctly rejected
`/^([\w-]+\.)?wikipedia\.org$/` permits `wikipedia.org` and `*.wikipedia.org` (single label) but rejects
`x.sv.wikipedia.org` (two labels). This is correct for the Wikipedia API: all language subdomains are
single-label (`sv.`, `en.`, `m.`, etc.). The regex also correctly rejects `sv.wikipedia.org.evil.com`
(the `.org` is not at the end). `new URL(pageUrl).hostname` strips the port and scheme before the test,
so port-appended hosts (e.g. `sv.wikipedia.org:8080`) would need the port stripped — but `URL.hostname`
already does that. The try/catch around `new URL(...)` handles malformed URL strings. Pattern is correct.

### 2026-06-22 — /settings/import is a static nested route, NOT a dynamic route; no DynamicRouter/firebase.json change needed
`/settings/import` lives at `src/app/settings/import/page.tsx` — a fixed path with no `[param]` segment.
Next.js App Router generates a static HTML page for it at build time (no `generateStaticParams` needed).
The existing `** → /_/index.html` SPA rewrite in `firebase.json` already handles it as a fallback, but the
pre-rendered HTML will actually be served from `out/settings/import/index.html` without hitting the rewrite.
DynamicRouter.tsx dispatch is only needed for paths under `[...path]` (the catch-all). Confirm: any new
`src/app/**/(page).tsx` with only static segments requires NO changes to DynamicRouter.tsx or firebase.json.

### 2026-06-23 — cascadePrioritizer score comment "below personalised rows" is inaccurate when fixed-score rows outrank low-scoring personalised rows
The `free-public` row scores 55 (fixed). The comment says it is "below the personalised rows
(latest-fav/person/similar/keyword)". This is only true at HIGH personalisation scores. At low scores:
- `similar` minimum = 12 (third seed, topSeeds.length=3: (3-2)*12=12)
- `keyword/thematic` minimum = 10 (recurrence=1)
- `latest-fav` minimum = 0 (daysSince≥100)
All three can be below 55. The free-public row will float above these weak personalised rows in practice.
The comment is wrong; the score value 55 is the intended design. Do not flag the score as a bug — flag
the comment as inaccurate if reviewing cascadePrioritizer.ts. The intent is "above generic discovery
(genre-canon 40, trending 30, upcoming ≤50), within the personalised tier when personalisation is strong."

### 2026-06-23 — useQueries with lowConfidence gate: enabled must also guard on !lowConfidence to avoid wasted fetches
When a NL-search page uses `useQueries` with `enabled: hasQuery && plan.wantMovies`, if the parser
returns an empty filter (lowConfidence=true), all 4 discover queries still fire because `hasQuery` is
true and an empty filter produces `wantMovies=true, wantTV=true`. The results are then hidden behind
the "Jag förstod inte riktigt" EmptyState. This wastes 4 TMDB quota slots per low-confidence submission.
The fix is: `enabled: hasQuery && !isLowConfidence(filter) && plan.wantMovies` (and same for TV). In
practice the wasted fetches are cheap (semaphore-capped, 2h cached) so this is a medium finding, not
a blocker.

### 2026-06-23 — TMDB with_runtime.lte on /discover/tv filters by episode runtime, not total series length
`with_runtime.lte` on the TMDB TV discover endpoint caps EPISODE runtime (minutes per episode), not
total show length. When a user says "under 90 min" on an unspecified media type, the TV discover query
fires with episode runtime ≤90 — which matches most TV shows (most episodes are under 90 min). This
is over-broad but not incorrect. Flag as advisory when runtimeMax is applied uniformly to both movie and
TV params without a media-type guard. The practical impact is minor: long-form prestige TV (feature-length
episodes) is excluded, short-form TV (24min sitcoms) stays in — both reasonable user expectations.

### 2026-06-23 — /ask/ is a static App Router page, not a dynamic [param] route; no DynamicRouter/firebase.json change needed
`src/app/ask/page.tsx` lives at a fixed path with no `[param]` segment. Next.js App Router emits
`out/ask/index.html` at build time. The `** → /_/index.html` SPA rewrite in firebase.json already
covers it as a fallback, but the pre-rendered HTML is served directly. No DynamicRouter dispatch
entry and no firebase.json rewrite change are needed — only routes under `src/app/[...path]/` need
those. Confirm this rule whenever adding new non-parameterized pages under `src/app/`.

### 2026-06-24 — Telemetry useEffect dedupe ref: key should capture only query identity, not result values
In the `ask_binge_results` telemetry effect in `AskPage`, the key is `${mKey}|${tKey}` (the JSON
of discover params), and `results` appears in the dep array but not in the key. This means:
- When a settled query's result set changes (e.g. background refetch, watchlist update shifting
  `excludeSeen`), the effect re-runs but the key check blocks re-firing the event. Correct.
- `results` in the dep array is technically redundant (the event fires once per query identity, not
  per result mutation) but causes no harm — it just makes the effect run more often while the key
  check prevents double-firing. It is an over-trigger but not a stale-closure bug.
- The correct minimal dep array would be `[canQuery, isLoading, mKey, tKey, filter]` — `results`
  and `filter` could be read via refs to avoid the over-trigger entirely, but the current pattern
  is safe at the cost of a few extra no-op effect runs per watchlist change.

### 2026-06-24 — rysare (Swedish for horror film) does not match the rysk|russian language regex
`/rysk|russian/` tests for the substring 'rysk'. The word 'rysare' contains 'rysar' (not 'rysk'),
so `/rysk|russian/.test('rysare')` is false. The horror synonym 'rysare' is therefore safe to add
to the genre-27 regex without requiring any lookahead or reordering in the LANG array. Confirm this
invariant if the Russian language regex is ever broadened to include inflected forms like 'ryss'.

### 2026-06-24 — partial flag in apiInsights must include every nullable source, including askBinge
`partial: rollup === null || rollup.partial || plausible === null` is the existing pattern in `api.ts`.
Any new data source that can return `null` on failure (like `readAskBingeStats`) MUST be added to this
OR clause. If omitted, a failed read silently hides the failure: the dashboard shows stale/missing
tiles with no ribbon, and `InsightsData.askBinge` is `null` without any user-visible signal.
The correct line is: `partial: rollup === null || rollup.partial || plausible === null || askBinge === null`.
Note: `summarizeAskBinge([])` (zero docs, no data yet) returns a zeroed non-null AskBingeData — the
`null` case only arises from Firestore exceptions, not from an empty range. So adding `askBinge === null`
to `partial` correctly fires the ribbon ONLY on genuine failures, not on day-zero when no searches have
been recorded yet.

### 2026-06-24 — where('__name__', op, fullPath) vs FieldPath.documentId() with bare id; both valid in Admin SDK
In Firestore Admin SDK, a range query on document IDs can be expressed two ways:
1. `where(FieldPath.documentId(), '>=', 'bareDocId')` — the documented API; bare ID works within a
   single-collection query.
2. `where('__name__', '>=', 'collectionName/bareDocId')` — undocumented but works; requires the FULL
   document path as the value, not just the ID.
The `readAskBingeStats` function uses form 2 correctly (full paths as `askBingeStats/${range.from}`).
The existing `readBaseline` uses form 1 (FieldPath.documentId() + bare date string). Both produce
correct results. Form 1 is preferred for clarity and forward-compatibility — flag new form-2 uses as
advisory (prefer FieldPath.documentId() with bare IDs) but do not block.

### 2026-06-24 — per-user budget transaction before global budget transaction: correct ordering for anti-abuse
In `askBingeParse`, the per-user daily limit (step 2) is checked and incremented BEFORE the global
daily ceiling (step 3). This is intentional: if the global cap is exhausted, the per-user counter
was already incremented, burning one of the user's 25 daily slots even though no API call happened.
The wasted slot is acceptable (budget enforcement is not per-user-fairness, it's anti-abuse) and the
alternative ordering (global first, per-user second) has the inverse problem: a user who hits the
per-user limit would still increment the global counter if the per-user check were last. The chosen
order (per-user first) ensures the cheapest per-user check fires before the more expensive global
transaction, and early exits on per-user exhaustion avoid touching the shared global doc. The
one-wasted-slot-on-global-cap scenario is a medium finding but not a blocker — mark as advisory
when reviewing callables with two-tier budget transactions: prefer per-user early-exit before
incrementing the global slot.

### 2026-06-24 — race-guard aiReqId ref: stale aiLoading=true if a second search fires before the first resolves
In `runSearch`, when a second low-confidence search fires while the first `llmParseFallback` is
still in-flight, `aiReqId.current` is incremented and the first `.then()` returns early (stale guard
correct). But `setAiLoading(false)` inside the `.then()` is also skipped — meaning `aiLoading`
stays `true` until the SECOND promise resolves. This is the correct behavior (the UI correctly shows
"Tolkar din fråga…" until the winning request completes). Verify: there is no path where `aiLoading`
gets stuck `true` indefinitely — `llmParseFallback` catches all errors and always resolves (never
rejects), and the winning `.then()` always calls `setAiLoading(false)`. Safe.

### 2026-06-24 — needsProviderSetup gate blocks 4 TMDB calls and shows nudge; fires for unauthenticated users too
`needsProviderSetup = hasQuery && filter.myProvidersOnly && !filter.providerIds?.length && myProviders.length === 0`.
When the user is unauthenticated, `user?.myProviders ?? []` is `[]` (length 0), so the nudge fires
for unauthenticated users who type "på mina tjänster". This is acceptable UX — they genuinely have no
providers configured, and /settings/ will prompt them to sign in. The `canQuery = !needsProviderSetup`
gate prevents all 4 discover queries from firing in this state. Verified: the explicit `providerIds`
case (user also named a specific service) correctly bypasses the nudge via `!filter.providerIds?.length`.

### 2026-06-24 — parseSearch: \balien fires on 'alienation'/'alienerad' (accepted low-risk FP)
`/\balien/` (no trailing boundary) matches 'alienation', 'alienerad', 'alienet'. These Swedish
abstractions are rare in a Binge media-search context so the false positive rate is negligible.
If the word list ever broadens (e.g. 'alienera', 'alienering' as common terms in query logs),
add a trailing `\b`: `/\balien\b/`. Do not change without checking the gold-set impact — bare
`alien` (the film/franchise) and `aliens` must still fire sci-fi.

### 2026-06-24 — parseSearch: bare 'oscar' fires voteAverageMin=8 for actor names (accepted)
`/oscar/` (no boundary) matches 'Oscar Isaac', 'Oscar Wilde', etc. In practice the deterministic
parser is a FIRST-PASS that leaves name-based queries to the LLM fallback via `isLowConfidence`.
A query like 'film med oscar isaac' also has no other keyword signal, so the parser returns only
`{voteAverageMin: 8}` — which narrows results but doesn't wrongly exclude. Accepted trade-off.
If logs show meaningful FP rate from actor-name 'oscar' queries, tighten to `oscar(?:s?belön|belön|nominerad)`.

### 2026-06-26 — notified++ inside Promise.allSettled callback is a race: mutations are not returned
In `priceDropNotify/index.ts`, `let notified = 0` is mutated via `notified += 1` inside the
`items.map(async (it) => { ... notified += 1; })` callbacks passed to `Promise.allSettled`.
Because `Promise.allSettled` resolves after ALL callbacks settle, and Node.js is single-threaded,
the increments are NOT lost — they all happen synchronously within their respective microtask turns
before `processTitle` continues. The result is accurate but fragile: any future refactor that moves
`notified` to a closure captured before the allSettled or that adds a `return notified` from the
inner callback (instead of a side-effect increment) would silently return 0. The clean pattern is
to count settled fulfilled results from the returned array instead:
```
const results = await Promise.allSettled(items.map(...));
const notified = results.filter(r => r.status === 'fulfilled').length;
```
Flag as advisory (correct at runtime today, fragile pattern).

### 2026-06-26 — priceDropNotify: double user-doc read per recipient (readPriceDropSettings + sendPushToUser)
Each opted-in user who has a price-drop alert triggers TWO Firestore reads of `users/{uid}`:
1. `readPriceDropSettings(it.uid)` reads the user doc to get `priceDrops` + `pushEnabled`.
2. `sendPushToUser(it.uid, ..., { pushEnabled })` receives `prefetched.pushEnabled` so it SKIPS
   its own profile read — only reads `fcmTokens`. This is correct: the `prefetched` path in push.ts
   avoids the double-read. So the pattern is: 1 profile read + 1 fcmTokens read per user. Acceptable.
   Do NOT flag as double-read. The comment in push.ts ("BIN-33") documents this optimization.

### 2026-06-26 — RotationCalendar persist-effect: stale-closure on `schedule` is safe via scheduleJson guard
The `useEffect` in RotationCalendar.tsx:
  `[remindersOn, calendar.isLoading, scheduleJson, updateRotationSchedule]`
  captures `schedule` (from useMemo) directly but also captures `scheduleJson` in the dep array.
The eslint-disable comment suppresses the `schedule` dep warning. This is safe because:
- `scheduleJson === JSON.stringify(schedule)` is always true within the same render (both derive
  from the same `useMemo` and `JSON.stringify` call in the same render phase).
- `lastPersistedRef.current = scheduleJson` stamps the JSON, and `scheduleJson` in the dep array
  ensures the effect re-runs when the schedule changes.
- The `void updateRotationSchedule(schedule)` call uses the `schedule` from the SAME render
  as `scheduleJson`, so there is no stale-closure mismatch.
This is the correct write-on-change-only persist pattern. Do not flag.

### 2026-06-26 — parseSearch: c ?more fires as substring in 'music more', 'lyric more', 'magic more'
`/c ?more/` (no word boundary) matches any text ending in 'c' followed by optional space + 'more'.
This is a false positive for English queries like 'something with magic, more action-oriented'.
In practice Binge queries are Swedish, so the collision is rare. If English usage grows, add a
word boundary: `/\bc ?more\b/` or prefer `\bcmore\b|\bc more\b` with explicit anchors.
The TV4/C More provider ID is 489 (same as TV4) — a FP here only widens the provider filter,
it doesn't suppress results entirely.

### 2026-06-24 — parseSearch eval mirror: ACTIONISH is module-scope in .ts but function-local in .mjs; functionally identical
`parseSearch.ts` defines `const ACTIONISH = [...]` at module scope (line 14) and captures it via
closure inside `parseSearch()`. `deterministic.mjs` defines `const ACTIONISH = [...]` inside
`parse()` (line 105). The values are identical `[28, 10759, 53, 80, 9648, 12]`. No functional
difference — the module-scope form is slightly more efficient (one allocation per module load vs
per-call) but both produce the same parse results. Do not flag as a sync divergence.

### 2026-06-26 — unseenDirected in PersonPageClient must guard on media_type==='movie', not only numeric id
`directedFilmIds` is built from crew where `c.media_type === 'movie'`. The `directedIdSet` stores
only numeric movie IDs. `unseenDirected` filters `roles` (which contains both movies AND TV shows
from cast+crew) by `directedIdSet.has(r.id)`. TMDB IDs are NOT globally unique across media types
— a TV show and a movie can share the same numeric ID. The correct filter is:
`roles.filter(r => r.media_type === 'movie' && directedIdSet.has(r.id) && getItem(r.id)?.status !== 'sedd')`.
Without the `r.media_type === 'movie'` guard, a TV show whose TMDB ID happens to collide with a
directed movie ID would appear in "Osedda att samla klart". The collision probability is low but
non-zero. Flag as medium (low-probability correctness bug; TitleGrid would render the TV show with
wrong context).

### 2026-06-26 — applyRuntimeBudget: no-budget branch now wraps in RuntimeLensResult; caller must destructure
BIN-167 changed `filterByRuntime` (returning `T[]`) to `applyRuntimeBudget` (returning `RuntimeLensResult<T>[]`).
When `maxMinutes == null`, items are still wrapped: `items.map(item => ({ item, unknownRuntime: false }))`.
This means ALL callers of `applyRuntimeBudget` must destructure `{ item, unknownRuntime }` regardless
of budget state — the return type is always `RuntimeLensResult<T>[]`. VillSePickerPage correctly does
this (`picks.map(({ item, unknownRuntime }) => ...)`). Confirm whenever a new caller is added.

### 2026-06-26 — Bulk status-change buttons in WatchlistPage: no try/catch means partial success leaves selection intact
The BIN-168 "Avbryt" button (and the pre-existing "Flytta till Vill se" button) use `await Promise.all(...)`
without a try/catch. If one Firestore write fails, the Promise rejects and `setSelected(new Set())`
is not called — the selection stays, but some items may already have been updated. This is a
pre-existing pattern (not new debt from BIN-168). The prune-effect at line 234 will clean up
stale selection members as `displayItems` changes, so the UX recovers automatically on the next
render cycle. Flag as advisory if a future pass hardens error handling for batch operations.

--- relocated 2026-07-16 ---

### 2026-06-14 — Tombstone pattern for inbound follow mirrors on account deletion
When a user deletes their account, their inbound `users/{uid}/followers/{followerUid}` docs cannot
be deleted by the deleter — Firestore rules gate `delete` on `isOwner(followerUid)`, not the
account being deleted. The correct approach (confirmed in BIN-21) is to leave these docs in place
and filter them as 'ghost' at read time: `!snap.exists()` → `'ghost'` in the profile cache →
`resolveFollowRows` silently drops them. The `deleteAccount` flow only deletes the deleter's
outbound `following` docs AND the mirror `followers` doc on each target's side (which it owns via
`isOwner(followerUid)` where followerUid == the deleting user). Always check both sides of a
mirror relation when adding a subcollection to `collectUserDataSnapshots`.

### 2026-06-14 — docs/data-export-format.md must be kept in sync with BingeExport interface
When adding a field to the `BingeExport` interface in `dataExport.ts`, the matching entry must
appear in BOTH the JSON example block AND the field table in `docs/data-export-format.md`. The
README_TEXT inside `dataExport.ts` also needs a bullet. BIN-21 added `followers` to the interface,
the README_TEXT, and the mapping — but omitted the `docs/data-export-format.md` file. Flag this
class of gap: code + internal README correct, external doc stale.

### 2026-06-20 — Grace-window correctness for reclaimOrphanFollows (BIN-50)
The read-skew false-positive fix in `isReclaimableOrphan` is: condition = orphan AND
`followedAtMs < cutoffMs` (where `cutoffMs = runStart - 24h`). Key invariants verified:
- A user who registers after readAliveUids() will have `followedAt > runStart > cutoffMs`, so
  any follow they appear in is protected. Correct.
- A user deleted long before the run has old follows: `followedAtMs << cutoffMs`. Correctly reclaimed.
- Legacy docs (no `followedAt` field): `followedAtMs === null` → treated as old → reclaimable. Correct
  (legacy docs cannot be fresh-follow false positives because the app always writes `followedAt` now).
- The boundary case `followedAtMs === cutoffMs` returns false (not reclaimable) — the `>=` in
  `candidate.followedAtMs >= cutoffMs` uses a closed boundary. This is the safe direction.
- Genuine orphan leak: the ONLY case where a real orphan escapes is if the endpoint deleted their
  account AND the follow was created in the 24h window before cutoffMs. Because the sweep runs weekly,
  this delays reclaim by one cycle at most. Acceptable trade-off.
- `followedAt` is written via `serverTimestamp()` in `useFollow.ts` — so its value is server-assigned
  and cannot be forged below `runStart` by a misbehaving client, making the grace window reliable.
- The cursor (`snap.docs[snap.docs.length - 1]`) is the last doc of the current page, not the last
  orphan. This is correct — pagination must walk ALL docs, not just orphans, otherwise the cursor
  skips non-orphan docs and the page never advances past the first orphan-free page.
- Termination: the loop breaks when `snap.empty` (zero results) OR `snap.size < PAGE_SIZE` (partial
  page = last page). Both conditions are necessary and sufficient. No off-by-one: a page of exactly
  PAGE_SIZE docs triggers another fetch; if that next page is empty, `snap.empty` catches it.

### 2026-06-21 — airDate + 'T00:00:00' uses local midnight, not UTC; safe only for single-timezone deploys
`new Date(e.airDate + 'T00:00:00')` parses the date string in the LOCAL timezone of the JavaScript
runtime (browser). `new Date('2026-06-21')` with no time component is parsed as UTC midnight by the
spec, but appending `T00:00:00` makes it local midnight. On a machine west of UTC this means a today-airing
episode (airDate = today's date string) appears as "aired" even if the local clock says 23:59 the day
before (because UTC midnight was hours ago). On a machine east of UTC it can lag by hours. For Binge
(Swedish-primary audience, UTC+1/+2) the practical error window is small (1-2 hours per day) and the
fallback is benign (show stays in the row if the override misses it). Flag as advisory. The
`page.tsx` focal filter uses the same `e.airDate + 'T00:00:00'` pattern for consistency — this is
an established codebase idiom, not new debt introduced by this diff.

### 2026-06-21 — QuickAddButton omits totalSeasons/tmdbStatus in markSeen call; this is safe via internal fallbacks
`QuickAddButton` does not have `totalSeasons` or `tmdbStatus` as props (it is a lightweight button
used on discovery surfaces, not title detail pages). When it calls `markSeen({...})` without those
fields, `useMarkSeen` uses `input.totalSeasons ?? current?.totalSeasons ?? null` and
`tvShow.number_of_seasons` (from the TMDB fetch) as the source of truth. For TV, `tvShow` always
provides the authoritative value. For film, those fields are irrelevant (film has terminal 'sedd'
status). The omission is intentional and safe. `StatusButton` does pass them, providing a better
hint when the cache misses. Do not flag QuickAddButton's omission as a bug.

### 2026-07-04 — Always diff the unstaged working tree too, not just --cached, on the exact files under review
When reviewing a staged diff, also run `git diff -- <file>` (no --cached) on each changed file. BIN-417's
`effectiveCost.ts` had a CORRECT staged version (composes via `resolveCampaignCost`, respecting the campaign's
`endDate` for auto-revert) but the working-tree copy on disk had since been edited to
`campaign && campaign.monthlyCost > 0 ? campaign.monthlyCost : ordinary` — which drops the date check entirely,
so a campaign NEVER auto-reverts as long as monthlyCost is positive. This silently reintroduces the exact
staleness bug BIN-396/BIN-417 exist to remove. The staged index was fine (safe to commit as-is), but if anyone
runs `git add` on that path again before commit (common muscle-memory), the buggy version ships with the
review's clean bill of health already recorded. Flag this class of drift as a HIGH-priority alert distinct
from the staged-diff findings — advise discarding/re-diffing the working copy before commit, don't just wave
it through because "the staged version is fine."

### 2026-07-04 — Root tsconfig excludes "functions", but transitively-imported functions/src files still typecheck fine under root compilerOptions
Root `tsconfig.json` has `"exclude": ["node_modules", "functions"]`. This only keeps functions/src OUT of
the initial glob-matched file list — it does NOT stop TypeScript from pulling in a functions/src file that
is `import`ed from an INCLUDED file (e.g. a root-level `*.test.ts` importing `../../../functions/src/x`).
Once pulled in transitively, the file is type-checked using the ROOT tsconfig's `compilerOptions` (lib
dom/dom.iterable/esnext, moduleResolution bundler, target ES2017), not `functions/tsconfig.json`'s
(lib es2022, module commonjs, noUnusedLocals). Verified via `npx tsc --noEmit -p tsconfig.json` after
BIN-420 added a root-vitest test importing two functions/src modules directly — zero errors. Safe pattern
as long as the imported functions file avoids DOM-lib-only APIs and stays firebase-admin-free (see the
existing `*.helpers/logic.ts` firebase-admin-free convention). Do not flag "functions is excluded from
tsconfig" as a reason a cross-boundary import will fail typecheck — verify by running tsc, don't assume.

### 2026-07-04 — Stale vitest transform cache can produce a false-negative `toEqual` failure on freshly-edited const objects; always re-run with a clean cache before reporting a test failure as a real bug
A first `npx vitest run` on `providerAliasParity.test.ts` (BIN-420) failed with the received mirror
missing the just-added `531: 431` entry — even though the source file on disk clearly had it. Re-running
with `--no-cache` (or just a second run after the cache warmed) passed cleanly with all 3 tests green. The
on-disk source was correct throughout; the failure was an artifact of a pre-edit vite/esbuild transform
cache entry for that module path. When a test fails against code you've just read and visually confirmed
correct, re-run with `--no-cache` (or clear `node_modules/.vite`) before concluding there's a real defect —
CI always runs from a clean checkout so this class of staleness is not a production risk, but it CAN
produce a false "this is broken" finding in local review if you stop at the first run.

### 2026-07-02 — Provider catalog price-agent rounds: identity-guard baseline updates are the intended mechanism, not a rubber-stamp
`providers.identityGuard.test.ts` (BIN-406 lineage, see also 0676596/e328afa) iterates a frozen
BASELINE and asserts every baseline tier `id` still resolves in the live `SWEDISH_PROVIDERS` catalog
— so REMOVING a tier (not just renaming/reordering) fails the test unless the baseline is updated in
the same diff. Round-2 Discovery+ restructure (4 tiers → 3, dropping `entry`/`premium`, adding
`standard`) correctly updated the baseline alongside the catalog. This is NOT a smell — the test's own
header comment says exactly this: identity changes must ship with a human ticket (not an unattended
price-only agent run), and the baseline edit IS that sign-off trail. When reviewing a price-agent diff:
confirm (a) the guard baseline changed only because a **structural** identity fact changed (tier
added/removed/renamed), never because someone just wanted the test to pass, and (b) note as a product
aside (not a blocker) that removing a tier id silently reprices any existing user who had
`providerTiers[id] = <removed tier>` — `resolveProviderMonthlyCost`'s orphan-fallback (tier not found →
custom cost → `defaultMonthlyCost`) is the documented, correct landing behavior, but Malin should know
the user-facing number moved.

### 2026-07-02 — First isAds:true catalog entry (Pluto TV) + 0-cost free-status guard: traced clean end to end (BIN-410)
Adding the first `isAds: true` `SwedishProvider` (Pluto TV, id 300, `defaultMonthlyCost: 0`, deliberately
NOT `isFree`) and broadening the advisor's free-status guard from `provider.isFree` to
`provider.isFree || (provider.defaultMonthlyCost ?? 0) === 0` is safe. Traced every consumer:
- `userHasAdsProvider` (useSubscriptionAdvisor ~L157) only flips true for users who actually add Pluto to
  `myProviders` — the ads-bucket (`se?.ads`) only surfaces for THOSE users; existing users see zero change.
  The fallback loop (L171-176, "ads provider in my set even if bucket flag missed it") is redundant-safe
  for Pluto specifically since it IS in `se.ads`, not a separate category.
- The 0-cost guard only changes behavior for providers with `defaultMonthlyCost === 0` — grepped
  `SWEDISH_PROVIDERS` and confirmed exactly two: SVT (520, already `isFree: true`, no behavior change) and
  Pluto (new). No other catalog entry is affected.
- `FREE_PUBLIC_PROVIDER_IDS` and `hasFreeProvider` key on `isFree` only, not cost — Pluto correctly stays
  OUT of the "Gratis just nu" public-service lane (that lane is scoped to license-funded public service,
  not commercial AVOD — confirmed intentional per the code comment at providers.ts:301-304). Correct call:
  conflating tax-funded SVT with ad-funded Pluto in the same "gratis" lane would be a category error even
  though both cost the user 0 kr.
- `cheapestPath.ts` step 1 (`free_public`) filters `subs` (the TITLE's actual `subscriptionProviderIds`)
  by `isFree`, not by cost — so Pluto never wins step 1 (it isn't `isFree`) and can only appear in step 2
  (`owned`) or step 5 (`subscribe`, ranked by `cheapestEntertainmentTier`), and ONLY when Pluto is actually
  in that title's provider list. A 0-cost provider cannot become "cheapest for everything" because the
  whole cascade is gated on the title's real `subscriptionProviderIds`, never on the full catalog.
- `findTopPausable` (useSubscriptionAdvisor.helpers.ts) has its own independent `(p.monthlyCost ?? 0) > 0`
  guard — double protection against a 0-cost provider ever surfacing as a "pause to save" candidate, even
  before the status-guard change. `findCatchupCandidate` separately excludes `status === 'free'`.
- `readableTextColor('#FFE100')` (WCAG relative luminance in ProvidersSection.helpers.ts) computes
  L≈0.751, above the ~0.179 crossover → resolves to `'ink'` (dark text on the bright yellow chip) —
  correct legible contrast, no fix needed.
Pattern for future AVOD/free-tier catalog additions: check (1) ads-bucket gating only activates for
opt-in users, (2) 0-cost guard only affects providers actually at cost 0, (3) isFree-keyed free-lane
logic stays untouched, (4) cheapestPath/pausable logic is gated by the TITLE's real provider list, not
the full catalog, (5) chip color contrast via readableTextColor.

### 2026-07-02 — Reclassifying a provider from 'flatrate' to 'rent' and dropping defaultMonthlyCost is a safe, established pattern
Confirmed by tracing every consumer of `type === 'flatrate'` (ProvidersSection, TillsammansSessionPageClient,
tillsammans/ny/page, OnboardingFlow — all correctly stop offering the reclassified provider as a
subscription pick) and every `defaultMonthlyCost`-optional consumer (`cheapestEntertainmentTierFrom`,
`resolveProviderMonthlyCost`, `franchiseCheapest.pickBestProvider`) — all three already guard with
`?? Number.POSITIVE_INFINITY` / `?? null` because Rakuten/Google/Apple TV have always been `rent` with
no `defaultMonthlyCost`. A provider moving from flatrate→rent (TriArt Play/578, BIN-406) lands on the
exact same pre-existing fallback path; no new undefined-cost class is introduced. The one residual path
worth checking on any future flatrate→rent reclass: if TMDB's own `watch/providers` response still lists
the id under `flatrate` for some title (Binge's local `type` field doesn't change what TMDB reports),
`subForVerdict`/`cheapestPath` can still receive the id as a "subscription" candidate — but `cost:
Infinity` + the `Number.isFinite(cost) ? cost : null` guard in `CheapestPathVerdict` degrades gracefully
to a plain "Finns på X" line instead of showing a broken/undefined price. Confirmed safe; no fix needed.

### 2026-07-04 — Confirmed live: concurrent mutation-testing loop transiently weakens a working-tree file DURING review, then self-reverts
While reviewing BIN-183 (`src/lib/advisor/bundleArbitrage.ts`), `git diff -- <file>` (no --cached) caught the
working tree in three different transient states across ~90 seconds of review — none matching the stable
staged index: (1) `replaced.length < 2` → `< 1` and `savingKr <= 0` → `< 0` (would let a single-service
"downgrade" and a break-even bundle both surface as a false "saving" — confirmed via a real `vitest run`,
3 tests failed exactly as predicted), (2) the final `suggestions.sort(...)` line deleted entirely, (3)
`ageDays > maxAgeDays` → `>= maxAgeDays` in `isBundleStale`. Each mutation reverted on its own within
seconds, and `git show :<file>` (the staged blob) never changed throughout. This is a live confirmation of
the pattern already logged 2026-07-04 above ("Always diff the unstaged working tree too") and of the
"Commit-gate mtime mechanics" memory note: a concurrent mutation-testing reviewer mutates-run-tests-restores
against the SAME working tree a human/agent review is reading, on the SAME machine, with no isolation.
Practical guidance: (a) don't panic-report a working-tree-only defect caught mid-flight — re-diff a few
seconds later and check `git show :<file>` (the index) as the ground truth for what will actually be
committed; (b) DO run `vitest run` against whatever is on disk at the moment, but interpret a failure by
first re-diffing against HEAD/index before writing it up as a staged-diff bug; (c) the one real risk this
creates is exactly the existing HIGH-priority alert: if `git add` is re-run while a mutation is live on
disk, the mutated (buggy) version becomes the new staged index. Always finish a review with `git diff --stat`
empty (working tree == index) immediately before writing the completion marker, and re-run the test suite
one final time at that moment, not from an earlier read.

### 2026-07-04 — Fire-and-forget onSave + immediate setEditing(false) causes a stale-value flash during the Firestore round-trip
BIN-417 Phase B's `ProviderCampaignRow` (ProvidersSection.tsx) calls `onSave({...})` (a promise-returning
prop, `setProviderCampaign(...).then().catch()`) without awaiting it, then synchronously calls
`setEditing(false)`. The "view" mode reads the campaign to display directly from the `campaign` prop
(sourced from `user.providerCampaigns`), which only updates AFTER `updateUserField`'s `await setDoc`
resolves and calls `setUser` (confirmed in AuthContext.tsx: `setUser` runs after the await, not before).
Net effect: on a SUCCESSFUL save, the row flips to view-mode immediately but briefly displays the
PRE-edit value (old price/date, or "+ Lägg till kampanjpris" for a brand-new campaign) for the ~100-300ms
write round-trip, then jumps to the correct value. On a FAILED save, this is actually correct-by-accident
(reverts to old value = accurately reflects that nothing persisted). This is a cosmetic-only issue (no data
loss, self-corrects quickly) — same severity class as the 2026-06-20 "defaultValue on uncontrolled date
input" entry, but here the mechanism is different (controlled remount to a different view, not a stale
uncontrolled input). Flag as medium/advisory, not a blocker. Fix pattern: either await the onSave promise
before flipping `editing` to false (showing a disabled "Sparar…" state on the Save button meanwhile), or
keep a local optimistic-value override until the `campaign` prop catches up. Check for this exact
fire-and-forget-then-flip-view pattern whenever a new inline-edit component wraps a Firestore write that
updates parent state asynchronously post-await.

### 2026-06-24 — parseSearch: Max lookahead gaps for 'sju','åtta','nio','tio' (low severity)
The Max-provider negative-lookahead adds 'fem' and 'sex' to the excluded numerals but leaves
'sju','åtta','nio','tio' unguarded. So 'max sju avsnitt' (at most 7 episodes) would falsely assign
providerIds=[384]. This phrasing is unusual (most Swedish users write digits: 'max 7 avsnitt' which
is already blocked by `\d`). Advisory only; fix by adding `|sju|åtta|nio|tio` to the lookahead
if query logs show this pattern.

### 2026-06-27 — weeklyDigestNotify: dedup marker set AFTER content check + inbox write is correct and intentional
`processUser` checks `hasDigestContent` FIRST, then reads `weeklyDigestState/{uid}.lastSentDate`.
An empty week therefore never burns the marker, so the next non-empty Monday still fires.
A same-day Cloud Scheduler retry (at-least-once delivery) is caught by the marker read AFTER the
inbox doc write — the inbox doc uses `merge: true` with a deterministic id (`weekly-digest-${runDate}`)
so a retry write is idempotent. A send-but-no-marker crash (between `sendPushToUser` and
`stateRef.set`) results in a duplicate push but no duplicate inbox card (the merge overwrites).
This is the same at-most-once-push, exactly-once-inbox contract as priceDropNotify and rotationReminderNotify.

### 2026-06-27 — withinDays boundary is INCLUSIVE in buildLeavingDigest (daysLeft > withinDays excludes day 15+)
`daysLeft > withinDays` where `withinDays=14` keeps daysLeft 0..14 inclusive (15 days of coverage
counting today). This is correct for a "lämnar snart" digest run at Monday 09:00: a title leaving
next Sunday (6 days) and a title leaving two weeks from Monday (14 days) are both included. A title
leaving 15 days out is excluded. The boundary is deliberate and matches the constant name.
The tests cover daysLeft=20 (> 14, excluded) and daysLeft=5/9 (included). No test covers the
exact boundary (daysLeft=14) — advisory only; the expression is unambiguous.

### 2026-06-27 — weeklyDigestNotify: countNewArrivals reads ALL notifications createdAt >= cutoff, then code-filters kind
The query on `users/{uid}/notifications` uses only `createdAt >= cutoff` (single-field index, no
composite index needed). The in-code filter `kind === undefined || kind === 'provider_available'`
then drops `episode_release` and `weekly_digest` docs. The cost is: all notification docs in the
last 7 days are read per opted-in user, not just provider_available ones. For a user with many
episode_release notifications this reads more docs than strictly necessary. At typical Binge scale
(tens of notifs/user/week) this is immaterial. A composite index on (createdAt, kind) would allow
filtering server-side, but the author correctly avoids introducing a new composite index. Advisory.

### 2026-06-27 — src/app/billigaste/[slug]/ and src/app/forsvinner/[id]/ are real static routes; no DynamicRouter or firebase.json changes needed
Both routes live under `src/app/billigaste/` and `src/app/forsvinner/` as proper App Router segments
(NOT under `[...path]`). With `dynamicParams = false` + `generateStaticParams`, Next.js emits one
HTML file per listed param at build time and does NOT render pages for unlisted ids. Those unlisted
ids still land in the SPA catch-all via the `** → /_/index.html` firebase.json rewrite, but they
will see the DynamicRouter's fallback (NotFound), which is the correct behavior. DynamicRouter.tsx
dispatch is ONLY needed for paths under `src/app/[...path]/page.tsx`. Confirmed for BIN-178.

### 2026-06-27 — leavingLabel uses T00:00:00 (local midnight); same established codebase idiom as calendar
`new Date(\`\${iso}T00:00:00\`)` in `ForsvinnerListClient.leavingLabel` parses the leaving date as local
midnight. See the 2026-06-21 entry — this is an established codebase idiom. For Swedish users
(UTC+1/+2) the practical error window is ±1–2 hours around midnight, affecting only the display
string (e.g. "31 aug" vs "1 sep") on boundary days. This is a cosmetic advisory, not a blocker.
The "pure UTC" fix would be `T00:00:00Z` but the `toLocaleDateString` output would then also need
UTC-based extraction. Flag only if boundary-day display is reported by users.

### 2026-06-27 — Functions canonicalProviderId is a module-local duplicate of src/lib/tmdb/providers.ts
`functions/src/availableNotify/logic.ts` exports its own `canonicalProviderId` which is used by
`functions/src/leavingRollup/logic.ts`. The client-side `src/lib/tmdb/providers.ts` exports a
different `canonicalProviderId`. Both must be kept in sync (same alias table) when new provider
aliases are added. This is pre-existing split (functions cannot import from src/lib due to the
monorepo boundary). Flag when reviewing provider alias changes: update BOTH files.

### 2026-06-27 — leavingRollup: byProvider doc size grows with withinDays * distinct providers * capped titles
The `streamingLeaving/current` doc stores up to `capPerProvider` (80) LeavingEntry objects per
provider (each ~50 bytes: 3 fields). With ~12 SEO providers × 80 titles × 50 bytes ≈ 48 KB raw —
well under the 1 MB Firestore document limit. But if the provider set expands significantly or
capPerProvider is raised, monitor doc size. The `useStreamingLeaving` hook reads the entire doc
(not a subcollection) so ALL provider arrays are fetched even when only one is needed; the client
then slices by providerId. For the current 12 providers + 80 cap this is fine (~48 KB, 1h cache).
Reassess if provider count × cap exceeds ~500 KB.

### 2026-06-27 — billigaste/[slug]: empty-collection notFound() is safe but fires only after all per-film fetches complete
When `getCollection` succeeds but `parts` is empty (e.g. a TMDB collection with no released films),
the `for` loop over `released` runs zero iterations, `rows` is empty, and `notFound()` is called AFTER
the (empty) per-film fetch loop. This is correct but worth noting: the `rows.length === 0` guard
fires after the per-film fetchForBuild loop, which means for a collection with only unreleased films
(all future release dates) the build does per-film fetches and THEN calls notFound. Since the
released filter applies first, the loop body is never entered and there are no per-film fetches —
so the actual cost is zero extra fetches. The guard ordering is fine.

### 2026-06-27 — motnChanges partial-page contract: null only when zero pages accumulated; partial pages returned as-is
`fetchExpiringChanges` returns `null` only when the FIRST page fails (or when MOTN_API_KEY is absent).
If at least one page has been accumulated before a fetch error, it returns `{ changes, shows }` with
whatever it has so far. This is the correct "partial is better than nothing" contract. The caller
(`index.ts`) treats a `null` result as "leave prior rollup intact" — which is the correct fallback
for a total failure. A partial result (some pages) produces a shorter-than-normal rollup but still
overwrites the prior doc. This is intentional: a partial list is fresher data than a week-old full list.
Do not flag the asymmetry (null = skip write; partial = allow write) as a bug — it is the documented design.

### 2026-06-27 — MOTN_SERVICE_TO_TMDB values must be canonical, not alias ids
All values in `MOTN_SERVICE_TO_TMDB` in `functions/src/leavingRollup/logic.ts` must be canonical
TMDB provider ids (i.e. they must pass through `canonicalProviderId` unchanged). The `byProvider` map
is keyed by `pid = canonicalProviderId(mapped)` AFTER the lookup, so even if an alias value were used
here, it would be re-canonicalized before storage. Confirmed as of 2026-06-27 that all 16 entries are
already canonical. When adding new service mappings: check against `ALIAS_TO_CANONICAL` in
`functions/src/availableNotify/logic.ts` — if the id appears as a KEY there, use the VALUE instead.

### 2026-06-27 — weightForItem avbruten-first ordering: status guard MUST precede rating branch
`weightForItem` in `vector.ts` now checks `item.status === 'avbruten'` BEFORE the `item.rating != null` branch.
This ordering is load-bearing: if rating were checked first, a rated-and-abandoned title would return a positive
weight `(rating/10)*2` and never reach the penalty. The threshold rule (≥4 → 0, else −0.5) is the correct
middle ground between "rating wins" (bug) and "flat −0.5" (over-correction). The threshold 4 aligns with
`classifySeeds`' `it.rating >= 4` strong-seed boundary in `seedAnalysis.ts` — keep them in sync.
Tests must use in-scale ratings (0.5–5); off-scale values like `rating: 8` encode the wrong domain and should
be replaced, not kept as "intentional" test data (the old test at vector.test.ts:62 was doing exactly this).

### 2026-06-27 — buildBackfillUpdate extracted to helpers: re-export from backfill.ts is redundant but harmless
`backfill.ts` re-exports both `buildBackfillUpdate` and `BackfillUpdate` from `backfill.helpers.ts`. No external
consumer imports these from `backfill.ts` — `TasteDataSection.tsx` only imports `backfillGenreIds` and
`BackfillProgress`. The re-exports are future-proofing (consumers of the public module surface get the type too)
but create a minor dual-import path. Do not flag as a bug; flag as advisory if re-exports proliferate.

### 2026-06-28 — stockholmDayId: Intl.DateTimeFormat sv-SE + Europe/Stockholm is the canonical timezone-aware day key pattern
`new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date)` is correct for
producing YYYY-MM-DD keys aligned to Stockholm wall-clock time (CET=UTC+1, CEST=UTC+2). The sv-SE
locale natively outputs YYYY-MM-DD with no further slicing needed. Node 22 (Firebase Functions) has
full ICU so `Europe/Stockholm` is always available. All day-keyed docs (stats writer, per-user
throttle, global budget, dashboard reader) must share the same helper — never reintroduce a local
`toISOString().slice(0,10)` alongside it.
DST-crossing test pattern: supply explicit UTC Date objects at hours that cross midnight locally
(23:30Z in winter = 00:30 Stockholm next day; 22:30Z in summer = 00:30 Stockholm next day). The
spring-forward edge (2026-03-29 01:00Z) is not tested but Intl handles it correctly by design.
Note: test description correctness matters — "00:30Z winter → prev day" in the title of test 4 of
logic.test.ts is self-contradictory (the assertion expects the same day, not the prev day). The test
value is correct; the label is wrong. Flag such contradictions in test descriptions as they mislead
future readers of failing-test output.

### 2026-06-28 — parseSearch Max lookahead: fixed-string alternatives in (?!\s*(?:...)) have no backtracking risk
The `\bmax\b(?!\s*(?:\d|word1|word2|...))` pattern is safe from catastrophic backtracking:
- The outer `\s*` is bounded by the word boundary before it; backtracking from `\s*` is O(whitespace length), always short.
- Each alternative inside the non-capturing group is a fixed string with no nested quantifier — no ReDoS risk.
- `hbo max` (literal) fires before `\bmax\b` in the alternation; the lookahead never applies to it.
- When adding new words to this lookahead, confirm they are fixed strings (no `*`/`+`/`?` inside) and that they don't introduce any alternation with shared prefixes that could cause excessive backtracking.
The gap words (sju|åtta|nio|tio) noted 2026-06-24 are still pre-existing; do not re-flag unless adding them to the lookahead is specifically requested.

### 2026-06-28 — getByStatus useMemo in useCalendar: dep [getByStatus] is complete and correct
`getByStatus` in WatchlistContext is `useCallback(..., [items])` — a new reference only when `items`
changes. Wrapping `getByStatus('mina','tv')` and `getByStatus('vill_se','movie')` in
`useMemo(..., [getByStatus])` is therefore a correct and complete dep array: the memo invalidates
exactly when the item list changes, not on every parent render. No `eslint-disable` is needed (the
function reference IS the dependency). The downstream fingerprint memos (`useMemo(() => minaTV.map(i => i.tmdbId).join(','))`)
are complementary: they stabilize the TMDB-id join-string when `items` changes in a way that doesn't
affect the relevant id set (e.g. a rating update). Do NOT collapse those memos into the outer
`[minaTV]` dep — they serve a different purpose (stable fanout key, not stable source array).

### 2026-06-28 — cineasterna resolveBatch: final checkpoint lives in index.ts, not in resolveBatch itself
When reviewing the resolveBatch extraction (BIN-333), the JSDoc comment "no final checkpoint after
the loop (preserved)" is accurate for resolveBatch.ts itself. The final checkpoint write lives in
index.ts at line 140 (`await mapRef.set({ map: imdbMap })`) immediately after the catalog write —
it was already there in the original inline loop and is NOT inside resolveBatch. When reviewing
future extractions of this pattern, always check that the call-site (index.ts) retains any
post-loop writes that were in the original surrounding function, not just the loop body.

Also confirmed: `result ?? null` is the correct storage idiom because `'NOT_FOUND'` is truthy so
nullish coalescing correctly passes it through; `null ?? null` gives `null`. The `result !== null`
count guard correctly counts both numeric IDs and `'NOT_FOUND'` as terminal progress. Both semantics
must be preserved in any future refactor of this accumulation loop.

### 2026-06-28 — ageConfirmedAt (and future profile timestamp fields) must be added to docs/data-export-format.md profile field table
When a new field is written to `users/{uid}` in both `ensureUserProfile` (new-doc branch) and
`register()`, it is automatically included in the GDPR export because `buildUserExport` passes the
full `profileSnap.data()` object through as-is (no field-level projection). However, the field table
in `docs/data-export-format.md` (line 45) is a static list and does NOT update automatically.
`ageConfirmedAt` was added to Firestore and to `UserProfile` in BIN-348 but not listed in the doc.
Rule: whenever a new field is added to `users/{uid}` writes, add it to (a) `UserProfile` interface
in `domain.ts` (done), (b) the `collectUserDataSnapshots`/`buildUserExport` paths if it needs special
handling (none needed — profile is passed through whole), AND (c) the `docs/data-export-format.md`
profile field table + the relevant `README_TEXT` bullet if user-facing. The same class of gap bit
followers in the 2026-06-14 entry.

### 2026-06-28 — cheapestEntertainmentTier: isSubDefault condition guards tierLabel; cost===def means no label (correct)
`isSubDefault = tier != null && def != null && cost < def` in cheapestPath.ts rung 5.
Three cases to verify:
- `tier != null, cost < def`: label surfaced (Disney+ Basic 69 < 109 → "Standard med reklam"). Correct.
- `tier != null, cost === def`: no label (Crunchyroll Fan 89 = def 89 → plain "89 kr/mån"). Correct: the cheapest tier IS the advertised price, no "from" copy needed.
- `tier == null` (no tiers, Prime fallback): isSubDefault=false regardless → no label. Correct.
Never fires when `getProvider` returns undefined (def=undefined → def != null is false).
Sort comparator on cheapestEntertainmentTier().cost is safe for Infinity: unknown providers sort last.
The `kind?: 'sport'` optional field on ProviderTier is the filter pivot — absent means entertainment tier; present means excluded from cheapest-path calculation and from any label.
The functions/src side has NO ProviderTier usage — no cross-boundary sync needed for this change.

### 2026-06-28 — withRetry in build-time page.tsx: lastErr is always defined before throw; skip-wait-on-final-attempt is correct
`withRetry(fn, attempts)` always assigns `lastErr = e` in the catch before the loop continues,
so `throw lastErr` at the end of the function is never reached with an undefined value — the loop
only exits the for-body via `return` (success) or exhaustion, and exhaustion requires at least one
catch. The guard `if (i < attempts - 1) await setTimeout(...)` correctly skips backoff after the
last attempt, avoiding a dead delay before the final throw. Backoff `300 * (i+1)` ms is linear
(not exponential) — appropriate for a build context where total time matters. Collection fetch
uses 4 attempts (a miss triggers notFound on the whole page); per-film uses 2 (graceful degradation,
only provider data is missing). fetchForBuild caches on first success so any retried success also
populates .tmdb-cache/ for future builds. This pattern is correct; confirm `lastErr` initialisation
+ skip-wait guard whenever withRetry is copied to other build-time routes.

### 2026-06-28 — Semaphore abort correctness: onAbort must NOT call release(); inFlight is never incremented for a queued waiter
In `createSemaphore`, a queued waiter's `onAbort` handler removes the `grant` entry from `waitQueue`
via `splice` and calls `reject(...)` — it does NOT decrement `inFlight` or call `release()`, because
`inFlight` is only incremented inside `grant()`. The rule: a caller only holds a slot (and must call
`release()`) when `acquire()` resolves. A rejection (either immediate pre-abort or from `onAbort`)
means no slot was reserved. In `client.ts`, the `await tmdbSemaphore.acquire(opts.signal)` lives
OUTSIDE the `try { ... } finally { tmdbSemaphore.release(); }` block — so an abort rejection skips
the `finally` correctly. Verify this placement whenever moving the acquire/try boundary.
Also confirmed: if `onAbort` splices the only waiter out before `release()` fires, `release()` calls
`waitQueue.shift()` → `undefined` (no-op), but `inFlight--` still runs, correctly freeing the slot
for the next `acquire()` call.

### 2026-06-28 — stats.test.ts: WatchlistItem.rating is 0.5–5 (not 0–10); out-of-scale test values are a convention violation
`computeProfileStats` uses `item.rating / 10` as weight. Tests passing `rating: 8` or `rating: 9`
use wrong-domain values (watchlist rating is 0.5–5, display is ×2 = 0–10). For `recent30` counting
tests the assertions pass regardless (only truthiness checked), but for weight tests `rating: 8`
encodes `weight: 0.8` via the wrong formula. Pre-existing at stats.test.ts:54 (`rating: 8`); new
BIN-339 tests continue the pattern. Fix: use `rating: 4` (in-scale) instead. Do not add new
out-of-scale rating values to stats tests.

### 2026-06-28 — vi.mock() intercepts dynamic import() in Vitest; static mock covers runtime dynamic imports
`vi.mock('@/lib/firebase/groups', ...)` at the top of WatchlistContext.test.tsx intercepts both
static and dynamic imports of that module. The production code uses `void import('@/lib/firebase/groups').then(...)`.
Vitest's module registry catches all import paths for mocked modules, so the mock is effective.
Use `vi.waitFor(...)` (not synchronous `expect`) when asserting on values set inside a `.then()` callback,
since the dynamic import resolution + callback execution is microtask-async.

### 2026-06-28 — dirty ref in useReviewSocial: reset at effect top is correct; cancelled guard makes dirty redundant for reviewId-change case
The `dirty.current = false` reset at the top of the `useEffect` body (before the async count fetch) is
the correct placement. When `reviewId` changes, cleanup sets `cancelled = true`, then the new effect run
sets `dirty.current = false` before dispatching the new count fetch. The old in-flight fetch is
suppressed by `!cancelled` (the `!dirty.current` check is an additional guard that is redundant in the
reviewId-change case but harmless). The critical invariant: `dirty.current = true` is set in `toggle()`
BEFORE the optimistic state update, so a late mount-count response landing AFTER a toggle is always
blocked. No stale-true leak across reviewId changes because the effect reset runs synchronously before
any new async work. Confirm this ordering whenever `dirty` is checked in new async paths added to this hook.

### 2026-06-28 — follow-count invalidation: invalidateCounts after await batch.commit() is correct; no invalidation on batch failure
In `useFollow.ts`, `invalidateCounts(targetUid)` is called AFTER `await batch.commit()`. If the batch
write fails (throws), `invalidateCounts` is never called — correct, since the Firestore counters were
not updated. The query keys match exactly: `useFollowerCount` registers `['follower-count', uid]` and
`useFollowingCount` registers `['following-count', uid]`; `invalidateCounts` invalidates
`['follower-count', targetUid]` and `['following-count', uid]`. Both sides covered. Confirmed:
`invalidateCounts` is called unconditionally after success (no if-guard needed), since the
`lazySubscribe`-driven `followingUids` state is the authoritative local truth and invalidation only
affects the server-aggregate count queries.

### 2026-06-28 — async onChange calling async fn without void: floating promise, safe when inner fn is fully try/catch wrapped
`onChange={() => toggleCountry(code)}` where `toggleCountry` is `async` returns the Promise from the
outer arrow function (implicit return). React's `onChange` ignores the return value, so the Promise
floats. There is no `no-floating-promises` ESLint rule in the project. This is safe ONLY because
`toggleCountry` fully wraps in `try/catch` — no rejection can escape. The technically correct pattern is
`onChange={() => void toggleCountry(code)}` or making the outer lambda `async` and awaiting. Do not
flag as a blocker when the async callee is fully try/catch wrapped; flag as advisory and suggest `void`.

### 2026-06-28 — season-done regression guard scope: only scans globals.css + tailwind.config.ts, not .tsx component files
The BIN-324 guard in `consistency.test.ts` checks only the two files where the raw literal previously
lived. It does NOT scan `.tsx`/`.ts` component or hook files. If a future developer hardcodes
`oklch(0.55 0.13 145)` in a component file, the test will not catch it. This is an advisory gap.
The guard is not vacuous (it caught the real migration) but is incomplete. A future hardening pass
should broaden `files` to `glob('src/**/*.{ts,tsx,css}')` or similar. Do not block on this — the
current diff fully removed all prior occurrences (confirmed by global grep).

### 2026-06-28 — data-retention-policy.md followers line is an ambiguous over-claim; must be read with the later explicit callout
`users/{uid}/followers/*` appears in the "Hård radering" list with the note "(matchande följ-relationer på andra håll)".
In practice `deleteAccount` does NOT delete the deleting user's inbound `followers/` subcollection — those docs are
owned by each follower (rules: `isOwner(followerUid)`) and can only be deleted by the follower. The code only deletes
the user's OUTBOUND `following/` docs + the mirror `followers/{id}` doc on each TARGET's side (where the deleting user
IS the document owner, because doc-id == their uid). The same policy doc correctly documents this design in the
"Export- vs raderingstäckning" section (line 132–137). When reviewing doc-changes that update the retention list,
verify that "followers/*" is NOT listed as fully deleted — it is a misleading entry carried over from a pre-cascade
draft. The correct description is: "inkommande `followers/*` raderas INTE (ägs av följarna); dangling-refs filtreras
lazy och städas av reclaimOrphanFollows".

### 2026-06-28 — dependabot groups: `minor-and-patch` group overlaps `firebase-functions` group; Dependabot assigns each update to only one group (first match wins)
When a Dependabot `groups:` block has two entries that both match a dependency (e.g. `firebase-admin` matches both
`firebase-functions.patterns: [firebase-admin]` AND `minor-and-patch.update-types: [minor, patch]`), Dependabot
assigns the PR to the FIRST matching group in document order. In the `/functions` block, `firebase-functions` is
listed before `minor-and-patch`, so minor/patch bumps of firebase-admin and firebase-functions are grouped together
under `firebase-functions` — NOT split across both groups. The `minor-and-patch` group catches other deps
(typescript-types, etc.). This is the intended behavior and is safe. Confirm document order whenever adding a new
group that might overlap existing patterns.

### 2026-06-28 — preview.yml lint/typecheck/test steps added before Build; env vars not needed for those steps
The three new quality-gate steps (Lint, Typecheck, Test) run AFTER `npm ci` and BEFORE Build. They do NOT need the
`NEXT_PUBLIC_*` env vars — those are only needed at build time (Next.js bakes them into the JS bundle). Running
the gates without the env vars is correct: lint/typecheck operate on source text, and Vitest mocks Firebase/TMDB.
If a future gate step actually needs a build-time var (e.g. a test that imports a module that reads env vars at
module-load time), add the var to that step's `env:` block — do not promote it to the whole job level.

### 2026-06-28 — titleRatings today() uses UTC; omdbBudget doc key can misalign with stockholmDayId pattern (pre-existing advisory)
`functions/src/titleRatings/index.ts` has `function today(): string { return new Date().toISOString().slice(0, 10); }`.
This existed before BIN-346 (confirmed via `git show HEAD:...`). The BIN-346 transaction reads/writes `omdbBudget/{today()}`
and the new `alertedAt`/`capLoggedAt` flags on the same doc. The `stockholmDayId()` helper (from `functions/src/askbinge/logic.ts`)
is the canonical timezone-aware day-key pattern (2026-06-28 entry), but `omdbBudget` has ALWAYS used UTC-based `toISOString`.
Practical impact: at 23:00–23:59 UTC (= 00:00–00:59 CET winter / 01:00–01:59 CEST summer), a new per-day budget doc opens
1–2h BEFORE midnight Stockholm time — letting the budget reset a bit early for late-night users. For a daily cap this is
benign (resets slightly early, never late). Do NOT flag as a blocker; flag as advisory only if titleRatings budget behavior
is ever reported as surprising around midnight. Do not silently "fix" it without aligning all omdbBudget readers (they all
call today() locally — no shared reader yet). The `today()` calls in the post-transaction log messages (lines 83, 87) re-call
today() rather than capturing it at transaction time — in theory the date could flip across UTC midnight between budget key
and log string, but the probability is negligible and the effect is cosmetic (wrong date in log text only).

### 2026-06-28 — evaluateOmdbBudget flags persisted in same transaction as count; at-most-once guarantee even on Function retry
In `titleRatings/index.ts`, the transaction atomically writes `count`, `alertedAt`, `capLoggedAt` (whichever apply) in
`tx.set(budgetRef, patch, { merge: true })`. The `decision` object is returned and the side-effects (`logger.warn`,
`notifyOmdbBudgetApproaching`, `logger.error`) fire AFTER `runTransaction` resolves. On a Cloud Functions retry the
transaction reads the already-persisted flags (`alerted: Boolean(b.get('alertedAt'))`, `capLogged: Boolean(b.get('capLoggedAt'))`),
so `evaluateOmdbBudget` returns `fireAlert: false`/`fireCapLog: false` and neither side-effect fires again. The once-per-day
guarantee holds under retry. Count is not double-spent either: if the transaction committed but the rest of the function
crashed, the retry sees an already-incremented count (correct — the slot WAS reserved). This is the canonical at-most-once
pattern for Functions callables with Firestore-backed budget docs.

### 2026-06-28 — AbortSignal.timeout() propagates as AbortError into the catch block at the call-site; no new unhandled path
`AbortSignal.timeout(N)` causes `fetch()` to reject with a `DOMException { name: 'TimeoutError' }` (or `AbortError` in older
runtimes) after N ms. In Node 18+ (and Node 22 on Firebase Functions), this rejection is caught by the existing `catch (err)`
block surrounding each fetch in cineasterna/api.ts, episodeNotify/tmdb.ts, returnNotify/tmdb.ts, availableNotify/tmdb.ts,
and titleRatings/index.ts. All five catch blocks already degrade: return null / return [] / rethrow as HttpsError.
No new unhandled rejection path is introduced. `res.json()` is called AFTER `await fetch(...)` succeeds — if fetch() times
out, res.json() is never reached, so streaming body timeouts (body download phase) are not covered by the signal. For the
expected response sizes (TMDB metadata ~4KB, OMDb ~1KB, Cineasterna token ~tiny), body download is negligible and this gap
is acceptable. For the 10k-row Cineasterna catalog body: the 90s signal covers fetch initiation and headers; the body
`await res.json()` is NOT signal-gated. If the portal sends headers quickly but streams the body slowly, the function could
still block on `parseTitles(await res.json())`. This is a known residual gap — acceptable at 10k JSON rows (<<1s to receive
once headers arrive on a stable connection) but worth noting if the catalog grows.

### 2026-06-28 — combobox "Visa alla" as role=option is unreachable via arrow-key navigation when it is not in the rows array
In SearchDropdown (BIN-338), the "Visa alla" link has `role="option"` and `id="search-opt-showall"`.
The `rows` array only contains user and title entries; the ArrowDown handler clamps to `rows.length - 1`.
Therefore `activeIndex` can never reach the "Visa alla" row via keyboard, and its `aria-selected={false}`
is always the permanent state. AT virtual cursor users can still navigate to it as a focusable link.
The practical impact is: keyboard-only combobox users cannot arrow-key to "Visa alla" — they must Tab
or use the Enter-at-no-active-index path (which also routes to /search). Flag as medium when reviewing
combobox keyboard patterns: every `role="option"` should be reachable via Up/Down or documented as
intentionally excluded from arrow-key navigation. The fix is either (a) add a synthetic `{ kind: 'showall' }`
entry to `rows` and handle it in the Enter handler, or (b) change "Visa alla" to `role="presentation"` +
a plain link (since it is always accessible anyway as a link and is not truly an "option" in the listbox sense).

### 2026-06-28 — onCancelRef pattern in ConfirmDialog: ref updated in effect (not during render); [] dep on mount effect is correct
`useEffect(() => { onCancelRef.current = onCancel; }, [onCancel])` updates the ref AFTER render via
the effect queue — not during render. The main mount effect (`[]` deps) reads `onCancelRef.current` at
event time, which is always the latest `onCancel` prop value because the sync-effect fires before the
browser paints. This avoids the focus-flicker caused by the mount effect re-running on every `onCancel`
identity change. The pattern is correct. Verify: any `useRef` updated inside a `useEffect` is safe to
read in another effect's event handler — the update effect fires first (in registration order for same-dep
changes, and definitely before user interaction can occur).

### 2026-06-28 — aria-atomic=false on polite live region: correct for per-item toast stacks
`aria-atomic="true"` on a region causes AT to re-read the ENTIRE region contents on any mutation.
For a toast stack (multiple coexisting toasts), this means adding a second toast causes a re-read of
the first. `aria-atomic="false"` (the default, but explicit here) causes AT to announce only the
changed subtree — the new toast `<div>` node. This is the correct setting for a stacked notification
region. The BIN-325 change from "true" to "false" is semantically correct and well-tested.
Only use `aria-atomic="true"` when the region is a single coherent unit that must be read as a whole
(e.g. a progress indicator: "3 av 10 filer uppladdade"). For append-only status stacks, always use "false".

### 2026-06-29 — dropFromHighPct in PriceHistoryStatRow describes lowest-to-high gap, NOT current-to-high; caption is misleading
`computePriceStats` computes `dropFromHighPct = round((1 - lowest/highest) * 100)` — the discount of
the LOWEST price ever seen from the HIGHEST. In `PriceHistoryStatRow`, the caption `▼ ${dropFromHighPct}% från högsta`
appears when `!atLowest` and looks like it describes the CURRENT price ("Nu") but actually describes the
LOWEST price row. Example: Nu=35, Lägst=29, Högst=49 → caption says "▼ 41%" but current is only 29% below high.
Medium finding (misleading to users, not a crash). Fix options: (a) compute `currentDropPct = round((1-current/highest)*100)` and
use that in the caption, OR (b) relabel to reference the lowest price explicitly ("Lägst är N% under högst").
The `atLowest` branch ("Lägsta priset hittills sett") is correct because current === lowest there.
The stat values themselves (current/lowest/highest) are all computed correctly.

### 2026-06-29 — MOTN daily-budget pattern: reserve-in-transaction before call, burn-to-cap on 429, UTC day key (BIN-320)
The canonical pattern for a Functions scheduler that must not exceed a vendor's daily call quota:
1. **UTC day key** (`new Date(nowMs).toISOString().slice(0, 10)`) — must match the vendor's reset clock, not Stockholm wall time. The comment MUST explain this deliberately avoids the Stockholm dayId used elsewhere in the codebase. Never silently "harmonize" these two keys.
2. **Pre-flight non-transactional read** — `budgetRef.get()` before the loop is a fast-fail that avoids even loading the work set when the cap is already hit. It is intentionally NOT a transaction: a concurrent run that passes the pre-flight check will still be stopped by the per-title transaction inside the loop. The benign TOCTOU is: two concurrent function invocations both pass the pre-flight check and each start spending slots, but the per-title transaction is the real serialization point.
3. **Per-title transaction** — `db.runTransaction(tx => { read count → reserveSlot → conditional write })` is the serialization point. Only increments on grant; denied titles do NOT change the counter. `break` on denial stops the run.
4. **Never refunded on failure** — the slot is reserved BEFORE `fetchOffers`. A crash, 404, or network error after reservation does NOT decrement the counter. The comment "vendor counts the request, not the success" must be present.
5. **429 burns the bucket to cap** — `budgetRef.set({ count: HARD_DAILY_CAP })` without a transaction is correct here: the worst case is another run reads a stale count < HARD_DAILY_CAP in the next few milliseconds and reserves one more slot (still within the 10-call buffer vs 100 vendor limit). Using a transaction for the burn would be safer but is unnecessary given the buffer. The burn is a direct `.set()` (not a transaction), then `break`.
6. **priceHistory reads are Firestore, not MOTN** — `histRef.get()` and `histRef.set()` are inside the `if (result !== null && result !== RATE_LIMITED)` branch (after the MOTN call succeeds), so they do NOT consume MOTN quota and are correctly outside the reserve path.
7. **Idempotency window composes correctly** — the 20h guard (`streamingHealth.current.lastRunAt`) fires BEFORE the budget check, so a same-day Scheduler retry skips the budget read entirely. The two guards are orthogonal: 20h prevents duplicate full runs; the budget counter prevents quota overrun when a crash-and-retry happens outside the 20h window.
8. **HARD_DAILY_CAP (90) > DAILY_BUDGET (85)** — the 5-slot gap between DAILY_BUDGET (selectRefreshBatch cap) and HARD_DAILY_CAP (transaction cap) means a normal run reserves at most 85 slots; the extra 5 absorb crash-retry scenarios where the first run spent N<85 before crashing and the retry resumes spending from N.

### 2026-06-29 — resolveBatch final-flush guard: `newlyResolved > lastCheckpointed` is the correct sentinel
BIN-351 adds a post-loop `if (newlyResolved > lastCheckpointed)` flush. Key properties to verify:
- **No double-flush:** when the loop's last in-loop checkpoint fires at exactly `newlyResolved` (e.g. 108 for a 108-title batch), `lastCheckpointed === newlyResolved` after that iteration, so the post-loop guard is `108 > 108` = false. No extra write.
- **Flush on sub-interval remainder:** 60 titles, interval 50 → in-loop at 54, then `lastCheckpointed=54`. After the loop `newlyResolved=60`, `60 > 54` = true → writes 1 final checkpoint at 60.
- **No flush on zero progress:** all-cached batch: `newlyResolved=0`, `lastCheckpointed=0`, `0 > 0` = false. Correct.
- **No flush on all-null (transient) batch:** all resolvers return null → `newlyResolved=0` → same as zero-progress case.
- The guard is `>` (strict greater-than), NOT `>=`. `>=` would write a spurious checkpoint on the all-cached case.
- `lastCheckpointed` must be reset to `newlyResolved` inside the post-loop block (done) to keep the return-value `checkpoints` accurate.

### 2026-06-29 — BIN-292 createReport still forwards client targetOwnerUid to callable; server ignores it but the param is vestigial
`createReport` in `src/lib/firebase/reports.ts` still accepts `targetOwnerUid: string` (required) in its
params type and still includes it in the callable payload (`targetOwnerUid: params.targetOwnerUid`).
The server-side `validateReportInput` intentionally drops it, so the framing vector is genuinely closed —
the stored doc never reflects the client value. However: (1) the `createReport` signature forces all
call-sites (`UgcActionsMenu`, `ReviewList`) to pass a valid-looking owner uid even though it is ignored,
creating dead surface area; (2) if a future dev misreads the code and assumes the server uses it, they
may introduce a regression. The clean follow-up is to remove `targetOwnerUid` from `createReport`'s
params type (or mark it `@deprecated`) and strip it from the payload object. This is advisory (no
security or runtime impact today) but worth doing in the same BIN or a tidy-up pass.

### 2026-06-29 — expiredInsightDocIds UTC-day cutoff: Date.parse + Z suffix is the correct pattern for pure functions
`Date.parse(\`\${todayIso}T00:00:00Z\`)` parses `todayIso` as UTC midnight, then subtracts `retentionDays * 86_400_000` ms to compute the cutoff ms, then `new Date(cutoffMs).toISOString().slice(0,10)` produces the cutoff date string. This is UTC-safe:
- `86_400_000` is exactly one UTC day — no DST slippage.
- Comparing ISO date strings lexicographically is chronologically correct for `YYYY-MM-DD` format (no locale).
- The function's contract is `id < cutoff` (strict less-than), so a doc exactly at the cutoff date is KEPT.
- `'daily'` and any non-date id (`/^\d{4}-\d{2}-\d{2}$/` regex test fails) are always excluded.
- Note: `dateId` passed in `rollupInsights` was previously UTC-based (`rollup.computedAt.slice(0,10)`); BIN-350 switched it to `stockholmDayId(new Date(rollup.computedAt))`. The retention sweep remains consistent: both the doc keys and `todayIso` are Stockholm-keyed after the migration, and the ±1–2h UTC offset on a 90-day retention window rounds to zero net effect on the cutoff date string. The forward-looking warning in this entry has been resolved — no separate change to `expiredInsightDocIds` is needed.
- `listDocuments()` returns refs for ALL docs including `'daily'`; `expiredInsightDocIds` filters `'daily'` out correctly.

### 2026-06-29 — Re-exporting a shared util via a module that already imports it: the re-export keeps caller paths stable
When a function is moved from module A to a shared `util/X.ts`, adding `export { fn } from '../util/X'` to module A means all existing importers of `A.fn` — including tests — get the identical function through the re-export chain without any import-path changes. This is the correct migration pattern (BIN-350: `stockholmDayId` moved from `askbinge/logic.ts` to `util/dayId.ts`, re-exported from `askbinge/logic.ts`). The re-export is a zero-cost indirection; tests that import from `./logic` get the canonical implementation. Confirm the re-export is a bare re-export (`export { fn } from '...'`) not a wrapper — wrappers would duplicate behavior and could drift.

### 2026-06-29 — BIN-358 targetOwnerUid removal: outer prop kept, inner dialog prop dropped; self-report guard is on outer component
When removing a dead wire from a nested component (`ReportDialog`), verify that the outer `UgcActionsMenu` still has the prop it needs for its own logic. `UgcActionsMenu.targetOwnerUid` is used in two places the dialog does NOT reach: (1) `uid === targetOwnerUid` self-report guard at line 67, (2) `blockUser(targetOwnerUid)` / `unblockUser(targetOwnerUid)` calls. The diff correctly keeps `targetOwnerUid` on `UgcActionsMenu` and removes it only from `ReportDialog` (which no longer passes it to `createReport`). When reviewing similar removal diffs, always grep for ALL usages of the removed prop name in the outer component before approving.

### 2026-06-30 — GDPR subcollection enumeration guard pattern (BIN-347): regex depth-exactness + lastUpdated advisory
`rulesUserSubcollections()` uses `/match\s+\/users\/\{[a-zA-Z]+\}\/([a-zA-Z]+)\/\{/g` — depth-exact anchoring: the wildcard segment after the subcollection name is the terminating `/{`, so nested grandchildren (e.g. `match /users/{uid}/watchlist/{id}/sub/{s}`) would capture the immediate child name only (`watchlist`), not inflating the count. Top-level non-user paths (`/reviews/{id}`, `/groups/{groupId}`, etc.) never match because the anchor requires `/users/{...}/` prefix literally. The regex is correct for flat `users/{uid}/<name>/{id}` depth.

The `collectionGroup` index test uses `[\s\S]{0,80}?` between the collectionGroup call and the following `where()` — safe with current single-line formatting but would silently miss a query if the span exceeds 80 chars (no false positives, only false negatives on the index check). The `toBeGreaterThan(0)` guard on `cgQueries.length` only proves at least one CG query was found, not all of them. Not a blocker at current line lengths.

Advisory (not CLAUDE.md violation): when materially changing the privacy policy copy, `lastUpdated` on `LegalPageShell` should be bumped to reflect the change date. The §6 carve-out addition is a material disclosure; leaving the date as `2026-06-01` is technically inaccurate. This doesn't break anything in the app but could matter in a regulatory audit.

### 2026-06-30 — Collection-group READ rule for likes/comments/reactions: rules are additive so existing public reads survive; delete grant on review likes requires a `get()` read per delete
BIN-347 adds `/{path=**}/likes/{likeId}`, `/{path=**}/comments/{commentId}`, `/{path=**}/reactions/{reactionId}` read rules scoped to `resource.data.uid == request.auth.uid`. These are additive with the existing nested rules (`allow read: if true` on the individual doc paths). Individual-doc public reads continue to work; the new rule only additionally enables collection-group queries when the query includes `where('uid','==',authUid)`. This is the correct Firestore pattern for scoped collection-group access.

The `allow delete` on `likes/{uid}` now grants the review author (not just the liker) the ability to delete any like on their own review. This fires a `get(/reviews/{reviewId})` read per like-delete triggered by the review-author path. During account deletion, the account owner IS the review author for their own reviews, so the cascade correctly deletes all likes on their reviews under this grant. The extra read cost (1 Firestore read per like doc deleted via the review-author path) is a one-time deletion cost, acceptable for account erasure. Do not flag as a blocker.

### 2026-06-30 — DeletionReadKit / DeletionWriteKit are Pick<FirestoreKit,…> subsets; passing a full FirestoreKit (superset) is structurally valid TypeScript
`collectDeletionRefs` accepts `DeletionReadKit = Pick<FirestoreKit, 'db'|'doc'|'getDocs'|'collection'>`. AuthContext passes the full `FirestoreKit` from `await fsdb()`. TypeScript's structural typing allows this: a superset satisfies a Pick type. Similarly `applyDeletionPlan` accepts `DeletionWriteKit = Pick<FirestoreKit,'db'|'writeBatch'|'serverTimestamp'>` and the `batch.update()` call in the function body is on the `WriteBatch` object returned by `writeBatch(db)` — NOT on the kit — so `update` does not need to be in `DeletionWriteKit`.

### 2026-06-30 — backfillLikeUids cursor uses last doc of PAGE not last patched doc; this is correct for full-scan pagination
`cursor = snap.docs[snap.docs.length - 1]` is set to the last doc of the CURRENT PAGE (all 2000 docs), not to the last missing/patched doc. This is the correct pagination cursor: the next `startAfter(cursor)` must advance past ALL docs on the current page (including those that already had `uid` set), otherwise the scan would get stuck if the last docs on a page already had `uid` and no patching happened. The cursor must always advance by full pages. The same invariant is documented in the 2026-06-20 `reclaimOrphanFollows` entry.

### 2026-07-02 — Read-repair echo termination via delta-null + serverTimestamp field excluded from diff (instant week)
The `nextAirReadRepair` write path (called from the single `useCalendar` effect, deps `[uid, enabled, items, shows, movies]`) is echo-safe. When a batch commits, `onSnapshot` gives `items` a new identity → effect re-runs → `collectNextAirUpdates` recomputes. Termination is guaranteed by TWO things working together: (1) `nextAirDelta` returns `null` once persisted values equal computed values, so `collectNextAirUpdates` returns `[]` and the effect early-returns before scheduling the timeout; (2) the stamp field `nextAirUpdatedAt: serverTimestamp()` is NOT a `RepairableKey`, so it's never part of the delta comparison — its round-trip (null estimate → server value) cannot re-trigger. The `same(a,b) = (a??null)===(b??null)` helper collapses null≡undefined≡absent, so a never-repaired item (`nextAirDate` undefined) compared to a computed `null` yields no diff. The compared fields are concrete strings written immediately by the merge (no serverTimestamp on them), so the local optimistic snapshot already carries final values — no flip-flop. Plus `writtenThisSession` Set dedupes (uid,tmdbId) per session as a backstop against StrictMode double-effects. This is the canonical correct pattern for onSnapshot-triggered self-writes; verify all THREE guards (delta-null, stamp-excluded-from-diff, session-dedupe) when reviewing any future read-repair-on-snapshot module.

### 2026-07-02 — Never touch updatedAt in denormalization writes when a sort reads it (continueWatching.ts:108)
`pickContinueWatching` sorts by `b.item.updatedAt.getTime()` ("most recent activity"). Any best-effort denormalization write to a watchlist doc MUST use a SEPARATE stamp field (`nextAirUpdatedAt`) and never merge `updatedAt`, or every background repair would reshuffle the "Fortsätt titta" list to the top. Verified `flushNextAirWrites` merges only `{...delta, nextAirUpdatedAt: serverTimestamp()}` and `delta` keys are constrained to the RepairableKey union (nextAirDate/Code/Provider + digitalReleaseDate) — `updatedAt` is structurally impossible in the payload. When reviewing a new field-group write, always grep for who reads `updatedAt` for ordering before allowing a background writer near the doc.

### 2026-07-02 — Seed/live union dedupe by tmdbId is live-wins and count-safe; keep raw entries for history-dependent consumers
The home `effectiveEntries` union (`page.tsx`) filters seed entries whose `tmdbId` is already in the live `calendarEntries` set — live wins per title. Correct even when a seed points at a different episode than the resolved live entry (seed dropped entirely by tmdbId; live is authoritative). `totalThisWeek` cannot double-count because the seed is removed before counting. CRITICAL invariant preserved: `continueWatching` (needs aired-episode history) and `LaterThisWeek` read RAW `calendarEntries`, NOT `effectiveEntries` — seeds carry no aired/season history so feeding them there would corrupt behind-detection. Only `pickFocalEntry`/`totalThisWeek` (which read only `airDate`/keys) consume the union. When reviewing seed/live merges, confirm each consumer reads the correct set based on whether it needs fields the seed lacks.

### 2026-07-02 — Retiring a standalone SWEDISH_PROVIDERS entry into an alias: grep the WHOLE repo for the raw id, not just providers.ts + its guard test (BIN-403/404/406)
When a monthly price/identity agent removes a standalone provider entry and turns its old id into an `aliases: [...]` entry on the survivor (Paramount+ 531 → SkyShowtime 431 alias), `getProvider(oldId)` and `canonicalProviderId(oldId)` immediately start resolving to the NEW provider everywhere. This is safe for cost-resolution and the Settings checkbox UI, because `resolveProviderMonthlyCost` keys by `provider.id` (canonical) and `ProvidersSection.helpers.splitProviders` canonicalizes `selectedIds` before matching — a legacy user with the raw old id in `myProviders`/`providerTiers` transparently becomes "SkyShowtime selected" with the live price, no orphaning.
BUT two classes of call-site are NOT auto-safe and must be greped for on every such retirement, because this diff missed both:
1. **Any static id-list that feeds `generateStaticParams`** (here: `SEO_PROVIDER_IDS` in `seoCoverage.ts`, consumed by `/provider/[id]/page.tsx`). The retired id stays in the list, `nameFor(oldId)` now resolves through the alias to the SURVIVOR's name (not null), so the `noindex` "unknown provider" guard never fires — Next statically builds a fully-indexable duplicate page (`/provider/531/` with `title: "SkyShowtime — ..."`, self-referencing canonical) alongside the real `/provider/431/`. This is a genuine new SEO duplicate-content regression, not a pre-existing one. Always remove the retired id from any `generateStaticParams`-feeding array in the same diff.
2. **Any NL/regex/keyword→id lookup table not routed through `canonicalProviderId`** (here: `parseSearch.ts`'s `[/paramount/, 531]` row in the PROV table, feeding a results chip labeled via `getProvider(id)?.shortName`). The regex still matches the old brand word, but the id it emits now displays as the survivor's shortName ("Sky" instead of "P+") — a silent, confusing mislabel. TMDB's own discover query for the dead id is usually harmless (empty/no results post real-world shutdown), but the UI label is wrong. Either delete the dead brand-word row entirely (preferred when the service is gone) or repoint it to the survivor's own row/name.
General rule: `git grep <retiredId>` across `src/` (not just `providers.ts` + its identity-guard test) is mandatory before considering a provider-retirement diff complete — the identity-guard test's BASELINE is edited in lockstep with the removal, so it structurally cannot catch this class of gap (see its own docstring's self-caveat: "unless the identity change is intentional and migration-safe"). `computeSpendSnapshot` and `useSubscriptionAdvisor`'s `for (const pid of myProviders)` loops also don't canonicalize/dedupe, so a legacy user with BOTH the old and new raw ids stored would double-count — but this is an accepted pre-existing risk class already present for other historical aliases (HBO Max 1899→384, C More 1759→489), not new; judge as low-severity advisory, not a blocker, unless the retired id was never previously a live standalone checkbox option.

### 2026-07-02 — `addItem` merge-write re-stamps derived-recency fields whenever the caller re-supplies the current value (BIN-349)
`WatchlistContext.addItem` is not "create only" — it's a `setDoc({merge:true})` re-entry path used by
`useMarkSeen`/`StatusButton`/`QuickAddButton` even when a library item already exists (they read
`rating: current?.rating ?? null`, `notes: current?.notes ?? null`, etc. as fallbacks so the re-add
doesn't blank out existing fields). BIN-349 added `ratedAt: item.rating != null ? serverTimestamp() : null`
to `addItem`'s payload — but that check only asks "does this item have a rating", not "did the rating
just change in THIS call". Result: re-marking an already-rated title (e.g. a film rewatch, or a TV
show cycling `avbruten` → `mina` again) via any of those three call sites re-stamps `ratedAt` to *now*
even though the user didn't touch the rating — reintroducing the exact "any edit bumps the recency
anchor" bug the ticket was fixing, just through a second write path (`updateRating` was fixed correctly;
`addItem` was not). The fix is to only stamp `ratedAt` when the rating is transitioning from
null→non-null (or changing value) in that same call, e.g. compare against `current?.rating` /
`current?.ratedAt` and preserve the existing `ratedAt` when the rating is unchanged. General pattern to
check on any "derived recency timestamp" ticket: enumerate EVERY write path that can produce a merge-write
touching the rated/flagged field (not just the dedicated setter) — `git grep` for all `addItem`/generic
upsert call sites that pass through `current?.<field>` fallbacks, since those are re-entry points, not
pure creates, and a blanket "if field is non-null, stamp now" check is wrong on a re-entry path.

### 2026-07-02 — stale doc-comments referencing the old anchor field must be swept in the same diff
When a ticket changes which field is the "recency anchor" (e.g. BIN-349: `ratedAt` now preferred over
`updatedAt`), grep for OTHER comments across the codebase that describe the OLD anchor as authoritative,
not just the functions being edited. Found two in this diff's blast radius neither updated: (1)
`src/types/recommendations.ts` `Seed.ratedAt` JSDoc still says "Timestamp from WatchlistItem.updatedAt"
— now inaccurate since `classifySeeds` prefers `WatchlistItem.ratedAt`. (2)
`src/lib/taste/backfill.helpers.ts`'s `buildBackfillUpdate` comment says a provider-recheck "must not
clobber the recency anchor that seedAnalysis.detectLatestFiveStar reads" referring to `updatedAt` — not
functionally wrong (backfill never touches `rating`/`ratedAt` so the invariant still holds), but the
comment doesn't mention the new field and could mislead a future reader into thinking `updatedAt` is
still the sole anchor. Both are doc-only (no runtime risk) — flag as advisory, but call out explicitly
since stale comments about invariants are exactly what caused BIN-349's underlying bug in the first place
(other call-sites assuming `updatedAt` meant rating-recency).

### 2026-07-02 — BIN-349 re-review: omit-the-key + merge:true is the correct pattern for "stamp only on real change"
Confirmed fix pattern for the prior finding (blind `ratedAt: serverTimestamp()` stamp on every
`addItem` re-mark bumping recency): compute `currentForRating = items.find(i => i.tmdbId === item.tmdbId)`
from context state BEFORE the write, then spread `...(item.rating != null && item.rating !== (currentForRating?.rating ?? null) ? { ratedAt: serverTimestamp() } : {})`
into the `setDoc(..., { merge: true })` payload. Omitting the key (rather than writing `ratedAt: existingValue`)
is correct and sufficient — Firestore merge writes only touch keys present in the payload, so the
document's existing `ratedAt` survives untouched. `items` was correctly added to the `useCallback` deps
(the closure would otherwise read a stale snapshot). Verified: `updateRating` (separate mutator) explicitly
writes `ratedAt: safeRating == null ? null : serverTimestamp()` — this is the one path that legitimately
needs to WRITE null (clearing a rating must not leave a stale ratedAt behind); it's a different call-site
from `addItem`'s omit-vs-stamp choice and both are correct for their respective contracts. Test coverage
is genuine (not tautological): `mountSeeded` drives the mock Firestore `onSnapshot` callback synchronously
inside `act()`, so `items` state is populated with the seeded `rating` before the `addItemRef!` re-mark
call fires — the re-mark test path actually exercises the `items.find` lookup, not a mocked shortcut.
Firestore rules whitelist `ratedAt` AND type-bind it (`d.ratedAt == null || d.ratedAt is timestamp`),
matching both write shapes (omitted key from addItem, explicit null from updateRating). No new issues.

### 2026-07-03 — Unknown-provider cost fallback must sort LAST (Infinity), never 0, in any "cheapest plan" ranker (BIN-169)
`franchiseCheapest.ts`'s `pickBestProvider` and `providers.ts`'s `cheapestEntertainmentTier`/`cheapestEntertainmentTierFrom`
both use `getProvider(id)?.defaultMonthlyCost ?? Number.POSITIVE_INFINITY` as the cost fallback for an id not in
`SWEDISH_PROVIDERS` — this is the established, deliberate convention: an uncatalogued provider must never win a
"cheapest" tie-break by accident; it sorts dead last instead. `listOptimizer.ts` (`makeCost` → `resolveProviderMonthlyCost(id, user) ?? 0`)
breaks this convention: `resolveProviderMonthlyCost` itself correctly returns `null` for an unknown provider (per its
own docstring: "Returns null only for an unknown provider..."), but `makeCost` collapses that `null` to `0` — meaning
an uncatalogued paid streaming service (a real, recurring scenario in this codebase per the many "TMDB added a new
SE provider id" BIN-64/BIN-403+ entries above) is silently treated as FREE and can win both `bestSingle` and the
`cheapestCover` set-cover selection over a genuinely-priced known service. `isFree(id)` correctly stays `false` for
an unknown id (`getProvider(id)?.isFree === true` → `false`), so the free-tie rung doesn't fire — but the raw-cost
rung (`0 < any real price`) does, so an unrecognized provider always looks like the cheapest paid option. This also
produces a UI-breaking output shape: `providerName: null` alongside `monthlyKr: 0` (an unnamed "free" service).
Correct fix: `resolveProviderMonthlyCost(id, user) ?? Number.POSITIVE_INFINITY` (matching the sibling convention),
with the owned-service short-circuit (`if (owned.has(id)) return 0`) staying as the only legitimate 0-kr path.
General rule: whenever a new module resolves a per-provider cost for RANKING purposes (not display), check its
unknown-id fallback against the two established siblings — it must be `Infinity` (sorts last), never `0`
(sorts first / "free"). Flag `?? 0` as a cost fallback in any cheapest-plan/ranking context as a correctness bug,
not a style nit — it inverts the ranking for exactly the input class (uncatalogued provider) the fallback exists to handle.

Secondary, lower-severity finding same diff: the `cheapestCover` set-cover subset-enumeration's `better()` tie-break
(cost → fewer services → lowest id) has no `isFree` rung, unlike `pickBestSingle`'s explicit free-first tie-break.
Two 0-kr services (one genuinely `isFree` public-service, one `isAds` like Pluto TV) can tie in `cheapestCover` and
the choice falls to service-count/id-order rather than preferring the truly-free one. Low severity (both are 0 kr,
so the emitted price is still honest) — advisory only, not a blocker. Also noted: the greedy-fallback branch of
`cheapestCover` (triggers only above `MAX_EXACT_SERVICES=18` or `MAX_EXACT_TITLES=30`) has zero test coverage in
`listOptimizer.test.ts` — acceptable for a pathological-input-only path (same treatment as other "infrastructure,
not yet exercised" fallbacks in this file), but flag if a future ticket lowers the caps or exposes this path to
more realistic inputs.

### 2026-07-03 — Insikter provider-alias fold (BIN-407): mirrored map is correct, but exposed a pre-existing drift between the TWO functions-side sibling copies
`functions/src/insights/rollup.helpers.ts` added a THIRD copy of the TMDB alias→canonical map (functions
can't import `@/lib/tmdb/providers.ts` — path-alias imports don't resolve in the functions build). Verified
every entry against `SWEDISH_PROVIDERS` (the real source of truth) — all 9 mappings match exactly, including
`531 → 431` (retired Paramount+ folded into SkyShowtime, aliases `[1773, 531]` on the `id: 431` entry). That
entry is CORRECT and should stay. However, the comment claims "KEEP IN SYNC ... AND the sibling copy in
availableNotify/logic.ts" — that sibling's own `ALIAS_TO_CANONICAL` is missing the `531: 431` line (only has
`1773: 431`). This is a **pre-existing** gap (not introduced by this diff — the new file is the one that's
correct), but the codebase now has 3 places encoding the same alias table (source of truth + 2 functions-side
mirrors) and they're not all in sync with each other. Flag as advisory/follow-up: worth a small ticket to either
(a) fix the availableNotify copy's missing entry, or (b) extract a single shared functions-side alias table that
both `rollup.helpers.ts` and `availableNotify/logic.ts` import, so a 4th mirror never has to be hand-copied again.
Not a blocker for this diff — the new map itself is correct and matches the source of truth.

### 2026-07-03 — Display-layer "drop unmodelled ids" resolvers should canonicalize via the REAL `@/lib/tmdb/providers.ts`, not a functions-side mirror
`src/app/insikter/metrics/resolvers.ts`'s `topProviderEntries` imports `canonicalProviderId`/`getProvider`
directly from `@/lib/tmdb/providers.ts` (client code can use the `@/` alias; only `functions/**` needs a mirror).
This is the right call — it means the display-side self-healing merge is always as accurate as the single
source of truth, with zero drift risk, unlike the functions-side rollup which necessarily needs its own copy.
When reviewing a future "resolver drops/merges ids for display" change, confirm it resolves via the real
`providers.ts` (not a functions mirror) whenever the code path has access to the `@/` alias — only genuinely
admin-SDK/functions code needs the hand-copied version, and any such copy needs a "matches source of truth"
check like the one above.

### 2026-07-03 — "Drop ids missing from `getProvider()`" in an internal-only breakdown panel is safe when there's no displayed total to under-count
`topProviderEntries` silently drops raw provider ids not present in `SWEDISH_PROVIDERS` (e.g. rent id 10 /
Amazon Video) before rendering the `/insikter` "Toppade streamingtjänster" breakdown. Checked: `TopList`
(the consuming component) renders only the per-row `label`/`value` pairs, no aggregate "total" derived from
summing the breakdown that would go stale/incomplete because of the drop. `/insikter` is an internal admin
dashboard (not user-facing), so silently narrowing to "known streaming services" for a panel literally titled
"streamingtjänster" is the correct fix, not a data-loss bug. General rule when reviewing a "drop unrecognized
ids from a breakdown" change: check whether any sibling metric/resolver computes a total from the SAME raw
array (would then disagree with the filtered breakdown) — flag if so, it's fine if not.

### 2026-07-03 — Rollup-level fold + resolver-level self-heal is a two-layer fix; the display fix can't recover ids that fell OUT of the stored top-10 window
`rollup.ts` now canonicalizes provider ids BEFORE `tallyTop(..., 10)`, so future rollup runs store one
correctly-merged row per service. `resolvers.ts`'s `topProviderEntries` re-canonicalizes + re-merges the
ALREADY-STORED top-10 rows for display, which fixes old daily docs written before the alias-splitting bug was
fixed for services that still HAD a row in the stored top-10 (e.g. Max's 3 alias-rows all survived because Max
is popular). It structurally cannot recover a 4th-place-or-lower real service that got pushed out of the
stored top-10 entirely by the old pre-fix rollup's alias-splitting (before dedup, 3 rows for Max ate 3 of the
10 slots that should've been 1). This is an inherent, small, self-correcting limitation — the next scheduled
rollup run recomputes fresh with the canonicalized fold and the top-10 window is accurate again. Not a bug;
just note it if reviewing a similar "self-heal a display resolver instead of backfilling stored rollup docs"
pattern — the self-heal is bounded to "fix mis-attribution of what's already stored," not "recover what was
already dropped by a pre-fix top-N cap."

### 2026-07-03 — Build-time hub-seed hydration safety (WP1 SEO internal linking)
Pattern for seeding client hub grids (/films, /series, /discover, home guest-landing) with
build-fetched titles so static-export HTML carries crawlable `<a href>`. The hydration-safety
invariants that make it correct (verify all four when reviewing similar seed work):
1. **Async RQ restore + no-op build persister** = first render is always seed. `PersistQueryClientProvider`
   restores the persisted cache via a Promise (even with `createSyncStoragePersister`), and pauses
   queries while `isRestoring`. So the FIRST synchronous client render has `data: undefined` for
   `trending`/`popular-*` regardless of what's in localStorage → `trending?.results ?? seed` = seed,
   identical to build (where `storage: undefined` makes the persister a no-op). The seed→live swap is a
   post-hydration re-render, never a mismatch. Do NOT flag "persisted trending could differ at hydration."
2. **Seed consumed only via hook-free branch at first render.** HomePageClient's auth-loading branch
   (the pre-rendered one, `loading===true` at build) renders `<TrendingSection items={seed}/>` (no hook);
   the hooked `<LandingPageTrending>` only runs in the `!uid` branch which is post-auth-resolve (never the
   build/hydration render). Seed is a serialized prop → identical at build and hydration.
3. **Seed pre-filtered so client filter chains are no-ops on it.** `seedHubItems` drops persons
   (`isAddableMediaType`) and non-Latin (BOTH display+original via `hasNonLatinTitle`, stricter than SEO's
   `latinDisplayIds`). At build/first-render `user` is null → `hideNonLatin=false`, `hiddenCountries=[]`,
   `genre=''` → the discover/mediatype filter chains pass the seed through unchanged. Match.
4. **Seed must not leak into pagination math.** MediaTypePage `hasMore` uses `popular` (the query), not
   `allResults` (seeded state); the accumulator effect is gated on `popular?.results` so it never wipes the
   seed pre-hydration and page-1 live data cleanly replaces it. Correct.
Also confirmed safe: async server pages under `output:'export'` calling `getTrending`/`getPopular*` with
`buildSignal()` + try/catch → [] (CI dummy key stays green); no `export const dynamic` needed and no
`firebase.json`/DynamicRouter change (static routes, not dynamic) — same as provider/[id]. Verbatim body
moves into `src/components/pages/*` newly subject those files to `consistency.test.ts` (BANNED 18px-title,
RAW_RED, LEGACY_TOKENS) — verify the moved markup is clean (it was: `text-acc-deep`/`accent-acc-deep` do
NOT match the `(bg|text|border)-accent\b`/`accent-accent` legacy regex; `text-[32px]/[17px]` ≠ `text-[18px]`).

### 2026-07-04 — "Premiärer & finaler" quarter view (usePremiereEvents/useDiscoveryPremieres): reviewed clean, cost-safe patterns to reuse
Reviewed the /calendar/premiarer/ feature end to end. Confirmed-good patterns worth reusing as precedent:
- **A daily-changing primitive in a persisted queryKey is cost-safe.** `useDiscoveryPremieres` uses
  `['discover-tv','premiere-window', window.startIso, page]`. Head `'discover-tv'` IS in
  `PERSISTED_QUERY_PREFIXES`, so it persists to localStorage — but `startIso` changes at local midnight, so
  each day mints a fresh key. This does NOT accumulate unbounded: `gcTime === PERSIST_MAX_AGE === 24h`
  (queryClient.ts), so yesterday's key is evicted after 24h idle. Footprint is ~2 discover pages/day of lite
  list items (~tens of KB) vs the 5 MB cap. Do NOT flag a daily-keyed persisted catalog query as a bloat
  risk when gcTime==maxAge bounds it to ~2 days' worth. (This is discover LIST data, not per-title
  watch/providers — the thing the CLAUDE.md persist rule actually bans.)
- **No queryKey collision from same head, different shape.** `['discover-tv','premiere-window',iso,page]` vs
  useTMDB's `['discover-tv', params]` never collide — React Query `hashKey` JSON-serializes the WHOLE array;
  different length/elements → different hash → separate cache entries, separate observers. The shared-TMDB_STALE
  rule only bites when the FULL key matches; different-shape keys with the same head[0] are independent, so
  their staleTimes need not agree.
- **window-object identity from a parent memo does NOT thrash child queries** when the child keys on a
  PRIMITIVE off it. `usePremiereEvents` returns a fresh `window` object each time `[entries,items,isLoading]`
  change, but `useDiscoveryPremieres` keys its query on `window.startIso` (string) — query identity is stable
  within a day regardless of object identity. Only the cheap O(cap) `selectDiscoveryPremieres` memo (dep
  `[results,excludedIds,window]`) recomputes on the new object; negligible. Same `dataUpdatedAt`-join memo
  idiom as useCalendar (`[queries.map(q=>q.dataUpdatedAt).join(',')]`, eslint-disabled) — accepted pattern.
- **Reusing useCalendarEntries adds ZERO traffic.** The premiere view composes over the exact same hook the
  week view uses; React Query dedupes the underlying per-title queries by key, so mounting the new page shares
  cache. The nextAirReadRepair write-effect stays on its single callsite inside useCalendarEntries (idempotent,
  only writes when a denormalized field is stale) — not new Firestore writes.
- **Status-model correctness relies on read-time migration.** `derivePremierePills` gates on `status === 'mina'`;
  this is correct ONLY because `WatchlistContext` normalizes every doc through `migrateStatus` at read time, so
  legacy `'följer'`/`'vill_se'` TV strings already surface as `'mina'`. When reviewing any helper that switches
  on a persisted status string, verify the items came through the migrating context, not a raw Firestore read.
- **globals.css inlining the exact shadow-lift value + inset accent stripe is NOT an arbitrary-shadow
  violation** when it verbatim mirrors an existing sibling rule. `.prow`/`.prow.is-today` reuse
  `0 4px 14px oklch(0 0 0 / 0.06)` and `inset 3px 0 0 var(--cal-deep)` — byte-identical to the pre-existing
  `.ev`/`.ev.is-today` calendar-card rules. Grep for precedent before flagging a raw box-shadow in globals.css;
  component-class CSS can't use the Tailwind `shadow-lift` utility, so inlining the same token value is the
  established way. The inset stripe is a functional plum today-indicator (two-accent rule: plum=time, no
  saffron) — correct, not decorative depth.
- **Discover half-open over-fetch is benign:** query sends `first_air_date.lte: endIso` (inclusive) while the
  pure `inWindow` filter is `< endIso` (exclusive) — one extra day fetched, filtered back out. Correct, not a bug.

### 2026-07-05 — "Wasted money / dead weight" UI copy uses `text-danger`, never a saffron accent token (BIN-184)
`ServiceValueCard.tsx` (BIN-182, pre-existing) establishes the precedent: its `isDeadWeight` cell uses
`text-danger font-semibold` for "inget sett" (a paid service with zero value received this month).
BIN-184's `HouseholdPanel.tsx` introduced the exact same concept ("Ingen i hushållet har backlog här.")
but rendered it with `text-acc-deep` (saffron) instead. Per the two-accent rule, saffron (`--acc`/`--acc-deep`/
`--acc-soft`) means "nu / live / avgörande — CTA-knappar, live-indikatorer, veto, brand-mark", not a spend-
warning. A "you're paying for nothing" flag is semantically a warning, not a call-to-action, and the codebase
already has a same-concept sibling using the correct token. When reviewing any new "wasted spend / dead
weight / no value received" indicator, grep for `isDeadWeight`/`text-danger` precedent first and flag a
saffron-accent substitute as a real (medium) finding, not a nit — it's an established, tested pattern being
diverged from, not a fresh design judgment call.

### 2026-07-05 — Follow-up: the danger-token fix landed as suggested, plus a concurrent error-vs-denied fix worth generalizing
The `text-acc-deep` → `text-danger` fix from the entry above landed exactly as suggested (with an inline
comment citing this precedent). Alongside it, a concurrent security-review fix shipped and was verified
non-regressive: `subscribeToGroupHousehold`'s `onSnapshot` error callback now routes `err.code ===
'permission-denied'` to the opt-in gate (`onDenied`) and everything else to a new `onError` → a `'error'`
status checked BEFORE `'gated'` in `useGroupHousehold`'s derivation. General pattern worth repeating: when
a live Firestore `onSnapshot` error callback drives gate-vs-content UI state, never collapse ALL errors into
"you're not opted in" — a transient outage and a genuine permission denial need different user-facing
copy, and the discriminator (`err.code`) is already on the error object; verify the reset effect also
clears the new error boolean alongside the existing denied/loading resets on every re-subscribe.

### 2026-07-05 — Household/opt-in facet review playbook: hook-race + rules-shape + GDPR-cascade checklist all traced clean (BIN-184)
Full trace of an opt-in, share-to-see, real-money group facet (`groups/{gid}/household/{uid}`) turned up
zero correctness bugs across every axis the panel flagged as risky — worth recording the verification method
for the next feature of this shape:
- **Debounced cross-cutting fan-out (AuthContext) is race-free** when (a) the setter that feeds the effect's
  deps (`updateUserField`) does `setUser(prev => ({...prev, [field]: value}))` — i.e. spreads previous state
  and only replaces the touched field, so untouched fields keep their OLD reference and can't spuriously
  re-trigger a `[hhProviders, hhCosts, hhTiers, hhCampaigns]`-keyed effect; and (b) there is no live `onSnapshot`
  on the profile doc re-injecting fresh references on every write (confirmed here: `user` is populated by a
  single `ensureUserProfile` `getDoc` at login, never a listener) — the debounce's `clearTimeout` on every
  dep-changing re-render then guarantees only the LAST closure's field values ever fire the write. Always check
  both halves (setter reference-preservation AND absence of a competing live listener) before clearing a
  debounced-effect-over-object-fields pattern as race-free.
- **A `useRef` "did this visit already write" guard is safe against cross-entity leak only if the consuming
  component remounts per entity.** `useGroupHousehold`'s `refreshedThisVisit` ref never resets on `groupId`
  change by itself — it is only safe because `DynamicRouter.tsx` renders `<GroupPageClient key={match.id} .../>`,
  forcing a full remount (and thus a fresh ref) on every group-to-group navigation. When reviewing a per-visit
  ref guard keyed by a route param, always check the router's `key=` usage, not just the hook in isolation.
- **A share-to-see Firestore rule (`exists()` check keyed only on `request.auth.uid`, not `resource.data`) is
  safely queryable via `onSnapshot(collection(...))`** because the predicate is uniform across every possible
  result doc — Firestore can statically prove the rule holds for the whole collection query. But because a
  `permission-denied` error terminates an `onSnapshot` listener (it does not silently retry), any UI whose
  read-access is gated by a WRITE the user just performed (opt-in creates their own doc, which is what flips
  the rule from deny to allow) needs an explicit epoch-bump/resubscribe after that write — a bare state update
  is not enough to make the same listener start succeeding.
- **GDPR cascade for a new group-scoped opt-in subcollection**: verify FOUR sites move together — (1) owner-
  branch enumeration in both `deleteGroup` (groups.ts) and `collectDeletionRefs`'s owner branch
  (accountDeletion.ts) delete the WHOLE subcollection; (2) member-branch (`removeMember` and
  `collectDeletionRefs`'s else-branch) delete only the acting/removed uid's own doc; (3) `buildUserExport`
  fetches the caller's own docs across all their groups inline (can't be a `users/{uid}`-shaped
  `collectUserDataSnapshots` key since it's group-scoped) with a dynamic `import('./db')` so Firebase-free
  test environments stay clean; (4) `docs/data-export-format.md` + `docs/data-retention-policy.md` +
  `integritet/page.tsx` all get a matching entry, with the legal page's section renumbering checked for
  broken cross-refs (`grep '§[0-9]'` across the whole file, not just the touched section).

### 2026-07-04 — Visibility-gated fan-out must not refold its pending state into an already-shown section's isLoading
When an "eager" cheap source (S1 discover) and a "lazy, visibility-gated" expensive source
(S2 per-title tv-lite fan-out) merge into one section, folding the gated source's pending
flags into the section-level `isLoading` re-hides content that the eager source already
rendered. In `useDiscoveryPremieres`, `isLoading = s1Pending || notInterestedLoading ||
poolPending || fanoutPending`: once the section scrolls into view (or is in view on mount in
the zero-series EmptyState case — the primary discovery audience), `seasonPremieresEnabled`
flips true, `poolPending` becomes true, and the S1 premieres that were visible get replaced by
the "Hämtar…" spinner until the fan-out settles. This does NOT violate the PE "no perpetual
spinner while disabled" condition (that is satisfied via `&& seasonPremieresEnabled`), but it is
a genuine UX regression vs the eager-only Phase 1. Correct shape: gate the lazy pending terms
behind emptiness, e.g. `isLoading = s1Pending || notInterestedLoading || (premieres.length === 0
&& (poolPending || fanoutPending))`, so the second wave appends rather than blanks. Flag as
MEDIUM (UX), not a blocker. Note also: `getTVShowLite` (`append_to_response: 'watch/providers'`)
DOES return `next_episode_to_air` because it is a BASE `/tv/{id}` field, not an append — so a
selector keying on it works on the lite payload. Don't flag that as a missing-field bug.



## Relocated 2026-07-25 — consolidation batch (2026-07-09 → 2026-07-24, 61 entries; raw entries verbatim, original order; lessons distilled into the active file's principles)

### 2026-07-10 — useSubscriptionAdvisor: hasError is independent of myProviders; a page branch keying only on hasError can misreport "TMDB outage" for a genuine no-services user
`tmdbIds`/`showQueries` in `useSubscriptionAdvisor.ts` are built from `followingTV`/`willSeeItems`
(library state: "Följer" TV + "Vill se"), NOT from `myProviders` (the user's configured paid
services). So `hasError = showQueries.some(q => q.isError && !q.data)` (computed once, top-level)
can be `true` even for a user whose `myProviders.length === 0` — e.g. someone who tracks shows but
hasn't entered which services they pay for yet, hit by an unrelated transient/total TMDB failure
on one of their followed titles. The hook's `myProviders.length === 0` early-return branch (the
`computed` useMemo) resets `providers`/`bundleSuggestions` to `[]` but does NOT reset `hasError` —
it's spread back in unconditionally at the final return (`{ ...computed, bundleSuggestions,
isLoading, hasError }`). Found in `src/app/savings/page.tsx`'s BIN-448 branch
(`if (advisor.providers.length === 0) { ...; if (advisor.hasError) { <outage EmptyState> } }`):
this new branch can't distinguish "real outage, user has services" from "no services configured,
unrelated fetch blip" — both present as `providers:[] && hasError:true && bundleSuggestions:[]`
from the page's point of view, since `AdvisorResult` doesn't expose `myProviders.length` (or an
equivalent "has the user configured anything at all" signal) separately from the derived
`providers` array. Whenever reviewing a new consumer branch keyed on `advisor.hasError`: check
whether the branch needs to be TRUE outage vs "nothing configured yet" — if so, the hook needs a
dedicated flag (e.g. `hasConfiguredProviders: myProviders.length > 0`) rather than trusting
`hasError` alone, because `hasError`'s source queries are gated on library content, not on
provider configuration.

### 2026-07-11 — BIN-360 releaseNotify re-review: all three prior findings (error isolation, inbox/push coupling, per-title→per-user dedup) confirmed fixed; caught a stale-but-unstaged doc-comment fix mid-review
Re-reviewed `functions/src/availableNotify/index.ts` after both my 2026-07-11 finding (no per-user
error isolation in `runReleasePhase`, inbox card wrongly gated on `pushEnabled`) and a subsequent
xhigh review's deeper bug (per-title `digitalReleaseState` marker meant a same-day rerun would skip
EVERY owner of a movie, including one who bevakade it mid-day, since the marker was keyed on tmdbId
not uid) were fixed. Confirmed correct: (1) dedup is now `inboxRef.get().exists` on the per-user
`${tmdbId}-release` doc — a same-day rerun only skips users already notified, a new owner added
mid-day still gets caught; (2) `runReleasePhase` groups owner docs by tmdbId (not one movie-level
title) and uses each owner's own `it.title` with `'En film du bevakar'` fallback for empty; (3) owners
are fanned out via `Promise.allSettled` with a per-owner try/catch inside — mirrors `processTitle`;
`skip.add(skipKey(...))` happens BEFORE the try block so it survives even a throw inside; (4) the
overlap suppression in `processTitle` (`if (releaseSkip.has(skipKey(it.uid, it.tmdbId))) return`)
is symmetric and safe specifically BECAUSE the status model guarantees a movie's watchlist owners are
100% `vill_se` (film has no `mina`), so `byMovie`'s owner set for a given tmdbId always equals
`byTitle`'s owner set for the same tmdbId — there's no owner who gets availability-checked but wasn't
release-skipped. `writeMarker()` still runs unconditionally after the `Promise.allSettled(items.map(...))`
regardless of early returns inside individual item callbacks (confirmed: early `return` inside `.map`
only resolves that one promise, doesn't short-circuit `allSettled`). (5) `skipKey` is a single module-scope
helper shared by both the add-site and check-site — no drift risk.
**Live catch, same class as the 2026-07-04 "always diff the unstaged working tree" lesson**: at the
moment of review, `git diff --stat` (no `--cached`) showed a real unstaged edit to this exact file — a
pure doc-comment fix correcting the file's top-of-module docstring, which still said "At-most-once via
`digitalReleaseState/{tmdbId}.notifiedDate`" (the OLD, now-removed mechanism) even though the staged
code had already moved to per-user inbox-doc dedup. This was going to be my own finding (stale comment
referencing a collection that no longer exists anywhere in the codebase — confirmed via repo-wide grep)
until I found someone/something had already fixed it on disk, just not `git add`-ed yet. Verified the
unstaged diff was a comment-only change (zero logic delta) before staging it myself with `git add` to
close the gap, then re-ran `git diff --stat` (empty) and the test suite before writing the marker.
Reinforces: always check `git diff` (unstaged) on every file in a staged diff you're re-reviewing, even
when re-confirming previous findings are fixed — a fix can land in the working tree without being staged,
and the staged blob (what would actually be committed) is the ground truth, not what's currently rendered
by a casual `git show HEAD:<file>` or a quick read of the file on disk.

### 2026-07-11 — BIN-402 TMDB-fields sweep re-review: all 6 fixes (3 HIGH + 3 xhigh) confirmed correct, dry-run gate makes deferred BIN-468 gaps genuinely inert
Final re-review of the staged BIN-402 diff (session-dedupe write-loop, title-match,
subset-stamp, empty-providers clobber, sweep-stamp-on-clear, general regression sweep).
All confirmed:
1. **Write-loop fix**: `refreshedThisSession` (`Set<string>`, keyed `${uid}:${tmdbId}`)
   in `WatchlistContext.refreshTmdbFields` is added to SYNCHRONOUSLY before the
   `await fsdb()` — a second synchronous re-entrant call for the same title (e.g. two
   effects racing) sees the key already present even before the first write's promise
   resolves, so the pending-`serverTimestamp()`-echo-reads-back-null re-trip can't
   double-fire. Key correctly includes uid (mirrors the existing
   `nextAirReadRepair` writtenThisSession pattern) so an account switch mid-session
   doesn't wrongly suppress the new user's refresh. The dedupe key is only added AFTER
   the `!current`/`!needsTmdbFieldsRefresh` early-returns — so a title not yet in the
   library, or one not yet stale, is never permanently blocked from a legitimate future
   refresh; only an actual write burns the key.
2. **Title regression fix**: both `MoviePageClient`/`TVShowPageClient` lazy-refresh
   effects now compute `preferOriginalTitle(movie.title, movie.original_title) ||
   undefined` — traced against every existing `addItem`/render call in both files
   (`displayTitle`, the `handleBevaka` addItem payload) and confirmed identical
   `preferOriginalTitle(localized, original)` call shape. The `|| undefined` fallback
   is strictly SAFER than addItem's bare call (addItem would write `''` in the
   never-happens both-titles-empty case; the effect instead omits the key, so
   `setDoc(..., {merge:true})` leaves any prior value alone) — not a divergence.
3. **nextAir subset-stamp fix**: `buildRepairPayload` (nextAirReadRepair.ts) no longer
   includes `tmdbFieldsRefreshedAt` in its output — confirmed via diff AND the
   locked test (`Object.keys(payload).sort()` == exactly `['nextAirCode','nextAirDate',
   'nextAirUpdatedAt']`). Only the two whole-block writers (`addItem`,
   `WatchlistContext.refreshTmdbFields`) stamp the freshness field now — a
   calendar-only user who never opens a title page correctly still ages toward the
   sweep on that title (the intended behavior per the added code comment).
4. **Empty-providers clobber fix**: both title-page effects gate `providerIds` on
   `movie['watch/providers']?.results?.SE` being present (`const providerIds = se ?
   Array.from(...) : undefined`) — an absent SE block yields `undefined`, which
   `refreshTmdbFields`'s `if (fields.providers != null) payload.providers = ...`
   correctly omits from the merge payload (leaving prior denormalized ids untouched).
   A genuinely-present-but-all-empty SE block (all 5 category arrays empty) still
   correctly produces `providers: []` and writes it — the fix only guards the
   "TMDB response had no SE key at all" case, which is the actual clobber risk
   (e.g. a transient/partial TMDB response).
5. **Sweep stamp-on-clear fix**: `buildClearedPayload` (functions/src/tmdbTosSweep/
   logic.ts) now also maps `TMDB_FIELDS_STAMP` to the delete sentinel (not just
   `TMDB_DERIVED_FIELDS`) — confirmed via a test asserting the payload key-set is
   EXACTLY `TMDB_DERIVED_FIELDS ∪ {tmdbFieldsRefreshedAt}`, plus a dedicated test
   asserting the stamp entry is the delete sentinel with the exact rationale in its
   description (absent stamp → `needsTmdbFieldsRefresh` returns true → title-page
   lazy-refresh repopulates on next view; a left-behind fresh stamp would have made
   a swept doc render blank for up to 90 days). The caller (`index.ts`) passes
   `buildClearedPayload(FieldValue.delete())` unchanged — no caller-side drift.
6. **No new regression**: both new `useEffect`s in MoviePageClient/TVShowPageClient
   are declared BEFORE the `isLoading`/`!movie` early-return (verified by reading the
   full render-order) — Rules-of-Hooks safe. `refreshTmdbFields`'s `useCallback` deps
   are `[uid, items]`; `items` changing identity on ANY watchlist mutation (e.g. an
   unrelated rating edit) gives the effect a new callback reference and re-fires it,
   but this is a no-op cost (a `Set.has` + a date comparison), never a duplicate write,
   because the dedupe-Set check precedes any write. `firestore.rules`' new
   `tmdbFieldsRefreshedAt` clause type-binds to `is timestamp` AND `<= request.time`
   (blocks a client forging a future stamp to make the sweep perpetually skip a doc)
   — correctly added to BOTH the `hasOnly` key-list and the type-validation chain
   (a merge-write is evaluated against the FULL post-merge doc, so omitting the key
   from `hasOnly` would permission-deny every subsequent unrelated write once a doc
   carries the stamp — same class as the existing `ratedAt`/`nextAir*` entries).
   `tsc --noEmit` (root + functions), `eslint` on all 8 touched/new files, and the
   3 targeted vitest suites (29 tests) all green with zero working-tree drift
   (`git diff --stat` empty against the staged index at review time).
The sweep function itself defaults `mutateEnabled: false` (Console-flip-gated,
BIN-468 tracks enabling it) — so the deferred gaps (lazy-refresh not covering
`providersCheckedAt`/`nextAir*`/`digitalReleaseDate`, and the provider-derivation
logic duplicated near-verbatim across the two title-page effects) are correctly
inert for THIS ship: nothing in the dry-run path can clear a real doc. Confirmed
safe to ship as-is; both deferrals are genuine follow-up work, not silently-shipped
bugs, and should be re-checked specifically when BIN-468 flips the mutate gate.

### 2026-07-11 — BIN-468 closes the BIN-402 deferrals: whole-block stamp now honest, provider-derivation dedup extracted cleanly
Follow-up ship completing the two gaps the 2026-07-11 BIN-402 re-review flagged as "genuine
follow-up work, correctly inert for that ship." Verified both closed correctly, no drift:
1. **Whole-block honesty**: `WatchlistContext.refreshTmdbFields`'s payload now stamps
   `providersCheckedAt`/`nextAirUpdatedAt` (both `serverTimestamp()`) ONLY inside the same
   `if (fields.X != null / fields.X)` guard that adds their data fields — never unconditionally
   at the top with `tmdbFieldsRefreshedAt`. This is the correct shape: a caller that omits a
   group (e.g. TV effect never sends `digitalReleaseDate`, movie effect never sends `nextAir`)
   must not falsely mark that group's sub-stamp fresh. `updatedAt` still never appears anywhere
   in the payload (confirmed via the new locked test `expect('updatedAt' in payload).toBe(false)`).
2. **`seProviderIds(se)` extraction**: pulled the identical 5-category-union +
   `canonicalProviderId` + `Set`-dedupe + `undefined`-when-absent logic out of both
   `MoviePageClient`/`TVShowPageClient` effects into `tmdbFieldsRefresh.ts`, byte-for-byte
   equivalent to the two prior inline copies (confirmed via diff — both call sites now pass
   `seProviderIds(movie['watch/providers']?.results?.SE)` / same for `show`). `canonicalProviderId`
   stays imported in both page files (unrelated existing usages lower in each file — verify this
   before flagging an "unused import" on an extraction diff; grep the WHOLE file, not just the
   diff hunk).
3. **nextAir/digitalReleaseDate not swapped**: `computeNextAirFields(show)` (TV-only,
   `NextAirFields` shape) feeds `TmdbDenormFields.nextAir`; `computeMovieReleaseFields(movie)
   .digitalReleaseDate` (movie-only) feeds `TmdbDenormFields.digitalReleaseDate` — correct per
   media type, and the `TmdbDenormFields.nextAir` inline type is structurally identical to the
   `NextAirFields` interface exported from `nextAirReadRepair.ts` (both compute helpers already
   existed pre-diff, powering the separate `nextAirReadRepair` calendar-side repair path — this
   diff is new CALL SITES for existing pure functions, not new derivation logic).
4. **firestore.rules needs no change**: all four newly-written-from-this-path fields
   (`providersCheckedAt`, `nextAirDate/Code/Provider/UpdatedAt`, `digitalReleaseDate`) were
   already present in the `hasOnly` allowlist AND the type-validation chain from the PRIOR
   BIN-402/nextAirReadRepair rules work — confirmed via grep, zero staged or unstaged
   `firestore.rules` diff. When a "client-only" ship writes fields that sound rules-relevant,
   always grep `firestore.rules` for the exact field names before assuming a gap — the guard
   may already be in place from earlier layered work.
5. Hook order unchanged (`useEffect`s at fixed positions before the `isLoading`/`!movie`/`!show`
   early-returns in both page clients — position didn't move, only the effect body was
   simplified). `tsc --noEmit`, `eslint` (zero new warnings, 4 pre-existing unrelated warnings in
   the test file), and both targeted vitest suites (31 tests, incl. a new interval-boundary test
   `>=` not `>` and 3 `seProviderIds` unit tests) all green with `git diff --stat` empty at
   review time. Confirmed safe to ship; this closes the BIN-402 deferral loop cleanly with no
   new residual gaps.

### 2026-07-14 — SEO jsonLd/withRetry extraction: bare `surface` (no `bg-`/`text-`/`border-` prefix) is a silent no-op class, not a valid Tailwind utility
Reviewed the dedup of two duplicated helpers (`jsonLd()` escaper, `withRetry()` backoff loop —
previously copy-pasted across `/genre`, `/billigaste`, `/forsvinner`, `/guider`, `/provider`) into
`src/lib/seo/jsonLd.ts` / `src/lib/seo/withRetry.ts`, each now with its own test file. Clean
extraction: `withRetry`'s new `backoffStepMs` param (default 300, genre pages pass 700) preserves
each caller's original timing exactly; `jsonLd`'s escape logic is byte-identical to all five inline
copies and to the pre-existing client-side `<JsonLd>` component's inline version (duplication across
server/client left as-is, acceptable — different render contexts). Zero correctness findings; `tsc`/
`eslint`/vitest all green on every touched file. The diff also fixed a real pre-existing bug in two
files (`/billigaste`, `/guider`) as a drive-by: `className="... surface rounded-lg ..."` → `"...
bg-surface rounded-lg ..."`. Confirmed via `tailwind.config.ts`: `surface` is registered ONLY under
`theme.extend.colors` (`surface: 'var(--surface)'`), which makes Tailwind generate prefixed utilities
(`bg-surface`, `text-surface`, `border-surface`, …) — there is no bare `surface` utility class. A bare
`surface` token in a className list is therefore inert (unstyled, no background) even though
`design-system.md`'s prose lists tokens as `--surface` / `surface`, which reads like `surface` alone is
a usable class. **Grep hit while verifying repo-wide cleanup found ONE more live instance the diff
didn't touch**: `src/components/pages/ForsvinnerListClient.tsx:69` — `className="flex items-center
gap-3 surface rounded p-2 border border-rule hover:shadow-lift transition-shadow"`, the child component
rendered by `/forsvinner/[id]/page.tsx` (one of this diff's own files). Out of scope for this diff
(untouched, unstaged) but same bug class, one line, worth a quick follow-up fix (`surface` →
`bg-surface`). General pattern to check going forward: any bare color-token name used as a className
without a `bg-`/`text-`/`border-`/`ring-` prefix is very likely a silent styling no-op, not a legacy
alias — grep `className="[^"]*\bsurface\b(?!-)` (and the same shape for other surface-family tokens
like `bg-2`/`rule`) whenever reviewing a diff that touches card/panel wrapper classNames.

### 2026-07-14 — BIN-506 deriveProviderStatus cost-signal swap (defaultMonthlyCost → effectiveMonthlyCost): correct, dedupes a redundant resolveEffectiveMonthlyCost call, but leaves a now-stale comment in providers.ts (out of this diff's scope)
Reviewed the unstaged `useSubscriptionAdvisor.{ts,helpers.ts,helpers.test.ts}` change swapping the
free-vs-pause cost signal in `deriveProviderStatus` from the immutable catalog `provider.defaultMonthlyCost`
to the live-resolved `effectiveMonthlyCost` (tier/custom/campaign cascade via `resolveEffectiveMonthlyCost`).
Confirmed correct and a net simplification: (1) the hook now computes `effectiveMonthlyCost` ONCE per
provider in the main `canMyProviders` loop and reuses it for both the status derivation AND the
`monthlyCost` field — previously `resolveEffectiveMonthlyCost` was called for `monthlyCost` while status
used the separate, stale `provider.defaultMonthlyCost`, a latent inconsistency this closes; (2) the other
3 call sites (`willSeeByProvider`, `activePauses`, `subscribeAction`) correctly keep their OWN
`resolveEffectiveMonthlyCost` calls uninlined since they iterate different provider sets (not-yet-subscribed
or no-longer-subscribed providers) that can't reuse the main loop's per-`pid` value; (3) `effectiveMonthlyCost?:
number | null` (helpers.ts signature) matches `resolveEffectiveMonthlyCost`'s real return type exactly, and
the `?? 0` guard in `deriveProviderStatus` still treats both `null`/`undefined` as 0 (nullish, not falsy) —
same invariant the pre-existing test already pinned, now extended with a same-service isFree-survives-custom-
cost case. `isFree` is checked in the same `||` as before (order-irrelevant, both are pure booleans) so SVT
stays 'free' even if a user enters a custom cost, while Pluto (isFree:false, cost via ads) correctly becomes
'pause' once given a nonzero custom cost — the intended BIN-506 product behavior (a custom-priced "free"
catalog service is genuinely paid and should surface as a pause candidate). `tsc --noEmit`, `eslint`, and
17/17 `useSubscriptionAdvisor.helpers.test.ts` all green; only one `deriveProviderStatus` call site
repo-wide (grepped), no other consumer to update. **One adjacent, out-of-diff-scope observation**: the
`providers.ts:151` comment on the Pluto TV catalog entry ("defaultMonthlyCost 0 → advisor ger 'free'-status
(aldrig paus-kandidat)") is now factually wrong post-BIN-506 — a user-supplied custom cost on Pluto now
DOES make it pause-eligible, per this diff's own explicit intent. Same "flag the comment, not the code"
class as the parser/regex corpus below, but the comment lives in a file NOT touched by this diff — noting
it here for a future pass rather than blocking this ship on an unrelated file's stale prose.

### 2026-07-15 — BIN-505 public-profile + notes PII fix: rules-lock + all ~9 foreign-read migrations correct; implementation silently reverted a BINDING plan decision (always-on notes listener instead of mandated lazy per-doc read)
Reviewed the full working-tree diff locking `users/{uid}` read to owner-only, adding the
`publicProfiles/{uid}` positive-whitelist projection (live-gated via privileged `get(users/{uid})`,
value-bound `hasOnly`), and moving watchlist `notes` to an owner-only `watchlistNotes` subcollection.
Correctness confirmed clean on the hard parts: repo-wide grep found ZERO residual foreign
`users/{uid}` reads (all ~9 call sites — feed, listFriends, useFollowList, useFriendsWhoSaw,
usePublicProfile, userSearch, username.lookupUserByHandle, TopbarActions, FriendsPageClient,
ListPageClient, grupper/page — migrated to `getPublicProfileCard(s)`); the watchlist create/update
rules' `notes`-null-or-unchanged guard is exactly right for the one-way-ratchet (legacy docs keep
passing unrelated merge-writes, a stale client bundle can't re-leak a NEW note); GDPR export/delete
wiring for both new collections (`publicProfiles` top-level + `watchlistNotes` subcollection) is
present with dedicated coverage-map entries, since `publicProfiles` sits outside
`KNOWN_USER_SUBCOLLECTIONS` and needs explicit wiring (confirmed done in both directions). Two
real findings, one high-confidence:
1. **A written, panel-reviewed, Malin-approved plan is a binding spec — diff the plan's decisions
   against the shipped code, not just the code against itself.** `tasks/bin-505-plan.md`'s "MALIN
   DECISIONS ... BINDING" section explicitly mandates: "read notes via LAZY getDoc(watchlistNotes/
   {tmdbId}) when the note editor opens ... NO third full-collection onSnapshot." The shipped
   `WatchlistContext.tsx` instead adds exactly that — an always-on `onSnapshot(collection(db,
   'users', uid, 'watchlistNotes'))` listener, joined onto every item via `itemsWithTags`, purely so
   the two title-page `NotesBlock` consumers (unchanged in this diff) can keep reading
   `watchlistItem.notes` without a call-site rewrite. Lower code-diff blast radius, but a direct,
   unflagged reversal of an explicit cost/architecture decision the plan called "BINDING" — this
   class of gap (silent deviation from an approved plan, discovered only by opening the plan file
   and diffing its decision list against the actual mechanism) is worth checking on every diff that
   ships against a `tasks/*-plan.md`: read the plan's decisions section as acceptance criteria, not
   just its "what to build" prose.
2. **Eager one-pass migration effects need the same synchronous re-entrancy guard as
   `refreshedThisSession`, or a mid-flight dependency-array change can double-fire the batch.** The
   new notes-migration `useEffect` (`WatchlistContext.tsx`) dedupes purely via `notesByTmdbId[i.tmdbId]
   === undefined` — a value that only updates asynchronously, on the PARALLEL onSnapshot listener's
   next delivery. If `items` (the effect's other dep) changes identity again WHILE the first batch's
   `await batch.commit()` is still in flight (e.g. an unrelated rating edit fires the watchlist
   listener), the effect re-runs, recomputes the same `legacy` list (since `notesByTmdbId` hasn't
   echoed back yet), and starts a SECOND batch write for the same up-to-300 docs. Not a data-loss bug
   (both writes are idempotent — same `note` value, same `deleteField()`) but a real double-write-cost
   risk on a Blaze-capped project, and exactly the class the file already has an established fix for:
   `refreshTmdbFields`'s `refreshedThisSession` `useRef<Set<string>>`, added to SYNCHRONOUSLY before
   the `await`, specifically to survive this exact re-entrant-effect-during-in-flight-write shape (see
   the 2026-07-11 BIN-402 entry above). Flag any NEW eager/bounded migration effect that dedupes only
   via async-listener state (not a sync ref) against this precedent.
Minor, non-blocking: `docs/data-export-format.md`'s CHANGELOG lists the new `1.3` entry BEFORE the
pre-existing `1.2` (BIN-184) entry — chronological/version ordering broken by an insertion, cosmetic
only. The incident record (`docs/incidents/2026-07-14-bin505-profile-pii-exposure.md`) already tracks
the "existing public profiles show as private until the owner's next login" backfill-window gap as a
named follow-up — don't re-flag it as a fresh miss, it's a known, accepted, documented trade-off (lazy
owner-triggered backfill, explicitly decided in the plan).

### 2026-07-15 — BIN-505 re-review: both prior findings fixed correctly; a plan can legitimately be AMENDED (not just followed) when the deviation is documented + the overridden condition is non-high-stakes-core
Re-reviewed the updated working-tree diff after all three commit-gate reviewers' findings were
addressed. Both of my 2026-07-15 findings confirmed FIXED: (1) `addItem` now destructures
`notes` out (`const { notes: _strippedNotes, ...itemFields } = item`) before the merge-write —
traced against both rule branches (create: payload has no `notes` key → passes absent-or-null;
update/re-mark: payload still omits `notes` → merged result equals the prior stored value →
passes the unchanged-guard) — test-locked (`addItem never writes a non-null inline note`). (2) the
eager notes-migration effect now marks `migratedNotesRef` SYNCHRONOUSLY before the async batch
(byte-for-byte the same shape as `refreshTmdbFields`'s `refreshedThisSession` precedent from the
2026-07-11 BIN-402 entry above) — confirmed self-terminating because both filter conditions
(`i.notes != null`, `notesByTmdbId[tmdbId] === undefined`) independently go false once the batch's
writes echo back through the watchlist + watchlistNotes listeners, and resets correctly on uid
change via a dedicated `useEffect(() => { migratedNotesRef.current = new Set(); }, [uid])`.
**New pattern worth naming**: the always-on notes-listener finding from the prior review wasn't
"fixed" by changing the code back to match the plan — the PLAN ITSELF was amended
(`tasks/bin-505-plan.md`'s "MALIN DECISIONS" section grew a dated "Notes read — REVERSED at
implementation" bullet with an explicit rationale: consistency with the pre-existing sparse
`watchlistTags` listener pattern, read cost scales with note-count not library-size since the
collection is genuinely sparse, and zero call-site churn for the two `NotesBlock`/`NotesTextarea`
consumers — verified all three claims against the diff). This is a legitimate resolution path,
DISTINCT from "silently reversing a binding decision" (the 2026-07-15 finding this entry
supersedes): the deviated condition was a DBA-role (non-high-stakes-core per CLAUDE.md's
Security#4/DPO#6/Legal#5 list) architecture preference, not a security/privacy block, so
documenting-and-overriding it is in scope for the implementer, unlike a Security/DPO/Legal block
which CLAUDE.md requires surfacing to Malin unresolved. One residual doc-consistency nit (not a
code bug): the plan's own "POST-PANEL CONSOLIDATION" acceptance-criteria checkbox for this exact
DBA condition is left unchecked, even though the earlier "REVERSED" bullet already resolves it —
when a plan is amended to reverse a specific panel condition, check off (or strike through) that
condition's line in the acceptance-criteria list too, so the two sections of the same plan don't
read as contradicting each other. Also re-verified `firestore.rules`' `isValidPublicProfile`
`createdAt`/`updatedAt` `is timestamp` binds (both wrapped `!('X' in d) || ... is timestamp`,
i.e. optional) don't reject the real writer: `syncMyPublicProfile` always sends `updatedAt` via
`serverTimestamp()` (satisfies `is timestamp` per Firestore's sentinel-handling) and `createdAt`
as a native JS `Date` (`AuthContext`'s `user.createdAt` is NEVER undefined — defaults to `new
Date()` — so the `src.createdAt ?` truthy-check in `publicProfile.ts` always takes the
include-the-field branch; native `Date` objects serialize to `Timestamp` on write via the modular
SDK). No new findings on this pass; all ~9 foreign-`users/{uid}`-read migration sites re-spot-
checked (feed, friends.ts, useFriendsWhoSaw, UserProfilePageClient) remain clean, GDPR export/
deletion wiring for `publicProfiles`+`watchlistNotes` unchanged from the prior clean verdict.

### 2026-07-15 — BIN-513/514 streaming batch (serviceValue TV-guard + household/rotation stat surfacing): clean, all acceptance criteria met; one comment invents a guard that doesn't exist
Reviewed `serviceValue.ts`/`useServiceValue.ts` (BIN-513: `isDeadWeight` now suppressed for a
paid service carrying TV-only usage via a new `tvActiveProviderIds` param, canonicalized both
sides) and the BIN-514 render-only wiring (`RotationCalendar.tsx`'s `longestPauseDays`,
`savings/page.tsx`'s `mostUsedProvider`, `HouseholdPanel.tsx`'s new `zeroCostCount` row field).
All correct: TV-guard only suppresses the verdict for providers actually carrying anchor
activity (status `'mina'`/`'vill_se'`, mirrors the established anchor-status pattern used
elsewhere e.g. `buildHouseholdContribution`'s `activeProviderIds` derivation), a genuinely
unused service is still flagged (dedicated test), alias ids resolve on both sides of the Set
comparison. BIN-514 is genuinely render + one struct field, zero new Firestore reads, all three
stats were pre-existing tested infrastructure (`mostUsedProvider` in `useSubscriptionAdvisor.ts`,
`longestPauseDays` in `savingsLedger.ts`) just never rendered. `npx tsc --noEmit` and the two
targeted vitest files (37 tests) green.
**New comment-accuracy pattern, distinct from the "stale comment describes old code" corpus
below**: `householdAggregate.ts`'s new `zeroCostCount` field doc says "Named to avoid the
ADR-0010 output-field guard (no 'shar'/'saving' keys)" — this reads as citing a real enforcement
mechanism (a lint/test that rejects field names containing those substrings). No such guard
exists anywhere in the repo (grepped `src/` for any `Object.keys`/field-name assertion tied to
`HouseholdProviderRow`/`HouseholdOverview`; the only "shar"/"saving" hits are unrelated —
`consistency.test.ts`'s `savings`-directory-name matches, and ADR-0010's prose is about
share-to-see reciprocity and the "no account-sharing disclaimer" copy rule, not field naming).
Low severity (doesn't affect behavior, and the naming choice itself — `zeroCostCount` — is fine
either way), but worth flagging on future diffs: a comment citing a "guard" as the reason for a
naming choice is a claim about the codebase's enforcement surface, not just intent — verify the
cited guard is real before accepting the comment, same discipline as checking a comment's
description of behavior.

### 2026-07-16 — BIN-513 avslutad-regression fix re-review: correct; supersedes the 2026-07-15 TV-guard entry above
A same-day xhigh pass found the 2026-07-15 `tvActiveProviderIds` TV-guard (shields any owned
service carrying status `'mina'`/`'vill_se'` TV usage from the dead-weight verdict) was too broad:
it also shielded a service whose ONLY TV usage was a fully-finished Ended/Canceled+caught-up
series — nothing new is coming, so that's not "active use" and the service should stay
dead-weight-eligible. Fix: `tvActiveProviderIdsFromItems` now additionally excludes any item where
`librarySubState(it) === 'avslutad'` (persisted-fields-only variant, called with no
`knownBehind`/`knownEndedCaughtUp` args — confirmed no extra TMDB fan-out), while every other
sub-state (`ej_paborjad`/`paborjad`/`ligger_efter`) and the TV `vill_se` will-see anchor still
count as active. Verified correct: (1) alias-canonicalization survives the refactor — the helper
collects RAW provider ids, `rollupServiceValue` canonicalizes them once into a `Set` via
`canonicalProviderId`, compared against the already-canonical `row.providerId` (both sides
canonical at comparison time, confirmed with a dedicated TV4 Play 1944→489 alias test); (2) a
service whose only TV title is genuinely avslutad is now test-confirmed `isDeadWeight: true`
(the exact regression the xhigh pass caught); (3) `docToItem`'s `migrateStatus` normalizes TV
`'vill_se'`→`'mina'` at READ time inside `WatchlistContext`, so the helper's own `status ===
'vill_se'` branch for TV is defensive/effectively-dead in production, not a bug — items reaching
this hook are already migrated. 25/25 `serviceValue.test.ts` green, `tsc` clean. **Pattern**: when
a review confirms a fix for an xhigh-caught regression, diff the fix against the SPECIFIC
over-broad condition the regression report named (here: "shields TV usage" needed narrowing to
"shields ACTIVE TV usage, not finished-series TV usage") rather than re-deriving the whole guard's
correctness from scratch — the surrounding logic (status filter, media-type filter, alias handling)
was already reviewed clean on 2026-07-15 and didn't change shape, only gained one additional
exclusion clause.

### 2026-07-16 — BIN-510 groups.ts zero-groups TTL cache: bounded-query fix is clean, but the cache write is a classic out-of-order-completion TOCTOU, distinct from the established sync-ref-before-await pattern
Reviewed `src/lib/firebase/groups.ts`'s BIN-510 diff (working tree, unstaged): adds `limit(MY_GROUPS_LIMIT=100)` to all four `memberUids array-contains` "mina grupper" queries (mirrors `FOLLOWING_LIMIT` in `useFollow.ts`, different value — appropriate, groups membership is far more bounded than follows) and a module-scope `zeroGroupsCache: {uid, at} | null` + `ZERO_GROUPS_TTL_MS=5min` short-circuiting `syncProgressToGroups`'s per-episode-toggle fan-out for the common group-less user. The cache only ever stores "known-zero" (an `isEmpty:false` call nulls it to "unknown", never asserts "known non-empty") — this asymmetry is the safety net for every OTHER identified gap (`removeMember`/`leaveGroup`/`deleteGroup` correctly don't call `noteGroupMembership` at all; worst case is one extra scan, never a missed sync). tsc clean (the `zeroGroupsCache?.uid === uid && ... zeroGroupsCache.at` non-null narrowing across an `&&` does compile — TS narrows a nullable object through an optional-chain equality check against a non-optional value, not just truthy/falsy checks).
**The one real gap**: `syncProgressToGroups`'s cache write (`noteGroupMembership(params.uid, groupsSnap.empty)`) happens AFTER its own `await getDocs(...)`, using a snapshot that reflects Firestore state as of whenever the query STARTED, not when it resolves. If a concurrent `createGroup`/`joinGroupViaToken`/`acceptGroupInvite` call (which write `noteGroupMembership(uid, false)` synchronously right after their own commit) finishes and clears the cache WHILE this scan is still in flight, and the scan's stale (pre-mutation) result was `empty:true`, the scan's cache write — which runs when ITS promise resolves, not in start order — can land AFTER the mutation's cache-clear and silently re-cache "zero groups" using outdated data, suppressing progress-sync to the just-created/joined group for up to 5 minutes. Rated low real-world likelihood (the mutating call sites — `grupper/ny` page, invite-accept — are on disjoint UI surfaces from the episode-toggle call site) but a genuine last-write-wins race, distinct in kind from the codebase's established `refreshedThisSession`/`migratedNotesRef` fix (marking a ref SYNCHRONOUSLY before an await to prevent a SECOND same-operation re-entrant fire) — that pattern guards against a duplicate of the SAME async op; this is two DIFFERENT async ops racing to write the same shared cache slot, where the fix would need to compare a monotonic "scan started at" timestamp against the cache's last-known-fresh time before accepting a stale write, not just a dedupe-Set. **New check for future cache-write-after-await reviews**: when a shared/module-level cache is written using data captured before an `await`, always ask "can a DIFFERENT concurrent mutation invalidate the cache while this await is in flight, and if so does the eventual write compare freshness before landing, or does it blindly overwrite?" — a sync-before-await guard (existing precedent) only solves same-operation double-fire, not cross-operation staleness.

### 2026-07-16 — BIN-522 notes/follow-list test-coverage batch: clean, all 4 acceptance criteria met; a concurrent process editing the SAME files mid-review produced a transient stray `console.log` + flaky test run — re-run before filing a "bug"
Reviewed `WatchlistContext.tsx`'s `updateNotes` no-op skip (`current?.notes != null ||
Object.keys(visFields).length > 0` gates the item-doc `batch.set`), `useFollowList.helpers.ts`'s
removal of the `'ghost'`-drop path (BIN-505 made `users/{uid}` owner-locked, so the projection
read can no longer distinguish "deleted" from "private" — both now render the real
`followFallback` row instead of being silently dropped; dangling docs are still reaped by the
weekly `reclaimOrphanFollows` sweep, unchanged), and `publicProfile.test.ts`'s new pin-tests for
`syncMyPublicProfile`'s pre-existing displayName/bio/photoURL clamping. Traced `current.notes`
in `updateNotes` against `docToItem` (raw per-doc `data.notes`, NOT the `itemsWithTags`-merged
display value) — confirmed the guard reads the correct pre-migration signal. All 4 `tasks/
todo.md` BIN-522 acceptance criteria verified line-for-line against the diff. `tsc --noEmit` and
`eslint` clean (only pre-existing unused-arg warnings in mock signatures).
**Process note**: a first `vitest run` of `WatchlistContext.test.tsx` showed 2 real-looking
failures in the two new BIN-522 tests (`setDoc` called 2× instead of the asserted 1×); tracing
the cause found a stray `console.log('DEBUG setDoc calls', ...)` had appeared INSIDE the test
file's assertion block between my initial `Read` (which didn't have it) and that test run — and
had disappeared again by the next `git diff --stat` a few tool-calls later, with the diff's
insertion-count fluctuating 134→135→134 across that window. This confirms a concurrent
process/agent was actively iterating on this exact file WHILE this review ran (consistent with
the existing "Samtidig loop = jobba på main" precedent) — the failures were a mid-edit read
artifact, not a real regression: 3 consecutive clean re-runs after the count settled back to 134
all passed 30/30. **Lesson for future reviews**: a failing test on a first run is not itself
proof of a bug — if a file's `git diff --stat` insertion/line count is unstable across two reads
moments apart, treat any observed failure as suspect and re-run clean (ideally 2-3×) before
filing it as a finding; a genuine bug reproduces stably, a concurrent-edit artifact does not.

### 2026-07-17 — BIN-510 retry (post-revert): dropping the TTL removed the auto-heal but not the underlying TOCTOU — a "deliberately different shape" retry can still carry the same defect class under a new name
Reviewed `src/lib/firebase/groups.ts`'s second BIN-510 attempt (first attempt was reverted
2026-07-16, commit `3644a22`, "failed sprint verification" with no defect recorded) + new
`groups.test.ts`. The new design replaces the reverted TTL-cache with a pure "confirmed-empty
only" `Set<uid>` (`knownZeroGroupsUids`), explicitly designed so the cache can only ever cause a
SKIP (never a stale-data read) and is invalidated by every local mutation (create/join/accept/
remove/delete) — a genuinely more defensible shape than a blind TTL. But the module-level cache
write in `syncProgressToGroups` (`markGroupsKnownEmpty(uid)` after `await getDocs(...)` resolves
empty) is still a classic write-after-await race: if a DIFFERENT concurrent mutation on the same
uid (e.g. `createGroup` from a "create your first group" modal) commits and calls
`invalidateGroupsCache(uid)` WHILE the scan's `getDocs` (started before the mutation, using
pre-mutation server state) is still in flight, the scan's stale "empty" result can land and
re-write `markGroupsKnownEmpty(uid)` AFTER the invalidate — silently re-poisoning the cache. The
NEW design is actually WORSE on this specific axis than the reverted one: no TTL means no
auto-heal, so a poisoned entry can persist for the rest of the session (until another local
mutation or a `subscribeToMyGroups` mount happens to touch that uid), permanently disabling
group-progress-sync rather than just delaying it up to 5 minutes. The code's own "known, accepted
gap" comment only names the cross-TAB/device case — it doesn't cover this same-tab, same-module
race, so it reads as an accepted deviation but isn't actually the same gap. None of the 7 new
`groups.test.ts` cases exercise concurrent/overlapping calls (all strictly sequential `await`),
so the test suite provides no evidence this class of bug was closed. **General lesson**: when a
previously-reverted ticket comes back with an explicit "deliberately DIFFERENT shape, not a patch
of the same one" framing, don't let the framing substitute for re-deriving the race from
first principles — a genuinely different mechanism (Set vs TTL-object) can still be vulnerable
to the SAME underlying ordering hazard (stale-scan-write racing a concurrent invalidate) that
sank the original attempt, just manifesting with a different failure shape (permanent vs
time-bounded). Always ask, for any cache write that follows an `await`: "can a concurrent
mutation's invalidate fire and lose the race against this specific write?", independent of
whether the caching mechanism itself changed.

### 2026-07-18 — BIN-544 recap coverage-gap logging: useEffect dep array on a raw object prop re-fires even though its own React Query keys are primitive-scoped, double-counting a genuine miss
Reviewed the unstaged `useRecap.ts` addition (a `useEffect` that calls `logRecapMiss(tmdbId)`
when the per-show coverage index resolves empty or the boundary walk-back finds no covered
recap). The `isSuccess`-gating itself is correct (matches the file's own documented
false-negative precedent on `SeasonRecapResult.isLoading`). The bug: the effect's dependency
array includes the `boundary` PROP object directly (`EpisodeRef | null`), while both `useQuery`
calls in the same hook key on `boundary?.season`/`boundary?.episode` (primitives) — so a parent
re-render producing a value-equal-but-new-identity `boundary` object never triggers a refetch
(React Query's cached `data`/`isSuccess` stay stable) but DOES re-run the effect (`useEffect`
diffs its array by reference, independent of what the query layer considers "the same key"),
re-firing `logRecapMiss` for an already-logged miss. Traced a concrete trigger: the parent's
`useMemo`-derived boundary depends on a `useCallback` keyed on Firestore `onSnapshot` state,
and a single write to that doc typically fires the listener twice (local optimistic + server
ack) with a fresh state object each time even when the resulting values are unchanged — a very
ordinary user action (marking an episode watched) can double-log a stale miss. **General check
for future dep-array reviews**: whenever an effect/memo's dependency array mixes (a) a raw
object/array PROP passed down from a parent, and (b) React Query state whose OWN query key
already narrows that same prop to primitives, verify the effect depends on the SAME primitives
the query key uses — not the parent object — or a value-equal parent re-render will re-fire the
effect even though the query layer correctly did nothing.

### 2026-07-18 — BIN-535/531/536 AuthContext batch: transaction race fix + rollback mirror both clean; a same-named local cap constant drifted from the value it claims to mirror
Reviewed the unstaged `AuthContext.tsx`/`AuthContext.test.tsx` diff (BIN-535 wraps
`ensureUserProfile`'s create-branch getDoc+setDoc in a `runTransaction` to close a real
race against `register()`'s own setDoc on the same `users/{uid}` doc; BIN-531 gives
`setProviderRenewalDay` the same synchronous-mirror-rollback-on-write-failure shape as
the established `setProviderCost`/`setProviderCampaign` BIN-516 precedent; BIN-536 adds
a `limit(MY_GROUPS_LIMIT)` bound to `updateProviders`' array-contains groups query).
All three confirmed correct: the transaction's `tx.get` re-reads inside the atomic
scope so a doc that appeared since the outer `getDoc` is caught (not clobbered) and
falls to the existing-profile path; the non-transactional outer `getDoc` is kept as a
fast-path so a normal returning-user login doesn't pay transaction-contention overhead;
the renewal-day rollback uses the identical `if (ref.current === next) ref.current = prev`
identity-guard as its precedent (survives a concurrent edit that already moved the ref).
`tsc`/`eslint`/vitest (10/10 in this file) all green.
**One real, non-blocking finding**: `AuthContext.tsx` declares its own local
`const MY_GROUPS_LIMIT = 500`, justified in-comment as "mirrors useFollow.ts's
FOLLOWING_LIMIT" — but `groups.ts` already has an identically-NAMED
`const MY_GROUPS_LIMIT = 100` for the exact same query shape (array-contains on
`memberUids`), whose value is NOT arbitrary: its own comment ties it directly to
firestore.rules' actually-enforced ceiling (`memberUids.size() > 100` blocked on
join/accept, so no user can literally have more than 100 memberships). AuthContext's
500 is harmless today (500 > 100, so it can never truncate a real result — the rules
ceiling makes it moot) but is the wrong precedent to cite: it should defer to
groups.ts's rules-tied 100 (ideally via an exported shared constant), not re-derive a
number by analogy to an unrelated follows-cap that has no enforced ceiling behind it.
**General check for future review**: when a new local constant is named identically to
an existing constant in another file for the same conceptual bound (same collection,
same query shape), treat that as a same-source-of-truth candidate — verify whether the
existing one is tied to something authoritative (a rules ceiling, a schema limit) before
accepting a freshly-guessed value under the same name, same discipline as the
established `TMDB_STALE` shared-queryKey-constant rule, generalized beyond React Query
keys to any cross-file "cap" constant.

### 2026-07-18 — BIN-532 groups.ts atomic-batch createGroup: CONFIRMED BROKEN against real Firestore rules — get()/exists() in security rules never see sibling writes from the SAME batch OR transaction, even for a doc create depending on ANOTHER doc created in that same commit
Reviewed `src/lib/firebase/groups.ts`'s BIN-532 diff (working tree, unstaged) — its headline
change collapses `createGroup`'s previous TWO sequential awaited writes (`addDoc` group, then
`setDoc` owner's `members/{uid}` doc) into ONE `writeBatch` (`doc(collection(db,'groups'))` for
a client-generated id, `batch.set` both docs, single `batch.commit()`), explicitly to close an
orphaned-group risk if the second write failed after the first succeeded. **This breaks group
creation entirely.** The `members/{memberUid}` create rule (`firestore.rules:1049`) gates on
`request.auth.uid in get(/databases/.../groups/$(groupId)).data.memberUids` — and Firestore
Security Rules' `get()`/`exists()` calls NEVER see other writes queued in the SAME commit,
whether that commit is a `writeBatch` or a `runTransaction` (verified both — both fail
identically), and whether the referenced doc is being newly CREATED or merely UPDATED in that
same commit (verified both shapes). For a doc that doesn't exist prior to the commit (true for
createGroup, since the whole group is new), the `get()` call doesn't even return `exists:false`
gracefully — it throws `Service call error. Function: [get]` because Firestore can't resolve a
consistent snapshot for a document whose creation is itself part of the in-flight, unresolved
commit; the WHOLE batch is denied with `PERMISSION_DENIED`. **Verified empirically** (not from
memory/docs alone) via 5 throwaway probe tests against the real `firebase emulators` Firestore
rules engine (`FIRESTORE_EMULATOR_HOST` + `@firebase/rules-unit-testing`, deleted after use —
never commit scratch rules-probes): (1) `createGroup`'s exact batch shape → `Service call error`
+ denied; (2) the pre-diff sequential `addDoc` + separate `setDoc` shape → succeeds cleanly,
isolating batching (not schema/payload) as the sole cause; (3) the SAME shape via
`runTransaction` instead of `writeBatch` → identical failure, ruling out "use a transaction
instead" as a fix; (4) as a side-finding while isolating the mechanism, the file's OTHER two
pre-existing (NOT part of this diff) batched group-join flows — `joinGroupViaToken` step 2 and
`acceptGroupInvite` — build the IDENTICAL shape (`batch.update` on the group's `memberUids`
arrayUnion + `batch.set` on `members/{uid}` in the SAME commit, gated by the SAME `get()`-based
member-create rule) and reproduced the SAME `PERMISSION_DENIED` end-to-end against the emulator
when replicated faithfully (real hash-gated `joinAttempts` seed included) — flagged as a
"needs production verification, not confirmed as this diff's fault" finding since
`firestore-rules.test.ts` has ZERO direct coverage of the `members/{memberUid}` create rule
(grepped — confirmed absent) despite the file's own comment claiming the group-permission block
"previously had ZERO rule tests" was closed (that closure covered the top-level `groups/{id}`
create/update rules, BIN-276/BIN-327, not the `members` subcollection). `groups.test.ts`'s
BIN-532 test suite fully mocks `firebase/firestore` and asserts only mock-call shape (batch
called once, 2 sets, 1 commit) — it is structurally blind to this class of bug and passed 8/8
despite the real breakage; confirmed by running it standalone. **General principle for every
future review touching Firestore write code**: whenever a diff collapses two previously-
SEPARATE (sequentially awaited) writes into ONE atomic commit (`writeBatch` or
`runTransaction`), check whether ANY of the combined writes' security rules read a document
that's ALSO being written earlier in that SAME commit via `get()`/`exists()` — if so, the rule
will evaluate against PRE-commit state (or error, if the doc is being created fresh in that
commit), not the hypothetical post-commit state, and the atomicity "fix" will make the writes
fail outright rather than just risk a rare partial-failure window. This is NOT something a
mocked Firestore unit test can catch — it requires the rules emulator (`test:rules`); when a
diff's commit message frames a change as "atomic write closes an orphan-doc risk," treat that
as a trigger to verify against the REAL rules engine, not just read the JS for shape. Recommend,
in priority order: (a) revert to the pre-diff sequential-write shape (small orphan-doc window,
but the previously-shipped, actually-working behavior) unless a genuinely atomic path is needed,
in which case (b) a trusted Cloud Function (admin SDK, bypasses client rules) is the correct
mechanism for true cross-document atomicity gated on rule-dependent cross-refs — never
`writeBatch`/`runTransaction` alone when a sibling write's rule needs to observe a doc created
earlier in the SAME commit.

### 2026-07-18 — BIN-532/BIN-510 groups.ts re-review: revert to sequential writes PROVEN against real rules emulator (closes the "structurally blind mock" gap); cache-invalidation load-bearing-ness now test-proven; PASS, supersedes the 2026-07-18T14:42:46Z FAIL
Re-reviewed `src/lib/firebase/groups.ts` + `groups.test.ts` after the prior FAIL (BIN-532's
atomic batch confirmed broken against the real rules emulator; BIN-510 cache-invalidation gap).
Both root causes are now closed, not just patched:
1. **createGroup/joinGroupViaToken/acceptGroupInvite are back to sequential awaited writes**
   (no `writeBatch`), exactly the "(a) revert to pre-diff sequential shape" recommendation from
   the original 2026-07-18 FAIL entry above. Critically, this time the fix is backed by NEW
   direct emulator coverage in `firestore-rules.test.ts` (`describe('groups members/{memberUid}
   create — batch vs sequential (BIN-532/BIN-533)')`) — 6 tests, `assertFails` on the batched
   shape for all three flows (create/join/accept) and `assertSucceeds` on the sequential shape
   for all three. I ran this against a REAL Firestore emulator (Java present, connected to an
   already-running emulator on :8080 rather than `firebase emulators:exec` since the port was
   held by a concurrent session — `npx vitest run --config vitest.rules.config.ts` picks up
   `FIRESTORE_EMULATOR_HOST` env or defaults to `127.0.0.1:8080`, so pointing at an
   already-running emulator started by a different process works fine): 6/6 pass, full rules
   suite 199/199. This closes the exact gap the original FAIL named ("`firestore-rules.test.ts`
   has ZERO direct coverage of the `members/{memberUid}` create rule") — the mocked
   `groups.test.ts` alone would still be structurally blind to this bug class; the emulator test
   is what actually proves the fix.
2. **`invalidateMyGroupsCache()` is called at exactly the 3 membership-add sites** (createGroup,
   joinGroupViaToken, acceptGroupInvite — confirmed via grep, matches the file's own comment) and
   a new test (`createGroup river cachen så nästa syncProgressToGroups-anrop tvingar en FÄRSK
   query...`) proves it's load-bearing by driving the exact failure sequence a missing
   invalidation would produce: warm the cache empty → createGroup → assert the NEXT
   `syncProgressToGroups` call re-queries (not cache-hit) and actually writes progress to the new
   group. This is the mutation-testing-by-construction pattern (test the ABSENCE of a bug by
   showing the specific sequence that would expose it), stronger than a bare "was called" spy
   assertion.
3. **`MY_GROUPS_LIMIT` dedup**: now exported from `groups.ts` (rules-tied value, correctly
   documented as bounding members-PER-GROUP not groups-per-user, correcting the prior
   misleading comment) — closes the 2026-07-18 AuthContext-batch finding about a same-named,
   differently-valued, wrongly-justified local constant.
4. **One residual, non-blocking, already-precedented finding**: the module-level `myGroupsCache`
   (now a full TTL cache of actual group-id lists, `MY_GROUPS_TTL_MS=5min` — a THIRD design
   iteration, having gone TTL-cache → "known-zero-only" Set → back to TTL-cache-of-real-data)
   still has the same write-after-await race the 2026-07-16 and 2026-07-17 entries above already
   analyzed in depth: a concurrent membership-add's `invalidateMyGroupsCache` can fire while an
   in-flight `syncProgressToGroups` scan (started on pre-mutation state) is still awaiting, and
   the scan's stale write can land after the invalidate, re-poisoning the cache. Distinct from
   the 2026-07-17 Set-design finding: THIS design self-heals within the 5-min TTL (bounded
   staleness), not permanent — objectively less severe than what was already accepted as
   "low real-world likelihood" twice before. Given (a) this exact race class has now been
   independently re-derived and reached the same "low severity, product-acceptable" conclusion
   three separate review passes in a row, (b) the current shape is the LEAST severe of the three
   iterations reviewed, and (c) it only affects a fire-and-forget best-effort sync (never data
   loss, never a crash) — this is not FAIL-worthy. Recommend Malin's team add this to
   `accepted-deviations.md` so a 4th review pass doesn't re-litigate it from scratch; noting it
   here in the meantime.
**General lesson**: when a review's original FAIL cited "the mocked unit-test suite is
structurally blind to this bug class, only the rules emulator can catch it," verify the RE-fix
by finding (or requiring) NEW coverage in the emulator-backed suite specifically, not just a
re-read of the mocked suite — a green mocked suite proves nothing new here, it was already green
on the broken version.

### 2026-07-20 — BIN-560 mediaTypeDocId extraction (streamingOffers/weeklyDigest/availableNotify/communityRatings): clean 3-way dedup, no correctness findings; marker-naming lesson reconfirmed
Reviewed the new `functions/src/shared/mediaTypeDocId.ts` (extracts the `${mediaType}_${tmdbId}`
template + unknown→'tv' normalization previously duplicated in `availableNotify/logic.ts`,
`communityRatings/index.ts`, and now also used by `streamingOffers`/`weeklyDigest`'s BIN-523/545
namespacing fixes) plus the BIN-523 doc-id namespacing itself (`streamingOffers`'s `readExisting`/
`selectRefreshBatch`/write-path keyed on the doc's own `tmdbId`/`mediaType` FIELDS, never a parsed
id; `weeklyDigest.readOffers`'s two-pass namespaced-then-legacy-bare-id fallback, accepted only
when the legacy doc's `mediaType` field matches; `useStreamingOffers.ts`'s matching client-side
fallback; BIN-545's `dedupeIntent`/`selectRefreshBatch` switch from bare-tmdbId `Map`/`number[]`
to `(mediaType,tmdbId)`-keyed `WorkItem[]`). All correct: `communityRatings` explicitly guards
`mediaType !== 'movie' && mediaType !== 'tv'` and returns BEFORE calling the shared helper (so its
unknown→'tv' default can never fire there, matching its own comment — the aggregate can't be
un-drifted so it skips rather than guesses); `dedupeIntent`'s own unknown→'movie' default is
pre-existing behavior (unchanged by this diff) and provably dead in production since its only
caller (`readWorkSet`) has already filtered through `isIntentTitle`, which requires an exact
`'movie'`/`'tv'` match — confirmed by tracing, not just trusting the comment. `readExisting`
correctly treats a doc with an unusable `mediaType` field as never-checked (`continue`, no
`ExistingOffer` pushed) rather than crashing or guessing. `selectRefreshBatch`'s `byKey` dedupe of
`existing` picks the FRESHEST `checkedAt` when both a legacy bare-id doc and a namespaced doc exist
for the same title — test-locked, prevents a stale leftover from re-jumping the refresh queue.
`weeklyDigest.readOffers` pass-2's bare-id fallback correctly groups multiple titles wanting the
SAME bare doc (movie N + TV N) and lets the doc's own `mediaType` field decide which (at most one)
claims it — same discriminating-oracle test pattern as streamingOffers. The diff also self-files
its own known, deliberately-deferred gap in an inline comment rather than silently shipping it:
`priceHistory` stays bare-tmdbId-keyed (movie/TV price-graph collision), explicitly filed as
BIN-562 rather than bundled into this diff (correctly reasoned: touches `priceDropNotify` +
`usePriceHistory` too, its own reader-fallback story). `tsc --noEmit`, `eslint`, and the two
targeted vitest suites (43 tests, incl. fresh discriminating oracles for both the streamingOffers
and weeklyDigest collision classes) all green; zero unstaged drift on any reviewed file.
**Process note reconfirming the 2026-07-14 "read the marker, don't trust its existence" lesson**:
arrived at `.claude/state/code-review-done.marker` to find it already held a FRESH, same-run PASS
verdict for a completely different surface (AuthContext.tsx/useOptimisticMirrorField.ts, BIN-561) —
a parallel review pass in the same sprint. Appended this verdict as a second line naming its own
files rather than overwriting (which would have silently un-reviewed AuthContext) — and explicitly
named the THIRD surface present in the same staged diff (firestore.rules BIN-540/542,
GroupPageClient.tsx, groups.test.ts) as NOT covered by either verdict, so a future gate-check
doesn't misread "marker is fresh" as "the whole staged diff was reviewed."

### 2026-07-12 — BIN-185 recaps foundation: boundary core + untrusted-wiki-text validator both sound; sanitize false-positives are acceptable given graceful degradation
Reviewed `src/lib/recaps/{boundary,sanitize,types}.ts` + tests + `firestore.rules` recaps clause.
`episodesUpToBoundary` is correct across every asked edge: season rollover (earlier seasons
included in FULL regardless of episode number, only the boundary season is episode-capped), gaps
(uses the inventory's actual episode numbers, never a computed range), specials (`season < 1`
excluded unconditionally, even when boundary is in a real season), and boundary-beyond-available
(`episode > boundary.episode` just yields everything present ≤ boundary, no crash). A boundary in a
season NOT present in the inventory (e.g. seasons 1,3 present, boundary S2) correctly returns all of
S1 and excludes S3 — "everything strictly before the boundary season" — because the `season >
boundary.season` skip is a pure numeric compare, not membership. Final `.sort((a,b)=>season||episode)`
makes output order independent of inventory order (untested but present). No dedupe, but duplicate
seasons/episodes are a data-integrity concern, not this pure function's job.
`validateRecapText`: the real security control is that the client renders `text` as PLAIN TEXT
(never dangerouslySetInnerHTML / markdown), so the regex validator is DEFENSE-IN-DEPTH, not the sole
gate — which is why its known false-NEGATIVES are harmless: `<!-- -->` (starts `<!`, not `[a-zA-Z]`,
skips HTML_TAG), reference-style `[a][b]` links (no URL), HTML entities — all inert as plain text.
Two low-severity false-POSITIVES worth knowing but NOT worth blocking: (1) `system\s*:` / `assistant\s*:`
in the INJECTION regex match legit Swedish narrative that uses "system:" / "assistant:" with a colon
(e.g. "ett nytt system: allt förändras"); (2) HTML_TAG `/<\/?[a-zA-Z][^>]*>/` matches an angle-bracketed
word like "<här>". Both are acceptable because a rejected recap just means that one episode gets NO
recap (graceful degradation, not user-facing breakage) — an aggressive validator on world-editable
wiki source is the right trade. Don't "loosen" these without a false-positive rate from real recap
corpus. `RecapDoc.generatedAt: Date` with a documented "Timestamp on the wire, client mapper converts"
contract is the standard pattern. `recaps/{id}` rules = `read: if true; write: if false` (Admin-SDK
batch bypasses rules) — correct and matches the `omdbBudget`/function-only-write family; rules test
covers anon+owner read-succeeds and owner/anon create+overwrite-fails. All pure/admin-free, root-testable
(17 tests green), no hex, internal-only strings. No blocking findings.

### 2026-07-12 — BIN-185 recaps re-review: regex-split + URL scheme-less arm + boundary dedupe all correct, prior false-positives resolved without under-matching
Re-reviewed the post-fix delta on `src/lib/recaps/{sanitize,boundary}.ts`. All three fixes sound:
1. **INJECTION split** — the old combined regex matched `system:`/`assistant:` ANYWHERE (the
   false-positive I logged 2026-07-12 on "ett nytt system: allt förändras"). Now `ROLE_MARKER`
   = `/(^|\n)\s*(system|assistant|user|användare)\s*:/i` is line-start-anchored, so an ordinary
   word ending "…operativsystem:" mid-sentence is no longer rejected (verified), while a real
   line-leading `System:` still is. No `\b` needed — the `(^|\n)\s*` anchor is what does the work;
   "systemet var nere" doesn't match because `\s*:` requires the colon right after the role word.
   `INJECTION_PHRASE` (the ignore-previous/you-are-now/reveal-prompt set) stays match-anywhere. The
   anchoring does drop mid-line `system:` role markers as a signal, but that's the intended trade and
   plain-text render is the real control. One residual: a bare-`\r` (old-Mac) line start isn't caught
   by `(^|\n)` — non-issue, no modern source emits bare `\r`.
2. **URL_LIKE scheme-less arm** — `\b[a-z0-9-]+\.[a-z]{2,}\/\S` catches "spam.example/rea" while the
   `[a-z]{2,}`-letters-only TLD + required `/`-path together reject "3.5/5", "8.5/10", "t.ex.",
   "kap. 3/4", "24/7", "och/eller", and even single-letter-TLD abbrevs like "bl.a/x" (the `{2,}`
   saves it). Confirmed via node. Under-match by design: a bare scheme-less domain with NO path
   ("spam.example.") escapes — acceptable because it renders as inert plain text and requiring a path
   is what kills the "t.ex." false positive. www./http(s) arms unchanged.
3. **boundary dedupe** — post-sort `Set`-based `filter` keying `${season}_${episode}`; removes only
   duplicate refs (TMDB double-listed seasons), never adds one past the boundary, preserves sort
   order (first-occurrence kept on an already-sorted array). Spoiler invariant intact. Comment says
   "sorted so dupes adjacent" but the Set doesn't rely on adjacency — harmless, not worth flagging.
Tests cover all four claimed cases (false-positive-now-allowed, scheme-less-rejected, ratio-allowed,
season-dedupe). 21 unit tests green, working tree clean vs staged index (only unrelated tasks/todo.md
unstaged). No new findings; APPROVED.

### 2026-07-12 — BIN-185 recap story-so-far redesign (textFull + `_season_{n}` docs + season-completeness upload guard): APPROVED, spoiler invariant preserved
Reviewed the schemaVersion-2 delta on `recap-upload.mjs`, `RecapPanel.tsx`, `useRecap.ts`,
`boundary.ts`, `types.ts`. All sound, no blocking findings:
1. **Spoiler-safety of the new "Visa tidigare säsonger" fetch set is airtight.** `priorSeasonNumbers`
   returns `[1..boundary.season-1]` and is called on `coveredBoundary` (the recap's ACTUAL covered
   boundary, which on a fallback hit is ≤ the user's raw boundary), NEVER the raw boundary — so every
   offered season doc is one the user has provably finished (a season `s < coveredBoundary.season`
   means they've watched into a later season). The boundary's OWN season is deliberately excluded
   (covered by `textFull`, which respects the exact episode boundary). Same `boundary.season` gate that
   drives `episodesUpToBoundary`. Test-locked (5 cases incl. never-own-season, never-future).
2. **Season-completeness upload guard is correct.** `missingEpisodesForSeason(covered, season,
   episodeCount)` refuses a `kind:'season'` write unless every episode `1..episodeCount` has a boundary
   doc in the covered-key set. `covered` reuses the merged array returned by `updateIndex` (same run) or
   falls back to reading `recaps/{id}_index` — so boundary docs uploaded in the SAME batch count. Key
   format `"${season}_${e}"` matches both the byShow push and the index storage. Season docs write ONCE
   (`ref.get().exists` check) unless `--force` — non-deterministic regen can't silently clobber. `--force`
   is stripped from argv AFTER the `--unsourced` branch and BEFORE `--index-only` detection; combos work.
3. **No rules change needed** — new `recaps/{id}_season_{n}` docs + the `textFull` field live under the
   existing `recaps/{id}` clause (`read:true; write:false`; Admin-SDK bypasses). Confirmed doc-id can't
   collide with a boundary id (`_season_` middle segment never parses as int_int_int; test-locked).
4. **React/hooks clean:** `useSeasonRecaps` (a `useQueries` over `priorSeasons`) is called
   unconditionally BEFORE the `if (!boundary || !recap || !coveredBoundary) return null` guard —
   Rules-of-Hooks safe; the dynamic `priorSeasons` length is fine for a single `useQueries` call. New
   query key `['recap-season', tmdbId, season]` is unique (no `TMDB_STALE`/collision concern; recaps are
   their own key family, 1h staleTime, in-memory only, correctly NOT in PERSISTED_QUERY_PREFIXES per the
   per-title-data rule). `getDocWithTimeout` is a Firestore getDoc with a manual 10s timeout — the
   established recaps pattern; AbortSignal doesn't apply (not a TMDB fetch). `fullText`/`loadedSeasons`
   computed AFTER the null-guard, so no null-deref on `recap.textFull`. Both new disclosures re-run
   `validateRecapText` on read (defense-in-depth) and render as plain-text children — never
   dangerouslySetInnerHTML. Tokens (ink/ink-2/ink-3, rule/rule-2, surface), Swedish strings, no hex/red,
   not a routed view so no PageHeader recipe. `tsc --noEmit` clean, 53 recaps tests green, working tree
   == index on reviewed files.
**One low-priority UX advisory (NOT blocking):** the "Visa tidigare säsonger" button renders whenever
`priorSeasons.length > 0` (any S2+ boundary), speculatively — it can't know if any `_season_{n}` doc
actually exists without fetching (the recap index lists boundaries, not season docs), so a user on a
show with zero season docs (the common case today — only Grey's S19 has partial coverage) clicks and
lands on the honest empty-state "Inga tidigare säsonger har en sammanfattning ännu" + up to ~N Firestore
reads on that one expand. Asymmetric vs the `textFull` disclosure, which only appears when its content is
already in the loaded recap doc. Acceptable: user-gated, lazy, cached 1h, trivial read cost, honest
empty state. If it ever grates, the cheap fix is to have the index also list which seasons have docs.

### 2026-07-12 — BIN-185 recap season-loading tri-state fix: `!isSuccess` is the correct "not-yet-resolved" gate; render-branch priority makes the refetch-error case safe too
Verified the corrected `useSeasonRecaps` (`src/hooks/useRecap.ts`): `isLoading: enabled && !(results[i]?.isSuccess ?? false)`.
The earlier `isPending`-only pass was a genuine false-negative (a permission-classifier caught it): RQ v5
`status` is exactly one of `pending`/`error`/`success`, so `isPending` settles to `false` on an ERROR the same
as on success — an errored/timed-out `getDocWithTimeout` (10s reject race) with `isPending:false` would have
let `recap===null` masquerade as "doc genuinely absent", surfacing the false "Inga tidigare säsonger…"
empty state. `!isSuccess` is the right fix: `isSuccess === (status==='success')`, so it is false in BOTH
pending and error terminal states — there is NO path where an errored query (no prior data) reads
`isSuccess:true`. Confirmed the empty state in `RecapPanel.tsx` only renders when
`loadedSeasons.length===0 && !seasonsLoading`, and `seasonsLoading = some(isLoading)`, so the empty branch
now requires EVERY season query to have SUCCESSFULLY resolved to a null/absent doc — genuine absence only.
One v5 subtlety I checked and it's safe either way: if a previously-successful query background-refetches
(after the 1h staleTime) and that refetch ERRORS, v5 retains `.data` while flipping `status` to `error`
(→ `isSuccess:false`, our `isLoading:true`). That would light the spinner despite data existing — but it
does NOT show the empty state, because `results[i].data` is still populated → `recap != null` → the
`loadedSeasons.length > 0` render branch wins BEFORE the `seasonsLoading` spinner branch. So the
render-branch ORDER (loaded → loading → empty) is itself a second layer of false-negative protection.
`enabled &&` only matters pre-expand (query not started, `isSuccess` trivially false); inside the
`openSeasons` disclosure `enabled` is always true so `isLoading` reduces to `!isSuccess`. PASS, no findings.

### 2026-07-14 — BIN-185 RecapPanel timeline redesign: two Art. 50 disclosure regressions hiding inside an otherwise-clean UI restructure
Reviewed the "du är här" spine redesign (`expandedSeasons: number[]` replacing the single
`openSeasons` boolean; per-season nodes now individually collapsible on a vertical timeline).
Every correctness/cost guard from the prior design survived the restructure verbatim: the
`!boundary || !recap || !coveredBoundary` guard, `sources.length===0`, `validateRecapText` on
`recap.text`/`textFull`/each season's `text`, `priorSeasonNumbers(coveredBoundary)` (never raw
`boundary`), the missing-episode gap notice, and the per-season lazy-fetch cost condition
(`useSeasonRecaps(tmdbId, expandedSeasons, expandedSeasons.length > 0)` — only expanded seasons
enter the array, matching the hook's documented "positional useQueries" contract; no key/double-
fetch risk since `results[i]` always maps to the SAME render's `seasons[i]`). Two REAL Art. 50
regressions did slip through a pure layout refactor, worth a general lesson: **when a "just
restructuring the JSX" diff moves an AI-disclosure block into a shared sub-component/variable
(here `hereContent`), diff EVERY disclosure instance independently — a refactor can silently
drop one copy while faithfully preserving the others.** Concretely: (1) the `openFull`
("Visa hela säsongen hittills" / formerly "Visa säsongens sammanfattning") block had its own
"AI-genererad sammanfattning" label directly above `{fullText}` pre-diff; the new version keeps
"Kan innehålla mindre felaktigheter" + `RecapSourceCredit` but drops the disclosure label itself.
(2) the old "Visa tidigare säsonger" toggle rendered ONE shared "AI-genererad sammanfattning"
header above ALL mapped season texts (defensible — one disclosure per visible AI-content block);
the new per-season-collapsible design has NO disclosure at all near any season's prose (not even
"Kan innehålla mindre felaktigheter") — only the always-open boundary node at the bottom of the
spine carries it, which can be many collapsed nodes away from a season a user opens in isolation.
Neither is a "delete the whole feature" bug — the recap text still degrades gracefully and never
uses dangerouslySetInnerHTML — but Art. 50 requires the AI-generated-content label to be legible
NEAR the content, and "near" stopped holding once seasons became independently positioned nodes
instead of one contiguous block under one header. Flag any diff that converts a single toggle
covering N items into N independent per-item toggles: check whether a disclosure/attribution/
legal string that lived ONCE at the group level needs to move to per-item, not just get dropped.
Advisory (non-blocking) alongside the two findings: `priorSeasonNumbers` already returns
ascending order, so `[...priorSeasonNumbers(coveredBoundary)].sort((a,b)=>a-b)` in the panel is a
harmless redundant sort; and the new "Collapse keeps the cached doc; re-expand within the 1h
staleTime is free" comment overstates React Query's actual behavior — `useSeasonRecaps` never
sets a custom `gcTime`, so a collapsed-then-reopened-after-5-minutes season (default gcTime, no
override, while staleTime is 1h) evicts from cache and refetches; not a new bug (the underlying
hook is unchanged, unowned by this diff) but the new comment's "free" claim is inaccurate for any
collapse longer than ~5 min. `tsc --noEmit` clean, 4/4 new `RecapPanel.test.tsx` tests green
(interaction coverage only — doesn't exercise the gap notice, `openFull`, or the two Art. 50
gaps above; acceptable for THIS review since test depth is `binge-test-reviewer`'s gate).

### 2026-07-14 — BIN-185 RecapPanel timeline re-review: all 5 fixes (dead-end nodes, infinite spinner, boundary-last, disclosure triplication, redundant enabled flag) confirmed correct; found one narrow residual not worth blocking
Re-reviewed the fix-up commit after the same-day timeline-redesign review logged the Art. 50
disclosure-triplication regression. All 5 requested fixes verified present and correct:
`useSeasonRecaps(tmdbId, priorSeasons, open)` passes the FULL prior-seasons list gated on the
panel's `open` state (not `expandedSeasons.length > 0`); `loadedSeasons` filters out any season
without a valid attributed recap so no dead-end node renders; `DisclosedRecapProse` is now the
SOLE emission site for the AI-genererad-sammanfattning label + caveat + `RecapSourceCredit`,
used identically at all three sites (boundary node, `openFull`, per-season node) — and per-season
nodes now correctly credit their OWN `seasonRecap.sources` instead of the old aggregated-across-
all-seasons credit block, an accuracy improvement over the pre-redesign version. One narrow
non-blocking residual: `isSeasonRecapLoading` (in `useRecap.helpers.ts`, unchanged/pre-approved)
conflates pending and terminal-error into `isLoading:true` forever — if EVERY prior season
permanently errors (not "absent", which resolves cleanly), the inline loader spins indefinitely.
Accepted because `hereContent` (the boundary story-so-far, the actual payload) still renders
alongside it in every branch — materially different from the original "core content blocked"
bug class — and the scenario requires a genuine repeated read failure against a `read:true` rule,
not mere absence. `tsc --noEmit`, `eslint`, and 8/8 `RecapPanel.test.tsx` all green; zero
unstaged drift on either touched file at review time.

### 2026-07-14 — BIN-185 RecapPanel timeline final pass: unified single-`<ol>` render converges clean, no findings
Third same-day review of this file, after the timeline-redesign review (Art. 50 disclosure
triplication regression) and the fix-up review (5 fixes confirmed) both logged above. This pass
reviewed the follow-up simplification that collapsed the old `priorSeasons.length > 0 ? <ol> :
<div>` conditional into a SINGLE always-`<ol>` container, with the boundary `NodeRow` as the
first JSX child (before the `loadedSeasons` map) rather than a separately-branched element.
Verified all three shapes render correctly through the one structure: season-1 show
(`loadedSeasons` empty → boundary `NodeRow` gets `last={true}`, no dangling connector line, sole
node — same visual shape as the mid-load/offline case, by design); multi-season loaded (boundary
`last={false}` draws a connector down to the first prior-season node, `[...loadedSeasons]
.reverse().map(...)` renders descending/most-recent-first, each node's `last={i === arr.length -
1}` only true for the oldest/final one); mid-load/offline (in-flight or permanently-errored
season queries have `recap == null` so `loadedSeasons` filters them out identically to "empty" —
no spinner, no dead-end row, boundary content still renders standalone). Confirmed unchanged from
prior passes: `loadedSeasons` filter (`recap != null && sources.length > 0 &&
validateRecapText(...).ok`), `DisclosedRecapProse` as the sole disclosure-emission site at all 3
call sites (boundary story-so-far, `openFull`, per-season node — each carries the EU AI Act
Art. 50 label + caveat + its own `RecapSourceCredit`), `priorSeasonNumbers(coveredBoundary)`
(never raw `boundary`), all three early-return guards (`!boundary||!recap||!coveredBoundary`,
`sources.length===0`, `!validateRecapText(recap.text).ok`) sitting AFTER `useSeasonRecaps` +
all three `useState` calls (Rules-of-Hooks safe — no new hook introduced, no guard moved), and
`priorSeasons` still used as the direct `useSeasonRecaps` fetch arg (not unused despite the
render no longer branching on its `.length`). Boundary-above-prior-seasons is structurally
guaranteed by JSX child order inside one stable `<ol>` — the map result is always the second
group of children, so no async season resolving can insert itself above the boundary node.
`LoadingView` import fully removed with zero remaining references (grepped clean — no orphaned
import). Design tokens all valid (`acc`/`acc-soft`/`acc-deep`, `ink`/`ink-2`/`ink-3`,
`rule`/`rule-2`, `surface`, `bg-2`), Swedish strings throughout, `aria-expanded` on all three
disclosure/toggle buttons. `tsc --noEmit` clean, `eslint` on both touched files clean, 9/9
`RecapPanel.test.tsx` tests green (including a dedicated `compareDocumentPosition` DOM-order
assertion for boundary-above-seasons and a season-1-only-node case), zero unstaged drift on
either file (`git diff` empty against the staged index). No findings — ship as-is. This closes
the same-day review loop for the timeline redesign; no further re-review needed unless the render
structure changes again.

### 2026-07-14 — BIN-495 markSeasonUnwatched bulk-write consolidation: N-parallel-writes → 1-write refactor is safe when the merge key-set exactly matches the old per-item loop's key-set
Reviewed `useEpisodeProgress.ts`'s new `markSeasonUnwatched(season, episodeNumbers)` (single
`setDoc({seasons:{[season]: {...episodeNumbers}}}, {merge:true})`) replacing
`useEpisodeProgressWithSync`'s old `Promise.all(episodeNumbers.map(ep => markEpisode(season, ep,
false)))`. Confirmed equivalent and correct by checking three things, which generalizes to any
future "collapse N per-item Firestore writes into 1 bulk merge write" diff in this codebase: (1)
Firestore's nested-map `merge:true` is recursive (already relied on by the pre-existing
single-episode `markEpisodeWatched`, which merges one `seasons.{s}.{e}` leaf without wiping
sibling episodes/seasons) — so writing multiple leaf keys in one call is exactly equivalent to N
separate one-leaf-key calls, just atomic and 1/N the write cost; (2) the bulk call's key-set must
be IDENTICAL to what the old loop iterated over — traced the real caller
(`SeasonEpisodePanel.tsx`'s "Avmarkera alla" button passes `episodes.filter(isWatched).map(ep =>
ep.episode_number)`, i.e. only currently-watched episodes, matching the old loop's input exactly);
(3) any post-write "recompute derived state" step (here: `highestWatchedPosition` re-deriving
`lastWatchedSeason/Episode` from the pre-onSnapshot-landing `progressRef`) must still be valid
under the new atomicity — it was, because this call excludes the WHOLE season from consideration
(`excludeSeason`), so the known stale-ref timing gap that matters for single-episode unmarks
(scoped `exclude: {season,episode}`) is a non-issue at season granularity. Bulk-write consolidations
are a net win for the Blaze-cap cost directive; the check that actually matters is key-set parity
with the code being replaced, not the merge mechanics (already proven safe by prior art in the
same file). No test file exists for either hook (pre-existing gap, not introduced here) — flagged
as advisory only, not blocking (test depth is `binge-test-reviewer`'s gate).


### 2026-07-11 — BIN-360 second-pass re-review: 4 xhigh-review deltas (skipKey mediaType-scoping, timezone revert, 2 copy fixes) all confirmed correct
Follow-up to the same-day earlier BIN-360 entry above (which validated the first 3 findings). A
subsequent xhigh review applied 4 more targeted fixes on top of an already-passed diff; re-verified
each in isolation rather than re-reviewing the whole file: (1) `skipKey` widened from `${uid}:${tmdbId}`
to `${uid}:${mediaType}:${tmdbId}` — necessary because TMDB movie and TV ids are independent
namespaces (same numeric id can denote both), so an unscoped key let a movie's release-day skip
wrongly suppress an unrelated TV show's availability push sharing that id. Checked BOTH call sites
for consistent argument sourcing: the add-site hardcodes `'movie'` (provably safe — `runReleasePhase`
only ever iterates movie owners, confirmed via the `t.mediaType !== 'movie'` filter above it), the
check-site reads `it.mediaType` from the real per-item field. (2) A prior review had over-corrected
`seDigitalReleaseDates` to convert the release_date THROUGH a Stockholm timezone; that was reverted
back to `rd.release_date.slice(0,10)` (stated calendar date, with a `length >= 10` guard) — correct
per TMDB's data model (release_date is a calendar date, not a precise instant); timezone math
correctly stays confined to the CALLER's `today = stockholmDateString(now)` comparison target, not
the source data. A dedicated test (`'uses the STATED calendar date, not a timezone-shifted instant'`)
locks this in with a `22:00Z` fixture that must resolve to the same day, not roll forward. (3+4) Two
copy corrections — push body "går att streama" → "finns digitalt" (TMDB type-4 can be TVOD rent/buy,
not always flatrate) and persistent inbox-card meta "Släpps digitalt idag" → time-neutral "Digitalt
släpp" (the card persists for days after the release date, so a day-specific claim goes stale while
still displayed — the one-shot PUSH correctly keeps "idag" since it only fires same-day). Pattern for
re-reviewing "verify only these N deltas" requests: check each delta against its call sites/consumers
individually (don't assume "small fix" = "no blast radius") — the skipKey widening in particular
needed BOTH mutation sites traced for argument-order/source consistency, not just the type signature.

### 2026-07-09 — `vi.fn<typeof someFn>()` is the correct Vitest 4 generic (not the old tuple form)
The repo's installed Vitest is `^4.1.5` (`@vitest/spy`'s `fn<T extends Procedure | Constructable =
Procedure>(originalImplementation?: T): Mock<T>`), so `vi.fn<typeof detectBundleArbitrage>()` — passing
the whole function type as the single generic arg — is correct and type-safe (confirmed against
`node_modules/@vitest/spy/dist/*.d.ts`). This is the first use of this exact pattern in the repo
(`useSubscriptionAdvisor.test.ts`, BIN-439); do not flag it as using an outdated Vitest 1/2-era
`vi.fn<Args, Return>()` tuple signature — that form does not apply here. Also reconfirmed:
`selectBundleSuggestions(enabled, owned, costSettings, bundles, now, detect=detectBundleArbitrage)`
extracting an inline `enabled ? engine(...) : []` ternary into a pure, injectable-detector helper is a
zero-behavior-change refactor when the ternary branches are copied verbatim and the hook's `useMemo`
dep array is left untouched — the correct way to add hook-wiring test coverage (gate + exact
forwarded args) without duplicating the engine's own exhaustive test suite.

### 2026-07-09 — SavingsPage BIN-442 outage-fallback branch: verified correct end-to-end (hook → page)
`src/app/savings/page.tsx`'s `advisor.providers.length === 0` branch now checks
`advisor.bundleSuggestions.length > 0` first and renders `BundleArbitrageCard` instead of the
"Inga tjänster tillagda än" `EmptyState`. Traced the full chain in `useSubscriptionAdvisor.ts`:
`providers` (`providerAdvisories`) zeroes via the `if (hasError && shows.length === 0) return {
providers: [], ... }` guard on a total TMDB fetch failure — even when `myProviders` is non-empty.
`bundleSuggestions` is computed by a SEPARATE `useMemo` calling `selectBundleSuggestions(enabled,
myProviders, ...)`, which never touches `shows`/TMDB at all — gated only on `enabled` and
`ownedProviderIds` (raw `myProviders`). So `bundleSuggestions.length > 0` can only be true when
the user genuinely owns ≥2 bundle-eligible providers, i.e. exactly the "TMDB is down but the user
demonstrably has services" case the comment describes — never a false-positive for a truly
service-less user (empty `myProviders` → `detectBundleArbitrage([])` → `[]`). This closes the loop
from the 2026-07-09 hook-level entry above (BIN-439 `selectBundleSuggestions` wiring) to its first
real UI consumer (BIN-442). No JustWatch attribution needed on this fallback branch —
`BundleArbitrageCard` shows bundle/vendor pricing only, never TMDB `watch/providers` data. Pattern
for future outage-fallback branches: verify the "safe" data source's `useMemo` deps genuinely
exclude the failing source, don't just trust the comment.

### 2026-07-11 — BIN-360 releaseNotify: unguarded per-user loop has no error isolation, unlike every other notify function's Promise.allSettled/try-catch pattern
`runReleasePhase` (`functions/src/availableNotify/index.ts`) iterates `for (const [tmdbId, {title, uids}]
of byMovie) { ...; for (const uid of uids) { ...; await sendPushToUser(...); } }` with NO per-title
try/catch and NO `Promise.allSettled` around the per-uid body — unlike every sibling notify function:
`processTitle`'s per-user loop wraps in `Promise.allSettled`, and its CALLER wraps each title in its own
try/catch (`availableNotify: title ${tmdbId} failed`); `episodeNotify`/`priceDropNotify` both wrap
recipients in `Promise.allSettled`. `sendPushToUser` (push.ts) has NO internal try/catch either — its
Firestore reads (`users/{uid}`, `fcmTokens`) and `messaging.sendEach` can throw on any transient
Firestore/FCM error. Because `runReleasePhase`'s ONLY try/catch is the single outer one in the exported
scheduler (`try { releaseSkip = await runReleasePhase(...) } catch { log }`), a throw from ANY single
`stateRef.get()`/`readUserData()`/notification-doc-write/`sendPushToUser()` call for ONE user aborts the
`for...of byMovie` loop entirely — every movie not yet reached in Map-iteration order loses its
"släpps idag" push AND its `digitalReleaseState` marker write for that day. Unlike other notify functions'
misses (which retry cleanly next scheduled run because the trigger condition persists), this one is
DATE-gated (`releasesDigitallyToday(results, today)`) — tomorrow `today` no longer matches the release
date, so the miss is PERMANENT, not deferred. Fix: wrap the per-uid body in try/catch (log + continue) and/or
wrap the outer per-tmdbId loop body in try/catch mirroring `processTitle`'s caller, so one bad push doesn't
cascade to every other movie releasing that day. Also flag in the same diff: the inbox-notification write
(`users/{uid}/notifications/{tmdbId}-release`) is gated behind the SAME `!u.settings.pushEnabled → continue`
that gates the push send — but the established codebase pattern (episodeNotify, weeklyDigestNotify, both
confirmed by direct read) writes the inbox doc UNCONDITIONALLY on the feature-specific opt-in, and only
passes `pushEnabled` into `sendPushToUser` to decide whether the FCM message itself fires. Since
`pushEnabled` defaults to `false` (opt-in), any user who hasn't turned on push gets ZERO in-app indication
a "bevakad" film released today, even though they'd still see episode-release/weekly-digest cards. Check
whether a new notify-function diff's inbox-doc write is gated on the SAME condition as its push send —
if so and no other notify function in the codebase does that, it's very likely an unintentional coupling,
not a deliberate design choice, even when the ticket text says "gated on pushEnabled only" (that phrasing
addressed "no new settings toggle needed for the push," not "no inbox card without push").

### 2026-07-11 — BIN-402 TMDB ToS sweep: self-referential readback gate can write-loop; a single shared freshness stamp is gameable by a partial-field writer; denormalized field VALUE shape must match across writers, not just field NAMES
Three real findings reviewing the sweep's client-side lazy-refresh (`WatchlistContext.refreshTmdbFields`,
`src/lib/watchlist/tmdbFieldsRefresh.ts`, `MoviePageClient`/`TVShowPageClient` effects):
1. **Write-loop race from gating a write on the SAME field it just wrote, read back through Firestore's
   default `serverTimestamps:'none'`.** `refreshTmdbFields`'s guard (`needsTmdbFieldsRefresh`) reads
   `current.tmdbFieldsRefreshedAt` off `items` (the watchlist `onSnapshot` state). Firestore's local/optimistic
   echo of a pending `serverTimestamp()` sentinel resolves to `null` (default snapshot options, no
   `serverTimestamps:'estimate'`) until the server ack lands — so the `onSnapshot` fires with the field still
   `null`, `setItems` produces a new array, the `useCallback([uid, items])` gets a new identity, the caller's
   `useEffect([..., refreshTmdbFields])` re-fires, the guard re-evaluates against the still-`null` field, and
   writes AGAIN — a burst of duplicate merge-writes to the same doc for the length of one write round-trip,
   not literally infinite (it self-terminates once an ack finally resolves the field to a real timestamp), but
   real write amplification against the Blaze cap. The established codebase defense for exactly this class
   (session-scoped write, gate reads back a field the write itself sets) is `nextAirReadRepair.ts`'s
   `writtenThisSession` `Set` — a SYNCHRONOUS in-memory mark BEFORE the `await`, so a second call in the same
   tab before the ack lands is a no-op regardless of what the Firestore echo shows. `setRuntime` (the sibling
   lazy-backfill pattern) is immune because its gate reads TMDB response data, not a Firestore-echoed field it
   itself writes — don't assume "same shape as setRuntime" clears a new lazy-refresher; check what the GATE
   reads back from, specifically whether it's downstream of the write it gates.
2. **Denormalized-field-shape parity must be checked on VALUE, not just field name/type.** The lazy-refresh
   effects write `movie.title`/`show.name` (raw TMDB localized string) for the `title` field, but
   `StatusButton`/`addItem` write `preferOriginalTitle(movie.title, movie.original_title)` (prefers the
   Latin-script original over the sv-SE localized title when they differ — an established, deliberate product
   choice, see `src/lib/utils/preferOriginalTitle.ts`). Any title where these diverge (common: dubbed/
   translated Swedish theatrical titles for English content) gets silently overwritten back to the "wrong"
   (localized, not preferred) title the next time the gate fires — and since old library docs have no
   `tmdbFieldsRefreshedAt` stamp, this fires on literally the first post-deploy view of any pre-existing
   library title. When a new writer re-denormalizes a field that ALSO has a display-derivation step elsewhere
   (`preferOriginalTitle`, canonicalization, formatting) in the established writer, diff the exact expression
   both writers use for that field, not just confirm both writers "set title from movie data."
3. **A single doc-level freshness stamp shared across MULTIPLE independent partial-field writers lets any one
   of them "launder" freshness for fields it never touched.** `nextAirReadRepair.buildRepairPayload` (calendar-
   triggered, TV shows only, writes only the CHANGED subset of `{nextAirDate, nextAirCode, nextAirProvider}`
   or `{digitalReleaseDate}`) now also stamps the SAME `tmdbFieldsRefreshedAt` the sweep uses to gate clearing
   the WHOLE `TMDB_DERIVED_FIELDS` block (title/posterPath/providers/genreIds/tmdbStatus/runtime included). A
   TV show the user tracks via the calendar but never opens the title page for gets its nextAir* fields
   correctly refreshed AND, as a side effect, the stamp bumped — which tells the sweep the ENTIRE block
   (including title/providers/genreIds, never actually re-confirmed against TMDB) is fresh, indefinitely, as
   long as episodes keep airing. This undermines the sweep's own compliance purpose (TMDB ToS §1.C, no >6mo
   cache) for exactly the actively-engaged-but-title-page-avoiding user segment. When a shared freshness/
   staleness stamp is bumped by more than one writer, check whether EVERY writer that can bump it also
   refreshes (or at minimum doesn't claim freshness for) the FULL set of fields the stamp gates — a partial
   writer sharing a full-scope stamp is a laundering path. (Neither `docs/data-retention-policy.md`'s BIN-402
   section nor the sweep's own module doc addresses this gap — it wasn't a deliberate accepted tradeoff,
   it's an unnoticed interaction between two features shipped in the same diff.)
Also confirmed correct in the same diff: hook-order placement (both lazy-refresh effects sit before the
`isLoading`/`!movie` early returns, same zone as the pre-existing `setRuntime` effect); the soft-deadline
break in `tmdbFieldsSweep/index.ts` (`Date.now() - nowMs >= SOFT_DEADLINE_MS`) correctly sets `budgetAbort`
and still falls through to write the `lastRun` audit doc; the `providers` field VALUE shape (flatrate+free+
ads+rent+buy, canonicalized, deduped via `Set`) matches exactly between the lazy-refresh effects and
`StatusButton`'s `subscription`+`rent`+`buy` union — same construction, no divergence there.

### 2026-07-12 — BIN-468 Stage-2 per-group sweep: a new stamp that ALSO gates an independent refresher can be re-certified fresh by a stale re-mark path
Reviewing the per-group TMDB-ToS sweep (single doc-stamp → three field GROUPS static/providers/nextair,
each gated by its own stamp `tmdbFieldsRefreshedAt`/`providersCheckedAt`/`nextAirUpdatedAt`). The core
invariants are all correct: `buildClearedPayload(groups, delete)` builds ONE flat object spanning only the
STALE groups (single per-doc write preserved); `groupsToClear` filters each group on its OWN stamp so a
fresh group is never cleared; each group deletes only its own `fields ∪ {stamp}` (no field/stamp overlap
between the three groups, verified key-by-key, so a sibling's stamp is never collaterally deleted);
`planTmdbFieldsRefresh` writes providers ONLY when `needsProvidersRefresh` (>60d/absent) so a fresher
advisor `providersCheckedAt` is never clobbered (test-locked); the session dedupe `.add(dedupeKey)` is
still marked synchronously BEFORE `await fsdb()` (echo-proof); `nextAirReadRepair` never writes `updatedAt`
(the `{}`-delta restamp → `buildRepairPayload({}, stamp)` = `{nextAirUpdatedAt: stamp}` only), and its sole
caller `useCalendar` passes `Date.now()`; rules add the `<= request.time` forge ratchet to BOTH new gate
stamps (`providersCheckedAt` had NONE before — only a `hasOnly` key).
THE ONE REAL FINDING (MEDIUM): the diff adds `providersCheckedAt: serverTimestamp()` to the SHARED
`addItem` (WatchlistContext), unconditionally. `addItem` is also the re-mark path for `useMarkSeen`
(QuickAddButton/StatusButton on the feed/recs/TitleCard surfaces), where providers are
`input.providers ?? current?.providers ?? []` — i.e. the OLD denormalized array, NOT a fresh TMDB fetch,
whenever the card surface passes no `providers` prop (feed/page.tsx passes none). So a "markera sedd" from
a card re-stamps `providersCheckedAt` to now over stale provider data. Two downstream effects, both the
exact failure BIN-468's per-group model exists to prevent, re-introduced through `addItem`: (1) the ToS
sweep's providers group reads fresh → won't clear for another 5mo though the data may already be aging
(§1.C compliance backstop weakened); (2) NOVEL vs the static group — `taste/backfill.ts` gates its own 60-day
provider re-fetch on `providersCheckedAt < now-60d` (backfill.ts L55-56), so a false-fresh stamp makes
backfill SKIP re-fetching real providers for 60d (an existing library title with genreIds+providers already
present hits `missingGenres:false, missingProviders:false, isStale:false` → skipped). The static-group stamp
(`tmdbFieldsRefreshedAt`, stamped on every `addItem` since BIN-402/453) has the SAME re-certify-on-stale-remark
property and was ACCEPTED — so this is consistent precedent for the compliance half; what's genuinely new is
the providers stamp SHORT-CIRCUITING an independent refresher (backfill) that the static group has no
equivalent of. Bounded (harm only when current.providers is already >60d at re-mark time, unlikely for an
active user whose backfill runs on load), so MEDIUM not blocker. Fix if tightening: stamp `providersCheckedAt`
in `addItem` only when the providers are actually fresh from a fetch (e.g. a caller-supplied `providersFresh`
flag, or drop the `addItem` stamp and let the title-page `planTmdbFieldsRefresh` fallback + backfill own it —
a fresh title-page add already carries fresh providers, and a feed add writes `[]` which backfill repopulates).
GENERAL PATTERN: when a diff turns a denormalized field into a sweep/refresher FRESHNESS GATE, audit EVERY
writer of that field's stamp — a shared write helper (`addItem`) that stamps the gate unconditionally can
re-certify stale data written via a fallback (`?? current?.x`), and if a SEPARATE feature keys its own refresh
cadence on the same stamp, the false-fresh stamp silently suppresses it. Grep the stamp name across the whole
`src/` tree for competing readers before assuming a new stamp is self-contained.

### 2026-07-12 — BIN-185 P4+P5 recap client: all four rework fixes confirmed correct; spoiler boundary must be the CONTIGUOUS frontier, never a numeric max
Re-reviewed the staged delta after the /code-review rework. All four confirmed sound, no new findings:
1. **Spoiler fix (`src/lib/recaps/progress.ts`)** — `contiguousWatchedBoundary(inventory, isWatched)`
   walks the inventory in air order (season asc, then episode asc, both re-sorted defensively so
   unsorted TMDB input is safe) and RETURNS at the first unwatched episode. So everything ≤ the
   returned boundary is provably watched — out-of-order viewing (S1E1-2 then S3E2) can NOT advance
   it past the gap; a mid-season gap (S1E3 skipped, S2E1 watched) caps at S1E2; an incomplete lower
   season blocks bridging to a fully-watched higher season; returns null when S1E1 is unwatched.
   Specials excluded in BOTH `inventoryFromSeasons` (filters `season_number >= 1 && episode_count > 0`)
   and the walk (`filter(s => s.season >= 1)`). This is the correct fix for the old `lastWatchedBoundary`
   numeric-max bug, which could point the boundary at an episode past unseen gaps → recap spoils skipped
   eps. KEY PATTERN for any "resume/catch-up/recap up to where I am" feature: the safe cursor is the
   contiguous-from-start frontier, NOT max(watched) — max crosses gaps. 10 tests lock every edge.
2. **Double-listener fix** — `recapBoundary` is a `useMemo` in `TVShowPageClient` derived from the page's
   EXISTING `isWatched` (from `useEpisodeProgressWithSync`), null-safe via `show?.seasons` (undefined →
   `inventoryFromSeasons` returns [] → boundary null), and sits BEFORE the `isLoading`/`!show` early
   returns (Rules-of-Hooks safe — verified render order). `RecapPanel` takes `boundary` as a prop and
   opens NO `episodeProgress` subscription of its own (new file, zero episodeProgress import). One second
   listener eliminated. `isWatched` identity may churn each render → useMemo recomputes, but that's a cheap
   inventory walk, never a correctness issue.
3. **Dormant-read gate** — `RECAPS_ENABLED=false` (`config.ts`) AND'd into `useRecap`'s `enabled`
   (`RECAPS_ENABLED && tmdbId != null && boundary != null`) → `queryFn` never runs → zero `getDoc`
   against `recaps/` until the P3 batch seeds data and the flag flips. Correct Blaze-cost guard for a
   dormant feature (every eligible TV page view would otherwise fire a guaranteed-miss read).
4. **Attribution + validation** — `RecapPanel` returns null on `!boundary`, `!recap`,
   `recap.sources.length === 0` (ADR 0011 mandatory CC BY-SA attribution), OR
   `!validateRecapText(recap.text).ok` (defense-in-depth on read; batch validates on write). `useRecap`'s
   `docToRecap` filters `sources` through `isValidSource` (name+url both strings) so a malformed source
   element is dropped. `safeHref` only emits an href for `^https?://` (blocks `javascript:` etc.). Text
   rendered as a plain-text child (`{recap.text}` in a `<p>`, never dangerouslySetInnerHTML) — the primary
   control. Query key `['recap', ...]` head isn't in `PERSISTED_QUERY_PREFIXES` (exact-match allowlist) so
   per-title-per-episode data stays in-memory only (5MB-quota rule honored). `fsdb()` lazy Firestore + a
   10s Promise.race timeout on the getDoc. `tsc --noEmit` (root) exit 0, 10 progress tests green, working
   tree == staged index at review time. APPROVED.

### 2026-07-12 — BIN-185 recaps GO-LIVE flip: RECAPS_ENABLED false→true is safe; global-boolean gate means guaranteed-miss reads for every non-seeded eligible show (advisory, not a regression)
Final ship of "Påminn mig var jag slutade". Staged diff = 4 files, all confirmatory of prior reviews:
(1) `src/lib/recaps/config.ts` — ONLY change is `RECAPS_ENABLED false→true` + a dated comment; the
consuming `useRecap.ts` gates `enabled = RECAPS_ENABLED && tmdbId!=null && boundary!=null`, reads via
lazy `fsdb()` (never static `{db}`), 1h staleTime, key `['recap',...]` deliberately NOT in
PERSISTED_QUERY_PREFIXES (per-title-per-episode, in-memory only), 10s Promise.race timeout on the getDoc.
Correct, safe enablement. (2) `functions/scripts/recap-upload.mjs` — git reports `similarity index 100%`
(R100) pure rename from `scripts/recaps/upload.mjs` (moved so firebase-admin resolves from
functions/node_modules; root has none) — zero content delta, confirmed no code references the old path
(only the script's OWN internal usage strings at lines 5 + 82 still print `node scripts/recaps/upload.mjs`
— stale-doc advisory inside a rename, same class as the "stale RUNBOOK env-var" one-off; not a blocker).
(3) RUNBOOK + (4) .gitignore — path/pattern updates for the relocation, both correct (gitignore keeps BOTH
`scripts/recaps/*.local.json` and adds `functions/scripts/*.local.json`; the emitted data files still live
under scripts/recaps/ per the runbook, so keeping the old pattern is right).
One advisory worth recording for future feature-gate flips: the gate is a GLOBAL boolean, not a per-show
allowlist. The original comment justified `false` as avoiding "guaranteed-MISS getDoc" Blaze-cap draws while
dormant. With only Grey's Anatomy S1 (tmdbId 1416) seeded, flipping to `true` now fires a getDoc for EVERY
eligible TV show at a user's boundary — ~all of which miss. This is NOT a regression (it's the inherent
design of a boolean feature gate + the intended go-live step, cost is bounded by actual boundary-page views
not library size, 1h client cache caps repeats, a missing-doc getDoc is 1 cheap read) — but when reviewing a
boolean feature-flag go-live whose OWN gating comment cites guaranteed-miss cost as the reason it was off,
note the trade to Malin: a per-show allowlist would be cheaper but is a design change, not required to ship.

### 2026-07-12 — BIN-185 recap fallback delta: two-query index/recap split + bounded walk-back all correct; only residual is a benign stale-closure of `covered`
Re-reviewed the post-/code-review delta on `useRecap.ts` + new `coverage.ts`/`coverage.test.ts` + `recap-upload.mjs` + RUNBOOK. All four DBA/cost conditions verified sound:
1. **Walk-back never fetches past the user's boundary.** In the recap queryFn, `cursor` starts at the user boundary and is reset each drift step to strictly BELOW the found target (`{season, episode-1}` or `{season-1, MAX_SAFE_INTEGER}` when episode===1). `nearestCoveredBoundary(covered, cursor)` returns the greatest covered ref ≤ cursor, so target ≤ cursor ≤ boundary always. Monotonic decrease guarantees no repeat target and no past-boundary read — spoiler invariant holds by construction (locked by the "NEVER returns a boundary past the user boundary" test).
2. **Read cost hard-bounded:** the walk-back loop is capped at `MAX_FALLBACK_STEPS=3` recap gets; plus exactly one `['recap-index', tmdbId]` index get. Index cached per-show at 1h staleTime, so a binge-watcher advancing boundaries re-reads only the recap doc (its own key `['recap', tmdbId, s, e]`), not the index — the fix's whole point.
3. **Unseeded shows cost exactly 1 read:** index miss → `parseRecapIndex(null)` → `[]` (NOT null); the 2nd query's `enabled: ... && covered != null && covered.length > 0` is false on `[]`, so no recap get fires. When covered is non-empty but the user boundary precedes all covered refs, the 2nd query DOES run but `nearestCoveredBoundary` returns null → `break` before any `getDocWithTimeout` → still 0 recap gets.
4. **Rules-of-Hooks fine:** two unconditional `useQuery` at the top of `useRecap`; `RecapPanel` calls `useRecap` then `useState` before any early return. `covered!`/`tmdbId!` non-null assertions inside queryFns are gated by `enabled` (the documented "enabled doesn't narrow the closure type → assert inside" pattern).
`coverage.ts` pure helpers: `parseRecapIndex` drops `season<1 || episode<1` (specials/junk) + non-string + regex-mismatched entries, sorts, tolerates dupes; `missingEpisodeCount` = `episodesUpToBoundary(inv,user).length - episodesUpToBoundary(inv,covered).length`, ≥0 whenever covered≤user (caller-guaranteed) and stays ≥0 even on a phantom over-inventory index entry (test-locked). `recap-upload.mjs`: `updateIndex` read-merge-set with loud `process.exit(2)` + exact `--index-only <file>` recovery command on failure, concurrent-same-show warning in comment + RUNBOOK; `--index-only` reuses the same validation path (backfill without rewriting recap docs).
**Two benign asymmetries, NOT blockers (skip-bar):** (a) the recap query key omits `covered`, so if a NEW upload changes the per-show index mid-session, the already-cached recap result won't re-resolve until remount or the 1h index staleTime lapses — negligible race (uploads are rare offline batches), self-heals on navigation. (b) `updateIndex`'s merge filter (`/^\d+_\d+$/`) does NOT drop `0_x`/`x_0` the way the client's `parseRecapIndex` does — but the client-side filter makes any such phantom index entry unreachable (never a fallback target, zero wasted reads), and specials are excluded at the boundary layer anyway, so no `0_x` recap should ever be generated. 14 coverage tests green, working tree clean vs staged index (only unrelated tasks/todo.md unstaged). APPROVED.

### 2026-07-13 — BIN-461 /genre/[slug] genre hub pages: faithful clone of the /billigaste static-hub recipe, all 6 PE panel conditions verified; a local `withRetry` worst-case time bound needs the "actual TMDB errors reject fast, don't consume the full buildSignal timeout" assumption to hold
Reviewed `src/lib/seo/genreHubs.ts` (new curated config, single source for the page /
sitemap.ts / hubLinks.ts) + `src/app/genre/[slug]/page.tsx` (new force-static page) +
`sitemap.ts`/`hubLinks.ts` deltas. All PE-panel-committed acceptance criteria confirmed:
(1) fetch is direct `discoverMovies`/`discoverTV` + `buildSignal()`, never `fetchForBuild`
(id-keyed cache would be corrupted by query-shaped genre calls) — grepped imports, only
discover*/buildSignal pulled in; (2) movie+TV in one `Promise.all`, each wrapped in its OWN
`withRetry(fn, 4)` with an inner `.catch` returning `[]`, so a fully-exhausted TV retry
resolves to `[]` without rejecting the outer `Promise.all` or re-running the movie call —
verified with a dedicated test ("thriller never calls discoverTV" for movie-only hubs);
(3) `buildSignal()` is called INSIDE the retried closure body, so each of the 4 attempts gets
a genuinely fresh 20s AbortSignal, not one stale/already-fired signal reused across retries;
(4) posters `w92` with explicit `width={46} height={69} loading="lazy" decoding="async"`;
(5) zero-rows (both movie AND tv empty) renders `EmptyState` as a real 200 with valid
`CollectionPage` JSON-LD — never `notFound()` — because the URL is already sitemap-committed
(BIN-460 lesson); unknown slug still gets `notFound()` at request time (dead in production
since `dynamicParams=false` pre-builds only curated slugs, but `generateMetadata`'s unknown-hub
branch correctly returns `{robots:{index:false,follow:false}, alternates:{canonical}}` rather
than inheriting the root layout's `index:true`); (6) `SEO_GENRE_SLUGS` (derived from
`GENRE_HUBS.map(g=>g.slug)`) is the literal source for both `sitemap.ts`'s `genreEntries()` and
the page's `generateStaticParams()` — structurally cannot drift. Design: tokens only (ink/
ink-2/ink-3/bg-2/rule/surface), `shadow-lift`, `btn-acc`/`btn-sm` (real classes, confirmed in
globals.css), `PageHeader`/`EmptyState` recipe (44px h1 via PageHeader, not a raw 18px title),
Swedish strings, `JustWatchCredit` present. TMDB genre-id sanity (with_genres param, movie-space
vs TV-space ids not cross-wired) is test-locked against `GENRE_LABELS` + explicit TV-only/
movie-only id sets — thorough. `hubSections()`/`/guider` consumes hub sections generically, so
the new 4th "Bästa per genre" section needed zero edits at the guide-hub call site.
**One thing worth flagging for future retry-pattern reviews (not blocking — this diff is a
straight copy of the already-shipped `/billigaste` `withRetry`, PE-5 explicitly required this
mirroring and forbade extracting a shared helper "not now"):** `withRetry(fn, 4)` composed with
a `buildSignal()` 20s-per-attempt timeout has a THEORETICAL worst case of ~80s for a single
discover call if TMDB genuinely hangs (not fast-rejects) on every attempt — above the documented
"<Next 60s static-generation cap" budget `buildFetch.ts`'s own comment calls out. The PE-5
condition ("must stay low single-digit seconds even at retry exhaustion") only holds because
real build-time TMDB flakes observed in practice are fast connection-reset rejections ("fetch
failed"), not 20s hangs — confirmed via a real local build log (`build-genre.log`, untracked,
not part of the diff) showing all 20 genre discover calls failing-after-retries in a build that
still finished the full 10229-page static export in 2.9 minutes. This is the same assumption
`/billigaste`'s already-production-proven `withRetry` relies on, so not a regression — but if a
FUTURE TMDB outage mode is a genuine multi-second hang (not a fast reject) rather than an
instant network error, this class of retry loop could push an individual page close to the 60s
cap. Note it as a watch-item if a build ever times out on a discover-based static hub page,
don't treat as new debt introduced by this diff. **Advisory, not a code finding:** `build-genre.log`
is a stray untracked verification artifact at the repo root with no `.gitignore` pattern
covering it (`*.log` patterns only cover `npm-debug`/`yarn-*`/`*-debug.log`) — flag for deletion
before `git add`, or a future `git add -A` habit will commit it.

### 2026-07-13 — BIN-461 retry-hardening follow-up: the theoretical "genuine-hang" worst case flagged above was a REAL flake, not just theory; 300ms→700ms/4→5 fix confirmed empirically across 3 local builds, delta scoped exactly as described
Same-day follow-up: the coordinator hand-tuned `withRetry` after my initial approval because
local builds actually hit the "TMDB flake storm at export start" case I'd only flagged as a
watch-item — first local build lost ALL 16 discover calls, second lost 1/16, third (with
700ms-step backoff + 5 attempts, up from 300ms/4) hit 20/20 with zero `[genre]` warnings. Diff
scoped to EXACTLY the two claimed changes (confirmed via full-file read, not a partial diff —
no `git diff` baseline exists for an untracked file, so compared byte-for-byte against the
version reviewed hours earlier): (1) backoff constant + attempts bump at both call sites, (2)
new `describeError(e)` unwrapping `e.cause`/`AggregateError.errors[].code` into the `console.warn`
so a real CI build failure is diagnosable (undici's "fetch failed" alone hides the actual
ECONNRESET/EAI_AGAIN). None of the 6 PE-panel binding conditions are touched — fetchForBuild
still never imported, `Promise.all` + per-call `withRetry`+`.catch` isolation structurally
unchanged, poster/EmptyState/sitemap-parity/design sections untouched. `AggregateError` needs
no lib bump (`tsconfig.json` already has `lib: ["dom","dom.iterable","esnext"]`) — `tsc --noEmit`
clean. `eslint` clean (only the standing `no-img-element` warning every static-export `<img>`
page carries). All 23 genre-suite tests still green (attempts-count doesn't affect a
first-call-succeeds test double). Worst-case theoretical hang math got slightly worse (5×20s=100s
vs the prior 4×20s=80s, both already above the informal 60s render-cap the buildFetch.ts header
comment cites) but the empirical evidence from 3 consecutive local builds is that real TMDB
build-time failures are fast rejects, not hangs — same standing assumption `/billigaste`'s
already-shipped retry loop relies on. Re-approved; not a new class of finding, a confirmation
that a previously-flagged watch-item was real and got fixed correctly.

### 2026-07-13 — BIN-461 third delta (/code-review high driven): with_watch_monetization_types + local 8s attempt-timeout actually FIXES the ~100s worst-case-hang math I'd flagged as a watch-item two reviews ago; bare `surface` (no bg-/text-/border- prefix) confirmed a real no-op Tailwind bug, present in a SECOND file this diff didn't touch
Third same-day pass, driven by an actual `/code-review high` run (not just my own pass) whose
findings the coordinator says were "all verified CONFIRMED" before shipping. Four production
changes, all correct:
1. **`with_watch_monetization_types: 'flatrate|free|ads|rent|buy'` added to `DISCOVER_PARAMS`.**
   This closes a real correctness gap I missed in the first two passes: without it, `discoverMovies`/
   `discoverTV`'s `region`/`watch_region` params only affect release-date-window and provider
   METADATA lookups elsewhere, NOT which titles the `/discover` endpoint returns — an unfiltered
   `sort_by=popularity.desc` query returns globally popular titles regardless of Swedish
   availability, so the page's own H1 promise ("att streama i Sverige") didn't hold for the top
   results. TMDB's discover API requires `watch_region` (already always injected — confirmed via
   `tmdbFetch('/discover/movie', {region:'SE', watch_region:'SE', ...params})`) paired with
   `with_watch_monetization_types` to actually filter to region-available titles; pipe (`|`) is
   correct OR-syntax (comma would be AND, which is wrong here — comma means "must have ALL of these
   types simultaneously"). No test locks this param is actually sent (advisory, not blocking —
   filed as a note for the test reviewer's radius, not mine).
2. **Per-attempt signal: `buildSignal()` (20s, calibrated for single-attempt id-keyed title fetches)
   → a local `attemptSignal()` = `AbortSignal.timeout(8_000)`.** This is the fix to the exact
   worst-case-math regression I flagged in my immediately-prior review (5 attempts × 20s = 100s,
   above Next's informal 60s static-render cap). New math: 5×8s + 7s backoff ≈ 47s, comfortably
   under the cap even in a genuine-hang scenario, not just the empirically-fast-reject one. Correctly
   removed the now-dead `buildSignal` import from `@/lib/tmdb/buildFetch` (grepped — zero remaining
   references in the file; no unused-import lint warning).
3. **Bare `surface` → `bg-surface` in the one `TitleRows` `<Link>` className.** Confirmed via
   `tailwind.config.ts`: `surface: 'var(--surface)'` is declared under the `colors` key, which Tailwind
   only turns into utilities WITH a property prefix (`bg-`/`text-`/`border-`/etc.) — a bare `surface`
   token in a className string is not a generated utility at all, just an inert unknown class (same
   failure mode as if someone wrote `className="acc-deep"` instead of `text-acc-deep`). This was a
   real (if low-visual-impact — a missing card background, not a crash) styling bug, correctly fixed.
   **Caught while re-reading the file: the exact same bare-`surface` bug is ALSO present in
   `src/app/guider/page.tsx:99`** (`className="inline-block surface rounded border..."`), a file this
   diff touched ONLY for copy (the genre-family mention) — so it's pre-existing and out of this diff's
   blast radius, but the coordinator's stated cleanup ticket (BIN-496) was described as covering "shared
   jsonLd/withRetry, billigaste's own surface bug" — guider's instance wasn't named. Flag this for
   whoever owns BIN-496 to sweep in, don't assume it's already covered just because the SAME bug class
   got a ticket elsewhere in the same session.
4. **Header comment corrected**: "unknown slug → äkta 404" → "unknown slug has no exported file →
   hosting's `**` rewrite serves the noindex SPA shell (200), not a real 404; the `generateMetadata`
   noindex branch is a dev-mode/safety-net fallback." This now matches the established
   `dynamicParams=false` static-route knowledge (unlisted params fall through to the SPA catch-all,
   not a true 404) rather than overclaiming — a documentation-accuracy fix, not a behavior change (the
   runtime `notFound()` call in the page component is unchanged, still present as the dev-mode/ISR-
   fallback safety net it always was).
`sitemap.test.ts`'s new two-sided genre assertion (`genreUrls.sort() === SEO_GENRE_SLUGS.map(...).sort()`)
is the correct tightening — the prior single-sided "has one genre URL" check couldn't catch a sitemap
entry for a slug NOT in `generateStaticParams` (which would build to nothing under
`dynamicParams=false` and serve the noindex catch-all — a sitemap-committed soft-404, the exact
BIN-460 failure class this whole page exists to avoid). `tsc --noEmit` clean (transient
`.next/types/*.d.ts not found` on the first run was a stale/mid-write artifact from a concurrent local
build process, not a real error — resolved on immediate re-run with no code change). `eslint` clean.
23/23 tests green. One test-hygiene advisory (not blocking, not mine to fix): `page.test.tsx` still
`vi.mock`s `@/lib/tmdb/buildFetch`'s `buildSignal` even though `page.tsx` no longer imports that
module at all — a harmless orphaned mock left behind by the production-code import removal, worth a
follow-up cleanup pass. Approved.

### 2026-07-14 — BIN-185 RecapPanel timeline re-review: both Art. 50 disclosure regressions confirmed fixed, minor advisories closed, no new drift
Re-reviewed `src/components/title/RecapPanel.tsx` after the same-day timeline-redesign review logged
two MEDIUM findings. Both confirmed fixed at the exact prior locations: (1) the `openFull` ("Visa hela
säsongen hittills") block now renders `<div className="text-[11px] text-ink-2 font-medium">AI-genererad
sammanfattning</div>` directly above `{fullText}` (L160), restoring parity with the boundary node's
disclosure; (2) each individually-expanded prior-season node now carries its own
"AI-genererad sammanfattning" + "Kan innehålla mindre felaktigheter" + `RecapSourceCredit` (L216-219)
rather than depending on the boundary node's disclosure, which can be many collapsed nodes away on the
spine — matches the general lesson from the same day's first review (a toggle-per-N-items refactor needs
the disclosure to move to per-item, not just survive at the group level). Both non-blocking advisories
from the same review were also closed in this diff: the redundant `[...priorSeasonNumbers(...)].sort()`
is gone (confirmed via grep — zero `.sort` calls in the file; `priorSeasonNumbers` output is consumed
directly, relying on its already-ascending contract); and the "re-expand within the 1h staleTime is free"
comment (which overstated React Query behavior — default `gcTime` evicts a collapsed season after ~5min
regardless of the 1h `staleTime`) is now "served from React Query's cache," which doesn't promise a
time window the code doesn't actually guarantee. No regressions: `priorSeasonNumbers` is still driven by
`coveredBoundary` (never raw `boundary`), all original null/sources/validateRecapText guards are intact,
Rules-of-Hooks order unchanged (all hooks before the `!boundary||!recap||!coveredBoundary` early return),
tokens/Swedish strings/no-hex/no-red clean. New `RecapPanel.test.tsx` adds a dedicated test
("carries an AI disclosure AND CC BY-SA attribution inside every expanded season") closing the test-depth
gap the first review noted (4/4 tests then didn't exercise either Art. 50 regression) — now 6/6 green.
`tsc --noEmit` clean, `eslint` clean on both touched files, `git status` shows only the 2 staged files with
zero unstaged drift. APPROVED — clean to ship.

### 2026-07-15 — BIN-505 third re-review (notes-migration updatedAt strip + cross-account guard + shared useSenderProfile + isPublic on the projection): all 6 requested fixes correct; one real hardcode bug in useFollowList, zero test coverage for the two headline invariants
Re-reviewed the post-second-fix delta. All 6 claimed fixes verified correct by direct trace:
1. Both the eager migration's `batch.update(itemRef, { notes: deleteField() })` and `updateNotes`'s
   `batch.set(itemRef, { notes: deleteField(), ...visFields }, { merge: true })` omit `updatedAt`
   entirely (grepped both call sites — no `serverTimestamp()` anywhere in either write). A
   `deleteField()`-only merge produces a post-merge doc with NO `notes` key, which passes both the
   create guard (`!('notes' in d) || d.notes == null`) and the update guard (same, plus the
   unchanged-value OR-arm) in `firestore.rules`' `users/{uid}/watchlist/{itemId}` clause — confirmed
   against the new rules-test block (`BIN-505 watchlist notes-null guard`, 3 cases incl. the exact
   `deleteField()` shape). `isValidNoteDoc`'s `note.size() <= 5000` matches the client's
   `NOTE_MAX_LEN = 5000` constant exactly.
2. `itemsUidRef.current = uid` is set SYNCHRONOUSLY inside the watchlist `onSnapshot` callback,
   immediately before `setItems(...)`, in the SAME tick — so on an A→B switch the migration effect
   (gated `if (itemsUidRef.current !== uid) return;`) sees `itemsUidRef.current === 'A'` while
   `uid === 'B'` for every render between the switch and B's first snapshot landing (items still
   holds A's stale rows during that window), correctly blocking a write of A's notes under
   `users/B/watchlistNotes`. Once B's snapshot lands, both the ref and `items` update together,
   unblocking normally — traced the full effect-ordering chain, no wedge on the common (non-switch)
   path since the ref is set before the first snapshot's `setItems` in every case, including initial
   mount.
3. `useSenderProfile` (`src/hooks/useSenderProfile.ts`) is now the SOLE definition of the
   `['sender-profile', uid]` query key/shape, consumed identically by `TopbarActions.tsx`,
   `FriendsPageClient.tsx` (both `sender?.displayName ?? request.fromDisplayName` / `sender?.username
   ?? request.fromUsername`), and `grupper/page.tsx`'s `useInviteIdentity` (`senderQuery.data
   ?.displayName ?? invite.fromDisplayName`) — the prior bare-string-vs-`{displayName,username}`
   collision (grupper's old inline hook returned a raw string under the same cache key another
   consumer expected as an object) is gone; all 3 sites correctly destructure the shared
   `SenderProfile` shape, none render the object directly as a child.
4. `useFollowList.ts`'s missing-profile fetch now returns `[u, null]` (not `'ghost'`) whenever
   `getPublicProfileCard` returns null — and since the projection read is LIVE-GATED, null now means
   "deleted OR private/non-friend" (collapsed, can no longer distinguish tombstone from private, unlike
   the old direct-doc-read). `resolveFollowRows`'s `cached ?? followFallback(uid)` correctly renders a
   'Privat användare' row for `null` (nullish-coalescing treats `null` as the trigger), consistent with
   friends/feed's null-becomes-fallback convention; the sweep-side comment attributing tombstone cleanup
   to the weekly `reclaimOrphanFollows` function is accurate (function exists, `functions/src/index.ts`
   exports it, Admin-SDK bypasses rules so it can still see real doc-existence). **New finding**: the
   replacement branch hardcodes `isPublic: true` on every successfully-resolved `FollowListUser` —
   `return [u, { uid: u, ..., isPublic: true }]` — regardless of the card's REAL `card.isPublic` value,
   which is right there on the fetched `PublicProfileCard` and should be used instead
   (`isPublic: card.isPublic`). A successful `getPublicProfileCard` read does not imply the profile is
   public — it also succeeds for a FRIEND reading a private (`isPublic:false`) profile's projection (the
   rule's 4th OR-arm), so a friends-list row for a private-profile friend now silently reports
   `isPublic: true`. Currently INERT (grepped `FollowListUser.isPublic` repo-wide — `FriendsPageClient`'s
   `Row` never reads `.isPublic`, only `displayName`/`username`/`photoURL`; no other consumer exists), but
   it directly contradicts the accuracy this same diff establishes elsewhere (`UserProfilePageClient`
   gates a real query on `card.isPublic`) and will silently misreport the moment any future consumer reads
   this field off a following/followers row. Low severity (no active behavior bug), one-line fix
   (`card.isPublic`), worth fixing before it's forgotten rather than blocking the ship.
5. `syncMyPublicProfile`'s `photoURL` over-500-char omission (`src.photoURL && src.photoURL.length <=
   500 ? src.photoURL : null`) correctly prevents the whole atomic `setDoc` from failing the rule's
   `photoURL.size() <= 500` bind — verified `cardSignature` (the skip-if-unchanged localStorage gate)
   was ALSO updated to include `isPublic` in its hashed array (a common miss: adding a new synced field
   without adding it to the change-detection signature would silently freeze that field at its
   first-ever-synced value for any user whose OTHER fields never change again).
6. `firestore.rules`' `isValidPublicProfile` whitelists `isPublic` as `(!('isPublic' in d) ||
   d.isPublic is bool)` (optional, type-bound, no default-value binding needed since it's a plain
   boolean not a sentinel-timestamp) — consistent with the `bio`/`displayName` optional-field pattern
   in the same function. `UserProfilePageClient`'s `countableUid = ... && (data.card.isPublic ||
   profileUid === myUid) ? ... : null` correctly gates the follower/following count queries (which the
   file's own comment notes are NOT covered by the friends-read rule-arm) on the live card value OR
   self, preventing a friend-only profile view from firing a permission-denied count query.
**Test-coverage gap worth flagging** (not a code bug, a verification gap): the test mock in
`WatchlistContext.test.tsx` wires up a `notesSnapshotCallback` spy but NO test ever actually invokes it
(`grep notesSnapshotCallback\(` → zero call sites) — meaning neither of this review's two headline
correctness properties (migration/`updateNotes` never bumping `updatedAt`; the `itemsUidRef`
cross-account guard) has ANY automated regression test. Both were verified correct here by manual code
trace only. This is exactly the class of invariant the 2026-07-15 (first BIN-505 re-review) entry above
flagged as needing the same protection `refreshedThisSession` has — worth a follow-up test asserting (a)
`'updatedAt' in payload === false` for both the migration batch and `updateNotes`, mirroring the existing
`tmdbFieldsRefreshedAt` pattern at test.tsx:608/660, and (b) a simulated uid-switch mid-flight doesn't
fire a batch write under the new uid before its own snapshot lands. Also noted a live git-index
instability during this review: `git status` briefly showed most of the diff as staged, then reverted to
unstaged, between consecutive Bash calls with no `git add`/`git reset` on my part — consistent with a
concurrent process (implementer/commit-gate) mutating the index while this review ran. Lesson: when a
file's plain `git diff` unexpectedly returns empty mid-review, don't conclude "unchanged" — re-check with
`git diff HEAD` (union of staged+unstaged vs last commit), which is stable regardless of index churn.
`npx tsc --noEmit` and the targeted vitest suites (WatchlistContext, useFollowList.helpers,
publicProfile — 31+6 tests) all green.

### 2026-07-15 — BIN-505 fourth pass: two coordinator follow-up fixes both confirmed correct (useFollowList isPublic hardcode fixed; updateNotes un-marks migratedNotesRef on failed commit)
Two small sequential fixes landed after the third re-review above, both addressing findings from that
pass (one mine, one from a separate `/code-review` run the coordinator ran independently). Both confirmed
correct by direct diff + trace, no new issues:
1. **`useFollowList.ts`** — `isPublic: true` (hardcoded) → `isPublic: card.isPublic` (the real projection
   value), with a comment noting a readable card can be a friend reading a private profile. Matches the
   finding exactly; `PublicProfileCard.isPublic` is a plain non-nullable `boolean` (defaults `false` via
   `cardFromDoc`), so no null-handling gap introduced. `resolveFollowRows`/`followFallback` untouched.
2. **`WatchlistContext.tsx`'s `updateNotes`** — the pre-write `migratedNotesRef.current.add(tmdbId)` (added
   synchronously before the batch, so a re-render mid-flight can't let the eager migration clobber a fresh
   edit) is now paired with an un-mark on failure: `try { await batch.commit(); } catch (e) {
   migratedNotesRef.current.delete(tmdbId); throw e; }`. This closes exactly the edge case my third-pass
   entry above flagged as a narrow, session-scoped gap: previously, a failed `updateNotes` commit (network/
   permission error) would leave the tmdbId permanently marked "handled" for the rest of the session even
   though NEITHER the subcollection write NOR the inline-note deletion had actually persisted — silently
   opting that title out of the eager migration's PII-closing sweep for the rest of the session, while the
   original inline note kept leaking to friends/public. The fix is exactly the right shape: un-mark only in
   the `catch`, `throw e` preserves the pre-existing caller-visible failure contract (no behavior change for
   callers that already handle a rejected `updateNotes` promise), and because the failed commit means
   `items`/`notesByTmdbId` state is UNCHANGED (the legacy inline note was never actually deleted, no
   subcollection doc was actually written), the eager migration effect will correctly pick the un-marked
   tmdbId back up on its next run and migrate the OLD (still-accurate) legacy note — never the user's failed
   edit attempt, which was never persisted anywhere. One residual, unchanged from the prior pass: this
   failure-path branch has NO dedicated test (the shared `writeBatch` mock's `commit: async () => {}` never
   throws in any existing test), so both the mark-on-write and unmark-on-failure halves of this invariant
   remain manual-trace-verified only — same open coverage gap as before, now covering one more branch.
   `tsc --noEmit` clean; `WatchlistContext.test.tsx` + `publicProfile.test.ts` 31/31 green (unchanged count
   — confirms no new test was added for the failure branch, consistent with the trace above).
**Pattern worth naming**: a review that ends "APPROVED, non-blocking follow-up: X" can get X fixed in a
SEPARATE, LATER coordinator round-trip, sometimes multiple rounds deep (this is the second consecutive
one-line-fix-then-re-stamp cycle on the same ticket) — each such fix is small enough to verify by direct
diff + targeted test run rather than a full re-review, but still needs its own marker re-stamp naming the
incremental change, not just a rubber-stamp of the previous marker's text.

### 2026-07-16 — Sprint close-out (BIN-511/512/515 new + BIN-513/514 re-confirm): clean, one latent-but-inert rollback edge case worth naming as a pattern
Reviewed the finishing batch of 2026-07-15's parallel sprint. All clean, no blocking findings:
1. **BIN-511 (`taste/stats.ts`)** — two independent fixes bundled correctly: rating scale
   `rating/10` → `rating/5` (this app's real scale is 0.5–5, matches `reference_rating_scale`
   memory), AND the `avbruten` neutral-weight check moved BEFORE the rating check (previously
   rating-first meant a rated-then-abandoned title still dragged its genre up — contradicts the
   file's own stated invariant that `avbruten` is always neutral). Both changes are test-locked
   with before/after-style comments explaining the old bug. `taste/vector.ts`'s deliberately
   different ×2-amplified scale is untouched and still documented as intentionally divergent.
2. **BIN-512 (Movie/TVShow/QuickAddButton)** — mechanical, correct: raw `<div>` not-found text
   replaced with `<NotFound crumb title body>` (matches the routed-view recipe, `NotFound`'s
   props traced to exactly `PageHeader`'s `crumb`/`title`/`standfirst`); `QuickAddButton`'s
   dropdown `shadow-lg` → `shadow-pop` (the only two allowed shadows are `shadow-lift`/
   `shadow-pop` per CLAUDE.md — `shadow-lg` was a raw Tailwind escape).
3. **BIN-515 (availableNotify/priceDropNotify pagination)** — bounded `PAGE_SIZE=2000` cursor
   loop over `FieldPath.documentId()` correctly replaces the old unbounded single `.get()`;
   verified the "no new composite index" claim in both files' comments against the
   collectionGroup index rules (equality/`in` filters + `orderBy(documentId())` need no extra
   composite — matches the established `distilled principles` entry above). **One latent, narrow,
   NOT-test-covered edge case worth naming as a pattern going forward**: `nextAirReadRepair.ts`'s
   BIN-518 per-chunk rollback (reviewed same pass, see below) has an outer `catch` that rolls back
   `pending` (the FULL list) on any error reaching it — correct for the realistic failure mode
   (the `await fsdb()` import failing before the loop starts, so nothing has committed yet), but if
   a LATER loop iteration threw synchronously OUTSIDE the inner `try` (e.g. `doc()`/`batch.set()`
   throwing on a malformed path — essentially never in practice since uid/tmdbId are always
   non-empty here), the outer catch would incorrectly un-mark dedupe keys for EARLIER chunks that
   had already committed successfully, causing a redundant (not data-losing, just cost-wasting)
   re-write next flush. Not filed as blocking (no realistic trigger, and BIN-515's own pagination
   loop has the same "no dedicated test" acceptance already on record) — but the general shape
   ("outer catch assumes nothing succeeded before it, when partial progress is actually possible
   inside the loop it wraps") is worth checking on any future per-chunk-with-rollback pattern: the
   rollback set should be scoped to "this chunk onward", not "everything since function entry",
   unless every prior loop body statement is provably infallible.
4. **BIN-513/514 re-confirmed** — matches the 2026-07-15 entry above exactly (TV-guard suppression
   in `serviceValue.ts`/`useServiceValue.ts`, three render-only stat surfacings in
   `HouseholdPanel`/`savings/page.tsx`/`RotationCalendar.tsx`). The 2026-07-15 entry's one noted nit
   (the `zeroCostCount` field-doc comment inventing a non-existent "ADR-0010 output-field guard")
   is STILL present verbatim in `householdAggregate.ts` — unfixed since last flagged, still
   non-blocking (doesn't affect behavior), noting the repeat so a future pass doesn't need to
   re-derive that the cited guard doesn't exist.
`tsc`/targeted vitest all green on every file in this batch; working tree matched exactly the file
list handed to this review (no drive-by scope creep found).

### 2026-07-16 — Forward-revert of BIN-523/BIN-510 (84e7f4d → fd4b14e for 5 files): clean; NEW gap — a "typecheck exit 0" claim NEVER covers `functions/src`, because root `tsconfig.json` excludes `functions`
Reviewed the staged forward-revert restoring `functions/src/availableNotify/{index,logic,logic.test}.ts`,
`functions/src/priceDropNotify/index.ts` and `src/lib/firebase/groups.ts` to their `fd4b14e` state
(the state live in prod — 84e7f4d's deploy went RED at the rules/functions guard, so BIN-523/510
never shipped). Zero findings.
**Canonical verification recipe for a `git checkout <base> -- <files>` revert** (reusable; much
stronger than reading the diff):
1. `git diff --cached <base> -- <the file list>` must be EMPTY → proves the index matches the target
   commit exactly. Then per-file compare all four blob hashes (`git rev-parse <base>:<f>`,
   `git ls-files -s <f>`, `git hash-object <f>`, `git rev-parse <bad>:<f>`) to prove index AND
   worktree both landed, with no partial/mangled restore and no unstaged drift.
2. **Key insight that collapses most of the review**: if every reverted blob is byte-identical to a
   commit that already passed CI and runs in production, the reverted files are internally consistent
   BY CONSTRUCTION — any "bug" inside them (here: `processTitle`'s `items[0]?.mediaType || 'tv'`
   arbitrary-mediaType collision, the very bug BIN-523 tried to fix) is pre-existing production
   state, NOT a revert defect. Don't re-review restored code on its merits; the ONLY real risk
   surface is CROSS-FILE — retained work referencing symbols the revert removes.
3. Scope check: `git diff --name-status <base> <bad>` vs `git diff --cached --name-only <base>` →
   the reverted set must be disjoint from the retained set (here 5 reverted vs 19 retained).
4. Dangling-symbol check: diff the revert to list every REMOVED export, then grep repo-wide. Here
   BIN-523 removed 3 exports (`NotifyMediaType`/`normalizeMediaType`/`availableStateDocId`) — zero
   references outside the two reverted consumers; BIN-510's removed symbols (`MY_GROUPS_LIMIT`,
   `zeroGroupsCache`, `noteGroupMembership`, `knownZeroGroups`) were all module-private, so they
   can't dangle by definition. Prove the public API is unchanged with
   `git show <base>:<f> | grep '^export '` vs the same on `<bad>` — for `groups.ts` all 35 exports
   matched name-for-name, only line numbers shifted, so every retained caller
   (`WatchlistContext`→`syncProgressToGroups`, `useGroups`→`subscribeToMyGroups`,
   `AuthContext`→`refreshMyHouseholdContributions`, `useNotifications`→`getRecentSessionPicksAcrossGroups`)
   is unaffected.
**THE NEW GAP, worth remembering on every functions-touching diff**: root `tsconfig.json` has
`"exclude": ["node_modules", "functions"]`, so `npm run typecheck` (`tsc --noEmit`) does NOT
typecheck `functions/src` AT ALL. A handoff stating "typecheck exit 0" therefore says nothing about
a diff touching `functions/**` — run `cd functions && npx tsc --noEmit -p tsconfig.json` separately
(exit 0 here). Note the asymmetry with vitest: root `npm test` DOES run `functions/**` tests whose
imports are firebase-admin-free (the established `logic.ts`/`*.helpers.ts` pattern — see the
"Functions test import gotcha" memory), so `functions/src/availableNotify/logic.test.ts` (12/12
green) genuinely was inside the quoted 1937. Tests cover functions, typecheck does not.
**Data-safety reasoning a revert of a stateful function needs**: reverting `availableNotifyState`
doc ids from `movie_${id}`/`tv_${id}` back to bare `${id}` is safe ONLY because BIN-523 never
deployed — no namespaced docs exist in prod, so the restored bare-id reader still finds the live
markers and no baseline is orphaned (an orphaned `lastFlatrate` baseline would read `last === null`
→ `diffNewProviders` returns `[]` → baseline-only, so even the bad case degrades to "one missed
push", never a first-run push blast). Always ask "did the reverted code ever run against prod
data?" before accepting a state-keying revert.
Side effects verified: `functions/lib/` is gitignored (untracked) → no stale compiled artifact
survives the revert; `docs/workflow-map.html` documents `availableNotifyState/{tmdbId}` (bare) and
was never updated by 84e7f4d, so the revert RESTORES map/code consistency (linter OK, 90 nodes/28
flows/61-61 coverage); the `.claude/state/workflow-map-stale.json` flag's `triggers` list contains
none of the 5 reverted paths (pre-existing, from retained + earlier work). Two non-blocking doc
observations, neither a code defect: `tasks/todo.md`'s "Deviation log" lines 196-200 still record
BIN-523/510 decisions as shipped fact (line 197's "invariant documented in header comment" is now
false — the revert removed exactly that comment), and `ci.yml`'s BIN-525 coverage baseline (33.1%
src/** statements) was measured with BIN-510's ~50 `groups.ts` lines still in `src/**`. `tasks/` is
disposable scratch per `code-style.md` and the coverage step is report-only/`continue-on-error` with
no thresholds, so neither blocks — but a stale deviation log WILL mislead the BIN-523/510 rework.
**Pattern**: on any revert, also check whether RETAINED prose (deviation logs, close-out notes,
baseline numbers in CI comments) still asserts the reverted behavior — a revert cleans code but
leaves documentation claiming the code exists.

### 2026-07-18 — BIN-527 TV one-service attribution: correct reuse of `attributeProvider()`, zero new bugs; two ticket-acceptance-criteria items not visibly closed out in the diff (process gap, not a code defect)
Reviewed the unstaged (not yet `git add`-ed) 3-file diff: `tvActiveProviderIdsFromItems()` now
takes an `ownedProviderIds: number[]` param and calls the pre-existing `attributeProvider()`
(same module, already used by the film-side `watchedForValueFromItems`) instead of pushing every
provider id a title happens to carry. Confirmed correct: (1) `attributeProvider`'s
lowest-canonical-id tiebreak is genuinely deterministic and idempotent under double
canonicalization — traced `canonicalProviderId` through `PROVIDER_MAP` construction
(`m.set(p.id, p)` for the canonical id itself, plus each alias) so calling it twice (once in the
caller via `canonicalUniqueProviders`, once inside `attributeProvider`) is a no-op on an
already-canonical id, not a double-remap; (2) the single call site (`useServiceValue.ts`) passes
`owned` (already `canonicalUniqueProviders(user?.myProviders ?? [])`) — confirmed via repo-wide
grep this is the ONLY non-test call site, no stale 1-arg caller left; (3) the new "does not credit
an unowned provider" behavior is a no-op change for `rollupServiceValue`'s dead-weight verdict
specifically (rows are seeded only from `ownedProviderIds`, so a stray unowned id in the old
output was already inert there) — the real fix is the multi-owned-service case, which the new
test (`providers: [384, 76]` + `owned: [76, 384]` → `[76]` only) pins correctly. `tsc --noEmit`,
`eslint`, and `serviceValue.test.ts` (28/28) all clean, zero working-tree drift at review time.
**Two acceptance-criteria items from `tasks/todo.md`'s BIN-527 entry aren't visibly satisfied
by the diff itself** — worth checking on future tickets with binding panel conditions: (a) "close-out
note states whether attribution came out lopsided toward one provider id across the test/seed
data" — the shipped code comment only restates the general caveat ("revisit if a post-ship
spot-check shows attribution skewing lopsidedly"), it doesn't report an actual finding one way or
the other; this may be intended to land in the commit message/ticket transition rather than code,
but nothing in the diff closes the loop. (b) the ticket's Step-0 instruction to "re-verify the
secondary claim ('+ unstarted shields indefinitely') against current main... confirm it's still
present before fixing it" has no trace of having been checked — `tvActiveProviderIdsFromItems`
still unconditionally includes `ej_paborjad` (unstarted) series (unchanged from BIN-513, still
covered by the existing "INCLUDES a followed-but-unstarted series" test), so if the secondary
claim was still live on `main` it was silently left unfixed; if it was found stale/inapplicable,
that determination isn't recorded anywhere in the diff. Neither is a code correctness bug (the
shipped logic does exactly what its own acceptance criterion #1 asked for), but both are
binding-per-the-ticket completeness gaps a reviewer should surface rather than silently pass —
distinct from the "accepted deviation" class since these haven't been decided, just seemingly
unaddressed.

### 2026-07-20 — BIN-561 useOptimisticMirrorField extraction: clean, three inline mirror-plus-rollback copies (costs/campaigns/renewalDays) consolidated with zero behavior drift
Reviewed the staged diff extracting `AuthContext.tsx`'s three near-identical
mirror-plus-rollback blocks (`setProviderCost`/`setProviderCampaign`/`setProviderRenewalDay`,
themselves reviewed clean individually on 2026-07-18 below) into a single generic hook,
`src/hooks/useOptimisticMirrorField.ts`. Confirmed byte-for-byte behavior parity: (1) the
synchronous-mirror-before-await ordering (BIN-40/46 stale-render-snapshot fix) is preserved —
`mirrorRef.current = next` still runs before `await commitRef.current(next)`; (2) the
identity-checked rollback (BIN-516/531) is preserved verbatim (`if (mirrorRef.current === next)
mirrorRef.current = prev`); (3) `commit` and `source` are both routed through refs
(`commitRef`/`mirrorRef`) so the hook's returned setter has a permanently stable identity
(`useCallback(..., [])`) even though the three `commitProviderX` closures passed in depend on
`updateUserField` (which itself depends on `[uid]` and changes identity on account switch) —
this is actually a minor improvement over the pre-extraction code (the `value` context memo's
dep array no longer needs to track a setter identity that could change on uid switch) with no
new staleness risk, since the ref-read happens at call time, not at closure-creation time.
`setProviderCampaign`'s canonical-id keying (BIN-417, alias id → canonical id before touching
the map) is unchanged, done in `AuthContext.tsx` around the generic hook call, not inside it.
All three `AuthContextType` setter signatures (`(providerId, value|null) => Promise<void>`) are
byte-identical pre/post extraction — 4 external call sites (`ProvidersSection.tsx`,
`providers.ts`) unaffected. `tsc --noEmit`, `eslint` on both files, and the full
`AuthContext.test.tsx` suite (142/142, includes the existing BIN-535/531/536 rollback +
stale-snapshot tests, which exercise the extracted logic indirectly) all green with zero
working-tree drift. No dedicated unit test file for the new hook itself — acceptable since it's
currently only consumed by AuthContext and fully exercised through that suite; worth adding a
direct `renderHook` test if/when a second consumer appears (a second consumer would also be the
point to double check the ref-based multi-instance isolation this review only reasoned about,
not stress-tested with two hook instances closing over shared mutable state).

### 2026-07-18 — First formal binge-code-reviewer pass on AuthContext.tsx (BIN-535/531/536 batch): clean, MY_GROUPS_LIMIT drift from the same-day pre-review is confirmed fixed
This is `AuthContext.tsx`'s first pass through the actual commit-gate agent (an earlier same-day
entry above analyzed this exact ticket batch but was not a gated review-agent run). Confirmed via
fresh trace, not just re-reading the prior entry: (1) `buildExistingProfile`'s extraction from the
inline existing-doc branch is behavior-identical — every field's fallback chain matches 1:1, the
only delta is added `as X` casts because the new param type is `Record<string, unknown>` instead
of the old inline `DocumentData` (implicit `any`), which is a strictly-typed no-op, and
`?.toDate?.()` (new) vs `?.toDate()` (old) is a safety-only widening, never a behavior change for
real `Timestamp` values. (2) The BIN-535 `runTransaction` wrap is retry-safe: traced all three
commit-ordering cases (transaction wins the race and creates the doc; `register()`'s plain
`setDoc({merge:true})` lands before the transaction's `tx.get`, correctly hit via `racedData` →
`buildExistingProfile`, never clobbered; `register()`'s write lands *during* the transaction's
attempt window, which Firestore's client SDK auto-retries via optimistic concurrency until `tx.get`
observes a consistent snapshot) — in every ordering the final doc converges to `register()`'s
authoritative fields (termsVersion etc.) surviving, because `register()`'s write is an unconditional
merge that always re-applies its own fields regardless of who created the doc first. No double
`tryAutoClaimUsername` call in either the raced or non-raced create path (traced both branches;
exactly one call site executes per `ensureUserProfile` invocation). (3) **The `MY_GROUPS_LIMIT`
drift flagged in the same-day pre-review above (local `AuthContext.tsx` constant = 500 vs
`groups.ts`'s rules-tied 100) is fixed in this diff** — `updateProviders` now imports
`MY_GROUPS_LIMIT` directly from `@/lib/firebase/groups` (`const { updateMemberProviders,
MY_GROUPS_LIMIT } = await import(...)`) instead of redeclaring a local value, closing the
same-source-of-truth gap. `fsdb()`'s spread-the-whole-module shape (`{ ...mod, db }` in
`src/lib/firebase/db.ts`) confirms `runTransaction`/`limit` were safe destructures with no export
gap. `tsc --noEmit`, `eslint` on both touched files, and `AuthContext.test.tsx` (10/10, incl. 3 new
BIN-535/531/536 test blocks) all green with zero working-tree drift. No blocking or non-blocking
findings; APPROVE.

### 2026-07-19 — groups.ts joinGroupViaToken/acceptGroupInvite rollback re-review: rollback shape is correct and rules-compatible (verified against real firestore.rules "leave" branch, no rules change needed); found one non-blocking NEW interaction — fixing the ghost-member lockout removes the accidental circuit-breaker on GroupPageClient's auto-retry effect
Re-reviewed the working-tree diff adding a per-write try/catch + `arrayRemove` rollback to both
functions' member-doc write (fixing the partial-write "ghost member" hazard: memberUids arrayUnion
commits, then the member-doc setDoc fails, leaving a uid with group read-access but no member doc,
permanently unretryable because `joinGroupViaToken`'s own `already_member` guard short-circuits any
future attempt). Confirmed correct and net-positive:
1. **Rollback write is a valid, already-covered rules shape — no `firestore.rules` change needed.**
   Traced `updateDoc(ref, { memberUids: arrayRemove(uid), updatedAt: serverTimestamp() })` against
   `firestore.rules`' group-update "leave" branch (`request.auth.uid in resource.data.memberUids &&
   !(request.auth.uid in request.resource.data.memberUids)`, size shrinks by exactly 1, name/defaults/
   ownerUid/inviteTokenHash pinned) — the rollback is literally a self-removal by the same
   `request.auth.uid`, i.e. exactly the "leave" shape, and that branch imposes no constraint on
   `updatedAt`. Confirmed via `git diff` that `firestore.rules` has zero changes in this diff and
   needs none.
2. **Both new tests correctly assert call ORDER, not just call presence.** `joinGroupViaToken`'s test
   correctly queues `setDocMock` in the real call order (1st = the Step-1 `joinAttempts/{uid}` write,
   2nd = the member-doc write that's made to fail) — verified this pairing against the actual source
   order (`deleteDoc(attemptRef).catch(()=>{})` doesn't consume the `setDoc` mock queue, only the real
   `setDoc(attemptRef, ...)` does). The `updateDocMock` filter-by-`_path==='groups/g1'` correctly
   excludes the unrelated `joinAttempts`/`members` sub-doc refs, isolating exactly the 2 group-level
   writes (original arrayUnion + rollback arrayRemove) it's asserting on.
3. **`acceptGroupInvite`'s "invite not deleted on failure" test is the right assertion for the right
   reason** — traced against the function body: `deleteDoc(groupInvites/{groupId})` is the LAST
   statement, unreachable once the `throw err` inside the catch fires, so the invite staying intact
   is a structural guarantee (not incidentally true), letting a user retry accept after a transient
   failure without the invite silently vanishing.
**One new, non-blocking observation, distinct from the security reviewer's already-approved
"self-healing ghost member" note**: `GroupPageClient.tsx`'s auto-join `useEffect` (unchanged by this
diff) retries `joinGroupViaToken` on every `joining`-state flip as long as `!isMember`, with no
backoff/max-attempt cap — before this fix, a member-doc-write failure left the uid permanently in
`memberUids`, so the very NEXT auto-retry hit the `already_member` guard and stopped (the ghost state
accidentally acted as a circuit-breaker, at the cost of a silently broken account). After this fix, a
rollback success returns the account to "not a member" and the SAME auto-retry effect fires again
immediately — which is exactly the intended self-heal for a transient failure, but for a
**persistent** step-3 failure (e.g. a rules regression, not transient network flakiness — traced
`firestore.rules`' `members/{memberUid}` create rule and confirmed its only real precondition,
`request.auth.uid in get(group).data.memberUids`, is trivially satisfied immediately after step 2's
own commit, so a genuinely persistent denial would have to come from something like a rules bug
rather than eventual-consistency lag) it now produces an unbounded tight retry loop (write-storm)
against a Blaze-cost-capped project instead of the old single-shot silent-ghost failure. Low
likelihood (requires a persistent, not transient, denial — hard to construct under the current rules
as traced above) and scoped to a client tab the user has open (not a background job), so not a
blocker, but worth a follow-up: either cap the auto-retry attempts in `GroupPageClient.tsx` or have
the rollback path set a local "don't auto-retry" flag distinguishable from a fresh, never-attempted
join. **General pattern**: when a fix removes an "accidental" error state that a caller elsewhere was
implicitly relying on as a circuit-breaker, check what that caller does once the accidental state is
gone — the caller doesn't need to be in the diff to be affected by it.
`npx vitest run` (11/11 green, up from 9), `tsc --noEmit`, and `eslint` (only pre-existing unrelated
mock-arg warnings) all clean at review time.

### 2026-07-19 — availableNotify BIN-523 self-heal fix (readLastFlatrate legacy fallback): correct and complete; sibling JSDoc a few lines away still asserts the fix's exact opposite
Re-reviewed `functions/src/availableNotify/{index.ts,logic.ts,logic.test.ts}` after an xhigh pass
caught readLastFlatrate orphaning ALL legacy `availableNotifyState/{tmdbId}` docs (not just
colliding movie/TV pairs) on the BIN-523 media-type-namespacing ship, silently swallowing every
title's first post-deploy "now streaming" transition. The fix — read the namespaced
`{movie|tv}_{tmdbId}` doc first, fall back to the legacy bare-`{tmdbId}` doc ONLY when the
namespaced doc doesn't exist yet — is correct and complete: `writeMarker` always advances the
namespaced doc forward on any successful fetch, so each title (including each half of a genuinely
colliding movie-N/TV-N pair, processed sequentially within one run — no race) self-heals to
clean, correctly-scoped state after its OWN first successful run; a title that keeps failing to
fetch keeps falling back on each retry, same accepted risk shape as before, not new. tsc clean,
17/17 `logic.test.ts` green including new pins for `availableStateDocId`/`normalizeMediaType`/
`inboxNotifId`. **The one real gap, high-confidence**: `logic.ts`'s `availableStateDocId` JSDoc
(unchanged by this fix, written when BIN-523 first landed) says *"Legacy bare-`${tmdbId}` docs are
deliberately ORPHANED, not migrated: ... reading them as a fallback would reintroduce the bug"* —
this is now a direct, factual contradiction of the code shipped in this exact diff, which
deliberately DOES read the legacy doc as a fallback (that's the whole fix). `index.ts`'s
`readLastFlatrate` got a good, accurate, dated JSDoc explaining the new design — but the OLDER,
now-wrong claim a few lines away in the sibling file was never touched, so the module now
self-contradicts about the single most safety-critical design decision in the file. This is a
sharper case than the general "stale comment describes old code" pattern (see the 2026-07-11
BIN-402 dedup-comment entry and the 2026-07-14 defaultMonthlyCost-comment entry above): a stale
comment that merely mis-describes intent is a readability nit, but a stale comment that
**actively asserts the fix must NOT exist, right next to the code that IS the fix**, is a live
regression hazard — a future engineer (or an LLM) reading only `logic.ts` and taking its docstring
at face value could "fix" the contradiction by deleting the fallback in `index.ts` instead of
updating the stale prose, silently reintroducing the exact bug this diff closed. **General check**:
when a fix changes behavior that an EARLIER, adjacent JSDoc/comment explicitly asserted as
permanent/deliberate (not just implicitly stale), grep for that comment's specific claim
repo-wide and update or delete it as part of the SAME diff — don't rely on the new code's own
comment to "win" by being more recent; two contradictory doc comments about the same invariant is
worse than one merely-outdated one, because the wrong one reads as the authoritative rationale for
undoing the correct one.

### 2026-07-20 — BIN-540/542/556/557 social batch: GroupPageClient auto-join backoff cap correctly closes the 2026-07-19 write-storm finding; the sibling BIN-540 rules fix for `vetoRemaining` bounds the VALUE but never binds it against the PRIOR value, so the exact "obegränsat veto" abuse the comment claims to close is only half-closed
Reviewed `firestore.rules`, `src/test/rules/firestore-rules.test.ts`, `src/components/pages/GroupPageClient.tsx`,
`src/lib/firebase/groups.test.ts`. Two of three sub-fixes are clean:
1. **GroupPageClient auto-join retry cap (BIN-557)** — `joinAttemptsRef` (useRef, survives re-renders,
   correctly reset by the `key={match.id}` remount in `DynamicRouter.tsx` on group-id change, verified) caps
   at `MAX_JOIN_ATTEMPTS=3` with `joinBackoffMs` reusing `queryClient.ts`'s exact `Math.min(1000*2**attempt,
   10_000)` retryDelay shape (byte-identical, not just "similar"). This is precisely the unbounded-retry
   write-storm the 2026-07-19 groups.ts rollback re-review (entry above) flagged as a new hazard the ghost-
   member fix introduced — confirmed closed: any THROWN error (network/Firestore) burns one attempt and backs
   off; any RESOLVED outcome (ok or a structured `!res.ok` reason) burns the whole budget immediately since
   every resolved reason is terminal (bad token stays bad, `already_member` means the subscription just needs
   to catch up) — traced both branches, no case re-fires after a resolved promise.
2. **`anonVoteAddOk()` diff() dedup (BIN-542)** — pure cost refactor, binds `request.resource.data.votes.diff(
   resource.data.votes)` once instead of calling `.diff()` twice; behavior-identical, not a logic change.
3. **`vetoRemaining`/`isHost` value validation (BIN-540) — the real, high-confidence finding.** The new clauses
   (`firestore.rules` ~851-853) correctly close the unbounded-value abuse the comment names ("en länk-innehavare
   kunde sätta vetoRemaining till vad som helst") via `is int && >= 0 && <= 1`, and correctly make `isHost`
   immutable-after-create via `(resource == null || request.resource.data.isHost == resource.data.isHost)`.
   But `vetoRemaining` has NO equivalent monotonic guard — nothing in the rule compares
   `request.resource.data.vetoRemaining` against `resource.data.vetoRemaining` on `update`. Since `1` is
   within the allowed `[0,1]` range regardless of the prior value, a signed-in participant (whose own
   `pid == request.auth.uid` path is fully self-writable) can call `updateDoc` directly — bypassing the app's
   ONLY spend path, `recordSwipe` in `src/lib/firebase/sessions.ts:119-123`, which unconditionally writes
   `vetoRemaining: 0` — and reset their own spent veto back to `1` an unlimited number of times, granting
   themselves infinite vetoes in a Tillsammans session. This is the EXACT invariant the fix's own comment
   states ("vetoRemaining: 1 vid join, 0 efter använt veto — inget annat") but the code doesn't enforce the
   "inget annat" (no other transition) half — only the absolute-bounds half. Confirmed empirically-reasoned
   (couldn't run `npm run test:rules` — port 8080 already held by a concurrent session's emulator instance)
   via direct rules-grammar trace: grepped all 3 `vetoRemaining` references in `firestore.rules`, none
   reference `resource.data.vetoRemaining`, no second `allow update` branch exists for `/participants/{pid}`
   (single combined `allow create, update` clause). Fix: add
   `&& (resource == null || request.resource.data.vetoRemaining <= resource.data.vetoRemaining)`.
   **Compounding test-coverage gap**: the new test titled "rejects re-granting a spent veto (0 → 1) on update"
   (`firestore-rules.test.ts`) doesn't actually test 0→1 — it asserts `updateDoc(..., { vetoRemaining: 5 })`
   fails, which the separate `>1`-range test already covers; a real `{ vetoRemaining: 1 }` update after
   spending to 0 currently SUCCEEDS (untested), so the test's name is a false-confidence label for a gap the
   suite doesn't actually close. Not covered by any `accepted-deviations.md` entry (checked; the closest is
   "anon-vs-anon forgery accepted" for participant DISPLAY fields, which is a different, already-decided gap
   for the unauthenticated path — this is a SIGNED-IN caller resetting their OWN bound doc, a business-logic
   monotonicity gap, not an anon-authentication limit). **General pattern to check on future "value validation"
   rules fixes**: adding `is <type> && >= min && <= max` closes an unbounded-value abuse but is NOT the same
   guard as a "can only move in one direction" (spend-down, ratchet, monotonic) invariant — when a fix's own
   comment describes a state-machine invariant ("X then Y, nothing else") rather than just a value range,
   verify the rule also binds the NEW value against `resource.data.<field>` (via `<=`/`==`/a diff on a
   ratcheting counter), not just against literal bounds; a range check alone permits every value inside the
   range to be re-entered from any other value inside the range, including "back up after spending down."
`groups.test.ts`'s 4 new BIN-556 tests (no-batch assertion, happy-path-no-rollback assertion) were traced
against the real `groups.ts` implementation (unchanged in this diff, confirms sequential-not-batched writes
per the BIN-532 get()-sees-no-sibling-write precedent) and match it exactly; 15/15 pass. `tsc --noEmit` clean
on all 4 files.

### 2026-07-20 — BIN-540 re-review: the FAIL's fix was real and correct, but landed UNSTAGED — a re-review that only reads `git diff HEAD` can pass a diff whose INDEX still carries the exact vulnerability
Re-reviewed after a FAIL verdict on the `vetoRemaining` participant rule (a spent slot could be
written 0 → 1 without limit). The fix is genuinely correct: a monotonic spend-down clause
(`request.resource.data.vetoRemaining <= (resource == null ? 1 : resource.data.get('vetoRemaining', 1))`)
added alongside the pre-existing 0..1 range check, with `resource == null ? 1` covering create and
`.get(field, 1)` treating a legacy doc with no `vetoRemaining` as unspent. Verified EMPIRICALLY, not
by reading: `npm run test:rules` initially did NOT run at all (port 8080 held by another emulator —
`emulators:exec` printed "Could not start Firestore Emulator, port taken" and still exited 0 through
the pipe, so a careless `| tail` read looks like a pass). Re-ran against an isolated emulator via a
scratch `--config` firebase.json on port 8091 + `FIRESTORE_EMULATOR_HOST` → 207/207 rules tests green
including the new create-at-0-then-`updateDoc`-to-1 `assertFails` case, which is the exact transition
the FAIL named.
**The finding that matters**: `git status --short` showed `MM firestore.rules` and
`MM src/test/rules/firestore-rules.test.ts` — the ratchet clause (8 lines) AND its test assertions
(12 lines) were BOTH unstaged. The staged index still held the range-check-only version, i.e. the
literal vulnerability the FAIL was filed against, plus a "0 -> 1" test that passes against it. A
commit made at that moment would have shipped the hole with a green-looking reviewer marker. This
sharpens the 2026-07-11 "always diff the unstaged working tree" entry into its inverse and more
dangerous form: there, a fix sat unstaged and I staged it; here, on a RE-review of a specific prior
FAIL, `git diff HEAD` (which merges index + worktree) renders the fix as present and correct, and
nothing about reading that diff reveals that the fix is absent from what would actually be committed.
**Rule**: on any re-review of a prior FAIL, after confirming the fix is correct, run
`git diff -- <file>` (worktree-vs-index, no `HEAD`) on every file the FAIL named and confirm it is
EMPTY. A non-empty worktree-vs-index delta on the fix file means the fix is not in the commit —
report it as still-blocking regardless of how correct the code is.
**Second, unrelated mechanic worth keeping**: `firebase emulators:exec` can fail to start the
emulator and still surface a zero exit through a pipeline. Always confirm a rules run printed an
actual test count ("Tests N passed") before treating it as evidence; "port taken" is a silent no-run.

### 2026-07-20 — BIN-562 priceHistory namespacing: when a doc-id scheme changes, the READERS' legacy fallback and the WRITER's seed-read are two separate fixes — shipping only the reader half silently orphans the data on first write
Reviewed the remediated 2026-07-20 sprint (27 staged files, media-type doc-id namespacing across
`streamingOffers`/`priceHistory`/`weeklyDigest`/`communityRatings` + BIN-557 group auto-join retry +
`useOptimisticMirrorField` extraction + BIN-540 rules ratchet). The batch is careful and mostly
correct: `readExisting` now recovers a missing/junk `mediaType` from the doc-id prefix instead of
dropping the row (dropping it reclassified the title as tier-0 "never checked", the HIGHEST refresh
priority — a handful of malformed docs could burn the month's MOTN budget); the legacy bare-id
`streamingOffers` doc is deleted after the namespaced write, correctly gated on the LEGACY doc's own
`mediaType` so a movie-N/TV-N pair sharing one bare doc can't have the sibling's only data path
destroyed; `dedupeIntent`'s swap from a local `mediaType === 'tv' ? 'tv' : 'movie'` ternary to the
shared `normalizeMediaType` (opposite default, unknown→'tv') is genuinely behaviour-neutral because
`isIntentTitle` — verified by reading it, not by trusting the comment — rejects anything that isn't
exactly `'movie'`/`'tv'` BEFORE dedupe runs, so the differing default is unreachable on real traffic.
**The finding, and the general pattern**: a doc-id migration has THREE call-site classes, not two —
readers, the writer's OUTPUT path, and the writer's own SEED/read-modify-write INPUT path. Here both
readers (`usePriceHistory`, `priceDropNotify`) grew a correctly-`mediaType`-gated legacy fallback,
and the writer's output moved to `mediaTypeDocId(...)`, but the writer's input
(`const points = ((await histRef.get()).get('points')) ?? []`) reads ONLY the namespaced doc. Since
`appendPricePoint` with `points: []` has no `last` to compare against, it always writes — so the
first post-deploy refresh of each title creates a namespaced doc holding exactly ONE point, and from
that moment both readers see `exists` and never fall back, permanently orphaning the accumulated
series. The file's own comment claims "shipping the write alone would take every price chart dark for
a refresh cycle" — the authors saw the reader/writer coupling and still missed that the writer
discards the history it is supposed to be extending. Verified the legacy docs DO carry a `mediaType`
field (the pre-diff writer wrote `{ tmdbId, mediaType, points, updatedAt }`), so a gated seed-read is
both viable and identical in shape to the readers' fallback. Aggravating context: BIN-180's own
module header calls this "the history asset Binge can't backfill". **Check on every id-scheme change:
grep the collection name and classify each hit as read / write-output / write-INPUT, and confirm the
read-modify-write seed got the same fallback the pure readers got.**
Second, smaller finding of the same "half-applied guard" class: `firestore.rules`' BIN-540 participant
guards deliberately tolerate a junk stored `vetoRemaining`/absent `isHost` (comparing an int against a
stored string is a TYPE ERROR that fails the WHOLE allow expression and would permanently brick a
victim's slot), and the rules tests pin that a slot carrying junk "is still writable by its owner" —
but those tests pass only because they explicitly send `{ vetoRemaining: 0 }`. `sessions.ts`'s new
rejoin branch OMITS both fields, so the post-merge doc still holds the junk and `is int` still fails:
the one client entry path a locked-out victim would actually use is the one that can't heal the slot.
**Pattern**: when a rules fix adds a "tolerate a corrupt stored value" default, check that a real
client write path actually SUPPLIES a valid replacement value — tolerance in the rule is only half a
recovery story if every app write that reaches that doc omits the field.
Also re-confirmed the process rule from the 2026-07-20 BIN-540 entry above: ran `git diff` (worktree
vs index, no `HEAD`) FIRST and confirmed it empty before reviewing anything — on this pass it was
clean, but that check is now cheap muscle memory and has caught a shipped-hole once already.
`useOptimisticMirrorField`'s `typeof window !== 'undefined' ? useLayoutEffect : useEffect` resolved at
MODULE scope (not per-render) is the correct isomorphic shape — hook order is fixed per environment,
so it is not a conditional hook; the returned setter stays `useCallback(..., [])`-stable because both
`source` and `commit` are read through refs at call time. `npm run test:coverage` = `vitest run
--coverage` with no `continue-on-error` and no `thresholds` in vitest.config.ts, so ci.yml's
two-steps→one-step collapse genuinely preserves blocking semantics in both directions (verify a CI
"this is equivalent" claim against package.json + vitest.config.ts, don't take the YAML comment's word).

### 2026-07-20 — planJoinFields remediates the prior "rejoin omits the healed field" gap, but heals only NON-int junk, not a valid-int-out-of-[0,1] — the rule's ABSOLUTE range clause has no heal path for that sub-case
Incremental re-review of the new pure helper `src/lib/firebase/sessions.joinPayload.ts`
(`planJoinFields(existing)→{firstJoin, heal}`) + its wiring into `joinSession` (now `getDoc` →
plan → branch-selected `merge:true` write). This directly closes the LOW finding my own 17:38 pass
filed (rejoin omitted vetoRemaining/isHost so a junk-typed slot stayed un-rejoinable). Confirmed the
core branch logic is correct: (1) valid rejoin → `heal:{}` so the merge write carries only identity
fields and the merged doc INHERITS the stored veto/host — this is the actual cross-device-lockout
fix (a spent slot at vetoRemaining 0 is never re-armed to 1, which the count-down ratchet would deny);
(2) `Number.isInteger` correctly rejects 0.5/'yes'/null/undefined and `typeof!=='boolean'` rejects
'yes'/null, healing to 0/false — and 0/false is the SECURE heal value (no free veto, no self-promote);
(3) healing an ABSENT vetoRemaining is not optional cleanup but REQUIRED — the rule checks
`request.resource.data.vetoRemaining is int`, so a merged doc missing the field fails `is int` and the
whole write is denied; supplying 0 is what makes the write legal at all, and 0 (not 1) is the safe
conservative fill. **The residual gap**: the heal predicate is `!Number.isInteger(x)`, which leaves a
VALID integer outside [0,1] (a pre-BIN-540-planted `vetoRemaining:2`, or `-1`) UNTOUCHED. The merge then
preserves it and the rule's ABSOLUTE `vetoRemaining >= 0 && <= 1` clause denies every rejoin — the exact
permanent lockout the heal exists to prevent, just for the integer sub-case the predicate doesn't cover.
Impact is genuinely narrow (the new rule blocks fresh planting of an out-of-range value, and the 7-day
session TTL expires any pre-deploy legacy value), so LOW/non-blocking — but it is the SAME remediation
intent falling one sub-case short, not a new class. Fix: `!Number.isInteger(x) || x < 0 || x > 1`
(preserves 0/1, heals everything else to 0). **General pattern**: when a "tolerate corrupt stored value"
rule pairs with a client heal that SUPPLIES the replacement (the half-a-recovery-story pattern from the
prior entry, now with the client half added), also check the heal's ACCEPTANCE predicate covers EVERY
value the rule would reject — a heal keyed on type (`!Number.isInteger`) misses a value that is the right
TYPE but out of the rule's RANGE, and the rule's absolute range clause offers no second heal path. isHost
has no analog here — bool has no out-of-range value, so type-based healing is complete for it.
**Follow-up, same day**: fix applied verbatim as suggested (`!Number.isInteger(veto) || veto < 0 ||
veto > 1`), landing 0/false for every value the rule would deny while leaving 0/1 untouched; 2 new
tests plus a mutation-check (reverting to the type-only predicate fails only the new out-of-range
test) confirm the range clause is load-bearing, not decorative. Closed clean, zero residual gap on
this surface.

### 2026-07-20 — BIN-185 season-only recaps: a render early-return keyed on a LAZILY-GATED hook's output is unreachable for its own target case, and the test mock hid it by ignoring the gate flag
Reviewed the unstaged `RecapPanel.tsx`/`useRecap.ts` diff adding season-only-sourced recap
support (a `SeasonRecapDoc.episodeCoverage: 'full'|'none'` tier, surfaced only for seasons the
user has fully finished). Found a HIGH-severity bug: the panel's overall bail-out,
`if (!hasBoundaryRecap && loadedSeasons.length === 0) return null;`, depends on `loadedSeasons`
— derived from `useSeasonRecaps(tmdbId, priorSeasons, open)`, whose queries are `enabled` ONLY
when `open` (the panel-expanded state, starts `false`) is true, by deliberate design (DBA "no
default-view reads" rule). For a season-only-sourced show, `hasBoundaryRecap` is ALWAYS false
(no per-episode boundary doc was ever written for such a show — that's the whole point of the
feature), so on first render `loadedSeasons` is always `[]` too (its query hasn't even fired
yet) — the gate returns `null` before the toggle button that would let the user open the panel
ever renders. Catch-22: the button needed to open the panel doesn't exist because the code that
decides whether to render it consults data that only becomes available once the panel is
already open. The feature was completely unreachable for its own headline scenario.
**Why the tests didn't catch it**: `RecapPanel.test.tsx`'s `useSeasonRecaps` mock signature
(`(_tmdbId, seasons) => seasons.map(...)`) drops the real hook's third `enabled`/`open`
parameter entirely and always returns fully-loaded data — so in the test's very first render
(before any click), `loadedSeasons` is already non-empty, satisfying the buggy gate and hiding
the bug completely. The fix (not yet applied — filed as a blocking finding) is to gate on a
signal known BEFORE the panel opens: `priorSeasons.length` (derived synchronously from the
always-on coverage-index query, the same source `seasonOnlySeasons` comes from), not
`loadedSeasons.length` (which requires a query gated behind the very state the check is trying
to unlock). **General pattern for future review**: whenever a component's top-level
render-or-bail-out check references the output of a hook/query that is ITSELF conditionally
`enabled` on local UI state (an accordion/panel `open` flag, a lazy-fetch-on-expand pattern),
verify the bail-out doesn't create a dependency cycle — "shows the disclosure trigger" must
never depend on data that only loads AFTER the disclosure trigger is clicked. And separately:
when a test mock for a hook takes fewer parameters than the real hook (here: dropping the
`enabled` arg), treat that as a signal to check whether the dropped parameter's real-world
gating is exactly what production code depends on for correctness — a mock that's "similar but
simpler" than the real hook can silently delete the one behavior (laziness) under test.
Also found, same diff: `useRecap.ts`'s BIN-544 `logRecapMiss` gap-effect checks only
`covered!.length === 0` (the boundary array) to decide "genuine miss" — not the new
`seasonOnlySeasons` field from the same index doc — so a season-only show (zero boundaries BY
DESIGN) unconditionally logs a false miss, polluting the very backfill-demand signal this
logging exists to build, for exactly the shows this diff adds support for. **Pattern**: when a
diff adds a new "this counts as coverage too" dimension to a doc/index shape, grep every
existing consumer that tested the OLD single-dimension emptiness check (`array.length === 0`)
for genuine-absence — a coverage-completeness signal that predates the new dimension needs
updating everywhere it's used as a proxy for "nothing here," not just at its point of origin.

### 2026-07-21 — BIN-560 Phase 0+1 mediaTypeDocId migration + hardening delta: strict-digit fix and all 3 new consumer sites correct; another live instance of the transient-concurrent-edit-artifact class, this time as a REGRESSION not a fix
Reviewed the staged `parseTmdbIdFromDocId` helper (client `src/lib/mediaTypeDocId.ts` +
server mirror `functions/src/shared/mediaTypeDocId.ts`) plus its swap-in at 12 fallback sites
(9 from Phase 1 + 3 newly folded in: `diary.ts flattenEpisodeProgress`, `groups.ts
watchlistDocToObject`, `useGroupMemberProgress.ts`). All confirmed correct: the strict
`/^[0-9]+$/` guard only changes behavior for empty/junk suffixes (`movie_`, `_`, ``,
`tv_1_2`) — a bare current-format numeric id never touches that branch (`indexOf('_') === -1`
short-circuits to the whole string, which is always all-digits today), so there is no
regression path for any doc id that exists in production right now; every `?? parseTmdbIdFromDocId(...)`
call site preserves stored-field-first precedence (nullish-coalescing semantics unchanged from
the prior `?? Number(d.id)` shape); `useGroupMemberProgress`'s subpath-from-`itemDoc.id` (not
`String(tmdbId)`) is the only behavior change with no fallback equivalence needed, and is
correct for both today's bare ids and a future namespaced id.
**Live-repro of the 2026-07-16 BIN-522 "concurrent-edit artifact" class, but in the DANGEROUS
direction this time.** A first `vitest run` of the new `mediaTypeDocId.test.ts` failed one
real-looking assertion (`parseTmdbIdFromDocId('movie_')` returned `0`, not `NaN`) — tracing it
found the WORKING TREE (not the index) had, at that exact moment, the OLD pre-fix body
(`return Number(numeric);`, no strict-digit guard) on BOTH `src/lib/mediaTypeDocId.ts` AND its
server mirror, while `git diff --cached` (the index, i.e. what would actually be committed)
correctly had the fixed strict-regex version. `git diff` (unstaged) showed a real 5-line
subtraction reverting exactly the strict-digit guard on both files. A `git diff --stat`
~10 seconds later showed the discrepancy gone (working tree back in sync with the index);
3 clean re-runs of the test file all passed. Same root cause class as BIN-522 (a concurrent
process/agent iterating the same files mid-review — "Samtidig loop = jobba på main") but the
PRIOR instance was a transient FALSE failure masking correct staged code; this instance was a
transient TRUE failure — the disk file really was regressed at that moment — that happened to
resolve itself before it could do any harm, purely because the concurrent writer's next edit
happened to restore the fix rather than commit the regression. **Sharper version of the
established lesson**: don't just re-run to confirm a failure disappears — additionally re-run
`git diff` (unstaged, not `--stat`) immediately before AND after the re-run to confirm the
working tree matches the staged index at both timestamps, especially for any file whose fix
IS the specific thing under scrutiny (here: the strict-digit regex was the exact subject of the
review's focus instruction). Had the concurrent writer's timing been different — landing a
`git add` of the regressed body between my failing run and my "it's clean now" recheck — a
reviewer trusting only "tests pass now" could have stamped a PASS marker over a genuinely
broken, about-to-be-staged helper. Always diff `--cached` vs unstaged explicitly, don't infer
one from the other.

### 2026-07-22 — mediaTypeDocId re-review: isolate-and-test the STAGED blob directly when working tree and index diverge, don't just note the discrepancy and hope
Delta re-review of the same BIN-560/562 file (`functions/src/shared/mediaTypeDocId.ts`) found a
similar-shaped but NON-transient divergence: `git diff --stat` showed a persistent 1-line unstaged
edit (`normalizeMediaType`'s `raw === 'movie'` → `raw?.toLowerCase() === 'movie'`) that did NOT
self-heal across repeated checks (unlike the prior entry's transient concurrent-writer artifact).
Running the newly-added case-sensitivity test (`normalizeMediaType('Movie')` expects `'tv'`) against
the working-tree file failed; running it against `git show HEAD:...` (wrong — that's the PRE-diff
base, not the staged version) would have been equally misleading. The correct move, and the one that
actually resolved the ambiguity: read the STAGED blob specifically (`git show :<path>`, no ref —
bare colon means the index), write it over the working file, rerun the suite (19/19 green — the
staged version is case-sensitive, consistent with the client mirror, and the new test was written
for exactly that), then restore the original working-tree bytes verbatim (saved to scratchpad first,
written back with the Write tool — not `git checkout --`, which the destructive-command guard rightly
gates and which would also have discarded the file's uncommitted state on a stray `git add`).
**Generalized technique**: when `git diff --stat` shows unstaged changes on a file that's ALSO
staged, and a test targeting that exact file fails, don't stop at "there's a discrepancy, might be a
concurrent writer" — isolate: snapshot the working file to scratchpad, overwrite with `git show
:<path>` (the actual staged blob, i.e. what `git commit` would record), run the suite against THAT,
then restore the snapshot exactly. This gives a definitive staged-content verdict instead of a
hedge, and is safe (no destructive git command, no risk to uncommitted work) since the round-trip
uses Read/Write-tool-captured bytes, not git history. Always name the specific stray unstaged edit
in the marker/findings (what it is, which file, why it must not get swept into a future commit
unreconciled) rather than silently working around it — the parent agent needs to know the working
tree still carries it after the review ends.

### 2026-07-22 -- BIN-560 Phase 2 (FINAL) re-review: resolveTmdbId's own prior marker predicted the bug it now fixes
Re-reviewed the 13-file FINAL delta closing out the BIN-560 mediaTypeDocId migration (the
8-file version PASSED earlier same day; an xhigh pass then found 3 gaps, addressed here):
(1) `resolveTmdbId` hardened from a plain `field == null ? parse(docId) : Number(field)` idiom
to `Number.isInteger(fromField) && fromField > 0 ? fromField : parse(docId)`; (2) 5 more backend
read sites (availableNotify, weeklyDigest, priceDropNotify, insights/rollup, followedSeries)
centralized onto `resolveTmdbId`, replacing their own hand-rolled `Number(x.tmdbId ??
parseTmdbIdFromDocId(d.id))`; (3) the two mirrored modules' new-function JSDoc re-synced to
byte-identical. **Notable**: the PRIOR marker for the 8-file version (written same day, now
superseded) had explicitly verified-and-documented the exact gap this hardening closes -- its
own text read "0 is preserved through all four shapes identically" as a positive equivalence
claim, not flagged as a risk. That's a legitimate finding an xhigh pass caught between the two
reviews (a genuinely-stored `tmdbId: 0` field would have silently produced a phantom title-id-0
under the old idiom, on every one of the ~12 call sites using it) -- worth remembering as a
pattern: "byte-identical to the old idiom, including edge case X" is a claim worth treating as a
live hypothesis for the NEXT reviewer to stress-test, not just historical record, especially
when X (a stored 0) is exactly the shape `Number.isFinite`/`??`/`!= null` guards are known to
mishandle elsewhere in this codebase (same landmine class as `parseTmdbIdFromDocId`'s own
`Number('')===0` fix from 2026-07-21). Verified the harder guard is now byte-identical between
both mirror modules (diffed staged blobs directly via `git show :<path>`, not working-tree
reads), is a no-op on all current prod data (only empty/zero/junk/absent fields change
behavior, and only for the strictly-more-correct direction), and that all 5 newly-centralized
call sites dropped their now-unused `parseTmdbIdFromDocId` import (grepped zero residuals).
`tsc` (root + functions), `eslint` (13 files), and 192 targeted vitest tests all green;
`git diff --stat` empty on all 13 files both before and after the test run.

### 2026-07-22 — BIN-560 Phase 4 cutover (~60 files): ONE real cross-media-type collision bug — refreshTmdbFields' session-dedupe key kept `${uid}:${tmdbId}`, missing mediaType, the ONE spot in the whole diff that didn't get the treatment its own sibling fix demonstrates
Reviewed the Phase 4 cutover diff (WatchlistContext's full mutator API gains a `mediaType`
param; every write ref becomes `mediaTypeDocId(mediaType, tmdbId)`; every `.find`/Map/Set that
mixed movie+TV by bare tmdbId gets composite-keyed). Traced every `.find`/Map/Set build-and-
lookup pair across all ~60 files (WatchlistContext's tags/notes maps, WatchlistPage's selected/
confirmDelete/nextAirByTmdbId, WeekStrip's aggregateByDay, recommendation excludedIds→
dedupeAndExclude + all 8 row hooks, libraryExclusionIds, useRecommendationsCascade's credits/
keywords maps, seedAnalysis's detection buckets, insights/rollup.helpers's topTitles,
HomePageClient's seed dedup, useFriendsWhoSaw's query key + doc ref, nextAirReadRepair's
`writtenThisSession` dedupe) — all correct, all build/lookup sites use the identical
`mediaTypeDocId(mediaType, tmdbId)` shape. **One miss, high confidence, real production
impact**: `WatchlistContext.refreshTmdbFields`'s echo-proof session dedupe
(`const dedupeKey = \`${uid}:${tmdbId}\`; if (refreshedThisSession.current.has(dedupeKey))
return;`) was NOT updated to include `mediaType`, even though the `.find` two lines below it
in the SAME function correctly gained the `&& i.mediaType === mediaType` discriminant. Effect:
a movie and a TV show sharing a numeric TMDB id (independent namespaces — collisions are a
real, not hypothetical, occurrence) visited in the same session will have the SECOND title's
TMDB-fields lazy-refresh silently no-op for the rest of the session, because the shared
`refreshedThisSession` Set already contains `${uid}:${tmdbId}` from the first title. This
matters because the diff's OWN sibling fix in `nextAirReadRepair.ts`'s `flushNextAirWrites`
(`writtenThisSession`, the exact same "mark a Set key before an await so a re-entrant call
can't double-fire" pattern, same session lifetime) DID get the composite-key treatment
(`keyOf = (u) => \`${uid}:${mediaTypeDocId(u.mediaType, u.tmdbId)}\``) — proving the author
knew the rule and applied it correctly everywhere else it appears; this was an isolated skip,
not a gap in understanding. No test caught it: `WatchlistContext.test.tsx`'s 8
`refreshTmdbFields` tests each use a distinct numeric tmdbId (77/78/79/80/81/999), none
exercises two DIFFERENT mediaTypes sharing one id — the exact shape needed to trip this bug.
**General lesson for future "convert every dedupe-Set/Map to composite-key" diffs**: when a
diff fixes the SAME bug class (bare-tmdbId collision) at N sites, grep for every session-scoped
"echo-proof"/"already written this session"/"in-flight" dedupe Set independently — they're
easy to miss because the fix pattern (add `&& mediaType` to a `.find`) doesn't visually
resemble the fix pattern for a session-guard Set (add mediaType to a template-literal key), so
a search-and-replace-style sweep can systematically skip the guard-Set shape even while
correctly catching every `.find`/Map/`.get` shape. Cross-check every `useRef<Set<string>>`/
module-scope `Set` in the touched files against the composite-key checklist explicitly, don't
rely on the `.find`-site density as a proxy for "this function is done."

### 2026-07-22 — BIN-560 Phase 3 firestore.rules mediaType value-check: a concurrent process can unstage a diff mid-review while leaving its content byte-identical — verify via working-tree diff, don't assume a now-empty `--cached` means the target changed
Reviewed `firestore.rules`' Phase 3 diff (4 validators — `isValidTagDoc`, `isValidNoteDoc`,
inline `episodeProgress`/`notInterested` — gain `(!('mediaType' in d) || d.mediaType in
['movie','tv'])`, mirroring the pre-existing `isValidReview`/`ratedAt`/`tmdbFieldsRefreshedAt`
optional-value-check idiom) + the matching additive `firestore-rules.test.ts` mutation tests.
Clean: all four `hasOnly` key-lists correctly gained `'mediaType'`, every value-check correctly
qualifies `request.resource.data`/`d`, the optional-wrap is right for the stated reason
(pre-cutover client omits the field, so absence must keep passing), and all pre-existing
legacy-shape tests (no `mediaType` key) are untouched and still valid under the new optional
guard. Tests match file conventions (`ownerDb()`, `assertSucceeds`/`assertFails`) and correctly
use namespaced doc ids (`'movie_603'`, `'tv_1399'`) matching the migration's target doc-id shape.
**Process note, new variant of the "diff can drift mid-review" class**: `git diff --cached`
returned this full diff at the START of the review; partway through, a second `git status`
check showed the SAME two files as unstaged working-tree modifications (`git diff --cached`
now empty, `git diff -- firestore.rules` still showing byte-identical content) — a concurrent
autonomous process (per the established "Samtidig loop = jobba på main" pattern) had unstaged
them, almost certainly via a `git reset`/commit cycle running in the same tree mid-review, not
via any action this review took. Confirmed via `git diff -- firestore.rules | head` that the
content was unchanged before concluding the review remained valid — do NOT treat a diff that
goes from present-in-`--cached` to empty-in-`--cached` as "the target file was reverted" without
diffing the working tree too; a concurrent commit/reset can relocate the same bytes between the
index and the working tree without altering them. If the working-tree diff had differed from
the originally-reviewed `--cached` content, that would require a fresh full review, not a note.
`npx tsc`/rules-emulator tests not independently re-run this pass (read-only review scope, no
edits made per the BIN-509 "don't edit firestore.rules mid-agent" lesson) — correctness verified
by static trace against the existing validated idioms in the same file, which is the appropriate
depth for a small, mechanically-repeated 4-site addition mirroring an established pattern.

### 2026-07-23 — reusing a "shared" globals.css className is a silent no-op if it's actually a nested/scoped selector
`.kind` in `globals.css` looks like a general-purpose label class (used identically at 4 call
sites in `MoviePageClient.tsx`/`TVShowPageClient.tsx`) but its only rule is
`.detail-hero .chips-line .kind { font-family: var(--mono); font-size: 12px; color: var(--ink-3);
... }` — it only applies inside that exact ancestor chain. New component
`src/components/tv/RelatedSeriesStrip.tsx` (BIN "Samma serie" continuity strip) reused
`className="kind"` on a `<span>` rendered as a sibling of `.detail-hero`, not nested inside it
(`TVShowPageClient.tsx` renders the strip after `.detail-hero` closes). Result: the intended
small-uppercase-dimmed label style silently doesn't apply — renders as unstyled default text,
no build/lint/type error, no visual-regression test catches it. **Check ancestor-selector scope
in globals.css before reusing a "shared-looking" className outside its established DOM
position** — grep every existing usage of the class and confirm the new call site sits inside
the same wrapper structure, or use a class that isn't selector-scoped.

### 2026-07-23 — Companion-titles (cross-type franchise links) review: clean; an eager (ungated) React Query fan-out that also feeds a loading-sensitive summary silently drops the reference's isLoading guard
Reviewed the new companion feature (`src/lib/franchise/companions.ts` + `companions.test.ts`,
`src/components/franchise/CompanionSection.tsx`, and a 2-line `<CompanionSection>` mount in each
of `MoviePageClient`/`TVShowPageClient`). It mirrors two shipped patterns faithfully:
`CollectionSection.tsx` (seen/unseen + `summarizeCollectionStreaming` + `addItem` to `vill_se`)
and the `relatedSeries`/`RelatedSeriesStrip` crawlable-strip idea. Confirmed correct on the
load-bearing parts: (1) **crawlability + no export-time hooks** — the plain `<Link>` chip strip
(`CompanionLinks`, zero hooks) is `ClientOnly`'s `fallback`, so it's in the static-export HTML;
the enriched grid (`CompanionEnriched`, which owns `useWatchlist`/`useAuth`/`useQueries`) is only
ever the `ClientOnly` *children*, so those hooks never execute during static export and the
fallback→children swap is exactly what `ClientOnly` exists for (no hydration mismatch).
(2) **BIN-560 dual-key self-exclusion** — `companionsFor` matches on BOTH `mediaType` AND `id` in
its `.find` and its exclusion `.filter`, so a movie and show sharing a numeric id don't cross-drop;
test-pinned. (3) **link-not-merge / no new writes** — the only write is `addItem` (guarded by
`addingId != null || getItem(...)`), identical payload shape to `CollectionSection`; no new
Firestore path. (4) shared `['movie-lite', id]`/`TMDB_STALE.LITE_DETAIL` key + AbortSignal passed;
Swedish UI, design tokens only (`var(--rule/ink-2/ink-3/acc-deep)`, `chip`/`similar-grid`/
`detail-section` all confirmed present in globals.css — not silent no-op classes), `<img>` with
width/height+lazy+decoding + the standard eslint-disable, no `next/image`, no `font-mono`.
`companions.test.ts` 8/8, eslint clean.
**One low-severity divergence worth naming as a pattern**: `CollectionSection` GATES its
`movie-lite` `useQueries` on `mounted && showStreaming` and therefore carries an explicit
`streamingLoading = queries.some(q => q.isLoading)` branch that renders "Hämtar tillgänglighet…"
during the fetch. `CompanionEnriched` deliberately makes the same fetch EAGER (ungated) — correctly,
because the poster grid itself needs the lite data, so gating on expand would break the grid — but
in doing so it dropped the loading guard: its streaming summary derives `considered` from
`films.filter(!seen && !!data)`, so during the (brief, post-hydration) window before the lite
queries resolve, `considered === 0` renders the false-negative "Ingen abonnemangstillgänglighet
hittad i Sverige." instead of a loading state. Low real-world impact (queries start at mount, so by
the time a user clicks the toggle data is virtually always in), but a genuine transient mislabel and
a faithful-reuse gap. **General check**: when a component reuses a reference's "fetch → summarize"
block but flips the fetch from expand-gated to EAGER (often justified — a sibling render, here the
poster grid, needs the same data), verify the reference's `isLoading`/loading-branch didn't get
silently dropped along with the `enabled` gate; an eager fetch's loading window now overlaps user
interaction, so the guard matters MORE, not less. Fix: add `const loading = liteQueries.some(q =>
q.isLoading)` and show the "Hämtar…" branch before the `considered === 0` branch, mirroring
`CollectionSection`.

### 2026-07-24 — buildAddPayload omit-semantics remediation: a concurrent agent's `git reset` can empty the index mid-sprint; and "pass `current` to protect the re-mark" is dead code when the CTA only renders while `current` is undefined
Reviewed the 23-file remediation pass (buildWatchlistAddPayload's inverted merge contract,
addItem's addedAt/tmdbFieldsRefreshedAt gating, useOptimisticMirrorField's BIN-592 ownerKey,
BIN-566 runSweep extraction, SeenPosterCard). Three things worth keeping:
1. **The index is not a stable review target when another agent shares the tree.** The task said
   "review the staged diff of 23 files"; `git diff --cached` returned FOUR unrelated files from
   the concurrent recap loop. `git reflog` showed `reset: moving to HEAD` as HEAD@{0}, after that
   agent's two commits — it had unstaged the whole sprint to stage its own work. This is a new
   variant of the 2026-07-22 "a concurrent process can unstage a diff mid-review" entry: there,
   the same bytes moved index→worktree; here the index was REPOINTED at someone else's files, so
   a `git commit` would have shipped the wrong change set entirely. Always (a) `git status
   --porcelain` and count files against what the task claims, (b) `git show --stat` every commit
   the concurrent agent landed to prove it didn't swallow the sprint's files, and (c) say in the
   marker, loudly, that the reviewed content is UNSTAGED and must be re-added explicitly (never
   `git add -A`, which would sweep the other agent's work in).
2. **A "pass `current` so the re-mark preserves data" fix is a no-op when the button that calls it
   only renders while `current` is falsy.** MoviePageClient's handleBevaka gained
   `current: watchlistItem` with a comment naming three fields it saves (rating, status,
   watchedAt). But CinemaCountdownStrip renders the Bevaka CTA only under `!inLibrary` — i.e.
   `watchlistItem === undefined` — so the argument is undefined in every reachable click, and the
   actual protection came from the payload builder omitting unsupplied keys. Worse, only `rating`
   is covered at all: the payload still hard-sets `status: 'vill_se'` and addItem unconditionally
   writes `watchedAt: item.status === 'sedd' ? ts : null`, so the unsettled-snapshot window still
   demotes a terminal 'sedd' film. **Check on every "pass the current row to protect a re-mark"
   diff**: trace whether the CTA's own render condition makes that value structurally absent at
   click time (a `!inLibrary` / `!getItem(...)` gate is the tell), and diff the comment's list of
   protected fields against what the payload + the write actually leave alone.
3. **Sibling stamp guards that differ must justify the DIFFERENCE per field, not by analogy.**
   addItem now gates `addedAt` and `tmdbFieldsRefreshedAt` on `currentForRating` alone, while the
   providers stamp 8 lines below uses `firstSnapshotSettledRef.current && !currentForRating`. The
   comment justifies the looser gate with addedAt's cost asymmetry (a doc landing without addedAt
   sorts nowhere and never recovers — genuinely true, `toDate(undefined)` returns `new Date()`),
   then applies the same rationale to tmdbFieldsRefreshedAt where it inverts: an ABSENT stamp
   self-heals on the next title-page view, a FALSE one suppresses that very repair for 90 days
   (`needsTmdbFieldsRefresh` returns false) and the sweep for ~6 months. When one guard is
   deliberately looser than its neighbour, verify the stated reason is field-specific — "same gate
   as X above" is a smell, because the whole point of an asymmetric-cost argument is that it does
   not generalise.
Also confirmed as safe under the new omit semantics, worth remembering as the checklist for any
"stop writing defaults, start omitting keys" diff: docToItem already defaults the newly-omittable
arrays (`providers`/`genreIds` -> []), firestore.rules' validator is `hasOnly` (no required keys,
so a create with fewer keys is not permission-denied), and the only backend reader of those fields
(insights/rollup.ts) already guards with `Array.isArray`. Grep the field name across
functions/src + any raw `doc.data()` consumer before accepting that an omitted key is harmless —
the in-app reader path (docToItem) is only one of three.

### 2026-07-25 — BIN-593 watchedAt tri-state: plan's own "consumers audited" list missed a reader

Reviewed the uncommitted BIN-593 diff (`watchlistWrites.ts`/`.test.ts`,
`WatchlistContext.tsx`/`.test.tsx`, `stats/page.tsx`, `WatchlistPage.tsx`, `tasks/todo.md`) that
implements Malin's decision: `watchedAt` (film "sedd"-date) auto-stamps ONLY when known-absent,
never auto-overwrites, never writes `null`. The diff itself is correct — `resolveCurrentWatchedAt`
/`canAutoStampWatchedAt` implement the exact tri-state (`Date` = stored/don't-touch, `null` =
known-absent/stamp, `undefined` = unknown/say-nothing), shared by both `buildStatusUpdate` and
`WatchlistContext.addItem` so the rule can't drift; the strict `=== null` is tested against
`undefined` explicitly; `docToItem` always coerces to `Date | null` so the tri-state can't be
silently collapsed on read; the manual paths (`updateWatchedAt`, `watchedAtOverride`) unconditionally
win as required; and the two consumer fixes named in the plan (`stats/page.tsx`'s `monthlyActivity`,
`WatchlistPage.tsx`'s `seenDate()` helper for the `/my/all` unfiltered column+sort) are both correct
and gate on `status === 'sedd'` exactly as claimed.

The plan (`tasks/todo.md`) states under "Open questions — Consumers are safe":
`DiaryPageClient.tsx:39`, `useServiceValue.ts:30`, `UserProfilePageClient.tsx:82`,
`WatchlistPage.tsx:210/740` all already gate on status, and "`src/app/stats/page.tsx:75` was the
ONLY `watchedAt != null` reader" needing a fix. That claim is false: `src/lib/taste/stats.ts:55`
(`computeProfileStats`, feeding `ProfileStatsPanel` — the public profile's "Senaste 30 dagarna →
Sedd" count) does `within30Days(item.watchedAt)` over the FULL unfiltered watchlist
(`UserProfilePageClient.tsx:110` passes `watchlist ?? []` with no status filter), with no
`status === 'sedd'` gate at all. Before BIN-593, `addItem` nulled `watchedAt` on every non-'sedd'
write, which incidentally kept this counter correct as a side effect nobody was relying on on
purpose; removing that null (the whole point of the fix — a stomped date is unrecoverable) now lets
a film marked 'sedd' then moved to 'avbruten'/'vill_se' within 30 days keep counting toward "Sedd"
on someone's public profile. `stats.test.ts`'s `mkItem` defaults `status: 'sedd'`, so no existing
test exercises a non-'sedd' item with a recent `watchedAt` — the gap is untested, not merely unfixed.

**Root cause of the miss:** the plan's author enumerated consumers by recalling where they'd
recently touched or read the field, not by grepping it. A `git grep watchedAt` across `src/`
surfaces every hit in ~2 minutes and would have caught this immediately (as it did here). **Lesson
generalized into the active principles file**: any diff that removes a field's status-scoped
"cleared on leaving X" write invariant requires an independent repo-wide grep of every reader of
that field, never trust the plan's own enumerated "consumers audited" list as exhaustive.

Also noted, advisory-only (not blocking, not in the diff): `CompanionSection.tsx:151`'s guard
comment ("erasing its watchedAt") is now stale in one clause — the guard is still needed for the
status-demotion half of the risk, but addItem no longer erases watchedAt on that path, so the
comment overstates what it's currently protecting against. Optional touch-up.

### 2026-07-25 — BIN-593 round 4: a comment's own correction doesn't reach its topic sentence
Fourth `/code-review high` pass on BIN-593 (the watchedAt user-authored-data fix). By this pass
the two behavioral changes since the last marker — `WatchlistPage.tsx`'s "Sedd datum" sort gated
on `showWatchedCol` instead of `status !== 'mina'`, and `WatchlistContext.tsx removeItem` pruning
`itemsRef.current` right after `deleteDoc` (closing a remove-then-re-add-as-'sedd' window that would
otherwise stamp a fresh doc with no date) — were both correct: the sort option's condition matches
the column's exactly (`status === 'sedd' || !status`), and the ref-prune sits before the best-effort
tags/notes deletes, filters on the same `(tmdbId, mediaType)` pair passed to `deleteDoc`, and is read
only by `addItem`/`updateStatus` (the two mutators BIN-598 already scoped `itemsRef` to) — so no
other consumer can observe it out of step with `items` state.

The round's real find was in the COMMENT layer, exactly the class the prior two passes kept
producing. `WatchlistContext.tsx`'s `itemsRef` declaration (~line 167) opens: "the snapshot's items
as a LIVE ref, written in the same statement as `firstSnapshotSettledRef` below." Eight lines later,
in the SAME uninterrupted comment block, a corrected paragraph says the opposite: "The pairing is
upheld by both being assigned inside the SAME onSnapshot callback... — not by adjacency, they sit
~28 lines apart... Anything added between them must stay synchronous." A near-identical echo sits at
the assignment site (~line 223): "Same statement as `firstSnapshotSettledRef` above" — also literally
false; `firstSnapshotSettledRef.current = true` is set ~29 lines earlier in the same callback, not in
the same statement. Whoever fixed the invariant description rewrote the explanatory paragraph but
never touched the topic sentence that the paragraph exists to correct, so the comment now argues
with itself. This was flagged as blocking (not shipped as-is) and folded into the active knowledge
file's Comment-vs-code corpus principle: read the WHOLE comment block a diff touches, including
hunks that look unrelated to the one you're checking, because a correction can land next to the very
sentence it's correcting without anyone reconciling the two.

No other comment in the diff (across `WatchlistPage.tsx`, `watchlistWrites.ts`/test,
`WatchlistContext.tsx`/test, `stats.ts`/test, `stats/page.tsx`, `MoviePageClient.tsx`,
`CompanionSection.tsx`) made a claim the adjacent code didn't back up — each was cross-checked
against the actual guard/type/write it described (`WatchlistItem.watchedAt: Date | null` in
`domain.ts:92` backs the `currentWatchedAt` JSDoc's typing claim; `addItem`'s payload has no
`rewatchCount`/`watchedAtOverride` reference, backing the "ALL they share" enumeration in its
stamp comment; `resolveCurrentWatchedAt`/`canAutoStampWatchedAt` implementations match their
JSDoc's stated null/undefined/value semantics exactly).

Advisory, not blocking: the remove-then-re-add race the `removeItem` fix closes has no dedicated
regression test (only manually traced) — the existing `WatchlistContext.test.tsx` BIN-593 suite
covers the cold-load and stale-closure races but not this one. Test-reviewer's gate, not this
review's; noted for the record.

### 2026-07-25 — BIN-595 (`addItem` visibility clobber): a genuine flake surfaced on the exact
### assertion the fix exists to prove, and had to be run to ground rather than eyeballed
Reviewing the fix for `addItem` unconditionally re-stamping the profile-default
`effectiveVisibility`/`isPublic` trio over a per-item privacy override on every re-mark (the
re-mark path is StatusButton/QuickAddButton/useMarkSeen, all of which route through `addItem`).
The fix is a pure `shouldStampVisibility(current, snapshotSettled)` helper in
`watchlistWrites.ts`, spread conditionally in `addItem`'s `setDoc` payload.

First run of `npx vitest run src/lib/watchlistWrites.test.ts src/contexts/WatchlistContext.test.tsx`
showed 2 failures, both BIN-595 tests, both asserting `'effectiveVisibility' in payload` is
`false` (title has an override, or cold-load) but observing `true` — i.e. exactly the bug this
ticket exists to fix, appearing to still be present. This could not be waved off as "probably
fine" given what was at stake. Isolated with a temporary `console.log` inside `addItem` printing
`currentForRating`/`settled`/the helper's return value, confirmed via `git diff --stat` that the
debug edit was the ONLY unstaged change, ran the single failing test by name (`-t`) — passed.
Removed the debug log, confirmed byte-identical to the staged blob (`git diff --stat` empty
again), then re-ran the original two-file command 6 times, the single file alone 8 times, and a
15-iteration loop of the two-file command — 0 failures across all 29 subsequent runs. The pure
`shouldStampVisibility` unit tests (no React/Firestore mocking, no `act()`/render lifecycle)
never flaked in any run, which is consistent with the failure being an artifact of the mocked
Firestore/React harness's test-order or timer scheduling rather than the production logic. Ruled
one-off environment flake, not a regression — but said so explicitly and by the numbers in the
review marker rather than silently treating the second (passing) run as the only one that
happened. Folded into the active file's "staged index is ground truth" principle: a test failing
on the specific behavior a fix targets earns a double-digit re-run before either blocking or
clearing it, and the bisection method (temp debug edit, byte-diff back to the staged blob before
verdict) is the same discipline the file already prescribes for isolating staged-vs-worktree
divergence — it just hadn't been named for "flaky failure on the load-bearing assertion" before.

### 2026-07-26 — BIN-596: a self-correction on "not exploitable," and an asymmetric-stamp gap the correction's own guard doesn't cover

My own prior marker entry (2026-07-25 00:42:49, BIN-595 round) had reasoned that a
missing `onSnapshot` error callback on the watchlist listener was "not newly
exercisable" because the Firestore read rule for `users/{uid}/watchlist/{itemId}` is
an unconditional `isOwner(uid)` — a signed-in owner reading their own collection
"cannot receive `permission-denied` under normal operation." The dispatching agent
correctly flagged this reasoning as too narrow: `onSnapshot` can fail independently of
the read rule — App Check enforcement, a failed auth-token refresh, or IndexedDB
persistence failing to initialise offline all terminate the listen without ever
evaluating the rule. Once `StatusButton`/`QuickAddButton` started gating their
`disabled` state AND their write path on `loading` (this same BIN-596 round), a stuck
`loading=true` from any of those three causes would grey out every add control app-wide
for the rest of the session with no message and no retry — exactly the failure mode the
narrow "rules can't deny an owner" argument missed by construction (it only reasoned
about the RULE, not the LISTEN itself).

The fix: `onSnapshot(query, next, err)` now takes a third argument that logs and calls
`setLoading(false)`, while deliberately leaving `firstSnapshotSettledRef.current` false
— the reasoning being "we still don't know this library's contents, so the add-time
guards must keep treating that as unknown rather than as empty." Verifying that choice
by tracing every guard keyed on `firstSnapshotSettledRef`/`itemsRef` in `addItem`:

- `watchedAt` (`canAutoStampWatchedAt(resolveCurrentWatchedAt(currentForRating,
  firstSnapshotSettledRef.current))`), `providersCheckedAt`
  (`shouldStampProvidersAtAdd(firstSnapshotSettledRef.current && !currentForRating, …)`),
  `tmdbFieldsRefreshedAt` (`firstSnapshotSettledRef.current && !currentForRating`), and
  the visibility trio (`shouldStampVisibility(currentForRating,
  firstSnapshotSettledRef.current)`) — ALL correctly stay silent forever once the
  listener has permanently failed (no retry, per the existing "permission-denied
  TERMINATES an onSnapshot" principle) and `itemsRef` freezes wherever it was at
  failure time. This is the safe side of each field's own documented asymmetry: an
  absent stamp self-heals via a read-side repair path; a false one wouldn't.
- `addedAt` is NOT gated on `firstSnapshotSettledRef` at all — by design, per its own
  comment ("the cost of guessing wrong is asymmetric per field... a genuinely new doc
  that lands WITHOUT addedAt sorts nowhere and never recovers, so during a cold load we
  must still stamp"). Its guard is `currentForRating ? {} : { addedAt: serverTimestamp()
  }`, keyed purely on `itemsRef.current.find(...)`. Once the listener has permanently
  failed, `itemsRef` never updates again this session — so `currentForRating` is
  `undefined` on literally every subsequent `addItem` call, including ordinary re-marks
  (a ­status change via `StatusButton`, a re-mark via `useMarkSeen`). Each one re-stamps
  `addedAt: serverTimestamp()`, silently overwriting the title's true original add date
  on every touch for the rest of the session — the exact addedAt-drift class BIN-593's
  sibling guard exists to prevent, reopened here through a listener-DEATH path rather
  than the cold-load-TIMING path the guard was built against.

This is not a regression introduced by BIN-596 (before it, `StatusButton` had no gate
at all, so the same drift was already reachable the instant a permanent listener
failure occurred — the disabled gate doesn't create the exposure, it just doesn't close
it either). Practical severity is low: it requires a listener failure that never
recovers for the rest of a session, itself a rare event (App Check misconfig, a token
refresh that keeps failing, offline persistence init failure that doesn't self-heal on
reconnect). Filed as an advisory follow-up, not blocking — two remediation shapes
discussed: accept as a documented rare edge case, or gate `addedAt` on a coarser
"has ANY snapshot EVER landed this session" signal that is distinct from
`firstSnapshotSettledRef` (which already serves the per-uid cold-load-timing job well
and shouldn't be overloaded with a second, different failure-mode meaning).

Separately verified in the same pass: `useMarkSeen.ts` has no `uid` awareness of its
own (neither its TV nor film branch checks `uid` before calling `promptRating()`), so
`StatusButton`'s new `if (!uid) return;` guard — placed BEFORE the `status === 'sedd'`
branch — is load-bearing for markSeen's path too, not just the plain-status write. And
the identical false-toast SHAPE (no `uid` check before an unconditional success toast)
exists in `StatusButton.handleRemove` and `QuickAddButton.handleRemove` (the latter
pre-existing/unchanged), but is structurally unreachable in practice: the "Ta bort"
trigger only renders inside `{current && (...)}`, and `current` requires `items` to be
populated, which requires `uid` — the one theoretical gap is a same-render race
immediately after sign-out before the listener's cleanup effect flushes `items` back to
`[]`, which does not survive to a clickable frame since `WatchlistProvider` and its
consumers re-render together on the `uid` state change. Not filed as a ticket.

Also found: `WatchlistContext.test.tsx`'s Firestore mock (`onSnapshot: (ref, cb) =>
{...}`) only accepts two parameters and silently drops any third argument — so even
though production code now calls `onSnapshot(query, next, err)` with three arguments,
no test exists that captures `err` and drives it to assert `loading` settles `false`
and `firstSnapshotSettledRef` stays `false`. This is this round's headline fix and it
currently has zero executable coverage, verified by comment/manual-trace only. Advisory
per the "coverage gaps are binge-test-reviewer's gate" convention, flagged here because
the invariant is exactly the kind ("verified by manual trace only") that principle
calls out for an explicit mention.

### 2026-07-26 — BIN-595 round 7: a fixed false-history comment survived verbatim in two sibling files
Rounds 1-6 on this ticket (`shouldStampVisibility` in `watchlistWrites.ts` + its
`addItem` call site) had already found and fixed: the "denormalised visibility trio"
naming hazard (the natural third member is `visibility` itself, which `addItem` must
NEVER write — it's in `buildAddPayload`'s `ServerOwned` set, `updateVisibility` is its
only writer), a self-contradicting test comment about which paths yield
`itemsRef.current.find(...) === undefined`, and a `tasks/todo.md` pointer to a
per-session temp path. Round 6 also fixed a past-tense false-history claim at
`WatchlistContext.tsx:404` — the original wording ("wrote the profile default...
republished a title the user had deliberately hidden, on a status change") narrated the
leak as something that actually occurred to a real user, but the same diff establishes
`updateVisibility` has zero call sites in any released version, so no per-title override
could ever have existed to hide anything. Fixed to conditional ("...unconditionally
WOULD republish... Conditional, not past tense: no released version ever shipped a UI
for the per-title override").

Round 7 (this one) found that fix did not propagate: the EXACT quoted phrase
"republished a title the user had deliberately hidden" survived verbatim, unfixed, in
`WatchlistContext.test.tsx`'s block-comment header (lines 702-705, describing the whole
BIN-595 `describe` block — only the word "trio" in the same paragraph had been swapped
out, the false-history clause right next to it was untouched). A close cousin — "The
bug: addItem wrote the PROFILE default over a title the user had hidden, republishing
it on nothing more than a status change" — was independently present in
`watchlistWrites.test.ts:178-179` and had never been touched across any of the 7 rounds
(that file's blob was byte-identical to the very first reviewed version). Diffing the
old-vs-new STAGED BLOBS via `git show :<path>` on both sides of the review boundary (not
`git diff HEAD`, and not naive `diff` on extracted files — CRLF vs LF made a raw file
diff show the whole file as changed) proved conclusively that no executable line moved
across the whole round, isolating the search to comment text, where the grep for the
exact quoted phrase from the task instructions immediately found both survivors.

Lesson generalized into the "Comment-vs-code corpus" principle: fixing a claim at ONE
call site does not fix the same claim quoted or paraphrased in a sibling test file.
Grep the exact phrase repo-wide (or at minimum across every file in the diff) whenever
a review's stated fix is "reworded a comment," not just at the file that was open.

### 2026-07-28 — AuthContext BIN-587: auto-retry effect races a manual re-trigger of the same mutation
`updateDefaultVisibility`'s on-load retry effect (`useEffect` gated on `uid && pendingVisibilityTarget && visibilitySyncPending && visibilityRetriedFor.current !== uid`) calls `cascadeVisibilityToItems(uid, pendingVisibilityTarget)` where `pendingVisibilityTarget = user?.defaultVisibility` captured at the moment the effect fires. If the user changes their visibility radio (a second, independent call to `updateDefaultVisibility`) while that auto-retry cascade is still in flight, there are now two concurrent `writeBatch` commits targeting the same `users/{uid}/watchlist/*` docs with two different `effectiveVisibility` values, and no coordination between them. Whichever commit lands last wins the item docs — not whichever call is "newer" — so a user's fresh, explicit visibility-narrowing choice (e.g. public→private) can be silently overwritten back to the stale pre-change value if the auto-retry's batch commits after the manual one. Worse: each call's own `.then(() => markVisibilitySyncPending(uid, false))` fires independently on ITS OWN success, so the LATER-firing call's flag-clear can report "synced" even though the OTHER call's stale write is what actually persisted — the exact "fails open" failure mode BIN-587 was created to close, reopened one layer up. No epoch/version guard exists on either the cascade or the flag write; `visibilityRetriedFor.current` only prevents the AUTO-retry from firing twice, it does nothing to fence it against a concurrent MANUAL call. Filed as a review finding (not yet fixed as of this entry) rather than shipped code — reviewed on an unstaged working-tree diff, commit ad014ce was HEAD at review time. Fix direction: an epoch counter bumped synchronously at the start of every `updateDefaultVisibility` call (mirroring the `firstSnapshotSettledRef`/sync-ref-before-await family), captured in the closure, checked before the cascade's writes AND before the flag-clear land ("is my epoch still the current epoch?") — or a coarser in-flight boolean that makes the auto-retry skip itself entirely whenever a manual call is already running (and vice versa).

### 2026-07-28 — useEpisodeProgressWithSync.helpers.ts: new JSDoc block orphans the sibling function's doc comment
BIN-588's fix added `isSeasonFullyWatched` (with its own new JSDoc) directly between `highestWatchedPosition`'s pre-existing doc comment and the `highestWatchedPosition` function itself. Net effect: the original doc block ("Räknar fram högsta sedda position...") now sits immediately above `isSeasonFullyWatched` and reads as describing IT, while `highestWatchedPosition` — unchanged, still correct — has no doc comment directly above it at all. Purely a documentation-placement defect (JSDoc tooling and a human reader both attach a comment to the next declaration, so this isn't cosmetic); the logic in both functions is correct and well-tested (`useEpisodeProgressWithSync.helpers.test.ts` covers `isSeasonFullyWatched`'s finale-without-full-season case, hole-counting, malformed keys, null/zero/NaN episodeCount). Reviewed on an unstaged working-tree diff (git diff --cached was empty for this batch), HEAD ad014ce. Also flagged in the same batch: `QuickRateModal.tsx`'s `discoverMovies` `useQuery` doesn't thread `ctx.signal` through to the fetch — every other TMDB `queryFn` in the repo does (`useTMDB.ts`, `useCalendar.ts`, `useDiscoveryPremieres.ts`, etc.), so navigating away/closing the modal doesn't cancel the in-flight discover call. Both are Medium severity, non-blocking; the BIN-588 season-fully-watched gate and BIN-599 QuickRateModal rewatch-inflation fix (verified against `watchlistWrites.ts`'s `buildStatusUpdate`/`isRewatch`) are otherwise correct.

### 2026-07-28 — AuthContext BIN-587 race (archived above): FIXED, re-reviewed correct
Follow-up to the "auto-retry effect races a manual re-trigger" entry immediately above. The
automated-fix round added exactly the three-part mechanism that entry's "Fix direction"
sketched: (1) `visibilityEpoch` ref bumped SYNCHRONOUSLY (`++visibilityEpoch.current`)
at the top of BOTH call sites (`updateDefaultVisibility` and the retry effect) before any
`await`, so ordering follows invocation time, not network resolution time; (2) a
`visibilityQueue` ref (a chained `Promise<void>`) that serializes cascades so two are
never concurrently mid-batch against the same watchlist docs -- `runVisibilityCascade`
chains each new call onto the prior one's full settlement (`.then(() => {}, () => {})` so a
rejection never breaks the chain for the next caller); (3) `visibilityWritesInFlight`
(a plain counter, incremented/decremented around the manual call's whole body in a
try/finally) that the retry effect checks before starting, so it never begins while a
manual call's own pre-cascade profile write is still outstanding.

Hand-traced every interleaving against the implementation (`src/contexts/AuthContext.tsx`,
`cascadeVisibilityToItems` + `runVisibilityCascade` + `updateDefaultVisibility` +
the retry `useEffect`) and the new tests in `AuthContext.test.tsx` ("failed visibility
cascade no longer fails open" describe block, 5 cases incl. the adversarial "a newer
manual choice wins over an in-flight auto-retry, and only it clears the flag" test that
drives a held-open retry batch commit and a concurrent manual call via a controllable
`writeBatch` mock + a `timeline` array asserting commit order). Confirmed the one residual
window is benign: `cascadeVisibilityToItems` only rechecks `isCurrent()` once, right after
its `getDocs` await and before kicking off `Promise.all(chunks.map(...))` (load-bearing
since there's no further await between that check and the batch.commit() calls starting)
-- so a write already in async flight when a NEWER epoch is bumped can still land with
stale data. This does NOT cause a wrong final state, because the newer call is queued to
run (and thus write, and thus decide the flag) strictly AFTER the older call's whole
promise settles, by construction of `visibilityQueue`. The exact scenario is what the
adversarial test drives and asserts converges correctly
(`timeline = ['commit:public', 'commit:private', 'flag:__delete__']`).

Verification commands: `npx vitest run src/contexts/AuthContext.test.tsx` -> 15/15 passed;
targeted `npx tsc --noEmit` clean on all 3 files. `firestore.rules` untouched by this diff
and was already rule-legal for both new writes (`users/{uid}` update has no `hasOnly`
restriction, so `deleteField()` on `visibilitySyncPending` is fine; the watchlist item
`hasOnly` list already whitelisted `effectiveVisibility`/`isPublic` from the original
BIN-587 shipment). `UsernameSection.tsx`'s new pending-banner + retry button use real
`danger` design tokens (`btn-danger-ghost`/`border-danger`/`bg-danger-soft`/`text-danger-ink`,
confirmed present in `globals.css`), not raw Tailwind red, and Swedish copy. Reviewed on an
unstaged working-tree diff (git diff --cached empty for these 3 files), HEAD ad014ce.
No new Critical/High. Marker entry: `.claude/state/code-review-done.marker`, 2026-07-28T23:42:00Z.

### 2026-07-29 — a sibling agent's mutation testing makes the reviewed file fail its own tests

BIN-608 (Tillsammans legacy/namespaced swipe-vote merge), reviewed as an UNSTAGED
working-tree diff at HEAD 0c83c45. Two things bit, both process, neither a defect in the
diff.

1. **Mutation testing by a concurrent agent looked exactly like a real bug.** First
`npx vitest run src/lib/together/matching.test.ts` -> 4 failed / 23 passed; an immediate
second run -> 2 failed / 25 passed. Different counts, different tests, same command, no
edit by me. The failures landed on precisely the assertions the fix targets ("a namespaced
swipe doc wins over a legacy one", "a participant who voted in both docs resolves to the
namespaced (newer) vote"), and the observed values were internally consistent with a
DELIBERATELY WRONG implementation: run 1 behaved like the pre-fix document-pick
(`nextCandidate` re-asked a participant whose only vote was in the legacy doc), run 2
behaved like `{ ...current, ...legacy }` (merge direction reversed, legacy winning).

`ls -l --time-style=full-iso` showed `matching.ts` mtime 00:49:23 — between my two runs.
Polling `git hash-object src/lib/together/matching.ts` every 10 s for two minutes gave:
`f8b6e8b31e8...` (00:50:02, document-pick revert) -> `491c8ab118c...` (00:50:12) ->
`860e577b01c...` (00:50:44, stable for the next 80 s). `860e577` is exactly the post-image
blob named in the original `git diff` header (`index a1d527d..860e577`), i.e. the bytes the
task asked me to review. Re-running against that settled blob: **27 passed / 27**, with
`git hash-object` printing `860e577b01c...` immediately BEFORE and AFTER the run. So: some
other session (almost certainly binge-test-reviewer proving the new tests are load-bearing)
was cycling mutations through the file under review.

Generalised rule, folded into the "concurrent agent shares this tree" and "never dismiss on
one run" principles: hash the reviewed file immediately before AND after every test run and
quote both hashes in the marker; a pre/post hash that doesn't equal the `git diff` header's
post-image blob means the run proves nothing. When it moves, poll to settling — do NOT edit
anything back, the other agent owns that restore. And note that two consecutive runs failing
DIFFERENTLY (4 then 2) is itself the tell that no single implementation produced both.

2. **`git rev-parse :<path>` is the wrong pin for a working-tree review.** Nothing was
staged (`git status --porcelain` = four ` M` entries), so the index still pointed at HEAD's
PRE-fix bytes; pinning `:src/lib/together/matching.ts` would have certified the un-fixed
content while the marker text described the fix. Used `git hash-object <path>` for all five
files instead and said so explicitly in the marker, with a "re-verify these hashes before
committing" line. `.claude/rules/data-model.md` is gitignored, so it never appears in
`git diff` at all — hash it directly or it silently escapes review.

**Findings filed (both advisory, non-blocking).** (a) The new BIN-608 test
"merging legacy forward still keeps film 42 and serie 42 apart" seeds NO legacy doc — it is
a near-duplicate of the existing BIN-569 test at matching.test.ts:183 and does not exercise
the merge its name claims; the load-bearing case (legacy doc present AND both `movie_42`
and `tv_42` namespaced docs, post-cutover tallies still separate) is uncovered. Same class
as the standing "a test whose NAME claims a transition it doesn't exercise" principle.
(b) The "Known, accepted ambiguity" note (matching.ts:38-41 and tasks/todo.md) claims
merging a bare-`42` legacy doc into both media types "is not a regression, it is exactly
what the code did before BIN-569". True against PRE-BIN-569 — but against the CURRENTLY
SHIPPED 0c83c45 it is a narrow regression: there, the first namespaced write for a media
type SHADOWED the ambiguous legacy doc and thereby self-healed cross-type contamination,
whereas the merge re-shares those legacy votes for the session's remaining TTL. Needs a
mixed deck holding both movie N and tv N and a session spanning the deploy; unfixable
without attribution data that does not exist; net still far better than the pre-BIN-569
full collision. Recommended one clause on the comment rather than a code change.

Verification: 27/27 vitest on blob 860e577; `npx tsc --noEmit -p tsconfig.json` exit 0;
`npx eslint` on matching.ts + matching.test.ts + sessions.ts exit 0. Read-path sweep
(`grep -rn "\.votes|indexSwipes|swipes" src/ functions/src/`) confirmed all four consumers
funnel through `indexSwipes` — scoreCandidates:114, nextCandidate:169,
participantSwipeProgress:178, useMySessions.ts:57 — and that
`TillsammansSessionPageClient.tsx:548`'s `r.votes[me.id]` reads the merged result, so no
read path keeps the old document-pick behaviour. Also confirmed a legacy doc cannot outlive
its session: `expiresAt` is written once at create (sessions.ts:33-34), never extended, and
retentionCleanup recursive-deletes the session doc together with `swipes/*`.

### 2026-07-29 — BIN-608 re-review: the sibling mutates the TEST file too, and a fixed comment doesn't reach the plan doc

Second review pass on the same BIN-608 working-tree diff (HEAD 0c83c45, nothing staged).
The launching agent flagged that my previous marker pinned `matching.ts@860e577` and the
file had moved. Four files in `git diff` (`matching.ts`, `matching.test.ts`, `sessions.ts`,
`tasks/todo.md`) plus gitignored `.claude/rules/data-model.md`.

**1. The concurrent mutation testing now covered BOTH files, and manual poll-then-run lost
the race twice.** `matching.ts` cycled d508ae7c -> 83506b89 -> 5757480c -> 78c3298f ->
02642dee, and `matching.test.ts` moved 951e6d63 -> e681bf23 -> 951e6d63. e681bf23 was NOT
noise: diffing it against 951e6d63 showed the sibling had permuted the seeded swipe ORDER
in the two new BIN-608 cases (legacy doc listed last instead of first), i.e. proving the
merge is order-independent — a legitimate hardening probe on the file under review. I
polled `matching.ts` to a 60 s-stable 02642dee, ran, and the file had ALREADY moved back to
d508ae7c by the time the 13 s run finished; the second attempt caught the test file moving
instead. What worked: a bash loop of `[hash both files -> npx vitest run -> re-hash both]`,
up to 15 attempts with a 12 s sleep when the prod file wasn't at target, accepting only the
iteration where pre == post == target for BOTH. Attempt 7 was clean: **28 passed (28)** on
`matching.ts@02642dee530a71e29cdb550de2b53064076591b1` +
`matching.test.ts@951e6d63df56506a3efb913f3936ca7c18981a11`. Folded into the "concurrent
agent shares this tree" principle.

**2. The mutation result the parent asserted was corroborated, not reproduced.** My first
(discarded) run reported "6 failed | 22 passed (28)" while `matching.ts` sat at foreign blob
d508ae7c, and a grep issued in the same block showed lines 55-56 carrying exactly the
0c83c45 document-level fallback (`byKey.get(candidateKey(candidate))?.votes ??
legacyByTmdbId.get(candidate.tmdbId)?.votes`). That matches the parent's claimed 6-of-28,
so acceptance criterion 7 is corroborated — but `git hash-object` doesn't write the object,
so d508ae7c's full bytes were unrecoverable and the marker says "observed, not authored".

**3. Both prior advisory findings are discharged in the code.** (a) The criterion-5 test now
seeds a bare-id legacy doc `{c:'yes'}` alongside `movie_42 {a:'yes'}` and `tv_42
{a:'no',b:'no'}` and asserts movie [2,0] / tv [1,2]. It discriminates: re-keying `byKey` on
bare tmdbId (a BIN-569 revert) makes the last namespaced doc win for both, giving movie
[1,2]; reversing the merge direction breaks the sibling "newest wins" case. (b) The new
tradeoff test's `expect(t.votes).toEqual({ b: 'veto', a: 'yes' })` is exactly
`{...legacy, ...current}` and `toEqual` ignores key order, so not over-fitted; movie42 hits
the `!current -> return legacy` branch, which nothing else covered. (c) The docstring is
accurate on all three states — verified `0c83c45^:matching.ts` used
`new Map(swipes.map(s => [s.tmdbId, s]))` (one bare-id doc served both media types, so
"exakt vad koden gjorde före BIN-569" holds) and that 0c83c45 shipped the `??` document
pick.

**4. New advisory (Low): the false-history correction landed in the code comment but not in
`tasks/todo.md`.** matching.ts:41-45 now says "Notera att detta INTE är oförändrat mot
mellanläget i 0c83c45"; tasks/todo.md:53-59 still says merging into both types "is exactly
what the pre-BIN-569 code did, so this is not a regression" — the un-nuanced version. Same
class as BIN-595 r7 (a false-history fix at the prod call site surviving verbatim in two
sibling test files). Low because the shipping artifact is right and `tasks/` is disposable
scratch, but it extends the existing principle to plan/scratch docs, not just code and
tests: grep the phrase across the whole diff.

Other verification: `npx tsc --noEmit -p tsconfig.json` exit 0; `npx eslint` on the three
source files exit 0; `.votes` consumer sweep unchanged from the first pass (only
TillsammansSessionPageClient.tsx:548 reads it, read-only, so the `return legacy` aliasing of
the SessionSwipe's own map is safe and pre-existing); `.claude/rules/data-model.md`'s swipes
line already documents the per-participant merge and BIN-608. Full `npm test` NOT run —
recorded as uncovered in the marker. Marker REWRITTEN (not appended) at
2026-07-28T23:35:00Z, pinning `git hash-object` working-tree blobs for all five files with
an explicit note that `git rev-parse :<path>` would certify HEAD's pre-fix bytes.

### 2026-07-29 — AuthContext BIN-617: a marker pinned the wrong blob for its own described fix
Re-reviewing `src/contexts/AuthContext.tsx`/`AuthContext.test.tsx` "as they stand in the
working tree" after an automated-fix round. `git status` showed AuthContext.tsx as `MM` —
both a staged hunk and a further unstaged hunk on top. Inspecting each layer (`git diff
--cached` then `git diff`) showed the STAGED hunk added only the BIN-617 explanatory
comment ("reparations-kvoten är per INLOGGNING...") and the UNSTAGED hunk on top added the
actual fix line, `visibilityRetriedFor.current = null;`, in the sign-out branch of
`onAuthStateChanged`. A prior review pass (marker entry timestamped 2026-07-29T18:56:00Z)
had pinned `AuthContext.tsx@d27414d...` — confirmed via `git cat-file -p` on both blobs that
d27414d is `git rev-parse :src/contexts/AuthContext.tsx` (the STAGED index blob, comment
only, missing the fix line) while the working-tree blob (`git hash-object`) is a different
hash, `ca278a7...`, that DOES contain the line. The prior entry's own prose ("Diff vs HEAD is
one line: `visibilityRetriedFor.current = null;`...") accurately described the working-tree
fix, but the hash it pinned doesn't contain that line — a hash/prose self-contradiction,
presumably because the reviewer ran `git rev-parse :<path>` out of habit (correct when
nothing is staged) without checking that THIS file was only partially staged. Re-verified
the actual fix against the correct working-tree blob: logically traced (retry-latch cleared
on sign-out, epoch/in-flight counter untouched matching BIN-587's design) and ran `npx
vitest run src/contexts/AuthContext.tsx.test.tsx` (16/16 passed) — the fix itself is correct,
only the prior marker's pin was wrong. Appended a correction entry (not overwriting) pinning
`ca278a7` with an explanation of the discrepancy. Distilled into the "Review process &
verification discipline" principle as a new sub-case: an `MM` file needs `git hash-object`
even when the task-relevant fix line is the UNSTAGED half of a two-layer change.

Same pass, separately: noticed (not part of the reviewed diff, so filed as a Low
non-blocking finding rather than a defect in the fix) that `visibilityWritesInFlight` is a
single ref not scoped per-uid — a manual `updateDefaultVisibility` for user A still in
flight when a DIFFERENT user B signs in on the same tab before A's write lands makes B's
auto-retry effect bail on `visibilityWritesInFlight.current > 0` without setting
`visibilityRetriedFor.current`, and since none of that effect's own dependencies change
again once the counter drops back to 0, B's pending-flag recovery is silently skipped for
the rest of that page load — the same user-visible symptom class BIN-617 fixed, via a
different vector, gated on an extremely narrow cross-account timing overlap on one tab.

### 2026-07-29 — Full-sprint integrated review (BIN-596/598/601/609/611/614/616/617/618, staged vs c276ced HEAD)

Reviewed the whole staged diff (27 files) covering the BIN-598/601 `WatchlistContext`
mutator-unification (`findCurrent` replacing 8 hand-rolled `items.find`/`itemsRef.current.find`
call sites, `listenerFailedRef` suppressing `addedAt` on a permanently-failed listener,
`shouldStampVisibility` replacing 6 inlined `current?.visibility==null` checks), BIN-598's
`seenWatchedAt`/`hasSeenWatchedAt` extraction (`src/lib/watchedAt.ts`) consumed by all 7
previously hand-copied readers, BIN-611's `planQuickRateWrite` extraction + `QuickRateModal`
wiring, BIN-596's `StatusButton`/`QuickAddButton` snapshot-settled gate (`disabled` + handler
early-return, both belt-and-braces per the digest's 3-shape rule), BIN-617's AuthContext
retry-latch reset on sign-out, BIN-618's `parseTmdbIdFromDocId` canonical-alias rejection +
`matching.test.ts` swipe-doc-id-forgery coverage, BIN-609's `firestore.rules`
`profileAllowsPublic`/`profileAllowsFriends` fail-closed watchlist read gate + 12 new emulator
tests, and BIN-616's orphaned-JSDoc reorder.

Ran the full unit suite (2199/2199 passed), `tsc --noEmit` clean on both client and
`functions/src`, and `npm run test:rules` against an ISOLATED staged blob of `firestore.rules`
(245/245 passed) — isolation was necessary because a concurrent sibling process was
mutation-testing the working tree DURING this review: `firestore.rules` cycled its
`profileAllowsPublic(uid)`/`profileAllowsFriends(uid)` calls to literal `true` (which
reproduced exactly the 6 emulator-test failures a first, non-isolated run hit — the mutation
makes the read succeed on the item's own stale `effectiveVisibility` alone, ignoring the
owner's current profile, which IS the leak BIN-609 exists to close), and
`src/lib/mediaTypeDocId.ts`'s new prefix-rejection block in `parseTmdbIdFromDocId` vanished
and reappeared between reads. Isolated per the canon procedure: hashed the working file,
overwrote with `git show :<path>`, confirmed hash match, ran tests, restored the snapshot
byte-for-byte, confirmed the restored hash matched the pre-touch snapshot. Neither file's
staged content had a real defect — both fully verified correct in isolation.

Two real, non-mutation findings on BIN-609 (`firestore.rules`):
1. **Cost-comment factually wrong.** The new `profileAllowsPublic`/`profileAllowsFriends`
   functions' COST comment claims "+1 document read per non-owner read request — NOT per
   item," citing Firestore's get()-dedup. That dedup is real but scoped to repeated get()
   calls to the SAME path within evaluating a SINGLE document's rule — it does NOT extend
   across sibling documents in a list-query result, which each get their own independent
   rule evaluation. So a friend/public viewer loading an N-item watchlist now costs N extra
   reads, not 1 — silently reintroducing almost exactly the cost that `effectiveVisibility`
   was denormalized onto every item to AVOID in the first place (the file's own untouched,
   still-present comment on this exact clause block: "Sparar en extra doc-read per item (500
   items → 500 färre reads)"). Confirmed by a second, UNTOUCHED comment two clauses below in
   the SAME file, on the identical `get()` pattern, that already says "Kostar en get() per
   doc" — a direct in-file contradiction the new comment should have caught by itself.
   Recommend either rewriting the cost comment to state the real N-per-item cost (and get an
   explicit call on whether that's acceptable pre-launch), or redesigning to avoid the
   per-item get() (e.g. resolve the profile visibility client-side / cache it instead of a
   rules-side get() per item).
2. **Mandated stakeholder sign-off unevidenced.** `tasks/todo.md`'s own sprint plan flags
   BIN-609 as `[Tier C, plan-gated]` requiring the FULL top-tier panel (#4 Security Architect,
   #6 DPO, #27 DBA) and states "Malin's explicit go-ahead is needed before `firebase deploy
   --only firestore:rules` runs" — matching CLAUDE.md's risky-migration exception for
   Firestore-rules changes. The checklist item is still unchecked (`[ ]`) and no panel
   critique or Malin go-ahead is recorded anywhere in `tasks/`, `docs/`, or the
   `claude-reports/binge/` report set searched. The code is nonetheless already fully written
   and staged. Flagged as unverified rather than asserted false (no Linear access in this
   session) — but named as a gap the commit should not silently pass through.

Distilled: folded the get()-dedup-is-per-document lesson into "Firestore rules semantics &
atomic commits", the requiresPlanMode-isn't-self-certifying lesson into the existing
`tasks/*-plan.md` bullet under "Review process & verification discipline", the BIN-618
canonical-alias-parser + deliberate client/server mirror divergence into the existing
mirror-byte-identity bullet under "Firestore doc-ids, indexes & id-scheme migrations", and
the BIN-617 retry-latch-reset-on-sign-out detail into the existing BIN-587 epoch/queue/
in-flight bullet under "Hooks, effects & closure safety" (as its 4th, separate piece). No new
top-level bullets were added — every lesson fit an existing principle, keeping the digest at
its size budget via ~25 compensating trims elsewhere in the file.

### 2026-07-30 — BIN-617/618/596/598/601/611/616 salvage review: a "cheap error" tradeoff whose stated cost was false on both halves

Reviewed the staged salvage of the 2026-07-28 sprint (the one whose own review markers were
flagged as forged), 26 staged files, all blob-pinned pre and post run; `npx tsc --noEmit`
clean, `npx vitest run` 192 files / 2199 tests green, eslint 0 errors (10 pre-existing
warnings). Only `docs/workflow-map.html` was dirty worktree-vs-index, deliberately unstaged.

**1. BIN-601's addedAt tradeoff justification was wrong twice (the headline finding).**
`WatchlistContext.tsx` adds `listenerFailedRef` so a permanently-errored onSnapshot stops
`addItem` from re-stamping `addedAt` on a re-mark. The guard itself is right. Its comment is
not: "the cost flips to 'a new doc may sort nowhere', which the next successful session's
re-mark repairs — unlike a lost date."

- *Sorts nowhere* is false. `src/lib/firebase/utils.ts`'s `toDate(val)` ends in
  `return new Date()`, so `docToItem`'s `addedAt: toDate(data.addedAt)` yields NOW for a
  missing field. The row therefore reads as "added just now" on EVERY load: it pins to the
  top of Bibliotek's "Tillagd" sort and of `VillSePickerPage`'s ordering, shows today's date
  in the "Tillagd" column, and — worst — `src/lib/taste/stats.ts:63`'s
  `within30Days(item.addedAt)` counts it forever in the PUBLIC profile's 30-day "tillagda"
  counter. `backlogResurface` conversely never resurfaces it (it ranks oldest-first).
- *The next re-mark repairs it* is false. Grepped `addedAt` repo-wide: `addItem` is the only
  writer on a watchlist doc, and it writes the key only when `!currentForRating` (i.e. the
  title is ABSENT from `itemsRef`). Once the doc exists, every later session finds it and
  omits the key forever. Nothing backfills it.

Reachability: `addItem` callers NOT gated on `loading` after BIN-596 are `QuickRateModal`,
`OnboardingFlow` and `app/settings/import` (CSV bulk). A CSV re-import during a dead-listener
session lands every row addedAt-less and permanently mis-dated.

Verdict: keep the guard (a destroyed historical date is still worse), fix the comment, and
consider a single `getDoc` for existence in the known-broken branch — one read, only in a
session that is already failing.

**2. `loading` stuck true forever + BIN-596 = a silent dead app.** The new `onError` callback
deliberately does NOT set `loading=false` (correct: every write gate reads that flag, and
publishing an empty library as settled truth is the data-destructive option). But traced the
consumers: `WatchlistPage`/`/my/*`, `VillSePickerPage`, `DiaryPageClient`, `HomePageClient`'s
hero, `RecommendationsHub`, `useSubscriptionAdvisor`, `useGroupHousehold` all sit in a
permanent loading state, and after BIN-596 every `StatusButton`/`QuickAddButton` in the app is
permanently `disabled` with title "Laddar ditt bibliotek…". The only signal is a
`console.warn`. NOT a regression — before this diff there was no error callback at all and
`loading` also stayed true — but the failure mode moved from "corrupts data" to "silently does
nothing", and it still needs a user-visible error state + a resubscribe path (a
`permission-denied` detaches the listener; only an epoch-bump resubscribe recovers it). Also
the warn text ("add-time date stamping suspended") overstates: only `addedAt` is suspended;
`watchedAt` / `tmdbFieldsRefreshedAt` / `providersCheckedAt` were already gated by
`firstSnapshotSettledRef`.

**3. findCurrent (BIN-598) — checked all 7 migrated mutators for a case where the render
closure was the CORRECT value. There is none.** `itemsRef.current` and `items` are written in
the same `onSnapshot` callback, so the state can never be fresher than the ref; the ref is
strictly better in two places: (a) `removeItem` filters it optimistically, so post-delete
`setRuntime` / `refreshTmdbFields` correctly no-op instead of resurrecting a partial doc via
their merge-write; (b) the uid effect clears the ref synchronously, so on an A -> B account
switch the mutators no longer read A's rows. Confirmed no `items.find` remains
(`git show :src/contexts/WatchlistContext.tsx | grep items`) — the only surviving `items`
readers are `itemsWithTags` and the notes-migration effect, both correct as state.
Side effect worth knowing: the mutator callbacks are now memoised on `[uid, findCurrent,
effectiveVisibilityNow]`, i.e. stable across snapshots — `useEpisodeProgressWithSync`'s three
callbacks and the context `value` memo now change identity far less. Strictly fewer re-renders.

**4. BIN-618's client/server divergence is not a server exposure.** Classified every
`functions/**` call site: `weeklyDigest`, `priceDropNotify`, `insights/rollup`,
`streamingOffers`, `shared/followedSeries`, `availableNotify` all go through `resolveTmdbId`,
which prefers the doc's own `tmdbId` FIELD and only falls back to parsing the doc id for
field-less legacy docs — all in owner-scoped collections (`users/{uid}/watchlist`,
`streamingOffers`). The one collection whose doc ids anyone with a link can choose,
`sessions/{id}/swipes/{docId}` (`firestore.rules` line 917), is never read server-side
(grep: only `retentionCleanup`'s recursiveDelete mentions it). So the permissive server copy
is safe today; it still needs the follow-up ticket BIN-618's own acceptance #4 promised.
Verified the fix actually closes the client hole: `movie_042` -> `parseMediaTypeFromDocId`
gives 'movie' but `parseTmdbIdFromDocId` gives NaN, so `indexSwipes` keys it as `movie_NaN`,
which no candidate key can equal; `zmovie_42` -> mediaType null -> legacy map keyed on NaN,
which no real candidate tmdbId matches.

**5. The module HEADER contradicts the new function JSDoc.** `src/lib/mediaTypeDocId.ts`
lines 3-16 still say "Kept byte-identical in behaviour to the server helper so the two can
never disagree", directly above `parseTmdbIdFromDocId`'s new "DELIBERATE DIVERGENCE" block.
New instance of the self-contradicting-comment class: a function-level retraction does not
reach a file-level claim. Fix in the same diff.

**6. Process/acceptance gaps surfaced rather than filed as code findings.**
- BIN-598 acceptance #3 ("addItem and updateStatus agree on whether a re-mark counts as a
  rewatch") is UNMET by design: the diff writes a 17-line comment keeping the disagreement
  (addItem is also the CSV-bulk path, so counting rewatches there would inflate every already
  seen film per re-import) and ends "is Malin's call, not this file's". Sound engineering,
  but an unmet acceptance criterion has to reach her in the report, not only in a comment.
- BIN-596 acceptance #3 asks for the disabled-state visual to be called out for sign-off. The
  shipped choice is `disabled:opacity-50 disabled:cursor-default` + a Swedish title tooltip.
- `.claude/state/workflow-map-stale.json` is still on disk (triggers: firestore.rules,
  AuthContext, WatchlistContext) and `docs/workflow-map.html` is modified but unstaged.
  Correct per the never-bundle-map-edits lesson; BIN-614 (its own commit + delete the flag)
  is still outstanding.

**7. Confirmed-correct, do not re-flag.** BIN-611's `planQuickRateWrite` extraction is a
faithful refactor of BIN-599's branch (traced old vs new: identical on all three paths).
BIN-616 moves `highestWatchedPosition`'s JSDoc back above its own function — the exact orphan
the corpus bullet describes, now fixed. BIN-617's latch reset sits in the signed-out branch
only and touches neither the epoch nor the in-flight counter; a rapid logout->login with a
retry still in flight is safe because the second retry bumps the epoch and the first resolves
'superseded'. BIN-598's `seenWatchedAt` genuinely covers all seven readers — the two remaining
raw `watchedAt` reads are `advisor/serviceValue.ts` (downstream of the filter) and
`MoviePageClient`'s `WatchedDateEditor`, which is already inside a `status === 'sedd'` branch.

**Knowledge folding:** extended the asymmetric-stamp bullet with the prove-it-at-the-reader-
default-AND-the-repair-path rule; extended the permission-denied bullet with the
`loading: true` product cost; extended the "pass current" bullet with the still-ungated
addItem callers; extended the mirror bullet with the module-header rule and the
server-not-exposed classification; extended the plan-is-a-binding-spec bullet with "a
criterion answered by 'Malin's call' is UNMET, not amended". No new bullets; ~15 compensating
trims kept the file under 30k.

### 2026-07-30 — BIN-596/598/601/617/618 re-review: `!user` vs `uid` in a twinned gate, an inline `signIn()` consent gap, and a foreign worktree edit proved by a test NAME

Third pass over the same staged diff (salvage-pass commit for BIN-617/618/596/598/601/611/616/564).
Prior pass PASSED with two comment-only conditions; a `/code-review high` then found real
regressions; this pass reviewed the repaired bytes.

**Context / tree state.** Reviewed the INDEX. Pinned every staged blob with
`git rev-parse :<path>` before and after each run. `docs/workflow-map.html` stayed unstaged
(correct — the lessons digest forbids bundling map edits with feature code).

**Finding 1 (the real one) — `QuickAddButton.tsx:41` `const signedOut = !authLoading && !user;`.**
`StatusButton.tsx:59` uses `uid == null` for the same concept. They are not equivalent:
`AuthContext.tsx:445-449` sets `setUid(firebaseUser.uid); setLoading(false)` synchronously in
the `onAuthStateChanged` callback, then kicks off `ensureUserProfile` whose `.then` sets
`user` a Firestore RTT later — and whose `.catch` (line 468-473, comment: "uid behålls — auth
är giltig även om profil-läsningen failade") leaves `user === null` with `uid` intact
*forever*. Meanwhile `notReady = authLoading || (uid != null && watchlistLoading)` goes false
as soon as the watchlist snapshot lands, and that snapshot is served from Firestore's
IndexedDB `persistentLocalCache` (it fires cached-first), typically well BEFORE the profile
`getDoc` returns from the server. Net effect for a returning signed-in user on any grid page:
the badge renders enabled (and even shows the tracked-title `Check`), and a tap runs
`await signIn()` → a Google popup for someone already signed in. Permanent, not just a race,
whenever the profile read fails. The component's own comment at line 104 says "``signedOut``,
not `!user`" — the comment claims the fix the definition doesn't make. `QuickAddButton.test.tsx`
never sets `uid` and `user` apart, so no test covers the frame.
Fix: `const signedOut = !authLoading && uid == null;` + drop `user` from the destructure;
add a `uid='u1', user=null, loading=false, watchlist.loading=false` case asserting `signIn`
is NOT called and the menu opens.

**Finding 2 — `StatusButton.tsx:130-138` routes a signed-out tap to `signIn()` inline.**
New behaviour on the 25k prerendered title pages. `ensureUserProfile`'s create branch
(`AuthContext.tsx:283-288` and the transaction at 312-318) stamps `termsAcceptedAt`,
`termsVersion` and `ageConfirmedAt` with the comment "first sign-in via Google is browse-wrap
consent — **the login page** shows a terms + 13+-age notice at the Google button". A title
page shows neither, so a first-time Google sign-in from there records a consent + a 13+
confirmation the user never saw. `QuickAddButton` has always done this (pre-existing), which
is why the diff's comment calls it a mirror — but "the sibling does it" is not a defence for
a legal stamp. NOTE: a sibling session's UNSTAGED worktree edit already fixes exactly this by
`router.push('/login/')`; it is not in the reviewed bytes.

**Finding 3 — the two `eslint-disable-next-line` directives in `WatchlistContext.tsx` do nothing.**
Lines 763-765 and 811-813 wrap the reason onto a SECOND comment line, so the directive covers
that comment line, not the dep array. `npx eslint` reports 4 new warnings: 2× "Unused
eslint-disable directive" + 2× the un-suppressed "unnecessary dependency: 'items'". CI runs
`eslint .` with no `--max-warnings`, so it doesn't break the build, but the intent fails.
Fix: put `// eslint-disable-next-line react-hooks/exhaustive-deps` as the LAST comment line.

**Verified correct (task's four questions).**
1. `items` restored to `setRuntime` (765) and `refreshTmdbFields` (813) — and the restoration
   is COMPLETE. Swept every consumer: only `MoviePageClient:86/114` and `TVShowPageClient:97/125`
   key effects on a watchlist callback's identity alone. `updateTmdbStatus` also has an effect
   caller (`TVShowPageClient:170`) but gates on `itemExists`/`cachedTmdbStatus`, both derived
   from `getItem` → `itemsWithTags`, so it re-runs on every snapshot regardless. `getItem`
   still depends on `itemsWithTags`, so `CollectionSection:68` and `settings/import:103` still
   re-fire. All other mutators are handler-only. New test at `WatchlistContext.test.tsx`
   ("get a new identity when a snapshot lands") pins the contract.
2. State combinations for both buttons — see Findings 1/2. `StatusButton`'s matrix is correct
   at every combination including the first committed frame (one commit wide, unclickable).
3. `visibilityRetryAttempts` cap: NOT bypassable. Increment sits immediately after the latch
   set, both synchronous, guard ordered before both. A success clears `visibilitySyncPending`
   in Firestore so the effect early-returns next login and never re-burns quota. The manual
   `updateDefaultVisibility` path is deliberately uncounted. `uidRef` is maintained at both and
   only the two `setUid` sites (445/479). New test drives 5 login cycles and asserts 3 sweeps.
   Low-confidence note: the counter is per-TAB and never reset, so on a shared device user B
   inherits A's exhausted quota (the sibling's unstaged edit makes it per-uid + failure-only).
4. The unreachable `listenerFailedRef.current = false` is gone from the snapshot callback; the
   reset survives only at the effect head (line 210), and the replacement test pins "only a
   re-subscribe clears". Correct — `onSnapshot`'s error callback is terminal.

**Acceptance-list diff.** BIN-601 #1 says "cleared on the next successful snapshot" — that is
now deliberately NOT implemented (impossible). `tasks/todo.md`'s salvage section surfaces
BIN-598 #3 and BIN-596 #3 to Malin but not this one; it should.

**Test-flake diagnosis — the durable bit.** A burst of runs failed 6/8 on the two new component
test files, on FIVE different tests, with DOM output matching the sibling test's expectations —
which looks exactly like cross-file mock bleed. It was not. One failure run printed a test
titled *"routes a signed-out tap to the login page instead of a menu that would lie"*, and the
staged blob says *"…to sign-in instead of…"*. A test name that does not exist in the staged
bytes is proof of a foreign worktree edit; `git status` then showed `MM src/components/title/StatusButton.tsx`,
`AM …StatusButton.test.tsx`, `MM src/contexts/AuthContext.tsx`, and `git hash-object` diverged
from the index for exactly those three. After that, the staged bytes passed 12/12 and 12/12 on
the two-file combo, 6/6 on the eight-file set (the one failure being the foreign edit), and the
full suite 2207/2207 four times. Cheaper than any re-run loop: grep the failing test TITLE.

**Mechanical.** `npx tsc --noEmit` clean. `npx eslint` on all changed files: 0 errors, the 4
warnings above. Repo-wide errors are all in untracked `scripts/recaps/_*.cjs` (pre-existing).
`useServiceValue`'s `items.filter(hasSeenWatchedAt)` is behaviour-preserving —
`watchedForValueFromItems` already does `if (!it.watchedAt) continue`. `stats/page.tsx`'s loop
swap is equivalent (`watched` was exactly `status === 'sedd'`). `matching.test.ts`'s
`swipeFromDocId` genuinely mirrors the read path: `sessions.ts:184-185` uses
`parseTmdbIdFromDocId`/`parseMediaTypeFromDocId` on the doc id only, never field-first
`resolveTmdbId` — so the strict parser really is the whole BIN-618 guard.

### 2026-07-30 — Reviewing a hand-carved REDUCED diff (the 2026-07-30 sprint split)

Malin split one sprint diff in half after review round 3 showed rounds 1–2's own repairs
kept introducing defects, all concentrated in four tickets touching watchlist + auth
readiness timing. Shipped: BIN-618 / BIN-611 / BIN-616 / BIN-564. Parked to
`.claude/state/sprint-patches/parked-2026-07-30-FULL-salvage.patch`: BIN-596 / BIN-598 /
BIN-601 / BIN-617, files restored to HEAD.

**How I verified the carve for split damage (this is the reusable procedure):**

1. `git diff --cached HEAD -- <every parked file>` → EMPTY proves the four tickets'
   files are byte-identical to HEAD (AuthContext.tsx, WatchlistContext.tsx,
   StatusButton.tsx, QuickAddButton.tsx all clean).
2. `git diff --stat` (worktree-vs-index) → only `docs/workflow-map.html`, which is
   BIN-614 and deliberately left unstaged for its own commit per the lessons digest.
   No reviewed file had an unstaged delta.
3. Repo-wide grep for the removed half's symbols: `@/lib/watchedAt`, `seenWatchedAt`,
   `hasSeenWatchedAt`, `listenerFailedRef`, `findCurrent`, `signedOut`/`notReady`.
   Zero hits in `src/` (`src/lib/watchedAt.ts` does not exist — it was BIN-598's new
   file). `visibilityRetriedFor` and `watchedForValueFromItems` DO hit, but both are
   pre-existing at HEAD, not artefacts of the split.
4. `src/lib/watchlistWrites.ts` was the one file carrying hunks from BOTH halves.
   `git diff --cached` on it shows exactly ONE hunk (+29 lines, `planQuickRateWrite`),
   and `git show :src/lib/watchlistWrites.ts | grep watchedAt` shows only HEAD's own
   text — so BIN-598's comment rewrite (which pointed at the now-nonexistent
   `@/lib/watchedAt`) was correctly reverted. HEAD's forward-looking "BIN-598 tracks
   giving the rule one shared home" comments are accurate again now that BIN-598 is
   parked.
5. `QuickRateModal.tsx` without BIN-596's readiness gating: `planQuickRateWrite(existing)`
   returns `'add-as-seen'` exactly when `getItem` returns null, so the branch condition
   is byte-equivalent to HEAD's `if (existing) … else`. `getItem` returns
   `WatchlistItem | null` (not `undefined`), so dropping `existing ?? null` is
   type-safe and the reworded comment ("`current` is null at RUNTIME by construction",
   no longer claiming TS narrowing) is honest — the old comment claimed a TS narrowing
   that the plan-string refactor genuinely removed, and it was corrected in the same
   diff. The pre-existing ungated-`addItem` residual (a pre-snapshot `getItem` miss
   routing a TRACKED title down the add branch, rewriting `addedAt` and `providers: []`)
   is unchanged HEAD behaviour and belongs to parked BIN-596 — out of scope, said so
   rather than filed.
6. `.claude/state/workflow-map-stale.json`'s triggers are `firestore.rules`,
   `AuthContext.tsx`, `WatchlistContext.tsx` — none of which this commit touches, so the
   reduced commit creates no map obligation. The unstaged map edit describes HEAD
   behaviour (BIN-587's epoch/queue shipped in 0c83c45), not the parked work, so it is
   safe to land as its own commit.

### 2026-07-30 — BIN-618: the divergence note fixed the module header but not the sibling test's

`src/lib/mediaTypeDocId.ts`'s file header was correctly retracted ("The READ side is NOT
identical any more…"), and `parseTmdbIdFromDocId` carries a DELIBERATE DIVERGENCE note.
But two mirror-parity claims survived verbatim:

- `src/lib/mediaTypeDocId.test.ts:10-13` — "Contract MUST match
  `functions/src/shared/mediaTypeDocId.ts` **exactly** … If you change one, change the
  other." That file is untouched by the diff, yet its `parseTmdbIdFromDocId` describe
  block now pins a contract the server deliberately does NOT share. It is also the first
  place a future dev checks the mirror rule, so leaving it makes the next reviewer
  "resync" the pair — the exact thing the new note forbids.
- `src/lib/mediaTypeDocId.ts`'s `resolveTmdbId` JSDoc still ends "Mirror of the paired
  mediaTypeDocId module — keep the two in sync." `resolveTmdbId`'s own body IS identical
  to the server's, but it delegates to the parser, so it diverges transitively:
  `resolveTmdbId(null, 'movie_042')` is NaN on the client, 42 on the server.

Generalised: a divergence note must be pushed to every surface that ASSERTS parity —
module header, per-function "keep in sync" lines, and the sibling TEST file's contract
header — including files the diff does not otherwise touch. Same class as BIN-595 r7 and
BIN-608 ("a false-history fix in one file does NOT propagate").

Not a behaviour risk: every legitimate doc id is written by `mediaTypeDocId` from a
numeric tmdbId, so it is canonical; no real doc is dropped by the stricter parser. The
alias tests are load-bearing — under HEAD's `/^[0-9]+$/`, `zmovie_42` would have parsed
to 42 with `mediaType: null` and OVERWRITTEN the genuine legacy bare-id entry in
`legacyByTmdbId`, and `movie_042` would have overwritten `byKey['movie_42']`.

### 2026-07-30 — Orphaned JSDoc, third variant: the block landed on an `export type`

`src/lib/watchlistWrites.ts` — BIN-611's 20-line JSDoc ("should this quick rating ALSO
write the title's status?", the three outcomes, the rewatchCount rationale) sits directly
above `export type QuickRateWrite`, with `planQuickRateWrite` itself carrying no doc at
all. Defensible in that the block enumerates the union members, but hover on the function
shows nothing, and this is the same defect class as BIN-616 — which ships in this very
commit and whose entire content is moving a JSDoc back onto the function it describes.
Low severity, flagged for the irony as much as the cost. Variant to remember: an orphan
does not need a neighbouring FUNCTION to land on; a type alias, a const, or an interface
between the doc and the function is enough.

### 2026-07-30 — A committed `tasks/todo.md` can carry a superseded plan section

The staged `tasks/todo.md` holds three stacked sections written the same day: the sprint
selection, a "SALVAGE PASS" whose "SHIP (staged, reviewed)" list still names all EIGHT
tickets and whose unchecked remaining-work items still direct a reader to edit
`src/contexts/WatchlistContext.tsx`, and finally the "SPLIT DECISION" that supersedes
both. Nothing is wrong in the code, but a resumed session reading top-down would
re-apply parked work. Per `code-style.md`, `tasks/` is disposable scratch — either trim
the superseded section or stamp SUPERSEDED at its head before committing. Folds into the
existing "PROSE still asserting the reverted behaviour" half of the revert-verification
principle.

### 2026-07-30 — isolated-worktree review when a sibling agent is mutation-testing the tree

Re-review of the REDUCED staged diff (BIN-618/611/616/564, four other tickets parked).
First test run of the five reviewed test files reported 3 FAILURES in the brand-new
`QuickRateModal.test.tsx`; the same file alone then passed 4/4. `git status --porcelain`
showed `MM` on `src/components/recommendations/QuickRateModal.tsx` and the worktree blob
moved twice in ~90s (`e15f1be` → `fcf6c88`), with `git diff` showing `skip()`'s body
replaced by `void id;` — a concurrent agent mutation-testing the exact file under review.

The existing `[hash → run → re-hash]` loop cannot converge against continuous churn, so I
built an isolated checkout of the INDEX and did all verification there:

    TREE=$(git write-tree)
    COMMIT=$(git commit-tree $TREE -p HEAD -m review-snapshot)
    git worktree add --detach <scratch>/rev $COMMIT
    cd <scratch>/rev && cmd //c "mklink /J node_modules C:\binge\node_modules"

Gotchas: `mklink /J` rejects an absolute first argument under Git Bash (run it from inside
the worktree with a relative link name); the junction must be removed with `cmd rmdir`
(`rm -rf` follows it and deletes the real `node_modules`); finish with
`git worktree remove --force` + `git worktree prune`. Every file's `git hash-object` was
verified equal to its `git rev-parse :<path>` sha before running anything.

Results on those pinned bytes: full suite 190 files / 2186 tests green (matching the
task's claim), eslint 1 pre-existing `no-img-element` warning, 0 errors.

Mutations run in the isolated worktree:
1. `QuickRateModal.tsx`: `if (plan === 'rating-and-status')` → `if (plan !== 'add-as-seen')`
   → fails exactly `QuickRateModal.test.tsx > rates an already-seen film WITHOUT touching
   its status`, while `watchlistWrites.test.ts` stays 35/35 green. This is the precise
   acceptance gap the new file was written to close, and it closes it.
2. `mediaTypeDocId.ts`: `/^(?:0|[1-9][0-9]*)$/` → `/^[0-9]+$/` → 5 failures, ALL in
   `matching.test.ts`. `mediaTypeDocId.test.ts` (comment-only in this diff) does not cover
   the alias rule at all; the coverage lives entirely in the Tillsammans sibling.
3. `mediaTypeDocId.ts`: unknown-prefix reject removed → 2 failures in `matching.test.ts`.
4. `watchlistWrites.ts`: `sedd → 'rating-only'` collapsed into `'rating-and-status'` →
   fails cases 2 AND 4 together. So the replacement 4th case is NON-VACUOUS (it can fail)
   but strictly IMPLIED by cases 1–3, which pin each of the same three inputs to an exact
   output. It never fails alone; its `every(v => [...].includes(v))` half is guaranteed by
   the TS union return type. Honest grade: better than the tautology it replaced, zero
   added mutation-detection power. Reported LOW, non-blocking.
5. `useStreamingOffers.ts`: `mediaType` dropped from `['streaming-offers', mediaType,
   tmdbId]` → fails exactly the new shared-QueryClient case. That case was the test
   reviewer's own LOW from the prior round and it has been applied.

Is `QuickRateModal.test.tsx` hollow? No. It mocks exactly two boundary modules
(`@/hooks/useWatchlist`, `@/lib/tmdb/client`) and renders the real component with the real
`planQuickRateWrite`, `buildItemFromTmdb` and `buildWatchlistAddPayload`; all four cases
assert on the WRITE calls (`expect(updateStatus).not.toHaveBeenCalled()`), never on the
verdict. Weakest case is "does not clear a stored rating when a card is skipped" — `skip()`
never calls `markRated`, so it only guards a future rewiring of the skip button. Fine.

JSDoc accuracy (`resolveTmdbId`), checked claim by claim against code + the server mirror:
`Number('042') === 42` so a `movie_042` doc WITH `tmdbId: '042'` resolves to 42 — true;
without the field it is NaN on the client and 42 on the server (`/^[0-9]+$/`) — true. One
imprecision: "the field branch rejects the same EMPTY/junk cases the doc-id branch does" is
not exactly so, because `CANONICAL_TMDB_ID` MATCHES `'0'` (it is the faithful inverse of
`mediaTypeDocId('movie', 0)`) while the field branch rejects 0 via `fromField > 0`. So
`resolveTmdbId(null, 'movie_0')` is 0 and `resolveTmdbId(0, 'movie_7')` is 7. Pre-existing
in both copies, unreachable in practice (no TMDB id is 0, and every `mediaTypeDocId(...)`
caller passes `tmdbId: number`), but the sentence claims a symmetry inside the very
paragraph written to stop the two branches being read as equivalent. Reported LOW.

Over-rejection check for BIN-618 (the risk a canonical-strict parser DROPS legitimate
docs): all four parser call sites are `useGroupMemberProgress`, `diary.ts`, `groups.ts`
(all field-first `resolveTmdbId`) and `sessions.ts`'s `swipeDocToObject` (bare parser).
Every writer reaching those collections passes a numeric `tmdbId` (`recordSwipe` types it
`tmdbId: number`), and legacy bare ids are numeric too. Risk nil.

Sibling markers were STALE for these bytes and I said so:
- `.claude/state/test-done.marker` pins `useStreamingOffers.test.ts@5f10344` (now
  `11f7a8a`), `mediaTypeDocId.ts@fdc38bd` (now `e53cf8b`), `watchlistWrites.test.ts@2f43233`
  (now `9408ad2`), never lists `QuickRateModal.test.tsx` at all, and reports a 189/2181
  suite against today's 190/2186.
- `.claude/state/security-done.marker` pins `src/lib/watchedAt.ts` — a parked-work file that
  no longer exists in the tree — and `watchlistWrites.ts@306104a` (pre-split). It covered
  the eight-ticket diff, not this one.
Neither changes my own verdict; both are gate facts the parent needs.

`tasks/todo.md`: the SALVAGE PASS section carries a SUPERSEDED banner (good — that was the
prior round's finding), but the Phase-1 sprint-selection list at the TOP still shows
BIN-617/596/598/601/609/585/614 as unchecked build items with no banner. The SPLIT DECISION
at the end of the file is the last word so nothing lies outright; advisory only, and
`tasks/` is disposable scratch per `code-style.md`.

Also: `docs/workflow-map.html` is modified but UNSTAGED (BIN-614), which is correct per the
lessons digest — map edits ship in their own commit. Do not `git commit -a`.

Verdict: PASS. Findings all LOW/advisory; nothing blocking.

### 2026-07-30 — BIN-641 + BIN-645 review: two orphaned/falsified comments, a consume-on-read effect, and a plan's commit-split ignored

Staged diff (10 src files + tasks/todo.md) reviewed against the INDEX blobs, because a
concurrent session was MUTATION-TESTING `src/contexts/WatchlistContext.tsx` in the shared
worktree while I read it: my first `git diff` was empty, then a `grep` returned line 451
WITHOUT the `+ 1` on `rewatchCount`, and moments later `git diff` showed a different
mutation (`...(opts ?? {})` spread into the setDoc payload). `git status` went `M ` → `MM`
on that one file only. Lesson reinforced: re-verify any file you Read early against
`git show :<path>` before quoting a line number from it; dump all staged blobs to the
scratchpad and read THOSE.

Findings:

1. **`src/lib/watchlistWrites.ts` — JSDoc orphaned the other way round.** The BIN-611 doc
   block for `planQuickRateWrite` (ending "This helper is that answer for the quick-rate
   caller") ends at line 168; the new `isRewatchWrite` + its own BIN-641 doc were inserted
   at 169-187, directly between that block and `planQuickRateWrite` (now line 189, with no
   doc at all). Two contiguous leading JSDoc blocks both attach to `isRewatchWrite`, so
   hovering it shows quick-rate prose that is false for it. Same class as BIN-616 but the
   mirror image: BIN-616 was a new DOC above an existing function, this is a new
   FUNCTION+doc below an existing doc. Fix: move the new pair above line 149.

2. **`src/contexts/WatchlistContext.tsx:475-477` — the comment asserting the absent
   feature sits 25 lines under the feature.** The BIN-593 asymmetry list still reads
   "addItem has never written `rewatchCount` at all, so a re-mark here is not counted as a
   rewatch the way updateStatus counts one. Both asymmetries are pre-existing and
   untouched by BIN-593 — see BIN-598." The BIN-641 block at 436-452 is exactly that
   counter. Grep found no other copy of the claim.

3. **`src/app/login/page.tsx:41-43` — a consume-on-read inside an effect.** `takeNextPath()`
   reads AND removes. Next 16 defaults `reactStrictMode` on (no override in
   `next.config.mjs`), so a mount where `user` is already non-null (a signed-in visitor
   landing on `/login/`) double-invokes: run 1 consumes and pushes the remembered path, run
   2 gets null and pushes `/`, and the later push wins. Dev-only today, but the same shape
   fires in prod on any second `setUser` identity while still mounted. Fix: a
   `redirectedRef` latch (refs survive the StrictMode remount).

4. **`src/components/title/QuickAddButton.tsx:104` — `usePathname()` has no query string.**
   `TitleCard` (hence QuickAddButton) renders on `/search/`, whose entire state is `?q=`
   (`app/search/page.tsx` uses `useSearchParams`). A signed-out tap there remembers
   `/search/` and returns the visitor to an empty search. `nextPath.test.ts` asserts
   `safeNextPath('/sok?q=blade%20runner')` round-trips and comments that otherwise
   "signing in from a filtered library view silently dumps the user on the home page" — a
   property no producer can currently supply. Fix: `window.location.pathname +
   window.location.search` in the handler (client-only, so no Suspense cost under
   `output: 'export'`). Confirmed via `DynamicRouter.tsx` that `usePathname()` DOES return
   the real path under the `**` → index.html rewrite, so the pathname half is sound.

5. **Stale remembered path outlives an abandoned sign-in.** Nothing clears
   `binge:nextAfterLogin` if the visitor never signs in. `AuthGuard` pushes `/login`
   without remembering anything, so: tap + on a poster → browse away → later click a
   protected page → AuthGuard sends you to /login → sign in → land on the OLD title
   instead of the page you asked for. `takeNextPath`'s doc claims single-use consumption
   prevents exactly this. Suggest a TTL stamp or clearing on login-page unmount, and
   having AuthGuard call `rememberNextPath` so the value always matches current intent.

6. **The plan's commit split was ignored.** `tasks/todo.md`'s new section ends: "two
   separate commits (watchlist rewatch counting; auth consent routing) since a revert of
   one must not drag the other." Both are staged together; the file sets are disjoint, so
   the split is free.

7. LOW: `if (authLoading) return` in the badge handler is a NEW enabled-but-dead click
   (BIN-596's class), and no test covers the login page's `takeNextPath()` consumption —
   the acceptance criterion "after sign-in the visitor returns to where they came from" is
   discharged only by the helper unit + the write side. The new tests also pin `/film/…`,
   a path this app never produces (`titleHref` → `/movie/:id/`).

Checked and CLEAN: `isRewatchWrite`'s extraction is behaviour-identical to
buildStatusUpdate's inline `status === 'sedd' && ctx.currentStatus === 'sedd'` (only the
param type widened to accept null/undefined); `currentForRating` reads the live `itemsRef`
so a cold load counts nothing; no single user action yields two counted rewatches — every
`addItem` call site was enumerated and only `useMarkSeen` passes the flag, `QuickRateModal`
writes `updateStatus(...,'sedd')` only on the non-'sedd' branch, `VillSePickerPage`'s local
`markSeen` goes through `updateStatus` from `vill_se`; `rewatchCount` is already in
`isValidWatchlistItem`'s hasOnly so no rules change is needed; `safeNextPath` rejects
scheme, `//`, `/\`, bare-relative, empty and control chars, and validates on read as well
as write.

Verdict: PASS WITH FINDINGS — 2 comment defects (HIGH), 3 correctness/robustness MEDIUMs,
1 process MEDIUM, 2 LOW. No data-loss or security defect found.

### 2026-07-30 — a JSDoc-orphan FIX that leaves a blank line: LOW, not HIGH

Round 3 of BIN-641/645. My round-2 HIGH #1 was the orphaned `planQuickRateWrite` JSDoc in
`src/lib/watchlistWrites.ts` — `isRewatchWrite` + its new BIN-641 block had been inserted
BETWEEN that doc and its function. The fix moved `isRewatchWrite` above the `QuickRateWrite`
type declaration, correctly. But it left a stray blank line at line 189, between
`planQuickRateWrite`'s `*/` and its `export function` on line 190 (visible in the diff as a
lone `+` empty line, the only remaining hunk in that region).

I nearly re-filed it at the old severity. Instead I checked the actual behaviour with the
compiler API in the repo's own `node_modules`:

    ts.getJSDocCommentsAndTags(statement)  // on `/** Doc A */\n\nexport function withBlank(){}`
    -> withBlank => "Doc A"   noBlank => "Doc B"

TypeScript attaches a leading JSDoc block across ONE blank line, so hover, quickinfo and
`@deprecated`-style tooling all still see it. The defect the original HIGH described —
"`planQuickRateWrite` is left with no doc at all, and its prose attaches to the wrong
function" — is gone. What remains is a house-style artifact, worth one line of cleanup, not
a re-block. Grading it HIGH twice would have taught the sprint that the fix didn't work.

Generalisation folded into the principles bullet: when re-reviewing a comment/JSDoc fix,
re-derive what the tooling actually does before re-grading; "the fix is imperfect" and "the
fix didn't land" are different verdicts and only the second holds a commit.

Other round-3 facts worth keeping:
- The two sibling markers (security 20:44Z, test 21:08Z) both pinned the PRE-fix blobs for
  6 of 12 files and neither knew `src/app/login/page.test.tsx` (added after both). The test
  marker was honest about it — it listed the six worktree-only shas and said "if those bytes
  get staged this marker correctly goes stale, re-review is then required". They are now
  staged. Reading the sibling markers' sha lists, not their timestamps, is what surfaced it.
- `window.location.pathname + window.location.search` read inside an onClick on this
  static-export SPA: no staleness (App Router client nav goes through `history.pushState`,
  which updates `location` synchronously) and no hydration risk (never read during render).
  The QuickAddButton test proves the handler-read by calling `history.replaceState` AFTER
  render and before the click.
- The plan's "two separate commits" line is still unmet — but the file sets are genuinely
  disjoint (BIN-641: WatchlistContext ×2, useMarkSeen ×2, watchlistWrites; BIN-645: login
  page ×2, QuickAddButton ×2, nextPath ×2), with `tasks/todo.md` the only shared file, so
  the split remains mechanical.

Verdict: PASS. 1 LOW (the blank line), 1 LOW carried forward (the enabled dead click behind
`if (authLoading) return`), 1 process MEDIUM (the commit split). No correctness defect.

### 2026-07-31 — a SPLIT staged set: prove the surviving half commits alone, and say where the deferred half's bytes went

Round 4 on BIN-641, after the diff was cut in half. The parent staged only the BIN-641 six
(`WatchlistContext.tsx`/`.test.tsx`, `useMarkSeen.ts`/`.test.tsx`, `watchlistWrites.ts`,
`tasks/todo.md`) and left the BIN-645 six in the worktree, acting on my own round-3 process
MEDIUM that `tasks/todo.md:445` binds this to two commits.

**What the split changed about the review, concretely.**

1. *The one requested delta was verifiable to the byte.* My round-3 marker pinned
   `src/lib/watchlistWrites.ts@8f5ef4265312a14a707043475afdc38979ff0291`; the index now holds
   `@088add939c27381a6102d95e2167304fcfb991ec`. `git cat-file -p` on both + `diff -u` showed
   exactly one deleted blank line at 189, between `planQuickRateWrite`'s closing comment-end
   and its `export function`. Independently, `git diff --cached -U0` on the file has only TWO
   hunks — the 20-line `isRewatchWrite` insert at 147 and the one-line substitution at 232 —
   so the whole `planQuickRateWrite` region is now byte-identical to HEAD. That is the
   cleanest possible resolution of a JSDoc-orphaning fix: the region it perturbed is back to
   zero diff. Comparing the two blob shas is a better proof than re-reading the file, and it
   is cheap.

2. *"Disjoint file sets" is NOT the same as "it builds alone."* The deferred half adds a NEW
   MODULE, `src/lib/nextPath.ts`, which does not exist at HEAD. Grepping the removed half's
   symbols (my usual reduced-diff drill) cannot tell you whether the surviving half imports
   it. So I built the index tree and tested there:
   `git write-tree` then `git commit-tree $TREE -p HEAD -m snap` then
   `git worktree add --detach`, then from inside it
   `cmd //c "mklink /J node_modules C:\binge\node_modules"`.
   Verified the isolated tree WAS the prospective commit: the six staged blobs at their
   staged shas, `QuickAddButton.tsx`/`login/page.tsx` back at HEAD's bytes (76b8cb01 /
   d148d9fc), `src/lib/nextPath.ts` absent. Then: `npx tsc --noEmit` gave 0; `npx vitest run`
   gave 191 files / 2195 tests green; `npx eslint` on the five source files gave 0 errors and
   4 pre-existing warnings in the test file's mock block (lines 27/56/61/62, far above the
   diff). 191+3=194 and 2195+34=2229 exactly reconciles with the parent's whole-worktree
   figures, which is itself a check that nothing was double-counted. Removal gotcha: `cd`ing
   out first matters — `git worktree remove --force` from INSIDE the tree fails "Permission
   denied"; `cmd //c rmdir node_modules` then `git worktree prune` from the repo root worked,
   and `ls node_modules | wc -l` = 446 confirmed the real one survived.

3. *The sibling markers now over-cover, and the deferred half has drifted past all three.*
   `security-done.marker` (00:15Z) and `test-done.marker` (00:26Z) both pin all twelve
   original blobs, including `watchlistWrites.ts@088add9` — so the BIN-641 six are covered at
   exactly the bytes I reviewed. Harmless over-coverage. The real fact is the other
   direction: of the six BIN-645 worktree files, FOUR have moved past every marker —
   `QuickAddButton.test.tsx` now 2a60cac1 (mine f2dd25d8, siblings a89d3d0e),
   `login/page.test.tsx` now 731a23bc (all three pinned 5f7f097c), `nextPath.ts` now f0fc48d1
   (all pinned 3b69b15d), `nextPath.test.ts` now fd3c1cc1 (all pinned 294e4167) — and
   `QuickAddButton.tsx` at d3994d6d matches the siblings but NOT my round-3 pin 288969f8.
   A concurrent session is still editing that half. Stated in the marker so nobody reads
   "three fresh markers exist" as covering commit 2.

**BIN-641 re-checked end to end in its own right (not just the delta).** Mutation-tested on
the real files, backing up to scratchpad and restoring byte-for-byte (all six re-hashed
pre==post==staged afterwards):
  - dropping `opts?.countsAsViewing &&` from the addItem condition gave RED on TWO tests
    ("counts NOTHING for the same write from a bulk restore" plus the key-set test).
  - leaking the flag into the document (`...itemFields, ...(opts ?? {})`) gave RED on
    "never writes the intent flag itself to Firestore" and ONLY that one. #14's binding
    acceptance criterion is genuinely enforced, independently — not implied.
  - deleting the `{ countsAsViewing: true }` argument from `useMarkSeen`'s film branch gave
    RED on "tells addItem a film mark IS a viewing" and only that. The new hook test is the
    sole guard for the wiring, which is exactly what its own header claims.
Also confirmed: `rewatchCount` is already in `isValidWatchlistItem`'s `hasOnly` allowlist
(firestore.rules:95) so no rules work is owed; both increment expressions are
`(current ?? 0) + 1` so the two write paths cannot drift; `StatusButton` renders every status
option including the current one, so sedd to sedd from a film page is REACHABLE (this is not
a guard on an unreachable state); cold load counts nothing, failing toward under-count, which
is the right polarity for a counter that is editable nowhere; and no single user action can
double-count (only `useMarkSeen` passes the flag, `QuickRateModal`'s add-as-seen branch calls
`addItem` flagless on a title that is by definition absent).

**Prose sweep for falsified history.** Grepped `rewatch|omtitt` across `src/ docs/ tasks/
functions/ firestore.rules`. The never-list at `WatchlistContext.tsx:472-477` was correctly
rewritten in the same diff. Every other site survives unfalsified and I re-read each:
`QuickRateModal.tsx:85-86` ("writing the status again would be counted as a rewatch that
never happened" — still true, that branch writes no status), `WatchlistContext.tsx:574`
(BIN-154's updateWatchedAt warning — still true), `planQuickRateWrite`'s JSDoc (names
`updateStatus` specifically, never claims addItem is safe by never counting).

**Two LOWs filed, both about a claim rather than the code.**
  - `useMarkSeen.test.tsx:12-13` says "What is pinned HERE is the wiring: that this hook
    states the intent, and that it is the only one of the shared paths that does." The second
    clause is TRUE but not pinned — nothing fails if a future CSV-importer or onboarding call
    site starts passing `countsAsViewing: true`. The plan's condition 2 asked for a test
    pinning which call sites pass true; the FORGET direction is pinned (mutation 3), the
    ADD direction is not.
  - `WatchlistContext.test.tsx:595-599` "counts nothing for a series — only film has a
    terminal sedd" writes `newTitle(7)`, whose status is `'mina'`, over a seeded `'mina'`. It
    exercises the STATUS rule, not the media-type reasoning; I could not construct a mutation
    for which it fails alone. Grade: implied. The rule itself IS independently covered by
    `watchlistWrites.test.ts:135` (`buildStatusUpdate('mina', {currentStatus:'sedd'})`), so
    the coverage exists — the NAME overclaims.

Also worth recording as a positive: BIN-641's acceptance criterion is phrased about the
CALLER ("marking a film seen from the film page increments rewatchCount"), which normally
trips my "a helper's unit test does not discharge a caller-phrased criterion" rule. Here it
DOES discharge: the chain is StatusButton/QuickAddButton to useMarkSeen to addItem, and both
links the diff CHANGED are independently pinned (hook passes the flag; context acts on it).
An unchanged link at a green HEAD does not need re-pinning. Two pinned links compose.

Verdict: PASS, no blocking findings. 2 LOW (both comment/test-name claims), 0 MEDIUM — the
round-3 process MEDIUM about the commit split is CLOSED by this staging and by the isolated
build proving the half stands alone.

### 2026-07-31 — BIN-641 round 5: an intent flag OR'd into a stamp guard disables the guard's other half
`WatchlistContext.addItem` grew `opts?.countsAsViewing` (a human deliberately logged a re-viewing,
passed only by StatusButton's new "Sedd igen"). Two writes keyed on it:

    ...(opts?.countsAsViewing ? rewatchFields(item.status, currentForRating?.status, ...) : {}),
    ...(item.status === 'sedd'
      && (opts?.countsAsViewing
        || canAutoStampWatchedAt(resolveCurrentWatchedAt(currentForRating, firstSnapshotSettledRef.current)))
      ? { watchedAt: serverTimestamp() } : {}),

The COUNT goes through `rewatchFields`, which needs `currentStatus === 'sedd'`, so an unsettled
snapshot (currentForRating undefined) counts nothing — correct, and what the block comment claims
("an unsettled snapshot counts nothing rather than guessing"). The DATE does not: the flag
short-circuits the whole BIN-593 tri-state, so a cold load with intent stamps `watchedAt` over
whatever is stored. Proved rather than argued — added
`expect('watchedAt' in lastPayload(...)).toBe(false)` to the existing "counts nothing during a cold
load" test: AssertionError, expected true to be false. Restored the file byte-for-byte from a
scratchpad copy (sha back to 013232b), never `git checkout --`.

Unreachable today: the menu entry renders only on `current?.status === 'sedd' && mediaType ===
'movie'`, and `current` comes from `getItem`, so a landed snapshot is a precondition. Filed MEDIUM
anyway because the loose branch is the one that overwrites user-authored data, and BIN-593's whole
premise is that a stomped date is unrecoverable while a missing one is user-fixable. Fix: derive
the re-date from the rewatch OUTCOME (`'rewatchCount' in rewatch`), not the raw flag.

### 2026-07-31 — BIN-641: the premise correction did not propagate to the prose the old premise wrote
The commit's own `tasks/todo.md` records the verified finding that nothing in production can write
`'sedd'` over `'sedd'` — `WatchlistPage`'s bulk actions write only `vill_se`/`avbruten` (lines
538/553), `VillSePickerPage` is filtered to `vill_se`, `QuickRateModal` is gated by
`planQuickRateWrite`, and Bibliotek's rows carry no status menu (grep: `StatusButton` appears only
in `MoviePageClient`/`TVShowPageClient`). The SAME commit ships, at WatchlistContext.tsx:485-489:
"BIN-641 gave addItem the same counting rule …, so marking a film seen from its page counts the
same as from Bibliotek's status menu." Both halves false — that menu does not exist, and marking a
film seen from its page counts nothing unless the user picks "Sedd igen". Third false comment in
three rounds on this ticket; the pattern is that a rewritten never-list inherits the sentence
structure of the claim it replaced. Also stale in the same family: WatchlistContext.tsx:595 still
cites `isRewatch` (now a local inside `rewatchFields`; the diff updated the other two references),
and watchlistWrites.ts:238-241 still says "WatchedDateEditor is the way to re-date a re-viewing".

### 2026-07-31 — BIN-641: a key-set equality assertion passed only because of its fixture
`it('never writes the intent flag itself to Firestore')` compares
`withIntent.filter(k => k !== 'rewatchCount').sort()` against the no-intent key set — #14 Software
Architect's binding acceptance criterion, "equals the false key set plus at most rewatchCount". It
is green only because the fixture `seenFilm(2)` seeds no `watchedAt`, so `canAutoStampWatchedAt`
puts the key in BOTH payloads. The two sibling tests directly above prove the general claim false:
with a stored date, intent writes `watchedAt: 'ts'` (re-dates test) where no-intent omits the key.
So the comment "the ONLY difference the flag may make to the document is the counter" is false, and
the plan's acceptance line was silently outgrown by Malin's later re-dating decision rather than
amended. The direct `expect(withIntent).not.toContain('countsAsViewing')` DOES discharge #14's
actual intent — the set-diff was the part that rotted. Separately, the "#14 …prove the flag never
reaches the document" comment block sits above `it('re-dates the film to now')`, which does
neither: it documents the test 20 lines below (JSDoc-orphaning, comment-stacking variant).

### 2026-07-31 — BIN-641: every staged blob had moved past both sibling markers
security-done (00:15Z) and test-done (00:26Z) pin `WatchlistContext.tsx@d5f2f69`,
`.test.tsx@7731f5c`, `useMarkSeen.ts@56330ea`, `.test.tsx@81bc669`, `watchlistWrites.ts@088add9`,
`todo.md@1779533`. The index now holds f52d1a0 / 013232b / ca9368c / 445360d / 1879e6d / dcd8695 —
six for six moved — and neither marker names `StatusButton.tsx`, `StatusButton.test.tsx` or
`watchlistWrites.test.ts`, which the rebuild added. So the new UI surface AND the destructive
re-date write were covered by no security or test verdict at the reviewed bytes. Reporting that is
a gate fact the parent needs even when the code-review verdict itself is favourable; the sha-diff
against sibling markers is what surfaces it, freshness never would (both markers were hours old and
looked current).

### 2026-07-31 — BIN-641 round 5: the half-fixed re-date guard, one new false comment, and a phantom test failure from a sibling's live mutation

Re-review of the same staged diff after round 4's findings were applied. Three lessons, all
distilled upward.

**1. `(intent && current)` is a HALF fix, and the alternative guard was a non-question.**
Round 4 flagged `opts?.countsAsViewing || canAutoStampWatchedAt(resolveCurrentWatchedAt(...))`
— intent alone short-circuited BIN-593's tri-state, so a cold load counted nothing (right) and
stamped a date anyway (wrong). The applied fix was `((opts?.countsAsViewing && currentForRating)
|| canAutoStampWatchedAt(...))`. The parent asked whether `currentForRating` or
`firstSnapshotSettledRef.current` was the correct guard, "since they differ for a genuinely-new
title during a settled snapshot".

They do not differ in OUTCOME. Case analysis, then proved by mutation on an index worktree:
settled + absent → `resolveCurrentWatchedAt(undefined, true)` returns `null`, so
`canAutoStampWatchedAt` is true and the SECOND OR term already stamps; cold load → both terms
false; title present → both true (and `currentForRating` truthy implies settled, since
`itemsRef` is only ever written by `onSnapshot`). Swapping in `firstSnapshotSettledRef.current`
left all 54 WatchlistContext tests green. So the choice is a style call, and `currentForRating`
is the better one only because it is the same source the counter reads.

What IS still open is that the guard keys on the RAW FLAG plus presence, not on the DERIVED
outcome. Probe added to the isolated worktree:

    await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se',
                                watchedAt: new Date('2019-04-02T00:00:00Z') })]);
    await addItemRef!(markSeen(), { countsAsViewing: true });
    → { counted: false, restamped: true }

i.e. an intent-carrying write on a TRACKED non-'sedd' title counts nothing and overwrites the
user-authored 2019 date anyway. Date and count disagree. Unreachable from today's UI (the "Sedd
igen" entry renders only when `current?.status === 'sedd'`), so LOW/latent — but
`'rewatchCount' in rewatchFields(...)` makes it impossible by construction and costs one hoisted
const. Mutation M1 (dropping `&& currentForRating`) fails exactly one test, the cold-load case,
so the applied half IS load-bearing and correctly pinned.

**2. The premise correction was stated too broadly and became the round's new false comment.**
Round 4 killed "marking a film seen from its page counts the same as from Bibliotek's status
menu" (Bibliotek renders no `StatusButton`). The replacement reads: "nothing in production could
write sedd → sedd at all, so no surface counted a rewatch." The conclusion is right and the
premise is wrong. True of `updateStatus`/`buildStatusUpdate`: `QuickRateModal:87` fires only on
`plan === 'rating-and-status'` (tracked but NOT 'sedd'), `VillSePickerPage:43` acts on a
vill_se-filtered list, `WatchlistPage`'s bulk actions write `vill_se`/`avbruten`. False of
`addItem`, which is where the comment lives: the plain "Sedd" re-pick on an already-seen film
and OnboardingFlow's un-deduped "Sett den" both produce sedd → sedd — as the addItem JSDoc 60
lines above and `rewatchFields`' JSDoc both say, and as the sibling test "counts NOTHING for the
same write without that intent" exercises. The file now contradicts itself, and the false half is
exactly the sentence that would justify deleting the intent gate as guarding an unreachable
state.

**3. A phantom test failure came from a sibling agent mutating the prod file mid-run.**
My first full run of the four affected suites failed the key-set test with a spurious `addedAt`
difference. Re-hashing immediately showed `WatchlistContext.tsx` worktree=1214e83 vs
index=5a18f70 — a concurrent mutation-testing session had removed the intent term while my suite
ran. The tell was that the failing assertion belonged to a DIFFERENT invariant than anything the
fix touched. Because that session restores between mutations, a before/after hash pair can BOTH
read clean; the reliable answer is the isolated worktree
(`git write-tree` → `commit-tree` → `worktree add --detach` + `mklink /J node_modules`), where
all nine blobs verified equal to their staged shas and the FULL suite ran 192 files / 2209 tests
green, `tsc --noEmit` clean, eslint 0 errors. (The parent's 195/2243 includes the three unstaged
BIN-645 files; the index tree therefore also proves this diff commits ALONE.)

**4. Mutation-proving a key-set assertion needs a key the payload does not already have.**
Round 4's finding — "the ONLY difference the flag may make is the counter" held only because the
fixture had no stored `watchedAt` — was fixed properly (fixture now seeds `rewatchCount: 2` +
`watchedAt: 2019-04-02`, the filter excludes both keys, comment corrected). Proving the repair
took two tries: a mutant adding `lastWatchedEpisode` under the flag silently PASSED, because
`newTitle()` already puts that key in the payload and the mutation only changed its value. A
`zzzIntentLeak` key failed the assertion as intended. The assertion is genuinely non-vacuous;
the first mutant was the bad instrument, not the test.

**5. Sibling markers, again.** test-done (20:38Z) pins the round-4 blobs; four of nine have moved
since (StatusButton.test, WatchlistContext.test, WatchlistContext.tsx, watchlistWrites.test).
security-done (22:13Z) still pins the PRE-rebuild set (WatchlistContext.tsx@d5f2f69,
watchlistWrites.ts@088add9, todo.md@1779533) and names neither StatusButton file nor
watchlistWrites.test.ts. Both were reported as gate facts.

### 2026-07-31 — BIN-641 r7: a premise correction whose replacement EXAMPLE was also false

Round 5 flagged a comment claiming "nothing in production could write sedd → sedd at all"
(true of `updateStatus`, false of `addItem`). Round 6 applied the scope fix — and the
corrected text kept, and the diff added three MORE copies of, a second false claim:

  src/contexts/WatchlistContext.tsx:86-89   (addItem JSDoc: "The reachable case is
    OnboardingFlow's 'Sett den', which writes 'sedd' with no dedupe — a double-tap there
    IS a genuine sedd → sedd bulk write.")
  src/contexts/WatchlistContext.tsx:497-498 ("OnboardingFlow's un-deduped 'Sett den'")
  src/lib/watchlistWrites.ts:157-159        (rewatchFields JSDoc, same sentence)
  src/contexts/WatchlistContext.test.tsx:580-582 (test comment, same sentence)

Two errors in one claim. (a) The button is labelled **Sedd**, not "Sett den"
(OnboardingFlow.tsx StepFirstTitle: `Vill se` / `Sedd` for film, `Följ` for TV) —
`git grep "Sett den"` returned ONLY the comments, which is the cheap tell. (b) The list
DOES dedupe: `const alreadyAdded = items.some(i => i.tmdbId === r.id)` replaces both
buttons with a "Tillagd" chip. The only residual window is a double-tap inside the write
latency before the first snapshot lands — and in that window `itemsRef.current` is also
empty, so `currentForRating` is undefined and `rewatchFields` returns `{}` whatever the
intent flag says. So the cited case cannot count even in principle.

The CONCLUSION ("addItem always received sedd → sedd writes, it just never counted them")
is true — on different evidence: re-picking the plain 'Sedd' entry in StatusButton's or
QuickAddButton's menu on an already-'sedd' film. `MOVIE_STATUS_OPTIONS` always renders
'sedd', StatusButton.tsx:52 routes it to markSeen → addItem, and StatusButton.test's
"counts NOTHING when the user re-picks the plain Sedd option" pins exactly that gesture.
Why it matters: the addItem JSDoc uses OnboardingFlow as THE justification for "defaults
to FALSE by omission, because addItem is also the BULK path" — with the dedupe in place a
future editor checking that premise finds it false and may delete the intent parameter.

Also found (pre-existing, out of diff scope): that same `alreadyAdded` ignores mediaType,
so a movie id colliding with a tv id shows a false "Tillagd".

The re-date guard itself was verified good. On an isolated worktree of the INDEX
(hashes verified against `git rev-parse :<path>`): 192 files / 2209 tests green, tsc 0,
eslint 0 errors. Mutations on `...(item.status === 'sedd' && (('rewatchCount' in rewatch)
|| canAutoStampWatchedAt(...)))`:
  · term → `false`            → RED exactly 1 ("re-dates the film to now").
  · term → `!!opts?.countsAsViewing` → RED exactly 1 ("counts nothing during a cold load").
  · term → `!!(opts?.countsAsViewing && currentForRating)` (round 5's half-fix) → ALL 54
    GREEN. So the upgrade from raw-flag-plus-presence to the derived outcome is correct
    but NOT test-pinned; filed LOW/advisory.
  · probe (tracked 'vill_se' film + stored date + intent) → `counted=false,
    restamped=false`. Round 5's LOW 2 divergence is genuinely closed.

### 2026-08-01 — BIN-641 r8: a falsified comment example converges only when restated as a PROPERTY
Round 8 of one diff. Rounds 5/6/7 each fixed the SAME comment by swapping in a new named
caller as "the reachable bulk sedd → sedd write", and each new name was false when opened:
r5 "nothing in production could write sedd → sedd at all" (true of `updateStatus`, false of
`addItem`); r6 "the CSV importer" (`importable = analyzed.filter(a => a.match && !a.duplicate
&& a.status)` — it filters duplicates); r7 "OnboardingFlow's un-deduped 'Sett den'"
(OnboardingFlow.tsx:286 `const alreadyAdded = items.some(i => i.tmdbId === r.id)` renders a
"Tillagd" chip instead of the buttons, and the button reads **Sedd** — `git grep "Sett den"
-- src` returned only the comments themselves). Each wrong claim propagated to FOUR sites in
one commit: the addItem JSDoc, the inline payload block, `rewatchFields`' JSDoc, and a test
comment.

Round 8's rewrite finally holds, and the reason is structural, not editorial. It states the
caveat as a property that no single file can falsify — "addItem is also the BULK path (CSV
import, onboarding, 'add all' surfaces) … the rule does not depend on any of them being
reachable — a caller that does not state intent must not count, whether or not it can
currently produce the transition" — adds an explicit "do not re-justify that with a named
caller — two attempts to do so cited callers that dedupe", and moves the reachability claim
onto a surface that was actually opened AND is pinned by a test (StatusButton.tsx:110-119
renders the plain 'Sedd' option; `handleSelect(status)` defaults `countsAsViewing` to false;
StatusButton.test.tsx:60 "counts NOTHING when the user re-picks the plain Sedd option").
I verified the surviving enumeration too: settings/import/page.tsx:116, OnboardingFlow:239
and CollectionSection.tsx:104 `addAllUnseen` are all real bulk addItem callers — though
add-all writes only 'vill_se', so like the other two it cannot produce the transition today.
That is exactly why the sentence must claim CLASS MEMBERSHIP ("these are bulk paths") and
never reachability.

Round 7's LOW (advisory coverage) also came back applied and is now independently graded.
The new `it('neither counts nor re-dates a tracked film that is not sedd')` seeds
`{ status: 'vill_se', watchedAt: new Date('2019-04-02') }` — the stored date is load-bearing
(`toDate` in src/lib/firebase/utils.ts returns a native Date unchanged, so
`canAutoStampWatchedAt` sees a non-null value and the second OR term stays false). Mutating
the gate back to round 5's `(opts?.countsAsViewing && currentForRating)` — which left 2243
tests green a round ago — now fails that test and ONLY that test (1 failed | 54 passed).
Mutating to the raw flag fails it plus the cold-load test. Independent, not implied.

Verification rig: `git write-tree` → `commit-tree` → `worktree add --detach` + `mklink /J
node_modules`, all nine blob hashes checked against `git rev-parse :<path>` before running.
192 files / 2210 tests green (one more test than r7's 2209 — proving the staged set commits
alone, without the three unstaged BIN-645 files), tsc exit 0, eslint 0 errors / 4 pre-existing
warnings. Worktree removed with `git worktree remove --force`; node_modules intact.

Residual nit only: WatchlistContext.tsx:95 is a JSDoc continuation line with trailing
whitespace (`   * `) — cosmetic, no lint rule covers it. Gate facts recorded in the marker:
test-done still reads CHANGES REQUESTED and pins three superseded blobs (its finding is the
one that was just fixed), security-done pins none of the current BIN-641 blobs and never
named the StatusButton files.

### 2026-08-01 — BIN-641 round 6 (re-review after the integration reviewer's blocker + 3 optionals)

Re-review of the staged BIN-641 diff after I had APPROVED it with zero findings and five
files then moved. Reviewed the INDEX in an isolated worktree (`git write-tree` →
`commit-tree` → `worktree add --detach` + `mklink /J node_modules`), because a CONCURRENT
session was live-mutating `src/hooks/useMarkSeen.ts` and `useMarkSeen.test.tsx` in the
shared checkout while I worked. Twice I applied a mutation and found the file already
carrying someone else's (`const counted = Boolean(opts?.countsAsViewing); void
rewatchFields;`), and minutes later it hashed clean again — the sibling restores between
mutations, exactly the "before/after hashes can BOTH read clean" trap. Index blobs stayed
constant throughout; only the worktree copies diverged, and they were still divergent when
I finished (`useMarkSeen.ts` wt=7ee2907 vs index=252cb5d).

**Finding 1 (HIGH) — "two tests pin it" was false.** The parent reported that the new
toast "calls `rewatchFields` and tests `'rewatchCount' in` rather than re-deriving the
rule … Two tests pin it." Mutant A — replacing the whole expression at useMarkSeen.ts:64-65
with `Boolean(opts?.countsAsViewing)` — left ALL FOUR staged test files green (66 tests,
3 files run; and the full 192-file/2212-test suite is green either way). Why: the one
counted-toast fixture seeds `{status:'sedd', rating:4}`, so the dropped conjunct is true
anyway; every other test either omits `opts` or has `getItem() === null` + no rating and
takes the `showRating` branch, where `toast.show` is never asserted. So the exact defect
the test reviewer caught in the first cut has NO regression pin. Missing test:
`countsAsViewing:true` + `getItem → {status:'vill_se', rating:4}` → expects the ORDINARY
toast. (Contrast the WRITE side, which is properly pinned: mutant B — re-date gated on the
raw flag — failed 2 tests including "neither counts nor re-dates a tracked film that is not
sedd"; mutant C — counted rewatch no longer re-dates — failed "re-dates the film to now".)

**Finding 2 (HIGH, trivial) — a comment sentence lost its subject.** useMarkSeen.ts:62
reads "becomes a lie.  must exist too: if getItem found the title …" — the word `current`
was dropped (double space is the scar). In the one ticket where three comment claims have
already turned out false, an unreadable sentence in the comment defending the fix is not a
nit.

**Finding 3 (MEDIUM) — "UNREACHABLE" is a render-state claim about a live-ref guard.**
watchlistWrites.ts:236 ("sedd -> sedd. UNREACHABLE from this function: no updateStatus
caller can produce it") and WatchlistContext.tsx:504 ("no updateStatus caller can reach
that transition at all"). I verified all four callers: QuickRateModal (gated by
`planQuickRateWrite`), VillSePicker (its "Redan sett" is film-only and its film list is
filtered to `status==='vill_se'`), WatchlistPage ×2 (writes `vill_se`/`avbruten`). Correct
as far as it goes — but each caller decides from RENDER state while `buildStatusUpdate`
receives `ctx.currentStatus` from `itemsRef` (live), so any `await` in between reopens the
transition: (a) a second click on "Redan sett" landing after `itemsRef.current = next` and
before the card unmounts (Firestore's optimistic local snapshot makes that window real, if
~one frame); (b) QuickRateModal's `await updateRating(...)` between `planQuickRateWrite`
and `updateStatus`, if the title flips to 'sedd' from another tab/device. The danger is the
absolute wording inviting deletion of the branch — and if it DOES fire it counts with no
intent gate and no re-date, which `rewatchFields`' own JSDoc says must never happen.
Remedy: scope to "no caller can INTEND it, which is why the branch stays".

**Finding 4 (LOW) — the toast can lie, and `current != null` doesn't close it.** The toast
reads `current` from `getItem()` (render closure); the write reads `itemsRef` after
`await fsdb()`. Toast-claims-counted-when-it-wasn't is reachable (a remote status change or
delete inside that window); silent-but-counted is not, because the "Sedd igen" entry only
renders while render state already says 'sedd'. `current != null` proves a snapshot LANDED,
not that the write saw the same row — and semantically it adds nothing beyond null-safety,
since `rewatchFields('sedd', undefined, …)` already returns `{}`. Cosmetic-only; BIN-655
owns the real shape. Fix the comment's over-claim rather than the code.

**Finding 5 (LOW) — a plan criterion the diff deliberately rebuts, unamended.**
tasks/todo.md: "The rationale comments describe the REAL reachable bulk case
(OnboardingFlow's 'Sett den' has no dedupe)". The shipped comment says the opposite —
onboarding swaps in a "Tillagd" chip, so that example was ALSO false, and the rule is now
stated as a property. The sibling criterion in the same file WAS amended in place ("plus at
most `rewatchCount` and `watchedAt` (the re-date, added by Malin 2026-07-31)"), so the
convention exists; this line just got missed.

**Finding 6 (LOW) — section-banner orphaning, third instance in this ticket.**
WatchlistContext.test.tsx:551-555's `── BIN-593 — watchedAt is user-authored data ──`
banner now heads the 116-line BIN-641 `describe` inserted under it; its own tests start
after. Same insertion-orphaning that already hit two JSDoc blocks here.

**Finding 7 (LOW) — helper parity claimed on arguments it doesn't share.** The toast asks
`rewatchFields('sedd', …)` while the TV write asks `rewatchFields('mina', …)`; the comment
says it "Asks the SAME helper the write asks". Harmless only because `migrateStatus` can
never surface a TV item as 'sedd' — an invariant in another file.

**Scope-creep call (asked explicitly):** keep the toast. ~10 lines inside the same gesture,
and without it the app's only permanent un-editable write ships with no on-screen feedback.
It IS an undecided Swedish product string ("omtitt räknad") — name it to Malin in the ship
report rather than split the ticket.

Verified on the index worktree: `tsc --noEmit` clean; full suite 192 files / 2212 tests
green (parent's 195/2246 = +3 untracked BIN-645 test files not in the index — reconciled,
not a discrepancy); eslint 0 errors on all 8 staged src files (4 pre-existing warnings in
WatchlistContext.test.tsx). Sibling markers: not re-checked this round beyond the previous
pass's note — test-done still reads CHANGES REQUESTED against superseded blobs.

### 2026-08-01 — BIN-641 round 10: the briefed delta was wrong, and `git worktree remove --force` ate node_modules

**Brief.** "Your marker drifted on two files. The delta since your CHANGES-REQUESTED is
comment-only plus one comment-block move — no executable line changed. Confirm that, and
confirm the new wording is true."

**What the shas actually said.** Five of my nine pinned blobs had moved, not two:
useMarkSeen.ts 252cb5d→0e62588, useMarkSeen.test.tsx eeb791b→65eb483, WatchlistContext.test.tsx
c1f39bf→e339c9a, watchlistWrites.ts f7465ce→5785ad0, tasks/todo.md d3a6446→be25071. Two of the
five carried EXECUTABLE change:
 · useMarkSeen.ts added `const writtenStatus: WatchStatus = mediaType === 'tv' ? 'mina' : 'sedd'`
   (+ a `WatchStatus` type import) and passes it to `rewatchFields` instead of a literal `'sedd'`.
 · useMarkSeen.test.tsx added two tests ("…flag is passed but nothing counts", "…for a series").
Both were my own round-9 findings 7 and 1. The parent believed both predated my read ("you read a
stale index"); the shas prove they followed it. The lesson is not that the parent lied — it is
that a coordinator reconstructing a multi-session timeline gets the ORDER wrong, so a re-review
must diff pinned→current per path and re-derive anything executable from scratch.

**Re-verification (isolated worktree off `git write-tree`, all nine blobs hash-matched):**
baseline 4 staged test files 106/106; full suite 192 files / 2214 tests (parent's 195/2248 minus
the 3 untracked BIN-645 files — reconciled, and it re-proves the staged half commits alone);
`npx tsc --noEmit` clean; eslint 0 errors on 8 staged src files (4 pre-existing warnings).
Mutation A `writtenStatus = 'sedd'` → "does not claim a rewatch for a series" fails ALONE.
Mutation B `counted = Boolean(opts?.countsAsViewing)` → 2 fail. Both parent claims reproduced
exactly; the toast rule is now genuinely pinned and round-9 MUST-FIX 1 is discharged.

**The one surviving false claim** (LOW, non-blocking, reported as such): useMarkSeen.ts:69-71
says "passing 'sedd' here would let a TV call toast a rewatch over a write that counts nothing."
It could not. `getItem` serves `docToItem`-migrated items and `migrateStatus` maps TV
'sedd'→'mina' at READ time, so `current.status` is never 'sedd' for TV; and the only caller that
passes `countsAsViewing` is StatusButton's "Sedd igen", gated `current?.status === 'sedd' &&
mediaType === 'movie'`. Two independent invariants. The CODE change is right — the toast must ask
about the status the payload carries (addItem:408 passes `item.status`, i.e. 'mina' for TV) — but
its justification claims a live failure mode that does not exist. Fourth round in a row that this
ticket has shipped a comment justifying a correct change with a wrong concrete consequence.
Property-form wording offered: "asks about the status the PAYLOAD carries (TV writes 'mina'), so
the toast cannot drift from the write even if the read path stops normalizing TV statuses."

Also noted, not findings: tasks/todo.md's amended criterion ticks "The rationale comments name NO
caller at all" while rewatchFields' JSDoc still enumerates "CSV import, onboarding, 'add all'
surfaces" as a CLASS (which my own principle says is fine) — the tick is about the JUSTIFICATION,
the wording overshoots; and watchlistWrites.ts:236-240's two inserted comment lines are indented
one space short of the block.

**TOOLING INCIDENT — I emptied the shared node_modules.** My knowledge said `git worktree remove
--force` "drops the junction". It does not: on Windows it traversed the `mklink /J` junction into
`C:\binge\node_modules` and deleted every package, breaking the checkout for the concurrent
sessions too. Recovered with `npm ci` (one run, verified `node_modules/.bin/vitest` back). This is
almost certainly one of the "node_modules has been wiped five times by concurrent sessions" events
the parent reported — i.e. a reviewer, not a mystery. Principle rewritten: `cmd //c rmdir
node_modules` from inside the scratch tree FIRST, then `git worktree remove --force`, then verify.

**Sibling gate facts.** test-done.marker (01:22Z) reads APPROVED and pins BOTH variants of the
moved paths, so it covers every current staged src sha. security-done.marker (2026-07-30 22:13Z)
pins pre-round blobs for all five moved files (WatchlistContext.tsx@d5f2f69, useMarkSeen.ts@56330ea,
watchlistWrites.ts@088add9 …) — its PASS does not cover the current bytes.

Knowledge file is 32.4k against its 30k cap even after four compensating compressions; closing
that needs retiring lessons, which I did not do unilaterally mid-review.

### 2026-08-01 — BIN-645 (alone): the consent hole is closed on the badge and still open on the landing CTA

Staged set: `src/lib/nextPath.ts` + test (new), `src/components/title/QuickAddButton.tsx` + test
(new), `src/app/login/page.tsx` + test (new). Six blobs, no rules/indexes/functions, no new route.
Verdict PASS with three fixes owed (two vacuous assertions, one wrong route name).

**A sibling was mutation-testing the same files mid-review — third occurrence.** `git status`
was clean at 11:52; by 11:57 the worktree carried `MUT-D1/D2/L1` mutants in `login/page.tsx`
and `login/page.test.tsx` plus two untracked `_poc-*.test.ts` files. The index never moved.
Ran everything on `git write-tree` → `commit-tree` → `worktree add --detach` with a junction to
`C:\binge\node_modules`, verified all six `git hash-object` == the staged shas, and tore the
junction down BEFORE `worktree remove --force` (node_modules verified intact after). Full suite
there: 195 files / 2248 tests green, typecheck clean, eslint clean on all six — matching the
dispatcher's claim exactly, which the shared checkout could not have shown.

**Mutations run (all in the isolated tree):**
- Remove `redirectedRef` latch → "redirects once, even when the effect runs again" is the SOLE
  failure. The security marker's declared gap ("deleting the latch leaves every case green",
  filed as BIN-652 against `login/page.test.tsx@5f7f097`) is CLOSED by the current blob 731a23b.
- `next ?? '/'` → `'/'` → 2 failures. `takeNextPath()` hoisted above the `!user` guard → 2 failures.
- Drop `location.search` from the write site → the QuickAddButton path test fails.
- Delete `disabled={authLoading}` → only the `toBeDisabled()` assertion fails; the handler's
  `if (authLoading) return` holds the rest, so the belt-and-braces branch is genuinely live.
- **Delete `stripUnsafeQuery` from `rememberNextPath` → all 29 tests still green.** The end-to-end
  case "is applied by rememberNextPath, not just available to it" reads back through
  `takeNextPath()`, which strips a second time. The same file warns against exactly this 60 lines
  earlier for `safeNextPath` ("Assert the STORAGE, not the read … so the writer's own guard would
  be free to disappear") and then doesn't apply it. Fix: assert the stored bytes.

**Second vacuous assertion:** `login/page.test.tsx`'s "does not redirect a visitor who is not
signed in" does `render()` → `setItem` → `getItem`. The storage half asserts that sessionStorage
works, not that the signed-out render left the value alone. Move the `setItem` above the render.

**Route name `/sok` does not exist** — the search route is `src/app/search/page.tsx`, reading
`?q=` via `useSearchParams`. `/sok` appears in the QuickAddButton comment, its test header, three
`nextPath.test.ts` fixtures, and (copied) in the security marker's prose. The MECHANISM the
comment defends (read `location.pathname + location.search`, not `usePathname()`) is correct and
proven by mutation; only the named surface is wrong. Same class as the `/film/…` fixture lesson.

**Consent: the security marker's evidence command was too narrow.** It recorded "grep `signIn()`
returns exactly ONE production call site" and closed the consent question. `TopbarActions.tsx:306`
and `HomePageClient.tsx:75` pass the function by reference — `onClick={signIn}` — so both still
run `signInWithPopup` → `ensureUserProfile`'s create branch → `termsAcceptedAt` / `termsVersion` /
`ageConfirmedAt`, from surfaces that show no villkor link and no 13+ notice (the global Footer has
a Villkor link; that is not a near-the-button browse-wrap, and nothing states the age bar). The
landing page's primary CTA is one of the two. Nothing in the staged diff claims otherwise — no
comment in it is falsified — so this is an also-found, not a blocker: it is pre-existing and the
diff strictly improves the situation. My own principles file had recorded "BIN-645 converted the
last one", which was false; corrected in place.

**Sibling marker coverage at review time:** `security-done.marker` pins `login/page.tsx@64c9374`,
`login/page.test.tsx@5f7f097`, `nextPath.ts@3b69b15`, `nextPath.test.ts@294e416`,
`QuickAddButton.test.tsx@a89d3d0` — four of six staged blobs have moved since, and only
`QuickAddButton.tsx@d3994d6` still matches. The moves look like its own Low being applied (the
`RETURN_QUERY_KEYS` allowlist at both ends + the rewritten nextPath.ts paragraph), which is the
right fix, but a security PASS on superseded bytes is not a PASS. `test-done.marker` pins only
BIN-641 files and covers nothing here.

**Also standing:** `.claude/state/workflow-map-stale.json` names `src/app/login/page.tsx`, and
`flow1` "Sign in & hydrate" covers `/login` — its first step is still "web-app → firebase-auth:
signIn (email / Google)", which no longer describes the badge's route-to-login leg. Owed as its
own commit (never bundled with feature code).

Knowledge file is 33.3k against its 30k cap after four compensating compressions. Closing that
needs retiring lessons; I did not do it unilaterally mid-review — same call as 2026-08-01 BIN-641.

### 2026-08-01 — BIN-645 round 2: a deferred guard's test pins only that the wait STARTS

Re-review of the BIN-645 staged diff after my three findings plus a shared security/code-review
Low were applied. Ran the whole thing on an isolated worktree of the INDEX (write-tree →
commit-tree → worktree add --detach → mklink /J node_modules), all seven `git hash-object`
verified == their staged shas: typecheck clean, 195 files / 2250 tests, eslint 0, then every
mutation there. Teardown junction-first; node_modules verified intact.

**The new login gate is correct and independently pinned in all three dimensions.** Mutations,
each producing a SOLE failure in `login/page.test.tsx`: (a) reverting the guard to `!user` fails
"redirects a signed-in visitor whose profile failed to load"; (b) dropping `profileLoading` from
the guard fails "waits while the profile is still loading"; (c) flipping the decision to
`user == null || !user.onboardingCompletedAt` — i.e. treating an unloadable profile as NEEDING
onboarding — fails (a)'s case again. So the DECISION is pinned, not just the guard shape.

**But the wait has no exit test.** Mutating the effect to

    if (!uid || redirectedRef.current) return;
    redirectedRef.current = true;
    if (profileLoading) return;

— latching DURING the wait — passes all 7 tests. That mutant strands EVERY returning visitor on
/login forever, because `onAuthStateChanged` batches `setUid` + `setProfileLoading(true)` in one
callback, so the normal boot ALWAYS renders once with the flag true. The "waits while…" case
asserts only that nothing happened on the first render. Repair (verified: makes the mutant the
sole failure, passes clean) is to extend the same case — rerender with `auth.profileLoading =
false; auth.user = returning;` and assert `push` with the remembered path. Generalised into the
testing-grades bullet: a "waits while X" case pins the START of a deferral, never its RESUME.

Method note worth keeping: my first attempt at that repair used `perl -0pi -e` and silently did
not match, which read exactly like "the mutant survived the fix". Assert the patch landed
(`grep` the new test name) before believing a mutation verdict either way.

**Can `profileLoading` fail to settle?** Traced AuthContext 426-472. `setProfileLoading(false)`
is in `.finally`, guarded by `auth.currentUser?.uid === firebaseUser.uid`; the sign-out branch
sets it false unconditionally, and an account switch starts a fresh true→false cycle. So it
settles on every path except a `ensureUserProfile` that never resolves — and that case stranded
the visitor under the OLD `!user` gate too. New strand set ⊂ old strand set: strictly better.
`tasks/todo.md`'s "cannot strand anyone" is therefore an over-claim, harmless in a disposable
plan file. No render window exists where `uid` is set and `profileLoading` is still false before
the profile load starts — both setters are in the same synchronous callback, so React 19 batches
them into one render.

**Is `needsOnboarding: false` right for an unreadable profile? Mostly — with one real residual.**
`LoginPage` is the ONLY router into `/onboarding/` (grepped `src/**`: no other push/Link).
So a genuinely-new account whose profile CREATE failed (ensureUserProfile's transaction throwing
on first Google sign-in) is now navigated to `next ?? '/'` and never sees onboarding again in
that session — and `onAuthStateChanged` does not refire, so no retry. The OLD gate left them on
the login form, where tapping "Logga in med Google" again re-ran ensureUserProfile and routed
them to onboarding correctly. So the fix trades a common hard-strand for a rare silent
onboarding skip. Right trade, but it deserves its own ticket rather than living only in a
comment that says the narrower thing ("a profile we could not load cannot claim the account
needs onboarding").

**Invented routes, third occurrence — and the FIX round introduced one.** `/sok` was corrected
to `/search` in seven places. But the new allowlist fixture reads `/rekommendationer/?row=2` and
that route does not exist either (`src/app/recommendations/`, and `RecRow` builds
`/recommendations/?row=${rowKey}` — a key, not a number); `nextPath.ts`'s own header still says
`?next=/film/1399/` (title routes are `/movie/:id/`); and the untouched neighbour fixture
`/my/all?status=sedd&provider=8` names a query the app never produces (`?status=` is only ever
`behind`, and only on `/my/series`). All documentary — `stripUnsafeQuery` is route-agnostic and
the `row` fixture IS load-bearing (deleting `'row'` from RETURN_QUERY_KEYS fails it alone) — but
this is the class that has now cost four rounds across two tickets. Lesson folded: sweep the
whole file, not the flagged line.

**Line endings.** `QuickAddButton.test.tsx`'s staged blob is 132/132 CRLF while every other
source blob in the repo is LF (`core.autocrlf=true`, no `.gitattributes`). That is why the
blob-to-blob diff rendered a 5-line change as a 258-line rewrite, and it checks out as `\r\r\n`.
Cosmetic, but it hid the delta from review and will re-churn. Folded into the staged-index
bullet: count `\r\n` before reading a "whole-file rewrite".

**Sibling markers are stale on every byte that matters.** security-done.marker: 0 of 6 pins
match the index. test-done.marker: 1 of 7 (QuickAddButton.tsx@5fc54dd). The uncovered delta is
the auth-gate change — the one behavioural change of the round, on the auth boundary the
security reviewer exists to own. Both must re-stamp before commit.

**Plan.** `tasks/todo.md` gained a dated "review-round fixes" section but the BIN-645 plan block
(lines 422-448) is untouched: condition 4 still specifies the `?next=` query param, condition 5
still requires a `<Suspense>` boundary for a `useSearchParams` the shipped design never uses,
and all five acceptance boxes are still `- [ ]`. Amend in place; appending a newer section is
not amending. Flagged last round, not done.

Knowledge file stands at 35.6k against its 30k cap after four lessons folded in and five
compensating compressions (net ~+2.3k). Closing the gap needs RETIRING lessons, not more
squeezing; the honest candidates are the BIN-641 comment-round narrative and the older
freshness-stamp examples, both of which live verbatim here. Not doing it unilaterally
mid-review — same call as the two preceding markers.

### 2026-08-01 — BIN-645 round 3 (code review): the half-test fix verified on THREE axes, and the CRLF trap that fakes a surviving mutant

**Context.** Third code-review round on the BIN-645 staged diff (7 files). Both prod files
(`src/app/login/page.tsx@85d0106`, `src/components/title/QuickAddButton.tsx@5fc54dd`) were
byte-identical to round 2 — this round changed only tests, comments and `tasks/todo.md`. The
parent asked me to check hardest whether the round-2 fix to the `profileLoading` test held up
under a CONTRACT change it shipped alongside: the `next/navigation` mock became one hoisted
stable router object.

**The stable-router contract change is the interesting part.** Round 2's file had
`vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))` — a factory that builds a
fresh `{ push }` on every call. Under React that hands the effect a NEW router identity on every
render, so `[uid, user, profileLoading, router]` re-fires unconditionally and every dep-array
case in the file passes for the wrong reason. Making the router stable is correct, but it also
means the file's OTHER identity-based case (`redirects once, even when the effect runs again`,
which drives the second run with a spread copy of the same user object) was written against the
loose contract. So the fix could have silently made a pre-existing case vacuous while closing the
new one. I re-ran that mutation: deleting the `redirectedRef` latch still fails `redirects once`
ALONE (1 of 36 across the three files). It did not go vacuous — the fresh `user` identity is
doing the work the comment now claims.

**Three mutants, each the sole failure of the SAME case** (`waits while the profile is loading,
then redirects once it settles`), which is what makes it independent rather than implied:
1. latch-on-the-way-in (`if (!uid || redirectedRef.current) return; redirectedRef.current =
   true; if (profileLoading) return;`) — the round-2 finding's mutant. 1 failed / 35 passed.
2. `profileLoading` dropped from the dep array (`}, [uid, user, router]);`) — the test
   reviewer's independent route to the same hole. 1 failed / 35 passed.
3. `profileLoading` dropped from the guard BODY only (deps intact) — the wait-START half.
   1 failed / 6 passed within the file.
So the one case pins wait-starts, latch-placement and the dep entry. Worth naming as a shape: a
wait-then-resume case is the cheapest way to buy three independent guarantees at once, and the
start-only version buys none of the three.

**The methodology trap that cost me two runs.** The isolated index-worktree recipe checks files
out through `core.autocrlf=true`, so every file in the scratch worktree is CRLF even though the
staged blob is LF. An LF-anchored multi-line perl substitution therefore silently matches
nothing. Worse: `perl -0pi -e` mis-parses on top of that (`-0` swallows `pi`), so BOTH my first
two patch attempts exited 0, changed nothing, and the suite came back green — which reads exactly
like "the mutant survived, the test is vacuous". Same class the knowledge file already warned
about, arriving through a new door. Remedy adopted: a 7-line node script that reads the file,
normalizes CRLF to LF, ASSERTS the search string is present (exit 2 if not), reports the
occurrence count, and writes back. Every mutation this round printed `PATCH LANDED,
occurrences=1` before the suite ran.

**Teardown correction.** `git worktree remove --force` failed `Permission denied` on the
directory itself AFTER emptying its contents (the junction had already been dropped first, per
the standing rule, so `C:\binge\node_modules` was never at risk and was verified intact). The
finish is `git worktree prune` plus a plain `rmdir` on the now-empty dir; without the prune the
repo keeps a phantom worktree entry.

**Route claims verified rather than accepted.** Round 2 filed the invented-route class recurring
inside its own fix. The three replacements were checked against the code that builds the URLs:
`RecRow.tsx:100` builds `/recommendations/?row=` with an encodeURIComponent'd `rowSpec.rowKey`,
and `types/recommendations.ts:16-24` documents rowKey as colon-joined (`person:140607`), so
`/recommendations/?row=person%3A1245` round-trips through `URLSearchParams` unchanged (the
form-urlencoded serializer re-encodes the colon); `src/app/my/series/page.tsx` renders
`<WatchlistPage status="mina">` and `WatchlistPage.tsx:100` reads `?status=behind` only under
that, with `?provider=` at line 93. All four `RETURN_QUERY_KEYS` swept repo-wide against every
`searchParams.get(...)` in `src/`: the only action-on-mount params in the app are `invite` and
`fromGroup`, and both are excluded. The new `?fromGroup=` paragraph in `nextPath.ts`'s header
also checks out — `SeasonPageClient.tsx:27-29` pays `useGroup` + `useGroupMemberProgress` on
mount, and `TVShowPageClient.tsx:554` renders `RecCard`, which carries `QuickAddButton`.

**Plan amendment discharged.** Round 2's standing finding was that `tasks/todo.md` had grown an
appended "review-round fixes" section instead of amending the plan. It is now amended IN PLACE:
condition 4 is rewritten off `?next=`, condition 5 carries a dated "moot — no `useSearchParams`,
so no `<Suspense>`" note, and all five acceptance boxes are ticked with widened wording. The
appended narrative section survives as a record, which is the right split.

**Residual I stand behind, unchanged.** `LoginPage` remains the only router into `/onboarding/`,
so a brand-new account whose profile CREATE failed now goes to `next ?? '/'` and never sees
onboarding that session. The security pass confirmed consent (termsAcceptedAt/ageConfirmedAt) is
stamped inside `ensureUserProfile`'s create branch independently of the redirect, so nothing
consent-bearing is skipped — only provider setup. The trade is right (a common hard strand for a
rare silent skip), but it is recorded NOWHERE in the staged bytes: `page.tsx`'s comment states
only the narrow half, and `todo.md`'s "Deliberately NOT done here" list omits it while its
closing assumption still says the gate "cannot strand anyone" — an over-claim that both the
hung-read case and this onboarding skip rebut. Answer to the parent's question: it belongs on
BIN-669 as prose, not in another edit to the file.

**Sibling-marker state at this round.** Both `security-done.marker` and `test-done.marker` pin
the identical round-2 sha set; 5 of 7 have moved. Materially better than round 2 though — both
prod files are pinned at their CURRENT shas, because neither changed. The delta neither covers is
tests + comments + `todo.md`, including `nextPath.ts`'s security-reasoning header. Naming that is
a gate fact for the parent even though it does not change my verdict.

**Verification.** Isolated index worktree, all 7 `git hash-object` == staged sha, junction to the
shared `node_modules`; `node_modules/.vite/vitest` cleared before every run. Baseline 36/36 on
the three files, full suite 195 files / 2250 tests green (matches the parent's numbers), `tsc
--noEmit` exit 0, `eslint` exit 0 on all six source files. `git diff --stat` empty before and
after; worktree hashes == index hashes at the end.

**Knowledge.** Two lessons folded IN PLACE: the CRLF-in-the-scratch-worktree / perl no-match trap
plus the prune-then-rmdir teardown, into the isolated-worktree bullet; and the stable-router-mock
rule plus "one wait-then-resume case pins three dimensions", into the "waits while X" testing
bullet. Paid with three compressions (a duplicated `migrateStatus` line in the seed checklist, a
duplicated onSnapshot-is-terminal clause in the freshness bullet, and the perl sentence the
worktree bullet now owns). File stands at 36.1k against its 30k cap — the fourth consecutive
round to report the overage. It cannot be squeezed further honestly; the retirement candidates
remain the BIN-641 comment-round narrative and the older freshness-stamp examples, both verbatim
above. Still not doing it unilaterally mid-review.

### 2026-08-02 — BIN-601/640 rebuild: addedAtIsFallback omitted from buildAddPayload's ServerOwned
Reviewed the rebuilt BIN-601 (also closing BIN-640): `WatchlistContext.tsx`'s repair effect,
`src/lib/watchlist/addedAt.ts` (`resolveAddedAt`/`hasStoredAddedAt`/`addedAtIsRepairable`), the new
`addedAtIsFallback?: boolean` field on `WatchlistItem` (`src/types/domain.ts`), and
`usePublicProfile.mapWatchlistDoc`. The repair-effect shape (own effect keyed on `items`, dedup ref
marked BEFORE the write, chunked `writeBatch`, `addedAt`-only payload, cross-account `itemsUidRef`
guard) matches the plan and the notes-migration/`nextAirReadRepair` precedent exactly, and every
sub-condition (never-repairs-twice-after-a-failed-write, two-tab independence, multi-touch-during-
outage drift, cross-account guard) has its own mutation-shaped test in `WatchlistContext.test.tsx`.

The one real defect: `src/types/domain.ts` added `addedAtIsFallback` to `WatchlistItem` but
`src/lib/watchlist/buildAddPayload.ts` was not touched. `ServerOwned` (the union excluded from
`Carryable`) lists `addedAt/updatedAt/watchedAt/dropped/rewatchCount/providersCheckedAt/visibility/
notes` — not `addedAtIsFallback`. Since `Carryable = Exclude<keyof WatchlistItem, ServerOwned |
AlwaysWritten>` and `WatchlistAddPayload = ... & Partial<Pick<WatchlistItem, Carryable>>`, the new
field is now a structurally-legal optional key on `WatchlistAddPayload` — exactly the `notes` class
of bug the file's own comments name ("That already bit us once, with notes... a cast, plain JS, a
future refactor that widens the signature"), for which `notes` got BOTH a type exclusion AND a
runtime strip in `addItem`. Not live today: `buildWatchlistAddPayload` is the sole payload builder
across all 9 `addItem` call sites (grepped) and never sets it, and `QuickRateModal`'s
`buildItemFromTmdb` also routes through it. But it is a real, cheap, on-point fix (add one string to
the union) and the task brief asked specifically to check this exact class of leak.

Also mid-review: two transient worktree/index divergences appeared and self-healed —
`WatchlistContext.tsx` briefly lost the `missing.forEach(...add...)` mark-before-write line, and
`usePublicProfile.ts` briefly reverted `resolveAddedAt(data)` to the old `toDate(data.addedAt)` —
both consistent with a concurrent `binge-test-reviewer` mutation pass on the exact lines this review
was also scrutinizing. `git hash-object` vs `git rev-parse :<path>` on all 9 reviewed files matched
the index by the time of the final read; noted as gate evidence rather than a defect since `git diff
--cached` is the only surface that matters for commit.

Minor, non-blocking: `usePublicProfile.mapWatchlistDoc` was exported "for test only" rather than
extracted to a `usePublicProfile.helpers.ts` per the test-extraction convention (`code-style.md`) —
it needed `vi.mock('@/lib/firebase/db')` in its test purely because importing the file pulls in an
unrelated `fsdb` import, which extraction would have avoided. Judged as an acceptable, low-cost
trade given `resolveAddedAt`/`addedAtIsRepairable` already live in the shared `addedAt.ts` module and
this is the only thing `mapWatchlistDoc` itself needed extracting for.

### 2026-08-03 — BIN-660: un-nesting a button from a card-wide Link (EventCard)

Staged diff: `src/components/calendar/EventCard.tsx` (index 910a741) + new
`src/components/calendar/EventCard.test.tsx` (index 50f31ae), plus `tasks/lessons.md`
and a `tasks/todo.md` sprint-scratch rewrite. Worktree == index on both source files
throughout; clean control green (8/8) before and after every mutation.

**The focus-ring fix is coherent — verified mechanically, not re-derived.**
`.ev` (globals.css:1582-1593) carries `overflow: hidden` (that is what rounds the still's
top corners), and the global ring is `:focus-visible { outline: 2px solid var(--acc-deep);
outline-offset: 2px }` at globals.css:164-168. Before BIN-660 the focusable element WAS the
card root, so the outward ring sat outside the clip; moving focus to an inner `<Link>` puts
it inside, clipped on three sides with a stray segment over the footer. The fix is a Tailwind
arbitrary utility on the anchor, `focus-visible:[outline-offset:-2px]`.

Two things I checked rather than assumed, because a no-op utility would look identical in the
test that pins it:
1. It generates. `npx tailwindcss -i src/app/globals.css -o <tmp> --content ./src/components/
   calendar/EventCard.tsx` emits `.focus-visible\:\[outline-offset\:-2px\]:focus-visible {
   outline-offset: -2px }` at line 3895 of 3897 — top-level, not inside any `@media`.
2. It wins the cascade. Tailwind v3 (`tailwindcss ^3.4.1`, `@tailwind base/components/
   utilities` at globals.css:1-3) FLATTENS `@layer` at build time, so there is no native
   cascade-layer inversion where unlayered CSS would beat a layered utility. It wins on both
   axes anyway: specificity (0,2,0) vs the bare `:focus-visible`'s (0,1,0), and source order
   (3895 vs 776 in the built file). Worth recording because if the repo ever moves to
   Tailwind v4's `@import "tailwindcss"`, real `@layer` returns and the UNLAYERED
   `:focus-visible` in globals.css would beat every layered utility regardless of
   specificity — this exact fix would silently become a no-op.
3. It is load-bearing in the suite. Deleting the class from the className (verified landed via
   `grep -n MUTANT` in the same command as the run) fails exactly one test,
   `draws the focus ring inward so the card does not clip it`, 7 others green.

**The real finding: the ELSE branch was hoisted too.**
`canMarkWatched(e)` is `e.kind === 'episode'`, so a MOVIE card never rendered a `<button>`
inside the anchor — it rendered `<div style={{marginTop:4}}><span>vill se</span></div>` inside
`.body`, entirely non-interactive. The fix moved BOTH branches out of the `<Link>` into a
shared `footerStyle` sibling. Consequence on movie cards: the bottom strip (~15px text + 12px
padding) stops navigating and, because the footer sets `cursor: 'default'` to undo `.ev`'s
`cursor: pointer`, flips from a hand to an arrow. That contradicts the ticket's own acceptance
#2 ("card-level navigation keeps its current behavior") and #3 ("no visual change"). Non-
blocking — it is a small affordance loss, not a correctness or CLAUDE.md-rule break — but it
is scope creep with zero a11y benefit, and the remedy is cheap: keep the movie footer inside
the `<Link>` with its original `marginTop: 4`, and apply `.body`'s compensating
`paddingBottom: 8` only in the `showToggle` branch.

**The spacing arithmetic does hold** (I re-derived it against globals.css rather than trust
the code comment's "nothing moves on screen"):
- OLD: `.ev .body` = `padding: 10px 12px 12px; gap: 4px`, toggle row last child with
  `marginTop: 4` → 8px above the row (4 gap + 4 margin), 12px below (body padding-bottom),
  12px horizontal.
- NEW: `.body` gets inline `paddingBottom: 8`, footer sibling gets `padding: '0 12px 12px'`
  → 8px above, 12px below, 12px horizontal. Identical.
- `.ev .body` / `.ev .px` / `.ev.is-watched .px img` are all DESCENDANT selectors, so they
  keep matching now that `.ev` is a `<div>` instead of the `<a>`. `.ev`'s own
  `text-decoration: none; color: inherit` are re-declared on the Link as `no-underline
  text-inherit` (both generate; also redundant with preflight's `a { color: inherit }`).
- `.ev .body`'s `flex: 1` still works because the Link carries `flex-1` inside `.ev`'s
  column — and `.col-body` gives cards auto height anyway, so nothing was distributing.

**Tailwind v3 preflight covers the button reset I went looking for.** The old control was
`<button class="ev-toggle">` (14px square, its own bg/border/padding from globals.css:1740).
The new one is a bare `<button className="flex items-center">` with only inline
`fontSize/color/letterSpacing`. Confirmed in `node_modules/tailwindcss/src/css/preflight.css`:
`button` gets `background-color: transparent`, `background-image: none`, `border-width: 0`
(universal rule), `margin: 0; padding: 0`, `font-family/weight/line-height/color: inherit`,
`font-size: 100%`, and — line 343 — `cursor: pointer`. That last one is why the footer div's
inherited `cursor: default` does NOT reach the button: preflight's directly-applied
declaration beats an inherited value. So no cursor regression on episode cards. (Note for a
future v4 migration: v4 dropped the `button { cursor: pointer }` default, which would make
this button inherit `default` from `footerStyle`.)

**Comment-vs-code nit.** The comment at EventCard.tsx:113-115 says `.ev-toggle`'s new `block`
class "only restores the box model an inline span would otherwise ignore". The span is a flex
item of `<button className="flex items-center">`, and CSS blockifies flex items regardless of
their specified `display`, so `block` is a no-op and the stated mechanism is wrong. Harmless
code, wrong justification — flag the comment per the comment-vs-code principle.

**Coverage note handed to binge-test-reviewer (advisory here).** Acceptance #3 is entirely
unpinned. Mutating `padding: '0 12px 12px'` → `'99px 12px 12px'` AND deleting `.body`'s
`style={{ paddingBottom: 8 }}` in the same patch (grep-verified landed) left all 8 tests
green. jsdom cannot see it, so this is a known and accepted limit rather than a defect — but
"no visual change" rests on the arithmetic above, not on the suite.

**Also checked, clean:** typecheck (`tsc --noEmit`) and `npx eslint` on both files pass;
no hex/`text-red-*`; Swedish strings; `<img>` keeps `width`/`height`/`loading="lazy"`/
`decoding="async"`, no `next/image`; no `font-mono` added; no Firestore/TMDB/route/status-model
surface touched (`markEpisodeWatched` is progress, and progress never mutates status). The
mock drops the hook's `tmdbId` parameter but EventCard consumes only `isWatched` and
`markEpisodeWatched`, so nothing gated is deleted. Accessible name is "markera sedd"/"sett"
with no per-card context, so a screen-reader user tabbing a 7-column week board hears the same
name repeatedly — but the OLD markup had `aria-label="Markera sedd"` with the same problem, so
it is pre-existing, not a regression; an `sr-only` suffix inside the button would extend the
name while keeping the visible text as a prefix (label-in-name only requires containment).

**Lessons-digest sync contract verified:** `tasks/lessons.md` has 14 `### [` headings, of
which line 9 is the deliberately-real-heading template, so 13 real lessons vs 13 bullets in
`.claude/rules/lessons-digest.md`. Both 2026-08-03 lessons have their one-liners. No drift.

Verdict: pass, 0 blocking. Findings filed: movie-card navigable surface (low), the `block`
comment (low), acceptance-#3 coverage (advisory).

### 2026-08-03 — BIN-660 re-review: the spacing compensation is the one thing jsdom CAN pin, and nothing pinned it

Re-review of the staged BIN-660 diff (`src/components/calendar/EventCard.tsx` @ `f86ad85`,
`EventCard.test.tsx` @ `d4abdb0`) after my Low findings from the previous round were applied.

**What was applied and verified correct.** The movie branch's non-interactive "vill se" footer
went back INSIDE the `<Link>` with its original `marginTop: 4` inside `.body` (so movie cards
keep the ~27px of navigable surface and `cursor: pointer` the previous round had cost them),
and `.body`'s compensating `paddingBottom: 8` is now applied only in the toggle branch via
`style={showToggle ? { paddingBottom: 8 } : undefined}`. The outer footer collapsed from a
ternary to `{showToggle && (...)}`. The `block`-on-the-square comment now says
belt-and-braces-for-a-flex-item instead of claiming it restores a box model.

**Spacing arithmetic, re-derived against globals.css (not taken on trust).**
`.ev .body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1 }`.
Flex `gap` and a child's `margin-top` ADD — they do not collapse — so at HEAD the toggle row sat
8px below the last body child (4px gap + 4px marginTop) and 12px above the card's bottom edge
(`.body`'s padding-bottom). The new shape reproduces exactly that: `.body` padding-bottom drops
to 8 (toggle branch only), `.ev` itself has no `gap`, and the sibling footer carries
`padding: 0 12px 12px`. Movie branch: `.body` style is `undefined` so padding-bottom stays 12,
and the `marginTop: 4` div is byte-identical to HEAD. Both branches hold.

**Descendant rules all still match.** Every calendar rule is a descendant combinator
(`.ev .px`, `.ev .body .ttl`, `.ev.is-tonight .meta .ch`, `.ev.is-watched .px img`), so
interposing the `<a>` between `.ev` and `.body` changes nothing. `.week-board .col-body` has no
`> a` child selector, so the root flipping from `<a>` to `<div>` is safe for the parent too.
Verified the Tailwind utilities actually generate (`npx tailwindcss -i src/app/globals.css -o …
--content EventCard.tsx`): `.focus-visible\:\[outline-offset\:-2px\]:focus-visible` is emitted
at line 3891 against globals' bare `:focus-visible { outline-offset: 2px }` at 772 — later AND
(0,2,0) vs (0,1,0), so it wins. `text-inherit` generates because the config's colors sit under
`theme.extend`. Confirmed `trailingSlash: true` in next.config.mjs, so the test's href comment
is true.

**The finding (Low, non-blocking): the compensation is unpinned.** No assertion in the nine new
tests touches inline style — they cover class lists, containment, roles, text, aria and href.
Deleting `style={showToggle ? { paddingBottom: 8 } : undefined}` leaves all nine green. That is
the single number the whole re-layout turns on, and unlike the cascade it is trivially assertable
in jsdom (`expect(container.querySelector('.body')).toHaveStyle('padding-bottom: 8px')`, plus the
movie branch asserting it is absent). My own standing note said "jsdom pins none of it" — too
broad, and it let this slot through two rounds. Bullet amended in place.

**Mutation evidence (my own, not the parent's claim).** Clean control 9/9 at `f86ad85`. Four
mutants, each with the patch asserted to have landed before the run and the file restored from a
scratchpad snapshot with the hash re-printed afterwards: re-nest the footer inside the `<Link>`
(3 tests fail), drop the root `ev`/`is-tonight`/`is-watched` classes (1), never apply `is-on` (1),
swap `isWatched(season, episode)` args (1). All four killed; each of the three newly-added
assertions is the SOLE detector of its mutant, so all three are independent, not implied.

**Two process traps hit in this run.**
1. A python heredoc built with `'''$FROM'''` shell-interpolation produced
   `t=''''card''''` → SyntaxError, the mutation never landed, and the suite printed a clean
   9/9 that I would otherwise have recorded as a surviving mutant. Exactly the
   "assert the patch landed" rule from the 2026-08-01 lesson, reached from a new direction:
   the *patch tool itself* failed, not the line endings. `grep -n` for the mutant text in the
   same command as the run is the cheap guarantee.
2. A CONCURRENT agent was mutation-testing the same file during my review. Observed four
   distinct worktree blob hashes for `EventCard.tsx` inside three minutes
   (`b95ac2c` → `dc4e860` → `c7363e0` → `f0a503f`), one of them being precisely the
   `paddingBottom: 8` removal I had just identified as uncovered. A full `src/components/calendar
   + src/lib/calendar` run reported "1 failed" and a re-run of the identical command reported
   98/98 — both worthless, because the source changed mid-run. The INDEX stayed `f86ad85`
   throughout (`git diff` header `index f86ad85..dc4e860` confirms the index side), so the bytes
   I reviewed and mutation-proved are the bytes that would commit. Reported to the parent as a
   gate hazard: `git add -A` while that sibling is running would stage a mutant.

Verdict: pass (0 blocking), 1 Low advisory (coverage of the inline spacing style, which is the
test-reviewer's gate).

### 2026-08-04 — BIN-687/688 contentFloor consolidation review + a cold-cache vitest flake
Reviewed `src/lib/seo/contentFloor.ts`, `contentFloor.test.ts`, `MoviePageClient.tsx`,
`TVShowPageClient.tsx`, and `PersonPageClient.test.tsx` (new — targets the unmodified
`PersonPageClient.tsx` as context). Change: `MIN_REAL_OVERVIEW`/`MIN_REAL_BIO` (both 60,
duplicated) plus a bare truthiness check in the two page clients collapse into one exported
`hasSubstantialText()` + `MIN_SUBSTANTIAL_TEXT`, backed by a new `oneLine()` that collapses
internal whitespace (not just outer `.trim()`) before measuring.

Findings, all non-blocking:
1. The whitespace-collapse-before-length-check direction is correct and tested: it fixes a
   real latent bug (the OLD code only `.trim()`'d, so a `<meta description>` built from an
   overview containing internal `\n\n` could ship literal newlines in the tag — new test
   "keeps a real overview on one line for the snippet" pins the fix), and it stops whitespace
   padding from counting as "substantial" content (new test "counts words, not padding").
   Only a text sitting within a few characters of the 60-char boundary AND carrying internal
   line breaks can flip pass→fail; ordinary TMDB overviews aren't whitespace-heavy enough for
   this to read as a user-visible regression.
2. Both `MoviePageClient.tsx`/`TVShowPageClient.tsx` call `hasSubstantialText(movie.overview)`/
   `hasSubstantialText(show.overview)` — the same raw field `buildContentFloor` consumes
   internally, so the two halves (visible paragraph, meta description) can no longer disagree
   for movie/TV pages. BUT: `PersonPageClient.tsx` (unchanged by this diff) still gates its
   visible bio paragraph on a bare `{biography && (...)}` truthiness check
   (`biography = svBio || wikiBio?.text || enBio`), while the person meta description
   (`buildPersonDescription` via `personDescriptionInput`, TMDB-sv only) applies the 60-char
   `hasSubstantialText` gate internally. A thin-but-nonempty TMDB sv bio (e.g. a 5-char stub)
   would still render as the page's own prose while the description silently swaps to the
   generated fallback line — the exact class of same-title disagreement BIN-688 was written to
   eliminate, just not one of the three duplicate call sites this ticket named. Out of scope
   (file untouched, and it predates BIN-688 as BIN-656/686 territory) — reported to the parent
   as "also found", not filed as blocking.
3. `MIN_SUBSTANTIAL_TEXT` export has exactly one consumer (`contentFloor.test.ts`) — grepped
   repo-wide, no drift risk.

Mechanical: `npm run typecheck` and `npx eslint` on all 5 touched/read files were clean. The
combo test run (`contentFloor.test.ts` + all 3 page-client test files) failed twice
IMMEDIATELY after `rm -rf node_modules/.vite/vitest`, each time on a DIFFERENT assertion (a
pattern the review-process principle normally reads as "foreign edit, don't dismiss") — then
passed clean across 8 further runs (5 quick + a serialized `--reporter=verbose` run), so this
was cold-cache jitter, not a real defect or a sibling agent's mutant. Folded into the
principles file: treat the run(s) right after a cache clear as its own flake class, distinct
from the "double-digit passes" bar for an ordinary flake claim.

Verdict: pass (0 blocking).

### 2026-08-06 — BIN-555/777/767/646, live concurrent mutation self-healed mid-review
Reviewed the staged diff for four hand-built tickets (panel-gated per `tasks/todo.md`):
BIN-555 (`src/lib/firebase/groups.ts` — compensating `deleteDoc` rollback of the just-created
group doc when the owner's member-doc write fails, explicitly NOT a writeBatch/transaction —
BIN-532 proved that breaks prod because `members/{uid}`'s create rule `get()`s the group doc
against pre-commit state), BIN-777 (`DeleteAccountSection.test.tsx`, new — pins the FULL
string of each of the three delete-account error messages, not a substring, because two of
the three share an identical opening clause and only "Ingenting har raderats." tells a
true-nothing-lost preflight failure apart from a post-cascade Firebase `requires-recent-login`
failure where that promise would be a lie), BIN-767 (`integritet/page.tsx` — discloses the two
`sessionStorage` keys `binge:nextAfterLogin`/`binge:tabSession`, verified against
`src/lib/nextPath.ts`/`src/lib/tabSession.ts`'s actual read/write/clear semantics), BIN-646
(`mediaTypeDocId.ts` read-side strictness: a STRING `tmdbId` field now held to the same
canonical shape as the doc id, `'042'` no longer resolves; id `0` rejected on both the doc-id
and field branches; parity test rewritten to match).

All four correct against the staged index: manually traced every branch of
`resolveTmdbId`/`parseTmdbIdFromDocId` against the new/changed test assertions, traced
`createGroup`'s try/catch (throws the ORIGINAL error even when the rollback `deleteDoc` also
fails; never a batch/transaction; `invalidateMyGroupsCache` only runs past the catch, i.e. on
success), confirmed the privacy-copy key names and lifetimes against the actual helper
modules' JSDoc, and confirmed `DeleteAccountSection.test.tsx` mocks only `useAuth`/`useToast`
(the component's other dependency, `SettingsSection`, needs no mocking). `npm run typecheck`
clean; `npx eslint` on all 6 touched/read files clean (0 errors, 4 pre-existing
`no-unused-vars` warnings in `groups.test.ts`, exactly as `tasks/todo.md` itself says).

The interesting part was mechanical, not a code defect. Mid-review, `git status` reported
`src/components/settings/DeleteAccountSection.tsx` and `src/lib/mediaTypeDocId.ts` as
unstaged-modified — NEITHER is part of the staged diff (both `git diff --cached` for them are
empty; BIN-777/646 only touch their `.test.ts` siblings), so this couldn't affect the commit,
but a `git diff` against the worktree showed exactly the two mutants those tickets' own new
tests were written to catch: `DeleteAccountSection.tsx` had swapped which branch carries
"Ingenting har raderats." (STALE_SESSION_PREFLIGHT ↔ REQUIRES_RECENT_LOGIN reversed — the
precise mutant BIN-777's own test-file header names), and `mediaTypeDocId.ts`'s
`CANONICAL_TMDB_ID` had been widened back to `/^(?:0|[1-9][0-9]*)$/` (re-admitting id 0 — the
precise mutant BIN-646's own new `it.each(['0','movie_0','tv_0'])` case exists to catch).
Running the affected suites against that live worktree state reproduced the failure for real
(`mediaTypeDocId.parity.test.ts`: 1 failed, "expected 42 to be NaN // Received 42" on exactly
the '042'-field case). This is consistent with `tasks/todo.md`'s own account — it says both
tickets were mutation-tested by flipping exactly these two things and confirming red, then
restored from a scratchpad snapshot and verified by hash — and what I was looking at was that
restore not having landed yet (or having raced a sibling process) at the moment I looked.

Snapshotted both files to scratchpad (`cp`, plus a raw `md5sum` of each), restored the correct
content via `git show :<path> > <path>`, reran the affected suites clean (`57 passed`), then
copied the scratchpad snapshots back onto the worktree files to leave things exactly as found
— and at that point `git diff` read empty and `git hash-object` on both files matched their
staged index sha exactly. The raw `md5sum` I'd taken of the "mutated" snapshot did NOT match
`git show`'s output for the same logical path, which looked like a live semantic difference at
the time, but `git hash-object` (which applies the same clean/EOL filters `git` uses to build
a blob) said otherwise once I actually compared apples to apples — a plain `cp`'d worktree
file and a `git show` redirect are not guaranteed to carry the same EOL style under
`core.autocrlf=true`, and a raw OS `md5sum` is sensitive to that where `git hash-object` is
not. Net effect: by the time I finished, both files verified byte-identical (via
`git hash-object`/`git rev-parse :<path>`, not the raw `cp` diff) to what's staged, the full
targeted suite (`mediaTypeDocId.parity.test.ts` + `mediaTypeDocId.test.ts` +
`DeleteAccountSection.test.tsx` + `groups.test.ts`, 96 tests) passed clean with the three
prod-file hashes pinned identical before and after the run, and `npm run typecheck` was clean.
Folded into the principles file: pin comparisons through `git hash-object`/`git rev-parse
:<path>`, not a raw OS `md5sum` of two differently-sourced snapshots, when `core.autocrlf` is
in play — and don't read a transient worktree mutation on an UNSTAGED file as a finding
against the staged diff, but do say so and re-verify by hash before closing the review.

Verdict: pass (0 blocking).

### 2026-08-07 — instrumentation gated on the very path it exists to exonerate (BIN-815)

Staged diff: `src/lib/tmdb/buildFetch.ts` (watchdog heartbeat), `buildFetch.test.ts` (+13
tests), `.github/workflows/deploy.yml` (cache restore/save split), `tasks/todo.md` (plan).
Index blobs pinned: 0d1d77de / 7407d4d4 / 346b16bf / 76260561; `git diff` empty; typecheck
clean; `npx vitest run src/lib/tmdb/buildFetch.test.ts` 21/21.

**Blocking finding.** `startWatchdog()` is called at `buildFetch.ts:170`, i.e. *after* the
fresh-cache fast path returns (`:153`) and after the over-budget branch (`:158`). So the
`setInterval` is created only on a cache MISS. The staged test at `buildFetch.test.ts:268`
("en cache-träff registrerar ingenting och startar ingen timer") pins that as intended.

Why that guts the ticket: `deploy.yml` runs a scheduled full refresh Monday 04:00 UTC with
`TMDB_BUILD_REFRESH_BUDGET=1000000`, and `REFRESH_AFTER_MS` is 6 days. 2026-08-03 was a
Monday and the six hanging builds were 2026-08-07, a Friday — day 4 of 6, so essentially
every `.tmdb-cache` entry was still fresh and a code deploy performs ZERO network fetches
per worker. In that regime the watchdog never starts and the next hang is exactly as silent
as the last six. Acceptance criterion 1 in `tasks/todo.md` ("a heartbeat at least every 30 s
while page collection runs, including when zero fetches are in flight") is therefore unmet
in the most likely case. The module comment makes the same claim in stronger terms — "dess
viktigaste rad är den den skriver när INGENTING är i flykt" — while the code cannot write
that line unless something was in flight first. Remedy: hoist `startWatchdog()` above the
cache-hit return; the stop condition still ticks because `networkFetches (0) < refreshBudget()
(1500)`, and the pinning test flips to "timer starts, registry stays empty".

Everything else in the focus list checked out, verified rather than assumed:
- **Watchdog can't hang the build.** Interval is `unref`'d (`:110`, asserted by a test that
  mocks `setInterval` and spies `unref`); the only other added state is a `Map` of plain
  objects. Nothing new holds the event loop.
- **Transport.** `next/dist/lib/worker.js:157-158` pipes each static worker's stdout AND
  stderr into the parent's — so `process.stderr.write` survives to the Actions log. Worker
  output additionally drives `abortActivityStreamOnLog` → `_onActivityAbort`, which
  `export/index.js:597` sets to `progress.clear`, so the line isn't overwritten by the
  progress renderer. It does NOT touch `onActivityImpl`, which is driven by an explicit IPC
  `{type:'activity'}` message (`worker.js:132-136`) and is what resets Next's own
  hanging-worker SIGTERM timer — so the heartbeat cannot mask Next's restart path.
- **Bookkeeping.** `finally { inFlight.delete(token) }` covers resolve, throw and abort;
  the token is a monotonic int so no key collision. No false-STUCK risk from queueing
  either: `client.ts:56`'s semaphore is abort-aware (BIN-291), so a queued fetch rejects at
  its own 20 s ceiling well before `STUCK_AFTER_MS` (30 s).
- **Log volume.** jest-worker gives one task per worker process at a time, so `inFlight`
  holds ~1-3 entries; worst case is ~1+3 lines per 30 s tick × 3 workers ≈ 4k lines over a
  175-min run. Bounded.
- **Budget untouched.** `networkFetches`, `refreshBudget()`, `DEFAULT_REFRESH_BUDGET = 1500`
  and the cache-hit fast path are byte-identical to HEAD; the diff only appends after
  `networkFetches++`. `refreshBudget()` is now read twice per tick — env read, no semantics.

**Non-blocking, deploy.yml.** The save key is `tmdb-cache-${{ github.run_id }}` (`:186`),
matching the restore primary key. But `run_id` is INVARIANT across "Re-run failed jobs" /
"Re-run all jobs" — only `run_attempt` increments. So on the retry path this step exists to
improve, the reserve collides with the cache attempt 1 already wrote, `actions/cache/save`
swallows the `ReserveCacheError` as an info line, and the retry's warmer cache is discarded.
Fix: `-${{ github.run_attempt }}` on the restore key + `key: ${{ steps.tmdb-cache.outputs.
cache-primary-key }}` on the save, which also gives the currently-unused `id: tmdb-cache` a
purpose. Restore-keys prefix `tmdb-cache-` keeps resolving to the newest entry either way.
Secondary nit: `if: always()` fires even when lint/typecheck/test failed before the restore
step ever ran, so `.tmdb-cache` doesn't exist and the step logs a path-validation warning on
every red push — cosmetic, `continue-on-error: true` is correct and cannot fail the deploy.

Also noted, out of scope: only per-id detail fetches are registered. The list fetches that
use `buildSignal()` directly (`generateStaticParams`' `collectIds`, `discoverMovies`/
`discoverTV` on `provider/[id]`, `getTrending` on `page.tsx`, `collectPersonIds`) are
invisible to the watchdog, so a hang there stays unnamed.

Retry/concurrency were NOT flagged — a decided exclusion (critique #3 found the ticket's
point 2 false at HEAD: `buildSignal()` already applies a 20 s `AbortSignal.timeout`).

Folded into the principles file: build instrumentation must be proven to emit in the regime
the incident actually ran in, and the worker→Actions log transport is verifiable in
`next/dist/lib/worker.js` rather than assumable.

Verdict: fail (1 blocking).

### 2026-08-07 — BIN-815 round 2: a fan-out deadline is eaten by the semaphore queue, and the watchdog still misses 2 of 3 routes in the hanging phase

Round 1 failed on "`startWatchdog()` ran only on a cache miss". Round 2 hoisted it, removed the
stop-on-budget rule, added `trackBuildCall`/`startBuildWatchdog`, and — new since round 1 —
routed `sitemap.ts`'s `collectIds` and `seoPersonIds.collectPersonIds` through `trackBuildCall`
AND gave them `buildSignal()`, which they previously lacked entirely. Two blocking findings.

**1. `buildSignal()` at fan-out time deletes the sitemap's person URLs.**
`AbortSignal.timeout(20_000)` starts counting at CREATION. `pages.map(p => trackBuildCall(l, () =>
f(p, { signal: buildSignal() })))` creates every signal in one synchronous burst (an async fn body
runs synchronously to its first `await`, so `run()` is invoked immediately). `client.ts` caps
concurrency at 8, and `semaphore.ts`'s `acquire(signal)` rejects a QUEUED waiter the instant its
signal fires — the call never issues a request at all. So only ~`20s / latency × 8` of an N-item
fan-out dispatches; `Promise.allSettled` swallows the rest and the build stays green.

Measured on the real `createSemaphore` scaled 100× down (210 items, 8 slots, 20 ms latency,
200 ms deadline): **64 dispatched, 146 aborted while queued**.

In `sitemap()` the enqueue order is fixed and fatal: `Promise.all([titleEntries(), personEntries()])`
evaluates left to right, `titleEntries` synchronously enqueues 4×500 = 2000 title-list calls, and
only then does `collectPersonIds` enqueue its 100 `persons:popular` pages — behind all 2000, with a
clock already running. 2000 calls cannot clear 8 slots in 20 s unless each averages <80 ms. So
`collectPersonIds` returns `[]`, `personEntries()` returns `[]` (a rejection is caught and logged as
a warning, build green), and the sitemap ships ZERO `/person/{id}/` URLs while `person/[id]`
pre-renders ~1000 of them. A large share of `/tv/` and top-rated title URLs go the same way.

Direction matters: sitemap ⊂ pre-render is the quiet failure (lost coverage, no soft-404s);
sitemap ⊃ pre-render is the "Crawled – not indexed" one. `cappedTitleIds`' cap is 15000 against
~10-12k unique ids, so it is NOT binding and titles only shrink. `SEO_PERSON_TARGET_IDS` = 1000 IS
binding, and the pipeline's documented order contract means the cap is filled from the earliest
movies — so both sides agree as long as each keeps an early PREFIX, and diverge the moment one
loses it. Remedy: create the signal at dispatch (after the slot is acquired) or bound the fan-out
yourself; the pre-existing same-shape usage in `movie|tv|person/[id]` generateStaticParams (1000-2100
calls each, own worker) is on the same edge and is why the pre-render coverage is already fragile.

**2. The watchdog still cannot fire in the phase that hangs, for 2 of the 3 routes that fetch there.**
Verified against `next/dist/build/utils.js`: `Collecting page data` calls `isPageStatic` →
`buildAppStaticPaths` ONLY when `route.dynamicSegments.length > 0`. `/sitemap.xml` has no dynamic
segment, so `sitemap()` — where `startBuildWatchdog()` was placed — runs in the LATER
"Generating static pages" phase. The routes that actually execute in `Collecting page data` are
`movie/[id]`, `tv/[id]` (1000 list calls each, via their OWN inlined copies of `collectIds`, which
no shared helper touches and which the diff never edits) and `person/[id]` (registered, via
`collectPersonIds`). Each worker is a separate PROCESS, so a hang in the movie or tv worker prints
nothing at all — or, worse, coexists with a healthy `inflight=0` pulse from the person worker, which
is exactly the false "the fault is not in the TMDB layer" conclusion the module comment claims the
watchdog earns. `tasks/todo.md` ticks that criterion `[x]` and asserts "that phase does not call
`fetchForBuild` once" — true, and it is also the phase the fix does not cover.

**Non-blocking:** `startedAt` is registration time, not dispatch time, so `STUCK` labels queue time
and its stated justification ("longer than its own abort cap → not a slow request") is false for
tracked calls; once finding 1 is fixed the STUCK loop prints one line per queued entry per tick
(~2000 lines/30 s). The pulse prints `done=${networkFetches}` and `budget=${networkFetches}/…` — the
same number twice, and it counts only `fetchForBuild`, so it reads 0 through the whole list phase.
`timeout-minutes` in `deploy.yml` is on the Build STEP, so a hang-kill fails the step and the
`if: always()` save DOES run — the workflow's "unverified" caveat is more pessimistic than the file.

**Process:** a sibling agent mutation-tested `buildFetch.ts` during the review. The tell was an
output the staged source cannot produce — one template literal printing `done=1 budget=0/0` from two
reads of the same variable — and two distinct mutants landed inside one 4-second suite run. Ran the
staged blobs in an isolated `git write-tree`/`commit-tree`/`worktree add` checkout: 45 tests pass,
typecheck and eslint clean on the index bytes.

Folded into the principles file: a per-call deadline must start at DISPATCH, not creation, when a
semaphore stands between; and an instrumentation coverage claim is per-PHASE and per-PROCESS —
enumerate the phase from Next's own source, not from the file you edited.

Verdict: fail (2 blocking).

### 2026-08-07 — BIN-815 round 3: the revert verified, and four ways an instrument can lie in its own comments

Round 3 of the build-hang watchdog. Round 2 failed on two blocking findings; both were fixed by
reverting rather than patching. Staged set: `deploy.yml`, `movie/[id]/page.tsx`,
`tv/[id]/page.tsx`, `buildFetch.ts`, `buildFetch.test.ts`, new `src/app/titleParams.watchdog.test.ts`,
`tasks/todo.md`.

**Verified, not trusted.** `src/app/sitemap.ts` (`c9987f6`) and `src/lib/tmdb/seoPersonIds.ts`
(`634c5ca`) are byte-identical to HEAD in BOTH index and worktree; `git diff --cached HEAD --` on
both is empty. Round 2's regression is fully gone, and no removed export was left dangling
(`grep trackBuildCall|startBuildWatchdog` finds only the two routes plus tests).

**Phase, from Next's own source rather than the diff's claim.** `next/dist/build/index.js:1103`
opens the `Collecting page data using N workers` spinner and `:1306` calls
`staticWorker.isPageStatic`; `next/dist/build/utils.js:683` calls `buildAppStaticPaths` only when
`route.dynamicSegments.length > 0`. So `movie/[id]`/`tv/[id]` `generateStaticParams` really do run
in the hanging phase and `sitemap.ts` really does not. Transport re-confirmed on this Next version:
`next/dist/lib/worker.js:157-158` pipes worker stdout/stderr to the parent, and only an IPC message
with `type === 'activity'` resets `hangingTimer` — a stderr heartbeat reaches the Actions log and
cannot mask Next's SIGTERM restart.

**Mutation results** (isolated worktree from `git write-tree` d2005d1, blob shas verified == index,
mutant asserted present before AND after each run; clean control 33/33):
- strip `trackBuildCall` in `movie/[id]` → exactly the 3 movie tests fail, tv untouched. KILLED.
- same in `tv/[id]` → exactly the 3 tv tests fail. KILLED.
- remove `startBuildWatchdog();` from `movie/[id]` → **6/6 SURVIVE.** The 1000 `trackBuildCall`s are
  created in one synchronous burst inside `pages.map`, and the first one starts the timer, so the
  route-level call cannot make a difference. The plan's `[x] … removing either route's wiring fails
  3 tests. [mutation-verified]` and the test header's "if either route stops starting the watchdog …
  the heartbeat reports inflight=0" are false for that conjunct — not merely untested, untrue.
- remove `.slice(0, STUCK_REPORT_LIMIT)` → 2 tests fail. KILLED.
- flip `.sort((a,b) => a.startedAt - b.startedAt)` to newest-first → **33/33 SURVIVE.** The ordering
  is the cap's entire justification ("Rapportera de äldsta") and nothing pins it.

**The queue-backlog premise is backwards.** `buildSignal()` is created inside `pages.map`'s arrow,
i.e. in the same synchronous burst, and `src/lib/tmdb/semaphore.ts:45-51` rejects a queued waiter the
instant the signal fires, with `trackBuildCall`'s `finally` deregistering it. Every `params:*` entry
therefore leaves `inFlight` by ~20s, below `STUCK_AFTER_MS` (30s). A merely-queued call can never be
reported STUCK — so a STUCK line means "this outlived its own 20s abort", the single highest-value
line the instrument can emit, and `buildFetch.ts:115-118` plus the `… och N till (inkl. köade)`
suffix tell the next investigator to read it as queue noise.

**Third `collectIds` copy.** Leaving `sitemap.ts` uninstrumented is defensible for the observed
incident but the stated reason ("only those two run in the phase that hangs") does not cover the
watchdog's own lifetime: the timer never stops and `fetchForBuild` restarts it during
`Generating static pages`, where the sitemap's ~4000 list calls run — the only build-time TMDB calls
in the tree with no abort signal at all (the plan concedes this at line 71). A hang there prints
`inflight=0`: the exact false conclusion the block comment warns about. Remedy is separable from
round 2's regression — wrap those fetches in `trackBuildCall` ONLY, never re-add `buildSignal()`.
Do not extract the shared helper now.

**deploy.yml.** `actions/cache/restore` + explicit `actions/cache/save` with
`if: always() && steps.build.conclusion != 'skipped'`, keyed `run_id`-`run_attempt`: correct, and
`run_attempt` matters because `github.run_id` is unchanged across "Re-run jobs". But the
`OBEKRÄFTAT` hedge is about the wrong mechanism (the new save is a normal step, not a post-step)
and contradicts its own evidence: `actions/cache@v4` declares `post-if: success()`, which is why
`Post Restore … = skipped` appeared — and that log line proves the runner kept processing steps,
i.e. the job was not cancelled. Parsing the YAML confirms no job-level `timeout-minutes`, so the
45-minute STEP timeout fails only that step and the `always()` save does run. Also found: the
`.next/cache` step still uses merged `actions/cache@v4` and loses its save the same way.

**Tree hazard.** A sibling agent was mutation-testing the same files mid-review: my movie-route
mutant failed the tv route's 3 tests, which that mutant structurally cannot reach, and `git status`
showed `MM` on `tv/[id]/page.tsx` carrying a `/*MUT*/` in place of `startBuildWatchdog();` that this
session never wrote. Restored via `git checkout -- <path>` (index, not HEAD, because the file is
staged) and all verification redone in the isolated worktree. Separately: `git hash-object` on a
scratchpad copy skips the autocrlf clean filter, so a snapshot's sha never matches the index sha —
compare in-repo paths only. HEAD moved to `914a4e2` mid-review and touched `tasks/todo.md`; the
staged todo.md is a clean 105-line prepend over the new HEAD, no deletions, so it reverts nothing.

**Residual doc rot from round 2**, all in the same commit: `trackBuildCall`'s JSDoc still says
"list- och sitemap-hämtarna i generateStaticParams" (contradicts the block comment 80 lines above,
and `sitemap.ts` has no `generateStaticParams`); `buildFetch.test.ts:290` uses the label
`sitemap:popular-movies/p3` and `:316` says "Sitemap-fasen"; `tasks/todo.md:33-34`'s sample output
still shows round-2's `done=418 budget=418/1500` and a `sitemap:` STUCK label — the exact two things
round 3 changed. BIN-815's own sprint criteria ("root cause identified", "a hang now fails within a
bounded time") are NOT met by this commit; the plan says so, and the ticket must not go Done on this
sha.

Full suite in the isolated worktree: 2657/2658 — the one failure is `design/consistency.test.ts`
timing out at 5000ms on a recursive FS walk over the temp path, passing 10/10 in ~2.3s in the main
checkout. `npx tsc --noEmit` and `npx eslint` clean on all five source files.

Folded into the principles file: mutate each conjunct of an "A and B; removing either fails N tests"
criterion separately, and correct the claim when a conjunct is unreachable-as-a-difference; a
phase-scoped inference needs a phase marker in the emitted line, and registering a call is separable
from giving it a signal; a STUCK threshold above the call's own abort deadline can never fire on
queue backlog; the three verified `deploy.yml` failure semantics (step timeout, `post-if: success()`,
`run_attempt`); and the sibling-mutation tell — a mutant killing tests for a case it cannot reach.

Verdict: pass (0 blocking).

### 2026-08-08 — BIN-815 r4: an AGGREGATE registration falsifies a per-call "stuck" threshold

Round 4 added the integration reviewer's blocker: `src/app/person/[id]/page.tsx`'s
`generateStaticParams` now calls `startBuildWatchdog()` and wraps the whole
`collectPersonIds({ signal: buildSignal })` pipeline in ONE
`trackBuildCall('params:person-ids', …)`. The registration itself is right — the route is
the biggest caller in `Collecting page data` (100 list pages + up to 2000 `getMovie`
details, `SEO_PERSON_SOURCE_MOVIE_PAGES=100`, `SEO_PERSON_CAST_PER_MOVIE=10`) and was the
one unregistered network caller in the hanging phase, so `inflight=0` was reachable through
the phase's longest network work.

But `buildFetch.ts`'s STUCK comment — rewritten in round 3 to say a STUCK line means the
call outlived its OWN 20 s abort deadline, and that a merely-queued waiter is rejected at
20 s and never reaches the report — is now false for exactly one of the three registered
call sites. `params:person-ids` is an aggregate with no 20 s ceiling: its inner fetches each
carry `buildSignal()`, but the wrapper lives until `Promise.allSettled` over ~2100 of them
resolves, ~20-45 s depending on where the burst-created signals land relative to the 8-slot
semaphore. `STUCK_AFTER_MS` is 30 s, so a HEALTHY build will routinely print
`STUCK 3Xs  params:person-ids` — the recurring false positive that teaches the next
investigator to dismiss the highest-value line the instrument emits. Same class as round
3's `(inkl. köade)` finding, arriving from the other direction: there the justification was
wrong, here the code generates the noise. Fix is one sentence (exempt aggregate labels) or
per-page registration inside `collectPersonIds`.

Verified correct in r4: placement before the `try`; `collectPersonIds` unchanged;
`buildSignal` still passed as the FACTORY, not called; `trackBuildCall` returns the value
untouched and rethrows, so the existing catch → `SEO_FALLBACK_PERSON_IDS` path is
behaviour-identical; and the signal-creation burst is unchanged, because `trackBuildCall`
invokes `run()` synchronously before its first await.

Mutation (my own, isolated): dropping the person route's `trackBuildCall` kills exactly its
2 tests and leaves the 8 movie/tv tests green — the r3 criterion holds for the new route.

Two stale sibling claims survived the round-4 edit:
- `titleParams.watchdog.test.ts:1-10` still says "the two biggest callers … are movie/[id]
  and tv/[id]" and "if EITHER route", while line 57-60 of the same file (and the person
  page's own comment) call person/[id] the biggest. A file header contradicted by its body.
- `tasks/todo.md` §C still specifies `if: always() && steps.build.conclusion != 'skipped'`
  (shipped: `steps.tmdb-cache.outputs.cache-primary-key != ''`) and still calls the save a
  "post-step" whose timeout survival "is unverified and is stated as such in the workflow
  comment" — deploy.yml now states the opposite. The acceptance tick keyed on that sentence
  is UNMET as written.

deploy.yml guard verified in all three paths: `actions/cache/restore@v4` sets
`cache-primary-key` through `NullStateProvider.setState` BEFORE the restore attempt, so a
cache MISS still sets it; a never-reached step has an EMPTY conclusion (no entry in the
`steps` context), so the output check is the right precondition and the old
`!= 'skipped'` check would have been vacuous; on job cancel `always()` still runs and
`continue-on-error: true` absorbs a save failure (incl. the path-does-not-exist error when
the build died before writing `.tmdb-cache`). No job-level `timeout-minutes` exists on
`jobs.deploy`, so the step-timeout reasoning in the comment holds.

Sibling churn, again: mid-review `git status` flipped `src/lib/tmdb/buildFetch.ts` to `MM` —
a concurrent agent had written `.sort(() => 0) /*MUTANT-R2*/` over the oldest-first
comparator (worktree 94515e9 vs index f28942e). I did NOT restore it (that is the
"reverted mid-run" false negative). Two notes: the INDEX is clean and is what I reviewed,
but a `git add -A` before their restore would stage the mutant; and `.sort(() => 0)` is
order-PRESERVING over an insertion-ordered `Map` under V8's stable sort, so its survival
proves nothing about the sort — only a reversed comparator does.

### 2026-08-08 — BIN-815 r5 (post-commit confirmation of 757e5e2): an opt-in flag pinned at the helper, unpinned at its only call site

Malin applied two reviewers' shared non-blocking finding AFTER round 4 passed and committed
as `757e5e2`, then asked whether the post-review edits broke anything. Ledger-pinned round-4
shas gave the exact delta (the briefed delta was accurate this time — `git diff <r4-sha>
<HEAD-sha>` per path confirmed it, and `deploy.yml` f0efe2e2 / `movie|tv/[id]` 3d5a74b7,
26c3fdc4 were unchanged, so round 4's verdict still covers them).

Delta: `trackBuildCall(label, run, {aggregate?})`; `InFlight.aggregate: boolean`;
`AGGREGATE_STUCK_AFTER_MS = 4*60_000` chosen by `f.aggregate ? … : STUCK_AFTER_MS`;
`person/[id]` passes `{aggregate:true}`; ordering fixture relabelled `call-g`(oldest) →
`call-a`(youngest); two new tests; comment/doc corrections.

Mutations I ran myself (clean tree at HEAD, `cp` snapshot to scratchpad, `cp` restore,
`git hash-object` verified 66a03f31/09bd7baa after; `rm -rf node_modules/.vite/vitest`
before each; mutant asserted present before AND after each run):
- one-tick-then-die (`stopWatchdog()` at the end of the tick) → **6** tests fail, not the
  5 `tasks/todo.md` claims. The 6th is `pulsen redovisar budgetläget och äldsta i flykt`
  (it takes the LAST pulse at t=60 s and asserts `oldest=60s`). Under-claim, harmless.
- `(f.aggregate ? AGG : STUCK)` → `STUCK_AFTER_MS` → exactly 1 kill (the new aggregate
  test). → `AGGREGATE_STUCK_AFTER_MS` → 11 kills across both suites. Both directions pinned.
- `.sort((a,b) => a.label.localeCompare(b.label))` → 1 kill. The relabelled fixture works;
  under the old `call-1…call-7` fixture it would have survived, as the test reviewer said.
- **Deleting `{ aggregate: true }` from `person/[id]/page.tsx` → 2665/2665 GREEN.** The
  helper branch is pinned; the single call site that uses it is not. `todo.md`'s
  `[x] … a healthy build never prints STUCK for it [mutation-verified]` therefore
  over-claims: the criterion is phrased about the BUILD, and the build-level link is
  unverified. 5-line fix: in `titleParams.watchdog.test.ts`, advance the person route 90 s
  and assert no `STUCK` line (the ROUTES entry already carries `stuckAfterMs`).

Comment truth-check (Malin asked explicitly; I failed an earlier round on false coverage
claims, so every checkable claim was re-derived):
- "Övriga generateStaticParams (provider, genre, billigaste, forsvinner och catch-all
  [...path]) är statiska listor" — TRUE and COMPLETE: exactly 8 `generateStaticParams` in
  `src/app`, 3 async/network (movie, tv, person), 5 sync array returns. "The other five" in
  the test header is arithmetically right.
- "INTE instrumenterad: … sitemap.ts + app/page.tsx, discover, films, series, provider/[id],
  genre/[slug]" — TRUE and complete. Server components importing `@/lib/tmdb`: those seven
  plus `billigaste/[slug]`, which fetches through `fetchForBuild` and IS instrumented, so
  its absence from the list is correct, not an omission. `forsvinner/[id]` imports only
  `providers`/`seoCoverage` and never fetches. provider/genre belong in the LATER-phase list
  because it is their page bodies, not their static-list `generateStaticParams`, that fetch.
- "collectIds finns i tre nästan identiska kopior" — TRUE (movie/[id], tv/[id], sitemap.ts).
- "byggstegets tidsgräns" (was "jobbets") — TRUE: `timeout-minutes` sits on the Build step,
  `jobs.deploy` has no `timeout-minutes`. But `titleParams.watchdog.test.ts:1` STILL says
  "always to the job timeout" — the correction round edited that file and missed the same
  phrase in it. Classic "fix the flagged line, sweep the whole file".
- "~2100 anrop", "1000 list-anrop" per title route — TRUE
  (SEO_PERSON_SOURCE_MOVIE_PAGES=100 + ≤2000 details; SEO_TITLE_PAGES=500 +
  SEO_TOP_RATED_PAGES=500).
- "~40 s är normalt och friskt" — TRUE, and the REASON matters: `collectPersonIds` builds
  all N fetches in one synchronous burst with `AbortSignal.timeout(20_000)` created per
  call at creation time (pre-existing, NOT introduced by this commit), so phase 2
  self-terminates at ~20 s with most calls aborted while queued. So 4 min is far above
  healthy and far below the 45/175-min step cap. Residual worth knowing: if signal-at-
  dispatch is ever fixed, healthy wall time becomes ceil(2100/8)×latency ≈ 80–130 s — still
  under 4 min, but the margin shrinks.

Design answer for the record: the opt-in boolean works and is cheap, but per-call
registration inside `collectPersonIds` is the stronger shape — no flag for the next caller
to forget, every entry keeps the same 20 s semantics, and `inflight` reports the real fetch
count instead of `1` while ~2000 run. The stated objection (sitemap.ts also calls
collectPersonIds and the later phase is deliberately uninstrumented) is not a blocker:
registration is a Map set/delete, behaviour-neutral, and instrumenting more can only improve
the `inflight=0` inference. A label-derived threshold would be the worst option (silent
string drift). Also: the aggregate entry feeds the heartbeat's `oldest=`, so a healthy
person build prints `oldest=40s` with no STUCK line — a reader applying "STUCK means older
than 30 s" sees an apparent contradiction.

Verdict: pass, 0 blocking. Full suite 2665 passed / 2 skipped, `tsc --noEmit` clean,
`npx eslint` clean on the four changed source files, `git status --porcelain` empty.

### 2026-08-08 — a comment-only "document the unvalidated write side" landed the leading-zero case BACKWARDS (BIN-646/795)

Staged diff, three files: `src/app/integritet/page.tsx` (privacy §8 + `lastUpdated`),
`src/lib/mediaTypeDocId.ts` (JSDoc only), `src/lib/watchlistWrites.test.ts` (one test
deleted). Index shas pinned: ac1d965 / d824f0c / a8fb261. Two blind critiques carried
binding acceptance criteria; both were verified line by line.

**Blocking 1 — `src/lib/mediaTypeDocId.ts:44-48`.** The new note says a leading zero
"writes `movie_042`, which no reader resolves back … now reachable only from the write
side". The binding criterion (DBA #27) required the opposite for exactly this case: a
non-canonical id either gets rejected OR — with a leading zero — *silently resolves to a
DIFFERENT document*. Three independent disproofs of the shipped absolute:
- `functions/src/shared/mediaTypeDocId.ts:60` is `/^[0-9]+$/` (permissive, BIN-624 open) →
  `parseTmdbIdFromDocId('movie_042') === 42`.
- Those server readers read the CLIENT-written watchlist collection through `resolveTmdbId`:
  `availableNotify/index.ts:82`, `insights/rollup.ts:65`, `priceDropNotify/index.ts:59`,
  `streamingOffers/index.ts:58,97`, `weeklyDigest/index.ts:55`, `shared/followedSeries.ts:42`.
- Client-side too: `src/lib/watchlist/buildAddPayload.ts:17,36,89` puts `tmdbId` in
  `AlwaysWritten`, so every watchlist doc carries the numeric field and
  `resolveTmdbId(42,'movie_042')` returns 42 through the FIELD branch
  (`mediaTypeDocId.ts:152-153`) at `diary.ts:35`, `useGroupMemberProgress.ts:47`,
  `groups.ts:808`. The doc-id gate is bypassed entirely.
The new text also contradicts the SAME file 90 lines down (`mediaTypeDocId.ts:141-143`:
"`resolveTmdbId(null,'movie_042')` is NaN here and 42 on the server") and the server
header at `functions/src/shared/mediaTypeDocId.ts:94-96`. Classic comment-vs-code
self-contradiction, and the one half of the criterion the ticket spelled out verbatim.

**Blocking 2 — `src/app/integritet/page.tsx:184`.** "sparar om du valt ljust eller mörkt
läge" omits the third stored value. `ThemeContext.tsx:14` `ThemeMode = 'system'|'light'|'dark'`,
`DisplaySection.tsx:8,37` renders System/Ljust/Mörkt, and `ThemeContext.tsx:68` `setMode`
persists whichever was picked — so a "System" user has `binge:theme='system'` stored while
the policy describes only two values. A privacy bullet is DATA: check the disclosed value
set against the TS union that writes it.

**Non-blocking — exhaustiveness by format (criterion #4).** The bullet copies the shape of
`page.tsx:152` (`Funktionella cookies … (__cf_bm, __cflb)`), which enumerates its complete
key set, so "Webbläsarens `localStorage` (`binge:theme`)" reads as the full inventory
without ever saying so. At least seven other keys exist: `binge:wasLoggedIn`
(`layout.tsx:123`, `AuthContext.tsx:469`), the React Query persist cache
(`Providers.tsx:37` + `queryClient.ts`), `binge:fcm:tokenId:{uid}` (`messaging.ts:94`), the
plaintext group-invite link (`groupInviteCache.ts:18`), Tillsammans participant ids
(`useSession.ts:66,69`), rec-row rotation (`RecRow.tsx:74`), the publicProfile signature
(`publicProfile.ts:135`). Letter met, purpose at risk; "— bl.a. ditt temaval" closes it.

**Criteria that DID hold.** New `<li>` is a sibling of the sessionStorage bullet (nested
`<ul>` closes at 180, `</li>` at 181, new bullet 182-188), so "Tre värden … försvinner när
du stänger fliken" stays true. No §3 change, no checkbox, no banner. Editorial call is
coherently implemented: `version="1.2"` untouched, `lastUpdated` re-stamped, and
`LegalPageShell` renders both as display-only text — nothing keys an in-app notice off
them (`CURRENT_TERMS_VERSION` in `src/lib/legal.ts` is the separate terms mechanism).
`mediaTypeDocId()`'s body is byte-unchanged (no throw, no dev warning) and the "~90 call
sites" figure checks out at 85 non-test call sites; `a4a1470` exists and is the commit the
note attributes the decision to. `functions/src/shared/mediaTypeDocId.ts` untouched;
`mediaTypeDocId.parity.test.ts` untouched and green. The fourth `planQuickRateWrite` case
is deleted outright, cases 1-3 intact at 241-258.

**Tree hazard seen live.** One `git diff` mid-review showed `src/lib/watchlistWrites.test.ts`
with the staged deletion re-added in the worktree (`index a8fb261..3db947c`, i.e. worktree
== HEAD); the very next command read clean with `git hash-object == git rev-parse :path ==
a8fb261` and `git status` `M `. Settled with one atomic command —
`grep -c 'three distinct verdicts'` (0) → vitest (89 passed) → `grep -c` again (0) →
`git status --porcelain` — rather than reasoning about the anomaly. Suites run: parity +
watchlistWrites + together/matching = 124 passed; parity + watchlistWrites = 89 passed.

Verdict: fail, 2 blocking.

Housekeeping: the principles file was already ~44.8k (well over its stated 30k budget)
before this entry. The two new principles (~1.6k) were paid for with ~1.3k of compression
across the BIN-815 build-instrumentation, deploy.yml, isolated-worktree and hash-compare
bullets; net +1.1k. It needs a real consolidation pass, not another shave.

### 2026-08-08 — a legal-doc category bullet's PROPERTY claim inherits the same way its count does (BIN-795 re-review)

BIN-795's fix round added a `localStorage` bullet to `src/app/integritet/page.tsx` beside the
existing "Tre värden i webbläsarens sessionStorage" one. It met all four of Legal/GDPR #5's
conditions — sibling `<li>` outside the sessionStorage sub-list (page.tsx:182 vs :154), no
consent checkbox / no §3 change, `lastUpdated` re-stamped 2026-08-08 with `version` left at
"1.2", and an explicit "listan är inte fullständig, och vi utökar den efter hand" so it is not
phrased as exhaustive. The `binge:theme` value set is now complete too (`ljust / mörkt / följa
datorns egen inställning` vs `ThemeMode = 'system' | 'light' | 'dark'`, ThemeContext.tsx:14).

But the bullet copied the sessionStorage bullet's two promises verbatim — "Ingen tredje part har
åtkomst till dem, och de lämnar aldrig din enhet" — onto a category the same sentence group
declares incomplete. For the sessionStorage bullet those promises are safe: the list is CLOSED
(three keys, all local-only — a path, a path, a timestamp; still exactly three writers at HEAD:
nextPath.ts:141, tabSession.ts:50, reports.ts:74). For localStorage the undisclosed half breaks
the second promise:
- `binge-session-pid-{sessionId}` / `binge-my-sessions` (useSession.ts:66,69) — the participant
  id is `params.hostUid ?? generateSecureToken()` (sessions.ts:52), i.e. generated ON the device,
  then written to `sessions/{id}/participants/{pid}` and used as the key inside `swipes.votes`.
- `binge:fcm:tokenId:{uid}` (messaging.ts:94) — `doc(tokensCol)` mints the id client-side and
  `setDoc` uploads it to `users/{uid}/fcmTokens`.
Both values demonstrably leave the device and sit in Binge's own database. Same class as BIN-767
("it counted two; the app writes three") running one level up: not a wrong COUNT but a wrong
PROPERTY, asserted over members the document admits it hasn't listed. Remedy is one clause —
scope the promises to the enumerated value ("Värdet nedan … lämnar aldrig din enhet"), which
keeps condition (4) intact. Enumerating the rest stays BIN-817's scope.

Same round, non-blocking: `src/lib/mediaTypeDocId.ts`'s rewritten `mediaTypeDocId` JSDoc fixed
the two false claims from round 1 (it now says the permissive server copy plus the client's own
FIELD branch still re-key `movie_042` onto 42 — pinned by mediaTypeDocId.parity.test.ts:128) but
kept one loose absolute: "a non-canonical string writes a doc this half of the pair can no longer
address", which is true of the doc-id branch only and is corrected by the same paragraph three
sentences later. And "(Malin's call, a4a1470)" over-attributes: a4a1470's message does record the
decision and the "~90 call sites" figure (97 non-test occurrences of `mediaTypeDocId(` at HEAD),
but it grounds the scoping in the reviewer gap and the panel's conditions, not in a founder
ruling. Server twin + parity test byte-identical to HEAD (index==head), 124 tests green,
typecheck clean, `watchlistWrites.test.ts`'s fourth planQuickRateWrite case deleted outright as
#27 DBA required.

### 2026-08-08 — BIN-795/646 round 3: the "no client read path resolves movie_042" absolute is TRUE once it carries its writer premise

Round 3 of the same three-file staged diff (`src/app/integritet/page.tsx`,
`src/lib/mediaTypeDocId.ts`, `src/lib/watchlistWrites.test.ts`; index == worktree on all three,
5236a5a / c632f30 / a8fb261, unchanged before and after the review). Verdict: pass, 0 blocking.
Rounds 1 and 2 both failed on the SAME paragraph, each time on a different concrete claim —
the BIN-641 "swapping in a new example never converges" shape. Round 3's text finally converges
because it stops asserting a bare absolute and states the PREMISE that makes it true.

The claim under review: "'042' writes `movie_042`, which no client read path resolves — the
doc-id branch rejects the alias, and the field branch rejects it too, because every writer feeds
the id and the stored `tmdbId` from the SAME value, so an aliased doc carries the string '042'".
My own principle (written after round 1) said to flag exactly this, because
`mediaTypeDocId.parity.test.ts:127-130` pins `client.resolveTmdbId(42, 'movie_042') === 42` — the
field branch DOES still resolve an alias when the field is NUMERIC. Verified instead of
reflex-flagging, and the principle was too compressed:

* BIN-646 made the client hold a STRING field to `CANONICAL_TMDB_ID`, so `'042'` → NaN
  (`mediaTypeDocId.ts:158-160`, parity test 122-125). Only a numeric field escapes.
* A numeric `42` on a `movie_042` doc requires a writer that derives the doc id and the field
  from DIFFERENT values. There is none. `WatchlistContext.addItem` (:634) keys on `item.tmdbId`
  and `buildWatchlistAddPayload` (:89) writes `tmdbId: input.tmdbId` — the same object;
  `groups.addToGroupWatchlist` (:523-524) uses `params.tmdbId` twice; `NotInterestedContext.add`
  and `useEpisodeProgress.mark*` likewise; `sessions.recordSwipe` writes no `tmdbId` field at
  all. No Cloud Function creates watchlist docs (`functions/src` only READS them — weeklyDigest,
  availableNotify, insights.rollup call `resolveTmdbId`). And `git grep "split('_')|indexOf('_')"`
  across `src/` returns exactly one hit: the helper itself. So no client read path resolves an
  aliased doc that the app itself could have written.
* Later merge-writes can't flip it either: every merge path re-derives the doc id from a numeric
  `tmdbId`, so it lands on `movie_42`, not on the aliased doc. The notes-migration batch
  (`WatchlistContext:518-527`) and `updateNotes` (:913-939) reuse an existing `docId` but write
  no `tmdbId` field.

Also verified this round: `a4a1470`'s message does record the no-throw decision AND the "~90 call
sites" figure (99 non-test occurrences of `mediaTypeDocId(` at HEAD), so round 2's re-attribution
to "(decision recorded at a4a1470)" is now accurate — the round-1 finding about "(Malin's call)"
is discharged. `shadows the genuine one` checks out: `insights/rollup.helpers.ts:57-71` keys
`byId` on `mediaTypeDocId(mediaType, it.tmdbId)`, so two docs both resolving to 42 fold into one
row; `availableNotify`'s `skipKey` does the same per user.

Privacy page: BIN-795's four criteria all met. The localStorage `<li>` is a sibling of the
sessionStorage `<li>` in the outer `<ul>` (page.tsx:182-195), not inside its sub-list; §3
untouched; `lastUpdated` 2026-08-08 with `version` still 1.2 (`LegalPageShell` renders both,
nothing keys an in-app notice off them); the non-exhaustiveness caveat is on the parent
("listan är inte fullständig"). Round 2's real finding is fixed the right way: the
"ingen tredje part … lämnar aldrig din enhet" promise now sits in the `binge:theme` sub-bullet,
where it is true of the one enumerated value, while the parent keeps only the lifetime statement
— which is a property of the localStorage MEDIUM and therefore true of the undisclosed remainder
too. All three `ThemeMode` values are covered ('system' → "att följa enhetens egen inställning",
correct for a PWA on a phone where "datorns" was wrong), and nothing syncs the theme to Firestore.

Test-file half: the fourth `planQuickRateWrite` case is deleted outright per #27 DBA, its
explanatory comment went with it, the `describe` closes cleanly, no other file references
"distinct verdicts", and `planQuickRateWrite` is still imported and used at :242/:251/:256.
114 tests green across the four related files; `npm run typecheck` clean.

Non-blocking, not filed: the JSDoc quotes the parity test as "a stored 042 field no longer
rescues an aliased doc" while the real name is `a stored "042" field no longer rescues an aliased
doc on the client (BIN-646)` — a greppable prefix, and further copy polish is explicitly not
blocking on a round-3 comment-only diff.

### 2026-08-08 — BIN-679: reversing a documented decision leaves its rationale standing in the siblings; and a hardcoded discriminant at the call site is an unpinned link

Staged diff: six files making the curated Season-0 "Specialavsnitt" section tickable
(`SeasonList.tsx`, `useEpisodeProgressWithSync.ts` + `.helpers.ts`, three test files). Two
guards: the hook returns early for `season === 0` (writes only `episodeProgress`), and
`highestWatchedPosition` skips season 0 so the UN-tick path can't fall back onto a special.

**1. Reversal prose.** BIN-589's "specials are not tickable, and here is why" was replicated in
THREE modules. The diff rewrote `SeasonList.tsx`'s copy, and a concurrent agent rewrote
`src/lib/tv/canonicalSpecials.ts`'s copy — but left that fix UNSTAGED, so as the index stood the
module that DEFINES the feature still read "DISPLAY ONLY — deliberately not tickable … Making
specials trackable needs a progress marker that can hold a specials position — a
watch-status-model change, not this section." The third copy,
`src/hooks/useSubscriptionAdvisor.helpers.ts:133-148`, was untouched and still says
"markEpisodeWatched skriver exakt det avsnitt du bockade (en special-bock parkerar markören på
S0)" and "det motsäger highestWatchedPosition (som skriver markören och låter S0 förlora mot
varje säsong >= 1)". Both clauses are now false, and they are the stated rationale for a LIVE
rule (`isUserBehindOnAired`'s different-track → "bakom"), which criterion 5 forbids changing.
The deleted `SeasonList.tsx` comment had pointed readers at exactly that file. Lesson: grep the
OLD ticket id (BIN-589), not the file being edited; and check the sibling fix is in the INDEX.

**2. Caller-link gap, mutation-verified.** `SeasonList.tsx:181` hardcodes the season:
`markEpisodeWatched(0, episode.episode_number, w)`. Mutating `0` → `1` in an isolated worktree
of the index left both `SeasonList.test.tsx` and `useEpisodeProgressWithSync.test.tsx` green
(17/17) — the component test asserts `queryAllByRole('checkbox').length > 0` and passes a no-op
`markEpisodeWatched`, so it never learns which season the UI sends. The hook guard is pinned (3
kills for `if (season === 0)` in `markEpisodeWatched`) and the helper skip is pinned (4 kills,
two of them at hook level), but #27's criterion 1 is phrased about the USER action ("ticking a
special must NEVER call updateProgress"), so the composition is what has to be proven. Remedy:
fire a special's checkbox and `expect(markEpisodeWatched).toHaveBeenCalledWith(0, 83, true)` —
exact-args also pins that no `episodeCount` rides along (the auto-advance input).

**3. Concurrency.** Mid-review, `git status` flipped `useEpisodeProgressWithSync.ts` to `MM` and
a suite run failed on the markSeasonUnwatched guard; `git diff` showed a sibling's
`if (false) { /*MUTANT-M3*/`. It self-restored. Reviewed and verified the index in a scratch
worktree (`git write-tree` → `commit-tree` → `worktree add --detach`, junction'd node_modules):
typecheck clean, eslint clean on the six files, 2676 passed / 4 skipped. Teardown needed
`rm -rf` + `git worktree prune` from the repo root after `rmdir` the junction.

**4. Non-blocking, filed as "also found".** (a) The same guard silently changes the CALENDAR
toggle: `useCalendar` builds a season-0 entry whenever TMDB's `next_episode_to_air` is a
special, and `EventCard` ticks it through the same hook — that was a SECOND live route to the
S0-parked marker (so prod S0 markers do exist, which strengthens "no backfill" rather than
contradicting it), and such a show now stays "ej påbörjad" after a specials-only tick. The plan
never mentions it. (b) `EpisodeRow` brings `EpisodeReactions` to season-0 episodes — a new
public UGC key `episodeReactions/{tmdbId}_0_{ep}`; rules already wildcard `episodeKey` and the
listener only opens on click, so no rules or cost work, but the plan's scope statement omits it.
(c) The new "N/22" specials counter — the one thing Malin parked the ticket to look at — has
zero assertions.

Criteria: 1 partial (caller link), 2 N/A, 3 met, 4 met (`syncProgressToGroups` is called only
from `WatchlistContext.updateProgress:975`; specials are also hidden entirely under a group
mask), 5 met, 6 met.

### 2026-08-08 — a reused isolated-worktree rig replays the PRIOR round's mutant as a "flake" (BIN-679 r2)

Re-review of the BIN-679 staged set (8 files). I reused the scratch worktree built in round 1
(`scratchpad/wt679`), re-pointed it at the new index snapshot (`git write-tree` →
`commit-tree` → `git checkout --detach $COMMIT`), verified every `git hash-object` equalled
the staged blob, and re-derived the four call-site mutants the parent claimed killed. All four
died as claimed:

- `markEpisodeWatched(0, …)` → `(1, …)` — kills "forwards season 0 — and no episodeCount"
- `onToggle={handleToggle}` → `onToggle={() => {}}` — kills the same test
- `watched={isWatched(0, …)}` → `isWatched(1, …)` — kills "reads the checked state from season 0"
- `watchedCount={…filter(isWatched(0,n)).length}` → `watchedCount={0}` — kills "counts watched
  specials against the curated list"

BUT two of the mutant runs reported "2 failed" where the verbose re-run of the SAME mutant
reported 1, and the CLEAN, hash-verified staged file then failed 2 times in ~30 runs, always on
`reads the checked state from season 0`, always `expected [false,false] to deeply equal
[false,true]` — which is EXACTLY the output of mutant 3 (`isWatched(1, …)`). The test passed
10/10 in isolation (`-t`). I also observed one unexplained self-restore of `SeasonList.tsx`
INSIDE the supposedly isolated worktree between two consecutive Bash calls (post-mutation grep
= 1, next call's grep = 0, hash back to the staged blob).

Root cause (operationally settled, not proven): the worktree's `vitest.config.ts` carried a
persistent `cacheDir` in the scratchpad, created in ROUND 1 — where the same file and the same
mutants had been transformed. `rm -rf` that cacheDir → 15/15 green, plus 12/12 green
immediately before, i.e. 27 consecutive clean runs and 0 further sightings. Same family as the
lessons-digest entry "Vitest's on-disk transform cache serves the PREVIOUS mutant after a source
restore", but one level up: the contamination survives ACROSS REVIEW ROUNDS because the rig is
what is reused, not the cache directory inside the repo.

Rule folded into the principle: when reusing an isolated worktree for a re-review, re-point it
AND delete its `cacheDir`; and treat a failure whose output is byte-identical to a mutant you
built as rig contamination, settled by double-digit greens after a clear, not as a flaky test
filed against the author. Reporting it as a test defect would have blocked a green diff.

Also confirmed this round (all read, not inferred): `useMarkSeen.ts:95-104` really does write
`lastWatchedSeason: last_episode_to_air.season_number` straight through, so the corrected
BIN-589 premise in `useSubscriptionAdvisor.helpers.ts` holds and the season-0 branches in
`isUserBehindOnAired`/`librarySubState` must stay. `firestore.rules`' `isValidReaction` already
allows `seasonNumber >= 0`, so bringing `EpisodeReactions` to specials needs no rules change,
and `episodeReactionKey` = `${tmdbId}_${season}_${episode}` gives specials a fresh namespace.
Every downstream reader of `episodeProgress.seasons["0"]` is already season-0-safe:
`seasonCompletion` filters `season_number > 0`, `recaps/boundary.ts` + `coverage.ts` skip
`season < 1`, and `getTotalProgress` (which does count season 0) has no consumers at all.

Product residual, non-blocking: reusing `EpisodeRow` drops the air YEAR the old bespoke specials
row rendered beside the title — on a sparse 2005–2022 list that was the main disambiguator, and
no comment or test mentions the loss.

Criteria #27 1–6: all met this round (1 closed by the call-site spy tests re-derived above).
Verdict: pass (0 blocking).

### 2026-08-08 — BIN-679 r3: closing the call-site-literal gap, and the decorated-domain-object sink check

Re-review of the same 8-file staged batch after "small additions only" to `SeasonList.tsx`
(a `withYear` `useMemo` inside `SpecialEpisodeRow`, a #18-approval comment) and several new
cases in `SeasonList.test.tsx`. Index == worktree on all 8 blobs before and after; verified in
an isolated worktree built from `git write-tree` (all 8 `hash-object` == staged sha),
`--no-cache` throughout so the r2 rig-contamination class could not recur.

**1. The r2 finding was real and is now closed by mutation.** r2 flagged that the specials row
hardcodes `seasonNumber={0}` / `markEpisodeWatched(0, ...)` / `isWatched(0, ...)` at the call
site while every hook- and helper-level test keys on that number, and that the component test
only counted checkboxes. Four call-site mutants, each killed by exactly the intended test:
- `seasonNumber={0}` → `{1}` → 1 fail ("hands season 0 to the reactions thread, and labels the row S0")
- `markEpisodeWatched(0, ep, w)` → `(1, ep, w)` → 2 fails (forwards-season-0, checked-state)
- `markEpisodeWatched(0, ep, w)` → `(0, ep, true)` → 1 fail (the un-tick direction)
- `isWatched(0, ep)` → `isWatched(1, ep)` → 1 fail (checked state)
The `EpisodeReactions` mock became a props-capturing spy for exactly the reason the doc id
`${tmdbId}_${season}_${episode}` is the season literal's second consumer — a row handing it
season 1 would post special #2's reactions into `57243_1_2`, the S1E02 thread.

**2. `withYear` is correct and cheap.** `useMemo(..., [episode])`: the panel rebuilds `episodes`
with `.filter`, which preserves element references, and `season` is React Query `data`, so the
episode identity only changes on a refetch. It does NOT defeat `memo(SpecialEpisodeRow)` —
`withYear` is computed inside the component, not passed in; the memo's props are
`episode`/`tmdbId`/`watched`/`markEpisodeWatched`, all stable (`isWatched`, whose identity
changes every onSnapshot, is deliberately NOT a prop — only the derived boolean is).

**3. The mutated name reaches no sink.** Traced `{...episode, name: "X (2013)"}` through
`EpisodeRow`: `name` is rendered once into `.ttl`, nothing else. The `key` in the panel is the
original `ep.id`. `EpisodeReactions` receives `tmdbId`, `seasonNumber`, `episode.episode_number`,
`watched` — numbers only, so the decorated name cannot reach the reaction doc id, Firestore, or
analytics. Two mutants confirmed the year is pinned: dropping the `year ?` guard → 1 fail
("... (undefined)" on the null-air_date fixture); passing `episode` instead of `withYear` → 1
fail. `air_date?.substring(0,4)` also yields `''` (falsy) for an empty-string date, so the
fallback branch covers both null and `''`.

**4. #27's six criteria re-checked at the index, not inherited.** `updateProgress` is the sole
writer of `lastWatchedSeason/Episode` AND the only caller of `syncProgressToGroups`
(`WatchlistContext.tsx:975`, inside `updateProgress`, confirmed by repo-wide grep) — so the
season-0 guard discharges criteria 1 and 4 structurally. No new stored field: `firestore.rules`
constrains `episodeProgress` to `hasOnly(['tmdbId','seasons','mediaType'])` with the `seasons`
map unvalidated, so `seasons["0"]` needs no rules change and no backfill; `episodeReactions`
matches on a wildcard `{episodeKey}`, so the new `_0_` slot needs none either. Both guards are
load-bearing: stripping the hook's `if (season === 0)` → 3 fails; stripping
`highestWatchedPosition`'s `if (season === 0) continue` → 4 fails.

**5. Downstream of "season 0 is now writable in episodeProgress for the first time".** Grepped
every consumer: `getTotalProgress` has no caller; `seasonCompletion` filters `season_number > 0`;
`inventoryFromSeasons` (recaps/spoiler frontier) filters `>= 1`; `nextAir` filters `> 0`;
`serviceValue`/`useAllEpisodeProgress`/`episodeProgress.ts` never read season keys. Only
`diary.ts` flattens all seasons, which now yields a legitimate `S0E83` diary entry. No
watched-count is compared against a season-0-excluding denominator.

**6. Stale comment from r2 is fixed and STAGED.** `useSubscriptionAdvisor.helpers.ts`' two
BIN-589 claims ("markEpisodeWatched skriver exakt det avsnitt du bockade", "låter S0 förlora mot
varje säsong >= 1") were rewritten to the post-BIN-679 truth, and correctly kept the surviving
S0-marker paths (`useMarkSeen` writing `last_episode_to_air`, legacy docs) so nobody deletes the
season-0 branches in `isUserBehindOnAired`/`librarySubState`. Comment-only diff, verified.

**Advisory, not filed:** `highestWatchedPosition`'s "never counts specials, even when they are
the highest key present" case is IMPLIED, not independent — the season-0-skip mutant leaves it
green (with `{0:{1,2}, 1:{1}}` the numeric compare already picks S1E1); four sibling cases kill
it. Also: `EpisodeRow` renders a "nu" chip instead of a checkbox when `air_date === today`, so a
special airing today would be un-tickable — inherited from the shared row, unreachable for a
2005-2022 curated list.

Isolated-worktree results: 224 files / 2683 passed / 4 skipped, `tsc --noEmit` exit 0, `eslint`
exit 0 on all 7 non-new source files. Verdict: pass, 0 blocking.

### 2026-08-08 — BIN-679 follow-up (r4): a mock-prop assertion pins the wiring, not the guard

Staged set: `src/lib/tv/canonicalSpecials.ts` (9a42757), `src/components/tv/SeasonList.tsx`
(65fbfbd), `src/components/tv/SeasonList.test.tsx` (84a5726). 17 added lines, two comment
rewrites + one assertion. Reviewed on an isolated worktree of the index (tree 345daf9,
snap commit 328b620), fresh `cacheDir` outside `node_modules`.

**The finding.** The new line is `expect(call[0].watched).toBe(false)` inside
`hands season 0 to the reactions thread`, closing the review round's "the spoiler gate is
unpinned repo-wide" note. Mutations run in the isolated worktree:

| mutant | result |
|---|---|
| `EpisodeRow.tsx:109` `watched={watched}` → `watched={true}` | 1 of 14 red — exactly the named test. Assertion is load-bearing. |
| same line → `watched={false}` | **FULL SUITE GREEN** (2683 passed / 4 skipped). |
| `EpisodeReactions.tsx:17` `if (!watched) {` → `if (false && !watched) {` | **FULL SUITE GREEN** (2683 passed / 4 skipped). |
| `SeasonList.tsx:66` `SPECIALS_KEY = 0` → `-1` | 1 of 14 red — only `counts watched specials against the curated list`. |

So the assertion closes the LEAK direction of one link (EpisodeRow forwards its `watched`
prop) and nothing else. The gate itself — `if (!watched) return <gate/>` in
`EpisodeReactions.tsx` — is structurally unreachable from `SeasonList.test.tsx`, which
mocks `EpisodeReactions` to a spy precisely so the Firebase-importing hook never loads.
`EpisodeReactions` is imported by `EpisodeRow.tsx` alone, and `SeasonList.test.tsx` is the
only test file in the tree that renders it, so #18 Community Manager's sign-off ("reactions
only open once YOU have marked the episode watched") remains unpinned at its implementation.
An `EpisodeReactions.test.tsx` can cover the `!watched` branch with no Firestore at all —
`useEpisodeReactions` is called only inside `ReactionsThread`, below the gate.

**Answer to "is this the right home?"** Yes for what it pins (only place that renders the
tree; the claim it defends is written in `SeasonList.tsx`'s section comment), no for what
the ticket believed it pinned. Recorded as advisory, not blocking: the diff strictly adds
detection power.

**Comment rewrites.** `canonicalSpecials.ts:13` display-only → data-only: accurate, and no
third reading inside the file (the only surviving "display-only" is the explicitly retired
one at :21). But the sentence still points at `relatedSeries.ts` as "the same pattern", and
that file's own header says "It is DISPLAY ONLY — it does not merge the shows, and touches
no watchlist / progress / status data" — the retired sense, now false for canonicalSpecials.
The ambiguity moved one hop out rather than being removed; suggested naming the shared
property (hand-curated, zero runtime TMDB cost, nothing stored but ids) instead of the term.
Second half of the new parenthetical documents the comment's own edit history rather than
the code — code-style debt, suggested trim.

`SeasonList.tsx:61-65` (SPECIALS_KEY doubles as accordion key and literal season number):
verified accurate by the `-1` mutant — the counter goes 1/22 → 0/22 while the checkboxes,
the reactions thread and the expansion all keep working, because those pass a literal `0`
(`CanonicalSpecialsPanel` `isWatched(0, …)`, `SpecialEpisodeRow` `markEpisodeWatched(0, …)`,
`EpisodeRow seasonNumber={0}`). "Silently" is true of runtime behaviour; the counter test at
`SeasonList.test.tsx:230` does catch it, which the comment could name.

**Also noted (out of the staged set):** `tasks/todo.md:9` — unstaged, being replaced by the
BIN-679 plan — still reads "`CanonicalSpecialsSection` … är medvetet display-only" in the
present tense; per code-style the plan is disposable and BIN-679 shipped in 95a09d6.
The mock's declared prop type (`{ tmdbId; season; episode }`) omits `watched`, which the new
assertion reads through an `any` mock.calls entry; it fails loudly rather than silently, but
adding `watched: boolean` keeps the spy self-documenting.

Rig hygiene: junction dropped before `worktree remove`; `remove --force` hit Permission
denied, cleared with `rm -rf` + `git worktree prune` from the repo root, `node_modules/.bin/
vitest` verified present afterwards. Index blobs re-verified unchanged at close.
Verdict: pass, 0 blocking.

### 2026-08-08 — BIN-679 r6 (final): a SIBLING agent's cleanup wiped the shared `node_modules` through my rig's junction

Reviewing the staged BIN-679 follow-up (3 files, comment/test-only: `SeasonList.test.tsx`
`ef3268fd`, `SeasonList.tsx` `a118fff4`, `canonicalSpecials.ts` `163a42ad`). Built the
standard rig at 16:46 — `git write-tree` → `commit-tree` → `worktree add --detach` +
`mklink /J node_modules C:\binge\node_modules` — ran the target suite green (14/14) on the
staged bytes, then went to typecheck. Two minutes later the worktree was EMPTY except
`tsconfig.tsbuildinfo`, it was gone from `git worktree list`, and
`ls C:/binge/node_modules` returned **0 entries**: the entire shared install was destroyed
mid-review. I had removed nothing.

Cause: the per-session scratchpad (`…/8aade003-…/scratchpad/`) is shared by every agent in
the session. A sibling reviewer (its own `wt-r5-164756` appeared at 16:47, plus `vcache-r5`,
`remedy-r5.mjs`) cleaned up stale worktrees there, and the removal walked into MY junction
and deleted the real `C:\binge\node_modules` behind it. The 2026-08-01 lesson ("drop the
junction FIRST, then `worktree remove --force`") only protects against your OWN removal —
it cannot protect a junction a concurrent agent removes for you. Blast radius is the whole
repo: `npm test`, `npm run typecheck`, `npm run lint` and every commit gate were dead.

Repair: `npm --prefix /c/binge ci --prefer-offline --no-audit --no-fund` → "added 722
packages in 47s", `node_modules/.bin/vitest` back. Then rebuilt the rig WITHOUT a junction —
`npm --prefix <worktree> ci --prefer-offline` (53 s) gives the scratch tree a private
`node_modules`, which also isolates the vitest transform cache for free (default `cacheDir`
is `node_modules/.vite`, so the round-N−1-mutant class disappears). Note `--cache.dir` is
not a valid vitest 4 flag (CAC throws). Removing the rig afterwards failed with `Filename
too long`; `rm -rf` + `git worktree prune` from the repo root cleared it and
`C:/binge/node_modules` survived at 448 entries.

Findings on the diff itself (all four of r5's taken advisories verified by mutation in the
private rig; control 14/14 green, hashes == index before and after each run):
- `EpisodeRow.tsx` `watched={watched}` → `watched={false}` at the sole `EpisodeReactions`
  call: **1 of 14 fails**, and it is exactly `reads the checked state from season 0` — the
  new `Map`-based assertion. The gate-stuck-shut direction that survived r4 is now dead.
- Same site → `watched={true}`: 2 of 14 fail (`hands season 0 to the reactions thread` +
  the same Map test). Both directions of the forwarded boolean are pinned.
- `const SPECIALS_KEY = 0` → `-1`: **1 of 14 fails**, exactly the `1/22` case, so
  `SeasonList.tsx`'s new "live tripwire" comment is true as written.
- The Map assertion is free of the vacuity traps: an absent episode yields `undefined`,
  which fails `toBe(true)` and `toBe(false)` alike (unlike `.every` over an empty array or
  a `find` that returns undefined). `mock.calls` is cleared in `beforeEach`, and the Map is
  built before the un-tick click, so no later call can overwrite a key.
- Comment claims verified statically: `EpisodeRow.tsx` is the ONLY importer/renderer of
  `EpisodeReactions` in the tree; `SeasonEpisodePanel` uses `EpisodeRow` for numbered
  seasons; no test renders `EpisodeReactions` unmocked (`TVShowPageClient.test.tsx` mocks
  `SeasonList` wholesale), so "the branch that implements the gate is still untested" holds.
- Advisory (comment-only, non-blocking): `canonicalSpecials.ts:13-15`'s rewritten header
  claims canonicalSpecials shares relatedSeries.ts's "zero runtime TMDB cost, nothing stored
  but ids". Both halves are slightly off. `RelatedSeriesStrip` renders curated labels and
  fetches NOTHING, so relatedSeries really is zero-fetch; the specials section fires an
  extra `useTVSeason(tmdbId, 0)` on every expand — the next sentence ("titles, stills and
  synopses still come from the live TMDB season fetch") half-corrects it but also
  contradicts it. And BOTH files store hand-written labels (`label: 'Specialavsnitt'`,
  `label: 'Klassiska serien · 1963–1989'`), plus TMDB episode titles in canonicalSpecials'
  inline comments — relatedSeries.ts's own header makes those labels the point ("labels are
  never fetched"). The property that is true of both: no TMDB metadata is checked in, only
  ids/numbers plus our own Swedish copy. Also `(own ticket)` in the test comment would be
  greppable as `(BIN-821)`. Per the BIN-641 four-round precedent I did NOT make this
  blocking — it is one sentence's precision on a comment, and re-rounding it costs more
  than it buys.
- Agreed with the parent on `tasks/todo.md:9`: the "medvetet display-only" line sits under
  the heading "## Vad som är trasigt idag" in an unstaged, disposable plan — past-state
  context, not a live claim. Withdrawing my earlier "also found".

Typecheck (`npm run typecheck`) and `npx eslint` on the three files: clean, run in the
private rig on the staged bytes. Verdict: pass, 0 blocking.

### 2026-08-08 — BIN-679 r6 (closing): a "same pattern as <module>" cross-reference converges only when split into shared vs NOT-shared

Staged: `src/lib/tv/canonicalSpecials.ts` (header only), `src/components/tv/SeasonList.tsx`
(comment only), `src/components/tv/SeasonList.test.tsx` (two assertions + a mock prop type).
Index == worktree on all three (`git rev-parse :<path>` == `git hash-object <path>`:
57e8874 / a118fff / b6ca804). Verdict: pass, 0 blocking, 1 advisory.

Sixth round on ONE comment. Rounds 1-5 each found a different clause that was true of
`relatedSeries.ts` but false of `canonicalSpecials.ts` ("zero runtime TMDB cost" was r5's).
The rewrite that finally holds does NOT swap in a better analogy — it NAMES which properties
are shared and which are explicitly not:
  - shares the SHAPE: hand-curated, no TMDB metadata checked in, only episode numbers + our
    own section label;
  - NOT the affordance: relatedSeries is display-only, this section is tickable;
  - NOT the cost: relatedSeries fetches nothing, this fires one lazy season-0 request.
Every clause priced by READING the named module, not by trusting its own header:
`RelatedSeriesStrip.tsx` renders `<Link>`s off curated labels with no hook and no fetch
(`TVShowPageClient.tsx:455` passes `relatedSeriesFor(show.id)` straight in), so "fetches
nothing" is TRUE; `CanonicalSpecialsPanel` calls `useTVSeason(tmdbId, 0)` only when expanded
and `EpisodeRow` renders `still_path` (`<img>`), `name` and `overview` from it, so "titles,
stills and synopses all come from it live" is TRUE.

The ONE residual, carried forward as advisory, not blocking: "no TMDB metadata checked in"
is a claim about the DATA that the same file contradicts 40 lines down — `CANONICAL_SPECIALS`
carries 22 inline TMDB episode titles and years ("// The Christmas Invasion (2005)") as
re-verification aids. `relatedSeries.ts` has the same shape in miniature (one comment naming
"The Power of the Doctor"), so the property IS shared in spirit; only the scoping word is
missing. Fix if it is ever touched again: "the DATA holds only numbers and our own label —
the titles beside them are re-verification comments, never rendered." Explicitly NOT filed
as blocking: per the BIN-641 four-round precedent, a seventh round on one sentence costs
more than the precision buys, and a rewrite is itself the highest-risk edit in this diff.

Mutation-verified in a private rig (index tree → `git write-tree`/`commit-tree`/
`worktree add --detach`, own `npm ci`, 722 packages, 33 s — NO junction; the shared
`node_modules` was destroyed twice today by sibling teardowns walking through one). Clean
control 14/14. Each mutant applied via a script that exits non-zero on no-match, asserted
present BEFORE and AFTER the run in one command, restored by `git checkout --` and verified
by hash:
  - `SPECIALS_KEY = 0` → `-1`: 1 failed / 13 passed, the failure being exactly the `1/22`
    case named in the new `SeasonList.tsx` comment. The comment's tripwire claim is true,
    and the accordion still works under the mutant (checkboxes pass season 0 directly),
    which is the trap it warns about.
  - header `({specials.episodeNumbers.length} avs)` → `({0} avs)`: 1 failed / 13 passed —
    the new `expect(screen.getByText('(22 avs)'))` kills it ALONE. This is the second
    rendering of the curated length; before this round it was unpinned (the `x/22` counter
    pins the other site).
  - `EpisodeRow.tsx:109` `watched={watched}` → `watched={false}`: 1 failed (the new
    `gate.get(83) === true` Map assertion). → `watched={true}`: 2 failed. Both directions of
    the forwarded prop are now dead; last round only the `false` direction was pinned and the
    `watched={false}` mutant (reactions stranded shut for EVERY episode in the app) survived
    2683/2683.

Comment claims re-verified statically after the r5 fix: `EpisodeRow.tsx` is still the only
renderer of `EpisodeReactions`; `SeasonList.test.tsx` is still the only test file reaching
`EpisodeRow` (no `SeasonEpisodePanel`/`SeasonPageClient` test exists, `TVShowPageClient.test.tsx`
mocks `SeasonList` wholesale); `EpisodeReactions.tsx:17` really is `if (!watched) return
<gate>`, so "the branch that implements the gate is still untested (BIN-821)" holds and the
ticket id is now greppable. The mock's prop type gained `watched: boolean`, restoring parity
with the real component's signature (the "a mock with FEWER parameters deletes the behaviour
under test" trap, closed here).

Main-tree suite 14/14, `npm run typecheck` clean, `npx eslint` on the three files clean,
rig removed with `git worktree remove --force`, `node_modules/.bin/vitest` present after.

### 2026-08-08 — BIN-823: a persisted build artifact silently un-runs an existing guard test

Staged diff persisted the SEO pre-render selection to `.tmdb-cache/selection-{movie,tv,person}.json`
and made `generateStaticParams` read it instead of deriving (`resolveSelection` in
`src/lib/tmdb/selectionManifest.ts`). `readSelectionManifest` resolves its path from
`process.env.TMDB_CACHE_DIR || join(process.cwd(), '.tmdb-cache')`.

`src/app/titleParams.watchdog.test.ts` (NOT in the staged set — BIN-815's regression guard, the one
three reviewers built after the watchdog was twice wired to the wrong build phase) imports the three
routes' real `generateStaticParams` and asserts the heartbeat/STUCK lines their list fetches produce.
It sets no `TMDB_CACHE_DIR`. Measured this review:

  npx vitest run src/app/titleParams.watchdog.test.ts            → 10 failed / 1 passed
  TMDB_CACHE_DIR=<empty tmp> npx vitest run <same file>          → 11 passed / 4 skipped

Cause: the local verification builds had written real manifests (movie 7583 ids, tv 6987, person
1000, derivedAt 2026-08-08T20:07Z), so `resolveSelection` short-circuited, `derive` never ran, no
`trackBuildCall` fired, and every watchdog assertion had nothing to observe. CI stays green only by
accident of step order — `deploy.yml` runs `Test` (line 85) before `Restore TMDB build cache`
(line 135), and `ci.yml` never restores at all. The briefed "Full suite: 2743 passed" was true when
run and false by the time the manifests existed.

Generalisation: any new cwd-relative persisted artifact can change which branch an EXISTING test
exercises, with no diff on that test file to alert a reviewer. Two moves: grep the suite for callers
of the reading code that don't override the dir env, and re-run the suite with the artifact present.
The diff's own new tests all isolate correctly (`selectionResolve.test.ts`,
`selectionManifest.io.test.ts`, `sitemap.test.ts` each `mkdtempSync` + set `TMDB_CACHE_DIR`), and
`seoPersonIds.test.ts`'s header even names the hazard ("stops the suite from reading or writing the
repo's REAL .tmdb-cache") — the author saw it for the file they touched and not for the one they
didn't.

Same review, other findings worth the audit trail:
- The three routes' `catch` only re-throws on `err.message.startsWith('[selection]')`, so a derive
  that REJECTS (not returns []) falls to `SEO_FALLBACK_*` = 10 ids, green build, deploy — the exact
  "fallback must never reach a deploy" the ADR's Fork C exists to close. Reachable via
  `latinDisplayIds(r.value.results)` on a malformed 200 body. Fix belongs inside `resolveSelection`
  (treat a throw like the timeout), not in three duplicated string-prefix sniffs.
- `mergeManifest(null, type, [], now)` skips the `freshIds.length === 0` guard (it requires
  `previous !== null`) and PERSISTS an empty/thin manifest with a fresh `derivedAt`; every later code
  deploy then reads it as fresh, never re-derives, and dies on the floor for up to 30 days.
- `SELECTION_CEILING.person` (1 000) is below the person derivation (`SEO_PERSON_TARGET_IDS` 3 000,
  really ~10k unique), so the ratchet is a no-op for person — the ADR's "3–5k slack per typ" holds
  for titles only.
- Reversed-decision prose not retired: `sitemap.ts`'s header still promised the old "falls back to
  static routes instead of breaking the build" beside the new code that deliberately throws; plus
  four stale "sitemap shares this pipeline" cross-references.

### 2026-08-08 — BIN-823 r3 (closing): the prose-fix round's own blind spot, and two questions answered

**Blocking finding (1).** `src/lib/tmdb/buildFetch.ts:74-81`. Round 2 took the B3
"reversed-decision prose" finding and rewrote five named sites (`sitemap.ts` header,
`seoPersonIds.ts` module contract, `seoCoverage.ts` ×3, `person/[id]`, `selectionManifest.ts`).
It missed `buildFetch.ts` — a file the same diff MODIFIES — whose BIN-815 watchdog rationale
still reads: "INTE instrumenterad: allt som hämtar i den SENARE fasen `Generating static pages`
— sitemap.ts:s egen kopia av `collectIds` (störst) …" and "`collectIds` finns i tre nästan
identiska kopior". This very diff deleted sitemap.ts's `collectIds` and every TMDB import from
it (verified in `git diff --cached -- src/app/sitemap.ts`): sitemap.ts now performs zero network
I/O, and two copies of `collectIds` remain (movie, tv). The harm is not pedantic — that comment
block took three review rounds to get right precisely so the next hang investigation is aimed
correctly, and it now names a pure file-reader as the phase's biggest un-instrumented fetcher.
Same stale count in `selectionManifest.ts:328` ("tre nästan identiska kopior").
LESSON: after a prose-reversal fix lands, re-grep the DELETED SYMBOL (`git grep collectIds`),
not the fixer's inventory of sites. Folded into the comment-vs-code principle.

**Non-blocking (3).**
- `selectionManifest.ts:136-156`: the B2 fix inserted `SelectionFloorError` + its own JSDoc
  BETWEEN `assertCoverageFloor`'s JSDoc and the function. The "Kastar om det upplösta urvalet
  krympt under golvet" block now documents nothing and the function is bare. Known class
  (BIN-616, BIN-641 ×3) — new instance, caused by a review-round fix.
- `selectionResolve.test.ts`: 7 real `::warning::` lines on a green run → GitHub annotations on
  every `npm test` in ci.yml. `selectionParams.test.ts:98-100` spies stderr for exactly this and
  documents why. New principle bullet added under Testing mechanics.
- `SelectionFloorError` sets no `name`, so build logs print `Error: [selection] …`. Cosmetic.

**Q1 — can the new `tooThin` branch loop or wedge a different failure? No.**
`mergeManifest` is monotonic below the ceiling, so `previousCount` never decreases build-over-
build; a thin manifest either grows past the floor (green, self-healed) or stays thin (red, with
`workflow_dispatch full_refresh=true` printed in the error). No oscillation is constructible.
`writeSelectionManifest` runs BEFORE the floor throws, so a red build persists its partial
derivation and the next build accumulates onto it — deliberate, and `actions/cache/save` with
`if: always()` (path `.tmdb-cache`, whole dir, so `selection-*.json` rides along) is what makes it
work. `floorFor(type, 0)` is the correct threshold and provably cannot disagree with the floor's
own `floorFor(type, previousCount)`: `tooThin` requires `previousCount < ABSOLUTE_FLOOR`, and then
`ceil(0.8·previousCount) < previousCount < ABSOLUTE_FLOOR`, so `max(...)` is `ABSOLUTE_FLOOR` on
both sides. Under `SELECTION_ALLOW_THIN` the floor is 0 so `tooThin` is dead — correct for CI.
Cost to know: while thin, EVERY code deploy pays a rescue derivation (≤15 min/type) and the
person derivation can eat the whole 1500-fetch worker budget — the accepted N5 coupling, now
reachable on ordinary code deploys, bounded and covered by the ADR's own "Rättelse om
budgetkonkurrens" (green build, thinner pages, self-heals next build).

**Q2 — does `SelectionFloorError` survive `generateStaticParams`? Yes.**
`tsconfig.json` target is ES2017, so `class X extends Error {}` stays a native class and
`instanceof` is not broken by ES5 down-levelling. The `instanceof` test runs INSIDE the route
module, same process and same module instance that threw, so the static-worker boundary never has
to preserve class identity — Next only serialises message/stack afterwards for display, and it
does not swallow generateStaticParams errors (they propagate out of `buildAppStaticPaths` and
fail `next build` non-zero). `selectionParams.test.ts:115-120` pins the rethrow per route
(`rejects.toThrow(SelectionFloorError)`) — the link that was deletable with the whole suite green
before. Residual worth knowing, not a defect: the floor is only consulted via `resolveSelection`;
`sitemap.ts`'s own throw covers "manifest missing", never "manifest thin".

**Eviction tie-break (N2) verified by hand, not just by its test:** week1 = merge(null, 3000 ids,
ceiling 1000) evicts the 2000 highest indices → survivors 1..1000; week2 bumps all 1000 incumbents
to the same `now`, appends 2000 newcomers at higher indices, evicts them → 1000/1000 survive. And
starvation is NOT introduced: incumbents the derivation stops listing keep an older `lastDerived`
and are evicted ahead of newcomers, so churn continues at the margin.

Verification: 7 selection test files, 95 passed / 4 skipped, run against the staged bytes;
`git diff` empty for every reviewed path (only unstaged `docs/org/metrics/events.jsonl` differs).

### 2026-08-09 — BIN-823 r4: a past-tense "copy count" inverted the ADR the same commit was amending; a stale plan file rode the feature commit

Round 4 of the SEO selection ratchet (`git diff --cached`, 31 files, tree clean, every reviewed
blob re-hashed pre/post and matching `git rev-parse :<path>`).

**All four round-3 items verified fixed.** `buildFetch.ts:76-83` now says the sitemap "gör noll
nätanrop, så den kan inte längre vara en hängning" and counts `collectIds` as two copies (movie,
tv) — `git grep collectIds` confirms exactly two. `SelectionFloorError` carries
`override name = 'SelectionFloorError'` and its JSDoc/`assertCoverageFloor`'s are un-swapped.
`selectionResolve.test.ts` installs ONE `process.stderr.write` spy in the top-level `beforeEach`;
`npx vitest run selectionResolve.test.ts selectionParams.test.ts 2>&1 | grep -c '::warning::'`
returns 0, so the seven fake GitHub Actions annotations per green run are gone.

**BLOCKING — `src/app/sitemap.ts:71`.** "Tidigare härledde den här filen om hela urvalet på egen
hand — en tredje och fjärde kopia av `collectIds` respektive `collectPersonIds`". `git show
HEAD:src/app/sitemap.ts` shows it had its own `collectIds` (a genuine third copy) but IMPORTED the
shared `collectPersonIds` from `@/lib/tmdb/seoPersonIds` — one function, two callers, which is
exactly ADR 0005's decision. And ADR 0005 is amended two files away IN THIS COMMIT to say the
decision "(EN delad pipeline, inte två kopior) står kvar och är skärpt". So the comment asserts the
duplication that the ADR it cites exists to have prevented. New principle: a PAST-TENSE claim about
how many COPIES a helper had is a claim about a decision record — a round that DELETES a call site
routinely miscounts a shared helper's second CALLER as a second COPY. Check each named symbol
separately against `git show HEAD:<file>` and against any ADR the same diff touches.

**NON-BLOCKING 1 — `tasks/todo.md`.** The staged file is BIN-679's plan ("Parkerad för hennes
granskning", shipped 95a09d6); HEAD's is BIN-815's. Neither is BIN-823, which has no plan file in
`tasks/` at all. `code-style.md` says an implemented plan is DELETED, not swapped, and bundling it
into a feature commit means a BIN-823 revert restores BIN-815's plan. Same class as the
workflow-map lesson (unrelated doc riding feature code).

**NON-BLOCKING 2 — 800/1000 challenged and upheld.** Hand-replayed: derive 800, ceiling 1000 ⇒
week 2 merges 800 previous + ~30 new = 830 < 1000, no eviction, the dropped id survives. Ceiling ==
derivation (1000) and 3× derivation (3000) both evict it — matching the three-row behaviour test at
`selectionManifest.test.ts:282`. No bad interaction with `SELECTION_ABSOLUTE_FLOOR.person = 200`:
steady-state `previousCount` ≈ 1000+seeds so `floorFor` ≈ 826 via the 80 % term, comfortably under
the resolved count, and `tooThin` compares against `floorFor(type, 0)` = 200. Real one-time cost the
ADR does not name: the first build yields 800 + 32 seeds = 832 person pages where production had
~1000, regrowing toward the ceiling over ~4-5 weekly refreshes. The 32 GSC-indexed person seeds are
union-at-read and cannot be evicted, so nothing Google actually holds is at risk.

**NON-BLOCKING 3 — `preview.yml`.** Real TMDB key, no `SELECTION_ALLOW_THIN`, and — unlike
`deploy.yml` — NO `.tmdb-cache` restore and no step timeout. So every dependabot PR preview
cold-derives all three types under `RESCUE_DERIVE_TIMEOUT_MS` (15 min) and now goes RED on the
coverage floor where it previously just produced a smaller preview. Deliberate per
`selectionManifest.ts:99-101`, but the cold-cache half is stated nowhere.

Gates run against the staged bytes: `npm run typecheck` clean; `npx eslint` clean on all 18 changed
source/test files; 10 selection-related suites 141 passed / 4 skipped. Local `.tmdb-cache` carries
`selection-{movie,tv,person}.json` from a verification build (7583 / 6987 / 1000 ids) — the person
file predates the 800 change; gitignored, no repo impact, and `titleParams.watchdog.test.ts` now
overrides `TMDB_CACHE_DIR` so the artifact can no longer blind it.

Also noted: `.claude/**` is TRACKED since b20bf69, so `.claude/rules/accepted-deviations.md`'s own
"`.claude/` is gitignored, so there is no git history to fall back on" line is now false, and the
BIN-585/684 "a gitignored target evaporates from every diff-based gate" lesson no longer holds for
this repo. Out of scope for this diff; worth correcting when that file is next touched.

### 2026-08-09 — BIN-823 r5: an env flag's scope moved; the fix round patched the code sites and left the ADR + the rules file asserting the opposite

Round 5 of BIN-823. Round 4's blocking finding (`sitemap.ts` calling the shared `collectPersonIds`
"en fjärde kopia") was correctly fixed, and four items changed. Item 3 of the brief: `preview.yml`
gained `SELECTION_ALLOW_THIN: '1'`, and "`allowThinSelection`'s JSDoc and `ci.yml`'s comment were
corrected to match — the old prose claimed preview.yml never sets it."

Both of those WERE corrected (`selectionManifest.ts:99-105` now explains the preview reason;
`ci.yml:88-92` now says "preview.yml sätter den också, men av ett annat skäl"). But
`grep -rn SELECTION_ALLOW_THIN` returns four prose sites, not two:

- `docs/org/adr/0018-seo-selection-ratchet.md:98-101` (staged NEW in this same commit) —
  "`SELECTION_ALLOW_THIN=1` stänger av golvet och sätts **BARA i `ci.yml`** … och
  `deploy.yml`/`preview.yml` **kan aldrig råka få den**." The second clause is not merely stale,
  it is the exact negation of what the same commit does, inside Fork C — the decision record for
  the coverage floor itself.
- `.claude/rules/deployment.md:37-38` (staged M) — "`SELECTION_ALLOW_THIN=1` stänger av golvet och
  sätts bara i `ci.yml` (dummynyckel)." This file is trigger-loaded on `.github/workflows/**`, i.e.
  it is precisely what the next agent editing a workflow reads before deciding where the flag may
  live.

Same class as the BIN-823 r2 finding (a fix round enumerates the sites IT found) and the BIN-679
three-modules case, with one new coordinate: when what moved is an ENV VAR's SCOPE rather than a
symbol, the replication sites include the ADR and the `.claude/rules/*.md` operating instruction,
and one grep of the variable name finds all of them at once. Filed BLOCKING for parity with r4,
which blocked on a strictly smaller version of the same error.

**Non-blocking, but the more interesting finding — the flag doesn't cover the case its own comment
names.** `preview.yml`'s new comment justifies the flag with "en strypt personhärledning skulle då
fälla bygget på täckningsgolvet". Trace it to the end:

- Derive RESOLVES thin/empty (throttled key, `Promise.allSettled` swallows the failures) →
  `derived.ok === true` → `mergeManifest(null, type, [], now)` writes a valid EMPTY manifest →
  floor is 0 under the flag → `sitemap.ts` finds a readable file → preview is green. Covered.
- Derive TIMES OUT or THROWS with `previous === null` (cold preview cache, `RESCUE_DERIVE_TIMEOUT_MS`
  = 15 min against the ~44 min the person pipeline took on 2026-08-08) → `if (derived.ok)` gates
  BOTH the merge and the write, so no manifest is ever written → the floor is off, so
  `generateStaticParams` happily returns just the seeds and the build continues → `sitemap.ts`'s
  `selectionOrThrow` throws `urvalsmanifestet för movie saknas` and the preview goes red anyway.

Production is unaffected (the floor fires first there, which is the intended loud failure), so this
is preview-only ergonomics. Remedy is one of: persist the merged manifest even on give-up when
`previous === null`, or let `sitemap.ts` tolerate a missing manifest under `allowThinSelection()`.

**Also non-blocking: the timeout warning is pinned only NEGATIVELY.** The round's real defect — the
throw branch's `::warning::` and the shared `else` branch's "härledningen nådde sitt tak (N ms)"
both firing on a throw — is fixed by moving the timeout warning inside the `try` behind
`if (!derived.ok)` and deleting the `else`. Control flow verified equivalent: timeout warns exactly
once, `derived.ok` narrows (own `npx tsc --noEmit` run: clean), and nothing that previously wrote a
manifest now skips it. But `grep "nådde sitt tak"` finds the string in exactly one test, as
`expect(written).not.toContain('nådde sitt tak')` in the THROW test (`selectionResolve.test.ts:284`).
No test asserts a timeout DOES warn, so deleting the whole timeout-warning block leaves the suite
green — and the rescue-timeout test at :163 already drives that exact path and asserts only the
returned ids. One-line gap in the twin of the line the round moved.

Verification: worktree == index for all 30 staged files (only `tasks/todo.md` dirty, unstaged, as
briefed — BIN-679's spent plan correctly kept out of the commit). `npx tsc --noEmit` clean.
Selection suites re-run on these bytes: 8 files, 106 passed / 4 skipped, no `::warning::`
annotations leaking (both new test files install a single `process.stderr.write` spy in
`beforeEach`). `node scripts/check-workflow-map.mjs` OK — 95 nodes, 63/63 coverage; no
`.claude/state/workflow-map-stale.json`. ADR 0005 correctly amended to "delvis ersatt av ADR 0018"
rather than rewritten. `tasks/lessons.md` + `lessons-digest.md` sync contract met (1 lesson, 1
one-liner; inserted second-to-last rather than appended — cosmetic, the freshness hook counts).

### 2026-08-09 — BIN-823 r6 (confirmation): a NEW ADR contradicting code added in the same commit

Round 5 blocked on `SELECTION_ALLOW_THIN` prose: `preview.yml` had started setting the flag while
ADR 0018 Fork C and `.claude/rules/deployment.md` still said it is set "BARA i `ci.yml`" and that
`deploy.yml`/`preview.yml` "kan aldrig råka få den". r6 confirms both are fixed and consistent, and
that `grep SELECTION_ALLOW_THIN` now returns four agreeing sites (JSDoc, `ci.yml`, ADR 0018:98,
`deployment.md:37`) plus the new `sitemap.ts:86`.

**But the var-grep was the fixer's enumerator, and it is the wrong one.** r5's non-blocking 1
(the flag exempted only the coverage floor, so a preview whose person derive times out writes no
manifest and `sitemap.ts` fails the build anyway) became production code this round:
`selectionOrThrow` now returns `[...seedIds]` under `allowThinSelection()`. Mutation-verified here —
replacing the branch with a comment kills exactly 1 test alone (`sitemap.test.ts`'s new
"faller tillbaka på frö-id:n" case, which also asserts `movie/1` is ABSENT so it cannot be satisfied
by a leftover manifest), and both existing throw cases pin the inverse. Guard placement is right:
under the flag with a missing manifest the route returns `resolvedIds(null, seeds)` = seeds and the
sitemap returns the same seeds, so parity is exact; in CI the derive returns `[]`, `mergeManifest`
writes an EMPTY manifest, and both sides read seeds — the throw path is never even reached there.
`deploy.yml` sets the flag nowhere (grep) and has no `workflow_dispatch` input for it, so it cannot
reach production; the preview channel's sitemap lists binge.nu URLs that are a strict subset of real
ones, so returning seeds rather than `[]` costs nothing.

The defect: ADR 0018 — **added by this same commit** — still states the absolute the same commit's
code broke. Fork E: "Sitemapen **kastar** om ett manifest saknas i stället för att falla tillbaka",
with a paragraph arguing that any fallback is an actively false claim to Google. Fork C:98 says the
flag "stänger av golvet" while `deployment.md` (correctly) says "både golvet och sitemapens kast".
Fork E contains no occurrence of `SELECTION_ALLOW_THIN`, so the grep that closed r5's finding
structurally cannot find it. Two more absolutes in `sitemap.ts` itself survive above the exemption
they contradict: the file header (43-46, "Den KASTAR om manifestet saknas i stället för att falla
tillbaka") and the default export's block (195-200, "Låt det kasta").

Filed BLOCKING, same class and same file as r5 — this is a decision record and a future reader who
trusts it deletes the branch as a bug, turning every dependabot preview red again. Remedy is two
sentences in the ADR plus an "utom under SELECTION_ALLOW_THIN" clause in the two `sitemap.ts` sites.

NON-BLOCKING: `selectionManifest.ts:434-437`'s comment says the `fallbackIds` return is reached by
"ett bygge helt utan giltig TMDB-nyckel (CI)" — with non-empty seed lists (74/10/32) `ids.length`
is never 0 for any real caller, so CI pre-renders the SEEDS, not `SEO_FALLBACK_*`; only the tests
(`seedIds: []`) reach it. Keep the branch (Next 16 throws on empty params), fix the regime claim.
Also: `docs/org/metrics/events.jsonl` gains 9 sprint-engine rows but no row for BIN-823's own #3
critique that ADR 0018's header says ran.

Verification on these bytes: index == worktree for all 24 reviewed paths; 8 selection suites
107 passed / 4 skipped; mutant asserted present before AND after its run, restored by hash.
`.claude/agents/binge-test-reviewer.knowledge*.md` are staged `MM` — the sibling's newest lesson
(93 archive lines) is NOT in the index and will not ride this commit.

### 2026-08-09 — A correction that re-anchors a measured number must retire the formulas built on the old anchor (BIN-823 r7)

Round 6 blocked BIN-823 on a false premise inside a founder-approved decision: ADR 0018 Fork B
claimed the ratchet was "precis vad urvalet effektivt rymmer idag. Noll kostnadsrörelse", when
the realized sitemap was ~20 800 URLs and the ratchet makes the 31 000 ceiling reachable for the
first time, monotonically. Round 7 shipped the correction: a table (~20 800 → ~31 000 URLs,
~22 900 → ~33 100 page dirs, ~10 → ~14,5 GB/deploy, ~30 → ~43 GB stored, ~8,3 → ~12 SEK/mån),
phased over 2–3 months, plus an explicit "this is MORE than the +2,9 SEK #3 Financial Controller
rejected as needing its own costed ticket".

The table's own arithmetic checks out against the repo's measured numbers — `selectionManifest.ts`
lines 73–74 ("sitemapen hade 20 763 URL:er") and `.claude/rules/deployment.md` ("~22 900 filer,
~1,5 GB per deploy" + "varje deploy är ~10 GB"). 33 100/22 900 × 10 = 14,45; ×3 = 43,4 GB;
×$0,026 = $1,13; at the ADR's own implied 10,64 SEK/USD = ~12,0 SEK. (The stated delta "+~3,8"
is 3,7 from its own table — rounding, not an error. The linear scaling also ignores fixed deploy
overhead, i.e. it errs conservative/high, which is the safe direction for a cost claim.)

What the correction did NOT do is re-derive what it just invalidated. Its whole content is
"~10 GB/deploy describes today's ~22 900-page build, NOT the 31 000-page ceiling" — and two
paragraphs below, unchanged, stand:

- `docs/org/adr/0018:96` — "Vid 41 500 sidor blir det ~40 GB ≈ 11,2 SEK/mån (+2,9)". Computed as
  41 500/31 000 × 10 GB, i.e. on the retired anchor. Re-anchored it is ~19 GB/deploy → ~57 GB →
  ~15,8 SEK, i.e. +7,5 over today. The comparison the correction makes ("+3,8 is MORE than the
  +2,9 that was rejected") therefore compares a re-anchored number against an un-re-anchored one.
  The conclusion survives — it is even stronger — but the two numbers are not commensurable.
- `docs/org/adr/0018:102` — the reusable formula, explicitly written "så den inte behöver härledas
  om": `nytt_tak / gammalt_tak × 10 GB × 3 releaser × $0,026/GB/mån`. Mixes a REALIZED base (10 GB
  at 20 800 URLs) with a NOMINAL divisor (31 000), so it understates any future raise by ~45 %.
- `src/lib/tmdb/selectionManifest.ts:21` — "takets storlek (Hosting-lagring, ~10 GB/deploy × 3
  sparade releaser mot 25 SEK/mån-taket)" presents 10 GB as the price of the CEILING.
- `src/lib/tmdb/selectionManifest.ts:60-61` — the same formula, duplicated as the change-guard
  comment above `SELECTION_CEILING`, i.e. the exact place a future raise will read it.

`git grep "10 GB"` finds all four in one command, plus the two `deployment.md`/`RUNBOOK.md`
sites where "varje deploy är ~10 GB" is a MEASUREMENT of today and stays correct. The
"~31 000 sidor" figure repeated in six other comments (the fallback-disaster comparison) is
forward-looking and fine — the ratchet trends the site there; only the money math needed the
re-anchoring.

Filed blocking. Same family as r5 (the `SELECTION_ALLOW_THIN` var-grep) and r6 (Fork E's
behaviour-word contradiction), one level up: there the diff reversed a DECISION and left its
prose; here the diff corrected a NUMBER and left the arithmetic derived from it. Generalized
principle: a correction is a reversal, and the likeliest un-retired site is the paragraph
directly below the correction itself.

Also filed non-blocking this round:
- `docs/org/adr/0018:87-88` — "Malin godkände Fork B på formuleringen 'noll kostnadsrörelse' och
  **fick** den korrigerade siffran i skepp-noteringen." Past tense, written before the ship note
  exists. Same class as the 2026-08-05 "acceptance criteria met" lesson, in an ADR rather than a
  Linear ticket: if the note is never written, the decision record permanently claims she was told.
- `docs/org/metrics/events.jsonl` last line — the BIN-823 `review` row is hand-shaped and drifts
  from the schema its own README pins ("Both MUST use the canonical field names ... do not
  improvise"): `verdict` instead of `outcome`/`recommendation`, `note` instead of `plan`,
  `panel:["3"]` as a string, and no `ran`/`conflicts`/`escalations`/`rubber_stamp`/`via`. Scoring
  impact is nil (must_haves 5 + a non-empty `adrs` derive non-rubber-stamp under the documented
  legacy tolerance), but the README names this exact drift as what broke the shakedown data.
- `.claude/agents/binge-code-reviewer.knowledge.md` is 54 kB against its own stated 30 k budget.
  Not this diff's doing; it needs a compaction pass, not another addition.

Verified on these bytes: `git status --porcelain` clean apart from the staged set + unstaged
`tasks/todo.md`; index == worktree for all 32 staged paths, re-pinned after reading. Ran the
eight BIN-823 suites — 108 passed / 4 skipped (the `it.runIf` pairs), no `::warning::` annotation
leaked to the real stderr. Confirmed fixed from my earlier rounds: `titleParams.watchdog.test.ts`
now takes its own `TMDB_CACHE_DIR` (the cwd-artifact trap that turned it 11 green → 10 red),
`sitemap.ts:43-46` + `:195-200` both qualify the throw with the `SELECTION_ALLOW_THIN` exception,
Fork C says the flag switches off TWO protections, Fork E carries the exemption paragraph, and
`selectionResolve.test.ts` now READS `deploy.yml` to prove the flag is absent there (with a
`TMDB_SELECTION_REFRESH` presence check so it cannot pass on an unread file) — the property four
prose sites asserted and nothing checked.

### 2026-08-09 — BIN-823 r8 (closing): a correction that replaces a sentence's TAIL leaves its HEAD dangling
Round 7's blocking finding (Fork B's ~10 GB anchor re-anchored to the realized ~22 900 page
dirs while the arithmetic below it stayed on the retired 31 000-page anchor) is fixed at every
site I named, and I re-derived all of it from the staged blobs rather than from the briefing:

- ADR 0018 Fork B now states the anchor is MEASURED at today's ~22 900 dirs, gives the per-page
  formula `sidkataloger / 22 900 × 10 GB × 3 releaser × $0,026/GB/mån`, and carries a three-row
  table. Checked every cell against the anchor and against each other: 33 100/22 900 × 10 = 14,45
  ≈ 14,5 GB → 43 GB stored → 11,96 ≈ 12 SEK; 43 600 → 19,04 ≈ 19 GB → 57 GB → 15,74 ≈ 15,8 SEK.
  The implied USD→SEK rate (~10,6) is the same in all three rows, and page-dirs minus sitemap-URLs
  is a CONSTANT +2 100 across today / ceiling / draft — so the table is internally consistent, not
  three independently guessed numbers. Deltas: 12−8,3 = **+3,7**, 15,8−8,3 = **+7,5**,
  15,8−12 = **+3,8**, and the ADR now names which baseline each belongs to instead of mixing a
  corrected figure with an uncorrected one. My r7 "3,7 not 3,8" nit is taken.
- `selectionManifest.ts:19-28` (module header) and `:65-68` (the change-guard directly above
  `SELECTION_CEILING`) both mirror the per-page formula plus a "scaling ceiling-against-ceiling
  understates by ~45 %" warning. The 45 % is the current-ceiling case read as "the truth is 45 %
  higher than the naive figure" (14,5 vs 10); read as a share of the truth it is ~31 %, and for
  the draft raise it is ~42 % / ~30 %. Directionally right, percent-base loose — NOT filed,
  because the same comment hands the reader the formula and both computed answers, so nobody has
  to lean on the ratio.
- `seoCoverage.ts:28` now says the scheduled build's step cap is 175 min and that 150 min is the
  NAME of `REFRESH_DERIVE_TIMEOUT_MS`, a different thing. Verified against `deploy.yml:164`'s
  ternary (175 : 45) and against `buildFetch.ts:231-234` (rescue 15 min, refresh 150 min).
  ADR 0018's "kort (15 min) … långt (150 min)" is therefore CORRECT as written — it is about the
  aggregate derive cap, not the step cap. RUNBOOK §6 item 5 states both caps and gets both right.
- `.tmdb-cache` bullet: 1,9 GB at ~20 800 ids → ~2,8 GB at 31 000, ~3,8 GB at 41 500 ✓, ~19 % of
  the 10 GB repo limit ✓.

ONE non-blocking finding, and it is the r7 class running forward one splice: the same edit that
inserted the `.tmdb-cache` correction overwrote the TAIL of the sentence it replaced and left the
HEAD standing — `docs/org/adr/0018-seo-selection-ratchet.md:240` reads "… ~19 %, god marginal.
**En takhöjning till** / Samma ankarfel som i Fork B gällde här: …". No wrong number is conveyed
(the retired ~2,5 GB figure is explicitly retired two lines down), so it is editorial debris, not
arithmetic — but it sits in the exact bullet a future ceiling-raise ticket reads. Fix: delete the
three dangling words. Lesson folded in place: after correcting a number, re-read the SENTENCE the
correction was spliced into, not just every formula built on the number.

Also verified this round and clean: `events.jsonl`'s BIN-823 row against `docs/org/metrics/README.md`'s
canonical `review` schema — `panel` is an array of role NUMBERS (`[3]`) exactly as documented (the
neighbouring rows' role-name strings are the legacy shape), `must_haves` is the integer 5 matching
Fork B's "fem villkor", `rubber_stamp:false` is consistent with 5 conditions + `adrs:["0018"]`,
`ticket` and `outcome` are documented optionals; all 84 lines re-parse as JSON. The row omits the
undocumented `ran` field its neighbours carry — not a schema violation. The ADR's past-tense
approval claim is now sourced ("Hon fick den korrigerade siffran innan commit, 2026-08-09, och
svarade 'helt ok kostnad'"), which is what my r6 non-blocking item asked for.

Suite re-run from the index-clean worktree (only `tasks/todo.md` differs from the index):
9 selection-related files, 138 passed / 4 skipped (the two `it.runIf` arms), no `::warning::`
annotation leaked to the real stderr — the `selectionResolve.test.ts` / `selectionParams.test.ts`
stderr spies hold. Verdict: pass, 0 blocking.

### 2026-08-09 — a "soft retreat" timeout that cannot retreat inside its enclosing step cap (BIN-823 r9)

Ledger round 9 on the BIN-823 staged diff. Briefed delta: three comment/doc-only changes, no
behaviour. Corroborated by mtime ordering rather than pinned shas (markers are gone and the
ledger is unreadable through a tool by design): `buildFetch.ts` and `docs/RUNBOOK.md` at
01:33, `docs/org/adr/0018` at 01:28, while `selectionManifest.ts`/`seoCoverage.ts` (01:13),
`selectionResolve.test.ts` (00:57) and `sitemap.ts` (00:51) are the previous round's bytes.
`git status --porcelain` shows only `tasks/todo.md` unstaged.

**The disclosure is accurate; I verified each clause.** `src/lib/tmdb/buildFetch.ts:232-242`
now says the refresh pair does NOT work as a guard. Checked against:
- `deploy.yml:164` — `${{ (schedule || (workflow_dispatch && inputs.full_refresh)) && 175 || 45 }}`.
  So 175 on the refresh path, 45 on the push path. The pairing (15/45, 150/175) is as stated.
- `seoCoverage.ts:27-29` — "En KALL full-hämtning tar ≈ 1.5-2 h", and that time is spent in
  `fetchForBuild` from `generateMetadata`/page bodies, i.e. in "Generating static pages",
  AFTER the derive in "Collecting page data". So attributing 90–120 min to the render is fair,
  not an overstatement, and 150 + 90 > 175 holds.
- `resolveSelection` (`selectionManifest.ts:394-436`): on timeout it warns, keeps `previous`,
  and `assertCoverageFloor` passes because `previousCount` is unchanged — so the retreat is
  real code, it just has no wall-clock room on the refresh branch.

**But an accurate disclosure is not the fix, and I said so as a non-blocking recommendation.**
The lower value strictly dominates. At 150: a pathological weekly derive burns 150 min, the
step is killed at 175, the run is red, nothing deploys AND no new titles enter the ratchet. At
~45: the same run warns at 45, keeps the previous manifest, renders inside the remaining
130 min, and ships the code deploy on the old selection; the ratchet loses nothing because
next Monday retries. The risk of aborting a healthy derive is nil — the same file's
`AGGREGATE_STUCK_AFTER_MS` comment prices a healthy `collectPersonIds` at ~40 s (the 2 672 s
figure everything cites is the pathological case), so 45 min is ~65× headroom and 150 min is
~225×. General rule folded into the deploy.yml-semantics bullet: an inner timeout only
retreats if `timeout + remaining work < enclosing step cap`, so check BOTH branches of a
two-value pair against `timeout-minutes`, and derive "healthy duration" from a sibling
constant's own rationale before accepting a large one.

**Two doc propagation items, both non-blocking, both the same class as my r2/r5/r6 findings
(a round that takes a prose finding enumerates only the files IT found):**
1. `docs/RUNBOOK.md:239-249` — item 5's remedy is `gh workflow run deploy.yml -f
   full_refresh=true`, and on the very first fully-cold run that dispatch can itself go red by
   exactly the asymmetry just disclosed (cold derive + full metadata refresh > 175 min). The
   missing half is that the run is still useful: a SUCCESSFUL derive writes
   `.tmdb-cache/selection-*.json` (`writeSelectionManifest` → `buildCacheDir()` →
   `.tmdb-cache`, `buildCache.ts:40-42`), and deploy.yml's "Save TMDB build cache"
   (lines 202-212) runs `if: always() && steps.tmdb-cache.outputs.cache-primary-key != ''`,
   so the manifest survives a step timeout and a second dispatch is cheap. One line: "hinner
   den inte klart — kör den igen, urvalet är sparat." This matters because item 5 was rewritten
   THIS round precisely because its predecessor was not followable.
2. `docs/org/adr/0018:230` — "Alternatives considered" still presents `withAggregateTimeout`
   ("kort (15 min) på räddningsvägen, långt (150 min) i veckobygget") as the BIN-815 fix with
   no hint of the asymmetry. The ADR is where a future reader checks whether the weekly build
   is protected; the code comment is not reachable from there.

**Verified and clean:** the r8 editorial finding is closed — `grep -rn "takhöjning"` returns
only `docs/org/adr/0018:134` (a complete sentence: "…så en takhöjning är ett permanent
åtagande…") and an unrelated `selectionSeed.ts:17`; the dangling "En takhöjning till" fragment
is gone. Every surviving `+2,9`/`11,2` in the ADR is an explicit retraction, not a live claim.
RUNBOOK's 150→175 correction matches `deploy.yml:164`. The new phase-ordering sentence is
TRUE: `ci.yml:93` and `preview.yml:55` both set `SELECTION_ALLOW_THIN: '1'`, and under it
`selectionOrThrow` (`sitemap.ts:101-110`) returns seeds instead of throwing, so a sitemap that
ran BEFORE the params phase would be masked in both — neither can falsify the ordering. (CI's
dummy key writes no manifest at all; preview has a real key but no cache restore, so a movie/tv
manifest may exist and a person one usually won't — masked either way.)

`npx tsc --noEmit` exit 0. Re-ran the 9 selection suites WITH the local
`.tmdb-cache/selection-{movie,tv,person}.json` present (the artifact class that silently
broke `titleParams.watchdog.test.ts` in r1): 138 passed / 4 skipped, no `::warning::` leaked
to the real stderr. Verdict: pass, 0 blocking.

### 2026-08-09 — BIN-823 r10: the remedy's second half was checked against the artifact, not against the flag its own command sets

Round 10 was briefed as "your three findings addressed, nothing else changed". Verified by
reading every staged file (32 paths) rather than by trusting the delta; `git diff` (worktree
vs index) empty for all reviewed files, `git status` clean except `tasks/todo.md` (unstaged,
still BIN-679's shipped plan while HEAD/index carry BIN-815's — a `git add -A` before commit
would sweep the shipped plan back in) and `.claude/agents/binge-test-reviewer.knowledge.md`
(`MM`, a sibling reviewer editing its own knowledge mid-review).

**Finding 1 (mine, r9) — correctly refused.** I asked for `REFRESH_DERIVE_TIMEOUT_MS` 150 →
45 min. The author did the arithmetic instead and did NOT lower it: the cap must fit in
`175 − render`, render measured 90–120 min ⇒ window 55–85 min; but the only COLD derive
measurement is 2 672 s = 44,5 min for `person` alone, so 45 would kill the exact run the cap
exists to rescue by 30 seconds. My "~40 s for a healthy derive" came from the file's own
`AGGREGATE_STUCK_AFTER_MS` comment, which describes the WARM case — I priced a cold path with
a warm number. Ten minutes of margin between two n=1 measurements is not something to pick
blind; parked on BIN-826 with the full arithmetic recorded in `buildFetch.ts:243-251` and in
ADR 0018's alternatives section. Lesson folded: "document + decide with data on a ticket" is a
legitimate answer to a constants finding when both ends of the window are single measurements.

**Finding 3 (mine, r9) — taken.** ADR 0018's alternatives now states that only the rescue path
(15 inside 45) is protected, that 150 inside 175 is not, and gives the 55–85 window, the 44,5
floor and BIN-826.

**Finding 2 (mine, r9) — taken, and the fix shipped a NEW false claim.** RUNBOOK §6d item 5
now reads: "Hinner den inte klart heller: kör den igen. Ett lyckat delresultat sparas —
`writeSelectionManifest` skriver till `.tmdb-cache/`, och deploy.yml:s 'Save TMDB build cache'
körs `if: always()`, så manifesten överlever även en steg-timeout. Andra dispatchen börjar
alltså varmare, och **de typer som redan blev klara härleds inte om**." The bolded tail is
false for the command the bullet directly above it tells you to run:

- `deploy.yml:196` sets `TMDB_SELECTION_REFRESH: '1'` on `schedule` OR
  `workflow_dispatch && inputs.full_refresh`.
- `selectionManifest.ts:389-390`: `const refresh = isSelectionRefresh();
  const mustDerive = refresh || previous === null || stale || tooThin;`

So a second `gh workflow run deploy.yml -f full_refresh=true` re-derives all three types
regardless of how fresh the manifests are. The derive is TMDB list calls, which `buildCache`
never caches, so "warmer" does not shorten it either. What the surviving manifests actually
buy is (a) the coverage floor passes even if the derive times out again (`resolveSelection`
keeps `previous`), and (b) a warm DETAIL cache for the render. Skipping derivation entirely
needs the flagless path — a plain push/dispatch with fresh manifests does zero list calls,
which is the whole point of BIN-823.

Filed as 1 blocking finding, one line to fix. This is the fifth time in this ticket that the
round which took a prose finding authored a new wrong claim while correcting the old one (r2
left `buildFetch.ts` naming the now-fetch-free `sitemap.ts`; r5 fixed four
`SELECTION_ALLOW_THIN` sites and left ADR Fork E contradicted; r7 re-anchored 10 GB and left
the formula; r8 left a dangling sentence; r10 this). The generalizable check that would have
caught it in one step: a remedy is a COMMAND, so trace the command's env/regime flags into the
code they gate — do not verify only the artifact the remedy talks about.

Everything else re-verified clean this round: seed counts (74/10/32 = 116, pinned by
`selectionSeed.test.ts`), the top-level `process.stderr.write` spy now in
`selectionResolve.test.ts`'s `beforeEach` (r9 finding, closed — no `::warning::` reaches the
real stderr), `deploy.yml` still contains no `SELECTION_ALLOW_THIN` (pinned by a test that
reads the file), `ci.yml`/`preview.yml` both set it with their own stated reason, ADR 0005
retired in place rather than duplicated, and the `mergeManifest` tiebreak + the three-row
`derive vs ceiling` behaviour test unchanged.

### 2026-08-09 — BIN-823 r11: my own finding text became the repo's wrong claim, and a measurement outlived the code path that produced it

Final ledger round on the BIN-823 staged set (32 files). Three fixes were taken from r10's
findings; two of them are clean, the third inherited a defect from the way I WROTE the r10
finding.

**1. RUNBOOK item 5's re-dispatch bullet — the flag claim is now correct.** Verified against
`selectionManifest.ts:389-390` (`const refresh = isSelectionRefresh(); const mustDerive =
refresh || previous === null || stale || tooThin;`) and `buildFetch.ts:225-227`
(`TMDB_SELECTION_REFRESH === '1'`), with `deploy.yml:196` setting it on
`schedule || (workflow_dispatch && inputs.full_refresh)`. So "full_refresh … tvingar
omhärledning av ALLA tre typerna oavsett hur färska manifesten är" is true, and the escape
hatch it names (a plain deploy → `mustDerive` false → zero list calls) is true.

**2. But the sentence that replaced it mis-attributes half its own content.**
`docs/RUNBOOK.md:256-258`: "Det sparade manifestet gör i stället två saker — täckningsgolvet
passerar även om härledningen slår i taket igen, och personens rollist-fas läser från den
varma detaljcachen i stället för nätet."
 - Half one is true: derive times out → `derived.ok` false → `manifest = previous` →
   `resolvedIds(previous, seeds)` = `previousCount` → `assertCoverageFloor` passes whenever
   the previous count cleared the absolute floor.
 - Half two is NOT a property of the manifest. The cast phase's warmth comes from
   `seoPersonIds.ts:64-66` routing ~2 000 `getMovie` calls through `fetchForBuild`, which
   reads `.tmdb-cache/movie-{id}.json` (`buildCache.ts`) — a different artifact that merely
   rides the same `actions/cache` key. The manifest has zero influence on it.
 - Provenance matters: that exact pairing is MY r10 wording ("The saved manifest buys a
   passing coverage FLOOR and a warm detail cache"). The fixer transcribed it. A finding is
   not a note to the author, it is draft prose for the repo — write it as text I would pass.
   Knowledge principle updated in place (Static export bullet, r10 clause).

**3. `buildFetch.ts:262-272` — the abandoned-pipeline claim is now defensible.** "Varje
enskild förfrågan i den dör fortfarande på sin egen abort" holds on both phases (list phase
gets `signal: buildSignal` from `person/[id]/page.tsx:59`, cast phase gets its own
`buildSignal()` inside `fetchForBuild`), and "kan fortsätta dra semaforplatser och
refresh-budget" is now TRUE where the old "kan inte leva vidare obegränsat" was not: the
cast phase increments `networkFetches` (the refresh budget) and queues behind client.ts's
8-slot semaphore. Cross-reference verified: ADR 0018 really does carry a section
"Rättelse om budgetkonkurrens" (line 292) saying exactly that.

**4. The rescue-cap test now pins a margin, not an inequality.**
`selectionResolve.test.ts:226-237`: `expect(45*60_000 - RESCUE_DERIVE_TIMEOUT_MS)
.toBeGreaterThanOrEqual(RENDER_BUDGET_MS)` with `RENDER_BUDGET_MS = 25 min` and the comment
marking the 25 as an ASSUMPTION about warm-cache render time. Mutants: 44 min → −(−…) fails;
21 min → fails. The old bare `< 45 min` let 44 min survive 50/50.
`sitemap.test.ts:41-46` moved the `SELECTION_ALLOW_THIN` delete into `beforeEach` with a
corrected rationale (the exposure is a leak from another file in the same worker, which an
`afterEach` cannot prevent; this file's own setter at line 146 sits AFTER both throw-tests
in file order and could never have hit them).

**5. New, non-blocking: a measurement quoted across the change that removed its cause.**
`docs/RUNBOOK.md:261-267` predicts the first post-BIN-823 push "förväntas gå RÖD, och det går
inte att undvika", justified by "Mätt persontid 2 672 s mot 900 s tak". That 2 672 s was
measured on 2026-08-08 while `collectPersonIds` called RAW `getMovie` and bypassed the disk
cache entirely — the very thing this commit changed (`seoPersonIds.ts:60-63` says so). The
push path restores `.tmdb-cache` through `restore-keys: tmdb-cache-` (deploy.yml:148), and
`fetchForBuild` serves any entry younger than `REFRESH_AFTER_MS` (6 d) with no network, so a
warm restore leaves the derive at ~100 list pages ≈ single-digit minutes and the build can
simply go green. The figure still holds for the regimes the other three sites use it in
(evacuated cache, preview with no restore at all — preview.yml has no cache step). Left
non-blocking: the prediction is hedged and its remedy is correct either way.

Everything else in the set re-verified as unchanged from the rounds that cleared it:
`git status` clean except the stated `tasks/todo.md`, index == worktree hash for every source
file read, and the eight BIN-823 test files green in one run (108 passed / 4 skipped — the
4 are `it.runIf` branches in `titleParams.watchdog.test.ts`). Noted for the committer: the
TEST reviewer's two knowledge files were `MM` (staged copy older than the worktree) while I
worked — a sibling agent writing mid-review, same class as the concurrent-edit principle.
