# TMDB Integration & Recommendation Logic Analysis

## Analyst

Claude (Opus 4.7) — comprehensive TMDB-data and recommendation-pipeline analysis agent.

## Mission

Perform a forensic-level investigation of Binge's TMDB integration, Swedish provider
mapping, status inference, and the streaming advisor (`useSubscriptionAdvisor` +
`useRevivalNudges` + `useAdvisorTimeline`). This is Binge's **most differentiated
capability**: the app lives or dies on whether it (a) shows correct Swedish provider
availability, (b) correctly interprets TMDB's show-lifecycle fields into a coherent
"Följer"/ongoing/ended/revival signal, and (c) produces advisor output that is
trustworthy, calm, and actionable.

None of the other 10 analysis prompts evaluate whether the TMDB data actually lands
as correct advice. Security (02) checks the API-key exposure. Performance (04) checks
request fan-out and cache. Neither asks whether provider 1944 is handled as an alias
of 489, or whether a show that ended in TMDB but has `next_episode_to_air` populated
(a real TMDB corner case for limited-series "specials") collapses the advisor into
the wrong bucket.

This is not a superficial review. This is a deep investigation across 8 weighted
dimensions of TMDB-and-advisor quality, totaling 100 points.

**Cross-Prompt Boundaries**:
- TMDB API-key exposure (`NEXT_PUBLIC_TMDB_API_KEY`) and client-side leakage risk:
  covered in `02_SECURITY_AND_COMPLIANCE.md` — skip here.
- TMDB rate-limit handling, request fan-out cost, React Query cache tuning:
  covered in `04_PERFORMANCE_AND_SCALABILITY.md` — skip here.
- TMDB attribution string accuracy in legal documents: covered in
  `11_LEGAL_REVIEW.md` — skip here.
- Advisor UX (copy, calm-overview design, information hierarchy): covered in
  `06_UX_DESIGN_AND_I18N.md` — skip here. This prompt owns the **logic**; 06 owns
  the **rendering**.
- Competitive benchmark of provider coverage vs JustWatch/Reelgood: covered in
  `10_MONETIZATION_AND_COMPETITIVE_POSITIONING.md` — skip here.

This prompt owns: TMDB endpoint usage correctness, Swedish regional parameters,
provider catalog completeness and accuracy, alias/canonicalization correctness,
status inference (`airingState`, `tvShowStatusLabel`, `watchStatus`), advisor
priority cascade, revival-nudge logic, pause tracking, cost calculations, and
fallback behavior when TMDB data is missing or contradictory.

---

## Two-Phase Approach

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

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), TypeScript, React 18
Data layer:          React Query v5 (staleTime 5 min default;
                     TV detail queries use 10 min in advisor,
                     24 h in revival nudges)
Rendering model:     Client-side only SPA, no SSR
External API:        TMDB API v3 — single integration, client-side calls
Hosting:             Firebase Hosting + Cloudflare CDN

TMDB client (src/lib/tmdb/client.ts, 161 lines):
  - tmdbFetch<T>(path, params) hard-codes language=sv-SE
  - API key from process.env.NEXT_PUBLIC_TMDB_API_KEY (client-exposed)
  - Endpoints used:
      search/multi            (with region=SE)
      movie/{id}              (append_to_response: watch/providers,
                               recommendations, credits, videos)
      tv/{id}                 (append_to_response: watch/providers,
                               recommendations, credits, videos, external_ids)
      tv/{id}/season/{n}
      person/{id}             (getPersonEn variant forces language=en-US)
      person/{id}/combined_credits
      trending/{mediaType}/{window}
      movie/popular           (region=SE)
      tv/popular              (region=SE)  — NOTE: no region param spec on tv/popular
                                             actually — verify code
      genre/{type}/list
      discover/movie          (region=SE, watch_region=SE)
      discover/tv             (watch_region=SE ONLY — no region param)
      /{type}/{id}/watch/providers
      /{type}/{id}/recommendations
  - Helpers: posterUrl, stillUrl, backdropUrl, logoUrl, profileUrl,
             extractYear, getDisplayTitle, getReleaseYear
  - getDisplayTitle heuristic: non-Latin original_* → localized (sv-SE) fallback
    using a regex for Cyrillic/Greek/Arabic/Hebrew/Devanagari/Bengali/Tamil/Thai/
    Hangul/CJK ranges
  - NO retry logic
  - NO rate-limit handling (TMDB allows ~40 req/10s/IP)
  - NO timeout on fetch()
  - NO AbortController / cancellation

Swedish provider catalog (src/lib/tmdb/providers.ts, 137 lines):
  - 19 SwedishProvider entries total
  - 16 flatrate, 3 rent-only (Rakuten, Google Play, Apple TV rent)
  - Key data per provider: id (TMDB provider_id), name, shortName, color,
    type, defaultMonthlyCost, optional tiers[], optional aliases[]
  - TV4 Play has aliases: [1944] — canonicalProviderId(1944) returns 489
  - PROVIDER_MAP built once at module load, includes aliases
  - getProvider(id), canonicalProviderId(id), getProviderColor(id)
  - Tiers (ads/free/standard/premium) defined for:
      Netflix, Disney+, HBO Max, Viaplay, TV4 Play, Max, SkyShowtime,
      Crunchyroll, YouTube Premium, Discovery+

Status system:
  - WatchStatus = 'följer' | 'vill_se' | 'sedd'  (user-preferred unified status)
  - MOVIE_STATUS_LABELS excludes 'följer' (movies never Follow)
  - airingState(tmdbStatus) → 'ongoing' | 'ended' | 'unknown'
      ongoing: 'Returning Series', 'In Production', 'Planned'
      ended:   'Ended', 'Canceled', 'Cancelled', 'Pilot'
      unknown: everything else (including null/undefined)
  - tvShowStatusLabel maps TMDB status strings to Swedish labels

Subscription advisor (src/hooks/useSubscriptionAdvisor.ts, 393 lines):
  - Inputs: watchlist (följer TV + vill_se movies+TV) + user.myProviders
           + user.providerCosts + user.providerPauses
  - Fetches TMDB detail per tracked TV show via useQueries (staleTime 10 min)
  - Movie providers are read from the watchlist item's stored providers field
    (NOT refetched from TMDB)
  - For each TV show, reads watch/providers.results.SE and unions
      flatrate + free + ads
    into seProviders (explicit union at line 150–154)
  - Uses canonicalProviderId on every provider_id from TMDB
  - Only considers myProviders with type === 'flatrate' for advisories
  - Priority cascade for primaryAction:
      1. idle (myProviders empty)
      2. [full cascade to be documented by investigation]
  - CATCHUP_THRESHOLD = 3: only nag about a provider if ≥3 unfinished shows
  - findTopPausable: excludes user-paused providers and zero-cost providers
  - findIdleNextCheckDate: earliest of provider.nextAirDate and ap.resumeAt

Revival nudges (src/hooks/useRevivalNudges.ts, 60 lines):
  - Candidates: watched TV items with cached tmdbStatus (user visited detail page)
  - MAX_CHECKS = 20 (prevents fan-out on large libraries)
  - Sort by watchedAt DESC, take first 20
  - staleTime 24 h
  - A nudge fires when:
      show.next_episode_to_air.air_date is populated AND
      isOngoing(show.status) === true AND
      isOngoing(item.tmdbStatus) === false
    (i.e., show was ended/unknown when user marked it watched, and has
     now flipped back to ongoing with an upcoming air date)

Generated / ignored files: .next/, node_modules/, out/, .firebase/
```

---

## Investigation Framework: 8 Dimensions (100 Points Total)

### Dimension 1: TMDB API Integration Correctness (20 points)

**Investigation Scope**: Is every TMDB endpoint called with correct Swedish-locale
parameters, correct `append_to_response` values, and correct error handling?

**Specific Investigation Tasks:**

1. **Locale & Region Parameters**
   ```
   CLAUDE.md rule: Always use language=sv-SE AND watch_region=SE.

   Verify every endpoint in src/lib/tmdb/client.ts:
   - Is language=sv-SE always set? (tmdbFetch sets it unconditionally — confirm
     no caller overrides it to a different value)
   - Is watch_region=SE set where it matters?
       discoverMovies: region=SE + watch_region=SE   (CORRECT)
       discoverTV:     watch_region=SE only          — is region=SE missing intentional?
       searchMulti:    region=SE                     — no watch_region (acceptable?)
       getPopularMovies / getPopularTV: region=SE
   - person/{id} calls use sv-SE. getPersonEn forces en-US as a fallback —
     is there a path where sv-SE data exists and en-US override produces
     worse data (e.g., missing biography)?

   Search patterns:
   - All tmdbFetch() call sites across the codebase
   - Any direct fetch() to api.themoviedb.org outside the client wrapper
   ```
   - Document every inconsistency with file:line
   - Flag region=SE gaps: if `/trending` and `/search/multi` don't respect
     region, provider availability for results may be misleading

2. **append_to_response Discipline**
   ```
   getMovie appends: watch/providers, recommendations, credits, videos
   getTVShow appends: watch/providers, recommendations, credits, videos, external_ids

   Check:
   - Is any downstream code reading a field that isn't appended?
     (e.g., reading images/, season-level providers without appending them)
   - Is anything over-appended (fetched but never read)? Each append costs bytes.
   - Is there a separate lightweight getWatchProviders(mediaType, id) for cases
     that don't need credits/videos? YES (client.ts:135) — verify it's used
     where appropriate (search, quick-preview flows)
   ```
   - Map every TMDB detail consumer → the append_to_response payload it needs
   - Flag mismatches with severity (Medium if over-fetching, High if under-fetching)

3. **Error Handling & Retry**
   ```
   Current state (client.ts:28–31):
     const res = await fetch(url.toString());
     if (!res.ok) throw new Error(`TMDB API error: ${res.status} ${res.statusText}`);

   Check:
   - What happens on 429 (rate limit)? No retry, no Retry-After header read.
   - What happens on 503 / 504 (upstream)? No retry.
   - What happens on network error (offline)? fetch() rejects → React Query
     retries 3 times by default — is this the actual retry policy?
   - Is the error message ever shown to users, and is it in Swedish?
     (CLAUDE.md: UI is Swedish; error messages matter.)
   - Is there a global React Query onError hook, or per-query error handling?
   ```
   - Document all error paths
   - Flag missing 429 handling as HIGH (TMDB's 40 req/10s limit is real)

4. **Request Cancellation**
   ```
   Check:
   - Does tmdbFetch accept an AbortSignal? (Current: no)
   - Do long-running fan-outs (useQueries in advisor, revival nudges) cancel
     when the user navigates away?
   - React Query handles query cancellation via signal — is signal plumbed
     through to fetch()? (Current: no — adding this is a Medium-effort quick win)
   ```

5. **Image URL Generation**
   ```
   Check posterUrl, stillUrl, backdropUrl, logoUrl, profileUrl:
   - All size params typed as unions (good)
   - Null path handling: returns null (good)
   - Do any callers pass invalid sizes (type system should catch, but check
     any `as const` casts or string coercion)
   - Are images lazy-loaded in the UI? (Cross-ref to 04 Performance — but note
     here if TMDB paths are used raw in <img src>, bypassing next/image)
   ```

**Files to audit:**
- `src/lib/tmdb/client.ts` (all 161 lines)
- Every file importing from `@/lib/tmdb/client`
- `src/hooks/useTMDB.ts` (if it wraps client further)

**Output Required:**
- Endpoint matrix: endpoint × parameters × callers × correctness
- Missing region/locale parameters with user impact assessment
- Error-handling coverage table (status code × handling × user-facing message)
- Retry/cancellation gap inventory
- Quick wins vs refactors

---

### Dimension 2: Swedish Provider Catalog Accuracy (18 points)

**Investigation Scope**: Does `SWEDISH_PROVIDERS` accurately reflect the current
Swedish streaming landscape, and does the alias/canonicalization system
correctly collapse TMDB's duplicate provider_ids?

**Specific Investigation Tasks:**

1. **Catalog Completeness**
   ```
   Current 19 providers:
     Netflix (8), Prime Video (119), Disney+ (337), HBO Max (384),
     Viaplay (76), SVT Play (520), TV4 Play (489 + alias 1944),
     Apple TV+ (350), Paramount+ (531), Discovery+ (510), Max (1899),
     Crunchyroll (323), SkyShowtime (431), YouTube Premium (335),
     Tele2 Play (521), TriArt Play (578),
     Rakuten TV (35), Google Play Movies (3), Apple TV rent (2)

   Check:
   - Missing Swedish-relevant providers? Candidates to verify:
       Plex (538), Filmstaden Hemma (if TMDB has it), C More (historically
       rolled into TV4 Play, but may still appear), SF Anytime, BLCKBX,
       Mubi, Shudder, Curiosity Stream, History Play
   - Nordic-only providers that TMDB lists: verify each has correct SE coverage
   - Providers that left Sweden but TMDB still returns (e.g., Showtime rebranded)

   Method:
   - Hit TMDB /watch/providers/movie?watch_region=SE and /watch/providers/tv?watch_region=SE
     (via browser or curl) and compare against SWEDISH_PROVIDERS
   - List unmapped provider_ids returned by production usage
   ```
   - Document every gap with severity (High if user-owned tier is missing,
     Medium for edge providers)

2. **Alias & Canonicalization Correctness**
   ```
   Current: TV4 Play has aliases: [1944]. canonicalProviderId(1944) → 489.

   Investigation:
   - Is 1944 verified as TV4 Play via a TMDB lookup? (Comment in providers.ts:58
     says so)
   - Are there OTHER known TMDB duplicates for Swedish providers?
       HBO Max vs Max rebrand (384 vs 1899) — these are DIFFERENT services
       historically. Verify: should 384 be aliased to 1899, or do both still
       exist in TMDB returns? (Check producrion data for titles that only
       return one.)
       Disney+ (337) — any ads-tier duplicate id?
       Viaplay — historically had a separate "Viafree" id?
       SVT Play (520) — any separate "SVT Barn" id?
   - Is canonicalProviderId called EVERYWHERE TMDB provider_ids leave the
     client layer? Search:
       grep for p.provider_id usage that doesn't go through canonicalProviderId
       grep for results.SE parsing outside of advisor/search/title components
   ```
   - Document missing alias mappings
   - Flag any place that stores raw TMDB provider_id (will cause duplicate
     pills and miscounted "user owns this") — CRITICAL

3. **Tier Accuracy & Pricing Freshness**
   ```
   Current tiers (prices in SEK/month, from providers.ts):
     Netflix: Basic 109, Standard 149, Premium 199
     Disney+: ads 69, standard 109, premium 159
     HBO Max: ads 89, standard 149, premium 189
     Viaplay: reklam 79, standard 169, medium 399, total 699
     TV4 Play: plus-ads 69, plus 169, sport 699
     Max: ads 89, standard 149, premium 189
     SkyShowtime: ads 59, standard 99, premium 149
     Crunchyroll: fan 89, megafan 119
     YouTube Premium: student 95, solo 149, family 279
     Discovery+: entry 49, ads 89, premium 189, sport 349

   Check:
   - When were these last verified? (git blame providers.ts)
   - Are there visible mismatches with current provider websites?
     (Methodology: sample-check 3-5 providers against public pricing pages,
     flag discrepancies — don't attempt to re-verify all 19.)
   - Does the app surface a "prices may be outdated" disclaimer anywhere?
     (Cross-ref to 11 Legal for pricing-accuracy claims.)
   - Tier-switching logic: when a user picks a tier, does providerCosts
     override defaultMonthlyCost? (Expected yes — verify)
   ```
   - Flag stale prices as MEDIUM
   - Flag any provider whose tier list is clearly incomplete (missing
     entry-level plan, etc.) as HIGH

4. **"ads" and "free" Bucket Handling**
   ```
   Advisor unions flatrate + free + ads from TMDB results.SE
   (src/hooks/useSubscriptionAdvisor.ts:150–154).

   Check:
   - Is this correct for Binge's "can I watch this" semantics?
     - flatrate = subscription (Yes, clearly)
     - free = free with account (SVT Play, TV4 Play free tier) — Yes
     - ads = ad-supported tier (Netflix with Ads, Disney+ ads) — correct
       only if user is OK with ads; some users explicitly opted out of ads
       tier via tier selection in settings.
   - Does the advisor respect the user's tier choice?
     (e.g., if user has Netflix Standard (no ads), should "ads" hits still
     count as "available via my subscription"? Probably YES because the user
     pays for broader Netflix access. But if user has no Netflix subscription,
     should "ads" count as "free to watch"? Only if Netflix offers ads-only
     free tier — it doesn't. So "ads" != "free". Flag if advisor treats them
     identically.)
   - Are rent/buy ever merged into the "available" set? (Should not be —
     CLAUDE.md says flatrate is subscription; rent/buy are separate.)
   ```

5. **Color & Brand Consistency**
   ```
   getProviderColor returns #888 fallback. Check:
   - Every provider has a color set (currently yes — spot-check)
   - Colors match current brand guidelines (Max rebrand: #002BE7 vs old HBO purple
     #7B2FBE — is this correct post-rebrand?)
   - Accessibility: do color pairings vs #eeece8 background meet WCAG
     contrast? (This is cross-ref to 06 UX — do not score here, just note.)
   ```

**Files to audit:**
- `src/lib/tmdb/providers.ts` (all 137 lines)
- `src/components/title/ProviderTag.tsx`
- `src/hooks/useSearchProviders.ts`
- `src/app/settings/page.tsx` (provider selection UI)
- Every file referencing `getProvider`, `canonicalProviderId`, `getProviderColor`

**Output Required:**
- Provider catalog completeness matrix (Swedish market vs code)
- Alias-mapping correctness verification
- Tier/price accuracy sample audit
- Ads/free/flatrate semantic-consistency assessment
- Effort estimates

---

### Dimension 3: Status Inference Correctness (15 points)

**Investigation Scope**: Do `airingState`, `tvShowStatusLabel`, `watchStatus`,
and their consumers correctly interpret TMDB's show-lifecycle fields?

**Specific Investigation Tasks:**

1. **airingState Coverage of TMDB Status Strings**
   ```
   Current mapping (src/lib/airingState.ts:3–9):
     ongoing: 'returning series', 'in production', 'planned'
     ended:   'ended', 'canceled', 'cancelled', 'pilot'
     unknown: else (including null/undefined)

   Check against TMDB's actual status enum:
     TMDB documented statuses: "Returning Series", "Ended", "Canceled",
     "In Production", "Planned", "Pilot", "Rumored"
   - "Rumored" is missing → returns 'unknown'. Is that correct? Probably yes
     (can't make claims about rumored shows).
   - "Pilot" classified as 'ended' (airingState.ts:7) — but a pilot might be
     a pending first episode, not a dead show. Check: is this ever wrong
     for shows currently in "Pilot" state in TMDB?
   - Case sensitivity: toLowerCase() is applied before match (good).
   ```
   - Document every classification with TMDB docs reference
   - Flag "Pilot → ended" for re-evaluation as MEDIUM

2. **next_episode_to_air Conflicts with Status**
   ```
   Real TMDB corner cases:
   - Show has status "Ended" but next_episode_to_air is populated
     (e.g., limited series with a surprise reunion special)
   - Show has status "Returning Series" but next_episode_to_air is null
     (between seasons, no announcement yet)
   - Show has last_episode_to_air but the air_date is in the future

   Check useSubscriptionAdvisor getNextAirInfo (lines 57–76):
   - Uses show.next_episode_to_air.air_date first
   - Falls back to future season.air_date if next_episode is null
   - Does it ever contradict airingState? If airingState says 'ended' but
     nextAirDate is populated, which wins?
   - AdvisedShow.isEnded = isEndedStatus(show.status) — set independently
     from nextAirDate. The UI may show both "Avslutad" and an upcoming
     episode date.
   ```
   - Flag contradiction scenarios: enumerate and map to UX decisions
   - Severity HIGH if the advisor produces inconsistent advice because of this

3. **Revival Nudge Precision (False Positive Audit)**
   ```
   Nudge fires (src/hooks/useRevivalNudges.ts:50–52):
     hasUpcomingEpisode && (isOngoing(show.status) && !isOngoing(item.tmdbStatus))

   Check:
   - What if item.tmdbStatus was never cached (null)? isOngoing(null) = false.
     Filter at line 25 requires tmdbStatus != null, so this path is guarded.
   - What if show flipped from "Returning Series" → "Ended" → "Returning Series"?
     The cached item.tmdbStatus might not reflect the first flip.
   - What if the show is ongoing only because of a one-off special (see
     "Ended with next_episode" case above)? Currently this fires a nudge
     — is that desired or noisy?
   - MAX_CHECKS = 20 excludes older watched items. Is this threshold right?
     A user with 80 completed series would only get nudges on the most recent 20.
   ```
   - Document every false-positive scenario with frequency estimate
   - Recommend MAX_CHECKS tuning criteria

4. **Movie vs TV Status Asymmetry**
   ```
   CLAUDE.md: "Movies don't use Följer — only Vill se and Sedd"
   (watchStatus.ts:10).

   Check:
   - Every UI path that lets a user set status on a movie refuses 'följer'
   - Advisor excludes movies from the "följer" bucket
     (useSubscriptionAdvisor:92 — getByStatus('följer', 'tv') ✓)
   - No code path serializes 'följer' into a movie watchlist item
     (search: grep for status === 'följer' && mediaType === 'movie' bugs)
   - Swedish label for movie "Sedd" vs TV "Sedd" is identical → no
     disambiguation issue
   ```
   - Flag any leak as HIGH (data-model integrity)

5. **Display Title Fallback Heuristic**
   ```
   getDisplayTitle (client.ts:149–156):
     If original_* exists AND is not non-Latin script → use original
     Else → use localized (sv-SE) or original or 'Okänd titel'

   Check:
   - For Swedish originals (e.g., "Bron|Broen"), original_name = "Bron/Broen"
     (Latin) → will use original. Is that desired, or should sv-SE take
     priority when both exist?
   - For titles with Scandinavian characters (å, ä, ö) — regex allows them
     (Latin Extended is NOT in the excluded ranges) → uses original. Correct.
   - For Japanese titles with Latin subtitles, original_name may be Japanese
     (CJK range excluded) → falls back to localized sv-SE title. Correct.
   - Edge case: title "愛の不時着" original + "Crash Landing on You" English +
     "Kärlekens krasch" Swedish — which does Binge show?
     Current logic: original is CJK → falls back to localized sv-SE. Correct.
   ```
   - Enumerate title-selection edge cases
   - Flag as LOW unless a surprising result hits a user-facing pathway

**Files to audit:**
- `src/lib/airingState.ts`
- `src/lib/watchStatus.ts`
- `src/hooks/useSubscriptionAdvisor.ts` (getNextAirInfo, isEnded usage)
- `src/hooks/useRevivalNudges.ts`
- `src/lib/tmdb/client.ts` (getDisplayTitle)
- `src/lib/utils/preferOriginalTitle.ts` (imported by advisor)

**Output Required:**
- TMDB status enum coverage matrix (enum × mapping × verification)
- Contradiction scenarios catalog (status vs next_episode)
- Revival nudge false-positive / false-negative inventory
- Movie/TV status asymmetry leak check
- Effort estimates

---

### Dimension 4: Advisor Priority Cascade & Correctness (18 points)

**Investigation Scope**: Does `useSubscriptionAdvisor` produce the right
recommendation for every realistic user state, per the documented calm-overview
+ money-nudge design (see memory: project_advisor_design 2026-04-17)?

**Specific Investigation Tasks:**

1. **Full Priority Cascade Enumeration**
   ```
   Trace src/hooks/useSubscriptionAdvisor.ts end-to-end and enumerate:

   PrimaryAction states in types:
   - idle { nextCheckDate }
   - (other kinds — read types/index.ts:438–443 to enumerate all)

   For each kind:
   - Under what input conditions does this state trigger?
   - What inputs change the nextCheckDate / candidate provider / etc.?
   - What tie-breaking rules apply when two candidates qualify?

   Produce a state-transition table:
     Input conditions → PrimaryAction.kind → PrimaryAction.detail
   ```
   - Document every branch with file:line
   - Flag any reachable-but-unreachable-in-practice branch as LOW
   - Flag any unreachable-but-should-be-reachable branch as HIGH (bug)

2. **CATCHUP_THRESHOLD & findTopPausable Semantics**
   ```
   CATCHUP_THRESHOLD = 3 (line 27).
   findTopPausable (line 17–24):
     - Only 'pause' status providers
     - Exclude user-paused (userPausedSet)
     - Exclude zero-cost providers
     - Sort by monthlyCost DESC

   Check:
   - "Zero-cost" filter: (p.monthlyCost ?? 0) > 0 — does this correctly
     exclude free tier SVT/TV4? YES (defaultMonthlyCost: 0 for SVT Play)
   - Would a paid-tier user with no unfinished shows get a pause suggestion
     on the most expensive unused provider? Trace the full flow.
   - Pause-ranking tie-breaker: two providers at same cost — stable sort?
     (JavaScript Array.prototype.sort is stable in V8, so yes; document
     the tie-break is insertion-order from myProviders.)
   ```

3. **Cost Calculation Correctness**
   ```
   user.providerCosts overrides defaultMonthlyCost for tier selection.

   Check:
   - Does the advisor use user-overridden cost or default?
     (Look for providerCosts[pid] fallbacks throughout the hook)
   - monthlySavings and totalMonthlyCost: which inputs feed them?
   - Pause cost handling: a paused provider with resumeAt still counts
     toward totalMonthlyCost? Or excluded until resumeAt? Document.
   - Currency: all in SEK. Any hardcoded currency symbols or formatters?
     (Cross-ref to 06 for display; here, check the pure number logic.)
   ```
   - Flag any off-by-one or rounding bug
   - Flag if a user can save 0 SEK but advisor shows a pause suggestion
     (should not happen — guard at line 22: `(p.monthlyCost ?? 0) > 0`)

4. **willSeeByProvider Accuracy**
   ```
   willSeeAdvised + willSeeFilmAdvised are combined into anchorShowsByProvider
   via providerIds membership (lines 186–195).

   Check:
   - For films, the provider list comes from item.providers
     (stored on the watchlist item — line 183). When was this cached last?
     Is there any TTL on it? If the user added a film 6 months ago and
     providers changed, the advisor uses stale data.
   - For TV, it comes from the live TMDB fetch via anchorShowsByProvider.
   - Mismatch severity: HIGH if users see "available on provider X" that
     is no longer true.
   ```
   - Flag provider-freshness gap with remediation estimate

5. **Pause State Persistence**
   ```
   user.providerPauses is persisted per user (Firestore).

   Check:
   - Pause schema: providerId → { pausedAt, resumeAt, reason? }
     (inspect actual schema in types/index.ts:427 ActivePause)
   - When a pause's resumeAt passes, does the advisor auto-un-pause
     or require user action? (Trace: is there a cleanup path?)
   - If the user re-subscribes mid-pause, does the pause get cleared?
   - Cross-device sync: if user sets a pause on web, does the advisor
     on another device pick it up? (Firestore-level concern, but verify
     the hook doesn't cache stale pause state.)
   ```

**Files to audit:**
- `src/hooks/useSubscriptionAdvisor.ts` (all 393 lines)
- `src/hooks/useAdvisorTimeline.ts`
- `src/components/dashboard/SubscriptionAdvisorWidget.tsx`
- `src/app/savings/page.tsx` (331 lines)
- `src/types/index.ts:386–452` (AdvisedShow, ProviderAdvisory, ActivePause,
  PrimaryAction, AdvisorResult)

**Output Required:**
- Priority cascade state-transition table
- Branch coverage report (every PrimaryAction kind × triggering conditions)
- Cost-calculation correctness matrix
- Provider-freshness gap analysis (films vs TV)
- Pause lifecycle audit

---

### Dimension 5: Fallback Behavior & Data-Gap Resilience (10 points)

**Investigation Scope**: What happens when TMDB returns partial, stale, or
missing data?

**Specific Investigation Tasks:**

1. **Missing watch/providers.results.SE**
   ```
   Swedish coverage is incomplete on TMDB for smaller international titles.

   Check:
   - If results.SE is undefined, what does the advisor show?
     - Advisor: seProviders = [] (line 150–154 safely chains ??)
     - UI: ProviderTag presumably renders nothing — verify
   - Is there a user-visible "availability unknown" state, or does the
     title silently lose its provider pills?
   - For the advisor: a följer'd show with no SE providers contributes
     no anchors to any provider — is this treated as "can't advise" or
     "can drop"?
   ```

2. **Missing next_episode_to_air & future season fallback**
   ```
   getNextAirInfo (lines 57–76) falls back to the earliest future
   show.seasons[].air_date where season_number > 0.

   Check:
   - What if seasons[] is empty (specials-only show, miniseries)?
   - What if all seasons have air_date in the past but status is
     "Returning Series"? Returns { date: null, code: null } → advisor
     treats as no upcoming → moves show to 'catchup' or 'stale' bucket.
     Is that correct?
   - What's the oldest-possible air_date that would still be considered
     "upcoming"? Currently `s.air_date > now` is a strict string compare —
     works for ISO dates but edge on year boundaries.
   ```

3. **API Failure Degradation**
   ```
   If TMDB is fully down, every useQueries in the advisor returns errors.
   showQueries.some(q => q.isLoading) resolves false after retries exhausted.
   shows becomes [] (filtered at line 124–127).

   Check:
   - Does the UI show "TMDB unavailable" messaging?
   - Does the advisor produce an empty result silently, implying "nothing
     to advise" — which is misleading?
   - Is the last-known-good advisor result cached in localStorage /
     Firestore anywhere? (Current: no — verify.)
   ```

4. **Cached Firestore watchlist vs live TMDB drift**
   ```
   Watchlist items cache title, posterPath, releaseYear, providers,
   tmdbStatus. If TMDB data changes (show renamed, provider added/removed),
   the cached item goes stale.

   Check:
   - Is there a refresh mechanism? (On detail-page visit, detail fetcher
     runs — presumably re-caches. Verify.)
   - Is there a background refresh for watchlist items? (Unlikely — verify.)
   - Is staleness bounded? (A user who never visits a show's detail page
     again could have 2-year-old cached metadata.)
   ```

**Files to audit:**
- All files touched in Dimensions 1–4
- `src/contexts/WatchlistContext.tsx`
- `src/hooks/useWatchlist.ts`

**Output Required:**
- Missing-data handling matrix (field × what happens × user-visible effect)
- Stale-cache risk assessment
- API-failure degradation audit
- Recommended fallback improvements with effort estimates

---

### Dimension 6: Recommendation Surface Quality (8 points)

**Investigation Scope**: Recommendation features outside the subscription
advisor — RecommendationsSection, discover page, taste-vector-driven picks.

**Specific Investigation Tasks:**

1. **TMDB /recommendations Usage**
   ```
   getRecommendations (client.ts:81–83) — where is it called?
   getMovie and getTVShow also append 'recommendations'.

   Check:
   - Is the appended version preferred (one request) or is a second
     standalone call made somewhere?
   - Are recommendations filtered for Swedish availability before display?
     (Expected: yes — no point recommending titles unavailable in SE.)
   - Are already-watched recommendations filtered out?
   - Are already-on-watchlist recommendations filtered out?
   ```

2. **Taste-Vector Pipeline**
   ```
   src/lib/taste/ contains vector.ts, similarity.ts, stats.ts, backfill.ts.

   Check:
   - Inputs: what signals populate the user's taste vector?
     (ratings, watched-status, notes?)
   - Similarity metric: cosine? What dimensions?
   - Backfill: does the pipeline handle users with sparse data gracefully?
   - Is this surfaced in /recommendations, /discover, or both?
   - Is there a cold-start strategy for brand-new users?
   ```
   - If the taste pipeline is a prototype / feature-flagged, note that
     and reduce severity accordingly.

3. **/discover Page Filter Correctness**
   ```
   src/app/discover/page.tsx uses discoverMovies and discoverTV.

   Check:
   - What filters are exposed to the user? (genre, year, provider?)
   - Are the TMDB params (with_watch_providers, watch_region=SE)
     correctly applied?
   - Does the user's myProviders influence discover by default?
   ```

**Files to audit:**
- `src/components/title/RecommendationsSection.tsx`
- `src/app/discover/page.tsx`
- `src/app/recommendations/page.tsx`
- `src/lib/taste/*` (all 4 files)
- `src/hooks/useTasteVector.ts`, `useSessionTasteVectors.ts`

**Output Required:**
- Recommendation filter-chain audit (raw TMDB → filtered → displayed)
- Taste-vector pipeline assessment
- /discover filter correctness
- Cold-start handling

---

### Dimension 7: Test Coverage & Regression Protection (6 points)

**Investigation Scope**: Are the advisor and status-inference modules tested?

**Specific Investigation Tasks:**

1. **Test Presence**
   ```
   Check for any *.test.ts, *.test.tsx, *.spec.ts files under src/ or test/.
   Known state: no Jest / Vitest / Playwright configs observed in
   package.json (only ESLint).

   If zero tests exist:
   - Flag as HIGH. The advisor is complex, has multiple branches, and is
     user-visible. Untested branches are a regression waiting to happen.

   If tests exist:
   - Coverage of airingState, watchStatus, canonicalProviderId?
   - Coverage of useSubscriptionAdvisor branches?
   - Coverage of useRevivalNudges firing conditions?
   ```

2. **Golden-Case Inputs**
   ```
   Recommend a minimum golden-set of advisor inputs:
   - Empty myProviders
   - 1 paid provider, 0 följer shows
   - 1 paid provider, 5 följer shows all with upcoming episodes
   - 1 paid provider, 5 följer shows all ended
   - 3 providers, mixed state (catchup candidate on one, pause candidate
     on another, idle on third)
   - Pause already active (resumeAt in future)
   - Pause already active (resumeAt in past — auto-unpause scenario)
   - Revival candidate (watched + ended → ongoing)

   Scoring rubric: the team should be able to run these cases and assert
   PrimaryAction.kind.
   ```

**Output Required:**
- Test coverage inventory
- Golden-case list with scoring rubric
- Test framework recommendation (Vitest if adding, since it's Vite-friendly
  and React-ecosystem standard)

---

### Dimension 8: Attribution & Terms Compliance (5 points)

**Investigation Scope**: Does Binge respect TMDB's API attribution and
branding requirements?

**Specific Investigation Tasks:**

1. **Attribution Text Accuracy**
   ```
   CLAUDE.md (line 58) states the required text:
     "This product uses the TMDB API but is not endorsed or certified by TMDB"

   Check (delegating final verification to 11 Legal):
   - Is this text rendered somewhere visible in the app (footer, about,
     settings)?
   - Is the TMDB logo used alongside? (TMDB requires it if attribution
     is placed.)
   - Is the text present in Swedish as well? (TMDB allows translations
     provided the meaning is preserved.)
   - Is the attribution link to themoviedb.org included and accurate?
   ```
   - This prompt flags presence/absence; 11 Legal owns the final wording
     and placement verdict.

2. **Image & Logo Asset Usage**
   ```
   All TMDB images are served from image.tmdb.org/t/p (verified in
   client.ts:14).

   Check:
   - No TMDB images are copied to /public or hotlinked elsewhere.
   - Provider logos: are they fetched from TMDB, or self-hosted?
     (SwedishProvider.color is used for pills, not a logo. But if
     ProviderTag renders a logo, where does it come from?)
   - Person profile images: same treatment.
   ```

3. **Rate Limit & Usage Compliance**
   ```
   TMDB asks API consumers to respect rate limits (40 req/10s/IP).
   - Is Binge aware of this? (Cross-ref to 04 for enforcement.)
   - Does Binge respect the TMDB terms (no commercial resale of data,
     etc.)? (Cross-ref to 11.)
   ```

**Output Required:**
- Attribution placement check
- Image-hosting policy compliance
- Logo usage verification
- Deferred items for 11 Legal

---

## Scoring Framework

| # | Dimension | Points | Scoring Guidance |
|---|-----------|--------|------------------|
| 1 | TMDB API Integration Correctness | /20 | 20: All endpoints use correct params, errors handled, retry+cancel present. 10: Core endpoints correct, gaps in edge paths. 0: Wrong region/locale, no error handling. |
| 2 | Swedish Provider Catalog Accuracy | /18 | 18: Catalog complete, aliases correct, prices fresh, tiers accurate. 9: Core providers correct, gaps in edges. 0: Missing major Swedish providers, broken aliases. |
| 3 | Status Inference Correctness | /15 | 15: All TMDB statuses mapped, no contradictions, nudges precise. 8: Main paths correct, edge cases leak. 0: Wrong classifications, frequent revival false-positives. |
| 4 | Advisor Priority Cascade | /18 | 18: Every PrimaryAction branch traced, tie-breaks documented, costs correct. 9: Main path works, edge branches untested. 0: Advisor produces wrong recommendations. |
| 5 | Fallback & Data-Gap Resilience | /10 | 10: Missing data handled with user-visible messaging, API failure degrades gracefully. 5: Empty results silently returned. 0: Crashes on partial data. |
| 6 | Recommendation Surface Quality | /8 | 8: Recommendations filtered by availability + watchlist, taste pipeline solid. 4: Basic recs work. 0: No filtering, irrelevant suggestions. |
| 7 | Test Coverage & Regression | /6 | 6: Golden cases covered, status/provider modules tested. 3: Partial coverage. 0: Zero tests on core logic. |
| 8 | Attribution & Terms Compliance | /5 | 5: Attribution present, logos correct, terms followed. 3: Attribution present but incomplete. 0: Missing attribution. |

---

## Output Format

### Executive Summary

```
BINGE TMDB INTEGRATION & RECOMMENDATION ANALYSIS — PHASE 1 FINDINGS
=====================================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Scope: TMDB client, Swedish providers, status inference, advisor, revival, taste

OVERALL SCORE: X/100
├── TMDB API Integration Correctness:  X/20 points
├── Swedish Provider Catalog:          X/18 points
├── Status Inference Correctness:      X/15 points
├── Advisor Priority Cascade:          X/18 points
├── Fallback & Data-Gap Resilience:    X/10 points
├── Recommendation Surface Quality:    X/8 points
├── Test Coverage & Regression:        X/6 points
└── Attribution & Terms Compliance:    X/5 points

STATUS: [Production Ready | Needs Work | Critical Issues Found]

CRITICAL ISSUES: X found
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found

TOP 5 TMDB / ADVISOR RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report Format

For each dimension, provide: summary (2–3 sentences), issues grouped by
CRITICAL/HIGH/MEDIUM/LOW with file:line references, impact description,
required fix, and effort estimate. Include recommendations and quick wins.

### TMDB Integration Dashboard

| Metric                                       | Current | Target  | Gap |
|----------------------------------------------|---------|---------|-----|
| Endpoints with correct sv-SE + region=SE     | X/Y     | Y/Y     | ... |
| Providers covered in SWEDISH_PROVIDERS       | X       | ~25     | ... |
| Aliases verified against TMDB production     | X/Y     | Y/Y     | ... |
| TMDB status enum coverage (ongoing/ended)    | X/7     | 7/7     | ... |
| Advisor PrimaryAction branches documented    | X/Y     | Y/Y     | ... |
| Golden-case advisor tests                    | X/8     | 8/8     | ... |
| Missing-data scenarios with UX messaging     | X/Y     | Y/Y     | ... |
| TMDB attribution rendered in UI              | Y/N     | Y       | ... |

### Provider Catalog Audit Table

| Provider    | TMDB id | Alias(es) | In catalog | Tiers current | Color correct | Status |
|-------------|---------|-----------|------------|---------------|---------------|--------|
| Netflix     | 8       | –         | Y          | Y/N           | Y/N           | OK     |
| TV4 Play    | 489     | 1944      | Y          | Y/N           | Y/N           | ...    |
| ...         | ...     | ...       | ...        | ...           | ...           | ...    |

### Advisor State-Transition Table

| Input Conditions                            | PrimaryAction.kind | Detail / Candidate            |
|---------------------------------------------|--------------------|-------------------------------|
| myProviders.length === 0                    | idle               | nextCheckDate: null           |
| [continue for every branch]                 | ...                | ...                           |

### Phase 2 Preparation

Provide total issue counts by severity, estimated total remediation effort,
and next steps for Phase 2 smart planning. Group findings into:
- Quick wins (low effort, high impact): e.g., add missing aliases, fix region
  parameters
- Correctness fixes (medium effort): advisor branch bugs, status-inference
  edge cases
- Structural improvements (higher effort): retry/cancel plumbing, golden-case
  test harness, stale-cache refresh mechanism

---

## Investigation Execution Plan

### Stage 1: TMDB Client & Provider Catalog (1.5 hours)

```
Read and analyze:
- src/lib/tmdb/client.ts (full)
- src/lib/tmdb/providers.ts (full)
- src/lib/tmdb/countries.ts
- Every file importing from @/lib/tmdb

Focus: Endpoint correctness, locale/region params, error handling,
provider catalog completeness, alias/canonicalization.
```

### Stage 2: Status Inference & Title Helpers (1 hour)

```
Read and analyze:
- src/lib/airingState.ts
- src/lib/watchStatus.ts
- src/lib/utils/preferOriginalTitle.ts
- src/lib/tmdb/client.ts (getDisplayTitle, getReleaseYear)

Focus: TMDB status enum coverage, movie/TV asymmetry, title fallback.
```

### Stage 3: Subscription Advisor Deep Dive (2 hours)

```
Read and analyze:
- src/hooks/useSubscriptionAdvisor.ts (full 393 lines)
- src/hooks/useAdvisorTimeline.ts
- src/types/index.ts:386–452 (advisor types)
- src/components/dashboard/SubscriptionAdvisorWidget.tsx
- src/app/savings/page.tsx
- src/hooks/useRevivalNudges.ts

Focus: Priority cascade branches, cost calculations, pause lifecycle,
revival-nudge precision, willSeeByProvider accuracy.
```

### Stage 4: Recommendation Surfaces & Taste Pipeline (1 hour)

```
Read and analyze:
- src/lib/taste/* (all 4 files)
- src/hooks/useTasteVector.ts
- src/hooks/useSessionTasteVectors.ts
- src/app/recommendations/page.tsx
- src/app/discover/page.tsx
- src/components/title/RecommendationsSection.tsx

Focus: Recommendation filtering, taste-vector correctness, discover filters.
```

### Stage 5: Fallback & Attribution (45 min)

```
Trace missing-data scenarios across the codebase.
Check attribution placement and TMDB terms compliance (defer wording to 11).
```

### Stage 6: Report Compilation (1 hour)

Compile all findings into structured report with severity classification,
effort estimates, dashboards, and Phase 2 preparation.

**Total: 7–8 hours**

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score (out of 100)
- [ ] Detailed findings for all 8 dimensions with file:line references
- [ ] Issue classification (Critical/High/Medium/Low) with counts and effort estimates
- [ ] TMDB endpoint matrix (endpoint × params × correctness)
- [ ] Provider catalog audit table
- [ ] TMDB status enum coverage matrix
- [ ] Advisor state-transition table (every PrimaryAction branch)
- [ ] Revival nudge false-positive/false-negative inventory
- [ ] Missing-data handling matrix
- [ ] Recommendation filter-chain audit
- [ ] Test coverage inventory + golden-case list
- [ ] Attribution placement check (deferred items for 11 Legal)
- [ ] Phase 2 preparation section with issue grouping

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX** — this is investigation only.
2. **BINGE-SPECIFIC** — this prompt owns TMDB-data correctness and advisor logic.
   Do not duplicate Security (API-key exposure → 02), Performance (rate limits → 04),
   UX (advisor copy → 06), or Legal (attribution wording → 11).
3. **SWEDISH-FIRST** — the app serves Swedish users. Provider accuracy and
   sv-SE locale correctness are non-negotiable.
4. **STATUS INFERENCE IS HIGH-LEVERAGE** — a wrong `airingState` for 1% of shows
   means thousands of wrong advisor recommendations. Treat mapping gaps as HIGH.
5. **ADVISOR BRANCHES MATTER** — enumerate every PrimaryAction.kind and its
   triggering conditions. Unreachable branches are bugs; contradictory
   branches are worse.
6. **STALE CACHE IS A REAL RISK** — watchlist items cache TMDB metadata.
   Providers change, shows get renamed, prices change. Document the freshness
   contract.
7. **ZERO CODE CHANGES** — investigation and documentation only.
8. **REALISTIC** — Binge is a pre-launch indie web app. Severity should reflect
   actual user impact at launch, not theoretical perfection. A missing alias
   for a niche provider is LOW; a wrong advisor bucket for Netflix is HIGH.
