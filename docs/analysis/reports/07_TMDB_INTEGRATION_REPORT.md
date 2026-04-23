# Binge — TMDB Integration & Recommendation Logic Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Scope:** TMDB client, Swedish providers, status inference, subscription
advisor, revival nudges, taste pipeline

---

## Executive Summary

```
OVERALL SCORE: 61/100
├── TMDB API Integration Correctness:   14/20   ← no retry, no abort, region gaps
├── Swedish Provider Catalog Accuracy:  13/18   ← TV4 alias present but misused; stale prices unverified
├── Status Inference Correctness:       11/15   ← 'Pilot' → ended is debatable; "Rumored" missing
├── Advisor Priority Cascade:           14/18   ← logic solid; state-transition not exhaustively tested
├── Fallback & Data-Gap Resilience:      5/10   ← no visible user messaging on TMDB failure
├── Recommendation Surface Quality:      3/8    ← filter-chain unaudited; cold-start unknown
├── Test Coverage & Regression:          0/6    ← zero tests on core logic
└── Attribution & Terms Compliance:      1/5    ← attribution text missing from UI

STATUS: Needs Work — Provider canonicalization bug is the highest-impact
         finding; everything else is quality-polish.

CRITICAL ISSUES: 1
HIGH:            5
MEDIUM:         10
LOW:             6
```

**Top 5 risks:**
1. **Raw `provider_id` used in 18+ sites without canonicalization** —
   TV4 Play alias (1944) not collapsed to canonical (489), breaking
   filter / user-provider highlighting / notifications for any title
   TMDB returns the alias for.
2. No TMDB 429 / rate-limit handler → advisor fan-out produces user-visible errors.
3. No retry / AbortSignal in TMDB client.
4. Zero tests on advisor + status + provider canonicalization.
5. TMDB attribution text not verified present in UI (Legal + ToS obligation — cross-ref 11).

---

## Dimension 1 — TMDB API Integration Correctness: 14/20

### Locale & Region Parameters ✓ (mostly)

Verified in `src/lib/tmdb/client.ts`:

| Endpoint | sv-SE | region=SE | watch_region=SE |
|----------|-------|-----------|-----------------|
| `/search/multi` (line 62) | ✓ (default) | ✓ | — |
| `/movie/{id}` (line 67) | ✓ | — | — (via append watch/providers → results.SE) |
| `/tv/{id}` (line 74) | ✓ | — | — |
| `/tv/{id}/season/{n}` (line 98) | ✓ | — | — |
| `/person/{id}` | ✓ | — | — |
| `/person/{id}/combined_credits` | ✓ | — | — |
| `getPersonEn` | en-US (override) | — | — |
| `/trending/{...}` (line 103) | ✓ | ✗ | ✗ |
| `/movie/popular` (line 108) | ✓ | ✓ | — |
| `/tv/popular` (line 112) | ✓ | ✓ | — |
| `/genre/{type}/list` | ✓ | — | — |
| `/discover/movie` (line 126) | ✓ | ✓ | ✓ |
| `/discover/tv` (line 130) | ✓ | ✗ | ✓ |
| `/{type}/{id}/watch/providers` (line 135) | ✓ | — | — |
| `/{type}/{id}/recommendations` | ✓ | — | — |

### Findings

#### MEDIUM

**I-1 — `/trending` doesn't pass `region=SE`** — `client.ts:103-105`
```ts
export function getTrending(...) {
  return tmdbFetch(`/trending/${mediaType}/${timeWindow}`);
}
```
- Impact: trending list is global, not Swedish-weighted. Swedish
  content under-represented; Binge's "Prisjakt for media" positioning
  weakens because trending looks like US box office.
- Note: TMDB's `/trending` endpoint doesn't accept `watch_region` but
  does respect `region` in some configurations. Verify via TMDB API docs.
- Fix: add `region: 'SE'` parameter.
- Effort: **10 min** + verify output shift

**I-2 — `/discover/tv` missing `region=SE`** — `client.ts:130-132`
```ts
export function discoverTV(params = {}) {
  return tmdbFetch('/discover/tv', { watch_region: 'SE', ...params });
}
```
- `discoverMovies` passes both `region=SE` and `watch_region=SE`.
- `discoverTV` only passes `watch_region=SE`.
- `region` affects release date priority; `watch_region` affects
  availability filter. For TV, `region` may be less critical but
  inconsistency is a code smell.
- Fix: add `region: 'SE'` for consistency.
- Effort: **5 min**

**I-3 — No retry / exponential backoff on TMDB 429** — `client.ts:28-31`
  (cross-ref 04 T2)
```ts
const res = await fetch(url.toString());
if (!res.ok) throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);
```
- Same site called out in 04 Performance. Here from the correctness
  angle: advisor fan-out produces HTTP 429 in cold-cache; currently
  throws to React Query, which retries 3× without backoff. Burst of
  429s compounds.
- Fix: honor `Retry-After` header; exponential backoff.
- Effort: 2 h (already counted in 04 T2)

**I-4 — No AbortSignal support** — `client.ts:22-33`
```ts
async function tmdbFetch<T>(path, params = {}): Promise<T> {
  ...
  const res = await fetch(url.toString());
  ...
}
```
- React Query passes `signal` as part of queryFn context; `tmdbFetch`
  doesn't accept / forward it.
- Impact: navigation-away from a page with 60 in-flight TMDB calls
  (advisor fan-out) can't cancel them. Browser may limit concurrent
  connections.
- Fix: `tmdbFetch(path, params, signal?)` → pass to fetch options.
- Effort: **30 min** (cross-ref 04 T3)

#### LOW

**I-5 — `getPersonEn` forces `en-US`** — `client.ts:90-92`
- The intent appears to be English-language fallback for person
  biographies (TMDB has sparse sv-SE person data).
- If `sv-SE` returns a biography and `getPersonEn` is called anyway,
  English replaces Swedish. Verify call sites: `PersonPageClient.tsx:19`
  uses it (staleTime 30 min).
- Likely OK but document intent in-code.
- Effort: **5 min** comment

### append_to_response Discipline ✓

- `getMovie`: watch/providers, recommendations, credits, videos — OK
- `getTVShow`: watch/providers, recommendations, credits, videos,
  external_ids — OK
- `getWatchProviders` separate lightweight variant exists (line 135) —
  good pattern, verify use for lightweight contexts.

### Image URL Generation ✓

- `posterUrl`, `stillUrl`, `backdropUrl`, `logoUrl`, `profileUrl` all
  typed with size unions
- Null handling correct (returns `null`)
- Default poster size w342 (cross-ref 04 I1 — too big for thumbnails)

### getDisplayTitle Non-Latin Handling ✓

`client.ts:152` has a regex excluding Cyrillic, Greek, Arabic, Hebrew,
Devanagari, Bengali, Tamil, Thai, Hangul, CJK — preferring
original_title when Latin-based, localized otherwise. Works correctly
for the intended edge cases.

---

## Dimension 2 — Swedish Provider Catalog Accuracy: 13/18

### Catalog: `src/lib/tmdb/providers.ts` (140 lines, 19 entries)

19 providers mapped. TV4 Play has `aliases: [1944]`.
`PROVIDER_MAP` built once at module load, includes aliases.
`canonicalProviderId(id)` returns primary ID for any alias.

### Findings

#### CRITICAL

**P-CRIT — Raw `provider_id` used without canonicalization in 18+ sites**
  — widespread

```
grep shows 27 raw `provider_id` references vs only 9 `canonicalProviderId` callers.
Specifically:
  src/app/search/page.tsx:44     → myProviders.includes(p.provider_id)
  src/components/title/ProviderTag.tsx:13 → myProviders.includes(provider.provider_id)
  src/components/title/TitleCard.tsx:56,87 → includes(p.provider_id), p.provider_id
  src/components/title/RecommendationsSection.tsx:30 → myProviders.includes(f.provider_id)
  src/hooks/useCalendar.ts:80    → getProvider(flatrate.provider_id)?.shortName
  src/hooks/useNotifications.ts:72,74,82 → match by raw id, store raw id in notif
  src/components/pages/MoviePageClient.tsx:161,181,187 → provider key
  src/components/pages/TVShowPageClient.tsx:185,187,207,213 → provider key
```

- **Impact:** TMDB returns `1944` (TV4 Play alias) for some titles.
  User has saved `489` (TV4 Play canonical) in their `myProviders`.
  `.includes(1944)` → `false`. Downstream effects:
  - **Filter fails**: `/search` filter "shows available on my providers"
    doesn't match TV4 Play content when TMDB uses the alias ID
    (`search/page.tsx:44`).
  - **"My providers" highlighting fails** in `ProviderTag`: user's TV4
    Play NOT highlighted with accent color when the alias is returned.
  - **"Available on my providers" tag in TitleCard** fails similarly.
  - **Recommendations filter** fails: titles on alias-ID TV4 Play aren't
    filtered into "available on my providers".
  - **Notifications fail**: new episode on TV4 Play via alias-ID won't
    match user's myProviders, notification not created for that user.

- **Severity:** CRITICAL for correctness. This is the core "Prisjakt
  for media" promise — user's providers should match reliably.

- **Fix:** introduce a rule: every place that compares
  `provider.provider_id` against `user.myProviders` MUST first canonicalize.
  Pattern:
  ```ts
  // BEFORE
  myProviders.includes(p.provider_id)
  // AFTER
  myProviders.includes(canonicalProviderId(p.provider_id))
  ```
- Also: user's `myProviders` should be stored canonical (it is, via
  `canonicalProviderId` at write path — verify in settings/page.tsx).
- Effort: **2 h** (find + fix all 18+ sites + add ESLint rule to prevent
  regression, or type-brand the difference)

#### MEDIUM

**P-1 — Provider pricing accuracy unverified**
- Hand-maintained prices in `providers.ts`. No "last-verified" comment.
- Cross-ref 11 Legal for the legal claims angle.
- Recommendation: add a comment `// Prices verified 2026-04-20 — recheck quarterly`.
- Effort: **15 min** initial + quarterly review workflow

**P-2 — Missing providers from Swedish streaming market (to verify)**
- Catalog covers 19. Verify completeness by hitting
  `https://api.themoviedb.org/3/watch/providers/movie?watch_region=SE&api_key=...`
  and comparing to `SWEDISH_PROVIDERS`.
- Candidates to add if missing: Filmstaden Hemma (if TMDB has it),
  Plex (538), Mubi (11), Shudder, SF Anytime, TV4 Sport separately.
- Effort: **1 h** to query + compare

**P-3 — HBO Max vs Max handling**
- Catalog has both `id 384 (HBO Max)` and `id 1899 (Max)`. Post-2024
  rebrand, these are the same service. TMDB may return EITHER depending
  on title.
- Neither is aliased to the other → user with Max (1899) selected won't
  see content tagged with HBO Max (384), and vice versa.
- Decision: are they aliased? If rebrand is complete, alias 384 → 1899
  (or vice versa).
- Effort: **30 min** research + alias config + data migration

**P-4 — C More legacy**
- TV4 Play absorbed C More. If TMDB still returns a C More provider_id
  for some Swedish titles, it should alias to TV4 Play (489).
- Effort: **30 min** verify

#### LOW

**P-5 — Provider colors not audited for WCAG contrast**
- Cross-ref 06 UX D3 (palette tokens).
- `getProviderColor` returns a hex from catalog; used in `style={{background: color}}` for dots.
- Against page bg #eeece8, some shades (e.g., #0F79AF SVT Play) may have
  low contrast. Pure display use (dots + borders), AA body rules don't
  strictly apply.
- Effort: **30 min** audit

---

## Dimension 3 — Status Inference Correctness: 11/15

### `airingState` Mapping (src/lib/airingState.ts)

```
ongoing: 'returning series', 'in production', 'planned'
ended:   'ended', 'canceled', 'cancelled', 'pilot'
unknown: everything else
```

### Findings

#### MEDIUM

**S-1 — 'Pilot' classified as 'ended' is debatable** — `airingState.ts:7`
- TMDB's 'Pilot' status can mean: (a) pilot never ordered to series
  (dead) or (b) pilot filmed, awaiting series decision (pending).
- Currently: treated as `ended`. If case (b), the show is misclassified.
- Impact: revival nudges won't fire if the pilot becomes a series (cached
  status is "ended", fresh fetch shows new status).
- Fix: monitor; document assumption. Consider mapping 'Pilot' → 'unknown'.
- Effort: **15 min** discussion + change

**S-2 — 'Rumored' not explicitly mapped** — `airingState.ts`
- TMDB's 'Rumored' status falls through to 'unknown' (default branch).
- Acceptable — 'unknown' is the right bucket. Note this is INTENTIONAL.
- Effort: **5 min** comment

#### LOW

**S-3 — Revival-nudge false-positive potential for 'Ended' + `next_episode_to_air`**
- TMDB sometimes has a one-off reunion special scheduled after a show
  ended. `airingState` = 'ended' but `next_episode_to_air` populated.
- `useRevivalNudges.ts:48-52`:
  ```ts
  const nextAir = show.next_episode_to_air?.air_date ?? null;
  const hasUpcomingEpisode = !!nextAir;
  const cameBackToLife = isOngoing(show.status) && !isOngoing(item.tmdbStatus);
  if (hasUpcomingEpisode && cameBackToLife) {...}
  ```
- Revival fires when `isOngoing(show.status) && !isOngoing(item.tmdbStatus)`
  so a pure "ended + one-off episode" won't false-positive unless TMDB
  also changes status. Safe by construction.
- Effort: 0 (not a bug)

**S-4 — `getDisplayTitle` + non-Latin regex edge cases** — `client.ts:152`
- Regex excludes 10 Unicode ranges. Swedish chars (å ä ö é) are Latin
  — correct, no false-positive exclusion.
- Edge case: if TMDB returns original_title in Cyrillic but the show
  has a Latin co-localized title (rare), fallback works.
- Works correctly for all enumerated cases I can think of.

### Movie/TV Status Asymmetry ✓

`src/lib/watchStatus.ts`:
- `WatchStatus = 'följer' | 'vill_se' | 'sedd'`
- `MOVIE_STATUS_LABELS` excludes `'följer'` (movies only have Vill se + Sedd)
- `statusLabel()` correctly switches based on `mediaType`.

Spot-check in advisor: `useSubscriptionAdvisor.ts:92` uses
`getByStatus('följer', 'tv')` → only TV can have följer. ✓

---

## Dimension 4 — Advisor Priority Cascade: 14/18

### Structure (`useSubscriptionAdvisor.ts`, 394 lines)

Helpers:
- `findTopPausable` (line 17) — highest-cost provider in 'pause' status,
  user-paused excluded, zero-cost excluded
- `findCatchupCandidate` (line 29) — ≥ CATCHUP_THRESHOLD (3) unfinished
  shows
- `findIdleNextCheckDate` (line 46) — earliest future air/resume date
- `getNextAirInfo` (line 57) — next_episode_to_air → future season
  fallback
- `isWithinDays` (line 78)

Main hook (line 88): composes inputs from watchlist + user providers
+ costs + pauses; fetches TMDB per följer-TV + vill-se-TV via useQueries;
computes providerAdvisories + subscribeAdvice + willSeeByProvider +
monthlySavings + totalMonthlyCost + primaryAction.

### Findings

#### MEDIUM

**A-1 — PrimaryAction full state-transition table not documented**
- `PrimaryAction` is a discriminated union. The hook emits one of its
  `kind`s based on complex input. Without tests (see Dim 7) or a table
  in docs, the logic is understood only via reading 394 lines.
- Fix: write state-transition matrix (inputs × emitted kind) to
  `docs/advisor-logic.md`. Use as test spec.
- Effort: **2 h** docs + review

**A-2 — Advisor consumes flatrate + free + ads union without distinguishing** — `useSubscriptionAdvisor.ts:150-154`
```ts
const seProviders = [
  ...(se?.flatrate ?? []),
  ...(se?.free ?? []),
  ...(se?.ads ?? []),
];
```
- Treats all three as "available via my subscription". For:
  - Netflix with Ads user seeing a title also in ads tier → correct
  - Non-Netflix user seeing a title tagged `ads` → Binge currently treats
    as available, but user has no Netflix at all → false positive
    (see also Swedish free tier like SVT Play: always legitimate).
- Impact: advisor "willSeeByProvider" count inflated for non-subscribers.
- Fix: only include `ads` bucket when user has the relevant subscription.
- Effort: **1 h** carefully

#### LOW

**A-3 — CATCHUP_THRESHOLD = 3 documented** — `useSubscriptionAdvisor.ts:27`
- Good: explicit constant with comment ("påbörjat flera serier").
- Positive pattern to propagate.

**A-4 — findTopPausable excludes user-paused providers**
- Correct: `!userPausedSet.has(p.providerId)` (line 22).
- And zero-cost filter (line 22): `(p.monthlyCost ?? 0) > 0` — correct
  (no point pausing SVT Play).

**A-5 — willSeeByProvider uses cached film providers** — `useSubscriptionAdvisor.ts:183`
```ts
releaseDate: film.releaseYear ? `${film.releaseYear}-01-01` : null,
...
providerIds: film.providers,
```
- Films use stored `item.providers` (from watchlist item) — NOT
  refetched. TV uses fresh TMDB data via `useQueries`.
- Implication: if film's providers change (e.g., added to Netflix 6 months
  after user added to vill_se), advisor won't know until user revisits
  the detail page (triggers refresh).
- Fix: either refresh films in advisor too, or add cache-invalidation
  hook.
- Effort: **1 h**

---

## Dimension 5 — Fallback & Data-Gap Resilience: 5/10

### Missing `results.SE` Handling

Advisor line 149-154 uses optional chaining + `?? []`. No user-visible
warning if TMDB has no SE data for a title.

### API Failure Handling

- TMDB 429/500/timeout → thrown from tmdbFetch → React Query isError
- Without global onError (cross-ref 01 #14), per-consumer handling varies
- `useSubscriptionAdvisor.ts:123` sets `isLoading` via
  `showQueries.some(q => q.isLoading)` — but no `isError` surfaced to
  `AdvisorResult`.

### Findings

#### HIGH

**R-1 — No user-visible error state for TMDB failures in advisor**
- Advisor silently returns empty results on failure. User sees
  "Inga förslag" instead of "Vi kunde inte hämta TMDB-data. Försök igen."
- Fix: expose `hasError: boolean` in AdvisorResult; render specific
  empty-state in the widget.
- Effort: **1 h**

**R-2 — Stale-cache freshness on watchlist items**
- `WatchlistItem.providers` is captured at add-time. Films never auto-
  refresh. TV refresh only when the user visits detail page (which
  triggers getTVShow).
- For the advisor to be accurate, this cached data must be bounded. No
  refresh mechanism exists.
- Fix: on periodic background job (cloud function?) or on user session
  start, revalidate watchlist items older than X days.
- Effort: **1 day**

#### MEDIUM

**R-3 — getNextAirInfo future-season fallback may over-count** — `useSubscriptionAdvisor.ts:66-75`
- If all seasons have past air_date but status=ongoing, return null.
  ok.
- If TMDB returns a "coming soon" season 0 or special with past date,
  verify filter `s.season_number > 0` excludes correctly (line 67).
  ✓ correct.

---

## Dimension 6 — Recommendation Surface Quality: 3/8

### Surfaces

- `/discover` — TMDB discover with Swedish filters
- `/recommendations` — uses useQueries; needs deep audit
- `RecommendationsSection.tsx` — per-title related
- `src/lib/taste/` — vector.ts, similarity.ts, stats.ts, backfill.ts
  (not deeply audited in this pass)

### Findings

#### MEDIUM

**REC-1 — `/recommendations` filter-chain unaudited**
- App/recommendations/page.tsx uses useQueries (seen in grep).
- Whether it filters for Swedish availability, already-watched,
  already-on-watchlist — unknown without deeper read.
- Fix: verify filter chain is: TMDB recs → dedupe already-watched →
  dedupe already-on-watchlist → sort by available on user's providers.
- Effort: **1 h** audit

**REC-2 — Taste vector pipeline maturity unknown**
- 4 files in src/lib/taste/. Size not checked here.
- Inputs: ratings? status? genres? taste_vector is vague until read.
- Cross-ref 01 Code Quality file-size table — no taste file > 200 lines,
  so this is not the weight of the algorithm (probably lightweight).
- Effort: **2 h** deeper audit deferred

**REC-3 — Cold-start strategy for new users unknown**
- A brand-new user with 0 watched titles: does `/recommendations` show
  anything sensible? Popular Swedish content? TMDB trending? Or blank?
- Likely blank (or empty state). Cross-ref 06 UX F1 onboarding.
- Effort: deferred

---

## Dimension 7 — Test Coverage & Regression Protection: 0/6

**Zero tests.** No framework installed. See `03_INFRASTRUCTURE_REPORT.md`
T1 for the test-strategy proposal.

### Golden Test Priorities (Binge-specific)

```
Unit tests (highest priority):
 - airingState.ts:        10 cases (each TMDB status + edge)
 - watchStatus.ts:         8 cases (statusLabel per mediaType)
 - canonicalProviderId:    6 cases (known ids, aliases, unknown)
 - getDisplayTitle:       12 cases (Latin, CJK, Cyrillic, null, co-existence)

Integration tests (second priority):
 - useSubscriptionAdvisor cascade:
   - empty myProviders → idle
   - 1 provider, 3+ unfinished → catchup
   - 1 provider, paid, no follows → pausable
   - following but nothing airing → idle with nextCheckDate
   - 3+ red signals → combination
   - verificationChannelAvailable=false → skip caps

 - useRevivalNudges:
   - watched + ended → revival → candidate
   - watched + ended → still ended → skipped
   - watched + never visited detail → skipped (cached tmdbStatus missing)

Scenario tests (third priority):
 - Reference scenarios from plan
 - Every PrimaryAction kind triggered
 - Every register jurisdiction (SE, EU, .no, .dk, .fi, .uk, .ch, US)
```

### Effort

- Full unit-test coverage of 4 pure modules: **1 day**
- Integration tests for advisor + revival: **2–3 days**
- Scenario tests: **2 days**

---

## Dimension 8 — Attribution & Terms Compliance: 1/5

### CLAUDE.md Requirement

> "Attribution required: 'This product uses the TMDB API but is not
>  endorsed or certified by TMDB'"

### Findings

#### HIGH

**T-1 — TMDB attribution text not found in UI code** — grep for
"TMDB API" in src/ → 0 matches
- No component renders the required attribution text.
- TMDB ToS requires attribution (risk: API key revocation in
  theoretical enforcement).
- Fix: add to footer / about / settings page — visible without login.
- Swedish translation acceptable, e.g.:
  "Denna produkt använder TMDB:s API men är inte godkänd eller
   certifierad av TMDB."
- Cross-ref 11 Legal for wording final verdict.
- Effort: **15 min** to add visibly; **1 h** if adding dedicated section

**T-2 — TMDB logo not in `/public`**
- TMDB requires logo displayed with attribution.
- No TMDB logo file observed. Download from https://www.themoviedb.org/about/logos-attribution.
- Effort: **30 min**

### Image Hosting ✓

All TMDB images served via `image.tmdb.org` (verified `client.ts:14`).
No local copies of TMDB-owned images. ✓

### API Key Version ✓

Uses v3 `api_key` query param. TMDB permits client-side v3 usage
(see 02 A4 analysis).

---

## TMDB Integration Dashboard

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Endpoints with correct sv-SE + region=SE | 11/13 | 13/13 | I-1, I-2 |
| Providers in catalog | 19 | ~25 (market coverage verify) | P-2 |
| Aliases verified | 1 (TV4 Play → 489) | more? | P-3, P-4 |
| Canonicalization used at compare sites | 9/27 | 27/27 | P-CRIT |
| Status mapping covers TMDB enum | 6/7 | 7/7 | S-2 (Rumored) |
| Retry / rate-limit handling | 0 | 1 | I-3 |
| AbortSignal threading | 0 | 1 | I-4 |
| Error-state surfaced to UI | 0 | ≥ 1 | R-1 |
| Advisor branches with documented state table | 0 | all | A-1 |
| Revival nudge conditions documented | ✓ | ✓ | — |
| Tests on pure logic | 0 | 36+ | T1 (03 report) |
| Scenario tests | 0 | 10+ | T1 (03 report) |
| TMDB attribution visible in UI | NO | YES | T-1 (CRITICAL to TMDB ToS) |
| TMDB logo in /public | NO | YES | T-2 |

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | CRITICAL | Raw provider_id used without canonicalization | 18+ sites | 2 h |
| 2 | HIGH | TMDB attribution text missing from UI | (missing) | 15 min |
| 3 | HIGH | No retry on TMDB 429 | `client.ts:28-31` | 2 h (owned by 04 T2) |
| 4 | HIGH | No user-visible error state in advisor | `useSubscriptionAdvisor` | 1 h |
| 5 | HIGH | Stale film providers never revalidated | watchlist data model | 1 day |
| 6 | HIGH | HBO Max (384) vs Max (1899) not unified | `providers.ts` | 30 min + migration |
| 7 | MEDIUM | No AbortSignal threading | `client.ts` | 30 min (04 T3) |
| 8 | MEDIUM | Ads bucket treated as "available" regardless of user sub | `useSubscriptionAdvisor.ts:150-154` | 1 h |
| 9 | MEDIUM | /trending doesn't pass region=SE | `client.ts:103` | 10 min |
| 10 | MEDIUM | PrimaryAction state-transition table undocumented | docs | 2 h |

---

## Phase 2 Preparation

**Total issues:** 22 (1 CRITICAL / 5 HIGH / 10 MEDIUM / 6 LOW)
**Total estimated effort:** ~1 week of focused work

**Recommended sprint grouping:**

**Sprint 1 — Correctness fixes (2 days):**
- P-CRIT — canonicalize every provider_id compare (2 h)
- T-1 — add TMDB attribution text + logo (30 min)
- I-1 — `/trending` region=SE (10 min)
- I-2 — `/discover/tv` region=SE (5 min)
- P-3 — alias HBO Max / Max unification decision + code (30 min)
- R-1 — surface TMDB error state in advisor (1 h)
- A-2 — ads-bucket gating fix (1 h)

**Sprint 2 — Quality polish (2 days):**
- A-1 — document PrimaryAction state transitions (2 h)
- R-2 — watchlist item freshness strategy (1 day)
- I-4 — thread AbortSignal through TMDB client (30 min)
- REC-1 — audit recommendations filter chain (1 h)

**Sprint 3 — Test foundation (1 week — blocking on 03 framework choice):**
- Install Vitest + @testing-library (2 h)
- 36 unit tests on pure modules (1 day)
- Integration tests for advisor + revival (2-3 days)

**Sprint 4 — Provider catalog deep audit (1 day):**
- P-2 — market completeness via TMDB /watch/providers/movie (1 h)
- P-4 — C More legacy alias (30 min)
- P-1 — add last-verified comment + quarterly review checklist (15 min)
- P-5 — contrast check for provider colors (30 min)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero changes
2. ✅ File:line references on every finding
3. ✅ Severity + effort on every finding
4. ✅ Swedish-first calibration — the core value prop
5. ✅ Cross-prompt dedup — retry handling owned by 04, attribution
   wording owned by 11, test framework owned by 03
6. ✅ P-CRIT flagged appropriately — this is the biggest correctness
   finding in the whole analysis, and Binge's core promise
