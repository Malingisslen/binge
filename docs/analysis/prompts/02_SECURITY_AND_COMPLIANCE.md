# Security & Compliance Analysis

**Analyst**: Claude (Opus 4.7)
**Framework**: OWASP Top 10 for Web Applications (2021) + OWASP API Security Top 10 (2023)
**Scope**: Web-app security audit covering client-exposed secrets, authentication,
Firebase rules, data protection, network security, CSP / security headers, and GDPR
compliance for a Swedish user base.

**Cross-Prompt Boundaries**:
- Dependency CVEs and supply chain security: covered in `05_DEPENDENCIES_AND_SUPPLY_CHAIN.md` — skip here.
- Firestore schema design, query patterns, cost optimization: covered in `04_PERFORMANCE_AND_SCALABILITY.md` — skip here.
- Firebase PITR / backups / disaster recovery: covered in `03_INFRASTRUCTURE_AND_OPERATIONS.md` — skip here.
- SDK / cookie-consent race conditions: covered in `09_TRUST_SAFETY_AND_PRIVACY.md` — skip here.
- Privacy policy / legal-document accuracy vs code: covered in `11_LEGAL_REVIEW.md` — skip here.
- This prompt owns: Firestore security rules, auth flows, secret management,
  client-side key exposure (especially `NEXT_PUBLIC_TMDB_API_KEY`), GDPR
  service implementations, network security (HTTPS, mixed content), browser
  hardening (CSP, XSS, CSRF).

---

## Two-Phase Approach

### Phase 1: Investigation and Documentation (Current Task)

The sole deliverable is a comprehensive security audit report. No code changes,
no configuration modifications, no security fixes.

Tasks:
1. Investigate all 7 dimensions thoroughly
2. Document every vulnerability with file:line references
3. Classify by severity using CVSS scoring (Critical 9.0-10.0 / High 7.0-8.9 / Medium 4.0-6.9 / Low 0.1-3.9)
4. Estimate remediation effort for each finding

Do not fix any vulnerabilities. Do not implement any security measures. Do not modify any code or configuration.

### Phase 2: Remediation Plan (After Phase 1 Complete)

Only after Phase 1 is 100% complete:
1. Analyze all documented vulnerabilities together
2. Prioritize by risk (likelihood × impact)
3. Group related security fixes
4. Create a sequenced hardening plan that maximizes risk reduction per effort unit
5. Sequence fixes to avoid breaking functionality

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), client-side SPA
Rendering:           Static export intended (disabled), served via Firebase
                     Hosting + Cloudflare CDN. No server routes.
Auth:                Firebase Authentication (partial integration)
DB:                  Cloud Firestore
External API:        TMDB API v3 (all TMDB calls client-side)
                     API key from NEXT_PUBLIC_TMDB_API_KEY — EXPOSED in client bundle
Hosting:             Firebase Hosting + Cloudflare CDN

Firestore rules:     154 lines (firestore.rules)
                     Collections secured:
                       users/{uid}                   — owner, public read if isPublic
                       users/{uid}/watchlist/{id}    — owner, public read if user.isPublic
                       users/{uid}/episodeProgress   — owner only
                       users/{uid}/notifications     — owner only
                       users/{uid}/following         — owner write, public if isPublic
                       users/{uid}/followers         — owner read, follower write
                       usernames/{username}          — public read, owner create/delete
                       reviews/{reviewId}            — public read, author write
                         reviews/*/likes/{uid}       — public read, owner create/delete
                         reviews/*/comments/{cId}    — public read, author write, host delete
                       lists/{listId}                — public if isPublic, owner write
                       sessions/{sessionId}          — public read (unlisted-link model)
                         sessions/*/participants     — public read+create+update, host delete
                         sessions/*/swipes           — public read+create+update, host delete
                       groups/{groupId}              — auth-required read, owner+token logic
                         groups/*/members            — member read, self+owner write
                         groups/*/watchlist          — member read+write
Storage rules:       NOT PRESENT (no storage.rules file — Binge doesn't use
                     Firebase Storage; images come from TMDB CDN)

Environment variables (all client-exposed via NEXT_PUBLIC_*):
  - NEXT_PUBLIC_TMDB_API_KEY          ← the big one
  - NEXT_PUBLIC_FIREBASE_API_KEY
  - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  - NEXT_PUBLIC_FIREBASE_PROJECT_ID
  - NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  - NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  - NEXT_PUBLIC_FIREBASE_APP_ID
  - TMDB_API_READ_ACCESS_TOKEN        ← server-only, Cloud Functions only (currently unused)

GDPR context (Swedish user base, EU jurisdiction):
  - No dedicated ConsentService observed
  - No DataExportService observed
  - No AccountDeletionService observed (custom) — Firebase Auth delete is baseline
  - No audit log repository
  - Cookie consent banner status: UNKNOWN (verify during investigation)
  - Privacy policy / ToS: UNKNOWN (11 Legal will verify document existence)

Known Firestore rule patterns:
  - Extensive use of get(/databases/$(database)/documents/...) for cross-doc
    checks (each get() costs a read and can hit depth limits)
  - Unlisted-link model for sessions and groups (no secret rotation)
  - Comment delete allows either comment author OR review author — verify
    chain cost
```

---

## Scoring Framework: 7 Dimensions (100 Points Total)

| Dimension | Weight | Points |
|-----------|--------|--------|
| 1. OWASP Top 10 for Web | 20% | /20 |
| 2. Authentication & Session Security | 15% | /15 |
| 3. Firebase Security Rules | 18% | /18 |
| 4. API & Secret Management | 15% | /15 |
| 5. Network & Browser Hardening | 12% | /12 |
| 6. GDPR & Data Protection | 15% | /15 |
| 7. Client-Side Code Protection | 5% | /5 |
| **Total** | **100%** | **/100** |

---

## Dimension 1: OWASP Top 10 for Web (20 Points)

Gold standard: Zero critical OWASP vulnerabilities in production builds.

### A01:2021 — Broken Access Control

Investigate:
- Can user A read/write user B's watchlist? (Firestore rules check)
- Can an anonymous user access authenticated endpoints?
- IDOR on Firestore document IDs: can manipulating a tmdbId in a URL leak
  another user's data?
- Can a non-owner modify a review, like, comment?
- Can a non-host modify session config or delete participants?
- Can a non-member access a group's watchlist subcollection?
- Cross-reference every Firestore rule against its consumer code.

### A02:2021 — Cryptographic Failures

Investigate:
- Is HTTPS enforced? (Firebase Hosting + Cloudflare — expected yes, verify
  no http:// references)
- Are any secrets stored in localStorage / sessionStorage? (Firebase SDK
  stores auth tokens in IndexedDB — verify no additional custom secret
  storage)
- Is there any custom encryption in the app? (Expected: no; Firebase handles
  auth tokens)
- Password requirements: Firebase Auth default — verify min-length and
  complexity expectations in the sign-up flow

### A03:2021 — Injection

Investigate:
- XSS: any use of dangerouslySetInnerHTML? (grep)
- Any URL parameters rendered without escaping? (Next.js escapes by default,
  but string concat into href/src can slip)
- User-generated content (notes, reviews, comments, group names) —
  are they rendered as plain text, not as HTML?
- Firestore rules rely on request.resource.data equality — any path where
  user-controlled data lands in a rule path?
- TMDB responses: is anything rendered raw (e.g., overviews with HTML tags)?

### A04:2021 — Insecure Design

Investigate:
- "Unlisted link" model for sessions and groups: sessions have session IDs,
  groups have 20-char inviteTokens. Are IDs cryptographically random
  and sufficient entropy? Are tokens rotatable if leaked?
- Abuse potential: can a non-authenticated user flood session create?
  (Rule allows create if hostUid == null — anonymous sessions.)
- Review comments: rate-limiting? spam prevention?
- Is there a deletion lifecycle for sessions / groups / lists?

### A05:2021 — Security Misconfiguration

Investigate:
- Firebase Hosting security headers (firebase.json — currently NO headers
  block). Missing:
    Content-Security-Policy
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY (or frame-ancestors 'none')
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy
    Strict-Transport-Security (Cloudflare may add; verify)
- Cloudflare settings: verify SSL mode (Full strict?), TLS min 1.2/1.3,
  WAF rules if any
- Firebase project config: verify App Check NOT accidentally disabled
  (currently: App Check not configured — verify is correct decision)
- Debug / source maps exposed in production bundle?

### A06:2021 — Vulnerable & Outdated Components

Deferred to 05 Dependencies. This prompt only flags if vulnerable components
enable security-critical flows (e.g., firebase SDK major version gap).

### A07:2021 — Identification & Authentication Failures

Investigate:
- Firebase Auth providers enabled (email/password, Google?) — verify list
- Email verification requirement? (Firebase default: off; verify)
- Password reset flow: rate-limited? email enumeration protection?
- Session persistence: LOCAL (default) / SESSION / NONE — document choice
- Concurrent session handling
- Auth state listener: onAuthStateChanged wired correctly? (AuthContext)
- Anonymous auth usage: sessions allow anonymous participants — intentional?

### A08:2021 — Software & Data Integrity Failures

Investigate:
- Subresource Integrity (SRI) on external scripts (Cloudflare analytics,
  Firebase CDN?) — verify
- package-lock.json committed? YES (verify via git)
- Dependency pinning strategy: caret ranges in package.json — standard
- CI/CD integrity: deploy.yml uses GitHub Action with firebaseServiceAccount
  secret — verify the secret is scoped correctly

### A09:2021 — Security Logging & Monitoring Failures

Investigate:
- Error tracking: Sentry / Firebase Crashlytics / nothing? (Expected: none)
- Failed auth attempt logging? (Firebase Auth logs these; verify access)
- Suspicious activity detection: none expected
- Log retention policy: defer to 11 Legal for document audit

### A10:2021 — Server-Side Request Forgery (SSRF)

Investigate:
- No server-side routes in Binge (static export). N/A.
- Cloud Functions: none deployed currently. N/A.
- Verify no client fetch() accepts user-supplied URLs unchecked.

**Dimension Output**:
- OWASP A01–A10 compliance scorecard with status per category
- Critical vulnerabilities with CVSS scores
- Compliance gaps ranked by severity
- Total remediation effort estimate

---

## Dimension 2: Authentication & Session Security (15 Points)

Gold standard: Secure authentication with encrypted token storage, appropriate
session persistence, and MFA available.

### Authentication Flow Security

Investigate:
- Firebase Authentication providers: what is enabled (email/password, Google,
  Apple, anonymous)?
- Email verification: enforced before access to the app? (Email enumeration
  prevention: both "user exists" and "user doesn't" should produce identical
  response)
- Password requirements: Firebase default (min 6 chars) — too weak;
  recommend custom validation at sign-up
- OAuth providers: state parameter / nonce handled correctly by Firebase SDK?
- Sign-up spam: is there any captcha / App Check? (Firebase App Check
  currently expected disabled — HIGH finding if true)

### Session / Token Management

Investigate:
- Token storage: Firebase SDK uses IndexedDB by default. Verify no manual
  localStorage.setItem of tokens.
- Token refresh: Firebase SDK auto-refreshes. Any custom override?
- Session persistence: check setPersistence() calls — LOCAL (default),
  SESSION, or NONE?
- Sign-out: does signOut() clear all relevant state (AuthContext + any
  cached user data in React Query)? Look for queryClient.clear() or
  invalidateQueries calls on sign-out.
- onAuthStateChanged listener: single place (AuthContext)? Unsubscribed
  on unmount?

### Multi-Factor Authentication

Investigate:
- MFA support: Firebase MFA is available on Blaze plan. Currently: unconfigured.
- Not a critical finding for a free-tier launch, but document as optional
  improvement.

### Account Deletion

Investigate:
- User-facing account deletion: implemented? (Cross-ref 06 UX and 09 Privacy
  for deletion button presence)
- Deletion completeness: does it cascade through all user subcollections?
  (watchlist, episodeProgress, notifications, following, followers, reviews,
  lists, groups they own)
- Firebase Auth user deletion: separate from Firestore deletion — does the
  flow handle both?

**Dimension Output**:
- Authentication security scorecard
- Token management assessment
- Session management gap analysis
- MFA implementation status
- Account deletion completeness audit
- Remediation effort estimate

---

## Dimension 3: Firebase Security Rules (18 Points)

Gold standard: Defense-in-depth with explicit allow rules, no implicit access,
comprehensive field validation, and full collection coverage.

### Firestore Security Rules — Collection-by-Collection Audit

**KNOWN**: firestore.rules is 154 lines. Verify EVERY rule against its
intended access model:

**1. users/{uid}** (lines 5–8)
```
allow read, write: if request.auth != null && request.auth.uid == uid;
allow read: if resource.data.isPublic == true;
```
- Owner has full write — OK
- Public read if isPublic is true — verify:
  - Does the write rule prevent `isPublic` from being set by a non-owner?
    (The auth.uid == uid check covers this — OK.)
  - Is there field-level validation? (Currently NO — a user could write
    arbitrary fields. Consider tightening.)
  - Specifically: the user document holds `myProviders`, `providerCosts`,
    `providerPauses`. Are these writable only by the owner? YES via the
    auth check. But is payload SHAPE validated? NO.

**2. users/{uid}/watchlist/{itemId}** (lines 9–12)
```
allow read, write: if request.auth != null && request.auth.uid == uid;
allow read: if get(/databases/$(database)/documents/users/$(uid)).data.isPublic == true;
```
- Public read via get() — EVERY read costs an additional document read.
  Verify this is intentional (cross-ref 04 Performance for cost).
- No field validation — a malicious user could corrupt their own watchlist
  but not another's.

**3. users/{uid}/episodeProgress/{itemId}** (lines 13–15)
- Owner only. Good.

**4. users/{uid}/notifications/{notifId}** (lines 18–20)
- Owner only. But: notifications are typically WRITTEN by another user's
  actions (e.g., new follower creates a notification). Currently NO rule
  allows a non-owner to create a notification. Is this intentional
  (Cloud Function writes them) or a bug (notifications never created)?
- HIGH: clarify notification write-path.

**5. users/{uid}/following/{targetUid}** (lines 23–26)
- Owner write — OK
- Public read if user.isPublic — each read pays a cross-doc get()
- There's no check that targetUid is a valid user — a spam script could
  write arbitrary UIDs. Consider validation.

**6. users/{uid}/followers/{followerUid}** (lines 27–31)
```
allow write: if request.auth != null && request.auth.uid == followerUid;
```
- A user can add themselves to another user's followers subcollection.
- This is the dual-write pattern for follows (follower writes their own
  entry in the target's followers; target can read). Verify consistency
  enforcement — can a malicious user forge a follower relationship?
- Verify cascading unfollow.

**7. usernames/{username}** (lines 34–38)
```
allow read: if true;
allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
```
- Public read — OK (username availability check)
- Create only if uid matches caller — OK
- NO UPDATE rule — intentional? (Username squatting: create + never delete)
- Case sensitivity: usernames are case-sensitive in Firestore keys.
  Is normalization (lowercase) enforced client-side before the create?
  If not, "Malin" and "malin" are different names — enables squatting.
- Username reservation race: two users creating the same username
  simultaneously — Firestore creates first, second fails. OK.

**8. reviews/{reviewId}** (lines 41–62)
```
allow read: if true;
allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
allow update, delete: if request.auth != null && resource.data.uid == request.auth.uid;
```
- Public read — OK (reviews are public content)
- Field validation MISSING: rating range, text length, no HTML
- No rate limiting at the rules level — a spam user can create unlimited
  reviews. Cross-ref 09 Trust/Safety for moderation.

**8a. reviews/*/likes/{uid}** (lines 47–50)
- uid in path must match caller — OK, clean pattern.

**8b. reviews/*/comments/{commentId}** (lines 53–61)
- Delete: comment author OR review owner — the review-owner delete path
  uses get() — pays a read per delete.
- Create: no content validation. Spam / abuse potential. Cross-ref 09.

**9. lists/{listId}** (lines 65–70)
- public if isPublic, owner-only otherwise. Clean.
- But: can a user flip their list from public to private and back to
  enumerate what's visible? Yes. Is this desirable? Probably OK.

**10. sessions/{sessionId}** (lines 74–94)
```
allow read: if true;                    ← unlisted-link model
allow create: if request.resource.data.hostUid == null || ...
```
- ANONYMOUS session creation (hostUid == null) — abuse potential
- Create flood: one IP can create thousands of sessions. Consider
  server-side (Cloud Function) gating with App Check.
- Participants and swipes: public create+update — anyone who knows the
  sessionId can vote. Is this abuse-resistant? (Unlisted model — session
  IDs are Firestore auto-IDs, 20 chars, high entropy. Enumeration is
  impractical.)
- Delete: owner-only via get() — pays a read.

**11. groups/{groupId}** (lines 99–143)
- Complex update rule (lines 108–129) allows three patterns:
  - Owner (full write)
  - Member leaving (self-removal only)
  - Token-join (anyone with inviteToken adds themselves)
- Verify each branch: can a malicious caller forge a fake inviteToken?
  The rule checks `request.resource.data.inviteToken == resource.data.inviteToken`
  which compares the submitted value to the stored value — a non-member
  must know the token. OK.
- "Gäst som joinar via giltig token" (line 107): once joined, member can
  write to watchlist. If a user leaves + rejoins, historical watchlist
  writes retained.
- memberUids.hasOnly([request.auth.uid]) on create ensures only the
  creator is a member initially — clean.
- groups/*/members subcollection: can any member freely update other
  members' member docs? No — rule at 139–142 restricts to self or owner.
- groups/*/watchlist: any member can create/update/delete — is there a
  "last edit wins" risk? Yes. No per-field validation.

### Rule-to-Code Alignment

Cross-reference every Firestore client call with the corresponding rule:
- Does the code ever attempt writes that the rules reject silently?
- Does the code over-request (reads more than rules allow, triggering
  permission-denied)?
- Does the code ever check rule behavior as a security boundary
  (bad practice — server-side enforcement should be the only boundary)?

### Cost of Cross-Doc get() Calls

Rules lines 11, 25, 29, 85, 92, 136, 141, 147, 150 use get() for cross-doc
checks. Each costs a document read and counts toward quotas. Audit:
- How many get()s per typical user session?
- Could any be eliminated by denormalizing (copying the isPublic flag or
  memberUids into the subcollection doc)?
- Cross-ref 04 Performance for cost analysis.

### Storage Rules

Binge does not use Firebase Storage (images come from TMDB CDN).
- Verify NO storage.rules file is needed.
- If future user avatar upload is added, storage.rules must be created.

### Cloud Functions

Currently: NONE deployed. If deployed in future, they run with Admin SDK
(bypasses rules) — audit then.

**Dimension Output**:
- Collection-by-collection rule coverage table with findings per collection
- Missing field validation inventory
- Cross-doc get() cost assessment
- Rule-to-code alignment gaps
- Anonymous access abuse vectors
- Remediation effort estimate

---

## Dimension 4: API & Secret Management (15 Points)

Gold standard: Zero hardcoded secrets in source; all keys either server-only
or client-exposed WITH appropriate restrictions.

### Hardcoded Secrets Audit

Search for:
- Any API keys, tokens, passwords committed to source
- Base64-encoded suspicious strings
- Connection strings with embedded credentials

Pattern: `grep -rn "apiKey\|api_key\|secret\|password\|token\|Bearer\|AIza"`

### NEXT_PUBLIC_TMDB_API_KEY — Critical Analysis

**This is the biggest security decision in Binge.**

Current state (src/lib/tmdb/client.ts:17):
```typescript
const key = process.env.NEXT_PUBLIC_TMDB_API_KEY;
```

The key is bundled into the JavaScript shipped to every visitor.

Risks:
1. Anyone can extract the key from the bundle (trivial)
2. Key used outside Binge: quota exhaustion, abuse, TMDB terms violation
3. No per-user rate limiting possible at the TMDB layer

Mitigation options (for Phase 2):
- **Option A** (minimal): TMDB v3 API keys are specifically designed to
  be embedded in clients. TMDB's documented stance: "v3 API keys may be
  exposed in client-side code". This is LOW-severity if:
  - Rate limits are acceptable
  - No commercial-tier key in use
  - TMDB ToS compliance verified (cross-ref 11 Legal)
- **Option B**: Proxy TMDB calls through a Cloud Function that holds the
  key server-side. Adds latency, Firestore reads (cost), and complexity.
  Only necessary if abuse becomes real.
- **Option C**: Restrict the key to binge.nu via HTTP Referer allowlist
  (if TMDB supports this — verify in TMDB dashboard)

Severity: MEDIUM unless the team chose a commercial TMDB key.

### NEXT_PUBLIC_FIREBASE_* Keys

Firebase client config is DESIGNED to be public. The protection layer is
Firestore security rules + App Check. Verify:
- No additional "secret" Firebase keys leak
- Firebase Admin SDK service account credentials NEVER appear in the client
  (currently: no functions/ directory, so no risk)
- GitHub Actions secret FIREBASE_SERVICE_ACCOUNT is correctly scoped
  (deploy.yml uses it) — verify via GitHub repo settings

### TMDB_API_READ_ACCESS_TOKEN

CLAUDE.md declares this as "Cloud Functions only" but no functions exist
yet. Verify:
- No client-side code references this variable
- The variable is NOT defined in .env.local (should only exist server-side
  when functions are deployed)

### Environment File Hygiene

Check:
- .env.local is in .gitignore
- .env.local.example exists and lists required vars with placeholders
- No .env files committed

### CI/CD Secret Injection

Check .github/workflows/deploy.yml:
- Secrets: GITHUB_TOKEN (built-in) and FIREBASE_SERVICE_ACCOUNT
- No echo $SECRET or similar exposure
- No additional secrets expected

**Dimension Output**:
- Hardcoded secrets inventory (file:line for any found)
- TMDB key exposure risk analysis with Phase 2 recommendation
- Firebase config security posture
- Environment file hygiene audit
- CI/CD secret handling audit
- Remediation effort

---

## Dimension 5: Network & Browser Hardening (12 Points)

Gold standard: All traffic HTTPS, comprehensive security headers, CSP in place,
XSS-resistant by design.

### HTTPS Enforcement

Investigate:
- All Firebase / TMDB calls use HTTPS (Firebase and TMDB enforce this)
- Cloudflare: SSL mode set to "Full (strict)" — verify
- HSTS header: present? (Cloudflare "Always Use HTTPS" + HSTS setting)
- Search for any `http://` URLs in source code

### Security Headers (Firebase Hosting)

firebase.json CURRENTLY has no "headers" block (verified from file content).

Missing headers:
```
Content-Security-Policy:
  Tight CSP would disallow inline scripts/styles — Next.js uses some inline.
  Start with: default-src 'self' https://api.themoviedb.org https://image.tmdb.org
              https://*.firebaseio.com https://*.googleapis.com
              https://*.firebase.com wss://*.firebaseio.com
  script-src 'self' 'unsafe-inline' (+hashes if tightening)
  style-src 'self' 'unsafe-inline'
  img-src 'self' https://image.tmdb.org data:
  frame-ancestors 'none'
  connect-src 'self' https://api.themoviedb.org https://*.googleapis.com
              https://*.firebase.com https://*.firebaseio.com

X-Content-Type-Options: nosniff
X-Frame-Options: DENY  (or rely on frame-ancestors above)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Investigate:
- Whether Cloudflare Transform Rules add any headers (sometimes pre-set)
- Whether next.config.mjs has a `headers()` function (probably not — static
  export doesn't support dynamic headers anyway; must be set in firebase.json)

### XSS Defense

Search for:
- dangerouslySetInnerHTML usage (grep — expected: zero)
- User-controlled content rendered in href/src
- Review text, notes, comments, group names: sanitization?
- target="_blank" with rel="noopener noreferrer"?

### CSRF

Firebase Auth uses bearer tokens, not cookies — so classic CSRF is not a
primary risk. Verify:
- No custom endpoints accepting POST with cookies
- No form submissions to external domains without CSRF tokens

### Open Redirect

Search for:
- Any navigation that reads from URL params and redirects to another URL
  without allowlist (next.js router.push with user input)
- OAuth redirect URIs: Firebase manages these — verify allowed domains
  in Firebase Auth settings

### Clickjacking

X-Frame-Options / frame-ancestors must be set. Currently missing.

**Dimension Output**:
- HTTPS enforcement audit
- Security-headers compliance table (header × present × value)
- XSS vulnerability inventory
- CSRF / clickjacking / open-redirect assessment
- Cloudflare configuration recommendations
- Remediation effort estimate

---

## Dimension 6: GDPR & Data Protection (15 Points)

Gold standard: All GDPR articles covered (consent, access, erasure, portability,
audit) with Swedish-user context.

Note: Document-accuracy vs code is owned by 11 Legal. This prompt owns
the CODE implementations.

### Article 7 — Consent Management

Investigate:
- Is there a ConsentService / consent toggle in settings? (Expected:
  minimal — verify)
- Cookie consent banner for EU users? (Cloudflare, Firebase Analytics if
  added, etc.)
- Granular consent (analytics, marketing, essential)?
- Consent version tracking?
- Opt-in only (no pre-checked boxes)?

**Current state expected: minimal consent infrastructure**. Flag as HIGH
for a Swedish-user app.

### Articles 15 / 20 — Right of Access & Portability

Investigate:
- Can a user export their data? (No DataExportService observed)
- Would an export cover: profile, watchlist, episodeProgress, reviews,
  lists, groups, follows, notifications?
- Export format: JSON is GDPR-acceptable
- Self-service vs email-request: self-service strongly preferred

### Article 17 — Right to Erasure

Investigate:
- Is there a "Delete account" button? (Check settings page)
- Cascading deletion: profile, subcollections, reviews, lists, group
  memberships, follow records on OTHER users' docs
- Firebase Auth user delete: separate call needed
- Shared-content handling: reviews remain public? Anonymized? Deleted?

Verify cascade via a search of all collections touched by a user's lifecycle.

### Article 25 — Data Minimization

Investigate:
- What data does Binge collect that isn't strictly necessary?
- Email is necessary (auth), username is necessary (social)
- Provider preferences, costs, pauses — necessary for core feature
- Any telemetry that captures PII (user ID in Firebase Analytics events —
  typically OK under consent)

### Article 30 — Records of Processing Activities

Investigate:
- Is there an audit log of data operations? (Currently: no repository)
- Firebase Auth logs failed sign-ins — accessible via console
- Firestore has no built-in audit trail; Cloud Functions + Audit Logs
  would be needed
- For pre-launch, this is LOW priority; flag but don't over-penalize

### Cross-Border Data Transfers

Check:
- Firebase project region: verify (europe-west1 vs us-central1)
- Firestore data location — affects where user data physically resides
- TMDB data residency: TMDB is US-based, but only recipe metadata flows
  (not PII)
- Cloudflare: routes through global edge — data transit (not at-rest)

### Data Retention

Check:
- Do we delete old sessions (unused "Tillsammans" sessions)?
- Old notifications — retention policy?
- Audit logs if any — retention?
- For pre-launch: document current state; flag gaps.

**Dimension Output**:
- Consent service implementation status
- Data export capability assessment
- Account deletion completeness matrix (collection × cascade)
- Data transfer residency documentation
- Retention policy gaps
- Remediation effort per article

---

## Dimension 7: Client-Side Code Protection (5 Points)

Gold standard: Source maps are not public, sensitive logic is server-side
where possible, no debug features in production.

Investigate:
- Next.js production build: source maps public? (next.config.mjs —
  verify; default for production client is off)
- Bundle inspection: search the built `out/` directory for:
  - Dev-only code (`process.env.NODE_ENV === 'development'` branches
    should be dead-code-eliminated)
  - Commented-out experimental features
  - Test/fixture data
- Feature flags that reveal unreleased features if toggled

Note: Client-side obfuscation is theater. Don't over-weight this dimension.

**Dimension Output**:
- Source map exposure check
- Bundle hygiene audit
- Debug gating assessment

---

## Output Deliverables

### 1. Executive Summary

```
BINGE SECURITY AND COMPLIANCE ANALYSIS — PHASE 1
==================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Framework: OWASP Top 10 for Web (2021) + OWASP API Top 10 (2023)

OVERALL SECURITY SCORE: X/100

├── OWASP Top 10:                        X/20 points
├── Authentication & Session:            X/15 points
├── Firebase Security Rules:             X/18 points
├── API & Secret Management:             X/15 points
├── Network & Browser Hardening:         X/12 points
├── GDPR & Data Protection:              X/15 points
└── Client-Side Code Protection:         X/5 points

SECURITY POSTURE: [Excellent | Good | Needs Improvement | Critical Issues]

VULNERABILITY SUMMARY:
- CRITICAL (CVSS 9.0–10.0): X vulnerabilities
- HIGH (CVSS 7.0–8.9):      X vulnerabilities
- MEDIUM (CVSS 4.0–6.9):    X vulnerabilities
- LOW (CVSS 0.1–3.9):       X vulnerabilities

TOP 5 SECURITY RISKS:
1. [Description]
2. [Description]
3. [Description]
4. [Description]
5. [Description]
```

### 2. OWASP Top 10 Scorecard

| OWASP Category          | Status                | Findings | Severity | Remediation |
|-------------------------|-----------------------|----------|----------|-------------|
| A01: Broken Access Ctrl | Pass / Partial / Fail | X issues | H/M/L    | X hours     |
| A02: Cryptographic      | ...                   | ...      | ...      | ...         |
| ...                     | ...                   | ...      | ...      | ...         |

### 3. Critical Vulnerability Report

For each critical or high vulnerability: title, CVSS score, category,
file:line, attack vector, description, PoC steps, remediation, effort.

### 4. Firebase Rules Coverage Matrix

| Collection                       | Auth Required | Ownership | Field Validation | Public Path | Status |
|----------------------------------|---------------|-----------|------------------|-------------|--------|
| users/{uid}                      | Y/N           | Y/N       | Y/N              | isPublic    | ...    |
| users/{uid}/watchlist            | Y/N           | Y/N       | Y/N              | isPublic    | ...    |
| ...                              | ...           | ...       | ...              | ...         | ...    |

### 5. GDPR Compliance Report

| Article | Requirement        | Implementation          | Status | Score |
|---------|--------------------|-------------------------|--------|-------|
| Art. 7  | Consent            | [ConsentService? banner?] | ...  | X/3   |
| Art. 15 | Right of Access    | [Export mechanism?]     | ...    | X/3   |
| Art. 17 | Right to Erasure   | [Delete + cascade?]     | ...    | X/3   |
| Art. 20 | Portability        | [JSON export?]          | ...    | X/3   |
| Art. 30 | Processing Records | [Audit log?]            | ...    | X/3   |

### 6. Remediation Roadmap

**Phase 1: Critical (Week 1)** — CVSS 9.0+
**Phase 2: High (Weeks 2–3)** — CVSS 7.0–8.9
**Phase 3: Medium (Month 2)** — CVSS 4.0–6.9
**Backlog: Low** — remaining

### 7. Penetration Testing Readiness Checklist

- [ ] All OWASP Top 10 reviewed
- [ ] All critical vulnerabilities remediated
- [ ] Firebase rules reviewed
- [ ] Security headers added
- [ ] Test accounts documented for external pentest
- [ ] Vulnerability disclosure policy published

---

## Phase 1 Success Criteria

Complete when:

1. All 7 dimensions investigated and scored
2. OWASP A01–A10 assessed with per-category status
3. All vulnerabilities with file:line and CVSS scores
4. Firebase rules audited collection-by-collection
5. NEXT_PUBLIC_TMDB_API_KEY exposure risk analyzed with Phase 2 recommendation
6. Security-headers gap inventoried
7. GDPR compliance scored per article
8. Remediation effort estimated per vulnerability
9. Zero code changes made — documentation only

---

## Investigation Sequence

1. Hardcoded secrets grep (15 min)
2. Firebase rules file-by-file audit (2 hours)
3. NEXT_PUBLIC_TMDB_API_KEY analysis (30 min)
4. Auth flow trace (AuthContext + login page) (1 hour)
5. Security headers audit (30 min)
6. GDPR gap analysis (1 hour)
7. OWASP Top 10 systematic review (2 hours)
8. Synthesis and Risk Matrix (1 hour)

**Total: 8–10 hours**

---

## Critical Reminders

1. DOCUMENT, DO NOT FIX
2. CVSS SCORING — industry standard
3. NO ASSUMPTIONS — verify every security claim
4. COMPREHENSIVE — every rule, every collection, every environment variable
5. ZERO CODE CHANGES
6. REALISTIC — pre-launch SPA. Severity should reflect actual risk at launch.
7. CROSS-REFERENCE — rules vs client code alignment
8. TMDB API KEY EXPOSURE is a defensible decision (TMDB supports client-side
   keys) but MUST be consciously analyzed, not ignored.
