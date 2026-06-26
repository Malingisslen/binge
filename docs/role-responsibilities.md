# Role responsibilities map

_A reference that maps each aspect of Binge to the **company role** that would
own it in a conventionally-staffed organisation — what a designer, controller,
lawyer, security architect, etc. would each be responsible for._

Binge is built and directed solo (Malin directs; Claude codes), so in practice
one person + an agent wear all of these hats. The point of this document is that
the codebase is legible enough to **staff 26 notional roles**, each with its own
files, guard tests, budgets, and runbooks. It's useful as an onboarding map
("who would own this?"), as a coverage check, and as a way to reason about a
change's blast radius across concerns.

Every responsibility below is grounded in real files. Paths are the source of
truth; line numbers drift, so they're omitted here.

> Generated from a codebase sweep on 2026-06-26. Refresh when major surfaces are
> added or removed.

---

## Index

**Tier 1 — core build roles**
1. [Product Designer / UX](#1-product-designer--ux)
2. [Accessibility Specialist](#2-accessibility-specialist)
3. [Financial Controller](#3-financial-controller)
4. [Security Architect](#4-security-architect)
5. [Legal / GDPR Counsel](#5-legal--gdpr-counsel)
6. [Data Protection Officer](#6-data-protection-officer)
7. [QA / Test Engineer (automated)](#7-qa--test-engineer-automated)
8. [DevOps / SRE](#8-devops--sre)
9. [Product Manager](#9-product-manager)
10. [Performance Engineer](#10-performance-engineer)
11. [Localization / i18n](#11-localization--i18n)
12. [Trust & Safety / Content Moderation](#12-trust--safety--content-moderation)
13. [Data / Integrations Engineer](#13-data--integrations-engineer)
14. [Software Architect](#14-software-architect)

**Tier 2 — go-to-market, brand, and operations roles**
15. [Growth Marketer](#15-growth-marketer)
16. [Creative Director / Brand](#16-creative-director--brand)
17. [Content Strategist / Copywriter](#17-content-strategist--copywriter)
18. [Community Manager](#18-community-manager)
19. [Customer Support / Success](#19-customer-support--success)
20. [Manual / Release QA Tester](#20-manual--release-qa-tester)
21. [Technical Writer / Documentation](#21-technical-writer--documentation)
22. [Data Analyst / BI](#22-data-analyst--bi)
23. [Vendor / Procurement Manager](#23-vendor--procurement-manager)
24. [Monetization / Partnerships Lead](#24-monetization--partnerships-lead)
25. [Engineering Manager / Release Manager](#25-engineering-manager--release-manager)
26. [Information Architect](#26-information-architect)

**Notes:** [Roles that deliberately overlap](#roles-that-deliberately-overlap)

---

## 1. Product Designer / UX

Owns the **"Direction H / Schemat" design system** and the end-to-end user
experience.

- **Design tokens & visual consistency** — OKLCH color tokens, the two-accent
  rule (saffran = CTA/live, plum = time/calendar), the 3/6/8px radius ladder,
  exactly two shadows (`lift`, `pop`). No raw hex in components.
  → `src/app/globals.css`, `tailwind.config.ts`, `src/lib/design/consistency.test.ts`
- **Canonical page recipe** — `PageHeader` (crumb → 44px h1 → standfirst),
  `LoadingView`, `EmptyState`/`NotFound`, segment error boundaries, `danger`
  token for destructive UI.
  → `src/components/layout/PageHeader.tsx`, `src/components/ui/`, `src/components/layout/SegmentError.tsx`
- **Information density & typography** — 15px base, Albert Sans, compact margins,
  tabular numbers; the deliberate "tool not marketing page" feel.
- **Posters & duotone** — 8 genre-mapped SVG duotone filters, hover-to-reveal,
  CLS-safe explicit `width`/`height`, no `next/image`.
  → `src/components/ui/DuotonePoster.tsx`, `src/components/layout/DuotoneFilters.tsx`
- **Responsive layout & app chrome** — sticky topbar, horizontal subnav,
  mobile tab bar, breakpoint collapses, safe-area insets.
  → `src/components/layout/`
- **Interaction primitives** — buttons/chips/selects, toast feedback, modal/
  popover patterns, hover/focus states, motion.
- **Guard test** — `consistency.test.ts` fails the build if a page reintroduces
  the 18px-title anti-pattern.

## 2. Accessibility Specialist

Owns **WCAG AA / EAA compliance** (legally required for Swedish consumer
services from 2025-06-28).

- Skip-to-content link, landmark roles, `lang="sv"`.
- ARIA live regions (toasts, segment errors), `aria-current`, progressbar roles.
- Keyboard nav — ⌘K/Ctrl+K search, arrow-key dropdowns, modal focus save/restore.
- Color contrast across light/dark themes; `prefers-reduced-motion` honoring.
- Image alt-text discipline, accessible form controls.
  → `src/components/layout/AppShell.tsx`, `src/contexts/ToastContext.tsx`, `src/components/ui/ConfirmDialog.tsx`, `docs/analysis/REMEDIATION_PLAN.md` (§5.1–5.6)

## 3. Financial Controller

Owns the **25 SEK/mån Firebase Blaze cap** (50/90/100% alerts).

- Scheduled-function frequency cuts (rollup 4×/day → 1×/day; notifications daily)
  with paginated reads.
  → `functions/src/insights/rollup.ts`, `functions/src/episodeNotify/`
- Build-time TMDB budget (1500-fetch code deploys vs weekly full refresh) +
  `.tmdb-cache/` persistence so most deploys cost ~0 TMDB calls.
  → `src/lib/tmdb/buildFetch.ts`, `src/lib/tmdb/buildCache.ts`, `.github/workflows/deploy.yml`
- localStorage persist whitelist (per-title data banned after a 5MB overflow
  incident).
  → `src/lib/queryClient.ts`
- europe-west1 function placement; preview-channel 7-day TTL; per-service daily
  budgets (see Vendor Manager).

## 4. Security Architect

Owns access control and the attack surface — the **~787-line `firestore.rules`**
is the real boundary.

- Owner-only access, field whitelisting (`hasOnly`), value-bound validation.
- Anti-forgery identity validation (`matchesOwnIdentity`) for all UGC.
- Admin-flag escalation prevention (Console-only).
- SHA-256-hashed, rotatable invite tokens (plaintext never persisted).
  → `src/lib/firebase/groups.ts`, `src/lib/firebase/utils.ts`
- Server-authoritative rate limiting (`submitReport` callable).
- App Check (reCAPTCHA v3, fail-closed default), CSP/HSTS headers, secrets via
  `NEXT_PUBLIC_*` / `defineSecret`, cache-clear on logout for shared devices.
  → `firestore.rules`, `firebase.json`, `src/lib/firebase/appCheck.ts`, `src/lib/firebase/db.ts`

## 5. Legal / GDPR Counsel

Owns data-protection compliance under Swedish/EU law.

- GDPR Art. 20 export + Art. 17 erasure cascade.
  → `src/lib/firebase/dataExport.ts`, `src/contexts/AuthContext.tsx`, `src/lib/firebase/userData.ts`
- Terms / Privacy / Community-Guidelines pages (versioned), terms-acceptance
  capture at signup, 13-year age gate.
  → `src/app/{villkor,integritet,community-guidelines}/page.tsx`
- Cookie-free Plausible (LEK compliance, no consent banner).
- TMDB **and** JustWatch attribution requirements.
  → `src/lib/tmdb/attribution.ts`
- Cross-border transfer / SCC documentation; Sentry PII scrubbing.
  → `src/lib/sentry.ts`

## 6. Data Protection Officer

Owns the **personal-data inventory** and its hygiene.

- Canonical record of personal data across 24+ subcollections; the single
  `collectUserDataSnapshots` helper both export and deletion must stay in sync
  with.
  → `src/lib/firebase/userData.ts`
- Three-tier visibility denormalization (`effectiveVisibility`).
- Data minimization (field-length caps), consent versioning, FCM token
  lifecycle, processor oversight, operational-metadata exclusion from exports.
  → `firestore.rules`, `src/types/domain.ts`, `docs/data-retention-policy.md`

## 7. QA / Test Engineer (automated)

Owns Vitest infrastructure and the **testing-honesty policy** ("never weaken an
assertion to go green").

- Firestore rules tests against the emulator (100+ cases).
  → `src/test/rules/firestore-rules.test.ts`
- Pure-logic extraction (`*.helpers.ts`) so units test without Firebase.
- Regression guards — design anti-patterns, forced `Europe/Stockholm` TZ to
  catch off-by-one date bugs, `assertNever` exhaustiveness.
  → `vitest.config.ts`, `src/lib/design/consistency.test.ts`
- MSW network mocking; CI quality gates.

## 8. DevOps / SRE

Owns CI/CD, hosting, observability, and incident response.

- Three GitHub Actions workflows; the rules-tests deploy gate; the **drift-guard**
  blocking silent rules/functions deploys.
  → `.github/workflows/{ci,deploy,preview}.yml`
- Static export → Firebase Hosting → Cloudflare; CSP/HSTS headers; cache tiers.
  → `firebase.json`
- Observability — Sentry, Plausible, UptimeRobot; `SLO.md`; incident `RUNBOOK.md`
  + `EXTERNAL_ACTIONS_RUNBOOK.md`; emulator suite.

## 9. Product Manager

Owns feature design and roadmap.

- The asymmetric TV-vs-film status model; the killer feature (Swedish streaming
  availability); the subscription/rotation advisor; "Tillsammans" sessions;
  calendar; onboarding; the library-card free-streaming wedge.
  → `src/types/{domain,advisor}.ts`, `src/lib/watchStatus.ts`, `docs/tillsammans-roadmap.md`
- Sprint planning + analytics event taxonomy.
  → `docs/analysis/REMEDIATION_PLAN.md`

## 10. Performance Engineer

Owns caching and responsiveness.

- Shared `TMDB_STALE` constants (prevent observer contention); lite-vs-full query
  variants on fan-out surfaces.
  → `src/lib/tmdb/cacheTiers.ts`, `src/lib/tmdb/client.ts`
- 8-concurrent TMDB semaphore + Retry-After + AbortSignal propagation.
- localStorage persist budget; per-show `useQueries` fan-out fix; CLS-safe images;
  3s persist throttle.
  → `src/lib/queryClient.ts`, `src/hooks/useCalendar.ts`

## 11. Localization / i18n

Owns **everything Swedish**.

- `sv-SE` / `watch_region=SE` / `region=SE` params.
- The Swedish provider catalog with alias canonicalization; Swedish digital
  release-date extraction; status/section/genre/country labels; date + plural
  formatting; 290 municipalities; Swedish NL query parsing.
  → `src/lib/tmdb/{providers,genreLabels,countries}.ts`, `src/lib/watchStatus.ts`, `src/lib/libraries/municipalities.ts`, `src/lib/askBinge/parseSearch.ts`

## 12. Trust & Safety / Content Moderation

**Polices** UGC (the Community Manager builds it).

- Report intake with 10s server cooldown; the `/admin/reports` dashboard; triage
  decision tree by reason; hard content removal; account-termination cascade;
  self-service blocking; community guidelines; law-enforcement escalation
  (NCMEC/IMY).
  → `functions/src/submitReport/`, `src/app/admin/reports/`, `docs/moderation.md`, `src/hooks/useBlockedUsers.ts`

## 13. Data / Integrations Engineer

Owns external data pipelines.

- TMDB client; provider canonicalization + affiliate-link infra; FCM push.
- Scheduled collectors — episode/return/availability notifications, MOTN
  streaming-offer caching + price history, weekly Cineasterna sync,
  community-rating aggregation, OMDb external ratings.
  → `functions/src/{episodeNotify,returnNotify,availableNotify,streamingOffers,cineasterna,communityRatings,titleRatings}/`, `src/lib/tmdb/providers.ts`

## 14. Software Architect

Owns the cross-cutting structure.

- Static-export SPA + catch-all routing; the TV-aware status schema with derived
  sub-states; the lazy 3-version migration philosophy (write-on-edit, never
  bulk-rewrite); the three-tier TMDB cache design; the SEO pre-render pipeline;
  context/provider hierarchy; deploy gating.
  → `next.config.mjs`, `src/app/[...path]/`, `src/lib/watchStatus.migration.ts`, `src/contexts/WatchlistContext.tsx`

---

## 15. Growth Marketer

Owns acquisition and the top of the funnel.

- ~25k-title SEO pre-render + matching sitemap (parity prevents "crawled but not
  indexed"); `robots.txt` crawl-budget rules; JSON-LD (FAQPage, Organization,
  provider ItemLists); OpenGraph/Twitter share cards.
  → `src/app/sitemap.ts`, `src/lib/tmdb/seoCoverage.ts`, `public/robots.txt`
- 12 curated provider landing pages ("Vad streamar på Netflix i Sverige").
  → `src/app/provider/[id]/page.tsx`
- The anonymous landing page; Plausible conversion goals (`signed_up`,
  `first_title_added`, `onboarding_completed` by step); group/session invite-share
  loops.
  → `src/app/page.tsx`, `src/lib/analytics.ts`

## 16. Creative Director / Brand

Owns brand identity above the design system.

- The "Prisjakt-for-media" positioning and the deliberate *"doesn't look
  AI-generated"* stance.
- The saffran-square brand mark + `binge.nu` logotype; PWA manifest / OG-image /
  theme-color.
  → `public/og-image.svg`, `public/manifest.json`, `src/components/layout/AppTopbar.tsx`
- Swedish product naming (Tillsammans, Streamingrådgivaren, Fråga Binge — "Ask,"
  not "Chat with"); brand coherence across social surfaces (ratings-first
  reviews, no celebration animations).
  → `docs/voice-and-tone.md`, `docs/superpowers/plans/`

## 17. Content Strategist / Copywriter

Owns every Swedish word.

- The 8 binding voice rules (du-form, imperative CTAs, U+2026 ellipsis, no
  emojis); the domain-vocabulary lock (one term per concept).
  → `docs/voice-and-tone.md`
- Status labels; the what/why/next empty-state pattern; error wording that never
  leaks tech internals; calendar headlines; legal prose; moderation/report copy.
  → `src/lib/watchStatus.ts`, `src/lib/calendar/copy.ts`, `src/app/{villkor,integritet,community-guidelines}/`

## 18. Community Manager

**Builds and grows** the social fabric (Trust & Safety polices it).

- Friend/follow graph with mirrored docs; user search/discovery; groups +
  Tillsammans co-watching sessions; activity feed + follow-trending;
  reviews/comments/likes; three-tier visibility; **taste-match** compatibility
  scoring.
  → `src/lib/firebase/friends.ts`, `src/hooks/{useFollow,useReviewSocial,useTasteVector}.ts`, `src/app/feed/page.tsx`, `src/lib/taste/`

## 19. Customer Support / Success

Owns the human interface to the system.

- `hej@binge.nu` as the support / GDPR / abuse channel (footer + all 3 legal
  pages); auth error recovery with friendly Swedish messages; email-verification
  resend; the export/deletion flows users trigger; Letterboxd/IMDb CSV import;
  username conflict help; onboarding hand-holding.
  → `src/app/login/page.tsx`, `src/components/layout/EmailVerificationBanner.tsx`, `src/app/settings/import/page.tsx`, `src/components/settings/`, `src/components/layout/Footer.tsx`

## 20. Manual / Release QA Tester

Owns what automated tests can't reach (there is **no E2E suite**).

- Per-PR preview-channel testing (7-day TTL); post-deploy smoke tests
  (`RUNBOOK.md` §11 checklist); cross-browser/device + dark-mode validation; real
  Firebase auth/rules/FCM flow verification; SLO regression watching.
  → `.github/workflows/preview.yml`, `docs/RUNBOOK.md`, `docs/SLO.md`

## 21. Technical Writer / Documentation

Owns the `docs/` corpus.

- Data-export-format spec + schema versioning; data-retention policy; the
  12-section incident `RUNBOOK.md`; the moderation runbook;
  `EXTERNAL_ACTIONS_RUNBOOK.md`; `SLO.md`; the advisor-logic ADR; `public/llms.txt`;
  the env-var reference; inline "why/gotcha" comment conventions.
  → `docs/data-export-format.md`, `docs/moderation.md`, `docs/advisor-logic.md`, `public/llms.txt`

## 22. Data Analyst / BI

Owns measurement.

- The typed `AnalyticsEvent` taxonomy; the daily Firestore rollup feeding the
  admin `/insikter` dashboard; the metrics catalog with thresholds + explanations;
  Ask-Binge learning-loop telemetry (which filter combos strand users);
  onboarding-funnel dropoff; per-read cost tracking.
  → `functions/src/insights/`, `functions/src/askbinge/`, `src/app/insikter/metrics/catalog.ts`

## 23. Vendor / Procurement Manager

Owns the third-party stack and its costs.

- ~10 vendors (TMDB, MOTN/RapidAPI, OMDb, Firebase, Cloudflare, Sentry, Plausible,
  reCAPTCHA, Gemini, Cineasterna), each with a per-service daily budget (MOTN
  95/day under free 100; OMDb 900/day under 1000; Gemini 2000 global + 25/user);
  secret lifecycle via `defineSecret`; free-vs-paid tradeoffs (MOTN Pro $39/mo);
  substitution planning.
  → `functions/src/{streamingOffers,titleRatings,askbinge}/`, `docs/analysis/EXTERNAL_ACTIONS.md`

## 24. Monetization / Partnerships Lead

Owns the nascent revenue surface.

- The Streamingrådgivaren savings angle (cost-per-title, dead-weight detection,
  savings ledger); the table-driven affiliate-link infra (built but empty,
  awaiting partner signup); the MOTN price-history asset; the **library-card
  free-streaming wedge** (Cineasterna/Viddla via `hemkommun`) as the defensible
  local moat.
  → `src/lib/advisor/serviceValue.ts`, `src/lib/tmdb/providers.ts`, `src/lib/streaming/cheapestPath.ts`, `docs/superpowers/plans/2026-06-23-bin-172-library-card-layer.md`

## 25. Engineering Manager / Release Manager

Owns the process.

- The solo push-direct-to-main working agreement + the risky-migration
  written-plan exception; the deploy drift-guard (rules/functions never
  auto-ship); the 5 CI quality gates; BIN-* issue taxonomy + sprint cadence;
  Dependabot grouping + the deferred Sprint 7 framework upgrade; the "explain in
  product terms" communication norm.
  → `CLAUDE.md` (working agreement), `.github/workflows/deploy.yml`, `.github/dependabot.yml`, `docs/analysis/SPRINT_7_PLAN.md`

## 26. Information Architect

Owns wayfinding.

- The two-tier nav (7-item Subnav + 5-tab MobileTabBar); the URL scheme + catch-all
  dispatch; the 301 redirect map (`/my/following → /my/series`); the library
  section taxonomy mapping watch-status → routes; breadcrumb/`PageHeader` patterns;
  search/discovery filter hierarchy; genre cross-media mapping; noindex-by-default
  on private pages.
  → `src/components/layout/{Subnav,MobileTabBar}.tsx`, `src/components/pages/DynamicRouter.tsx`, `firebase.json` (redirects), `src/lib/libraryView.ts`

---

## Roles that deliberately overlap

Three pairs share a surface but split by **intent** — worth keeping distinct:

- **Testing splits in two.** The _QA / Test Engineer_ (#7) owns automated Vitest +
  rules-tests + guard tests. The _Manual / Release QA Tester_ (#20) owns
  exploratory, preview-channel, and device testing. The gap is real because there
  is no Playwright/Cypress E2E suite.
- **Social moderation splits in two.** _Trust & Safety_ (#12) **polices** UGC
  (reports, bans, escalation). The _Community Manager_ (#18) **builds and grows**
  the social layer. Same surface, opposite intent.
- **Brand sits above design.** The _Creative Director_ (#16) owns brand, naming,
  and positioning; the _Product Designer_ (#1) owns the component-level design
  system that expresses it.

Other natural adjacencies: Controller (#3) ↔ Vendor Manager (#23) ↔ Monetization
(#24) all touch the 25 SEK/mån cap from different angles (cut cost / manage
suppliers / earn revenue); Legal (#5) ↔ DPO (#6) ↔ Trust & Safety (#12) all touch
user data and policy; DevOps (#8) ↔ Eng Manager (#25) ↔ Manual QA (#20) all touch
the release pipeline.
