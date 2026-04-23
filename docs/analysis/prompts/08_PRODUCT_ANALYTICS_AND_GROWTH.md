# Product Analytics, Growth & Retention Engineering Analysis

## Analyst

Claude (Opus 4.7) — comprehensive product analytics and growth analysis agent.

## Mission

Perform a forensic-level investigation of Binge's product analytics
instrumentation, growth infrastructure, and retention engineering. The
goal is to verify that the team can answer critical product questions
(where do users drop off, which features drive retention, what nudges
correlate with engagement) and has the infrastructure to experiment and
optimize.

For a pre-launch indie SPA, the bar is not "enterprise-grade analytics"
but "can we learn from the first 100 users what's working and what isn't".
The advisor, revival nudges, and "Tillsammans" flows need measurement
to be iterated on.

**Cross-Prompt Boundaries**:
- Analytics SDK integration and infrastructure: covered in `03_INFRASTRUCTURE_AND_OPERATIONS.md` — skip here.
- App store metadata: N/A (web-only).
- UI copy of nudges / notifications: covered in `06_UX_DESIGN_AND_I18N.md` — skip here.
- Advisor logic: covered in `07_TMDB_INTEGRATION_AND_RECOMMENDATION.md` — skip here.
- This prompt owns: analytics event strategy, funnel coverage, retention
  tracking, notification strategy, feature flags, onboarding optimization,
  re-engagement infrastructure.

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
Target market:       Swedish streaming consumers
Launch status:       Pre-launch (no stable DAU yet)

Analytics stack (current state — verify during investigation):
  - Firebase Analytics: SDK CAN be integrated via firebase/analytics
    (firebase ^12.11.0 is installed) but NOT observed in src/lib/firebase/
    config.ts (only initializeApp, getAuth, getFirestore imported)
  - Google Analytics 4 via gtag.js: NOT observed
  - PostHog / Mixpanel / Amplitude: NOT in dependencies
  - Custom interaction logger: NOT observed

Current analytics instrumentation: APPARENTLY ZERO.

Notification stack:
  - No FCM / push notifications (web push requires service worker +
    Firebase Messaging — not present)
  - No email engine (no SendGrid / Mailgun / Firebase Extensions)
  - In-app notifications: users/{uid}/notifications collection in
    Firestore (rules present); how they're generated is unclear
    (no Cloud Functions, no server — so they'd need to be written by
    client code of OTHER users. Verify mechanism during investigation.)

Retention hooks already in the product:
  - RevivalNudge (src/components/dashboard/RevivalNudge.tsx +
    src/hooks/useRevivalNudges.ts) — shows watched+ended shows that
    came back to life
  - SubscriptionAdvisorWidget (dashboard) — shows money-saving opportunities
  - UpcomingCards (dashboard) — next episodes coming up
  - /calendar — upcoming releases
  - /savings — advisor detail page

Feature flags:
  - No FeatureFlagService observed
  - No Remote Config integration (firebase/remote-config not imported)
  - All behavior is release-gated via code deploy

Onboarding:
  - No dedicated onboarding flow observed (src/app/ has no /onboarding/ route)
  - /kalibrera (calibration) may be a lightweight taste-onboarding but
    verify if it's mandatory / skippable / first-run
  - /settings has provider selection — probably the closest thing to
    onboarding ("pick your streaming services")
  - No first-run wizard

Growth mechanics:
  - Social: /feed, /grupper, /tillsammans — lightweight viral loops
  - Referral: NOT observed
  - Shareable content: reviews have public URLs? Lists can be public?
    (Firestore rules: lists public if isPublic; reviews public; verify
    actual share URLs in UI)

Generated file exclusions:
  .next/, node_modules/, out/, .firebase/
```

---

## Investigation Framework: 8 Dimensions (100 Points Total)

### Dimension 1: Analytics Instrumentation Completeness (22 points)

**Investigation Scope**: Is every critical user action tracked? Are there
blind spots?

**Specific Investigation Tasks:**

1. **Event Taxonomy Audit**
   ```
   Current expected state: ZERO analytics events logged.

   If true:
   - Flag as CRITICAL gap for a pre-launch product
   - No ability to measure ANY product question

   If analytics is integrated somewhere, map all events:
   - Search: firebase/analytics, logEvent, gtag, posthog, trackEvent
   - For each event: name, parameters, trigger location (file:line)
   - Check naming consistency (snake_case vs camelCase)
   - Check PII exclusion (no emails, user IDs in event params unless
     under consent)
   ```

2. **Critical Action Coverage Matrix**
   ```
   For a pre-launch media tracker, must-have tracked actions:

   Signup / Activation:
   - [ ] App opened (first time)
   - [ ] Signed up (email verified if required)
   - [ ] Signed in (returning)
   - [ ] Providers selected (count, which)
   - [ ] First title added to watchlist
   - [ ] First title marked watched

   Core actions:
   - [ ] Title added to watchlist (status = följer/vill_se/sedd)
   - [ ] Title status changed
   - [ ] Title rated (value)
   - [ ] Note added to title
   - [ ] Episode marked watched
   - [ ] Title dropped (from följer)
   - [ ] Title removed from watchlist
   - [ ] Search performed (query length, not content)
   - [ ] Title detail page viewed

   Advisor / money features:
   - [ ] Advisor opened (savings page viewed)
   - [ ] Pause action taken on a provider
   - [ ] Unpause action taken
   - [ ] Provider cost edited
   - [ ] Advisor recommended pause (impression — value of savings)
   - [ ] Revival nudge shown (impression + which show)
   - [ ] Revival nudge acted on (user clicked through)

   Social:
   - [ ] User followed
   - [ ] User unfollowed
   - [ ] Review created
   - [ ] Review liked
   - [ ] Review commented
   - [ ] List created (public / private)
   - [ ] List shared

   Tillsammans / groups:
   - [ ] Session created
   - [ ] Session joined (via link)
   - [ ] Swipe cast (yes / no / super)
   - [ ] Match found
   - [ ] Group created
   - [ ] Group joined (via invite token)

   Navigation:
   - [ ] Page view (every route)
   - [ ] Sidebar click (which item)
   - [ ] Mobile menu opened

   Errors:
   - [ ] TMDB fetch failure
   - [ ] Firestore operation failure
   - [ ] Sign-in failure
   ```
   - Document every gap with severity

3. **Event Parameter Quality**
   ```
   Check (if any events exist):
   - Events parameterized for segmentation?
     (e.g., "title_added" should include mediaType: movie|tv, status)
   - Durations (time_to_first_action)
   - Correlation IDs (session_id grouping events in same session)
   - No free-text from user input (privacy)
   ```

4. **Session Definition**
   ```
   - What counts as a session?
     Firebase Analytics default: 30-min inactivity timeout, recommended.
   - Is session_id stable across nav within a session?
   ```

**Files to audit:**
- src/components/Providers.tsx (likely top-level analytics init)
- src/lib/firebase/config.ts (analytics init missing currently)
- All ViewModels / hooks (search for tracking calls)
- src/contexts/AuthContext.tsx (signup / signin events)

**Output Required:**
- Complete event inventory (currently expected: empty)
- Critical action coverage matrix (action × tracked?)
- Recommended event taxonomy for Phase 2
- Instrumentation gap list with severity

---

### Dimension 2: Funnel Coverage (18 points)

**Investigation Scope**: Are critical user funnels instrumented end-to-end?

**Specific Investigation Tasks:**

1. **Activation Funnel**
   ```
   Required steps (from cold visit to "activated"):
   1. Landing page loaded
   2. Clicked sign-up / log-in
   3. Completed authentication
   4. Reached dashboard
   5. Selected at least one streaming provider
   6. Added first title to watchlist
   7. Returned on Day 2 (retention milestone)

   For each: is it tracked?
   - Can drop-off between steps be calculated?
   - Is time-to-first-value (signup → first title added) measured?
   - Is there a definition of "activated user"?
     Candidate: "added ≥ 3 titles AND selected ≥ 1 provider within 24h"
   ```

2. **Advisor-Value Funnel**
   ```
   The advisor is the "killer feature". Its funnel:
   1. Visited /savings (or saw dashboard widget)
   2. Saw a pause recommendation
   3. Understood the saving potential (monthlySavings displayed)
   4. Clicked the pause button
   5. Actually canceled / paused the provider in real life (self-report
      via "I paused this" button)
   6. Returned after resumeAt to reactivate

   Currently expected: zero tracking. Without it, we can't measure whether
   the advisor creates value.
   ```

3. **Social / Viral Funnel**
   ```
   1. User created a public review OR list
   2. User copied a shareable URL
   3. Another visitor clicked the URL
   4. That visitor signed up
   5. That visitor added a title

   Tillsammans session:
   1. User created a session
   2. User shared the invite link
   3. Friends clicked the link and joined
   4. Swipes happened
   5. Match was found

   Groups:
   1. User created a group
   2. Invite token generated
   3. Others joined via token
   4. Members added to group watchlist
   ```

4. **Retention Hooks Effectiveness**
   ```
   - Revival nudge shown: correlates with return visit within 7 days?
   - Advisor pause taken: correlates with continued usage?
   - Notification delivered (when implemented): open rate?

   Without events for "nudge shown" and "nudge acted on", we can't answer.
   ```

**Output Required:**
- Funnel diagrams with instrumented vs uninstrumented steps
- Drop-off measurement capability per funnel
- Activation definition + time-to-value tracking gaps
- Recommended funnel events for Phase 2

---

### Dimension 3: Retention & Cohort Tracking Infrastructure (15 points)

**Investigation Scope**: Can the team track retention cohorts and identify
engagement drivers?

**Specific Investigation Tasks:**

1. **Cohort Definition Capability**
   ```
   Can users be grouped by:
   - Signup date (daily / weekly cohorts)?
   - Acquisition source? (currently no UTM tracking observed)
   - Provider selection (Netflix users vs Viaplay users — do they
     retain differently?)
   - Engagement tier (power user vs casual)?
   ```

2. **Retention Metrics**
   ```
   Standard:
   - Day 1 / Day 7 / Day 30 retention
   - Weekly active users (WAU) / Monthly active users (MAU)
   - WAU/MAU ratio (stickiness)

   Binge-specific:
   - Week-over-week title-add rate
   - Did the user come back for a new episode? (advisor signals this)
   ```

3. **North Star Metric Definition**
   ```
   Candidate North Star for Binge:
   - "Users who acted on the advisor in the last 30 days"
   - "Weekly active episode-logging users"
   - "Swedish subscribers who found out where to watch ≥ 3 titles/month"

   Is a North Star defined? Probably not yet. Propose and score.
   ```

4. **Lifecycle Stages**
   ```
   - New (< 7 days, < 3 titles added)
   - Activated (3+ titles, 1+ provider)
   - Engaged (logs episodes weekly)
   - At-risk (no activity 14+ days)
   - Churned (no activity 30+ days)
   - Resurrected (returned after 30+ days)

   Can the backend identify which stage each user is in? Without analytics
   infrastructure, no.
   ```

**Output Required:**
- Cohort tracking capability assessment (currently: low / none)
- Retention metric gaps
- North Star metric proposal
- Lifecycle stage tracking feasibility

---

### Dimension 4: Notification & Nudge Strategy (15 points)

**Investigation Scope**: Are in-app nudges and notifications strategically
timed, segmented, and tied to outcomes?

**Specific Investigation Tasks:**

1. **Nudge Inventory (in-product, on-dashboard)**
   ```
   Current nudge surfaces:
   - RevivalNudge: watched+ended show has come back (good retention hook)
   - SubscriptionAdvisorWidget: pause opportunity on dashboard
   - UpcomingCards: next episodes in next 7 days
   - (Possibly more — audit src/components/dashboard/)

   For each nudge:
   - When does it fire (conditions)?
   - Is impression logged?
   - Is click-through logged?
   - What does "success" look like (did the user act)?
   ```

2. **Notification Types (Firestore-backed)**
   ```
   users/{uid}/notifications collection exists (Firestore rules).
   Investigate:
   - How are notifications created? (No Cloud Functions, so client writes?)
   - Types: new follower? new comment? group activity?
   - Are they shown in-app (a bell icon, a feed)?
   - Are they marked read?
   - Is there retention (delete old ones)?

   Cross-ref 03 for retention policy, 02 for rule compliance.
   ```

3. **External Notification Channels (future)**
   ```
   Not implemented:
   - Web push notifications (Firebase Cloud Messaging for Web — requires
     service worker + FCM integration)
   - Email notifications (no email engine)
   - SMS (out of scope)

   For Phase 2: web push is the lowest-cost addition; highest-value
   use case is "next episode of a show you follow airs tomorrow".
   ```

4. **Notification Preferences**
   ```
   CLAUDE.md mentions "notification settings" on user profile but
   nothing is wired.
   - What's the intended schema?
   - Granular: episode-release vs social vs advisor?
   - Quiet hours?
   - Opt-in vs opt-out (GDPR — opt-in is safer)?
   ```

5. **Effectiveness Measurement**
   ```
   For each nudge / notification:
   - Send rate / impression rate
   - Click-through rate
   - Conversion rate (did the user act on it?)
   - Retention lift (do users who saw nudge X return more?)

   Currently zero infrastructure to answer these.
   ```

**Files to audit:**
- src/components/dashboard/RevivalNudge.tsx
- src/components/dashboard/SubscriptionAdvisorWidget.tsx
- src/hooks/useNotifications.ts
- Any in-app notification UI (bell icon?)

**Output Required:**
- Nudge inventory with logic + measurement status
- Notification capability matrix (Firestore / push / email)
- Preference schema recommendation
- Effectiveness measurement gaps

---

### Dimension 5: Feature Flags & Experimentation Infrastructure (10 points)

**Investigation Scope**: Can the team run experiments and progressively
roll out features?

**Specific Investigation Tasks:**

1. **Feature Flag Presence**
   ```
   Currently expected: NONE.

   No FeatureFlagService, no Remote Config usage, no split.io, no
   Unleash, no PostHog feature flags.

   All behavior is code-deployed.
   ```

2. **Remote Config Readiness**
   ```
   firebase v12 includes remote-config module. Adoption would be low-effort.
   Use cases for Binge:
   - Toggle experimental advisor logic
   - Tune CATCHUP_THRESHOLD without deploy
   - Enable/disable retention hooks on segments
   - Kill switch for TMDB proxy if implemented
   ```

3. **A/B Testing Capability**
   ```
   For a pre-launch app with no DAU, formal A/B testing is premature.
   But infrastructure readiness matters for post-launch iteration:
   - Deterministic user bucketing (hash(uid) % 100)
   - Event tracking of variant assignment
   - Segmentation in analytics
   ```

4. **Progressive Rollout**
   ```
   Currently deploy = 100% rollout instantly.
   For features with user-facing risk:
   - Canary via Firebase Remote Config (10% of users)
   - Kill switch readiness
   ```

**Output Required:**
- Feature flag inventory (currently: none)
- Remote Config readiness (easy win: low effort, high value)
- A/B testing framework recommendation for Phase 2
- Progressive rollout capability

---

### Dimension 6: Onboarding & Activation (10 points)

**Investigation Scope**: Is the first-run experience optimized for activation
and retention?

**Specific Investigation Tasks:**

1. **Onboarding Flow Structure**
   ```
   No /onboarding route observed.

   What does a new user see after sign-up?
   - Blank dashboard with empty states?
   - Settings page redirect?
   - /kalibrera (taste calibration)?

   Recommend Phase 2 onboarding arc:
   1. Welcome / value prop (2 screens)
   2. Provider selection (critical — advisor depends on it)
   3. Taste calibration (optional — can be skipped)
   4. Add first title (required — the aha moment)
   5. "Done — here's your dashboard"

   Dropout tracking at each step.
   ```

2. **Activation Definition**
   ```
   Proposed: "added ≥ 3 titles AND selected ≥ 1 provider within 24h"

   Currently: not defined, not tracked.
   ```

3. **Empty State → Filled State Transition**
   ```
   - Dashboard empty state (cross-ref 06 UX): does it guide the user to
     add their first title?
   - Is the first title-add celebrated? (toast, confetti — CLAUDE.md: no
     celebrations; functional confirmation OK)
   ```

4. **Time-to-First-Value**
   ```
   TTFV for Binge:
   - Signup → "I see where I can watch this show I care about" (the
     aha moment)

   How fast can a user reach this?
   - Current: signup → settings (pick providers) → search → add title
     → see providers on detail page
   - 4-5 clicks + type search query

   Can this be shortened?
   - On signup, pre-populate common providers?
   - Surface a "try a popular title" to demonstrate immediately?
   ```

**Output Required:**
- Onboarding flow map (currently: ad-hoc)
- Activation metric definition + tracking proposal
- TTFV measurement capability
- Empty-state → filled-state audit

---

### Dimension 7: Viral & Referral Mechanics (5 points)

**Investigation Scope**: Can Binge grow through existing features?

**Specific Investigation Tasks:**

1. **Shareable Content**
   ```
   Firestore rules show:
   - Reviews are public (public read)
   - Lists can be public (isPublic flag)
   - Sessions are unlisted-link (session ID)
   - Groups are token-join

   Do these produce shareable URLs in the UI?
   - Share button on a review?
   - Share button on a public list?
   - "Copy invite link" for sessions / groups (presumably yes)
   ```

2. **Social Features as Growth Loops**
   ```
   - Following: user follows a friend → notifications of their activity
   - Tillsammans: creates a session → invites friends → they sign up to join

   Tillsammans in particular is a natural viral loop: "pick a movie
   together with my partner". Is it positioned prominently for growth?
   ```

3. **Formal Referral Program**
   ```
   Not implemented. Low priority for pre-launch indie app. Flag as LOW.
   ```

4. **Open Graph / Social Sharing**
   ```
   - Meta tags for og:title, og:image, og:description on shareable URLs?
   - Twitter card support?
   - Swedish-appropriate share copy?
   ```

**Output Required:**
- Shareable content inventory
- Viral loop mapping (existing features)
- Open Graph support audit
- Referral infrastructure readiness

---

### Dimension 8: Re-Engagement & Win-Back Infrastructure (5 points)

**Investigation Scope**: Can the app bring back lapsed users?

**Specific Investigation Tasks:**

1. **Lapsed User Detection**
   ```
   Currently: no server-side lapse detection (no Cloud Functions).

   Options:
   - Client-side: on return visit, check lastSeenAt from user doc and
     show a "welcome back" message (low-value without content)
   - Server-side (future): Cloud Function cron to email lapsed users
     about new episodes of their following shows
   ```

2. **Win-Back Channels**
   ```
   Currently: zero out-of-app channels.

   Future Phase 2 options:
   - Web push (low-effort, high-value for episode releases)
   - Email (higher effort, requires email engine)
   ```

3. **Revival Nudge as Win-Back**
   ```
   The existing RevivalNudge is a strong in-app win-back for users who
   return. It needs:
   - Impression logging
   - Click-through logging
   - Correlation with retention
   ```

4. **"Tillsammans" Session Reminders**
   ```
   Unique to Binge: "You started a session but never finished" —
   nudge to return. Not implemented but natural.
   ```

**Output Required:**
- Lapsed user detection feasibility
- Win-back channel assessment
- Revival nudge effectiveness (once measured)
- Recommended re-engagement surfaces for Phase 2

---

## Scoring Framework

| # | Dimension | Points | Scoring Guidance |
|---|-----------|--------|------------------|
| 1 | Analytics Instrumentation | /22 | 22: Every critical action tracked, quality params, consent gated. 11: Major actions tracked. 0: No analytics at all. |
| 2 | Funnel Coverage | /18 | 18: Activation + advisor-value + viral funnels fully instrumented. 9: Partial. 0: No funnel tracking. |
| 3 | Retention & Cohort Tracking | /15 | 15: Cohorts defined, D1/D7/D30 measured, North Star tracked. 8: Basic. 0: None. |
| 4 | Notification & Nudge Strategy | /15 | 15: Nudges measured, preferences granular, effectiveness tracked. 8: Nudges exist but unmeasured. 0: None. |
| 5 | Feature Flags & Experimentation | /10 | 10: Flags remote, A/B capability, progressive rollout. 5: Basic flags. 0: None. |
| 6 | Onboarding & Activation | /10 | 10: Instrumented arc, activation defined. 5: Onboarding exists. 0: None. |
| 7 | Viral & Referral | /5 | 5: Shareable content + OG + referral. 3: Shareable only. 0: None. |
| 8 | Re-Engagement | /5 | 5: Lapse detected + win-back capability. 3: In-app only. 0: None. |

---

## Output Format

### Executive Summary

```
BINGE PRODUCT ANALYTICS & GROWTH ANALYSIS — PHASE 1 FINDINGS
===============================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Scope: Analytics, funnels, retention, nudges, flags, onboarding, virality,
re-engagement

OVERALL SCORE: X/100
├── Analytics Instrumentation:        X/22 points
├── Funnel Coverage:                  X/18 points
├── Retention & Cohort Tracking:      X/15 points
├── Notification & Nudge Strategy:    X/15 points
├── Feature Flags & Experimentation:  X/10 points
├── Onboarding & Activation:          X/10 points
├── Viral & Referral:                 X/5 points
└── Re-Engagement:                    X/5 points

STATUS: [Launch Ready | Needs Work | Critical Gaps]

CRITICAL GAPS: X found
HIGH PRIORITY: X found
MEDIUM PRIORITY: X found
LOW PRIORITY:   X found

TOP 5 GROWTH RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report Format

For each dimension: summary (2–3 sentences), issues by severity with
file:line, impact, fix, effort. Include quick wins.

### Analytics Coverage Dashboard

```
| Action Category       | Actions Defined | Actions Tracked | Coverage |
|-----------------------|-----------------|-----------------|----------|
| Signup / activation   | X               | Y               | Z%       |
| Core actions          | X               | Y               | Z%       |
| Advisor / savings     | X               | Y               | Z%       |
| Social                | X               | Y               | Z%       |
| Tillsammans / groups  | X               | Y               | Z%       |
| Navigation            | X               | Y               | Z%       |
| Errors                | X               | Y               | Z%       |
```

### Phase 2 Preparation

Total issue counts by severity, estimated total remediation effort.

---

## Investigation Execution Plan

### Stage 1: Analytics Integration Deep Dive (1h)

```
- Inspect src/lib/firebase/config.ts: is firebase/analytics imported?
- Grep: logEvent, gtag, analytics, trackEvent
- Check Providers.tsx and AuthContext for init
- Firebase Console: check project settings for Analytics status
```

### Stage 2: Funnel & Nudge Mapping (1.5h)

```
- Walk every critical user journey
- List nudge surfaces
- Cross-ref with existing analytics (currently: likely none)
- Identify gaps per funnel
```

### Stage 3: Retention & Lifecycle Assessment (1h)

```
- Cohort-definition capability
- D1 / D7 / D30 infrastructure
- Lifecycle stage logic
- North Star proposal
```

### Stage 4: Feature Flags / Experiments / Growth (1h)

```
- Remote Config readiness
- Shareable content surfaces
- Viral loop mapping
- Lapse detection feasibility
```

### Stage 5: Report Compilation (1h)

Compile findings into structured report.

**Total: 5–6 hours**

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score
- [ ] Detailed findings for all 8 dimensions with file:line references
- [ ] Issue classification (Critical/High/Medium/Low) with counts + effort
- [ ] Complete analytics event inventory (likely: empty)
- [ ] Critical-action coverage matrix
- [ ] Funnel diagrams with instrumentation status
- [ ] Recommended event taxonomy (Phase 2 input)
- [ ] Nudge inventory with logic + measurement status
- [ ] Onboarding flow map
- [ ] Activation metric definition
- [ ] Viral / referral inventory
- [ ] Phase 2 preparation section

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX**
2. **PRE-LAUNCH CONTEXT** — Binge has no DAU yet. Don't penalize lack of
   real-data insight; score instrumentation READINESS.
3. **MINIMUM VIABLE ANALYTICS** — Firebase Analytics (free) is the lowest-
   effort starting point. Recommend it for Phase 2 unless the team has a
   specific reason to choose PostHog / Mixpanel / Amplitude.
4. **GDPR CONSENT** — any analytics requires cookie consent banner (cross-
   ref 02 and 09). Don't recommend integration without consent infrastructure.
5. **NO INFRASTRUCTURE DUPLICATION** — skip FCM / Cloud Functions setup
   (covered by 03).
6. **ZERO CODE CHANGES** — investigation and documentation only.
7. **PRIVACY-AWARE** — flag any analytics that might capture PII
   (usernames, notes, review text, search queries).
8. **REALISTIC** — Binge is a 1-person indie SPA. Don't demand enterprise
   experimentation platforms; recommend zero-cost infrastructure first.
