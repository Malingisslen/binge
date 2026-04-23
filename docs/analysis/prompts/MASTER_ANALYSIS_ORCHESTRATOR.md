# Master Analysis Orchestrator — Binge

**Consolidated entry point for 11 analysis prompts covering the entire Binge Next.js codebase.**

This orchestrator coordinates 11 focused, self-contained prompts: 10 covering engineering, product, compliance, and market concerns, plus 1 that is unique to Binge — TMDB integration and recommendation logic (the core differentiator).

Each prompt can run independently or as part of a coordinated analysis session.

---

## Purpose

Run a comprehensive, forensic-level audit of the Binge codebase across eleven dimensions.
The approach is strictly two-phase:

- **Phase 1: Investigation only.** No code changes. Produce findings with file:line references.
- **Phase 2: Smart remediation.** Prioritized fix plan based on Phase 1 findings.

---

## Known Project Context

All 11 prompts share these baseline facts. Do not re-discover them during analysis.

```
Project:             Binge (binge.nu — Swedish media tracker for movies and TV shows)
Killer feature:      Where each title is available on Swedish streaming services
Positioning:         "Prisjakt for media" — dense, functional, data-forward
UI language:         Swedish (primary, only language at launch)
Target market:       Swedish streaming consumers

Framework:           Next.js 14 (App Router), TypeScript, React 18, Tailwind CSS
Data layer:          React Query (TanStack Query v5), staleTime 5 min
Rendering model:     Client-side only SPA — NO SSR. Static export intended
                     (output: 'export' in next.config.mjs currently commented
                     out because dynamic routes /movie/[id], /tv/[id] need a
                     catch-all rewrite). Actual deploy uses `next build` and
                     Firebase Hosting with a global rewrite to /_/index.html.
Auth/DB:             Firebase (Auth, Cloud Firestore, Hosting, Cloud Functions)
External API:        TMDB API v3 — ALL movie/TV metadata + watch providers
Hosting:             Firebase Hosting (public: "out") behind Cloudflare CDN
CI/CD:               1 GitHub Actions workflow (.github/workflows/deploy.yml)
                     → npm ci → npm run build → FirebaseExtended/action-hosting-deploy
                     channelId: live, projectId: binge-nu

Codebase size:       125 .ts/.tsx files in src/, ~14,064 lines of hand-written code
Largest files:
  - src/components/pages/GroupPageClient.tsx          (908 lines)
  - src/components/WatchlistPage.tsx                  (614 lines) — shared /my/* table+grid
  - src/components/pages/TillsammansSessionPageClient.tsx (587 lines)
  - src/app/settings/page.tsx                         (493 lines)
  - src/types/index.ts                                (453 lines)
  - src/hooks/useSubscriptionAdvisor.ts               (393 lines)

Firestore rules:     154 lines (firestore.rules)
Firestore indexes:   53 lines (firestore.indexes.json)
Storage rules:       NOT PRESENT (no storage.rules file)

Key directories:
  - src/app/             App Router pages (dashboard, search, movie/tv, calendar,
                         my, discover, recommendations, savings, stats, grupper,
                         tillsammans, kalibrera, feed, films, series, settings, login)
  - src/components/      layout/, search/, title/, tv/, calendar/, dashboard/,
                         pages/ (dynamic-route Client components), savings/,
                         social/, ui/
  - src/lib/tmdb/        client.ts (161 lines), providers.ts (137 lines),
                         countries.ts
  - src/lib/firebase/    config.ts, groups.ts, sessions.ts, username.ts, utils.ts
  - src/lib/taste/       vector.ts, similarity.ts, stats.ts, backfill.ts
  - src/lib/together/    candidates.ts, matching.ts
  - src/lib/             airingState.ts, watchStatus.ts, utils.ts
  - src/hooks/           24 custom hooks (useAuth, useWatchlist, useTMDB,
                         useSubscriptionAdvisor, useRevivalNudges, etc.)
  - src/contexts/        AuthContext.tsx (271 lines), ToastContext, WatchlistContext
  - src/types/           index.ts (453 lines — all TypeScript types)

Status system (IMPORTANT — user-preferred unified status):
  - WatchStatus = 'följer' | 'vill_se' | 'sedd'  (src/types/index.ts:2)
  - TV shows use all three; movies only use 'vill_se' and 'sedd'
  - statusLabel() handles the asymmetry (src/lib/watchStatus.ts:15)
  - tvShowStatusLabel() maps TMDB status strings to Swedish (Ended→Avslutad etc.)
  - airingState() classifies TMDB status as ongoing|ended|unknown (src/lib/airingState.ts:3)

Streaming advisor (core differentiator):
  - useSubscriptionAdvisor (src/hooks/useSubscriptionAdvisor.ts, 393 lines)
    Produces AdvisorResult with providers, subscribeAdvice, willSeeByProvider,
    monthlySavings, totalMonthlyCost, primaryAction, activePauses.
    Priority cascade + calm-overview design (see project_advisor_design memory).
    CATCHUP_THRESHOLD = 3 (avoids nagging on single unfinished show).
  - useRevivalNudges (src/hooks/useRevivalNudges.ts, 60 lines)
    Detects watched+ended shows that came back to life. MAX_CHECKS = 20
    (only fetches shows whose tmdbStatus is already cached).
  - useAdvisorTimeline (upcoming windows for pause/resume)

Swedish provider catalog (src/lib/tmdb/providers.ts):
  - 19 providers defined (16 flatrate, 3 rent-only)
  - Each has TMDB provider_id, brand color, defaultMonthlyCost, optional tier list
  - TV4 Play has alias provider_id 1944 (via aliases: [1944])
  - canonicalProviderId() collapses aliases to primary id
  - Tiers cover ads/free variants for Netflix, Disney+, HBO Max, Viaplay, TV4 Play,
    Max, SkyShowtime, Crunchyroll, YouTube Premium, Discovery+
  - Advisor consumes flatrate + free + ads from results.SE
    (src/hooks/useSubscriptionAdvisor.ts:150)

TMDB client (src/lib/tmdb/client.ts):
  - Single fetch wrapper tmdbFetch() with language=sv-SE hard-coded
  - API key via NEXT_PUBLIC_TMDB_API_KEY — exposed client-side (CRITICAL for 02)
  - Endpoints: search/multi, movie/{id}, tv/{id}, tv/{id}/season/{n},
    person/{id}, trending, popular (movie+tv with region=SE), genre/list,
    discover (movie: region=SE + watch_region=SE; tv: watch_region=SE only),
    /{type}/{id}/watch/providers, /{type}/{id}/recommendations
  - getDisplayTitle(): non-Latin original → localized (sv-SE) fallback
  - NO retry logic, NO rate-limit handling, NO server-side proxy

Data model (Firestore — partially implemented):
  - users/{uid} — profile, myProviders (array of TMDB provider_ids),
    providerCosts (user-override pricing), providerPauses (stateful pause tracking),
    notification settings, isPublic flag for public profiles
  - users/{uid}/watchlist/{tmdbId} — status, cached metadata, rating, notes,
    lastWatchedSeason, tmdbStatus (cached TMDB airing status for revival detection),
    dropped flag, watchedAt
  - users/{uid}/episodeProgress/{tmdbId} — per-episode watched state
  - users/{uid}/notifications/{notifId} — owner only
  - users/{uid}/following/{targetUid}, users/{uid}/followers/{followerUid}
  - users/{uid}/reviews/{tmdbId}
  - Groups: tillsammans/watch-together sessions (src/lib/firebase/groups.ts, 317 lines)

Current state gaps:
  - Auth: demo user stub in AuthContext. Firebase Auth partially integrated.
  - Watchlist: partially migrated to Firestore via WatchlistContext.
  - Static export: DISABLED in next.config.mjs (dynamic routes blocker).
  - No storage.rules. No functions/ directory. No Cloud Functions deployed.

Design constraints (from CLAUDE.md — STRICT, auditable):
  - Must NOT look AI-generated (no rounded cards with shadows, no gradients,
    no emoji in UI, no decorative badges)
  - Base font size: 13px (dense tool, not a marketing site)
  - Border radius: 2-3px max, never more
  - NO box-shadow anywhere, no transform/scale on hover
  - Accent color: #d97b35 (warm orange-brown)
  - Page background: #eeece8, surfaces: #faf8f5, sidebar: #1e2028 (210px fixed)
  - System font stack only
  - Provider tags: tiny bordered pills (9px), user's own services highlighted with accent

Legal / third-party obligations:
  - TMDB attribution REQUIRED: "This product uses the TMDB API but is not
    endorsed or certified by TMDB"
  - GDPR (Swedish users, EU app)
  - Cookie consent (web app, Cloudflare + Firebase Analytics potential)
  - No app stores at launch (web only)

Out-of-scope (not present in codebase):
  - No native mobile app (no iOS HIG, no Material Design, no privacy manifest,
    no ATT, no Google Play submission)
  - No LLM/AI integration (no prompt engineering, no AI Act concerns, no
    OCR, no NLP pipeline) — handled inline by TMDB data
  - No IAP / subscription system in app itself (pre-monetization)
  - No UGC moderation needs at scale (reviews exist but are user-scoped;
    no public comments on other users' reviews at time of writing)

Generated / ignored files (skip during analysis):
  - .next/
  - node_modules/
  - out/ (build output)
  - .firebase/
```

---

## Pre-Analysis Tooling

Run these commands BEFORE feeding any prompt. Attach their output as context.

```bash
# 1. ESLint / Next.js lint (required)
npm run lint

# 2. TypeScript strict check
npx tsc --noEmit

# 3. Bundle / build analysis (if needed for 04)
npm run build

# 4. Dependency freshness
npm outdated

# 5. Dependency vulnerabilities
npm audit --production

# 6. Firebase rules syntax check (optional, for 02)
firebase deploy --only firestore:rules --dry-run

# 7. File metrics (non-generated)
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -40
```

If a tool is not installed, skip it and note its absence in the prompt context.
The prompts are designed to work without optional tooling, but results improve with it.

---

## The 11 Prompts

| #  | File                                                | Scope                                              | Weight |
|----|-----------------------------------------------------|----------------------------------------------------|--------|
| 01 | `01_CODE_QUALITY_AND_ARCHITECTURE.md`               | React/Next.js correctness, hooks, contexts, types  | 13%    |
| 02 | `02_SECURITY_AND_COMPLIANCE.md`                     | OWASP Web, client-key exposure, Firestore rules    | 12%    |
| 03 | `03_INFRASTRUCTURE_AND_OPERATIONS.md`               | Firebase Hosting, Cloudflare, CI/CD, backups       | 6%     |
| 04 | `04_PERFORMANCE_AND_SCALABILITY.md`                 | Core Web Vitals, React Query, bundle, TMDB rates   | 10%    |
| 05 | `05_DEPENDENCIES_AND_SUPPLY_CHAIN.md`               | npm CVEs, licenses, maintenance, bloat             | 5%     |
| 06 | `06_UX_DESIGN_AND_I18N.md`                          | Design-rule compliance, accessibility, Swedish     | 15%    |
| 07 | `07_TMDB_INTEGRATION_AND_RECOMMENDATION.md`         | TMDB data quality, provider mapping, advisor logic | 15%    |
| 08 | `08_PRODUCT_ANALYTICS_AND_GROWTH.md`                | Analytics, funnels, retention, re-engagement       | 5%     |
| 09 | `09_TRUST_SAFETY_AND_PRIVACY.md`                    | SDK consent, cookie consent, data transfers, age   | 5%     |
| 10 | `10_MONETIZATION_AND_COMPETITIVE_POSITIONING.md`    | Feature completeness vs market, differentiation    | 7%     |
| 11 | `11_LEGAL_REVIEW.md`                                | Privacy policy, ToS, TMDB attribution, GDPR docs   | 7%     |

Each prompt is fully self-contained. It includes the shared project context block above
and its own investigation checklist. No prompt requires output from another to execute.

---

## Execution Strategy

### Option A: Sequential

Run prompts in numeric order: 01 → 02 → ... → 11.

Simple and reliable. Each session starts fresh. Total time: 11 sessions.

### Option B: Parallel Agents (Recommended)

Split into three waves to maximize throughput while respecting soft dependencies.

**Wave 1** (independent, run in parallel):
- 01 Code Quality and Architecture
- 02 Security and Compliance
- 05 Dependencies and Supply Chain

**Wave 2** (run after Wave 1 completes):
- 03 Infrastructure and Operations
- 04 Performance and Scalability
- 06 UX, Design and i18n

**Wave 3** (run after Wave 2 completes, or in parallel with Wave 2):
- 07 TMDB Integration and Recommendation
- 08 Product Analytics and Growth
- 09 Trust, Safety and Privacy
- 10 Monetization and Competitive Positioning
- 11 Legal Review

### Soft Dependencies

These are not hard blockers, but running them in order improves cross-referencing:

| Run first                | Before                         | Reason                                              |
|--------------------------|--------------------------------|-----------------------------------------------------|
| 05 Dependencies          | 02 Security                    | CVE findings inform security assessment             |
| 01 Code Quality          | 04 Performance                 | Architecture issues inform perf diagnosis           |
| 03 Infrastructure        | 06 UX                          | Build/deploy context informs platform UX            |
| 02 Security              | 09 Trust, Safety & Privacy     | GDPR findings inform consent sequencing audit       |
| 04 Performance           | 07 TMDB Integration            | TMDB-rate / cache findings inform advisor diagnosis |
| 06 UX                    | 10 Monetization & Competitive  | Feature inventory informs competitive matrix        |
| 02 Security + 06 UX      | 11 Legal Review                | GDPR impl + UI flows inform legal-doc accuracy      |

If running in parallel, each prompt produces complete findings on its own.

---

## Cross-Prompt Deduplication Rules

To avoid redundant analysis, each topic is owned by exactly one prompt.
Other prompts that touch adjacent areas must defer to the owning prompt.

| Topic                                           | Owned by                  | Skip in                   |
|-------------------------------------------------|---------------------------|---------------------------|
| Firestore / Storage security rules              | **02 Security**           | 04, 07                    |
| Firebase schema, queries, indexing              | **04 Performance**        | 01, 02                    |
| Firestore PITR, scheduled backups, DR           | **03 Infrastructure**     | 02                        |
| GDPR service implementation                     | **02 Security**           | 09, 11                    |
| GDPR document accuracy vs code                  | **11 Legal**              | 02, 09                    |
| SDK / cookie-consent race conditions            | **09 Trust/Safety**       | 02                        |
| TMDB client configuration (lang, region)        | **07 TMDB Integration**   | 01, 04                    |
| TMDB API-key exposure / NEXT_PUBLIC risk        | **02 Security**           | 07                        |
| TMDB rate-limit handling / request fan-out      | **04 Performance**        | 07                        |
| Provider catalog accuracy vs Swedish market     | **07 TMDB Integration**   | 10                        |
| Advisor / Följer-status logic correctness       | **07 TMDB Integration**   | 01                        |
| Dependency CVEs and licenses                    | **05 Dependencies**       | 02                        |
| CI/CD pipeline design (deploy.yml)              | **03 Infrastructure**     | 01                        |
| Analytics event strategy & funnel coverage      | **08 Analytics & Growth** | 03, 06                    |
| Design-rule compliance (CLAUDE.md constraints)  | **06 UX**                 | 01                        |
| Accessibility (WCAG 2.1 AA)                     | **06 UX**                 | 01                        |
| Swedish i18n coverage                           | **06 UX**                 | 01, 07                    |
| Responsive design and breakpoints               | **06 UX**                 | 04                        |
| TMDB attribution text                           | **11 Legal**              | 06, 07                    |
| Competitive feature analysis (JustWatch etc.)   | **10 Monetization**       | 06, 07                    |
| Retention hooks (revival nudges, advisor UX)    | **08 Analytics & Growth** | 07                        |

When a prompt encounters a topic owned by another prompt, it should note
"Deferred to prompt NN" and move on. Do not duplicate the analysis.

---

## Final Synthesis

After all 11 prompts complete Phase 1, merge their reports into a single executive summary.

### Weighted Scoring Formula

```
Overall Score = (01 * 0.13) + (02 * 0.12) + (03 * 0.06) + (04 * 0.10)
              + (05 * 0.05) + (06 * 0.15) + (07 * 0.15) + (08 * 0.05)
              + (09 * 0.05) + (10 * 0.07) + (11 * 0.07)
```

Each prompt produces a score from 0–100. The weighted average yields the overall health score.

### Score Interpretation

| Range   | Rating       | Action                                     |
|---------|--------------|--------------------------------------------|
| 90–100  | Excellent    | Minor polish only                          |
| 75–89   | Good         | Targeted improvements, no urgency          |
| 60–74   | Acceptable   | Prioritized remediation within 2 sprints   |
| 40–59   | Needs work   | Significant remediation, block new features|
| 0–39    | Critical     | Stop feature work, fix foundations first   |

### Consolidation Steps

1. **Collect all CRITICAL findings** from all 11 reports into a single list.
   Sort by severity (CRITICAL > HIGH > MEDIUM > LOW), then by effort (quick wins first).

2. **Deduplicate.** If two prompts flagged the same issue despite dedup rules,
   keep the deeper analysis and discard the shallow mention.

3. **Build unified remediation roadmap.**
   Group fixes into sprints:
   - Sprint 1: All CRITICAL items and quick-win HIGH items
     (focus: TMDB-key exposure in 02, design-rule regressions in 06,
     advisor correctness in 07, Firestore-rules gaps in 02)
   - Sprint 2: Remaining HIGH items and systemic MEDIUM items
   - Sprint 3: Remaining MEDIUM items and LOW items worth fixing
   - Backlog: LOW items and nice-to-haves

4. **Produce executive summary.**
   One page covering: overall score, top 5 risks, top 5 strengths,
   sprint roadmap overview, and any items requiring immediate attention.

---

## Prompt Lineage

This system is adapted from the Butlery analysis prompt suite (12 prompts for a
Flutter recipe app). The adaptation:

- **Kept** the two-phase structure, weighted-dimension scoring, file:line discipline,
  cross-prompt dedup rules, and wave-based parallelization.
- **Translated** Flutter/Dart idioms to Next.js/React/TypeScript (MVVM+Repository
  → App Router + hooks + React Query; pubspec.yaml → package.json; flutter_lints
  → ESLint; 5 GitHub Actions workflows → 1 deploy.yml; AAB/IPA → static export).
- **Replaced** Butlery's prompt 07 (AI/LLM Quality) with Binge's 07
  (TMDB Integration & Recommendation) — Binge has no LLM but lives or dies by
  the quality of its TMDB integration and streaming advisor.
- **Bantat** Butlery's UGC-heavy trust/safety prompt (09) since Binge has no
  public UGC at scale; kept consent sequencing, data transfers, age.
- **Dropped** mobile-platform concerns (iOS HIG, Material Design, ATT, privacy
  manifest, app store rejection) that don't apply to a web-only SPA.
- **Added** a dedicated legal prompt (11) mirroring Butlery's for parity.

---

## Usage Example

```
1. Run pre-analysis tooling (see above). Save output to a file.

2. Open a new Claude session. Paste:
   - The contents of this orchestrator (for context)
   - The contents of 01_CODE_QUALITY_AND_ARCHITECTURE.md
   - The pre-analysis tooling output

3. Let the prompt execute Phase 1. Save the report.

4. Repeat for prompts 02–11 (or run in parallel per Option B).

5. Open a final session. Paste all 11 reports.
   Ask: "Synthesize these 11 analysis reports using the Final Synthesis
   instructions from the Master Analysis Orchestrator."

6. The output is your consolidated audit report with overall score
   and unified remediation roadmap.
```
