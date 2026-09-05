# Role responsibilities map

_A reference that maps each aspect of Binge to the **company role** that would
own it in a conventionally-staffed organisation — what a designer, controller,
lawyer, security architect, etc. would each be responsible for._

Binge is built and directed solo (Malin directs; Claude codes), so in practice
one person + an agent wear all of these hats. The point of this document is that
the codebase is legible enough to **staff 28 notional roles**, each with its own
files, guard tests, budgets, and runbooks. It's useful as an onboarding map
("who would own this?"), as a coverage check, and as a way to reason about a
change's blast radius across concerns.

Every responsibility below is grounded in real files. Paths are the source of
truth; line numbers drift, so they're omitted here.

> Generated from a multi-agent codebase sweep on 2026-06-26 (two descriptive
> passes, then a third **diagnostic** sweep that added the DBA and
> scoring-integrity lenses and the [un-owned gaps](#genuinely-un-owned-gaps)
> section). Refresh when major surfaces are added or removed.
> **Refreshed 2026-07-04** (`/refresh-dossiers`, all 28 flagged): updated the Agent-Ops
> section (the role-org machinery has since landed), role 28's advisor bullet
> (campaign-aware cost + list optimizer, BIN-417/416), and role 25 (the cast-the-panel
> governance rule). The other 25 dossiers re-audited accurate.

> **World-watch layer.** Each role also carries an external-knowledge posture —
> what it must watch in the outside world (CVEs, EU law, vendor terms, framework
> releases) to keep its part of Binge at the frontier. That's folded into
> [`docs/org/world-watch/ROLE_WORLD_MODEL.md`](org/world-watch/ROLE_WORLD_MODEL.md)
> (per-role modes · stakes · cadence · authority · verified sources, plus gaps and
> overlaps). The org's operating rules + the live monitoring MVP are in
> [`docs/org/world-watch/DESIGN.md`](org/world-watch/DESIGN.md).

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

**Tier 3 — added by the diagnostic sweep**
27. [Database Administrator / Data-layer Engineer](#27-database-administrator--data-layer-engineer)
28. [Recommendations / Scoring-Integrity Engineer](#28-recommendations--scoring-integrity-engineer)

**Notes:** [Genuinely un-owned gaps](#genuinely-un-owned-gaps) ·
[Roles that deliberately overlap](#roles-that-deliberately-overlap) ·
[A role that doesn't exist here: Agent-Ops](#a-role-that-doesnt-exist-here-agent-ops)

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
  → `src/components/ui/DuotonePoster.tsx`, `src/components/ui/DuotoneFilters.tsx`
- **Responsive layout & app chrome** — sticky topbar, horizontal subnav,
  mobile tab bar, breakpoint collapses, safe-area insets.
  → `src/components/layout/`
- **Interaction primitives** — buttons/chips/selects, toast feedback, modal/
  popover patterns, hover/focus states, motion.
- **Guard test** — `consistency.test.ts` fails the build if a page reintroduces
  the 18px-title anti-pattern.
- **Filer som saknade en ägande roll** (BIN-871). Tema, duotone-filtret och designtokens.
  → `src/contexts/ThemeContext.tsx`, `src/lib/design/tokens.test.ts`, `src/lib/duotone.ts`


## 2. Accessibility Specialist

Owns **WCAG AA / EAA compliance** (legally required for Swedish consumer
services from 2025-06-28).

- Skip-to-content link, landmark roles, `lang="sv"`.
- ARIA live regions (toasts, segment errors), `aria-current`, progressbar roles.
- Keyboard nav — ⌘K/Ctrl+K search, arrow-key dropdowns, modal focus save/restore.
- Color contrast across light/dark themes; `prefers-reduced-motion` honoring.
- Image alt-text discipline, accessible form controls.
  → `src/components/layout/AppShell.tsx`, `src/contexts/ToastContext.tsx`, `src/components/ui/ConfirmDialog.tsx`
- **Filer som saknade en ägande roll** (BIN-871). Toastens test, som hänger ihop med den kontext du redan äger.
  → `src/contexts/ToastContext.test.tsx`


## 3. Financial Controller

Owns the **25 SEK/mån Firebase Blaze cap** (50/90/100% alerts).

- Scheduled-function frequency cuts (rollup 4×/day → 1×/day) with paginated reads.
  `episodeReleaseNotify` itself is `onSchedule('every 6 hours')` — 4×/day, unchanged
  since it shipped, so it is not one of the cuts.
  → `functions/src/insights/rollup.ts`, `functions/src/episodeNotify/`
- Build-time TMDB budget (1500-fetch code deploys vs weekly full refresh) +
  `.tmdb-cache/` persistence so most deploys cost ~0 TMDB calls.
  → `src/lib/tmdb/buildFetch.ts`, `src/lib/tmdb/buildCache.ts`, `.github/workflows/deploy.yml`
- localStorage persist whitelist (per-title data banned after a 5MB overflow
  incident).
  → `src/lib/queryClient.ts`
- europe-west1 function placement; per-service daily
  budgets (see Vendor Manager).
- **Filer som saknade en ägande roll** (BIN-871). Testerna för de kostnadsbärande cache- och hämtvägarna.
  → `src/lib/queryClient.persist.test.ts`, `src/lib/queryClient.retry.test.ts`, `src/lib/tmdb/buildCache.test.ts`, `src/lib/tmdb/buildFetch.test.ts`


## 4. Security Architect

Owns access control and the attack surface — **`firestore.rules`**
is the real boundary.

- Owner-only access, field whitelisting (`hasOnly`), value-bound validation.
- Anti-forgery identity validation (`matchesOwnIdentity`) for all UGC.
- Admin-flag escalation prevention (Console-only).
- SHA-256-hashed, rotatable invite tokens (plaintext never persisted).
  → `src/lib/firebase/groups.ts`, `src/lib/firebase/utils.ts`
- Distinguishing a server REFUSAL from infrastructure noise. Only `permission-denied`
  proves the server rejected a write on its merits; `unavailable`, `deadline-exceeded`
  and offline all go away on their own. Collapsing the two shipped once and was rolled
  back (a bad mobile connection reported as "the invite link is invalid"), and BIN-942
  gave the predicate a second caller — the watchlist edit paths that swallow the
  create-floor's refusal. One definition, so the two cannot drift.
  → `src/lib/firebase/errorCodes.ts`
- Server-authoritative rate limiting (`submitReport` callable).
- App Check (reCAPTCHA v3, fail-closed default), CSP/HSTS headers, secrets via
  `NEXT_PUBLIC_*` / `defineSecret`, cache-clear on logout for shared devices.
  → `firestore.rules`, `firebase.json`, `src/lib/firebase/appCheck.ts`, `src/lib/firebase/db.ts`
- **Which workflow actually runs on the path code takes** (BIN-1028). Read the `on:`
  block of every file in the workflows directory (written without backticks on purpose: the generator harvests every
  backtick-quoted tracked path in a section, so quoting the directory would seat this
  role on the whole tree). A bare `push:` has no `branches:` key to grep for and is
  invisible to a pattern search, which is why this says read rather than grep. The two
  that fired on no main push at all were DELETED on Malin's decision 2026-08-27 rather
  than repaired. They did gate `pull_request`, which is where dependabot bumps land, so
  `pr-checks.yml` covers part of that. What it does and deliberately does NOT do is
  enumerated in its own header — read that file rather than a summary here, because a
  second list is a second thing to keep true. `npm audit`
  is advisory on the surviving path by BIN-344's decision. Cite the workflow whose
  trigger matches the event, never "CI".
  → `.github/workflows/deploy.yml`, `.github/workflows/pr-checks.yml`, `.github/workflows/secret-scan.yml`
- **Vakten över de publika miljövariablernas inkoppling** (BIN-1080). scripts/ hade ingen
  ägande roll alls. Katalogen skrivs utan backticks: generatorn skördar backtick-citerade
  spårade sökvägar, och ett token med avslutande snedstreck ger rollen HELA katalogen.
  Skriptets eget filhuvud säger vad det gör: varje `NEXT_PUBLIC_*` klienten läser måste
  lämnas till produktionsbygget, och det är INKOPPLINGEN som prövas, inte värdet — en
  hemlighet som är tom eller fel passerar. Det stänger BIN-849, där en variabel saknades i
  bygget i tre månader med både CI och deploy gröna.
  → `scripts/check-public-env.mjs`, `scripts/check-public-env.test.mjs`
- **Beroendediffen på Dependabots väg in** (BIN-1088). Skriptet läser båda
  paketmanifesten vid basen och vid huvudet och fäller på ett nytt installationsskript,
  en flytt ut ur devDependencies, eller ett paket som inte var deklarerat förut. Det
  sitter här och inte hos #25 av samma skäl som vakten ovan: sätet följer vad filen är
  till för, och den läser en väg in i main som ingen granskningsgrind och ingen
  push-grind når. Den läser manifesten, inte låsfilerna —
  BIN-939 och BIN-344 avgjorde den avgränsningen.
  → `scripts/check-dependency-diff.mjs`, `scripts/check-dependency-diff.test.mjs`

- **Filer som saknade en ägande roll** (BIN-871). Lösenordsstyrkan, auth-felen, push-token och utloggningsomdirigeringen.
  → `src/hooks/useAuth.ts`, `src/hooks/useFcmToken.ts`, `src/hooks/useSignedOutRedirect.ts`, `src/lib/authErrors.ts`, `src/lib/firebase/db.test.ts`, `src/lib/firebase/groups.test.ts`, `src/lib/firebase/utils.test.ts`, `src/lib/passwordStrength.test.ts`, `src/lib/passwordStrength.ts`


## 5. Legal / GDPR Counsel

Owns data-protection compliance under Swedish/EU law.

- GDPR Art. 20 export + Art. 17 erasure cascade.
  → `src/lib/firebase/dataExport.ts`, `src/contexts/AuthContext.tsx`, `src/lib/firebase/userData.ts`
- **Aborted-deletion state** (BIN-816, ADR 0019/0020) — the device-local marker that
  stops a half-deleted profile being recreated with a fresh consent record, and the
  single chokepoint every `users/{uid}` / `publicProfiles/{uid}` write passes through.
  A change here decides whether an Art. 17 request can silently un-happen.
  → `src/lib/deletionMarker.ts`, `src/lib/deletionMarker.test.ts`,
  `src/lib/deletionInProgressError.ts`,
  `src/lib/firebase/userDocWrite.ts`, `src/lib/firebase/userDocWrite.test.ts`,
  `src/lib/firebase/userDocWrite.chokepoint.test.ts`,
  `src/lib/firebase/accountDeletion.applyPlan.test.ts`
- Terms / Privacy / Community-Guidelines pages (versioned), terms-acceptance
  capture at signup, 13-year age gate.
  → `src/app/{villkor,integritet,community-guidelines}/page.tsx`
- Cookie-free Plausible (LEK compliance, no consent banner).
- TMDB **and** JustWatch attribution requirements.
  → `src/lib/tmdb/attribution.ts`
- Cross-border transfer / SCC documentation; Sentry PII scrubbing.
  → `src/lib/sentry.ts`
- Lawful basis for UGC report handling + law-enforcement escalation (NCMEC/IMY);
  retention/disclosure of report records.
  → `functions/src/submitReport/`
- **Filer som saknade en ägande roll** (BIN-871). Juridiktexterna och testerna för raderings- och samtyckesvägarna du äger.
  → `src/contexts/AuthContext.test.tsx`, `src/lib/firebase/dataExport.coverage.test.ts`, `src/lib/firebase/userData.subcollections.test.ts`, `src/lib/legal.ts`, `src/lib/sentry.test.ts`, `src/lib/firebase/accountDeletion.ts`


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
- UGC report records as personal data in the inventory (reporter identity +
  reported-content references); their retention + erasure handling.
  → `functions/src/submitReport/`
- **Filer som saknade en ägande roll** (BIN-871). Testet för de användarägda undersamlingarna.
  → `src/lib/firebase/userData.subcollections.test.ts`


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

- The GitHub Actions workflows; the rules-tests deploy gate; the **drift-guard**
  blocking silent rules/functions deploys.
  → `.github/workflows/deploy.yml`, `.github/workflows/pr-checks.yml`
- **The gitleaks secret scan** (BIN-922). It was the one workflow with no owning role:
  the blocking gate covers the whole workflows directory by prefix, so a change to it
  was stopped at commit time by a reviewer while the advising side called it
  uninteresting — and the gate-symmetry check carried a named exception saying the
  remedy was an ownership decision for this role or #20, with nothing tracking it.
  Written without a backticked directory on purpose: the generator harvests every
  backtick-quoted tracked path in a section, so naming the workflows directory in a
  sentence ABOUT it would have handed this role the whole workflows directory as one
  pattern.
  Seated here rather than with #4 Security Architect even though its SUBJECT is
  credential leakage: what a change to this file touches is CI plumbing — the pinned
  gitleaks version, the download step, the exit-code flag that decides whether a hit
  fails the job — which is this role's surface, the same as the workflows above.
  #4 remains the escalation for what counts as a leak, which lives in the allowlist
  config rather than in the workflow.
  → `.github/workflows/secret-scan.yml`
- Static export → Firebase Hosting → Cloudflare; CSP/HSTS headers; cache tiers.
  → `firebase.json`
- Observability — Sentry, Plausible, UptimeRobot; `SLO.md`; incident `RUNBOOK.md`;
  the `docs/analysis/EXTERNAL_ACTIONS.md` ops reference; emulator suite.
- **Filer som saknade en ägande roll** (BIN-871). Felrapportering och plattformsdetektering — driftens sida av klienten.
  → `src/lib/platform.test.ts`, `src/lib/platform.ts`


## 9. Product Manager

Owns feature design and roadmap.

- The asymmetric TV-vs-film status model; the killer feature (Swedish streaming
  availability); the subscription/rotation advisor; "Tillsammans" sessions;
  calendar; onboarding; the library-card free-streaming wedge.
  → `src/types/{domain,advisor}.ts`, `src/lib/watchStatus.ts`, `docs/org/adr/0013-tillsammans-social-design.md`
- The season/episode progress surface — the expandable season list, the curated
  season-0 specials section, the per-episode row with its watched checkbox and
  "Markera hit" bulk action, and the group spoiler mask that blanks a row for a
  viewer who is ahead of the group's slowest member. This is where the TV status
  model above becomes something a user touches.
  → `src/components/tv/SeasonList.tsx`, `src/components/tv/SeasonList.test.tsx`, `src/components/tv/SeasonRow.tsx`, `src/components/tv/SeasonEpisodePanel.tsx`, `src/components/tv/EpisodeRow.tsx`, `src/components/tv/EpisodeRow.test.tsx`
- Sprint planning + analytics event taxonomy.
  → `src/lib/analytics.ts`
- **Filer som saknade en ägande roll** (BIN-871). Dagboken och testerna för avsnittsytorna du äger.
  → `src/lib/analytics.test.ts`, `src/lib/diary.test.ts`, `src/lib/diary.ts`, `src/lib/watchStatus.test.ts`


## 10. Performance Engineer

Owns caching and responsiveness.

- Shared `TMDB_STALE` constants (prevent observer contention); lite-vs-full query
  variants on fan-out surfaces.
  → `src/lib/tmdb/cacheTiers.ts`, `src/lib/tmdb/client.ts`
- 8-concurrent TMDB semaphore + Retry-After + AbortSignal propagation.
- localStorage persist budget; per-show `useQueries` fan-out fix; CLS-safe images;
  3s persist throttle.
  → `src/lib/queryClient.ts`, `src/hooks/useCalendar.ts`, `src/components/Providers.tsx`
- **Filer som saknade en ägande roll** (BIN-871). Cachelagrets tester och de hookar som styr hämtningstakten.
  → `src/hooks/useCalendar.test.ts`, `src/lib/queryClient.persist.test.ts`, `src/lib/queryClient.retry.test.ts`, `src/lib/tmdb/client.network.test.ts`, `src/lib/tmdb/client.test.ts`


## 11. Localization / i18n

Owns **everything Swedish**.

- `sv-SE` / `watch_region=SE` / `region=SE` params.
- The Swedish provider catalog with alias canonicalization; Swedish digital
  release-date extraction; status/section/genre/country labels; date + plural
  formatting; 290 municipalities; Swedish NL query parsing.
  → `src/lib/tmdb/{providers,genreLabels,countries}.ts`, `src/lib/watchStatus.ts`, `src/lib/libraries/municipalities.ts`, `src/lib/askBinge/parseSearch.ts`
- **Filer som saknade en ägande roll** (BIN-871). Bibliotekskatalogen och testerna för de lokaliserade TMDB-listorna.
  → `src/lib/askBinge/parseSearch.test.ts`, `src/lib/libraries/municipalities.test.ts`, `src/lib/tmdb/countries.test.ts`, `src/lib/tmdb/providers.affiliate.test.ts`, `src/lib/tmdb/providers.identityGuard.test.ts`, `src/lib/tmdb/providers.test.ts`, `src/lib/watchStatus.test.ts`


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
  community-rating aggregation, OMDb external ratings. Since BIN-727 step 2 the
  daily watchlist push job's orchestration lives behind an injected port
  (`availableNotify/runNotify.ts`, importing no firebase-admin) and is driven
  against a live Firestore emulator with TMDB and FCM doubles — so that emulator
  spec belongs to this role too, not to the rules-owning role that owns its
  neighbours in the same directory. Same split as `retentionCleanup`'s (§27).
  Name that directory in prose only, NEVER in backticks — and note this sentence
  obeys its own rule, which is why it reads awkwardly. The generator under
  docs/org collects every backtick-quoted path-like token in a role's section, not
  just the ones after the arrow, so a bare backticked directory here would hand
  this role the security-rules spec, the retention spec and every file added there
  later — and would disarm the BIN-788 unowned-file ratchet for the whole
  directory, silently. Caught by the integration reviewer 2026-08-15.
  → `functions/src/{episodeNotify,returnNotify,availableNotify,streamingOffers,cineasterna,communityRatings,titleRatings}/`, `src/lib/tmdb/providers.ts`,
  `src/test/rules/available-notify-orchestrator.test.ts`
- **Filer som saknade en ägande roll** (BIN-871). TMDB-integrationen, kalenderposterna som byggs ur den, och de hookar som läser externa källor.
  → `src/hooks/useCommunityRating.ts`, `src/hooks/useGenreMap.ts`, `src/hooks/usePremiereEvents.ts`, `src/hooks/useRotationCalendar.ts`, `src/hooks/useSearchProviders.ts`, `src/hooks/useSwedishWikiBio.ts`, `src/hooks/useTMDB.ts`, `src/hooks/useTitleRatings.ts`, `src/lib/airingState.test.ts`, `src/lib/airingState.ts`, `src/lib/calendar/buildEntries.test.ts`, `src/lib/calendar/buildEntries.ts`, `src/lib/calendar/entry.test.ts`, `src/lib/calendar/entry.ts`, `src/lib/calendar/nextAir.ts`, `src/lib/calendar/premieres.test.ts`, `src/lib/calendar/premieres.ts`, `src/lib/calendar/releaseDate.test.ts`, `src/lib/calendar/releaseDate.ts`, `src/lib/calendar/seedEntries.test.ts`, `src/lib/calendar/seedEntries.ts`, `src/lib/calendar/summary.test.ts`, `src/lib/calendar/summary.ts`, `src/lib/calendar/types.ts`, `src/lib/tmdb/canonicalUniqueProviders.test.ts`, `src/lib/tmdb/department.test.ts`, `src/lib/tmdb/department.ts`, `src/lib/tmdb/filmographyCompletion.test.ts`, `src/lib/tmdb/filmographyCompletion.ts`, `src/lib/tmdb/genreMapping.test.ts`, `src/lib/tmdb/genreMapping.ts`, `src/lib/tmdb/personCredits.test.ts`, `src/lib/tmdb/personCredits.ts`, `src/lib/tmdb/personSeed.test.ts`, `src/lib/tmdb/personSeed.ts`, `src/lib/tmdb/prefetch.test.ts`, `src/lib/tmdb/prefetch.ts`, `src/lib/tmdb/providerAliasParity.test.ts`, `src/lib/tmdb/providers.affiliate.test.ts`, `src/lib/tmdb/providers.identityGuard.test.ts`, `src/lib/tmdb/providers.test.ts`, `src/lib/tmdb/resolveProviderMonthlyCost.test.ts`, `src/lib/tmdb/seProviderIds.test.ts`, `src/lib/tmdb/seProviderIds.ts`, `src/lib/tmdb/seasonCompletion.test.ts`, `src/lib/tmdb/seasonCompletion.ts`, `src/lib/tmdb/semaphore.test.ts`, `src/lib/tmdb/semaphore.ts`, `src/lib/tmdb/seoPersonIds.test.ts`, `src/lib/tmdb/seoPersonIds.ts`, `src/types/tmdb.ts`


## 14. Software Architect

Owns the cross-cutting structure.

- Static-export SPA + catch-all routing; the TV-aware status schema with derived
  sub-states; the lazy 3-version migration philosophy (write-on-edit, never
  bulk-rewrite); the three-tier TMDB cache design; the SEO pre-render pipeline;
  context/provider hierarchy; deploy gating.
  → `next.config.mjs`, `src/app/[...path]/`, `src/lib/watchStatus.migration.ts`, `src/contexts/WatchlistContext.tsx`

- **Filer som saknade en ägande roll** (BIN-871). Domäntyperna, de generiska UI-hjälphookarna och de delade hjälparna utan egen domän.
  → `src/contexts/WatchlistContext.test.tsx`, `src/hooks/pagination.test.ts`, `src/hooks/pagination.ts`, `src/hooks/useClickOutside.ts`, `src/hooks/useDebouncedCommit.test.ts`, `src/hooks/useDebouncedCommit.ts`, `src/hooks/useDebouncedValue.ts`, `src/hooks/useInView.test.ts`, `src/hooks/useInView.ts`, `src/hooks/useIncrementalList.test.ts`, `src/hooks/useIncrementalList.ts`, `src/hooks/useMountTime.ts`, `src/hooks/useOptimisticMirrorField.test.ts`, `src/hooks/useOptimisticMirrorField.ts`, `src/lib/assertNever.ts`, `src/lib/sessionTiming.test.ts`, `src/lib/sessionTiming.ts`, `src/lib/tabSession.test.ts`, `src/lib/tabSession.ts`, `src/lib/utils.test.ts`, `src/lib/utils.ts`, `src/types/index.ts`, `src/lib/watchStatus.migration.test.ts`

---

## 15. Growth Marketer

Owns acquisition and the top of the funnel.

- ~25k-title SEO pre-render + matching sitemap (parity prevents "crawled but not
  indexed"); `robots.txt` crawl-budget rules; JSON-LD (FAQPage, Organization,
  provider ItemLists); OpenGraph/Twitter share cards.
  → `src/app/sitemap.ts`, `src/lib/tmdb/seoCoverage.ts`, `public/robots.txt`
- **The pre-render selection ratchet** — which titles get a pre-rendered, indexable
  page at all: the persisted selection manifest (ceiling, floor, oldest-first
  eviction) and the committed seed of ids Google already had indexed. A change that
  shrinks either de-indexes real pages (BIN-823).
  → `src/lib/tmdb/selectionManifest.ts`, `src/lib/seo/selectionSeed.ts`
- 12 curated provider landing pages ("Vad streamar på Netflix i Sverige"); the curated
  genre landing pages (BIN-461); the franchise "billigaste"/"vad försvinner" pages
  (BIN-178); the guides hub-of-hubs; and the shared JSON-LD escaper those pages inject
  with.
  → `src/app/provider/[id]/page.tsx`, `src/app/genre/[slug]/page.tsx`,
  `src/app/billigaste/[slug]/page.tsx`, `src/app/forsvinner/[id]/page.tsx`,
  `src/app/guider/page.tsx`, `src/lib/seo/genreHubs.ts`, `src/lib/seo/franchises.ts`,
  `src/lib/seo/jsonLd.ts`
- The anonymous landing page; Plausible conversion goals (`signed_up`,
  `first_title_added`, `onboarding_completed` by step); group/session invite-share
  loops.
  → `src/app/page.tsx`, `src/lib/analytics.ts`
- **Filer som saknade en ägande roll** (BIN-871). SEO-ytan, sidmetadata, sök och mätningen.
  → `src/app/sitemap.test.ts`, `src/hooks/usePageMeta.test.ts`, `src/hooks/usePageMeta.ts`, `src/hooks/useSearchBox.ts`, `src/hooks/useTitleLinkPrefetch.ts`, `src/lib/analytics.test.ts`, `src/lib/seo/contentFloor.test.ts`, `src/lib/seo/contentFloor.ts`, `src/lib/seo/contentFloorInput.test.ts`, `src/lib/seo/contentFloorInput.ts`, `src/lib/seo/franchiseCheapest.test.ts`, `src/lib/seo/franchiseCheapest.ts`, `src/lib/seo/genreHubs.test.ts`, `src/lib/seo/hubLinks.test.ts`, `src/lib/seo/hubLinks.ts`, `src/lib/seo/hubSeeds.test.ts`, `src/lib/seo/hubSeeds.ts`, `src/lib/seo/jsonLd.test.ts`, `src/lib/seo/selectionSeed.test.ts`, `src/lib/seo/withRetry.test.ts`, `src/lib/seo/withRetry.ts`, `src/lib/tmdb/selectionManifest.io.test.ts`, `src/lib/tmdb/selectionManifest.test.ts`, `src/lib/tmdb/seoCoverage.latinFilter.test.ts`, `src/lib/tmdb/seoCoverage.test.ts`, `src/lib/tmdb/selectionResolve.test.ts`


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
  → `docs/voice-and-tone.md`

## 17. Content Strategist / Copywriter

Owns every Swedish word.

- The 8 binding voice rules (du-form, imperative CTAs, U+2026 ellipsis, no
  emojis); the domain-vocabulary lock (one term per concept).
  → `docs/voice-and-tone.md`
- Status labels; the what/why/next empty-state pattern; error wording that never
  leaks tech internals; calendar headlines; legal prose; moderation/report copy.
  → `src/lib/watchStatus.ts`, `src/lib/calendar/copy.ts`, `src/app/{villkor,integritet,community-guidelines}/`
- **Filer som saknade en ägande roll** (BIN-871). Avsnittsetiketter och testerna för de texter du äger.
  → `src/lib/calendar/copy.test.ts`, `src/lib/episodeLabel.test.ts`, `src/lib/episodeLabel.ts`, `src/lib/watchStatus.test.ts`


## 18. Community Manager

**Builds and grows** the social fabric (Trust & Safety polices it).

- Friend/follow graph with mirrored docs; user search/discovery; groups +
  Tillsammans co-watching sessions; activity feed + follow-trending;
  reviews/comments/likes; three-tier visibility; **taste-match** compatibility
  scoring.
  → `src/lib/firebase/friends.ts`, `src/hooks/{useFollow,useReviewSocial,useTasteVector}.ts`, `src/app/feed/page.tsx`, `src/lib/taste/`
- Per-episode reaction threads (BIN-95) — UGC keyed per episode, double
  spoiler-gated: the thread stays shut until the viewer has marked that episode
  watched, and inside it a reaction its author flagged as a spoiler is blurred
  until clicked. Owned here rather than with the episode row it renders inside,
  because what is at stake is the social layer, not the progress model.
  → `src/components/tv/EpisodeReactions.tsx`, `src/components/tv/EpisodeReactions.test.tsx`
- **Filer som saknade en ägande roll** (BIN-871). Sociala ytor: flöde, vänner, grupper, sessioner och reaktioner.
  → `src/hooks/useEpisodeReactions.ts`, `src/hooks/useFollowList.helpers.test.ts`, `src/hooks/useFollowList.helpers.ts`, `src/hooks/useFollowList.ts`, `src/hooks/useFriends.ts`, `src/hooks/useFriendsWhoSaw.ts`, `src/hooks/useGroupHousehold.ts`, `src/hooks/useGroupMemberProgress.ts`, `src/hooks/useGroups.ts`, `src/hooks/useMySessions.ts`, `src/hooks/useNotifications.ts`, `src/hooks/useReviews.ts`, `src/hooks/useSenderProfile.ts`, `src/hooks/useSession.ts`, `src/hooks/useSessionTasteVectors.ts`, `src/hooks/useUserSearch.ts`, `src/lib/feedTrending.test.ts`, `src/lib/feedTrending.ts`, `src/lib/firebase/friends.test.ts`, `src/lib/groupInviteCache.test.ts`, `src/lib/groupInviteCache.ts`, `src/lib/groupInviteToken.test.ts`, `src/lib/groupInviteToken.ts`, `src/lib/groupProgress.test.ts`, `src/lib/groupProgress.ts`, `src/types/social.ts`


## 19. Customer Support / Success

Owns the human interface to the system.

- `hej@binge.nu` as the support / GDPR / abuse channel (footer + all 3 legal
  pages); auth error recovery with friendly Swedish messages; email-verification
  resend; the export/deletion flows users trigger; Letterboxd/IMDb CSV import;
  username conflict help; onboarding hand-holding.
  → `src/app/login/page.tsx`, `src/components/layout/EmailVerificationBanner.tsx`, `src/app/settings/import/page.tsx`, `src/components/settings/`, `src/components/layout/Footer.tsx`
- **Filer som saknade en ägande roll** (BIN-871). Återvändningsvägen efter inloggning och testerna för inloggnings- och importsidorna.
  → `src/app/login/page.test.tsx`, `src/app/settings/import/page.test.tsx`, `src/lib/nextPath.test.ts`, `src/lib/nextPath.ts`


## 20. Manual / Release QA Tester

Owns what automated tests can't reach (there is **no E2E suite**).

- Post-deploy smoke tests
  (RUNBOOK.md has no smoke-test checklist — §11 is "Kontakter + resurser"; the closest
  is §0 Quick triage); cross-browser/device + dark-mode validation; real
  Firebase auth/rules/FCM flow verification; SLO regression watching.
  → `docs/RUNBOOK.md`, `docs/SLO.md`

## 21. Technical Writer / Documentation

Owns the `docs/` corpus.

- Data-export-format spec + schema versioning; data-retention policy; the
  incident `RUNBOOK.md`; the moderation runbook; the
  `docs/analysis/EXTERNAL_ACTIONS.md` ops reference; `SLO.md`; `public/llms.txt`;
  the env-var reference; inline "why/gotcha" comment conventions.
  → `docs/data-export-format.md`, `docs/moderation.md`, `public/llms.txt`,
  `docs/data-retention-policy.md`, `docs/RUNBOOK.md`, `docs/analysis/EXTERNAL_ACTIONS.md`,
  `docs/SLO.md`

## 22. Data Analyst / BI

Owns measurement.

- The typed `AnalyticsEvent` taxonomy; the daily Firestore rollup feeding the
  admin `/insikter` dashboard; the metrics catalog with thresholds + explanations;
  Ask-Binge learning-loop telemetry (which filter combos strand users);
  onboarding-funnel dropoff; per-read cost tracking.
  → `functions/src/insights/`, `functions/src/askbinge/`, `src/app/insikter/metrics/catalog.ts`
- **Filer som saknade en ägande roll** (BIN-871). Insiktsmåtten, AskBinge-analysen och bingestatistiken.
  → `src/app/insikter/metrics/explanations.ts`, `src/app/insikter/metrics/resolvers.test.ts`, `src/app/insikter/metrics/resolvers.ts`, `src/app/insikter/metrics/types.ts`, `src/lib/askBinge/llmFallback.ts`, `src/lib/askBinge/rankResults.test.ts`, `src/lib/askBinge/rankResults.ts`, `src/lib/askBinge/record.ts`, `src/lib/askBinge/telemetry.test.ts`, `src/lib/askBinge/telemetry.ts`, `src/lib/askBinge/toDiscoverParams.test.ts`, `src/lib/askBinge/toDiscoverParams.ts`, `src/lib/askBinge/types.ts`, `src/lib/bingeStats.test.ts`, `src/lib/bingeStats.ts`


## 23. Vendor / Procurement Manager

Owns the third-party stack and its costs.

- ~10 vendors (TMDB, MOTN/RapidAPI, OMDb, Firebase, Cloudflare, Sentry, Plausible,
  reCAPTCHA, Gemini, Cineasterna), each with a per-service budget (MOTN ~450 of 500
  requests per MONTH on a billing-cycle anchor, shared with `leavingRollup` — BIN-541
  replaced the earlier "100/day" belief, which was never verified; OMDb 900/day under
  free 1000; Gemini 2000 global + 25/user);
  secret lifecycle via `defineSecret`; free-vs-paid tradeoffs (MOTN Pro $39/mo);
  substitution planning.
  → `functions/src/{streamingOffers,titleRatings,askbinge,leavingRollup}/`, `docs/analysis/EXTERNAL_ACTIONS.md`

## 24. Monetization / Partnerships Lead

Owns the nascent revenue surface.

- The Streamingrådgivaren savings angle (cost-per-title, dead-weight detection,
  savings ledger); the table-driven affiliate-link infra (built but empty,
  awaiting partner signup); the MOTN price-history asset; the **library-card
  free-streaming wedge** (Cineasterna/Viddla via `hemkommun`) as the defensible
  local moat.
  → `src/lib/advisor/serviceValue.ts`, `src/lib/tmdb/providers.ts`, `src/lib/streaming/cheapestPath.ts`, `src/hooks/useCineasternaCatalog.ts` (library-card wedge; phase-2 scope in Linear BIN-493)
- **Filer som saknade en ägande roll** (BIN-871). Abonnemangsekonomin: priser, utgifter, förnyelser och billigaste väg.
  → `src/hooks/useListCheapestPlan.ts`, `src/hooks/usePriceHistory.ts`, `src/hooks/useServiceValue.test.ts`, `src/hooks/useServiceValue.ts`, `src/hooks/useStreamingLeaving.ts`, `src/hooks/useStreamingOffers.test.ts`, `src/hooks/useStreamingOffers.ts`, `src/lib/renewal.test.ts`, `src/lib/renewal.ts`, `src/lib/spendSnapshot.test.ts`, `src/lib/spendSnapshot.ts`, `src/lib/streaming/cheapestPath.test.ts`, `src/lib/streaming/offers.test.ts`, `src/lib/streaming/offers.ts`, `src/lib/streaming/priceStats.test.ts`, `src/lib/streaming/priceStats.ts`, `src/lib/tmdb/providers.affiliate.test.ts`, `src/lib/tmdb/providers.identityGuard.test.ts`, `src/lib/tmdb/providers.test.ts`


## 25. Engineering Manager / Release Manager

Owns the process.

- The solo push-direct-to-main working agreement + the risky-migration
  written-plan exception; the **"plan before large changes — cast the role-org
  first" governance rule** (route → convene the stakeholder panel → fold conditions
  into acceptance criteria, for ad-hoc work as well as sprints); the deploy
  drift-guard (rules/functions never auto-ship); the quality gates that run on the
  push-to-main path;
  `deploy.yml` downgrades `npm audit` to advisory by BIN-344's decision; BIN-* issue
  taxonomy + sprint cadence; Dependabot grouping + framework upgrades (React 19 /
  Next 16 landed); the "explain in product terms" communication norm.
  → `CLAUDE.md` (working agreement + cast-the-panel rule), `.github/workflows/deploy.yml`, `.github/dependabot.yml`
- **The local commit hooks** (BIN-917). `lefthook.yml` is the only commit-TIME gate this repo
  has: deleting a command from it disarms a check for every commit made on every machine, and
  it reached zero blocking reviewers and zero owning roles until now. It is the same class as
  the reviewGates roster one bullet down — machinery that decides how the repo is reviewed —
  and it was found the hard way: BIN-917's first draft searched for `.husky` and a
  `precommit` script, found neither, and concluded no commit-time mechanism existed. It had
  been here since 2026-08-08.
  → `lefthook.yml`
- **The staged-routing gate** (BIN-1059). The commit-msg check that re-runs the blast-radius
  router on `git diff --cached --name-only` and refuses a commit whose panel no `review` row
  names. It exists because the panel is decided ONCE at selection and the file set then moves
  — a ticket is dropped, a critique widens the scope, a fix drags in a neighbour — and sprints
  have committed under a panel that no longer matched. It decides which critique a
  change owed, so it is this role's machinery in the most direct sense, and it is seated here
  rather than left on the #14 fallback for the same reason `lefthook.yml` is: the fallback is
  a seat of last resort for code nobody claimed, not an answer for a file that decides how
  everything else is reviewed.
  → `docs/org/metrics/check_staged_routing.mjs`, `docs/org/metrics/check_staged_routing.test.mjs`
- **The file that ARMS the review hooks** (BIN-990). `.claude/settings.json` is what registers
  the PostToolUse freshness stamper and the PreToolUse preview gate. Emptying its `hooks`
  block disarms both while
  every gated file stays byte-identical — the same "a gate that can be disarmed unwitnessed"
  shape this role already owns one file out, and until 2026-09-03 it reached no reviewer at
  all. Only the `hooks` KEY is gated, not the path: the file's other top-level key is
  `permissions`, and gating the whole path would bill a reviewer run on edits that never
  touch `hooks`. Malin's decision, against the recommendation.
  → `.claude/settings.json` (key `hooks` only)
- **The dependency manifest those upgrades land in** (BIN-919). `package.json` carries the
  framework pins, the npm scripts every gate and workflow invokes, and the test/lint
  wiring — so it decides how the repo builds and how it is checked. It was the one tracked
  path the router called code, did not route `skip`, and no commit gate stopped. Seated
  here rather than left on the permanent #14 fallback for the same reason as the router
  itself: the fallback is a seat of last resort for code nobody claimed, not an answer for
  a file that decides how everything else is verified. The lockfile is deliberately NOT
  owned here: it is machine-generated, and whether an owner belongs beside the manifest was
  left open when this bullet was written. BIN-934 settled the half that did not need this
  role's answer (2026-08-22): the router now calls the lockfile code and the commit gate
  stops it, so it reaches a reviewer without reaching an owner. Written without backticks on
  purpose — the generator harvests every backtick-quoted tracked path in a section, so
  merely NAMING the lockfile in a sentence that declines to own it would own it. It did,
  for one round: A2 went red with "package-lock.json (owned by #25, blocking gate: none)".
  Same trap this section's next bullet already documents for directories.
  → `package.json`
- **The commit-gate roster itself** — which reviewer agent blocks which staged path
  (`reviewGates`), and the decided-deviations ledger that tells a reviewer what it may
  NOT flag. Removing a pattern from either quietly disarms a gate, so the file that
  decides who reviews everything else needs an owner of its own (BIN-851). The strike rule
  joined this bullet in BIN-1084: the rule that a wrong sentence is DELETED rather than
  reworded, with its three carve-outs, lives in `.claude/rules/code-style.md`, and BIN-959
  made the commit gate POINT at that file. That moved the authority to a file no gate
  here stopped. lessons-digest.md is deliberately not
  owned.
  → `.claude/shared-plugin.json`, `.claude/rules/accepted-deviations.md`, `.claude/rules/code-style.md`
- **The reviewers' own instruction files and the hooks that stamp their state**
  (BIN-869). Editing what a reviewer is told to look for disarms a gate exactly as
  effectively as deleting its pattern, and until now both routed `skip` and matched
  no gate. The four `*-reviewer.md` files are in; their `*.knowledge*.md` siblings
  are deliberately NOT — the reviewers append to those on every ledger run, and
  gating them would put routine bookkeeping behind a review (the same call Malin
  made for `lessons-digest.md` in BIN-851).
  → `.claude/agents/binge-code-reviewer.md`, `.claude/agents/binge-security-reviewer.md`, `.claude/agents/binge-integration-reviewer.md`, `.claude/agents/binge-test-reviewer.md`, `.claude/hooks/freshness.mjs`, `.claude/hooks/freshness.test.mjs`, `.claude/hooks/preview-gate.mjs`, `.claude/hooks/preview-gate.test.mjs`
- **The remaining check scripts under scripts/** (BIN-1080). Same class as `lefthook.yml`
  and the staged-routing gate above: they decide how the repo is checked, and
  check-workflow-map.mjs gates the deploy. A script under scripts/ whose concern is a
  security control sits with #4 instead, and §4’s own bullets are where those are named;
  no list of them is kept here. File names in this bullet are written without backticks for
  the same reason the lockfile is: the generator harvests backtick-quoted tracked paths, so
  naming a file in a sentence that declines to own it would own it.
  → `scripts/check-workflow-map.mjs`, `scripts/check-workflow-map.test.mjs`, `scripts/check-knowledge-caps.mjs`, `scripts/check-knowledge-caps.test.mjs`, `scripts/prune-map-flag.mjs`, `scripts/prune-map-flag.test.mjs`

- **The risk router and the ownership map it reads** (BIN-834, BIN-869). `route.mjs`
  decides which roles a change is shown to; `gen-ownership-map.mjs` computes the map
  it decides from. Both are code by BIN-805's own ruling, and both routed as
  unowned — so the router permanently printed "add the path and regenerate the map"
  about itself, an instruction nobody was assigned to follow. Owned here rather than
  left to the permanent #14 fallback, because the fallback is a seat of last resort
  for code nobody claimed, not an answer for the two files that decide who reviews
  everything else.
  Owning these paths buys a REVIEWER, not a re-audit: `freshness.mjs`
  returns early for everything under the .claude and docs/org trees (de-backticked on
  purpose — a backticked DIRECTORY prefix is harvested too, and would have seated #25
  on both whole trees; measured, it added exactly those two patterns), so editing any of
  them will never flag this section stale (integration review, 2026-08-13 — verified at
  `.claude/hooks/freshness.mjs`'s two `startsWith` guards in `stampDossier`). That is deliberate:
  the hook must not self-trigger on the docs that define the system.
  → `docs/org/route.mjs`, `docs/org/route.test.mjs`, `docs/org/gen-ownership-map.mjs`

## 26. Information Architect

Owns wayfinding.

- The two-tier nav (7-item Subnav + 5-tab MobileTabBar); the URL scheme + catch-all
  dispatch; the 301 redirect map (`/my/following → /my/series`); the library
  section taxonomy mapping watch-status → routes; breadcrumb/`PageHeader` patterns;
  search/discovery filter hierarchy; genre cross-media mapping; noindex-by-default
  on private pages.
  → `src/components/layout/{Subnav,MobileTabBar}.tsx`, `src/components/pages/DynamicRouter.tsx`, `firebase.json` (redirects), `src/lib/libraryView.ts`
- Where a visitor ends up, and how she gets back. `AuthGuard` gates on `uid` rather
  than `user` (the profile loads in parallel with the auth verdict) and carries the
  return path; `WatchlistPage` is the screen the library taxonomy above renders into,
  mirroring its filters in the URL. Both are wayfinding, not the status model (#9) or
  the visual form (#1) — a change that moves a status between views is this seat's
  question; a change to how a card looks is not, and lives elsewhere.
  Seated here by Malin, 2026-08-27 (BIN-1030).
  → `src/components/AuthGuard.tsx`, `src/components/AuthGuard.test.tsx`,
  `src/components/WatchlistPage.tsx`, `src/components/WatchlistPage.test.tsx`
- The "Samma serie" strip — crawlable links between the separate TMDB entries of one
  split franchise (Doctor Who's eras). Deliberately navigation, not a merge, so it is
  wayfinding rather than part of the season/episode progress surface (#9).
  → `src/components/tv/RelatedSeriesStrip.tsx`
- What counts as a "seen date". `watchedAt` survives a status change (BIN-593), so the
  stored date and the current status answer different questions, and the library, the
  diary, the stats page and the public profile must agree on which one they are asking.
  This seat owns that distinction: `seenDate()` is the date accessor, and `markedSeen()`
  is the separate membership check used by the surfaces that count titles. Collapsing the
  two drops titles from user-visible counts — this role's binding condition on BIN-689,
  2026-08-25. The membership half was inline at three call sites until BIN-1008 gave it a
  file and a suite; its signature is typed on `status` alone, so the type rather than a
  comment is what stops the two being folded together.
  The three call sites got their own guards in BIN-1027, so a surface that swaps the
  membership check back for a date filter now reddens where the swap happens rather than
  only where the rule lives.
  → `src/lib/seenDate.ts`, `src/lib/markedSeen.ts`, `src/lib/markedSeen.test.ts`,
  `src/components/pages/UserProfilePageClient.test.tsx`

- **Filer som saknade en ägande roll** (BIN-871). Sidkompositionen, ruttparametrarna, appskalets layouter och felgränser, och bibliotekets vy.
  → `src/app/error.tsx`, `src/app/feed/error.tsx`, `src/app/feed/layout.tsx`, `src/app/global-error.test.tsx`, `src/app/global-error.tsx`, `src/app/layout.tsx`, `src/app/login/layout.tsx`, `src/app/not-found.tsx`, `src/app/selectionParams.test.ts`, `src/app/titleParams.watchdog.test.ts`, `src/components/pages/DiscoverPageClient.tsx`, `src/components/pages/ForsvinnerListClient.tsx`, `src/components/pages/FriendsPageClient.tsx`, `src/components/pages/GroupPageClient.tsx`, `src/components/pages/HomePageClient.test.tsx`, `src/components/pages/HomePageClient.tsx`, `src/components/pages/ListPageClient.tsx`, `src/components/pages/MediaTypePage.tsx`, `src/components/pages/MoviePageClient.test.tsx`, `src/components/pages/MoviePageClient.tsx`, `src/components/pages/PersonPageClient.test.tsx`, `src/components/pages/PersonPageClient.tsx`, `src/components/pages/ProviderPageClient.tsx`, `src/components/pages/SeasonPageClient.tsx`, `src/components/pages/TVShowPageClient.test.tsx`, `src/components/pages/TVShowPageClient.tsx`, `src/components/pages/TillsammansSessionPageClient.tsx`, `src/components/pages/UserProfilePageClient.tsx`, `src/components/pages/resolveRoute.test.ts`, `src/components/pages/resolveRoute.ts`, `src/hooks/useAllEpisodeProgress.ts`, `src/hooks/useEpisodeProgress.ts`, `src/hooks/useEpisodeProgressWithSync.helpers.test.ts`, `src/hooks/useEpisodeProgressWithSync.helpers.ts`, `src/hooks/useEpisodeProgressWithSync.test.tsx`, `src/hooks/useEpisodeProgressWithSync.ts`, `src/hooks/useLists.ts`, `src/hooks/useMarkSeen.helpers.test.ts`, `src/hooks/useMarkSeen.helpers.ts`, `src/hooks/useMarkSeen.test.tsx`, `src/hooks/useMarkSeen.ts`, `src/hooks/useNotInterested.ts`, `src/hooks/usePauseHistory.ts`, `src/hooks/useRecap.helpers.test.ts`, `src/hooks/useRecap.helpers.ts`, `src/hooks/useRecap.ts`, `src/hooks/useWatchlist.ts`, `src/lib/libraryView.test.ts`, `src/lib/seenDate.test.ts`

---

## 27. Database Administrator / Data-layer Engineer

Owns the Firestore layer **as schema** — distinct from the Data/Integrations
Engineer (#13, external pipelines) and the Software Architect (#14, schema
_philosophy_). Both sibling projects split this out, and it surfaced their sharpest
findings here too.

- **Indexes & query contracts** — the 8 composite indexes + collection-group field
  overrides; the failure mode where a feature ships a query whose index isn't
  deployed.
  → `firestore.indexes.json`
- **Field whitelist enforcement** — the `hasOnly()` field contract (22 allowlisted
  watchlist fields); a new field omitted from the whitelist silently `permission-denied`s
  client writes.
  → `firestore.rules`, `src/test/rules/firestore-rules.test.ts`
- **Lazy write-on-edit migration** — `migrateStatus()` normalizes legacy schemas at
  read-time; docs are rewritten only on user edit, never in bulk.
  → `src/lib/watchStatus.migration.ts`, `src/contexts/WatchlistContext.tsx`
- **Denormalization & dual-write discipline** — `effectiveVisibility`/`isPublic`
  mirrors; the community-rating per-title aggregate with transaction +
  `lastEventId` idempotency (BIN-148). Since BIN-727 (2026-08-15) that aggregate no
  longer uses `FieldValue.increment`: the transaction already reads the document to
  check `lastEventId`, so its optimistic concurrency covers what the sentinel used
  to, and the counts are now plain arithmetic on the value the transaction itself
  read. The orchestration sits behind an injected port (`runAggregate.ts`, importing
  no firebase-admin) whose `runTransaction` must stay a thin pass-through — a
  buffered shim would satisfy its type and silently drop the atomicity — so the
  emulator spec that forces a real write/write race belongs to this role too.
  → `functions/src/communityRatings/index.ts`,
  `functions/src/communityRatings/runAggregate.ts`,
  `src/test/rules/community-ratings-orchestrator.test.ts`,
  `src/hooks/usePublicProfile.ts`
- **Retention/TTL cleanup** — `retentionCleanup` (daily; the roster of sweeps lives in
  `runRetentionCleanup` — read it there rather than from a list here) and
  `reclaimOrphanFollows` (weekly orphan sweep, `GRACE_MS` race window). Since BIN-727
  the sweep's orchestration lives behind an injected port (`runCleanup.ts`, importing
  no firebase-admin) and is driven against a live Firestore emulator — so the
  emulator spec belongs to this role too, not to the rules-owning role that owns the
  other files in that directory.
  → `functions/src/{retentionCleanup,reclaimOrphanFollows}/`,
  `src/test/rules/retention-cleanup-orchestrator.test.ts`
- **Account-deletion cascade** — the 450-op chunked `writeBatch` over 25
  collections; inbound followers are deliberately left for the weekly orphan sweep.
  → `src/contexts/AuthContext.tsx`, `src/lib/firebase/userData.ts`
- **Doc-id contract & watchlist write payloads** — the `movie:123` / `tv:123` document
  id every watchlist, swipe and community-rating write is keyed on, and the helpers
  that build/repair those payloads. A silent change here collides or shadows real user
  data (BIN-569, BIN-608, BIN-624, BIN-766, BIN-965, BIN-1010, BIN-1011 — the last
  three are the add-vs-delete race in `WatchlistContext`'s `addIfMissing` branch,
  decided in `.claude/rules/accepted-deviations.md` rather than fixed with a
  compensating delete).
  → `src/lib/mediaTypeDocId.ts`, `src/lib/watchlistDocKey.ts`, `src/lib/watchlistDocKey.test.ts`, `src/lib/watchlist/**`, `src/contexts/WatchlistContext.tsx`
- **Disaster recovery** — PITR + scheduled backups (region `eur3`).

**Watch-items (diagnostic):**
- 🟡 `retentionCleanup` + `reclaimOrphanFollows` are **live** (see
  `docs/analysis/EXTERNAL_ACTIONS.md`), but absent from `deploy.yml` **by design** —
  it ships hosting only, so every functions change needs a manual targeted deploy.
  The real residual is that there is still **no health metric** for last-run /
  docs-deleted: a sweep that silently stops running raises no alert. Closest thing
  today is the per-run `retentionCleanup done` log line, which must be read by hand.
- 🔴 **PITR + scheduled backups are not yet enabled** (Blaze-gated); there is no
  scripted backup-health check, no restore dry-run, and no post-restore validation
  playbook. Pre-Blaze data loss is effectively irreversible.
- 🟠 **No `schemaVersion` stamp anywhere.** Indexes, the field whitelist, mutation
  payloads, and `buildUserExport` must be kept in sync by hand; nothing audits
  migration completeness or alerts when `migrateStatus()` hits its default case.
- 🟠 `effectiveVisibility` can go **stale** if a user changes `defaultVisibility`
  without touching any title; reads fall back, but nothing detects the divergence.
- 🟡 `collectUserDataSnapshots` reads 25 collections in parallel and **swallows
  errors without re-throwing** — a partial export/deletion could fail silently.
- **Filer som saknade en ägande roll** (BIN-871). Datalagret i klienten: firebase-modulerna, dokument-id, skrivvägarna och regeltesterna.
  → `src/contexts/AuthContext.test.tsx`, `src/contexts/WatchlistContext.test.tsx`, `src/hooks/usePublicProfile.test.ts`, `src/lib/firebase/accountDeletion.ts`, `src/lib/firebase/config.ts`, `src/lib/firebase/episodeProgress.test.ts`, `src/lib/firebase/episodeProgress.ts`, `src/lib/firebase/messaging.livetoken.test.ts`, `src/lib/firebase/messaging.ts`, `src/lib/firebase/publicProfile.test.ts`, `src/lib/firebase/publicProfile.ts`, `src/lib/firebase/reports.ts`, `src/lib/firebase/sessions.joinPayload.test.ts`, `src/lib/firebase/sessions.joinPayload.ts`, `src/lib/firebase/sessions.ts`, `src/lib/firebase/userData.subcollections.test.ts`, `src/lib/firebase/userSearch.test.ts`, `src/lib/firebase/userSearch.ts`, `src/lib/firebase/username.test.ts`, `src/lib/firebase/username.ts`, `src/lib/mediaTypeDocId.parity.test.ts`, `src/lib/mediaTypeDocId.test.ts`, `src/lib/watchlistWrites.addWrite.test.ts`, `src/lib/watchlistWrites.test.ts`, `src/lib/watchlistWrites.ts`, `src/test/rules/account-deletion.test.ts`, `src/test/rules/tmdb-sweep-orchestrator.test.ts`, `src/lib/watchStatus.migration.test.ts`


## 28. Recommendations / Scoring-Integrity Engineer

Owns the **correctness, weighting, thresholds, and drift** of Binge's algorithmic
surfaces — distinct from PM (#9, owns the _feature_) and Community Manager (#18,
owns the _social graph_). This is the Binge analog of the sibling projects'
"Data/ML scoring integrity" lens.

- **Recommendation cascade** — the per-row score ceilings (latest-fav `100−daysSince`,
  person `min(recurrence×15, 90)`, similar `min(rank×12, 80)`, free-public 55,
  trending 30) and tie-breaks.
  → `src/lib/recommendations/cascadePrioritizer.ts`
- **Seed classification** — strong (rating ≥4) / weak (3) seeds, the 30-day latest-5★
  window, recurrence thresholds (people 3, keywords 2).
  → `src/lib/recommendations/seedAnalysis.ts`
- **Taste vectors** — the two weight systems (`buildTasteVector` for the cascade vs
  `computeProfileStats` for the profile UI) and the calibration swipe bootstrap.
  → `src/lib/taste/{vector,stats,backfill}.ts`
- **Similar-pool flooring** — recs (vote floor 5) vs similar (floor 30), calibrated
  on one real title.
  → `src/lib/recommendations/rowComposition.ts`
- **Advisor logic** — rotation plan (greedy value-density), rotation calendar
  (pause prorating, dead-zone threshold), service-value attribution + dead-weight
  detection, the cheapest-path cascade, the 4-state primary-action tree,
  **campaign-aware effective-cost resolution** (`resolveEffectiveMonthlyCost(now)`
  with auto-revert at expiry, BIN-417) and the **min-cost list optimizer** (cheapest
  set-cover of a watchlist across services, BIN-416).
  → `src/lib/advisor/`, `src/lib/streaming/cheapestPath.ts`, `src/hooks/useSubscriptionAdvisor.ts`

**Watch-items (diagnostic):**
- 🔴 **Mismatched taste weights.** `vector.ts` penalizes `avbruten` (−0.5) and uses
  `rating×2`; `stats.ts` ignores dropped and uses `rating/1`. Both ship live (vector
  in the cascade, stats in the profile view) — the divergence is intentional but
  undocumented, and could show users conflicting taste signals.
- 🔴 **Zero production monitoring.** ~200 unit tests pin every threshold, but nothing
  observes real behaviour — no per-row engagement tracking, no drift/anomaly check
  on score distributions, no A/B framework. Correctness is frozen at launch values.
- 🟠 **Brittle for small libraries.** Recurrence thresholds (people 3, keywords 2)
  never fire on a 3-item library; if the 30-day 5★ window empties, the whole
  latest-fav anchor vanishes with no fallback.
- 🟠 **Calibration is hard-coded.** Vote floors were tuned on a single title;
  `catchup`=3 series and `lookAhead`=60d are global constants with no per-user tuning
  or feedback loop on whether users act on the advice.
- 🟡 **Dead-weight detection is one-way** — `serviceValue` flags an unused paid
  service but takes no action; and `cheapestPath`'s free-library verdict trusts a
  user-self-reported `loansLeft` with no library-API sync.

- **Filer som saknade en ägande roll** (BIN-871). Rekommendationsmotorn och de linser den väljer med.
  → `src/contexts/NotInterestedContext.tsx`, `src/hooks/useAdvisorTimeline.ts`, `src/hooks/useDiscoveryPremieres.ts`, `src/hooks/useRecommendationsCascade.ts`, `src/hooks/useSubscriptionAdvisor.helpers.test.ts`, `src/hooks/useSubscriptionAdvisor.test.ts`, `src/hooks/useUpcomingShowsForAdvisor.helpers.test.ts`, `src/hooks/useUpcomingShowsForAdvisor.helpers.ts`, `src/hooks/useUpcomingShowsForAdvisor.ts`, `src/lib/backlogResurface.test.ts`, `src/lib/backlogResurface.ts`, `src/lib/continueWatching.test.ts`, `src/lib/continueWatching.ts`, `src/lib/moodLens.test.ts`, `src/lib/moodLens.ts`, `src/lib/recommendations/cascadePrioritizer.test.ts`, `src/lib/recommendations/companionSeeds.cap.test.ts`, `src/lib/recommendations/companionSeeds.test.ts`, `src/lib/recommendations/companionSeeds.ts`, `src/lib/recommendations/rowComposition.test.ts`, `src/lib/recommendations/rowMediaFilter.test.ts`, `src/lib/recommendations/rowMediaFilter.ts`, `src/lib/recommendations/seedAnalysis.test.ts`, `src/lib/runtimeLens.test.ts`, `src/lib/runtimeLens.ts`, `src/lib/streaming/cheapestPath.test.ts`, `src/types/recommendations.assertNever.test.ts`, `src/types/recommendations.test.ts`, `src/types/recommendations.ts`, `src/hooks/useSubscriptionAdvisor.helpers.ts`

---

## Genuinely un-owned gaps

The diagnostic sweep's completeness critic looked for concerns with **no clear owner
in the file structure** — the equivalent of a write-only inbox or an empty backup
dir. Grounded findings, roughly by severity:

| Gap | What's missing | Touches |
|---|---|---|
| **Backup / DR verification** | PITR + backups are documented as setup steps, but nothing confirms a backup landed, alerts on schedule failure, or tests restore. DR is runbook-only and untested. | DevOps (#8), Security (#4), DPO (#6), DBA (#27) |
| **No health metric for the retention sweeps** | `retentionCleanup` + `reclaimOrphanFollows` are deployed and running, but absent from `deploy.yml` by design (hosting-only) — so each functions change needs a manual targeted deploy, and nothing alerts if a sweep stops running or starts failing. The `retentionCleanup done` log line must be read by hand. | DevOps (#8), DPO (#6), Controller (#3), DBA (#27) |
| **Schema-version safety** | No `schemaVersion` on Firestore docs — lazy migration can't prove completeness, and a stale legacy value can persist indefinitely undetected. | Architect (#14), QA (#7), DBA (#27) |
| **Recommendation/taste drift** | Cascade + taste weights are frozen constants; no engagement tracking, A/B test, or drift detector validates them post-launch. | Data Analyst (#22), Architect (#14), Scoring (#28) |
| **Notification delivery** | At-most-once is enforced, but there's no per-user delivery record, no user-facing "did you get this?", and no admin delivery-rate SLO. | DevOps (#8), Trust & Safety (#12), PM (#9) |
| **Moderation follow-through** | Marking a report `actioned` is a status flag only — no Cloud Function deletes the content, no audit trail confirms the action happened. | Trust & Safety (#12), Eng Manager (#25) |
| **Ask-Binge LLM fallback ops** | Gemini budget (2000/day + 25/user) is documented but **not enforced in code**; no success SLO, no tested graceful-degradation path when Gemini is down. | DevOps (#8), Vendor Mgr (#23), QA (#7) |
| **Affiliate infra unverified** | The `AFFILIATE_PROGRAMS` table is intentionally empty and a no-op; nothing alerts if it's wrongly empty or tracks link clicks. "Built but dark." | Monetization (#24), Vendor Mgr (#23), DevOps (#8) |
| **GDPR export drift** | `collectUserDataSnapshots` adding a collection without updating `buildUserExport` would silently omit user data; `SCHEMA_VERSION` is a hand-bumped literal. | DPO (#6), DBA (#27), QA (#7) |
| **Follow-graph symmetry** | The `following ↔ followers` mirror is rules-enforced but never audited for asymmetric state; the orphan sweep has no completeness check. | DevOps (#8), DPO (#6), DBA (#27) |

Most of these share a shape: **a policy or contract exists in docs/UI, but the
machinery that enforces or verifies it is missing or undeployed.** None are
launch-blockers on their own; together they're the natural backlog for a
"close the verification gaps" sprint.

---

## Roles that deliberately overlap

Three pairs share a surface but split by **intent** — worth keeping distinct:

- **Testing splits in two.** The _QA / Test Engineer_ (#7) owns automated Vitest +
  rules-tests + guard tests. The _Manual / Release QA Tester_ (#20) owns
  exploratory and device testing. The gap is real because there
  is no Playwright/Cypress E2E suite.
- **Social moderation splits in two.** _Trust & Safety_ (#12) **polices** UGC
  (reports, bans, escalation). The _Community Manager_ (#18) **builds and grows**
  the social layer. Same surface, opposite intent.
- **Brand sits above design.** The _Creative Director_ (#16) owns brand, naming,
  and positioning; the _Product Designer_ (#1) owns the component-level design
  system that expresses it.
- **The TV episode directory splits three ways — on purpose** (BIN-878). Everything
  under `src/components/tv/` renders inside the same season list, but the reviewer it
  needs depends on what changed: the progress surface and its group spoiler mask are
  the _Product Manager_'s (#9), the per-episode reaction thread is the _Community
  Manager_'s (#18) because it is UGC with its own spoiler gate, and the franchise
  strip is the _Information Architect_'s (#26) because it is a link, not a feature.
  Do not collapse these into one directory-wide owner: a single collection-owner is
  how a social-layer change reaches a reviewer who does not think about spoilers.

Other natural adjacencies: Controller (#3) ↔ Vendor Manager (#23) ↔ Monetization
(#24) all touch the 25 SEK/mån cap from different angles (cut cost / manage
suppliers / earn revenue); Legal (#5) ↔ DPO (#6) ↔ Trust & Safety (#12) all touch
user data and policy; DevOps (#8) ↔ Eng Manager (#25) ↔ Manual QA (#20) all touch
the release pipeline.

The diagnostic sweep surfaced a few more co-owned surfaces, each split by intent:

| Concern | Contending roles | Split by |
|---|---|---|
| Notification settings | Customer Support (#19) / Trust & Safety (#12) | the UI + defaults vs server-side gating & moderation suppression |
| Taste weighting & calibration | Architect (#14) / PM (#9) / Data Analyst (#22) | the schema vs what counts as taste vs post-launch validation (the last is the gap) |
| `providers.ts` | Localization (#11) / Monetization (#24) | the canonical Swedish catalog vs affiliate wrapping & economics |
| Firestore cost & quota | Controller (#3) / Vendor Mgr (#23) / DevOps (#8) | the cap + alerts vs per-service budgets vs enforcement (rate limits, indexes) |

---

## A role that has since landed: Agent-Ops

Both sibling projects make a **Claude AI-Harness Owner / Agent-Ops Lead** their
flagship role — a commit-gate, a fleet of reviewer agents, and an append-only
knowledge contract that govern how Claude ships code. As of the 2026-06→07 build-out,
**Binge now has this machinery too** (the original sweep, 2026-06-26, correctly found
it absent — this section is the refresh):

- **Commit-gate reviewer agents** — `binge-code-reviewer`, `binge-security-reviewer`,
  `binge-test-reviewer` and `binge-integration-reviewer` (which owns both the whole-diff
  gate and the push gate) run before any commit. They no longer stamp freshness markers:
  since 2026-08-01 proof of review is the RECORDED ledger (`reviewProof: "ledger"` in
  `.claude/shared-plugin.json`) — a hook logs which reviewer read which bytes and the
  verdict it ended on, and writing a marker or the ledger by hand is refused.
- **Hooks** — `freshness` (dossier + workflow-map staleness), `exit-plan-suggest-review` (high-stakes plan →
  suggest a stakeholder panel), `require-review-before-commit`, workflow-map + lessons
  guards.
- **A committed role-org layer** under `docs/org/`: this role map, the world-watch
  external-knowledge system (`docs/org/world-watch/`, per-role sources + `state.json`),
  the ADR corpus (`docs/org/adr/`), and the measurement layer
  (`docs/org/metrics/events.jsonl` scored by `/org-retro`).
- **A knowledge contract** — `tasks/lessons.md` + its auto-loaded digest
  (`.claude/rules/lessons-digest.md`).

The harness IS committed, and deliberately so: the reviewer agents, their knowledge
files, every `.claude/rules/*.md`, the hooks and `.claude/shared-plugin.json` are all
tracked — an unversioned gate is one machine loss away from being gone. Only per-run
state is ignored (`.claude/state/`, `worktrees/`, `cache/`, `hooks/sessions/`,
`hooks/__pycache__/`, `linear-tracker.json`, `scheduled_tasks.lock`, `*.doctor-backup`).
This matters since BIN-803: a pattern only survives into `docs/org/ownership-map.json`
if git tracks its path, so "the harness is gitignored" would be an instruction to drop
these files from the map. The durable artifacts (role map, world-watch state, ADRs,
metrics) are committed too. Governance is shared between the **Engineering Manager (#25)** (working
agreement, CI gates, deploy drift-guard) and this Agent-Ops layer (the pre-build
stakeholder panel + the commit-gate reviewers). If Binge ever formalizes a 27th-style
"executable role," this is the machinery it would own.
