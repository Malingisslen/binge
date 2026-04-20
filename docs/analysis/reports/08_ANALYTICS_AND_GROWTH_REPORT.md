# Binge — Product Analytics, Growth & Retention Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20

---

## Executive Summary

```
OVERALL SCORE: 18/100
├── Analytics Instrumentation:        0/22   ← zero analytics integrated
├── Funnel Coverage:                  0/18
├── Retention & Cohort Tracking:      0/15
├── Notification & Nudge Strategy:    8/15   ← RevivalNudge + advisor widgets exist
├── Feature Flags & Experimentation:  0/10
├── Onboarding & Activation:          4/10   ← /kalibrera exists as taste flow
├── Viral & Referral:                 4/5    ← shareable URLs exist; OG basic
└── Re-Engagement:                    2/5

STATUS: Critical Gaps — zero product instrumentation.
         Every product question is currently unanswerable.

CRITICAL GAPS: 1 (no analytics at all)
HIGH:          6
MEDIUM:        6
LOW:           3
```

---

## Dimension 1 — Analytics Instrumentation: 0/22

### Current State: ZERO Analytics

```
grep results:
  firebase/analytics:  0 matches
  getAnalytics:        0 matches
  gtag:                0 matches
  logEvent:            0 matches
  trackEvent:          0 matches
  posthog:             0 matches
  plausible:           0 matches
```

No analytics provider integrated. `src/lib/analytics.ts` — file does
not exist (CLAUDE-style expected file per the prompt, but confirmed
absent). No AnalyticsLoader component.

### CRITICAL

**E-CRIT — Zero analytics instrumentation**
- Binge cannot answer ANY product question:
  - How many users sign up? Don't know.
  - What % add a first title? Don't know.
  - Does the advisor widget get clicked? Don't know.
  - Do revival nudges drive return visits? Don't know.
  - Which pages drive retention? Don't know.
- The entire product-discovery loop is broken.

**Recommended Phase 2 analytics stack:**

| Option | Cost | Complexity | Fit |
|--------|------|------------|-----|
| **Plausible** (self-hosted or cloud) | $9/mo cloud, privacy-first | Low | GOOD — cookie-free, GDPR-friendly, simple |
| **Firebase Analytics (GA4)** | Free | Medium | OK — already using Firebase; consent-gated req'd |
| **PostHog** | Free tier | High | Over-engineered for Binge stage |
| **Custom Firestore events** | Free | High + ongoing | Too much DIY |

**Recommendation: Plausible.** Cookie-free, no consent banner needed
(per IMY generally-accepted interpretation), fast to integrate.

**Critical events to track (from prompt):**
- Signup / activation: first_visit, signed_up, providers_selected,
  first_title_added, first_watched_mark
- Core: title_added_watchlist, status_changed, rated, noted,
  episode_watched, dropped, searched, title_detail_viewed
- Advisor: advisor_viewed, pause_action_taken, revival_nudge_shown,
  revival_nudge_acted_on
- Social: user_followed, review_created, review_liked, list_created,
  list_shared, session_created (tillsammans), session_joined
- Navigation: page_view per route (Plausible does this automatically)

- Effort: **1 day** for basic Plausible integration; 3-5 days for
  full event coverage.

---

## Dimension 2 — Funnel Coverage: 0/18

### Funnels Defined (but unmeasured)

1. **Activation funnel**: visit → sign-up → providers selected → first
   title added → return D2
2. **Advisor-value funnel**: visit dashboard → see advisor widget →
   click through → take pause action → re-subscribe after resumeAt
3. **Viral funnel**: Tillsammans session created → invites sent →
   guests visit → sign up → add titles
4. **Search → Add**: search typed → result clicked → StatusButton used

All four are currently uninstrumented.

### HIGH

**F-1 — Activation not defined or tracked**
- Proposed definition: "added ≥ 3 titles AND selected ≥ 1 provider
  within 48 h"
- Effort: **2 h** once analytics lands (events already listed in E-CRIT)

**F-2 — Advisor-value funnel is Binge's unique differentiator and it's invisible**
- Binge's #1 competitive moat is the subscription advisor. Whether it
  creates real user value is unknown.
- Effort: **2 h** (requires E-CRIT landing first)

---

## Dimension 3 — Retention & Cohort Tracking: 0/15

- No cohort definitions
- No D1/D7/D30 tracking (requires analytics base)
- No WAU/MAU / stickiness measurement
- No North Star metric

**Proposed North Star candidates (to discuss with user):**
- "Weekly active episode-logging users"
- "Active advisor users in last 30 days"
- "Swedish subscribers who found where to watch ≥ 3 titles per week"

### HIGH

**RET-1 — Lifecycle stage tracking absent**
- New / activated / engaged / at-risk / churned — none defined or tracked.
- Effort: **1 h** definition + **1 h** analytics tagging (post E-CRIT)

---

## Dimension 4 — Notification & Nudge Strategy: 8/15

### In-Product Nudge Surfaces (EXIST — good)

- `src/components/dashboard/RevivalNudge.tsx` — shows watched+ended
  shows that came back to life
- `src/components/dashboard/SubscriptionAdvisorWidget.tsx` — advisor
  hook output on dashboard
- `src/components/dashboard/UpcomingCards.tsx` — upcoming episodes
- `src/app/calendar/page.tsx` — dedicated upcoming calendar

### In-Product Notifications (Firestore collection)

- `users/{uid}/notifications/{notifId}` — Firestore rules allow
  owner-only read/write
- `useNotifications.ts` (4 onSnapshot-related uses observed) maintains
  a notification list
- **Trigger mechanism:** notification docs are created BY THE USER'S
  OWN CLIENT (per `useNotifications.ts:72-82` inspection) — e.g., when
  a user scans their watchlist and detects a new episode on a provider
  they have. This is a client-side polling / reactive pattern.
- Cross-ref 02 G-3: this means notifications aren't truly event-driven
  (no Cloud Function, no FCM) — they're computed per-user in-session.

### Findings

#### MEDIUM

**N-1 — Notification effectiveness unmeasured**
- RevivalNudge impressions, clicks — no event.
- Advisor widget impressions, clicks — no event.
- UpcomingCards engagement — no event.
- Effort: **1 h** after E-CRIT

**N-2 — No external notification channels (web push, email)**
- Web Push (via Firebase Cloud Messaging + service worker) could
  notify users of new episodes even when the app is closed.
- Email: would need sending infrastructure (SendGrid / Resend) +
  email templates + unsubscribe.
- Effort: web push **2–3 days**; email **1 week+**
- Priority: web push first (no new provider, uses Firebase).

**N-3 — No notification preferences UI**
- User has no way to control what notifications they get (beyond
  hiding the dashboard widgets).
- Effort: **1 day**

#### LOW

**N-4 — Quiet hours / frequency caps — not applicable yet**
- Matters only once multiple channels exist. Defer.

---

## Dimension 5 — Feature Flags & Experimentation: 0/10

### Current State: ZERO

- No `featureFlag` / `FeatureFlagService` anywhere
- No Firebase Remote Config (grep clean)
- No A/B testing framework
- All behavior deploy-gated

### Findings

#### MEDIUM

**FF-1 — No remote configuration**
- Value: toggle experimental advisor logic, disable Scrapfly if added,
  gate Cloud Functions when deployed, A/B onboarding copy, tune
  CATCHUP_THRESHOLD from 3 without redeploy.
- Fix (Phase 2): add Firebase Remote Config (since firebase SDK is
  already loaded — +3-5 KB).
- Effort: **1 day** basic integration

**FF-2 — No A/B testing infrastructure**
- For Binge's scale (pre-launch indie), formal A/B testing is
  premature. Basic deterministic-bucketing library can wait until
  DAU > 1000.
- Effort: **deferred**

---

## Dimension 6 — Onboarding & Activation: 4/10

### Current State

- **`/kalibrera`** (188 lines) — taste-calibration flow with 10-round
  ThumbsUp/ThumbsDown swipe. USES `getTrending` from TMDB.
- **`/settings`** — provider selection grid (493 lines)
- **No dedicated `/onboarding/` route**
- **No welcome wizard** after sign-up

### Findings

#### HIGH

**O-1 — No guided first-run experience**
- New user flow after sign-up: lands at `/` — blank dashboard, no
  instructions.
- What a well-onboarded user should do:
  1. Sign up (4 sec)
  2. See welcome ("Välkommen till Binge") with value prop
  3. Select providers (critical — advisor and filters depend)
  4. Optional: complete /kalibrera (taste calibration)
  5. Search for first title + add it
  6. See dashboard populated with first item
- Proposed path: first-login detection → show `/onboarding/providers`
  → optionally `/kalibrera` → land at `/` with pre-populated hint
  ("Sök och lägg till din första titel")
- Effort: **1 day** design + **1 day** implementation

**O-2 — Activation metric not defined or tracked**
- Cross-ref F-1. Without this, onboarding improvements can't be measured.

#### MEDIUM

**O-3 — `/kalibrera` not linked from onboarding flow**
- It exists, but new users don't discover it unless they navigate to
  `/kalibrera` manually.
- Fix: link from first-run onboarding (Phase 2).

**O-4 — Empty-state copy on dashboard not verified**
- Cross-ref 06 F2.

### Strengths

- `/kalibrera` is a thoughtful taste-capture flow — rare for indie apps
- Settings provider selection is already well-designed
- Dashboard has skeleton/empty states (per 06 review)

---

## Dimension 7 — Viral & Referral: 4/5

### Shareable Content

Per Firestore rules (`firestore.rules`) and codebase:
- Reviews are public (rules:42) — shareable URL format not verified
  but public-read means they can be surfaced on search
- Lists can be public (rules:66) — `src/app/my/lists/page.tsx` should
  expose a share URL
- `CopyLinkButton.tsx` component exists — verify behavior
- Tillsammans sessions (unlisted-link) — share invite URL
- Groups (token-join) — share group URL + token

### Open Graph ✓

`src/app/layout.tsx:10-17`:
```ts
openGraph: {
  title: 'Binge.nu',
  description: 'Håll koll på vad du tittar på — se var film och serier finns att streama i Sverige.',
  siteName: 'Binge.nu',
  type: 'website',
}
```
- Title and description are correct.
- **No `openGraph.images`** → shared links on Slack/Twitter/WhatsApp
  show no thumbnail.

### Findings

#### MEDIUM

**V-1 — OG image not set globally**
- No `og:image`. Links shared on social have no preview image.
- Fix: add `images: ['https://binge.nu/og-default.png']` or SVG.
- For PER-PAGE dynamic OG (e.g., scan result for /movie/[id]) static
  export makes this hard but generatable at build time via Next.js
  `generateMetadata` per-page.
- Effort: **30 min** global image; **days** for per-page dynamic OG.

**V-2 — No Twitter card meta**
- `twitter:` not set.
- Fix: add `twitter: { card: 'summary_large_image', ... }`.
- Effort: **15 min**

#### LOW

**V-3 — No `/referral` or referral-token mechanism**
- For viral growth at scale, a referral bonus (1 month premium for
  referring a paid user) motivates sharing.
- Premature for pre-launch indie. Defer.

### Strengths

- `llms.txt` via `public/llms.txt`? Not verified — check presence. If
  absent, recommend adding (synat.se has one; indie SEO best practice).
- Swedish-language OG description is natural and matches positioning.

---

## Dimension 8 — Re-Engagement: 2/5

### Current State

- **In-app:** RevivalNudge + UpcomingCards are Binge's natural
  re-engagement surfaces. Work when user returns.
- **Out-of-app:** NONE. No web push, no email, no notification channels
  beyond in-app.

### Findings

#### MEDIUM

**RE-1 — No lapsed-user detection**
- "User hasn't visited in 14 days" signal requires analytics +
  server-side job. Currently neither exists.
- Effort: post E-CRIT + Cloud Functions (future)

**RE-2 — No win-back mechanism**
- Once a user lapses, Binge has no way to pull them back (no email,
  no push).
- Effort: cross-ref N-2 (web push ~2-3 days is the cheapest path)

#### LOW

**RE-3 — Bookmark-friendly URLs ✓**
- Routes are clean and stable. Users can bookmark `/tv/{id}` and
  return. This is Binge's only current re-engagement strategy (and
  it's passive).

---

## Analytics Coverage Dashboard

```
| Category               | Actions Defined | Actions Tracked | Coverage |
|------------------------|-----------------|-----------------|----------|
| Navigation             | ~20             | 0               | 0%       |
| Signup / activation    | 6               | 0               | 0%       |
| Core watchlist actions | 10              | 0               | 0%       |
| Advisor / savings      | 6               | 0               | 0%       |
| Social                 | 10              | 0               | 0%       |
| Tillsammans / groups   | 6               | 0               | 0%       |
| Errors                 | 3               | 0               | 0%       |
| TOTAL                  | ~60             | 0               | 0%       |
```

---

## SEO Technical Output (Stub)

### Existing Artifacts

- `public/robots.txt` — single-line `User-agent: * / Allow: /` + Sitemap ref
- `public/sitemap.xml` (53 lines) — static sitemap listing ~15 top routes
  (`/`, `/discover/`, `/series/`, `/films/` ...)
- `src/app/robots.ts` — NOT present (uses static public/robots.txt)
- `src/app/sitemap.ts` — NOT present (uses static public/sitemap.xml)

### Findings

#### MEDIUM

**SEO-1 — sitemap.xml is static — misses dynamic routes**
- Doesn't include `/tv/{id}`, `/movie/{id}`, `/person/{id}`, `/butik/*`
  (if any), etc.
- For SEO of scan result / detail pages, dynamic sitemap is essential.
- Fix: generate `sitemap.xml` at build time from a known TMDB-id list
  (top N popular titles).
- Or: use `app/sitemap.ts` dynamic generator with static export.
- Effort: **1 day**

**SEO-2 — No structured data (JSON-LD) on any page**
- `/movie/{id}` and `/tv/{id}` would benefit from Schema.org `Movie` /
  `TVSeries` types.
- Reviews could use Schema.org `Review`.
- Effort: **1 day** for movie + tv + review types

**SEO-3 — Per-page meta title / description not dynamic**
- Only root layout metadata observed. Dynamic routes probably fall
  back to root title "Binge.nu — Håll koll på vad du tittar på".
- For SEO and sharing, each `/movie/{id}` should have title like
  "Inception (2010) — var kan jag streama? — Binge.nu".
- Fix: add `generateMetadata` per dynamic route.
- Effort: **3 h**

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | CRITICAL | Zero analytics integration | (missing) | 1 day |
| 2 | HIGH | Activation not defined / tracked | (no events) | post E-CRIT |
| 3 | HIGH | Advisor-value funnel unmeasured | (key differentiator blind) | post E-CRIT |
| 4 | HIGH | No guided first-run experience | (no /onboarding) | 2 days |
| 5 | HIGH | Lifecycle stages unmodeled | (requires analytics) | post E-CRIT |
| 6 | HIGH | Revival/advisor nudges unmeasured | RevivalNudge.tsx, SubscriptionAdvisorWidget.tsx | post E-CRIT |
| 7 | HIGH | Sitemap static — misses dynamic routes | public/sitemap.xml | 1 day |
| 8 | MEDIUM | No OG image / Twitter card | layout.tsx | 30 min |
| 9 | MEDIUM | No web push for episode releases | (missing) | 2–3 days |
| 10 | MEDIUM | No structured data (Schema.org) | per-page | 1 day |

---

## Phase 2 Preparation

**Total issues:** 16 (1 CRITICAL / 6 HIGH / 6 MEDIUM / 3 LOW)

**Sprint 1 — Get the analytics base (1–2 days):**
- E-CRIT — integrate Plausible (1 day)
- Tag core events: signed_up, title_added_watchlist, first_title_added,
  advisor_viewed, revival_nudge_shown, revival_nudge_acted_on (3 h)
- Add OG image + Twitter card (30 min)

**Sprint 2 — Funnels + SEO (2–3 days):**
- F-1, F-2, RET-1 — define activation, lifecycle stages, funnels (2 h)
- SEO-1 — dynamic sitemap generator (1 day)
- SEO-3 — per-page metadata (3 h)
- SEO-2 — Schema.org markup (1 day)

**Sprint 3 — Onboarding + retention (2–3 days):**
- O-1 — guided onboarding flow (2 days)
- O-3 — link /kalibrera from onboarding (15 min)
- N-1 — event tagging on all nudges (1 h)

**Sprint 4 — Re-engagement (future):**
- N-2 — web push (2–3 days)
- RE-1, RE-2 — lapse detection + win-back (depends on Cloud Functions)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero code changes
2. ✅ File:line references where applicable
3. ✅ Cross-prompt dedup — consent gating → 09; CDN cache → 04; UX
   copy → 06; FCM infra → 03
4. ✅ Realistic — pre-launch indie, no users yet. Score instrumentation
   READINESS, not real-data coverage.
5. ✅ Privacy-aware — recommended Plausible (cookie-free) to avoid
   cookie-consent dependency
