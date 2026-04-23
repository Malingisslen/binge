# Monetization Readiness & Competitive Positioning Analysis

## Analyst

Claude (Opus 4.7) — comprehensive monetization and competitive analysis agent.

## Mission

Perform a forensic-level investigation of Binge's technical readiness for
future monetization and its competitive positioning in the Swedish media
tracker / streaming advisor space. The goal is to assess whether the
existing architecture can support subscription / freemium models without
major refactoring, and how Binge's feature set and differentiation compare
to the market.

"No monetization decisions yet" does not mean the technical infrastructure
shouldn't be evaluated. Building payment into an app post-hoc is harder
than designing for it. Additionally, no other analysis prompt looks
OUTWARD — they all audit the code. Binge must be benchmarked against
what Swedish users expect from a media tracker.

This is not a superficial review. This is a deep investigation across
7 weighted dimensions, totaling 100 points.

**Cross-Prompt Boundaries**:
- App store metadata: N/A (web-only, no app store presence).
- Security of payment flows (when implemented): will be covered by 02.
- Dependency vulnerabilities in IAP packages: covered by 05.
- This prompt owns: entitlement architecture readiness, schema
  extensibility for subscriptions, feature completeness benchmarking,
  competitive differentiation, revenue infrastructure prerequisites,
  Swedish market positioning.

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
Framework:           Next.js 14 (App Router), client-side SPA
Target market:       Swedish streaming consumers (primary)
                     Nordic expansion candidate (Norway, Denmark, Finland)
Current monetization: None (pre-monetization)

Key differentiators (from codebase):
  - Swedish-first streaming provider integration (19 providers mapped
    with brand colors, cost tiers including ads/free variants)
  - Subscription advisor (useSubscriptionAdvisor, 393 lines) with
    priority-cascade, pause tracking, cost calculation
  - Revival nudges (useRevivalNudges) — watched+ended shows that returned
  - Swedish UI (not just translation — domain vocabulary: Följer, Vill
    se, Sedd)
  - Upcoming episode calendar
  - Taste vector pipeline (src/lib/taste/) — personalization foundation
  - Tillsammans (watch-together) social feature
  - Permanent groups with shared watchlists
  - Reviews + ratings + public profiles (lightweight social)

What Binge is NOT:
  - Not a recommendation engine powered by LLMs
  - Not a streaming platform (no video playback)
  - Not a store (no commerce)
  - Not a community forum (limited UGC, no threaded discussions)

Platforms:           Web (desktop + mobile browsers)
                     No native apps (iOS / Android / desktop)

Swedish competitive landscape (known players — verify during investigation):
  International (available in Sweden):
    - JustWatch — THE dominant streaming availability tracker globally.
      Also has Swedish coverage. Key competitor.
    - Reelgood — similar to JustWatch, US-centric.
    - Serializd — TV-focused tracker with social features.
    - Letterboxd — film-focused, heavy social/reviews.
    - Trakt — multi-platform tracker with API/integrations.
    - Simkl — tracker with anime focus.
    - TV Time — mobile-first TV tracker.
  Swedish-specific:
    - TV Tid — Swedish TV listings (less streaming-focused)
    - Filmtipset — Swedish film community (old but established)
    - Provider-native apps — Netflix, Viaplay, etc. have their own
      "Min lista" features but don't aggregate across providers

Binge's unique angle:
  - SWEDISH PROVIDERS FIRST (JustWatch covers them but not as primary
    focus — ads/free tiers, pricing, pause advisor are Binge specifics)
  - Money-focused advisor (JustWatch does NOT tell users to cancel
    Viaplay for 2 months)
  - "Prisjakt for media" positioning (nobody else claims this)

Generated file exclusions:
  .next/, node_modules/, out/, .firebase/
```

---

## Investigation Framework: 7 Dimensions (100 Points Total)

### Dimension 1: Entitlement Architecture Readiness (18 points)

**Investigation Scope**: Can the existing architecture support subscription-
based feature gating without major refactoring?

**Specific Investigation Tasks:**

1. **Permission / Auth Layer Assessment**
   ```
   Current auth layer:
   - AuthContext (src/contexts/AuthContext.tsx, 271 lines) — holds user
     profile, myProviders, providerCosts, providerPauses, etc.
   - AuthGuard component wraps protected pages
   - No dedicated "permission" or "entitlement" layer

   For subscription support, Binge would need:
   - Entitlement concept: user.subscriptionTier: 'free' | 'premium'
   - Feature gating function: hasFeature(user, 'feature_id')
   - UI pattern: "upgrade to unlock" prompts

   Is the current structure extensible?
   - YES if subscriptionTier can be added to AuthContext.user profile
   - Would need ONE more field in users/{uid} Firestore doc
   - Feature gating would be a thin wrapper: isPremium(user) checks
   ```

2. **Feature Gating Patterns Currently Used**
   ```
   Search for any conditional-feature code:
   - Search: if (user.) patterns that gate features
   - Currently all features are available to all authenticated users

   This is good for Phase 2 — minimal refactor to add tier checks.
   ```

3. **IAP / Payment Provider Readiness**
   ```
   Check package.json:
   - NO stripe, no @stripe/* packages
   - NO paddle, no lemonsqueezy, no klarna (Swedish common)
   - NO revenue-cat (mobile-only anyway)
   - No payment integration

   For Swedish market, payment options to consider:
   - Stripe: supports SEK, Swish (via partner), cards
   - Paddle: handles EU VAT automatically (advantage for Swedish tax)
   - Klarna: popular in Sweden for consumers
   - Swish: instant Swedish payment standard, requires integration

   Subscription-vs-one-time: subscription is the obvious model for a
   media tracker (ongoing value).
   ```

4. **Subscription State Management**
   ```
   Required new schema fields on users/{uid}:
   - subscriptionTier: 'free' | 'premium' | (future: 'family')
   - subscriptionStatus: 'active' | 'trial' | 'expired' | 'cancelled'
   - trialStartDate, trialEndDate
   - currentPeriodEnd (renewal tracking)
   - paymentProvider: 'stripe' | 'paddle' | ...
   - externalCustomerId (Stripe customer ID, etc.)

   Firestore security considerations:
   - These fields must be WRITE-PROTECTED (user can't self-upgrade)
   - Require Cloud Function + webhook handler to write
   - Currently: no Cloud Functions exist — BLOCKER for payment integration

   Flag as HIGH for Phase 2 planning.
   ```

5. **Receipt Validation Infrastructure**
   ```
   For any paid subscription:
   - Server-side receipt verification (NEVER trust client)
   - Webhook endpoint for subscription events (renewal, cancellation,
     payment failure)
   - Currently: NO server. Cloud Functions would need to be added.

   Effort: 1–2 weeks to set up Stripe + webhook + Firestore sync.
   ```

**Files to audit:**
- src/contexts/AuthContext.tsx (entitlement extension point)
- src/components/AuthGuard.tsx (protection pattern)
- src/app/settings/page.tsx (where subscription management would live)
- package.json (no payment deps)
- Any Cloud Functions (none)

**Output Required:**
- Entitlement architecture extensibility assessment
- Integration complexity for Phase 2 subscription model
- Required schema changes inventory
- Payment provider recommendation for Swedish market
- Refactoring risk assessment

---

### Dimension 2: Schema Extensibility for Subscriptions (12 points)

**Investigation Scope**: Can the Firestore schema accommodate subscription
data without migration headaches?

**Specific Investigation Tasks:**

1. **User Document Extensibility**
   ```
   Current user doc fields (inferred from rules + code):
   - displayName, username, email (Firebase Auth-managed)
   - myProviders, providerCosts, providerPauses
   - isPublic flag
   - notification settings
   - lastActiveAt (implied)

   Adding subscription fields is ADDITIVE — no migration for existing users
   (reads default to undefined → interpret as free tier).

   Firestore schema is schema-less by nature — this is a non-issue.
   Rules need an update to PROTECT new fields (user cannot self-upgrade).
   ```

2. **Feature Limits Infrastructure**
   ```
   For a freemium model, check which limits could be enforced:

   Candidate free-tier limits:
   - Watchlist size (e.g., 100 titles free, unlimited premium)
   - Following count (e.g., follow 20 users free)
   - Custom lists (e.g., 3 lists free)
   - Group count (e.g., 1 group free)
   - Tillsammans sessions per month
   - Advisor savings recommendations: LIMITED free? (probably not — core
     value; gating this limits viral spread of the product)

   Check current code:
   - Are any limits already enforced (even as "please wait")?
   - Is there a rate limiter service?

   Expected: NO limits enforced. Adding them later is an additive change.
   ```

3. **Rate Limiter Parameterization**
   ```
   Binge currently has no explicit rate limits (cross-ref 09 Dim 7).
   When rate limits are added, they should be tier-parameterized:
   - Free: X reviews/day
   - Premium: unlimited

   Architecture: a getLimit(user, operation) function checked before
   writes. Straightforward to add.
   ```

**Files to audit:**
- src/types/index.ts (user type — check fields present)
- firestore.rules (write protection)
- Any rate-limiter code (expected: none)

**Output Required:**
- Schema extensibility assessment (easy — Firestore is schema-less)
- Required rule changes to protect subscription fields
- Free-tier limit recommendations
- Rate-limiter parameterization capability

---

### Dimension 3: Feature Completeness vs Market Table-Stakes (22 points)

**Investigation Scope**: Does Binge have the features users expect from
a media tracker in 2025–2026?

**Specific Investigation Tasks:**

1. **Table-Stakes Feature Checklist**
   ```
   Based on JustWatch / Serializd / Trakt / Letterboxd:

   Core tracking:
   - [x] Add title to watchlist (Vill se / Följer)
   - [x] Mark title as watched (Sedd)
   - [x] Track per-episode progress (useEpisodeProgress)
   - [x] Rate titles (useReviews)
   - [x] Personal notes
   - [x] Drop a title (dropped flag)
   - [x] Status change history (implicit via updatedAt)

   Discovery:
   - [x] Search (multi — movies, TV, people)
   - [x] Discover / browse (/discover)
   - [x] Recommendations (taste-based)
   - [x] Trending (via TMDB)
   - [x] Genre browsing
   - [x] Person filmography (credits)
   - [x] Upcoming releases (/calendar)
   - [?] Filter by what's on MY providers (verify — should be yes)

   Streaming info (differentiator):
   - [x] Where to watch (per title)
   - [x] User's providers highlighted
   - [x] Provider tier selection (ads / standard / premium)
   - [x] Brand colors and short names
   - [x] Provider cost tracking

   Social:
   - [x] Follow users
   - [x] Public reviews
   - [x] Public lists
   - [x] Groups (permanent)
   - [x] Tillsammans (ephemeral watch-together sessions)
   - [ ] Friend recommendations ("what's your friend watching?")
   - [ ] Activity feed (/feed exists — verify content)

   Personalization:
   - [x] Taste vector (/kalibrera)
   - [x] Custom lists
   - [?] Watch history timeline

   Advisor (Binge unique):
   - [x] Subscription cost tracking
   - [x] Pause recommendations
   - [x] Monthly savings calculation
   - [x] Revival nudges

   Gaps to verify:
   - [ ] Unit conversion (episodes → hours "time spent watching")
   - [ ] Stats / year-in-review
   - [ ] Export watchlist (user data portability)
   - [ ] Import from Trakt / Letterboxd / IMDb
   - [ ] "Random pick" (for Tillsammans alternative: solo random)
   - [ ] Streaks / gamification (optional)
   - [ ] Offline / PWA install
   - [ ] Dark mode (currently light-themed per CLAUDE.md)
   - [ ] Family profiles (multiple users on one account)

   Swedish-specific table-stakes:
   - [x] SVT Play, TV4 Play, Viaplay coverage
   - [x] Ads tier pricing (69 / 89 SEK for Disney+ / HBO Max / Viaplay
     ads tiers)
   - [ ] SF Anytime / Filmstaden integration (verify not in catalog)
   - [ ] C More legacy (merged into TV4 Play — verify handled)
   - [ ] MUBI / specialty providers (Swedish availability)
   ```

2. **Feature Gap Impact Analysis**
   ```
   For each gap:
   - Is it launch-blocking, launch-desirable, or post-launch?
   - Effort to implement?
   - Does a competitor have it as table-stakes?
     (e.g., import from Trakt is table-stakes for power users)
   ```

3. **Swedish Market Specifics**
   ```
   - Swedish measurement conventions: N/A for media (no metric/imperial issue)
   - Currency display: SEK (kr) — verify no accidental $ or €
   - Swedish content prioritization: Swedish-produced movies/series
     (Snabba Cash, Bron, etc.) discoverable?
   - Partnership potential: SVT API for broadcast data? (TV Tid territory)
   - Livsmedelsverket-style "public data" — not applicable for media
   ```

4. **Power-User Feature Gaps**
   ```
   For Binge to win vs Trakt:
   - API for third-party apps (bring-your-own-frontend crowd)?
   - CSV / JSON export?
   - Bulk operations (mark 10 episodes watched at once)?
   - Keyboard shortcuts?
   ```

**Files to audit:**
- src/app/ (every route — check feature existence)
- src/components/ (UI inventory)
- Compare against JustWatch + Serializd feature matrix (web research
  during investigation)

**Output Required:**
- Table-stakes checklist (implemented / partial / missing)
- Feature gap analysis with priority + effort
- Swedish-market specific gaps
- Launch readiness from feature-completeness perspective

---

### Dimension 4: Differentiation Analysis (15 points)

**Investigation Scope**: What makes Binge unique, and how defensible is it?

**Specific Investigation Tasks:**

1. **Differentiator Inventory**
   ```
   From codebase analysis, Binge's unique aspects:

   Primary differentiators:
   A. Swedish-first provider integration with pricing + tiers
      - Depth: 19 providers, 10 with tier lists, brand colors
      - Defensibility: requires ongoing maintenance of Swedish streaming
        market data; high maintenance burden = moat against casual entrants
      - Technical moat: LOW (any competitor can scrape TMDB)
      - Data moat: MEDIUM (accurate pricing is hand-maintained)

   B. Subscription advisor (pause recommendations, catchup suggestions)
      - Unique globally — JustWatch, Serializd, Trakt do NOT do this
      - Technical moat: MEDIUM (advisor logic is non-trivial;
        useSubscriptionAdvisor is 393 lines)
      - Patent potential: maybe; look for prior art (Justwatch did
        briefly have a "where is this cheaper" feature)

   C. Swedish-language UI (not translation, domain vocabulary)
      - Moat: audience-specific; competitors entering Swedish market
        can translate in a week
      - Launch-phase advantage: YES
      - Long-term moat: LOW unless combined with Swedish partnerships

   D. "Prisjakt for media" positioning
      - Unique brand angle
      - No direct competitor uses this framing
      - Defensibility: brand / positioning, not technical

   E. Tillsammans (watch-together ephemeral sessions)
      - Exists in other apps (Serializd has something similar?)
      - Not unique but well-executed adds value

   Secondary differentiators:
   F. Revival nudges (watched+ended shows that returned)
      - Clever retention hook
      - Not unique — some competitors surface "back on [provider]"
      - Low implementation cost

   G. Taste vector pipeline (src/lib/taste/)
      - Common feature; implementation quality varies
      - Not a competitive moat
   ```

2. **Competitive Matrix**
   ```
   Populate during investigation (web research needed for accuracy):

   | Feature                | Binge | JustWatch | Serializd | Letterboxd | Trakt |
   |------------------------|-------|-----------|-----------|------------|-------|
   | Swedish provider depth | High  | Medium    | Low       | Low        | Low   |
   | Ads/tier pricing       | Yes   | Partial   | No        | No         | No    |
   | Subscription advisor   | Yes   | No        | No        | No         | No    |
   | Revival nudges         | Yes   | No        | Basic     | No         | No    |
   | Swedish UI             | Yes   | Yes (lite)| No        | No         | No    |
   | Watch-together         | Yes   | No        | No        | No         | No    |
   | Custom lists           | Yes   | Yes       | Yes       | Yes        | Yes   |
   | Public reviews         | Yes   | No        | Yes       | Yes (core) | Yes   |
   | Activity feed          | Partial| No       | Yes       | Yes        | Yes   |
   | Native mobile app      | No    | Yes       | Yes       | Yes        | Yes   |
   | API for third parties  | No    | Yes       | No        | No         | Yes   |
   | Import from others     | No    | Partial   | Partial   | Yes        | Yes   |
   | Offline / PWA          | No    | Yes (app) | No        | Yes (app)  | Yes (app)|
   | Commerce integration   | No    | Links     | No        | No         | No    |
   ```

3. **Moat Assessment**
   ```
   Network effects:
   - Social features (follows, reviews, Tillsammans) create mild
     network effects, but not strong: a lone user with no friends on
     Binge gets most of the value from the tracker + advisor.
   - Therefore: network effects are SUPPLEMENTAL, not primary.

   Data moat:
   - Personal watchlist + taste data creates switching cost
   - Power users resist migration
   - Requires import-from-others feature to attract power users from
     Trakt / Letterboxd
   - Export feature protects users (GDPR mandates) → can't rely on
     lock-in

   Content moat:
   - Public reviews + lists create user-generated content moat IF
     critical mass reached (Swedish reviews in Swedish for Swedes)
   - Bootstrap phase: no critical mass yet

   Switching costs:
   - Accumulated watched history + ratings + notes create switching friction
   - Increases over time; negligible for new users
   ```

4. **Positioning Strengths / Weaknesses**
   ```
   Strengths:
   - Clear niche (Swedish-first)
   - Clear differentiator (advisor)
   - Strong design vocabulary ("Prisjakt for media")

   Weaknesses:
   - Web-only (native apps expected by power users)
   - No import path (blocks migration from Trakt / Letterboxd)
   - Small market (Sweden ~10M population; addressable streaming
     consumers ~5M)
   - Maintenance burden for pricing accuracy (providers change plans
     quarterly)
   ```

**Output Required:**
- Differentiator strength assessment
- Competitive matrix (Binge × 4–5 key competitors × 12+ features)
- Moat analysis (network effects, data, content, switching costs)
- Positioning strengths/weaknesses

---

### Dimension 5: Revenue Infrastructure Prerequisites (12 points)

**Investigation Scope**: What technical prerequisites for monetization are
in place or easily addable?

**Specific Investigation Tasks:**

1. **Server-Side Capability**
   ```
   Current: NO Cloud Functions, NO server routes (static export intended).

   For subscription handling, MINIMUM requirements:
   - Server endpoint for Stripe webhook (subscription events)
   - Server ability to write to users/{uid}.subscriptionTier
     (current rules + lack of functions: client-only, user can't
     self-upgrade → MUST add Cloud Functions)

   Effort: 1–2 weeks to add Cloud Functions + webhook handler.
   ```

2. **Paywall UI Patterns**
   ```
   Currently: no upgrade prompts, no paywall screens.

   Needed for Phase 2:
   - "Upgrade to Premium" button placement (settings, feature gates)
   - Paywall screen (what's in Premium, pricing, Swish/card CTA)
   - Trial handling UI
   - Cancellation flow
   - Receipts / invoices download (EU requirement for B2C SaaS)

   Design-system fit: paywall must respect CLAUDE.md rules (no gradients,
   no shadows, 2-3px radius — strict constraints for a typical
   marketing-heavy paywall).
   ```

3. **Analytics for Monetization**
   ```
   Cross-ref 08: currently zero analytics. For monetization:
   - Conversion funnel (visit → signup → trial → paid)
   - Feature usage per tier (which features drive upgrades?)
   - Revenue events (purchase, renewal, cancellation, churn reason)
   - LTV calculation
   - Retention by tier

   Requires analytics integration (cross-ref 08 Dim 1).
   ```

4. **Pricing Model Feasibility**
   ```
   Options for Binge:

   Freemium + Premium:
   - Free: core tracking + providers + limited advisor
   - Premium: unlimited advisor recommendations, import from others,
     export, power-user features, ad-free (if ads added)
   - Pricing: 29–49 SEK/month for Swedish market
   - Easier to build; risk of low conversion

   Subscription only:
   - Simple paid app, 49–79 SEK/month
   - Higher quality bar required
   - Harder to bootstrap user base

   One-time purchase:
   - 199–299 SEK lifetime unlock
   - Popular with Paprika / Apple-style one-time buyers
   - No recurring revenue

   Patron / donate (Ko-fi / Patreon / GitHub Sponsors):
   - Minimal integration effort
   - Low revenue ceiling
   - Good for community-first positioning

   Sponsored providers (ethically tricky):
   - Highlight provider X in results
   - Conflict with advisor's "save money" positioning
   - Not recommended

   For each: technical effort, moral fit with positioning.
   ```

5. **EU VAT / Swedish Tax Compliance**
   ```
   Digital SaaS to Swedish consumers:
   - VAT 25% applies
   - Display prices including VAT
   - Invoice / receipt must show VAT breakdown
   - Company must be VAT-registered if revenue > SEK 30k/year
     (moms-registrering)

   Paddle and Stripe Tax handle this automatically as merchant of record.
   Building it in-house requires tax-registration overhead.

   Recommendation for Phase 2: use Paddle as MoR (merchant of record)
   to outsource tax complexity.
   ```

**Output Required:**
- Revenue infrastructure readiness assessment
- Cloud Functions requirement (blocker)
- Technical requirements for each pricing model
- Payment provider recommendation
- EU VAT / Swedish tax handling strategy

---

### Dimension 6: Market Positioning & Go-to-Market Readiness (8 points)

**Investigation Scope**: Is Binge positioned effectively for its target market?

**Specific Investigation Tasks:**

1. **Domain & Brand**
   ```
   - Domain: binge.nu — .nu is a Swedish-friendly TLD (originally Niue,
     widely used in Nordic markets). Memorable and fitting.
   - Brand name: "Binge" — global, simple, category-relevant (Swedish
     word = Swedish? Mostly English loanword).
   - Positioning: "Prisjakt for media" — clear angle for Swedish
     audience (Prisjakt is Swedish household name for price comparison).
   ```

2. **Web Presence**
   ```
   - SPA at binge.nu
   - robots.txt: in /public — investigate rules
   - sitemap.xml: in /public — investigate coverage (likely static paths
     only, no per-title indexing due to SPA)
   - Open Graph tags for shared URLs?

   SEO for a SPA:
   - Limited out-of-box (no SSR)
   - Static export with dynamic routes = requires pre-rendering
   - Critical titles (top 1000) could be pre-rendered as static HTML —
     but CLAUDE.md notes this is disabled currently
   - Impact on organic growth: HIGH; solved only by SSR / pre-rendering
   ```

3. **Swedish Market Opportunity**
   ```
   Assess:
   - Sweden: ~10M population, ~5M streaming consumers, ~3M tracker
     adopters max
   - Nordic expansion: Norway (5M), Denmark (6M), Finland (6M),
     Iceland (0.4M) — additional ~18M
   - Similar streaming provider landscape in Nordics → can reuse
     provider catalog with minor updates

   Monetization math:
   - At 1% Swedish adoption (50k users), 10% conversion to paid
     (optimistic) at 39 SEK/month = 5,000 × 39 = ~195k SEK/mo
     = ~2.3M SEK/year revenue
   - Reasonable solo-developer business scale
   ```

4. **Content Marketing Readiness**
   ```
   - SEO potential on "var streamar [title name] Sverige" queries
     (high intent, Swedish-specific, low competition)
   - Blog / content section: not present (add for SEO?)
   - Social presence: Swedish Twitter? Reddit r/sweden? — external to codebase
   ```

5. **Referral Infrastructure**
   ```
   Cross-ref 08 Dim 7. Current: minimal (shareable URLs for lists,
   reviews, sessions, groups).

   For monetization: referral bonus (give 1 month free for referring a
   paid user) requires:
   - Referral code generation
   - Tracking
   - Reward attribution
   Not present. Phase 2 if monetization proceeds.
   ```

**Output Required:**
- Brand / domain / positioning assessment
- Web presence + SEO readiness
- Swedish + Nordic market sizing
- Content marketing capability
- Referral infrastructure

---

### Dimension 7: Launch Readiness & Growth Strategy (13 points)

**Investigation Scope**: Is the product ready for a public launch, and is
there a credible growth path?

**Specific Investigation Tasks:**

1. **Launch Blockers**
   ```
   Cross-ref other prompts for specific blockers:
   - 02: CRITICAL security issues (Firebase rules gaps, API key exposure)
   - 06: CRITICAL design rule violations, accessibility AA failures
   - 07: CRITICAL advisor correctness bugs, provider catalog gaps
   - 09: legal document absence, age gate, data residency UNVERIFIED
   - 03: no PITR, no backups, no error tracking

   Produce a unified launch-blocker list from these references + any
   identified here.
   ```

2. **Soft Launch Readiness**
   ```
   For a soft launch (100–500 early users, friends & family, Swedish
   streaming Reddit, etc.):
   - Feature completeness: core flows work ✓
   - Performance: acceptable for small user count
   - Support capacity: solo developer can handle ~500 users
   - Feedback mechanism: any in-app feedback form? Likely no — needed
   ```

3. **Growth Channels**
   ```
   Plausible channels for Swedish consumer SaaS:
   - Organic SEO on "var streamar X" long-tail (requires SSR / pre-render)
   - Swedish streaming Reddit (r/sweden, r/svenskfilm, r/Serier)
   - Influencer (Swedish film/TV podcasters, YouTubers)
   - Product Hunt (Swedish audience is small; less relevant)
   - Word-of-mouth via Tillsammans sessions (viral mechanic)
   - Paid ads: expensive for solo, high CAC relative to LTV
   - PR: Swedish tech media (Breakit, Di Digital) if launch is newsworthy

   Advisor feature is PR-worthy ("Svensk tjänst som hjälper dig spara
   på streaming" — Aftonbladet / DN style headline).
   ```

4. **Product-Market Fit Signals**
   ```
   Once launched, signal metrics to track (needs analytics from 08):
   - D7 retention > 20% = decent PMF
   - Advisor usage rate > 30% of active users = differentiator resonates
   - Referral rate: organic growth via Tillsammans shares
   - NPS > 40 = happy users
   ```

5. **Scale-Up Readiness**
   ```
   Cross-ref 04 Dim 5:
   - 10x users: no refactor needed
   - 100x users: Firebase cost becomes material, TMDB proxy needed,
     server-side rendering for SEO
   - 1000x users: significant architecture review
   ```

**Output Required:**
- Unified launch blockers list (drawing from other prompts)
- Soft launch readiness assessment
- Growth channel matrix (channel × effort × potential)
- Product-market-fit signal definition
- Scale-up constraint summary

---

## Scoring Framework

| # | Dimension | Points | Scoring Guidance |
|---|-----------|--------|------------------|
| 1 | Entitlement Architecture | /18 | 18: Clean path to tier-gating, minimal refactor. 9: Possible but significant work. 0: Major rebuild. |
| 2 | Schema Extensibility | /12 | 12: Schema-less, additive fields, rate limiter parametrizable. 6: Some refactor. 0: Rigid. |
| 3 | Feature Completeness | /22 | 22: All table-stakes + Swedish specifics. 11: Core features. 0: Missing core. |
| 4 | Differentiation | /15 | 15: Strong defensible moat. 8: Clear but replicable. 0: None. |
| 5 | Revenue Infrastructure | /12 | 12: Cloud Functions + paywall UI + analytics ready. 6: Some. 0: None. |
| 6 | Market Positioning & GTM | /8 | 8: Clear position, SEO-ready, sizing. 4: Partial. 0: None. |
| 7 | Launch Readiness & Growth | /13 | 13: Zero launch blockers, clear channels. 7: Known blockers. 0: Far from ready. |

---

## Output Format

### Executive Summary

```
BINGE MONETIZATION & COMPETITIVE POSITIONING — PHASE 1 FINDINGS
==================================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Scope: Monetization readiness, feature completeness, competitive
positioning, launch readiness

OVERALL SCORE: X/100
├── Entitlement Architecture Readiness:    X/18 points
├── Schema Extensibility for Subscriptions:X/12 points
├── Feature Completeness:                  X/22 points
├── Differentiation:                       X/15 points
├── Revenue Infrastructure:                X/12 points
├── Market Positioning & GTM:              X/8 points
└── Launch Readiness & Growth:             X/13 points

STATUS: [Monetization Ready | Preparation Needed | Significant Gaps]

CRITICAL ISSUES: X found
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found

TOP 5 MONETIZATION & COMPETITIVE RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report Format

Summary, issues by severity with file:line (where applicable), impact,
fix, effort. Quick wins.

### Feature Completeness Matrix

```
| Category                 | Table-Stakes | Implemented | Missing | Priority |
|--------------------------|--------------|-------------|---------|----------|
| Tracking                 | X            | Y           | Z       | ...      |
| Discovery                | X            | Y           | Z       | ...      |
| Streaming info           | X            | Y           | Z       | ...      |
| Social                   | X            | Y           | Z       | ...      |
| Advisor (unique)         | X            | Y           | Z       | ...      |
| Power-user / Export      | X            | Y           | Z       | ...      |
| Swedish specifics        | X            | Y           | Z       | ...      |
```

### Competitive Positioning Matrix

```
| Feature               | Binge | JustWatch | Serializd | Letterboxd | Trakt |
|-----------------------|-------|-----------|-----------|------------|-------|
| [Populate during web research]
```

### Phase 2 Preparation

Total issue counts by severity, remediation effort, next steps.

---

## Investigation Execution Plan

### Stage 1: Architecture Assessment (1h)

```
- AuthContext extensibility
- Firestore schema additivity
- Feature gating pattern readiness
- Rate limiter parameterization
```

### Stage 2: Feature Completeness (2h)

```
- Systematic review of all routes and components
- Table-stakes checklist evaluation
- Swedish-specific features
```

### Stage 3: Competitive & Market Analysis (1.5h)

```
- Web research: JustWatch / Serializd / Trakt / Letterboxd feature matrices
- Competitive matrix population
- Moat analysis
```

### Stage 4: Revenue Infrastructure (1h)

```
- Cloud Functions requirement
- Payment provider survey
- EU VAT considerations
- Paywall UI feasibility in design system
```

### Stage 5: Positioning & Launch (1h)

```
- Brand / domain / SEO
- Growth channel analysis
- Launch blocker consolidation (from other prompts)
- Swedish market sizing
```

### Stage 6: Report Compilation (1h)

Compile findings.

**Total: 7–8 hours**

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score
- [ ] Detailed findings for all 7 dimensions with file:line references
- [ ] Issue classification (Critical/High/Medium/Low) with counts + effort
- [ ] Entitlement architecture assessment
- [ ] Schema extensibility evaluation
- [ ] Table-stakes feature checklist
- [ ] Competitive positioning matrix
- [ ] Differentiation and moat analysis
- [ ] Revenue infrastructure prerequisites
- [ ] Market positioning + launch readiness
- [ ] Phase 2 preparation section

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX**
2. **OUTWARD-LOOKING** — this is the only prompt that looks at competitors
   and market. Be thorough with competitive research.
3. **PRE-MONETIZATION** — team has not committed to a model. Assess
   readiness; propose options; don't prescribe.
4. **SWEDISH MARKET FOCUS** — primary audience. Evaluate accordingly.
   Don't apply US-centric assumptions (app store submission, COPPA,
   GDPR-lite) that don't match.
5. **NO CODE CHANGES**
6. **REALISTIC** — solo indie developer, web-only SPA. Score accordingly.
   Don't demand enterprise monetization infrastructure.
7. **CROSS-REFERENCE** — launch blockers from 02, 06, 07, 09 feed this
   prompt's launch readiness dimension. Reference them, don't redo them.
8. **PRICING ACCURACY** — provider prices in catalog are HAND-MAINTAINED.
   Flag staleness as a moat-erosion risk (cross-ref 07 Dim 2).
