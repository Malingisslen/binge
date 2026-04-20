# Legal Review — Juridisk Granskning

**Analyst:** Claude (Opus 4.7)
**Mission:** Systematisk granskning av Binges juridiska dokument,
licensefterlevnad och regulatorisk status. Identifiera diskrepanser
mellan vad juridiska dokument påstår (om de finns) och vad koden
faktiskt gör.
**Scope:** Legal document accuracy, license compliance, TMDB attribution
compliance, regulatory alignment (GDPR, Swedish LEK, EU AI Act N/A),
discrepancy detection.

**Du är inte jurist och ger inte juridisk rådgivning** — du är en
systematisk granskare som identifierar potentiella legala risker och
flaggar dem för vidare utredning.

**Cross-Prompt Boundaries:**
- GDPR service implementation (ConsentService etc.): covered in
  `02_SECURITY_AND_COMPLIANCE.md` — skip implementation review here.
  This prompt checks whether legal documents accurately describe those
  implementations.
- Dependency CVEs and supply chain security: covered in
  `05_DEPENDENCIES_AND_SUPPLY_CHAIN.md` — skip here. This prompt checks
  LICENSE COMPLIANCE only.
- UGC moderation, cookie consent implementation, privacy-policy
  accessibility from the UI: covered in `09_TRUST_SAFETY_AND_PRIVACY.md`
  — skip implementation here. This prompt checks DOCUMENT ACCURACY.
- Competitive positioning, TMDB terms of service fit: partly covered
  in `10_MONETIZATION_AND_COMPETITIVE_POSITIONING.md`.
- This prompt owns: legal document vs code discrepancies, third-party
  processor accuracy, license file bundling, TMDB attribution accuracy,
  provider brand/pricing claims, regulatory text accuracy, and consent
  purpose vs implementation alignment.

---

## Two-Phase Approach

### Phase 1: Investigation & Documentation (THIS PHASE)

**CRITICAL**: Document everything, change nothing.
- Cross-reference every claim in legal documents (if any exist) against
  actual code
- Document findings with file:line references
- Classify issues by severity (Critical/High/Medium/Low)
- Provide effort estimates for each issue
- **ZERO code changes made**
- **ZERO files created or modified**
- Output: Complete findings report ready for Phase 2 remediation

### Phase 2: Remediation Plan (AFTER Phase 1 Complete)

- Review ALL Phase 1 findings together
- Prioritize: legal doc fixes (fast) vs code fixes (slower) vs external
  actions (DPAs, store declarations)
- Group related issues for efficient batch fixing
- Create sequenced remediation plan
- Separate into: "can fix today" (doc edits) vs "needs decision"
  (regulatory choices) vs "needs external action" (DPAs)

**DO NOT START PHASE 2 UNTIL PHASE 1 IS COMPLETE**

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), client-side SPA, TypeScript
Architecture:        Next.js App Router — Views (pages) → hooks →
                     React Query / Firebase SDK → Firestore / TMDB
Hosting:             Firebase Hosting + Cloudflare CDN
Deployment region:   UNVERIFIED — Firebase project region must be checked
                     (cross-ref 09 Dim 4)

Primary market:      Sweden (Swedish UI is the only language)
Monetization:        None (pre-monetization)
Social features:     Reviews, comments, lists, groups, Tillsammans sessions,
                     following / followers

Third-party data processors (actual or potential):
  - Firebase / Google: Auth, Firestore, Hosting, (potentially) Analytics
  - TMDB (US-based): movie/TV metadata, no PII transferred
  - Cloudflare: CDN, DNS, potentially Cloudflare Analytics
  - GitHub: source code + CI (no end-user data)
  - (If added) email provider, payment provider, error tracker —
    not currently integrated

NO LLM / AI integration:
  - No Mistral / OpenAI / Gemini / Claude API in client or dependencies
  - No prompt engineering concerns
  - No EU AI Act transparency obligations beyond "not applicable"

Legal documents — current state:
  - NO /privacy route or privacy policy document observed in src/ or /public
  - NO /terms route or terms of service document observed
  - NO /community-guidelines document observed
  - NO /legal directory

CLAUDE.md declares (line 58):
  "Attribution required: 'This product uses the TMDB API but is not
  endorsed or certified by TMDB'"

TMDB attribution text — current placement:
  - UNKNOWN (must be verified in UI)
  - Expected surfaces: footer, about page, settings, api-info section

Bundled asset licensing:
  - Fonts: system-ui stack (no webfonts) — no license obligations
  - Icons: lucide-react (ISC license — per npm registry)
  - Illustrations: mockups/ contains HTML only, no illustrations
    observed in /public
  - No audio, video, or third-party creative assets observed

Firestore project:
  Project ID: binge-nu
  Region: UNVERIFIED (must check Firebase Console or .firebaserc;
  .firebaserc only has project ID, not region)

Generated file exclusions:
  .next/, node_modules/, out/, .firebase/
```

---

## Investigation Framework: 8 Dimensions

### Dimension 1: Privacy Policy Presence & Accuracy (25 points)

**Investigation Scope:** Does a privacy policy exist? If yes, does it
accurately describe what the app does?

**Specific Investigation Tasks:**

1. **Privacy Policy Existence Check**
   ```
   Search for:
   - /public/privacy*, /public/legal/*
   - docs/legal/privacy*, docs/privacy*
   - src/app/privacy/page.tsx
   - src/components/*Privacy*

   Expected state: DOES NOT EXIST.

   If missing:
   - CRITICAL finding for a Swedish consumer web app under GDPR
   - Even with essential-only cookies, privacy notice is required
   - Blocks public launch
   ```

2. **If Policy Exists — Accuracy Audit**
   ```
   For every factual claim in the privacy policy, verify against code.

   Required claims to verify:

   a. **Data controller identity**
      - Who is the data controller? (The developer / the company behind
        Binge — name, email, organizational number if applicable)
      - Is contact info provided (required under GDPR Art. 13)?

   b. **Data collected**
      - What personal data is collected? Cross-reference with actual
        Firestore fields:
          users/{uid}: email (from Firebase Auth), displayName, username,
            myProviders, providerCosts, providerPauses, isPublic,
            notification settings
          reviews: uid (author), text, rating, tmdbId
          comments: uid (author), text
          lists: uid (owner), name, items
          groups: ownerUid, memberUids, name
          sessions: hostUid, participants
          notifications: recipient uid, content
          following / followers: uid pairs
      - Does the policy omit any of these? → omission flag
      - Does the policy claim data NOT actually collected? → overclaim flag

   c. **Third-party data processors**
      Required list:
        - Google Firebase (Auth, Firestore, Hosting)
        - TMDB (themoviedb.org) — but ONLY metadata queries, no user PII
        - Cloudflare (CDN, DNS)
      If analytics is added:
        - Firebase Analytics / Google Analytics
      If payment is added:
        - Stripe / Paddle / whichever

      Verify every listed processor is actually used; verify every actual
      processor is listed.

   d. **Legal basis for each processing activity**
      Under GDPR Art. 6:
        - Contract: auth, watchlist storage (service delivery)
        - Legitimate interest: debugging via logs
        - Consent: analytics (when added), marketing communications
        - Legal obligation: accounting records if monetized

   e. **Data retention**
      - How long is user data kept?
      - Does the document claim a specific retention period?
      - Does the code enforce that retention? (e.g., old notification
        cleanup, inactive account deletion after X years)
      - Currently: no automatic retention enforcement. If policy claims
        one, flag as discrepancy.

   f. **Data subject rights**
      - Access (Art. 15): mechanism?
      - Portability (Art. 20): export mechanism?
      - Erasure (Art. 17): account deletion?
      - Rectification (Art. 16): profile edit?
      - Objection (Art. 21): opt-out?
      - Complaint: must name Integritetsskyddsmyndigheten (IMY) as the
        Swedish supervisory authority

   g. **Data transfers outside EU**
      - TMDB: US-based — how is transfer justified? (No PII transferred
        to TMDB — so arguably not a "transfer of personal data" under
        GDPR strict reading)
      - Firebase: if project is in EU region, no transfer; if US,
        requires SCCs (Google provides)
      - Cloudflare: global edge network, DPA addresses transfers

   h. **Cookies / storage**
      - What does the app store in browser?
      - IndexedDB (Firebase Auth, Firestore offline)
      - localStorage (React Query persister if added — not currently)
      - Cookies: any?
      - Policy must accurately describe ACTUAL storage used

   i. **Children's data**
      - Minimum age: should state 13 (Swedish GDPR Art. 8 implementation)

   j. **Policy version & last-updated date**
      - Is a date present?
      - Versioning strategy for re-consent?
   ```

3. **Bilingual Consistency**
   ```
   If Swedish + English versions exist:
   - Same sections, same claims, same processor list
   - No Swedish-only or English-only provisions
   - Same version / date
   - Swedish is primary (it's the UI language)

   If only Swedish: that's acceptable for a Swedish-only app. Note
   that English fallback is good for future international expansion.
   ```

**Output Required:**
- Policy existence verdict (EXISTS / MISSING — CRITICAL if missing)
- If exists: processor accuracy matrix (policy claim vs code reality)
- If exists: data collection completeness
- If exists: retention period accuracy
- If exists: bilingual consistency
- If missing: launch-blocker severity + draft scope recommendation

---

### Dimension 2: Terms of Service & Community Guidelines (12 points)

**Investigation Scope:** Do ToS and community guidelines exist and are
they adequate for Binge's social features?

**Specific Investigation Tasks:**

1. **Terms of Service Existence**
   ```
   Search (expected: missing):
   - /public/terms*, /public/legal/terms*
   - src/app/terms/page.tsx
   - docs/legal/terms*

   If missing: CRITICAL for public launch, especially with UGC.
   ```

2. **ToS Content Requirements (if exists or planned)**
   ```
   Must address:
   - Age requirement (13+ per Swedish GDPR Art. 8 implementation)
   - Jurisdiction (Swedish law, Swedish courts)
   - Account termination conditions
   - User content ownership (user retains rights to reviews, lists,
     notes)
   - License grant to Binge (non-exclusive right to display, distribute
     per service operation)
   - Prohibited uses (abuse, scraping, unauthorized automation)
   - Service availability disclaimer (no uptime guarantee for free tier)
   - Liability limitations
   - Change of terms process (notice period, continued use = acceptance)
   - TMDB attribution (required by TMDB ToS, see Dim 5)
   - Contact information for legal notices
   ```

3. **Community Guidelines**
   ```
   For UGC surfaces (reviews, comments, lists, group names, profiles):

   Must address:
   - What is allowed (personal opinions, ratings, recommendations)
   - What is not allowed:
     * Harassment, hate speech
     * Spam, scams
     * Copyright infringement
     * Impersonation
     * Doxxing / personal information of others
     * Illegal content under Swedish law
   - Reporting mechanism (cross-ref 09 Dim 1 — currently: missing)
   - Enforcement actions
   - Appeal process
   - Swedish-language primary

   Currently: MISSING. Flag as HIGH for public launch.
   ```

4. **Acceptance Mechanism**
   ```
   At sign-up:
   - Click-wrap with checkbox ("I agree to Terms and Privacy Policy")
   - Links to documents
   - Timestamp persisted in user doc (termsAcceptedAt, privacyAcceptedAt,
     termsVersion, privacyVersion)
   - Re-acceptance on policy changes

   Currently: verify sign-up UI (src/app/login/page.tsx or similar).
   Expected: checkbox mechanism is missing.
   ```

5. **Accessibility from UI**
   ```
   Legal documents must be reachable:
   - From the sign-up form (before account creation)
   - From the settings page (after login)
   - From the public landing page footer
   - From UGC creation points (writing a review → "by posting you
     agree to the community guidelines")

   Verify presence in UI components.
   ```

**Output Required:**
- ToS existence verdict
- Community Guidelines existence verdict
- Content adequacy (if exists)
- Acceptance mechanism audit
- UI accessibility map

---

### Dimension 3: TMDB Attribution & Terms Compliance (15 points)

**Investigation Scope:** Does Binge comply with TMDB's API Terms of Use?

This is CRITICAL. TMDB's API is free BUT comes with specific attribution
and branding requirements. Non-compliance can result in API key revocation
and Binge shutdown.

**Specific Investigation Tasks:**

1. **Required Attribution Text**
   ```
   TMDB requires:
     "This product uses the TMDB API but is not endorsed or certified
     by TMDB."

   CLAUDE.md confirms this text is required (line 58).

   Search in src/ for this text (exact match + Swedish translation):
   - "TMDB API" → should appear in attribution
   - "TMDB" → logo and name usage
   - "themoviedb" / "The Movie Database"

   Swedish translation acceptable if meaning preserved, e.g.:
   "Denna produkt använder TMDB API men är inte godkänd eller
   certifierad av TMDB."

   Currently expected: must verify in UI. If absent, HIGH severity
   (TMDB terms violation).
   ```

2. **TMDB Logo Usage**
   ```
   TMDB requires their logo to be displayed alongside the attribution.

   Logo source: https://www.themoviedb.org/about/logos-attribution
   (provided in two color variants)

   Check /public/ for tmdb-logo.* or similar files.
   Check CSS / components for references.

   If absent: MEDIUM severity (TMDB may not enforce for small apps,
   but compliance is required).
   ```

3. **Attribution Placement**
   ```
   Attribution should be:
   - In the footer of the main app (visible without login), OR
   - On a dedicated "About" / "Credits" page linked from settings / footer

   Must be clearly visible — not hidden in small gray text at the
   bottom of a deep sub-page.

   Verify placement and visibility.
   ```

4. **Content Usage Compliance**
   ```
   TMDB ToS requirements:
   - No caching of TMDB data beyond reasonable TTLs
     (Binge caches in Firestore as cachedMetadata on watchlist items —
     is this a ToS violation? Review TMDB terms.)
     TMDB ToS typically allow short-term caching for performance;
     indefinite storage may require separate agreement.
   - No redistribution of TMDB data
     (Binge's public reviews show titles — is that redistribution?
     Probably OK since it's user-generated content about titles, not
     raw TMDB data redistribution.)
   - Commercial use: TMDB v3 API keys are for non-commercial by default;
     commercial use requires different tier or separate agreement.
     Is Binge monetized? NOT YET — but if premium tier ships, review
     TMDB commercial tier requirements.
   ```

5. **Poster / Image Usage**
   ```
   Images served from image.tmdb.org:
   - TMDB allows embedding via img src; no download-and-rehost
   - Verify: grep for TMDB images being downloaded or stored locally
     (expected: zero; all images via image.tmdb.org URLs)
   - Any violation: HIGH severity
   ```

6. **API Key Compliance**
   ```
   NEXT_PUBLIC_TMDB_API_KEY is a v3 API key (exposed client-side).
   TMDB's documented stance: v3 keys can be embedded client-side;
   v4 tokens are for server-side use and should NOT be exposed.

   Verify:
   - Binge uses v3 (confirmed: 'api_key' query param, not Bearer token)
   - No v4 read-access-token leakage (CLAUDE.md declares
     TMDB_API_READ_ACCESS_TOKEN as server-only; verify no client usage)

   Cross-ref 02 Dim 4 for the broader security analysis.
   ```

**Output Required:**
- TMDB attribution presence + exact text verification
- TMDB logo placement audit
- Attribution placement and visibility assessment
- Content caching / redistribution review
- API key version compliance
- Overall TMDB ToS compliance score (pass / partial / fail)

---

### Dimension 4: License Compliance — Dependencies, Fonts, Assets (12 points)

**Investigation Scope:** Are all third-party libraries, fonts, and assets
properly licensed?

**Specific Investigation Tasks:**

1. **npm Dependency Licenses**
   ```
   Cross-ref 05 (Dim 3) for full license matrix. This prompt focuses on:

   Direct dependencies (from package.json):
   - @tanstack/react-query (MIT)
   - clsx (MIT)
   - firebase (Apache-2.0)
   - lucide-react (ISC)
   - next (MIT)
   - react, react-dom (MIT)
   - tailwind-merge (MIT)

   Verify each license via `npm view <pkg> license`.

   Attribution obligations:
   - Apache-2.0 (firebase): requires NOTICE file in distribution
   - MIT / ISC: copyright preservation, typically satisfied by bundler
     preserving license banners

   Open-source license page:
   - Does Binge have an "Open source licenses" page? (Similar to
     mobile apps' license screen)
   - Not required by all licenses, but industry best practice
   - Currently expected: absent

   For Phase 2: auto-generate via license-checker or similar.
   ```

2. **Font Licenses**
   ```
   Fonts used (per globals.css):
     system-ui, -apple-system, "Segoe UI", sans-serif

   These are all OS-provided system fonts:
   - system-ui / sans-serif: browser fallback (no license obligation)
   - -apple-system: Apple system font (San Francisco); can be referenced,
     not redistributed (we're not redistributing)
   - "Segoe UI": Microsoft system font; browser-referenced, not
     redistributed

   Conclusion: NO font license obligations. PASS.

   If webfonts are added later: verify each (Google Fonts — OFL, Adobe —
   per subscription, self-hosted — per source).
   ```

3. **Icon Licenses**
   ```
   lucide-react: ISC license (per npm).
   Some Lucide icons derived from Feather Icons (also ISC/MIT).

   Compliance: ISC allows use with attribution preserved (typically in
   npm package metadata).

   No additional action needed for standard use.
   ```

4. **Illustration & Image Licenses**
   ```
   /public/ contains:
   - robots.txt
   - sitemap.xml
   - (potentially images — verify with ls /public/)

   mockups/ contains HTML files (design reference); not shipped to users.

   If any custom illustrations are added:
   - Original work: Binge-owned ✓
   - Stock: must have commercial license
   - AI-generated: ToS of generator + ownership question (varies by
     generator and jurisdiction)
   ```

5. **Provider Brand Logos**
   ```
   SwedishProvider.color in providers.ts stores brand colors.
   Is a logo image per provider used anywhere?

   TMDB provides provider logos via their API. Using those via TMDB
   URLs is covered under TMDB ToS (cross-ref Dim 3).

   If provider logos are hosted separately (in /public/providers/):
   - Each provider's brand guidelines must be respected
   - Use of brand logos for referring to the service (nominative fair
     use) is generally OK, but brand-guideline-compliant sizing +
     color + clear space matters
   - Not a legal risk at Binge's scale, but documentable
   ```

6. **User-Generated Content Ownership**
   ```
   Reviews, notes, lists, group names are authored by users.

   Terms must state:
   - User retains ownership
   - User grants Binge a non-exclusive license to display, distribute,
     and process for service operation
   - Scope is limited to running the service
   - Withdrawal of license upon account deletion (cross-ref data erasure)
   ```

**Output Required:**
- Dependency license inventory with attribution status
- Font license status (confirmed safe: system fonts)
- Icon license status (ISC — safe)
- Asset provenance audit
- Open-source-licenses-page recommendation
- UGC license-grant wording in ToS

---

### Dimension 5: Provider Data & Pricing Accuracy Claims (8 points)

**Investigation Scope:** Does Binge make accurate claims about Swedish
streaming providers and their pricing?

**Specific Investigation Tasks:**

1. **Provider Pricing Claims**
   ```
   src/lib/tmdb/providers.ts hard-codes monthly costs for 19 providers.

   If Binge displays these prices in the UI (advisor, settings, etc.),
   they are claims about third-party businesses. Inaccurate claims could:
   - Mislead users (consumer protection concern)
   - Draw complaint from the provider (trademark / brand misuse —
     unlikely but possible)

   Currently:
   - Prices are hand-maintained (not live)
   - Last-verified date: unknown (no timestamp comment in code)

   Mitigations:
   - Disclaimer: "Prices may be outdated. See provider for current pricing."
     (Verify presence in UI)
   - Hyperlinks to provider websites (verify)
   - Periodic review schedule (internal process, not code — document)

   Cross-ref 07 Dim 2 for the provider catalog audit; this dimension
   is specifically about the LEGAL implications of stale prices.
   ```

2. **Savings Claims**
   ```
   The advisor calculates potential savings. If it tells a user
   "You could save 149 SEK/month by pausing Netflix for 2 months",
   this is a factual claim based on:
   - User's stated tier selection
   - Binge's tier price catalog
   - User's stated usage

   If any input is wrong, the savings claim is wrong.

   Legal risk: LOW in practice. Consumers rarely sue over
   advisory-tool inaccuracy. But:
   - Good practice: "Estimated savings, based on your inputs"
   - Cross-ref 06 UX for disclaimer phrasing
   ```

3. **Brand / Trademark Usage**
   ```
   Binge references provider names + brand colors.
   - Names: nominative fair use (referring to the service by name) — legal
   - Colors: fact (sourced from brand guidelines) — legal
   - Logos: if used, must respect brand guidelines; currently no
     provider logos in /public/ — OK
   - "Disney+" vs "Disney Plus" — use brand-official
   ```

**Output Required:**
- Pricing disclaimer presence audit
- Provider hyperlink presence
- Pricing freshness documentation
- Savings-claim language audit
- Trademark use audit

---

### Dimension 6: Consent Purpose vs Implementation Alignment (10 points)

**Investigation Scope:** When consent infrastructure is added, does each
consent purpose map to a real data processing activity, and vice versa?

**Specific Investigation Tasks:**

1. **Current Consent Schema**
   ```
   Currently: NO ConsentService / user_consent model observed.

   When added (Phase 2), proposed purposes:
   - essential: required for service (auth, Firestore) — always true,
     no opt-out
   - functional: preferences persistence — always true, no opt-out
   - analytics: Firebase Analytics events — opt-in
   - marketing: future email campaigns — opt-in
   - socialFeatures: follows, public profiles — opt-in (or implicit
     via isPublic toggle)
   - personalization: taste vector, recommendations — opt-in or
     always-on-with-transparency

   For each purpose:
   - What code path does it gate?
   - Is the gate enforced?
   - Is the purpose described accurately in the consent UI?
   - Is the purpose described accurately in the privacy policy?
   ```

2. **Purpose-to-Implementation Mapping (Phase 2 plan)**
   ```
   When implementing:

   essential:
   - Gates: AuthContext init, Firestore listeners for own data
   - Never togglable
   - Legal basis: contract (Art. 6(1)(b))

   analytics (when added):
   - Gates: firebase/analytics initialization and event logging
   - Togglable
   - Legal basis: consent (Art. 6(1)(a))

   socialFeatures:
   - Gates: public profile reads / writes, reviews visibility
   - Togglable via isPublic flag
   - Legal basis: consent

   personalization:
   - Gates: taste vector pipeline
   - Togglable
   - Legal basis: consent or legitimate interest
   ```

3. **Orphaned Purposes**
   ```
   Any consent purpose without a corresponding code path = orphaned.
   Any feature without a consent check = gap.

   When Phase 2 adds consent, audit both directions.
   ```

**Output Required:**
- Current consent infrastructure status (likely: none)
- Proposed consent schema for Phase 2
- Purpose-to-implementation mapping table (Phase 2 planning)

---

### Dimension 7: Firebase & Hosting Legal Compliance (10 points)

**Investigation Scope:** Do Firebase and Cloudflare configurations meet
legal / regulatory requirements?

Note: Detailed Firebase rules security audit is in 02. This dimension
covers legally-relevant configuration gaps only.

**Specific Investigation Tasks:**

1. **Data Residency**
   ```
   Firestore region: UNVERIFIED.

   Check:
   - .firebaserc — has project ID but no region info
   - Firebase Console → Firestore settings — shows region

   Acceptable for Swedish users under GDPR:
   - europe-west1 (Belgium)
   - europe-west3 (Frankfurt)
   - europe-west4 (Netherlands)
   - eur3 (multi-region EU)

   Not preferred (requires SCCs for EU user data):
   - us-central1
   - us-east1
   - asia-*

   If US region, flag as HIGH — requires:
   - SCCs (Google provides in Firebase DPA)
   - Transparency in privacy policy

   Recommendation: set EU region before public launch if not already.
   ```

2. **Firebase DPA Acceptance**
   ```
   Google Cloud includes a DPA by default for GDPR customers.
   Verify: the developer has accepted the GCP / Firebase DPA at the
   project / organization level. (Visible in GCP Console).

   Cannot verify from code; document as "required external action".
   ```

3. **Cloudflare DPA**
   ```
   Cloudflare offers a GDPR DPA.
   Verify: developer has accepted Cloudflare DPA. (Visible in
   Cloudflare dashboard).

   Cannot verify from code; document as "required external action".
   ```

4. **Firebase Hosting Security Headers**
   ```
   firebase.json has NO headers block (per 02 audit).

   Missing headers:
   - Content-Security-Policy (not strictly legal requirement but
     expected for regulated data)
   - Strict-Transport-Security
   - X-Frame-Options / frame-ancestors
   - Referrer-Policy
   - Permissions-Policy

   Cross-ref 02 Dim 5 for full list.

   Legal impact: missing headers don't directly violate GDPR but
   reduce defense-in-depth. Adequate to flag as MEDIUM for launch.
   ```

5. **Cookies Behavior Documentation**
   ```
   If cookies are set by Cloudflare / Firebase / future analytics,
   the privacy policy must document them by name and purpose.

   Currently:
   - __cf_bm (Cloudflare, bot management, necessary)
   - __cflb (Cloudflare, load balancing, necessary)
   - Firebase Auth iframe cookies (if sign-in flow triggers them)
   - Future: _ga / _ga_* (Firebase Analytics)

   Document each with name + purpose + retention in policy.
   ```

**Output Required:**
- Firebase region verification (UNVERIFIED — must check externally)
- DPA acceptance status (external action required)
- Security headers audit (deferred to 02)
- Cookies inventory + documentation requirements

---

### Dimension 8: Account Lifecycle & Data Erasure Compliance (8 points)

**Investigation Scope:** Does the account lifecycle support legal
obligations for data control?

**Specific Investigation Tasks:**

1. **Account Deletion Mechanism**
   ```
   Is there a "Delete account" button in settings?

   If yes:
   - Does it delete from Firestore AND Firebase Auth?
   - Cascade through all user collections:
     * users/{uid} — the profile
     * users/{uid}/watchlist, episodeProgress, notifications,
       following, followers
     * reviews by this user (orphan? delete? anonymize?)
     * comments by this user (same question)
     * lists by this user
     * groups they own (transfer? delete?)
     * follower records on OTHER users' /followers collections
   - Firebase Auth user deletion (separate call)

   If missing: GDPR Art. 17 violation risk. Flag as HIGH.
   ```

2. **Data Export Mechanism (Portability)**
   ```
   GDPR Art. 20: right to portability. User must be able to request
   their data in a machine-readable format (JSON acceptable).

   Currently: no DataExportService observed. Flag as HIGH for Swedish
   consumer app.
   ```

3. **Anonymization vs Deletion**
   ```
   Public content (reviews, comments, lists) presents a dilemma:
   - Delete on account deletion: removes public content (user's reviews
     vanish from other users' watchlists)
   - Anonymize on account deletion: replace uid with "deleted_user",
     keep content (other users' context preserved)

   Document chosen policy and ensure it matches code behavior + privacy
   policy description.
   ```

4. **Inactive Account Policy**
   ```
   GDPR data minimization: data should not be kept longer than needed.

   Options:
   - Keep indefinitely (simple, but "needed" questionable)
   - Delete after 2–3 years of inactivity (with warning email)
   - Anonymize after 2 years (keep stats, remove PII)

   Currently: no inactive-account cleanup. Document Phase 2 policy.
   ```

**Output Required:**
- Account deletion mechanism audit (currently expected: missing)
- Data export mechanism audit (missing)
- Anonymization-vs-deletion policy status
- Inactive account policy recommendation
- Severity: HIGH per missing feature

---

## Scoring Framework

| # | Dimension | Points | Scoring Guidance |
|---|-----------|--------|------------------|
| 1 | Privacy Policy Presence & Accuracy | /25 | 25: Present, accurate, bilingual, accessible. 12: Present with gaps. 0: Missing (CRITICAL). |
| 2 | ToS & Community Guidelines | /12 | 12: All present, accurate, accessible. 6: Minor gaps. 0: Missing. |
| 3 | TMDB Attribution & Terms | /15 | 15: Attribution text present, logo, compliance. 7: Partial. 0: Missing (TMDB ToS risk). |
| 4 | License Compliance | /12 | 12: All licenses verified + licenses page. 6: Minor gaps. 0: GPL/AGPL / unattributed. |
| 5 | Provider Data & Pricing Accuracy | /8 | 8: Disclaimer + links + freshness process. 4: Partial. 0: Stale claims, no disclaimer. |
| 6 | Consent Purpose Alignment | /10 | 10: Purposes mapped, enforced, documented. 5: Partial (Phase 2). 0: N/A pre-consent. |
| 7 | Firebase & Hosting Compliance | /10 | 10: EU region verified + DPAs + headers. 5: Partial. 0: Misconfigured. |
| 8 | Account Lifecycle & Erasure | /8 | 8: Delete + export + cascade correct. 4: Delete only. 0: Missing. |

---

## Output Format

### Executive Summary

```
BINGE LEGAL REVIEW — PHASE 1 FINDINGS
========================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Scope: Legal document accuracy, license compliance, TMDB attribution,
regulatory alignment

OVERALL SCORE: X/100
├── Privacy Policy Presence & Accuracy:     X/25 points
├── ToS & Community Guidelines:             X/12 points
├── TMDB Attribution & Terms Compliance:    X/15 points
├── License Compliance:                     X/12 points
├── Provider Data & Pricing Accuracy:        X/8 points
├── Consent Purpose Alignment:              X/10 points
├── Firebase & Hosting Compliance:          X/10 points
└── Account Lifecycle & Erasure:             X/8 points

STATUS: [Compliant | Gaps Found | Critical Discrepancies]

CRITICAL ISSUES: X found  (typically: missing docs, TMDB attribution gap,
                           missing account deletion)
HIGH PRIORITY:   X found
MEDIUM PRIORITY: X found
LOW PRIORITY:    X found

TOP 5 LEGAL RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### Per-Dimension Report Format

For each dimension:
- Summary (2–3 sentences)
- Issues grouped by CRITICAL / HIGH / MEDIUM / LOW
- Each issue: description, file:line reference (code side + doc side),
  legal risk, suggested fix, effort estimate
- Recommendations and quick wins

### Legal Document Accuracy Dashboard

```
| Claim in Legal Doc | File:Line | Code Reality | Match? | Severity |
|--------------------|-----------|--------------|--------|----------|
| [When docs exist, populate]
| TMDB attribution text | ? | CLAUDE.md requires X | ? | H |
| Data controller identity | ? | ? | ? | ? |
| Firebase data residency | ? | UNVERIFIED | ? | H |
| ...
```

### Master Checklist

```
LEGAL REVIEW CHECKLIST
======================

PRIVACY POLICY
[ ] Privacy policy document exists (Swedish, optionally English)
[ ] Data controller identity present
[ ] Data collected list matches actual code
[ ] Third-party processors listed and accurate
[ ] Legal basis for each processing activity
[ ] Data retention periods stated and enforced
[ ] Data subject rights mechanism described
[ ] Data transfer basis (Firebase region, TMDB, Cloudflare)
[ ] Cookie / storage usage described
[ ] Minimum age stated (13)
[ ] Policy version + last-updated date
[ ] IMY (Swedish supervisory authority) named
[ ] Accessible from UI (footer, sign-up, settings)

TERMS OF SERVICE
[ ] ToS document exists
[ ] Age requirement (13+)
[ ] Jurisdiction (Swedish law)
[ ] User content ownership clause
[ ] License grant to Binge for operating the service
[ ] Account termination conditions
[ ] Prohibited use policy
[ ] Service availability disclaimer
[ ] Liability limitations
[ ] Change process
[ ] Accessible from sign-up + footer

COMMUNITY GUIDELINES
[ ] Document exists
[ ] Covers UGC categories (reviews, comments, lists, groups)
[ ] Specific prohibited behaviors (harassment, spam, copyright,
    impersonation)
[ ] Enforcement actions described
[ ] Reporting mechanism referenced (currently missing — cross-ref 09)
[ ] Accessible from UGC creation points

TMDB COMPLIANCE
[ ] Attribution text present in UI (exact wording from CLAUDE.md)
[ ] TMDB logo displayed
[ ] Attribution prominently placed (footer / about)
[ ] v3 API key (not v4) used
[ ] No redistribution of raw TMDB data
[ ] Caching TTLs reasonable
[ ] Commercial-use tier considered for Phase 2 monetization

LICENSES
[ ] All pubspec dependency licenses compatible (MIT/BSD/Apache/ISC)
[ ] Firebase (Apache-2.0) NOTICE file considered
[ ] Open-source licenses page available in app
[ ] No GPL/AGPL in production dependencies
[ ] Font licenses (system-ui stack — no obligation)
[ ] Icon licenses (ISC for lucide-react — satisfied)
[ ] UGC license grant in ToS

APP STORE
[ ] N/A (web-only; no app store presence)

CONSENT MODEL
[ ] Consent infrastructure (Phase 2): purposes mapped to implementations
[ ] Consent UI accurate
[ ] Withdrawal mechanism

FIREBASE / HOSTING
[ ] Firebase region verified (EU preferred; UNVERIFIED currently)
[ ] Google / Firebase DPA accepted
[ ] Cloudflare DPA accepted
[ ] Security headers present (cross-ref 02)
[ ] Cookies documented in privacy policy

ACCOUNT LIFECYCLE
[ ] Account deletion button in UI
[ ] Deletion cascades through all user data
[ ] Firebase Auth user deletion triggered
[ ] Data export (JSON) mechanism
[ ] Anonymization-vs-deletion policy defined
[ ] Inactive account policy defined

PROVIDER CLAIMS
[ ] Price disclaimer in advisor UI
[ ] Hyperlinks to provider websites
[ ] Pricing review schedule documented internally
```

---

## Investigation Execution Plan

### Stage 1: Legal Document Discovery (1h)

```
- Search for any legal documents in repo
- Check /public, docs/, src/app/privacy, src/app/terms, src/app/legal
- Check footer components for legal links
- Check sign-up / login UI for acceptance mechanism

Expected finding: MISSING. Document the absence with CRITICAL severity.
```

### Stage 2: TMDB Compliance Audit (1h)

```
- Search src/ for attribution text (exact CLAUDE.md wording)
- Search for TMDB logo image
- Check footer and about surfaces
- Verify v3 API key (via URL scheme in client.ts)
- Check image-hosting compliance
```

### Stage 3: License Audit (1h)

```
- npm view per direct dependency
- npx license-checker --production --summary
- /public/ asset inventory
- Font + icon + illustration license check
- Licenses-page presence
```

### Stage 4: Firebase Configuration (30 min)

```
- Firestore region (UNVERIFIED; document external action)
- Firestore rules cross-ref to privacy policy claims (when docs exist)
- firebase.json security-header audit (defer to 02)
- Cookies inventory
```

### Stage 5: Account Lifecycle (1h)

```
- Delete-account UI presence
- Firestore cascade logic (expected: missing)
- Export mechanism (expected: missing)
- Anonymization policy
```

### Stage 6: Report Compilation (1h)

Compile findings.

**Total: 5.5–6 hours**

---

## Critical Reminders

1. **DOCUMENT, DO NOT FIX** — this is investigation only.
2. **LEGAL DOCS LIKELY MISSING** — if they are, that's the PRIMARY finding.
   Score accordingly; don't pretend there's a document to audit.
3. **ACCURACY OVER COMPLETENESS** — a privacy policy that exists but
   contains wrong information is worse than a missing one (misleads
   users). Flag accordingly when documents do exist.
4. **SWEDISH LEGAL CONTEXT** — reference Swedish implementations of EU
   directives. IMY (Integritetsskyddsmyndigheten) is the Swedish
   supervisory authority. Age of digital consent = 13.
5. **TMDB ATTRIBUTION IS HIGH PRIORITY** — non-compliance risks API key
   revocation = app shutdown.
6. **ZERO CODE CHANGES** — investigation and documentation only.
7. **NO GDPR SERVICE DUPLICATION** — 02 owns ConsentService /
   DataExport / AccountDeletion implementations. This prompt checks
   whether docs ACCURATELY DESCRIBE those (when both exist).
8. **REALISTIC SEVERITY** — pre-launch app, solo developer.
   - "Missing privacy policy" is CRITICAL because it blocks launch
   - "Firebase region UNVERIFIED" is HIGH because it must be known
   - "NOTICE file for Apache-2.0 deps" is LOW because enforcement is rare
   Calibrate.
9. **EU AI ACT N/A** — Binge has no AI. Skip AI-Act analysis entirely.
10. **FORWARD-LOOKING FOR MONETIZATION** — Dim 6 consent and Dim 7 DPAs
    become sharper when payment is added. Note as Phase 2 dependencies.
