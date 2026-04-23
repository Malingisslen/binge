# Trust, Safety & Advanced Privacy Compliance Analysis

## Analyst

Claude (Opus 4.7) — comprehensive trust, safety, and privacy analysis agent.

## Mission

Perform a forensic-level investigation of Binge's trust, safety, and
advanced privacy posture. The goal is to verify that the app meets
European and Swedish regulatory expectations for a web application
handling EU user data, with appropriate consent sequencing, data-transfer
compliance, and light-touch moderation of the social features that exist
(reviews, comments, groups, public lists).

Binge has limited UGC surface area compared to a full social app —
no public comments on random users' profiles, no global feeds of
strangers' reviews, no media uploads. But it DOES have:
- Public reviews (reviews collection, public read)
- Comments on reviews (auth-required create)
- Public lists (lists collection, public read if isPublic)
- Usernames (public lookup)
- Groups (token-join, member-scoped content)
- Tillsammans sessions (unlisted-link participation)

This prompt covers the Trust & Safety model appropriate for this scale,
plus the advanced privacy concerns (cookie consent, SDK consent timing,
data transfers) that are binding on EU web apps in 2025–2026.

**Cross-Prompt Boundaries**:
- GDPR service implementation (data export, account deletion) — covered in
  `02_SECURITY_AND_COMPLIANCE.md`. This prompt checks CONSENT SEQUENCING,
  cookie banner, UGC moderation — NOT the implementations themselves.
- Privacy policy / ToS / Community Guidelines DOCUMENT ACCURACY — covered
  in `11_LEGAL_REVIEW.md`. This prompt checks whether policies EXIST and
  are ACCESSIBLE; wording accuracy is 11's job.
- Dependency CVEs — covered in `05`.
- App store policies — N/A (web-only).
- This prompt owns: UGC moderation for reviews/comments/lists/groups,
  SDK consent sequencing, cookie consent banner, data transfer compliance,
  children's data protection, community guidelines enforcement.

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
Target market:       Swedish users (EU jurisdiction — GDPR applies)
Hosting:             Firebase Hosting + Cloudflare CDN

UGC surface:
  Reviews:     reviews/{reviewId} — public read, author write
               reviews/*/likes/{uid} — public read, owner toggle
               reviews/*/comments/{cid} — public read, author write,
                 review-owner or comment-author delete
  Lists:       lists/{listId} — public if isPublic, owner write
  Sessions:    sessions/{sessionId} — unlisted-link model, anyone can
               read/swipe with the link
  Groups:      groups/{groupId} — token-join, member-scoped watchlist
  Usernames:   usernames/{username} — public read (availability check)
  User profiles: users/{uid} — public read if isPublic
  Following:   users/{uid}/following/{targetUid} — public if isPublic

Third-party data processors:
  - Firebase / Google (Auth, Firestore, Hosting, Analytics if enabled) —
    GDPR DPA available from Google (standard)
  - TMDB API (themoviedb.org, US-based) — only recipe metadata
    traverses this boundary; user IDs / emails do NOT flow to TMDB
    (user only sends TMDB an API key + query params; TMDB returns data)
  - Cloudflare (CDN / DNS) — GDPR DPA available, EU data routing
  - GitHub (source + CI) — developer data, not user data
  - No other third parties observed

Compliance obligations:
  - GDPR (Sweden is an EU member state)
  - Swedish data protection: implementation of GDPR via
    Integritetsskyddsmyndigheten (IMY) — generally follows EU GDPR
    with minor national specifics
  - Children's data: GDPR Art. 8 — digital consent age in Sweden = 13
  - Cookie law (Swedish Lag om elektronisk kommunikation / LEK §6 kap 18§):
    explicit consent required for non-essential cookies

Current consent infrastructure (expected — VERIFY during investigation):
  - No cookie consent banner observed
  - No ConsentService / GDPR service implementations observed
  - No analytics SDK integrated currently (cross-ref 08) — so the consent
    gap is DORMANT until analytics is added
  - Firebase Auth uses IndexedDB (not cookies) for session persistence —
    not a GDPR cookie-banner trigger on its own

Generated file exclusions:
  .next/, node_modules/, out/, .firebase/
```

---

## Investigation Framework: 8 Dimensions (100 Points Total)

### Dimension 1: UGC Moderation Capability (18 points)

**Investigation Scope**: Does the app have infrastructure to handle
abusive, harmful, or inappropriate user-generated content?

**Specific Investigation Tasks:**

1. **Report Mechanism**
   ```
   Required for EU web apps with public UGC:
   - Can users report a review? a comment? a list? a username?
   - Is there a Firestore collection for reports
     (e.g., reports/{reportId})?
   - Is the report reason categorizable (spam, harassment, illegal content,
     copyright, impersonation)?
   - Is there an admin UI or just Firebase Console review?

   Search:
   - "report" / "flagga" in src/components/ (Swedish term for report)
   - Report-related Firestore rules (none observed in firestore.rules)
   - Any reporting UI on reviews / comments

   Expected state: NO reporting mechanism. Flag as HIGH.
   ```

2. **Block / Mute**
   ```
   Can a user:
   - Block another user (hide their reviews, comments, profile)?
   - Mute a user (stop following activity)?
   - Prevent unwanted friend requests (Binge has "following" — is it
     one-way or requiring acceptance)?

   Search:
   - "block" / "blockera" in src/
   - Block-related Firestore rules
   - Following flow: is it free (A follows B with no B-consent) or
     mutual-consent?
     (firestore.rules allows user to write own following → A can follow
     B without B's approval; fine for a "public fan" model, concerning
     if it exposes private watch data — but watchlist is only public
     if isPublic.)

   Expected state: NO block/mute. Flag as HIGH for EU deployment with UGC.
   ```

3. **Content Moderation Queue**
   ```
   For a 1-person indie app, formal moderation queue is overkill.
   But minimum:
   - Reports land in Firestore collection
   - Developer can view via Firebase Console
   - Developer can delete offending content (reviews/{reviewId},
     comments/{commentId}) — rules allow owner-delete but also need
     admin delete capability (e.g., rule allowing Firebase Admin SDK,
     or a special admin UID)

   Currently NO admin UID mechanism observed.
   ```

4. **Automated Moderation**
   ```
   For Swedish content:
   - Any profanity filter?
   - Length limits on review text, comment text, group name, list name?
   - Rate limiting on comment creation? (Firestore rules have no rate
     limiting at all)
   - Spam keyword list?

   Expected: none. For pre-launch indie, acceptable. Flag as MEDIUM
   (recommend before public launch).
   ```

5. **Content Type Inventory**
   ```
   Which UGC types can contain offensive content?
   - Review text: YES (free-text)
   - Review title: YES if exists
   - Comment text: YES
   - List name: YES
   - List description: YES if exists
   - Group name: YES
   - Username: YES (edge case: offensive username squatting)
   - Profile "about" / bio: YES if exists
   - Notes on watchlist items: YES (but private — self-only visibility)
   - Ratings: numbers; no text abuse vector

   Cross-reference each with:
   - Visibility (public / member / private)
   - Reportable? (currently no)
   - Length cap?
   - Moderated on input?
   ```

6. **Appeals**
   ```
   If content is removed by admin, is there a notification / appeal path?
   Not implemented. For pre-launch, OK. Document for eventual compliance.
   ```

**Files to audit:**
- src/components/title/ReviewList.tsx (any report UI?)
- firestore.rules (no report collection — confirm)
- src/app/grupper/, src/app/tillsammans/ (social surfaces)

**Output Required:**
- UGC moderation capability matrix (content-type × reportable × moderable)
- Missing features with severity
- Recommended minimum viable moderation for public launch

---

### Dimension 2: Cookie Consent & Tracking Transparency (20 points)

**Investigation Scope**: Does the app comply with EU cookie law and
prepare for future analytics/tracking?

**Specific Investigation Tasks:**

1. **Current Cookie Usage Inventory**
   ```
   What cookies / storage mechanisms does Binge currently use?

   Firebase Auth (JS SDK):
   - Default persistence: IndexedDB (NOT cookies)
   - Firebase sets NO cookies on its own in the browser SDK
   - BUT: auth iframe for sign-in flows can set cookies
     (verify by observing network requests during sign-in)

   Cloudflare:
   - __cf_bm (bot management) — necessary/functional cookie
   - __cflb (load balancing) — necessary
   - Optionally Cloudflare Analytics (edge-side, privacy-respecting,
     no cookies)
   - Cloudflare WARP / Zero Trust cookies — N/A for public site

   Firestore:
   - Uses IndexedDB for offline cache (not cookies)

   Local Storage / Session Storage:
   - React Query persister (if added — currently NOT)
   - Any custom app state? Grep for localStorage / sessionStorage
   ```

2. **Cookie Consent Banner**
   ```
   Legal requirement (EU + Swedish LEK §6 kap 18§):
   - Explicit consent required for ALL non-essential cookies / storage
   - "Essential" = strictly necessary for service (auth, cart, load
     balancing are typically essential)
   - "Non-essential" = analytics, marketing, personalization

   Currently NO banner observed. Risk level:
   - If ONLY essential cookies are used currently (Firebase Auth +
     Cloudflare functional): no banner strictly required, but best
     practice to have a privacy notice linking to the policy.
   - If analytics is added in Phase 2 (cross-ref 08): banner REQUIRED
     before analytics fires.

   Flag: MEDIUM now, HIGH when analytics ships.
   ```

3. **Consent Sequencing**
   ```
   When analytics / tracking SDKs are added, they MUST NOT fire before
   consent is granted.

   Investigate (forward-looking):
   - Where would Firebase Analytics be initialized?
     (Probably in src/lib/firebase/config.ts or src/components/Providers.tsx)
   - Does the init respect a consent flag? (Default state: opt-out / wait)
   - Race condition: can firebase/analytics auto-send page_view before
     consent check completes? YES by default — must pass
     setAnalyticsCollectionEnabled(false) on init and flip it only after
     consent.

   Without this, first page_view fires BEFORE consent = GDPR violation.
   ```

4. **Do Not Track / Global Privacy Control**
   ```
   Modern best practice: respect navigator.doNotTrack and GPC signal
   as auto-deny. Not legally required but expected by privacy-aware
   users in 2025+.
   ```

5. **Cookie Policy Document**
   ```
   - Is there a cookie policy page / section in the privacy policy?
   - If not, privacy policy must explicitly disclaim non-use or disclose
     specific cookies in use.
   - Cross-ref 11 Legal for document wording.
   ```

**Output Required:**
- Current cookie / storage inventory with classification (essential /
  non-essential)
- Consent banner gap assessment with urgency
- Analytics readiness for consent-gated introduction
- Do Not Track / GPC readiness
- Recommendations for Phase 2 (preferred banner library for Next.js:
  e.g., @privacysandbox/consent-js, cookieyes, cookiebot, or custom;
  Swedish-localized)

---

### Dimension 3: SDK Consent Sequencing (12 points)

**Investigation Scope**: Do any SDKs initialize or collect data before
the user has granted consent?

**Specific Investigation Tasks:**

1. **App Bootstrap Sequence**
   ```
   Read src/app/layout.tsx and src/components/Providers.tsx:
   - What order do the providers mount?
   - Which SDK is initialized first?

   Current stack (expected):
   - Firebase Auth (essential — no consent needed for auth)
   - Firestore (essential)
   - React Query (in-memory cache — essential)
   - Firebase Analytics: NOT ADDED — future concern
   - Any other SDK?

   Document timeline:
   1. App boot
   2. [SDK X init] — essential or consent-required?
   3. ...
   ```

2. **Essential vs Optional Classification**
   ```
   Essential (no consent needed under GDPR):
   - Firebase Auth (necessary for logged-in service)
   - Firestore (necessary for user data)
   - Cloudflare functional cookies
   - React Query cache (in-memory)

   Consent-required:
   - Firebase Analytics (when added)
   - Any advertising SDK (N/A)
   - Any third-party performance monitor that logs PII
   - Firebase Performance Monitoring (depending on data)
   - Sentry (if user emails / stack traces with PII are captured)
   ```

3. **Consent State Persistence**
   ```
   When consent is added:
   - Where is the consent state stored? (localStorage is common)
   - Is it checked on every app boot?
   - Re-consent on policy change? (version bump → re-prompt)
   - Cross-device sync? (For a Swedish consumer app, not required;
     localStorage per-device is acceptable.)
   ```

4. **Withdrawal Capability**
   ```
   GDPR requires easy consent withdrawal.
   - "Reset cookie preferences" link in footer / settings?
   - Withdrawal must be as easy as giving consent.
   ```

**Output Required:**
- SDK init timeline vs consent position
- Consent race condition inventory (currently dormant; will matter
  when analytics ships)
- Withdrawal capability assessment
- Recommended Phase 2 consent architecture

---

### Dimension 4: Data Transfer Compliance (12 points)

**Investigation Scope**: Are cross-border data transfers GDPR-compliant?

**Specific Investigation Tasks:**

1. **Third-Party Data Processor Inventory**
   ```
   Service         | Data Sent          | Location        | DPA      | Mechanism
   ----------------|--------------------|-----------------| ---------|------------------
   Firebase/Google | All user data      | EU (configurable)| Google   | SCCs + EU DPA
   TMDB API        | API key, query     | US              | No DPA    | User metadata only,
                   | params, no PII     |                 | observed  | no PII transferred
   Cloudflare      | HTTP traffic       | Global edge     | Cloudflare| SCCs + EU DPA
                   |                    |                 | DPA       |
   GitHub          | Source code        | US              | GitHub DPA| N/A (dev only)
   (If added)      |                    |                 |          |
   Firebase Analytics | User IDs, events| Google global   | Covered  | Covered
   ```

2. **Firebase Data Residency**
   ```
   Critical question: where is the Firestore database physically located?

   Default: projects created in 2020+ may be multi-region or regional.
   Binge's Firebase project (binge-nu) — check region.

   GDPR-safe options:
   - europe-west1 (Belgium)
   - europe-west3 (Frankfurt)
   - eur3 (multi-region EU)

   If the DB is in us-central1 or similar US region, EU user data
   transits to US — requires SCCs + transparency.

   Investigation: cannot verify from code; must check Firebase Console
   or ask the team. Document as UNVERIFIED + HIGH priority to check.
   ```

3. **Cloud Functions Region**
   ```
   None deployed currently. When added, deploy in europe-west1 or
   europe-west3 for GDPR hygiene.
   ```

4. **TMDB Data Flow**
   ```
   What user data flows to TMDB?
   - API key (from NEXT_PUBLIC_TMDB_API_KEY)
   - Search query strings (search text)
   - Title IDs being looked up

   What does NOT flow:
   - User email, name, ID
   - User's watchlist

   Privacy impact: LOW. The search query could theoretically contain
   PII if the user searches for their own name — but this is unlikely
   for a movie/TV search. No disclosure issue.

   TMDB's terms / privacy policy: review whether they claim any user
   data ownership or usage (cross-ref 11 Legal).
   ```

5. **Cloudflare Data**
   ```
   Cloudflare sees all HTTP traffic (as reverse proxy). Data includes:
   - IP addresses
   - User-Agent
   - Request paths (including tmdbId in URL — title being viewed is
     visible to Cloudflare, along with visitor IP)

   DPA: Cloudflare has a standard GDPR DPA. Ensure it's accepted at
   the account level. Regional data processing settings matter for EU
   residency.
   ```

**Output Required:**
- Data processor inventory with location + DPA status
- Firebase region verification required (UNVERIFIED flag)
- Transfer compliance mechanisms per service
- Overall transfer compliance rating

---

### Dimension 5: Privacy Policy & Legal Document Accessibility (10 points)

**Investigation Scope**: Do required legal documents exist and are they
accessible from the app?

**Specific Investigation Tasks:**

1. **Privacy Policy**
   ```
   Requirements:
   - Document exists (any format — web page, markdown, PDF)
   - Accessible from:
     a. Footer of the public landing page (pre-login)
     b. Settings / profile page (post-login)
     c. Sign-up form ("by signing up you agree to...")
   - Written in Swedish (primary audience) + optionally English
   - Last updated date visible
   - Version number or policy-version tracking

   Currently observed: no docs/legal/ directory, no legal markdown
   files, no /privacy route.

   FLAG AS HIGH: missing privacy policy blocks GDPR compliance.
   ```

2. **Terms of Service**
   ```
   Requirements:
   - Document exists
   - Age requirement stated (Swedish: 13 per GDPR Art. 8 national
     implementation)
   - Jurisdiction clause (Swedish law)
   - Account termination process
   - User-content ownership (user retains rights to their reviews,
     lists, notes)
   - Service-provider liability limitations
   - Accessible from sign-up flow

   Currently observed: none. FLAG AS HIGH.
   ```

3. **Community Guidelines**
   ```
   For UGC:
   - What's allowed / not allowed (harassment, spam, illegal content,
     copyright infringement, impersonation)
   - Reporting mechanism (cross-ref Dim 1)
   - Enforcement actions (warning, content removal, account suspension)
   - Accessible from UGC creation points (writing a review, creating
     a group)

   Currently observed: none. FLAG AS MEDIUM for current scale,
   HIGH at public launch.
   ```

4. **Legal Links in Footer / Sign-up**
   ```
   - Landing page footer: Privacy, Terms, Community Guidelines links?
   - Sign-up form: explicit acceptance checkbox + links?
   - Settings page: "Legal" section?

   Verify each surface.
   ```

5. **Acceptance Mechanism**
   ```
   - Click-wrap on sign-up (checkbox required + links)
   - Persisted acceptance (timestamp + document version in Firestore?)
   - Re-acceptance on policy update
   ```

**Output Required:**
- Legal document existence checklist
- Accessibility map (surface × reachable?)
- Acceptance mechanism audit
- Severity: HIGH per missing document

Cross-ref 11 Legal for wording accuracy.

---

### Dimension 6: Children's Data Protection (8 points)

**Investigation Scope**: Does the app comply with GDPR Article 8 (age of
digital consent)?

**Specific Investigation Tasks:**

1. **Age Verification**
   ```
   Swedish digital consent age: 13 (per Sweden's implementation of GDPR
   Art. 8).

   Check:
   - Is there an age gate on sign-up? (Birthdate or "confirm you are 13+")
   - What happens if user indicates < 13?
   - Is age persisted? (for audit, if challenged)

   Currently: no age gate observed. Flag as HIGH for public launch.
   ```

2. **Children's Content Exposure**
   ```
   Is Binge directed at children?
   - The Swedish market includes kids' streaming (SVT Barn),
     and some children enjoy tracking movies / TV.
   - The UI is generic (not overtly kid-targeted).
   - Social features (public reviews, public profiles) could be risky
     for minors.

   Recommendation: age gate at 13, restrict certain public features
   for users under 16 (e.g., no public reviews, no public profiles).
   ```

3. **COPPA**
   ```
   COPPA is US (children under 13). If Binge has any US users:
   - With age gate at 13, COPPA compliance is automatic (no under-13 users)
   - Without age gate, COPPA risk exists

   Sweden-focused launch makes this lower priority but not zero.
   ```

4. **Age Rating on Content**
   ```
   TMDB provides content ratings. Does Binge surface age-appropriateness
   for browsing users? Not required, but enhances family usability.
   ```

**Output Required:**
- Age verification implementation status
- Children's data risk assessment
- Recommended age-gate flow

---

### Dimension 7: Community Guidelines & Spam Prevention (10 points)

**Investigation Scope**: Are there community standards and spam prevention?

**Specific Investigation Tasks:**

1. **Community Guidelines Document**
   ```
   Cross-ref Dim 5. Also check:
   - Written in Swedish (primary audience)
   - Specific to Binge's features (not boilerplate)
   - Linked from UGC creation points
   ```

2. **Spam Prevention — Rate Limits**
   ```
   Firestore rules currently have NO rate limiting.

   Recommended:
   - Max X reviews per user per day (e.g., 10)
   - Max X comments per minute (e.g., 5)
   - Max X friend follows per day (e.g., 50)
   - Max X group creations per day (e.g., 10)

   Implementation: Firestore rules using request.time + timestamped
   user doc field (throttle), or Cloud Functions (not present).

   Currently: zero limits. Flag as MEDIUM now, HIGH at launch.
   ```

3. **Duplicate Content Detection**
   ```
   - Same review posted on the same title twice? (Prevent via userId +
     tmdbId unique key — likely already enforced by Firestore path)
   - Same comment posted rapidly?
   ```

4. **New Account Restrictions**
   ```
   Abuse pattern: spammers create accounts and immediately flood UGC.
   Recommend:
   - No posting public reviews until account is X hours old OR
     email-verified (Firebase Auth supports email verification)
   - No username changes in first 24h (prevent squatting turnover)
   ```

5. **Username Squatting**
   ```
   Firestore rules:
     usernames/{username} — public read, owner create/delete
   NO update rule (per 02 audit).

   Issue:
   - Create "binge_admin" + never delete → squat forever
   - Case sensitivity: "binge_admin" vs "Binge_admin" vs "BingeAdmin"
     are different keys → multi-squat the same identity

   Mitigations:
   - Normalize to lowercase client-side before create
   - Reserve common terms ("admin", "support", "binge") in code
   - Add scheduled cleanup for inactive usernames (Cloud Function —
     not present)
   ```

**Output Required:**
- Community guidelines existence + adequacy
- Spam prevention mechanism inventory (zero currently)
- Recommended rate limits for Firestore rules
- Username squatting risk assessment

---

### Dimension 8: Third-Party Script & Iframe Discipline (10 points)

**Investigation Scope**: Are there any third-party scripts or iframes
that could leak data?

**Specific Investigation Tasks:**

1. **Script Inventory**
   ```
   Search src/ for:
   - <script src="..."> with external URL
   - new Image() pixel tracking
   - fetch() to third-party analytics endpoints
   - next/script with src pointing outside

   Expected: zero external scripts (Binge is mostly self-contained).

   TMDB images via <img src="image.tmdb.org/..."> — these are resources,
   not scripts, but they DO expose visitor IP + User-Agent to TMDB.
   ```

2. **Iframe Usage**
   ```
   YouTube trailer embeds? (TMDB includes videos[] in title details —
   does Binge embed YouTube for trailers?)

   YouTube iframes:
   - youtube.com/embed/... — sets cookies, tracks users
   - youtube-nocookie.com/embed/... — no cookies until playback (preferred)

   Verify which is used (if any).
   ```

3. **Open-Graph / Social Sharing**
   ```
   - No Facebook / Twitter pixel expected
   - Share buttons: if present, are they custom (just copy URL) or third-
     party widgets (load scripts)?
   ```

4. **Image Referrer Policy**
   ```
   When <img src="https://image.tmdb.org/..."> is loaded, the browser
   sends a Referer header revealing the Binge page URL (e.g., /tv/12345)
   to TMDB.

   Mitigation: <meta name="referrer" content="no-referrer-when-downgrade"
   or "same-origin" or "strict-origin-when-cross-origin">
   Currently: default browser behavior (unknown without inspecting HTML).
   Cross-ref 02 for Referrer-Policy header.
   ```

5. **CSP Impact on Third-Party Content**
   ```
   When CSP is added (cross-ref 02), it must allowlist:
   - image.tmdb.org (img-src)
   - Firebase Auth domain
   - Firestore (wss:)
   - YouTube (if trailers embedded)
   ```

**Output Required:**
- External script inventory
- Iframe usage audit
- Image privacy assessment
- Referrer Policy recommendation

---

## Scoring Framework

| # | Dimension | Points | Scoring Guidance |
|---|-----------|--------|------------------|
| 1 | UGC Moderation Capability | /18 | 18: Report, block, rate limits, moderation queue. 9: Basic. 0: None. |
| 2 | Cookie Consent & Tracking | /20 | 20: Banner present, consent-gated, Swedish. 10: Documented. 0: No banner when analytics ships. |
| 3 | SDK Consent Sequencing | /12 | 12: All SDKs consent-gated, no race. 6: Essential only. 0: Race when analytics adds. |
| 4 | Data Transfer Compliance | /12 | 12: All processors documented + EU residency. 6: Partial. 0: Unknown transfers. |
| 5 | Privacy/ToS/CG Accessibility | /10 | 10: All three docs + accessible + Swedish. 5: Some. 0: Missing. |
| 6 | Children's Data Protection | /8 | 8: Age gate + social restrictions. 4: Age gate only. 0: None. |
| 7 | Community Guidelines & Spam | /10 | 10: CG + rate limits + no squatting. 5: CG. 0: None. |
| 8 | Third-Party Discipline | /10 | 10: Minimal third-parties, referrer-policy set. 5: Some. 0: Uncontrolled. |

---

## Output Format

### Executive Summary

```
BINGE TRUST, SAFETY & PRIVACY ANALYSIS — PHASE 1 FINDINGS
============================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Scope: UGC moderation, cookie consent, SDK sequencing, data transfers,
legal docs, children's data, community guidelines, third-party discipline

OVERALL SCORE: X/100
├── UGC Moderation Capability:             X/18 points
├── Cookie Consent & Tracking Transparency: X/20 points
├── SDK Consent Sequencing:                X/12 points
├── Data Transfer Compliance:              X/12 points
├── Privacy/ToS/CG Accessibility:           X/10 points
├── Children's Data Protection:             X/8 points
├── Community Guidelines & Spam:           X/10 points
└── Third-Party Script & Iframe Discipline: X/10 points

STATUS: [Launch-Safe | Attention Needed | Critical Gaps]

CRITICAL ISSUES: X found
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found

TOP 5 TRUST & SAFETY RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report Format

For each dimension: summary, issues by severity (file:line, impact, fix,
effort). Quick wins.

### Compliance Dashboard

```
| Requirement                    | Status        | Severity | Owner |
|--------------------------------|---------------|----------|-------|
| Privacy policy exists          | ...           | H/M/L    | ...   |
| Privacy policy accessible      | ...           | ...      | ...   |
| Terms of service exists        | ...           | ...      | ...   |
| Community guidelines           | ...           | ...      | ...   |
| Cookie consent (when needed)   | ...           | ...      | ...   |
| Report mechanism (UGC)         | ...           | ...      | ...   |
| Block mechanism                | ...           | ...      | ...   |
| Age gate                       | ...           | ...      | ...   |
| Firebase region verified EU    | UNVERIFIED    | H        | ...   |
| Data processor DPAs            | ...           | ...      | ...   |
| Referrer-Policy                | ...           | ...      | ...   |
```

### Phase 2 Preparation

Total issue counts by severity, remediation effort estimates.

---

## Investigation Execution Plan

### Stage 1: UGC Moderation Audit (1.5h)

```
- Inspect firestore.rules for report / block collections
- Search src/ for report / flagga / block UI
- Inventory UGC content types and visibility
- Check rate limits (expected: zero)
```

### Stage 2: Cookie Consent & SDK Audit (1h)

```
- Grep for cookie banners, consent libraries
- Inspect Providers.tsx for SDK init order
- Classify current storage: essential vs optional
- Document forward-looking SDK plans
```

### Stage 3: Legal Document Accessibility (1h)

```
- Check for /privacy, /terms, /community routes
- Check footer components
- Check sign-up form for acceptance mechanism
- Document missing surfaces
```

### Stage 4: Data Transfers & Children (1h)

```
- Third-party processor inventory
- Firebase region check (verify via Firebase Console or team)
- Age-gate audit on sign-up
```

### Stage 5: Community Guidelines & Third-Parties (1h)

```
- CG document presence
- Spam prevention rate limits
- External script / iframe inventory
- Referrer-Policy check
```

### Stage 6: Report Compilation (1h)

Compile findings into structured report.

**Total: 6–7 hours**

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score
- [ ] Detailed findings for all 8 dimensions with file:line references
- [ ] Issue classification (Critical/High/Medium/Low) with counts + effort
- [ ] UGC moderation capability matrix
- [ ] Current cookie / storage inventory + classification
- [ ] SDK init sequence vs consent
- [ ] Data processor inventory with DPA + region status
- [ ] Legal document accessibility map
- [ ] Age gate status
- [ ] Spam prevention mechanism inventory
- [ ] Third-party script / iframe audit
- [ ] Compliance dashboard
- [ ] Phase 2 preparation section

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX**
2. **PRE-LAUNCH CONTEXT** — some gaps are acceptable now but become
   CRITICAL at public launch. Classify accordingly with timelines.
3. **EU / SWEDISH FOCUS** — GDPR and Swedish LEK apply. Other jurisdictions
   (COPPA, CCPA) are secondary considerations.
4. **DORMANT vs ACTIVE RISK** — consent gaps are dormant until analytics
   ships. Flag the ship-date dependency clearly.
5. **NO GDPR SERVICE IMPLEMENTATION DUPLICATION** — this prompt checks
   CONSENT SEQUENCING and MODERATION; 02 owns ConsentService /
   DataExport / AccountDeletion code.
6. **NO LEGAL WORDING VERDICTS** — 11 Legal owns document wording accuracy.
   This prompt checks document PRESENCE and ACCESSIBILITY.
7. **ZERO CODE CHANGES** — investigation and documentation only.
8. **REALISTIC SEVERITY** — Binge is a pre-launch indie web app with
   limited UGC. Don't demand enterprise moderation infrastructure;
   prioritize foundations (privacy policy, age gate, reporting, basic
   rate limits) over advanced controls (automated toxicity scoring,
   human moderation queue).
