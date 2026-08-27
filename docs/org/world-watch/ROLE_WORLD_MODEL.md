# Role world-model — the world-watch layer

_Companion to [`docs/role-responsibilities.md`](../../role-responsibilities.md). That
map answers "who would own this?"; this doc answers "what does each owner have to
watch in the outside world to keep their part of Binge at the frontier?"_

Staying current is treated here as a **production-grade quality requirement**, not
housekeeping: a role that falls behind the frontier (an un-patched CVE, a missed
EAA deadline, a TMDB term that now bans AI use of its data) makes the whole app
fall behind or out of compliance. So every role gets a **World-watch block**.

> Built 2026-06-26 from a six-cluster research sweep. Every source URL was fetched
> live to confirm it resolves and is on-topic; dead/redirected/bot-blocked ones are
> flagged honestly below and substituted. Line numbers are omitted (they drift);
> paths and URLs are the source of truth.

---

## How to read a World-watch block

Each role carries six fields:

- **world_facing** — does this role need outside knowledge at all? (Default `true`;
  in practice all 28 are world-facing in ≥1 mode.)
- **watch_modes** — `compliance` (law/policy/ToS you must obey), `trend` (market /
  practice drift you should track), `tooling-frontier` (your stack's own releases).
- **stakes** — `high` (falling behind breaks or exposes the app), `medium`, `low`.
- **cadence** — **volatility-matched**, not uniform. `weekly` for fast movers (CVEs,
  framework & Claude Code releases, the live Swedish streaming market); `monthly`
  for law, pricing, most tooling; `quarterly` for slow drift (design/IA/docs).
- **authority** — how a confirmed change is allowed to act:
  `flag-only` (→ digest, soft signals), `auto-ticket` (→ issue tracker, hard-deadline
  / ship-breaking), `escalate-human` (→ ask the owner; **all legal/privacy is here**,
  because it's interpretive).
- **watch_signals** — the concrete change types that matter to this role.
- **sources** — 3–7 verified, authoritative, preferably machine-pollable links.

The constitution that governs how these fire (deliberation, the path→role router,
the cost model) lives in [`DESIGN.md`](./DESIGN.md).

---

## Master table — the world-watch axis, folded into the map

This is the fold: every role in the responsibility map now also carries a watch
posture at a glance. The three **MVP** roles (built out in `state.json` + the
`/world-watch` skill) are marked ◆.

| # | Role | world_facing | modes | stakes | cadence | authority |
|---|---|---|---|---|---|---|
| 1 | Product Designer / UX | yes | trend, tooling | medium | monthly | flag-only |
| 2 | Accessibility Specialist | yes | compliance, trend | **high** | quarterly (monthly for enforcement) | auto-ticket |
| 3 | Financial Controller | yes | tooling, trend | **high** | monthly | auto-ticket |
| ◆4 | Security Architect | yes | compliance, trend, tooling | **high** | **weekly** | auto-ticket |
| ◆5 | Legal / GDPR Counsel | yes | compliance, trend | **high** | monthly | escalate-human |
| ◆6 | Data Protection Officer | yes | compliance, trend | **high** | monthly | escalate-human |
| 7 | QA / Test Engineer | yes | tooling, compliance | medium | monthly | auto-ticket |
| 8 | DevOps / SRE | yes | tooling, compliance, trend | **high** | **weekly** | auto-ticket |
| 9 | Product Manager | yes | trend | **high** | **weekly** | flag-only |
| 10 | Performance Engineer | yes | tooling, trend, compliance | **high** | **weekly** | auto-ticket |
| 11 | Localization / i18n | yes | compliance, trend | **high** | **weekly** | auto-ticket / flag-only |
| 12 | Trust & Safety | yes | compliance, trend | **high** | monthly (weekly in CSA-trilogue) | escalate-human |
| 13 | Data / Integrations Eng | yes | compliance, trend, tooling | **high** | **weekly** | auto-ticket |
| 14 | Software Architect | yes | tooling, compliance | **high** | **weekly** | auto-ticket |
| 15 | Growth Marketer | yes | compliance, trend, tooling | **high** | **weekly** | auto-ticket |
| 16 | Creative Director / Brand | yes | tooling, trend | medium | quarterly | flag-only |
| 17 | Content Strategist | yes | compliance, trend | low-med | quarterly | flag-only |
| 18 | Community Manager | yes | trend, tooling | low-med | quarterly | flag-only |
| 19 | Customer Support | yes | compliance, tooling | medium | monthly | auto-ticket / escalate |
| 20 | Manual / Release QA | yes | tooling, trend | medium | monthly | flag-only |
| 21 | Technical Writer | yes | trend | low | quarterly | flag-only |
| 22 | Data Analyst / BI | yes | trend, compliance, tooling | medium | monthly | flag-only |
| 23 | Vendor / Procurement | yes | compliance, trend | **high** | monthly | escalate-human |
| 24 | Monetization / Partnerships | yes | compliance, trend, tooling | **high** | monthly | escalate-human / flag-only |
| 25 | Engineering / Release Mgr | yes | tooling, trend | medium | **weekly** | escalate-human |
| 26 | Information Architect | yes | trend, tooling | medium | quarterly | flag-only |
| 27 | DBA / Data-layer | yes | compliance, tooling, trend | **high** | monthly | auto-ticket / escalate |
| 28 | Recommendations / Scoring | yes | trend, tooling, compliance | medium | monthly | flag-only |

---

# Tier 1 — core build roles

## 1. Product Designer / UX
**trend, tooling-frontier · medium · monthly · flag-only**

Signals: Tailwind v4.x releases touching the `@theme` token layer; CSS features
reaching Baseline that the design system leans on (OKLCH, `color-mix()`, `:has()`,
container queries, anchor positioning, `contrast-color()`); Lucide icon
releases (additions, the v1.0 brand-icon removal, a11y default changes); web-design
trend drift that could date the dense "Schemat" direction.

| Source | URL | status |
|---|---|---|
| Tailwind CSS blog | https://tailwindcss.com/blog | live (JS-rendered list) |
| web.dev Baseline | https://web.dev/baseline | live |
| New to the web platform (monthly) | https://web.dev/blog | live |
| Lucide releases | https://github.com/lucide-icons/lucide/releases | live (append `.atom`) |
| MDN Baseline glossary | https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility | live |

## 2. Accessibility Specialist
**compliance, trend · high · quarterly (monthly for enforcement) · auto-ticket**

EAA / tillgänglighetsdirektivet has been in force since 2025-06-28, supervised by
DIGG — a conformance gap is ship-breaking, hence auto-ticket. Nuance: pure
standards drift (WCAG 3.0 draft, EN 301 549 not yet final) is flag-only; ambiguous
new DIGG interpretation is escalate-human.

Signals: new WCAG version/criteria (3.0 draft→candidate); EN 301 549 v4.x
publication (expected 2026, pulls in WCAG 2.2 AA); EAA scope/deadline/enforcement
changes; DIGG guidance + tillsyn signals; accessibility-statement requirements.

| Source | URL | status |
|---|---|---|
| W3C WAI news (Atom) | https://www.w3.org/WAI/news/ | live |
| WCAG 2 overview | https://www.w3.org/WAI/standards-guidelines/wcag/ | live |
| WCAG 3 intro | https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/ | live |
| DIGG — Webbriktlinjer | https://www.digg.se/webbriktlinjer | live |
| DIGG — EN 301 549 & WCAG | https://www.digg.se/webbriktlinjer/lagar-och-krav/det-har-ar-en-301-549-och-wcag | live |
| EC — European Accessibility Act | https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en | live (old URL 301s here) |

> ETSI's own EN 301 549 pages 403 automated fetches — tracked via the DIGG mapping page instead.

## 3. Financial Controller
**tooling-frontier, trend · high · monthly · auto-ticket**

Owns the 25 SEK/mån Blaze cap. A pricing/quota change to a metered dependency hits
the cap directly, so auto-ticket. Largely shares sources with the DBA (#27, Firestore
pricing) and Vendor Manager (#23, the rest of the stack).

Signals: Firestore read/write/storage unit-pricing & free-tier changes; Cloud
Functions / FCM pricing; TMDB build-fetch budget assumptions; Cloudflare free-plan
movement; any vendor free-tier removal that converts a $0 line into a billed one.

| Source | URL | status |
|---|---|---|
| Firestore billing model | https://firebase.google.com/docs/firestore/pricing | live |
| Firebase release notes hub | https://firebase.google.com/support/releases | live |
| Google Cloud pricing changes (Firestore notes) | https://docs.cloud.google.com/firestore/docs/release-notes | live |
| Cloudflare changelog | https://developers.cloudflare.com/changelog/ | live |

## ◆4. Security Architect  — MVP
**compliance, trend, tooling-frontier · high · weekly · auto-ticket**

The ~787-line `firestore.rules` is the real boundary; CVEs in shipped deps are
time-bound and security-critical → auto-ticket. (reCAPTCHA/CSP interpretive drift
can escalate-human, but the role default is auto-ticket.)

Signals: new CVE/GHSA in Next.js, React, Firebase JS SDK, firebase-functions, or
any lockfile dependency (esp. RSC/Server-Action RCE, middleware/proxy bypass, SSRF,
cache-poisoning that hits App Router); coordinated Next.js security releases (the
May-2026 13-advisory batch is the template — forces a version bump + secret
rotation); Firestore Security Rules language changes affecting what `hasOnly`/the
ruleset can express; reCAPTCHA Enterprise / App Check changes; Dependabot
alert/grouping changes.

| Source | URL | status |
|---|---|---|
| Next.js security advisories | https://github.com/vercel/next.js/security/advisories | live |
| GitHub Advisory DB (npm) | https://github.com/advisories?query=ecosystem%3Anpm | live |
| Firebase JS SDK releases (Atom) | https://github.com/firebase/firebase-js-sdk/releases.atom | live |
| Firebase Security Rules release notes | https://firebase.google.com/support/release-notes/security-rules | live |
| reCAPTCHA Enterprise release notes | https://docs.cloud.google.com/recaptcha/docs/release-notes | live (301 from cloud.google.com) |
| GitHub changelog — Dependabot (RSS) | https://github.blog/changelog/label/dependabot/feed/ | live |

> Classic reCAPTCHA changelog (`developers.google.com/recaptcha/docs/changelog`) is live but deprecated (last real entry 2019) — dropped in favor of the Enterprise notes.

## ◆5. Legal / GDPR Counsel  — MVP
**compliance, trend · high · monthly (weekly in active legislative windows) · escalate-human**

All legal change is interpretive → escalate-human, every time. Never assert law
without a link.

Signals: EDPB guidelines on data-subject rights / erasure (Art.17) / portability
(Art.20) — Binge ships export + erasure that must track shape changes; ePrivacy /
cookie & analytics rulings (cookie-free Plausible / Swedish LEK); EU AI Act
milestones, GPAI/transparency duties, AI-generated-content labelling (hits the
Gemini "Ask Binge" feature); DSA scope reaching smaller UGC platforms; IMY
enforcement + age-gate interpretation; TMDB/JustWatch attribution ToS changes; any
of these forcing a Terms/Privacy re-version + re-acceptance.

| Source | URL | status |
|---|---|---|
| EDPB news | https://www.edpb.europa.eu/news/news_en | live |
| IMY — Nyheter | https://www.imy.se/nyheter/ | live (RSS at /nyheter/rss) |
| EC — AI Act framework | https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai | live |
| EC — DSA enforcement | https://digital-strategy.ec.europa.eu/en/policies/dsa-enforcement | live |
| EC — news (filterable) | https://commission.europa.eu/news_en | live |
| AI Act resource (FLI, secondary) | https://artificialintelligenceact.eu/ | live |

## ◆6. Data Protection Officer  — MVP
**compliance, trend · high · monthly (sub-processors more often) · escalate-human**

Owns the personal-data inventory across 24+ subcollections. Interpretive → escalate.
Sub-processor lists carry ~30-day objection windows, so they're the time-sensitive
piece.

Signals: IMY enforcement against consumer web/media apps (tracking pixels, push
tokens, consent, US-processor transfers — the Apoteket/Meta-Pixel line is directly
analogous); EDPB guideline changes (anonymisation, children's data, DPIA);
adequacy/transfer shifts (EU-US Data Privacy Framework status, SCC changes);
sub-processor additions on Firebase/Google Cloud or Sentry (→ 30-day window +
inventory update); processor DPA version bumps.

| Source | URL | status |
|---|---|---|
| IMY — Nyheter (RSS) | https://www.imy.se/nyheter/rss | live |
| EDPB news | https://www.edpb.europa.eu/news/news_en | live |
| EC — EU-US data transfers / DPF | https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-transfers_en | live |
| Sentry subprocessors (RSS) | https://sentry.io/legal_subprocessors_rss.xml | live |
| Firebase subprocessors | https://firebase.google.com/terms/subprocessors/ | live (⚠ edge-cached stale date — cross-check GCP list) |
| Google Cloud subprocessors | https://cloud.google.com/terms/subprocessors | live |

## 7. QA / Test Engineer (automated)
**tooling-frontier, compliance · medium · monthly · auto-ticket**

A breaking major in a test tool silently rots the suite → auto-ticket; cadence is
monthly because test-tool churn is slower than the runtime stack.

Signals: Vitest releases & breaking changes (config-lookup change, reporter/default
moves, Node/Vite floor bumps; **Vitest 5 in beta** = migration event); Testing
Library peer-dep/React-19 changes; MSW major versions (v2 Fetch-rewrite; any v3);
jsdom Node-floor + CSSOM `getComputedStyle` overhaul; `@firebase/rules-unit-testing`
+ emulator changes affecting the rules test suite.

| Source | URL | status |
|---|---|---|
| Vitest releases | https://github.com/vitest-dev/vitest/releases | live (append `.atom`) |
| Vitest blog | https://vitest.dev/blog/ | live |
| React Testing Library releases | https://github.com/testing-library/react-testing-library/releases | live |
| MSW releases | https://github.com/mswjs/msw/releases | live |
| jsdom releases | https://github.com/jsdom/jsdom/releases | live |
| Firebase rules unit-tests docs | https://firebase.google.com/docs/rules/unit-tests | live |

## 8. DevOps / SRE
**tooling-frontier, compliance, trend · high · weekly · auto-ticket**

Runner-image deprecations and Node EOL are hard-deadline → auto-ticket. Status-page
incidents are flag-only by nature, but the role's tooling drift is auto-ticket.

Signals: GitHub Actions runner-image deprecations / label flips that break
the workflows under `.github/workflows/`; Actions breaking changes (`checkout` v7 pwn-request
blocking, runner min-versions, action Node runtime bumps); Node.js LTS/EOL
transitions (functions runtime + build `--max-old-space-size`); Firebase CLI changes
(hosting deploy, emulator, region defaults); Cloudflare incidents; Sentry SDK
breaking config; Firebase platform incidents.

| Source | URL | status |
|---|---|---|
| actions/runner-images releases (Atom) | https://github.com/actions/runner-images/releases.atom | live |
| GitHub changelog — Actions (RSS) | https://github.blog/changelog/label/actions/feed/ | live |
| Node.js releases / EOL | https://nodejs.org/en/about/previous-releases | live |
| Firebase CLI release notes | https://firebase.google.com/support/release-notes/cli | live |
| Cloudflare status (Atom) | https://www.cloudflarestatus.com/history.atom | live |
| Firebase status (JSON) | https://status.firebase.google.com/incidents.json | live |
| Sentry JS SDK releases (Atom) | https://github.com/getsentry/sentry-javascript/releases.atom | live |

> `status.firebase.google.com/history.rss` 404s — use `incidents.json` instead.

## 9. Product Manager
**trend · high · weekly · flag-only**

Market intelligence, not compliance → flag-only, but **weekly**: the Swedish
streaming market is moving fast right now (TV4 left terrestrial Jan 2026; Schibsted
bought TV4 Media; Prime Video launched ads in SE). Each shift reshapes the
availability killer-feature and the advisor's value.

Signals: SE/Nordic market shifts (price hikes, ad-tier launches, password-sharing
crackdowns, launches/shutdowns/mergers); competitor feature moves (JustWatch,
Letterboxd, Trakt, Reelgood); Nordic consumer streaming-behavior trends.

| Source | URL | status |
|---|---|---|
| Mediavision posts (EN) | https://posts.mediavision.se/en/ | live |
| Nordisk Film & TV Fond news | https://nordiskfilmogtvfond.com/news | live |
| JustWatch global press | https://www.justwatch.com/us/global-press | live |
| Letterboxd journal | https://letterboxd.com/journal/ | exists, 403 to bots (needs browser/RSS) |
| TV4 presstjänst | https://press.tv4.se/ | live |
| Mediemyndigheten (annual market report) | https://mediemyndigheten.se/ | live |

## 10. Performance Engineer
**tooling-frontier, trend, compliance · high · weekly · auto-ticket**

CWV thresholds are a ranking signal and a TanStack Query major is a migration event
→ auto-ticket.

Signals: TanStack Query (React Query v5→**v6 beta**) releases — `staleTime`/cache
behavior, `useQuery`/`useQueries`/persist API, `shouldPersistQuery`, `ctx.signal`
propagation; Core Web Vitals metric changes (esp. INP, and the 2026 CrUX
**soft-navigation/SPA** support change — directly relevant to a static-export SPA);
`web-vitals` library breaking changes; Next.js static-export bundling/prefetch
changes (16.3 Instant Navigations / Partial Prefetching, Turbopack default).

| Source | URL | status |
|---|---|---|
| TanStack Query releases | https://github.com/tanstack/query/releases | live (append `.atom`) |
| react-query CHANGELOG | https://github.com/TanStack/query/blob/main/packages/react-query/CHANGELOG.md | live |
| web-vitals CHANGELOG | https://github.com/GoogleChrome/web-vitals/blob/main/CHANGELOG.md | live |
| web.dev — Web Vitals hub | https://web.dev/articles/vitals | live |
| CrUX release notes | https://developer.chrome.com/docs/crux/release-notes | live |
| Next.js blog | https://nextjs.org/blog | live |

## 11. Localization / i18n
**compliance, trend · high · weekly · auto-ticket (catalog breakage) / flag-only (locale drift)**

Owns everything Swedish. Provider-id breakage double-lists or drops a service →
auto-ticket; locale-convention drift is flag-only.

Signals: new/renamed/merged SE providers (SkyShowtime-style launches, Max↔HBO Max
flips, TV4 Play changes) → `SWEDISH_PROVIDERS` + `canonicalProviderId()` updates;
TMDB/JustWatch provider-id changes / new aliases for `watch_region=SE`; municipality
changes (the 290-kommun list under the library-card wedge); SE `release_dates` type-4
extraction conventions; locale (date/plural/label) conventions.

| Source | URL | status |
|---|---|---|
| TMDB watch-providers reference | https://developer.themoviedb.org/reference/movie-watch-providers | live |
| TMDB tracking content changes | https://developer.themoviedb.org/docs/tracking-content-changes | live |
| SCB — Län och kommuner | https://www.scb.se/hitta-statistik/regional-statistik-och-kartor/regionala-indelningar/lan-och-kommuner/ | live |
| SkyShowtime newsroom | https://corporate.skyshowtime.com/ | live (use root; /press-releases/ 404s) |
| TV4 presstjänst | https://press.tv4.se/ | live |
| JustWatch global press | https://www.justwatch.com/us/global-press | live |

> TMDB's `developer.themoviedb.org/changelog` is unreliable to fetch (JS-rendered; returned 404 in one pass) — don't rely on it as a poll target; use the tracking-changes + reference docs.

## 12. Trust & Safety / Content Moderation
**compliance, trend · high · monthly (weekly during CSA trilogue) · escalate-human**

CSAM-reporting + DSA notice-and-action carry legal duties → escalate-human. A new
trusted-flagger guideline can auto-ticket.

Signals: DSA obligations reaching small/non-VLOP hosts (notice-and-action,
transparency, trusted-flagger, statement-of-reasons, minor protection); DSA
enforcement precedents; the EU CSA Regulation ("chat control") moving
trilogue→adopted + interim-derogation lapse (3 Apr 2026); EU Centre on CSA standing
up; NCMEC CyberTipline reporting-API/schema changes; Swedish content-law
(Mediemyndigheten) changes.

| Source | URL | status |
|---|---|---|
| EC — Digital Services Act | https://digital-strategy.ec.europa.eu/en/policies/digital-services-act | live |
| EP legislative train — CSA Regulation | https://www.europarl.europa.eu/legislative-train/theme-a-new-era-for-european-defence-and-security/file-combating-child-sexual-abuse-online | live |
| NCMEC CyberTipline | https://www.missingkids.org/gethelpnow/cybertipline | live |
| NCMEC CyberTipline API docs | https://report.cybertip.org/ispws/documentation | live |
| Mediemyndigheten (EN) | https://mediemyndigheten.se/english/ | live |

> Council of the EU CSA page 403s automated fetches — substituted the EP legislative-train tracker for the same file.

## 13. Data / Integrations Engineer
**compliance, trend, tooling-frontier · high · weekly · auto-ticket**

External pipelines. API-breaking changes break collectors → auto-ticket. **Compliance
flag carried up to all data roles:** TMDB's API terms now prohibit using TMDB content
"in connection with… an ML or AI based Application" and cap caching at 6 months —
load-bearing for the Gemini "Ask Binge" feature.

Signals: TMDB v3 endpoint deprecations/renames, new `append_to_response` keys,
`watch/providers` shape changes; JustWatch-sourced provider shifts surfacing through
TMDB; FCM v1-API / service-account changes (legacy HTTP/XMPP already sunset
2024-06-20); MOTN / Streaming-Availability breaking changes + free-tier 100/day
enforcement (Binge runs 95/day); OMDb response/key changes; Functions SDK breaking
releases (v7 dropped `functions.config()`).

| Source | URL | status |
|---|---|---|
| TMDB tracking content changes | https://developer.themoviedb.org/docs/tracking-content-changes | live |
| Firebase release notes (FCM + Functions) | https://firebase.google.com/support/releases | live |
| FCM docs (HTTP v1) | https://firebase.google.com/docs/cloud-messaging | live |
| MOTN — changes endpoint | https://docs.movieofthenight.com/resource/changes | live |
| MOTN — OpenAPI spec repo | https://github.com/movieofthenight/streaming-availability-api | live (releases tab empty; watch openapi.yaml) |
| OMDb (inline change log) | http://www.omdbapi.com/ | live |

## 14. Software Architect
**tooling-frontier, compliance · high · weekly · auto-ticket**

`output: 'export'` is the load-bearing constraint for the whole architecture →
auto-ticket on anything that would break a fully-static export, and RSC CVEs must be
triaged for blast radius even on a client-rendered app.

Signals: Next.js releases affecting static export, App Router,
catch-all/`generateStaticParams`, caching-model flips (Cache Components,
`"use cache"`), Turbopack default, any deprecation that would force SSR; RSC/Server
Component security advisories; React 19.x direction + patch versions + React Compiler;
TypeScript 6.0 deprecations and the **TS 7.0 Go-native compiler** (CI typecheck
migration).

| Source | URL | status |
|---|---|---|
| Next.js blog | https://nextjs.org/blog | live |
| Next.js releases | https://github.com/vercel/next.js/releases | live (append `.atom`) |
| React blog | https://react.dev/blog | live |
| React versions | https://react.dev/versions | live |
| TypeScript dev blog | https://devblogs.microsoft.com/typescript/ | live |

---

# Tier 2 — go-to-market, brand, and operations roles

## 15. Growth Marketer
**compliance, trend, tooling-frontier · high · weekly · auto-ticket**

~25k pre-rendered title pages depend on being indexed & ranked → ranking/indexing
breakage auto-tickets. **Live audit item surfaced during research: Google removed
FAQ rich results in June 2026 — existing FAQPage JSON-LD needs cleanup.**

Signals: core/spam/Discover updates; structured-data eligibility changes (FAQPage,
Organization, provider ItemLists); robots/sitemap interpretation & 50k/50 MB limits
(sitemap must stay at parity with the pre-render set); indexing/crawl-budget guidance
(catch-all defaults to noindex); OG/Twitter card spec changes; new rich-result types
Binge could qualify for (Movie/TV/VideoObject).

| Source | URL | status |
|---|---|---|
| Google Search status — ranking history | https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history | live |
| Search Central blog | https://developers.google.com/search/blog | live |
| Search Central "what's new" (RSS) | https://developers.google.com/search/updates | live (.../updates/search_docs_updates.rss) |
| Structured-data intro / supported features | https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data | live |
| Build & submit a sitemap | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap | live |
| How Google interprets robots.txt | https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt | live |
| Open Graph protocol (shared w/ Brand) | https://ogp.me/ | live |

## 16. Creative Director / Brand
**tooling-frontier, trend · medium · quarterly · flag-only**

Signals: Web App Manifest member changes (spec self-flagged "not stable");
favicon/icon `<link rel>` + platform-support shifts (SVG favicon, dark-mode,
apple-touch-icon) governing the saffron-square mark; OG/Twitter card image-spec &
unfurl-rendering (incl. LLM previews); brand/identity design trends feeding the
"doesn't look AI-generated" stance.

| Source | URL | status |
|---|---|---|
| W3C Web App Manifest spec | https://www.w3.org/TR/appmanifest/ | live (WD 2026-05-07) |
| MDN — web app manifest | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest | live |
| MDN — `<link>` element | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link | live |
| Open Graph protocol (shared w/ Growth) | https://ogp.me/ | live |
| Brand New (identity critique) | https://www.underconsideration.com/brandnew/ | live |

## 17. Content Strategist / Copywriter
**compliance, trend · low-medium · quarterly · flag-only (escalate-human if it touches legal prose)**

Signals: new/revised Swedish writing rules (Svenska/Myndigheternas skrivregler
editions); Språkrådet recommendations / Frågelådan rulings on domain vocabulary
("streama", "tv-serie" casing, number/date/ellipsis); annual nyordslista; UX-writing
best-practice shifts (microcopy, CTAs, error/empty-state); klarspråk standard changes.

| Source | URL | status |
|---|---|---|
| Isof — Språkråd och skrivregler | https://www.isof.se/svenska-spraket/sprakrad-och-skrivregler | live |
| Isof — Aktuellt/Nyheter | https://www.isof.se/aktuellt/nyheter | live |
| Isof Frågelådan | https://frageladan.isof.se/ | live |
| Språktidningen — artiklar | https://spraktidningen.se/artiklar/ | live |
| NN/g — UX writing | https://www.nngroup.com/topic/ux-writing/ | live |
| Digital.gov — plain language | https://digital.gov/guides/plain-language | live |

## 18. Community Manager
**trend, tooling-frontier · low-medium · quarterly · flag-only**

No outbound social-platform sharing integration exists today, so there is no
platform-API source; **promote to weekly + add an API source if one ships.**
Anti-spam / DSA-UGC compliance leans escalate-human.

Signals: social/community product-pattern trends (feed, follow-graph, taste-match,
co-watching); UGC engagement best practice; anti-spam/social-graph integrity
(maps to Binge's blocked/following/reports model); moderation-compliance shifts.

| Source | URL | status |
|---|---|---|
| CMX Hub blog | https://www.cmxhub.com/blog | live |
| CMX community industry report | https://www.cmxhub.com/community-industry-report | live |
| NN/g — UX writing (shared w/ Content) | https://www.nngroup.com/topic/ux-writing/ | live |
| Utopia — community moderation | https://www.utopiaanalytics.com/article/community-moderation | live |

## 19. Customer Support / Success
**compliance, tooling-frontier · medium · monthly (Gmail/Yahoo sender news = weekly-urgency interrupt) · auto-ticket (deliverability/import breaks) / escalate-human (GDPR copy)**

Signals: Letterboxd/IMDb CSV export-format changes (silently break the import
parser); email-deliverability standards (Gmail/Yahoo bulk-sender DMARC enforcement,
spam thresholds, one-click unsubscribe) affecting verification/reset mail; Firebase
Auth email-template / action-handler changes; auth error-code/recovery changes that
invalidate support copy.

| Source | URL | status |
|---|---|---|
| Google email sender guidelines | https://support.google.com/a/answer/81126 | live |
| Yahoo sender requirements | https://senders.yahooinc.com/best-practices/ | live |
| Firebase custom email action handlers | https://firebase.google.com/docs/auth/custom-email-handler | live |
| Firebase — customize auth emails | https://support.google.com/firebase/answer/7000714 | live |
| IMDb ratings CSV FAQ | https://help.imdb.com/article/imdb/track-movies-tv/ratings-faq/G67Y87TFYYP6TWAV | live |
| Letterboxd — importing data | https://letterboxd.com/about/importing-data/ | exists, 403 to bots |

## 20. Manual / Release QA Tester
**tooling-frontier, trend · medium · monthly · flag-only**

No E2E suite → this role is the safety net. **Chrome moves to a 2-week stable cycle
from Sept 2026 / Chrome 153 — tighten cadence then.** Escalate-human only if a
confirmed rendering regression hits binge.nu in a shipping stable browser.

Signals: browser release schedules (Chrome/Firefox/Safari) to align smoke-test
windows; rendering/behavior changes & deprecations that could regress the static
SPA; Safari/WebKit quirks (highest-risk engine); Baseline status shifts; dark-mode
`prefers-color-scheme` behavior.

| Source | URL | status |
|---|---|---|
| Chrome for Developers release notes | https://developer.chrome.com/release-notes | live |
| Chrome Releases blog (RSS) | https://chromereleases.googleblog.com/ | live |
| WebKit blog | https://webkit.org/blog/ | live |
| Firefox dev release notes (MDN) | https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases | live |
| web.dev Baseline | https://web.dev/baseline | live |
| Chromium Dash schedule | https://chromiumdash.appspot.com/schedule | live (JS-rendered; use in browser) |

## 21. Technical Writer / Documentation
**trend · low · quarterly · flag-only**

Signals: llms.txt convention evolution (spec revisions, `llms-full.txt` practice)
affecting `public/llms.txt`; Diátaxis / docs-structure practice; changelog conventions
(Keep a Changelog v1.1.0 → v2.0.0 upcoming); ADR practice (Nygard → MADR) affecting
the ADR corpus under `docs/org/adr/`.

| Source | URL | status |
|---|---|---|
| llms.txt spec | https://llmstxt.org/ | live |
| Diátaxis | https://diataxis.fr/ | live |
| Keep a Changelog v1.1.0 | https://keepachangelog.com/en/1.1.0/ | live |
| ADR hub | https://adr.github.io/ | live |

## 22. Data Analyst / BI
**trend, compliance, tooling-frontier · medium · monthly · flag-only**

Signals: Plausible script/feature changes that silently alter the typed
`AnalyticsEvent` mapping; Plausible CE security advisories / pricing; privacy-analytics
regulatory drift (the reason Binge chose Plausible over GA4); Firestore/BigQuery
export + per-read cost-model changes affecting the daily `/insikter` rollup; Gemini
changelog (Ask-Binge learning-loop telemetry).

| Source | URL | status |
|---|---|---|
| Plausible changelog | https://plausible.io/changelog | live |
| Plausible blog | https://plausible.io/blog | live |
| Plausible releases | https://github.com/plausible/analytics/releases | live |
| Firebase release notes | https://firebase.google.com/support/releases | live |
| Gemini API changelog | https://ai.google.dev/gemini-api/docs/changelog | live |

## 23. Vendor / Procurement Manager
**compliance, trend · high · monthly · escalate-human**

~10 vendors, each with a per-service budget; contractual changes are interpretive →
escalate-human. The single highest-stakes contractual item is the **TMDB ToS**
(written commercial agreement required, attribution mandated, 6-month cache cap, AI/ML
use prohibited; now operated by TiVo Platform Technologies LLC).

Signals: free-tier removals / quota cuts (TMDB, MOTN 100/day, OMDb 1000/day,
reCAPTCHA Enterprise 10k/mo, Gemini 2000+25/user); pricing/plan restructures (Sentry
spans repricing; MOTN Pro $39/mo); ToS changes affecting commercial use;
sunsets/acquisitions/forced migrations (reCAPTCHA Classic→Enterprise; FCM legacy);
secret-lifecycle / auth-model changes.

| Source | URL | status |
|---|---|---|
| TMDB API terms of use | https://www.themoviedb.org/api-terms-of-use | live |
| Sentry pricing | https://sentry.io/pricing/ | live |
| OMDb key/pricing | https://www.omdbapi.com/apikey.aspx | live |
| MOTN quickstart/pricing | https://docs.movieofthenight.com/guide/quickstart | live |
| reCAPTCHA release notes | https://docs.cloud.google.com/recaptcha/docs/release-notes | live (301) |
| Gemini API deprecations | https://ai.google.dev/gemini-api/docs/deprecations | live |
| Cloudflare changelog | https://developers.cloudflare.com/changelog/ | live |

> Cineasterna has no public dev API/changelog (B2B-to-library via FörlagEtt AB); its FAQ (`docs.cineasterna.com/vanliga-fragor`) is the only monitorable surface — a low-cadence Vendor watch.

## 24. Monetization / Partnerships Lead
**compliance, trend, tooling-frontier · high · monthly · escalate-human (contractual) / flag-only (market)**

Owns the nascent revenue surface (empty affiliate infra, the library-card wedge).
Affiliate terms are contractual → escalate-human; market intel is flag-only.

Signals: streaming affiliate/partner program launches & terms (Amazon Associates for
Prime Video; impact.com/Awin streaming brands) → fills the empty affiliate infra;
affiliate-network policy/disclosure shifts; SE library e-media platform changes
(Cineasterna/Viddla pricing/coverage — municipalities have dropped them on cost,
e.g. Malmö, Uppsala) affecting the hemkommun-keyed wedge; price-history inputs for
the savings angle.

| Source | URL | status |
|---|---|---|
| Amazon Associates | https://affiliate-program.amazon.com/ | live |
| impact.com partner marketplace | https://impact.com/partners/affiliate-partners/ | live |
| Cineasterna | https://www.cineasterna.com/sv/ | live |
| Viddla | https://www.viddla.se/ | live |
| Biblioteksbladet (library-sector news) | https://www.biblioteksbladet.se/ | live |
| Mediavision posts (savings/pricing intel) | https://posts.mediavision.se/en/ | live |

## 25. Engineering Manager / Release Manager
**tooling-frontier, trend · medium · weekly · escalate-human**

Process decisions (when to take a deferred upgrade, whether to change the
push-to-main/drift-guard agreement) are interpretive → escalate-human. **Weekly**
because Claude Code — the agent that writes this codebase — ships near-daily, and its
behavior changes change the working agreement.

Signals: Claude Code releases (auto-mode safety/classifier, agent/permission, MCP,
sandbox/destructive-command guards); Next.js release cadence + upgrade guides
(deferred-upgrade decisions); GitHub platform/Actions changes touching the 5 CI gates
+ push-to-main deploy; Dependabot grouping changes; React cadence (gates Next.js
timing).

| Source | URL | status |
|---|---|---|
| Claude Code changelog | https://code.claude.com/docs/en/changelog | live |
| Next.js releases (Atom) | https://github.com/vercel/next.js/releases.atom | live |
| GitHub changelog (RSS) | https://github.blog/changelog/feed/ | live |
| GitHub changelog — Dependabot (RSS) | https://github.blog/changelog/label/dependabot/feed/ | live |
| React releases (Atom) | https://github.com/facebook/react/releases.atom | live |

## 26. Information Architect
**trend, tooling-frontier · medium · quarterly · flag-only**

Signals: SEO/URL best-practice shifts for SPAs/static exports (Google JS rendering,
canonical/redirect handling, noindex behavior) affecting catch-all dispatch + the 301
map + noindex-by-default; crawlable-link/History-API conventions; schema.org changes
to Movie/TVSeries/TVSeason/BreadcrumbList; rich-result retirements/additions (FAQPage
retired May/June 2026).

| Source | URL | status |
|---|---|---|
| Google JS SEO basics | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | live |
| Search Central blog | https://developers.google.com/search/blog | live |
| schema.org releases | https://schema.org/docs/releases.html | live |
| schema.org Movie | https://schema.org/Movie | live |
| schema.org TVSeries | https://schema.org/TVSeries | live |
| Google Movie structured-data guidance | https://developers.google.com/search/docs/appearance/structured-data/movie | live |

---

# Tier 3 — diagnostic-sweep roles

## 27. Database Administrator / Data-layer Engineer
**compliance, tooling-frontier, trend · high · monthly (weekly around announced edition/pricing transitions) · auto-ticket (pricing/quota/deprecation) / escalate-human (schema-design implications)**

Signals: Firestore pricing/quota/free-tier changes (governs the 25 SEK cap); TTL,
PITR, scheduled-backup feature/region changes (region eur3; backups exclude TTL
policies + rules → restore-runbook impact); composite-index limits & query-contract
changes (index cap now 500 w/ billing; vector/KNN, aggregation funcs); security-rules
language changes affecting the field-whitelist (`hasOnly`) + dual-write patterns;
Firestore edition changes (Enterprise vs Standard); Firestore JS SDK breaking changes.

| Source | URL | status |
|---|---|---|
| Firestore release notes (GCP) | https://docs.cloud.google.com/firestore/docs/release-notes | live |
| Firebase Security Rules release notes | https://firebase.google.com/support/release-notes/security-rules | live |
| Firestore billing | https://firebase.google.com/docs/firestore/pricing | live |
| Firestore Enterprise pricing | https://firebase.google.com/docs/firestore/enterprise/pricing | live |
| Firestore JS SDK CHANGELOG | https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/CHANGELOG.md | live |
| Firebase release notes hub | https://firebase.google.com/support/releases | live |

## 28. Recommendations / Scoring-Integrity Engineer
**trend, tooling-frontier, compliance · medium · monthly · flag-only**

Owns correctness/weighting/drift of algorithmic surfaces. Mostly trend/frontier →
flag-only; the TMDB AI/ML-use prohibition is the one compliance edge.

Signals: TMDB signal semantics changing under the cascade (`popularity` formula,
`vote_count`/`vote_average`, keyword taxonomy, `similar`/`recommendations` pool
composition) — silently shifts score ceilings, seeds, taste vectors, similar-pool
flooring; streaming-availability accuracy/freshness (drives the advisor); recsys
best-practice + drift-monitoring practice (2026 consensus: alert on input-drift +
eval-drop jointly); TMDB AI/ML-use boundary for any AI-assisted ranking/explanation.

| Source | URL | status |
|---|---|---|
| ACM RecSys 2026 | https://recsys.acm.org/recsys26/ | live |
| RecSys call for contributions | https://recsys.acm.org/recsys26/call/ | live |
| TMDB tracking content changes | https://developer.themoviedb.org/docs/tracking-content-changes | live |
| TMDB API terms (AI/ML boundary) | https://www.themoviedb.org/api-terms-of-use | live |
| MOTN — changes endpoint | https://docs.movieofthenight.com/resource/changes | live |
| ML drift monitoring (practice pointer) | https://www.neovasolutions.com/2026/03/12/ml-model-drift-monitoring-a-continuous-evaluation-framework/ | live (vendor blog — corroborate vs RecSys) |

---

## World-watch gaps

The map's own [genuinely un-owned gaps](../../role-responsibilities.md#genuinely-un-owned-gaps)
section catalogs *internal* verification holes. These are the **external-watch**
gaps — places where no feed exists, or where the watch can't be automated under the
$0/interactive constraint:

| Gap | Why it's a gap | Affected roles |
|---|---|---|
| **TMDB has no reliable changelog feed** | The nominal `/changelog` is JS-rendered and 404'd to a fetcher; TMDB ToS changes (the highest-stakes contractual item) have no feed at all. Must be a manual periodic re-read. | Data/Integrations (13), Vendor (23), Localization (11), Legal (5), Scoring (28) |
| **Bot-blocked canonical sources** | ETSI (EN 301 549), Council of EU (CSA), Letterboxd (journal + import), Chromium Dash all 403 / JS-shell to WebFetch. Each has a verified sibling, but the *canonical* source needs a real-browser check. | Accessibility (2), Trust & Safety (12), PM (9), Support (19), Manual QA (20) |
| **Cineasterna / library e-media has no dev surface** | B2B-to-library product; only a FAQ page to watch. The library-card wedge depends on coverage that shifts via municipal budget decisions, visible only through trade press (Biblioteksbladet). | Monetization (24), Localization (11) |
| **No feed for the affiliate-infra "go-live" trigger** | Affiliate programs launch/change terms on vendor schedules with no aggregated feed; the empty `AFFILIATE_PROGRAMS` table can't tell when a partner becomes available. | Monetization (24), Vendor (23) |
| **Plausible/analytics positioning is judgement, not a signal** | Whether cookie-free analytics stays consent-exempt is an interpretive legal read with no changelog — sits between Data Analyst (flag) and Legal (escalate). | Data Analyst (22), Legal (5) |
| **No outbound social integration to watch** | Community Manager has no platform-API source because none is wired; if sharing ships, a whole class of platform-policy watching appears overnight. | Community (18) |

Common shape: **the highest-stakes external facts (TMDB terms, EU regulation,
library coverage) are exactly the ones with no machine-pollable feed** — so the MVP
deliberately routes interpretive/feedless items to `escalate-human` rather than
pretending a poll covers them.

## Overlaps — shared sources & signals (the dedup axis)

Heavy source reuse is intentional and load-bearing: the same feed serves different
roles from different angles. When `/world-watch` polls, it should fetch each URL once
and fan the delta to every subscribing role.

| Shared source | Roles | Split by intent |
|---|---|---|
| Firebase release notes hub | Controller (3), Data/Integrations (13), DBA (27), Data Analyst (22) | cost vs FCM/Functions API vs schema/pricing vs analytics export |
| Firebase Security Rules release notes | Security (4), DBA (27), QA (7) | attack surface vs field-whitelist contract vs rules-test fidelity |
| Firebase JS SDK releases (Atom) | Security (4), QA (7), DBA (27) | CVE/App-Check vs emulator/test SDK vs Firestore client breaking |
| GitHub changelog — Dependabot (RSS) | Security (4), Eng Mgr (25) | vuln remediation vs batching norm |
| Next.js blog / releases | Architect (14), Performance (10), Security (4), Eng Mgr (25) | static-export survival vs prefetch perf vs CVE vs upgrade-timing |
| React releases / blog | Architect (14), Eng Mgr (25) | direction & CVEs vs upgrade gating |
| web.dev Baseline | Designer (1), Performance (10), Manual QA (20) | adopt-or-not vs perf APIs vs render-regression risk |
| TMDB tracking-changes + ToS | Data/Integrations (13), Localization (11), Vendor (23), Scoring (28), Legal (5) | pipeline break vs provider-id vs contract vs signal-drift vs AI-use law |
| MOTN changes endpoint | Data/Integrations (13), Vendor (23), Scoring (28) | collector break vs quota cost vs availability freshness |
| Open Graph protocol (ogp.me) | Growth (15), Brand (16) | markup/deliverability vs OG-image asset — a genuine boundary, **don't dedup away** |
| JustWatch global press / TV4 press | Localization (11), PM (9) | catalog/provider-id vs market intelligence |
| Mediavision posts | PM (9), Monetization (24) | market shifts vs savings/pricing inputs |
| reCAPTCHA release notes | Security (4), Vendor (23) | App-Check security vs quota/billing |
| Gemini changelog/deprecations | Vendor (23), Data Analyst (22), Scoring (28) | forced-migration cost vs telemetry vs AI-ranking boundary |
| schema.org + Search Central | Growth (15), Information Architect (26) | rich-result eligibility vs site-structure markup |

## Worth noting

A few things this exercise made visible that the static role map didn't:

- **Cadence clusters by stack-velocity, not by importance.** Legal and DPO are the
  highest-stakes roles but sit at *monthly* — EU law moves slowly. The *weekly* roles
  are the fast-moving ones (Security, DevOps, the framework-owning roles, and — newly
  — PM and Localization, because the **Swedish streaming market is in unusual flux**
  right now: TV4 off terrestrial, Schibsted buying TV4 Media, Prime Video ads in SE).
  Volatility-matching means the cheap polls run often and the expensive interpretive
  reads run rarely — which is exactly what the $0 constraint needs.

- **The biggest external risk is contractual, not technical.** The TMDB ToS change
  banning AI/ML use of its content quietly constrains the Gemini "Ask Binge" feature
  and any future ML in the rec cascade — and it has *no feed*. The most important
  thing to watch is the thing hardest to watch automatically, which is precisely why
  the constitution keeps a human in the loop for all legal/privacy.

- **Two findings were already actionable, not just monitoring setup:** Google
  **removed FAQ rich results (June 2026)** → Binge's FAQPage JSON-LD is now dead
  weight (Growth audit item); and **Chrome's 2-week release cycle from Sept 2026**
  tightens the Manual-QA smoke-test window. Standing up the watch layer surfaced live
  work on day one — the point of doing it at all.

- **`.atom` is the unsung hero.** Almost every GitHub `/releases` page exposes a feed
  by appending `.atom`, and that's what lets a $0 poll diff a project's releases
  without scraping a JS-rendered blog. The roles whose sources are all `.atom`-able
  (Security, DevOps, Architect, Performance, QA) are the cheapest and most reliable to
  automate; the roles whose canonical sources are bot-blocked or feedless (Legal,
  Accessibility, Monetization) are the ones that genuinely need a human pass.
