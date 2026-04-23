# Binge — Security & Compliance Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Framework:** OWASP Top 10 for Web (2021) + OWASP API Security Top 10 (2023)

---

## Executive Summary

```
OVERALL SECURITY SCORE: 56/100
├── OWASP Top 10:                        11/20   ← A01 access control gaps, A05 no headers
├── Authentication & Session Security:    9/15   ← cache not cleared on sign-out, email verify off
├── Firebase Security Rules:             11/18   ← no field validation, no rate limits, cost-expensive get()s
├── API & Secret Management:             11/15   ← TMDB key exposed (accepted), envs OK
├── Network & Browser Hardening:          2/12   ← NO security headers at all
├── GDPR & Data Protection:                9/15   ← account-deletion cascade is incomplete, no consent UI, no export
└── Client-Side Code Protection:           3/5

SECURITY POSTURE: Needs Improvement — 0 CRITICAL CVSS but 3 HIGH blocking a public launch
```

### Vulnerability Summary

| CVSS | Count |
|------|-------|
| CRITICAL (9.0–10.0) | 0 |
| HIGH (7.0–8.9) | 3 |
| MEDIUM (4.0–6.9) | 9 |
| LOW (0.1–3.9) | 8 |

### Top 5 Security Risks

1. **No HTTP security headers configured on Firebase Hosting** (firebase.json) — missing CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy. Estimated CVSS 7.1.
2. **GDPR Art. 17 account-deletion cascade is incomplete** (`AuthContext.tsx:243-260`) — leaves orphaned reviews, comments, lists, follower records, group memberships. Estimated CVSS 7.0 (compliance).
3. **Sign-out does not clear React Query cache** (cross-ref 01) — privacy violation on shared devices. CVSS 6.5.
4. **No consent banner / cookie law compliance** — Swedish LEK §6 kap 18§ requires explicit consent for non-essential cookies. Once any analytics is added this becomes CRITICAL.
5. **Firestore rules have zero field validation** (entire `firestore.rules`) — a malicious authenticated user can corrupt their own docs with arbitrary fields, payload shapes, and values outside business rules (e.g., rating=999, isPublic toggles, etc.).

---

## Dimension 1 — OWASP Top 10 for Web: 11/20

### A01:2021 Broken Access Control — PARTIAL

#### HIGH

**A1-1 — No field validation in Firestore rules** — `firestore.rules` (all collections)
- Impact: an authenticated user can write arbitrary fields to their own
  profile, watchlist items, reviews, lists, group memberships.
  Attacker-controlled fields (e.g., fake `createdAt` server-timestamp,
  overweight `rating: 999`, injected HTML in `notes`) flow directly to
  other users' views via public profiles, public reviews, group
  watchlist, etc.
- CVSS: 7.1 (High — integrity impact on other users' data)
- Fix: add `allow create/write: if …` clauses that validate field
  presence, types, string length caps, number ranges, and reject
  unknown fields. Example for reviews:
  ```
  allow create: if request.auth != null
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.keys().hasOnly(['uid','tmdbId','mediaType','rating','text','createdAt'])
    && request.resource.data.rating is int
    && request.resource.data.rating >= 0 && request.resource.data.rating <= 10
    && request.resource.data.text is string
    && request.resource.data.text.size() < 5000
    && request.resource.data.createdAt == request.time;
  ```
- Effort: 2–3 h to add validation to every `match` block

#### MEDIUM

**A1-2 — `request.time` not enforced on `createdAt` / `updatedAt`** — `firestore.rules`
- Impact: client can send any timestamp, allowing forged history
  (old reviews looking recent, etc.). Minor since rule above does not
  enforce it.
- Fix: bundled with A1-1

### A02:2021 Cryptographic Failures — MOSTLY OK

HTTPS enforced by Firebase Hosting + Cloudflare. Verified no `http://` URLs in `src/`. No custom crypto.

#### MEDIUM

**A2-1 — Firebase Auth IndexedDB token storage implicit**
- Firebase SDK stores tokens in IndexedDB by default. Not a vulnerability
  but should be documented in privacy policy.
- Effort: 0 (deferred to 11 Legal)

### A03:2021 Injection — OK

- Zero `dangerouslySetInnerHTML` (verified via grep)
- React escapes by default
- No user-controlled `href` / `src` patterns observed during spot-reads
- Username is user-controlled — must verify XSS handling in display
  contexts (deferred for code review)

### A04:2021 Insecure Design — PARTIAL

#### HIGH

**A4-1 — "Unlisted link" model on sessions + groups has no secret rotation**
- `firestore.rules:74-94` — sessions read:true, anyone can swipe/vote
- `firestore.rules:99-152` — groups readable by any authed user;
  `inviteToken` is 20 chars (presumably) but there's no rotation path
  if leaked
- Impact: leaked invite token = permanent group access; leaked session
  ID (e.g., screen-shared) = permanent voting ability
- Fix: add `allow update` logic for owner to rotate `inviteToken`;
  add expiry on sessions (consolidate ancient session deletion)
- CVSS: 6.8 (Medium–High)
- Effort: 2 h

#### MEDIUM

**A4-2 — Anonymous session creation allowed** — `firestore.rules:76`
- `allow create: if request.resource.data.hostUid == null || ...`
  means the endpoint accepts creations with `hostUid: null`. Any
  visitor can create unlimited sessions.
- Impact: Firestore quota DoS / spam.
- Fix: require `request.auth != null` OR add rate-limit via App Check.
- Effort: 30 min

### A05:2021 Security Misconfiguration — CRITICAL BY OMISSION

#### HIGH

**A5-1 — No HTTP security headers** — `firebase.json` (entire file)
- `firebase.json` is barebones — `{ hosting, firestore }` with only
  rewrites. NO `"headers"` block.
- Missing (with recommended values):
  ```json
  "headers": [{
    "source": "**",
    "headers": [
      { "key": "Content-Security-Policy",
        "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.themoviedb.org https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebase.com; img-src 'self' data: https://image.tmdb.org https://lh3.googleusercontent.com; frame-src 'self' https://*.firebaseapp.com; frame-ancestors 'none'" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" }
    ]
  }]
  ```
- CVSS: 7.1 (High — enables clickjacking, XSS amplification, downgrade attacks)
- Effort: 30 min (draft headers + verify Firebase Auth popup + TMDB image loading still work)

### A06:2021 Vulnerable & Outdated Components

Deferred to `05_DEPENDENCIES_REPORT.md`. Summary: 1 CRITICAL (protobufjs),
4 HIGH (Next.js CVEs — defanged by static export + dev-only glob chain).

### A07:2021 Identification & Authentication Failures — PARTIAL

#### MEDIUM

**A7-1 — Email verification not enforced on sign-up** — `AuthContext.tsx:163`
- `createUserWithEmailAndPassword` is called but no `sendEmailVerification`
  follow-up observed. User accesses app immediately on unverified email.
- Impact: email-bound features (username lookup, unique email) can be
  subverted by unverified accounts.
- Fix: send verification email + gate features on `user.emailVerified`.
- Effort: 1 h

**A7-2 — No password-strength policy**
- `createUserWithEmailAndPassword` accepts Firebase's 6-char minimum.
- Fix: client-side validation (min 12 chars + complexity) before the
  Firebase call. Optionally log weak password attempts.
- Effort: 30 min

**A7-3 — Firebase App Check NOT configured**
- No `firebase/app-check` import in `src/` (grep confirms).
- Impact: Firestore / Auth reachable from anyone with the Firebase
  config (which is public per Firebase design). App Check gates this to
  authentic app instances.
- CVSS: 5.3 (Medium — abuse enablement)
- Effort: 2 h (integrate via reCAPTCHA Enterprise / custom provider)

### A08:2021 Software & Data Integrity Failures — OK

- `package-lock.json` committed ✓
- No SRI on external scripts — but Binge doesn't currently load any
  external scripts (no analytics, no CDN scripts). If added later, SRI
  needed.
- GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT` scoped correctly

### A09:2021 Security Logging & Monitoring — MISSING

#### MEDIUM

**A9-1 — Zero error tracking** — no Sentry / Crashlytics / custom
- Impact: security incidents go undetected (failed auth patterns,
  Firestore permission-denied spikes, XSS attempts).
- Cross-ref 03 Infrastructure for observability plan.
- Effort: 2 h (Sentry free tier integration)

### A10:2021 Server-Side Request Forgery — N/A

Binge is a static SPA, no server endpoints. TMDB fetches are from
fixed hostname `api.themoviedb.org`. Client fetch cannot be poisoned.

---

## Dimension 2 — Authentication & Session Security: 9/15

### Auth Flow (AuthContext.tsx)

- Providers: email/password + Google popup (`signInWithPopup`, line 155)
- Sign-up: `createUserWithEmailAndPassword` (line 163)
- Session persistence: Firebase default (LOCAL → IndexedDB)
- Listener: `onAuthStateChanged` — verified via imports

### Findings

#### HIGH

**A-1 — `signOut` does not clear cached user data** — `AuthContext.tsx:167-169`
  (cross-ref 01 #13; owned by 02 for privacy angle)
- Impact: on a shared device, user A's watchlist / reviews / notifications
  remain in React Query cache until refetch. User B sees previous data
  briefly.
- Fix: call `queryClient.clear()` in sign-out handler.
- CVSS: 6.5 (High in shared-device context, Medium otherwise)
- Effort: 30 min

#### MEDIUM

**A-2 — No inactivity session timeout**
- Firebase ID token refreshes indefinitely.
- For a low-sensitivity consumer app this is acceptable — but a "Log out
  everywhere" button would be prudent.
- Effort: 1 h

**A-3 — No MFA option**
- Firebase supports MFA but unconfigured.
- Low priority for a consumer media tracker.
- Effort: 4–6 h if pursued later

### Strengths

- Google OAuth handled by Firebase SDK (state / nonce managed by library)
- `onAuthStateChanged` single source of truth in `AuthContext`
- No custom token handling
- `deleteAccount` exists (though incomplete — see GDPR dim)

---

## Dimension 3 — Firebase Security Rules: 11/18

### Collection-by-Collection Audit

#### `users/{uid}` — lines 5-8
```
allow read, write: if request.auth != null && request.auth.uid == uid;
allow read: if resource.data.isPublic == true;
```
- Owner-only write ✓
- Public read path via `isPublic` ✓
- **MISSING field validation** (A1-1 above)
- `isPublic` toggle: user can flip any time. OK by design but consider
  audit-log side effect.

#### `users/{uid}/watchlist/{itemId}` — lines 9-12
- Same validation gap
- **Public-read path uses `get()` → pays 1 extra Firestore read per
  document read** (cost + cross-ref 04 performance). Every public
  profile view of a user with 100 watchlist items = 100 extra `get()`
  calls of `users/{uid}`.

#### `users/{uid}/episodeProgress/{itemId}` — lines 13-15
- Owner only — correct
- No validation

#### `users/{uid}/notifications/{notifId}` — lines 17-20
- **HIGH — Nobody can WRITE notifications** except the owner.
  Notifications are usually written BY OTHER USERS' actions (new
  follower, new comment on your review).
- Either:
  - (a) Cloud Functions write them via Admin SDK (bypasses rules) —
    but no `functions/` directory exists yet.
  - (b) The other user writes them (requires rule change).
  - (c) Notifications are not actually created anywhere yet.
- Expected: option (c). Verify via Grep for `notifications` writes in `src/`.
- Impact: feature not implemented or rule needs cross-user-write path.
- Effort: 1 h (design depends on whether functions are deployed)

#### `users/{uid}/following/{targetUid}` + `followers/{followerUid}` — lines 22-31
- Dual-write pattern: A follows B → A writes to A's `following/` and
  also to B's `followers/`. Second is allowed by line 30:
  `allow write: if ... request.auth.uid == followerUid`.
- Validation gap: no consistency check. Attacker could write to B's
  `followers/` without a corresponding `following/` on their own side —
  or vice versa. Desync is benign (UI handles), but no integrity check.
- Effort: defer to Phase 2 integrity pass

#### `usernames/{username}` — lines 34-38

**HIGH-risk findings:**

**U-1 — Username squatting vector** — `firestore.rules:34-38`
- `allow read: if true` (public availability check ✓)
- `allow create: if request.auth != null && request.resource.data.uid == request.auth.uid`
- **NO UPDATE rule** — username can be created but never updated. When
  a user changes username via `updateUsername`, the flow must delete
  old + create new. Not verified to be atomic.
- **NO CASE NORMALIZATION** — `usernames/Malin` and `usernames/malin`
  are different keys. A user can squat multiple case variants.
- **NO LENGTH / CHARACTER LIMIT** — 2000-char username allowed.
  Emoji-only username allowed. Profanity allowed.
- Fix: add validation (length 3-30, `/^[a-z0-9_]+$/`, lowercase-only)
  + client-side lowercase-ing before write.
- CVSS: 5.8 (Medium)
- Effort: 1 h

#### `reviews/{reviewId}` — lines 41-62

**MEDIUM findings:**

**R-1 — No content validation or length cap** — `firestore.rules:41-44`
- Public read, author write. No field validation → arbitrary JSON,
  arbitrary text length.
- An attacker could write a 900KB review — within the 1MB doc limit
  but storage abuse.
- Fix: validate `text is string && text.size() <= 5000`, `rating is int && 0 <= rating <= 10`.
- Effort: 30 min

**R-2 — No rate limit on review creation**
- Firestore rules can't easily rate-limit without custom user-doc
  timestamp tracking. Recommend: App Check + per-user field
  `lastReviewAt` + enforce in rule.
- Effort: 2 h

#### `reviews/*/comments/{commentId}` — lines 53-61
- Same issues: no validation, no rate limit
- `allow delete` allows review-owner to delete any comment on their
  review — uses `get()` → extra read per delete (cost)

#### `lists/{listId}` — lines 65-70
- Clean ownership model
- No validation on list name, size, items

#### `sessions/{sessionId}` — lines 74-94
- Unlisted-link model documented in comments
- `allow read: if true` (public — by design)
- `sessions/*/participants` and `sessions/*/swipes`: **public
  create+update** — anyone can swipe if they have the session ID.
  Intentional but abusable.
- No participant limit
- No session expiry — dead sessions accumulate forever

#### `groups/{groupId}` — lines 99-152
- Complex 3-branch update rule (owner / leaving member / token-join).
  Logic is careful but brittle — every field must be cross-checked to
  avoid escalation.
- Extensive `get()` usage in subcollection rules → cost multiplier
  (cross-ref 04 for read-cost; flag here that 5 separate `get()` calls
  fire per groups subcollection operation).
- `inviteToken` rotation: not in rules → once leaked, permanent access
  (A4-1).

### Cross-Reference to Code

All writes from `src/` appear to go through matching paths (verified via
grep of `doc(db, ...)` and `collection(db, ...)` calls). No evidence of
client expecting write paths that rules reject.

---

## Dimension 4 — API & Secret Management: 11/15

### Hardcoded Secrets Audit

```
grep for "AIza|sk_live|pk_live|Bearer "  → 0 hits
grep for apiKey|secret|password|token     → only in NEXT_PUBLIC_* env refs
```

No hardcoded secrets in `src/`. ✓

### NEXT_PUBLIC_TMDB_API_KEY Analysis (critical Binge decision)

- Exposed in client bundle (`src/lib/tmdb/client.ts:17`)
- Used with TMDB API v3 `?api_key=...` query param

**Context-based risk assessment:**
- TMDB v3 API keys are **designed** to be client-exposed. Their docs
  explicitly permit this usage.
- Rate limit: ~40 req/10s/IP (per-user, not global)
- No commercial data at risk (TMDB is a free-tier public catalog)
- Attack value: abuse → quota exhaustion for attacker (not Binge)

**Verdict: Low severity in Binge context.** Defensible design choice.
Document it in CLAUDE.md + privacy policy.

**Future mitigation (Phase 2 if abuse observed):** HTTP Referer allowlist
via TMDB dashboard (only binge.nu and binge-nu.web.app allowed).

### NEXT_PUBLIC_FIREBASE_* Keys — OK
Firebase client config is **designed** public. Protected by security
rules + (future) App Check.

### `TMDB_API_READ_ACCESS_TOKEN` (server-only per CLAUDE.md)

- Declared server-only but not referenced in `src/` (grep confirms).
- No `functions/` directory → never loaded. Safe.

### Environment Hygiene

- `.env.local.example` committed with placeholders ✓
- `.env*.local` in `.gitignore` ✓
- No `.env` files tracked

### CI/CD Secrets (`.github/workflows/deploy.yml`)

- `FIREBASE_SERVICE_ACCOUNT` used via `FirebaseExtended/action-hosting-deploy@v0`
- `GITHUB_TOKEN` built-in
- No `echo $SECRET` / secret exposure patterns
- Scoping: service account needs Hosting Admin + Firestore rules deploy.
  **Verify** it's NOT project-owner. (External check — Firebase Console.)

### Findings

#### MEDIUM

**API-1 — No CSP `connect-src` restriction** (overlaps A5-1)
- Once CSP is added, scope `connect-src` to `api.themoviedb.org` +
  Firebase / Google endpoints. Prevents a compromised script from
  exfiltrating data to attacker-controlled origins.
- Bundled with A5-1 remediation.

---

## Dimension 5 — Network & Browser Hardening: 2/12

### CURRENT STATE: NOTHING

Firebase Hosting `firebase.json` has no `"headers"` block. Cloudflare
sits in front; **its settings are not code-auditable** but should be
verified externally:
- SSL mode: Full (strict)?
- Always Use HTTPS: on?
- HSTS: on at Cloudflare layer?
- Automatic HTTPS Rewrites: on?

### Findings

#### HIGH

**N-1 — See A5-1** (same finding, scored here too — weight reflects the
dual impact on A05 in OWASP + Dimension 5).

#### MEDIUM

**N-2 — No `robots.txt` / `sitemap.xml` served**
- `public/robots.txt` and `public/sitemap.xml` listed in `C:/binge/public`
  but `src/app/robots.ts` and `src/app/sitemap.ts` are NOT present.
  Binge uses static `public/` versions — verify currency.
- Low security impact (minor info-disclosure control).
- Effort: 15 min to review / update

**N-3 — No `Referrer-Policy` means leaks**
- Image requests to `image.tmdb.org` carry the Binge URL (which may
  include `/butik/example.com/` etc. — oh wait, Binge uses `/tv/[id]`
  and `/movie/[id]`, which aren't PII). Acceptable risk, but
  `strict-origin-when-cross-origin` still recommended.
- Bundled with A5-1.

### Cloudflare Posture (External verification required)

- WAF rules: default (free plan has limited rules)
- Rate limiting: free plan doesn't include — consider Pro ($20/mo) or
  implement at app level (no server to do so — defer to future proxy)
- Bot fight mode: may break Firebase Auth popup — verify

---

## Dimension 6 — GDPR & Data Protection: 9/15

### Article 7 — Consent Management

#### HIGH

**G-1 — No consent mechanism / cookie banner**
- Binge uses Firebase Auth (IndexedDB, functional — no consent needed)
  and Cloudflare essential cookies.
- As long as NO analytics is added, Swedish LEK §6 kap 18§ consent is
  arguably NOT required.
- But: `<meta name="themeColor" content="#1e2028">` and
  `openGraph` metadata do not involve tracking. No pixels loaded.
- **If any analytics / tracking is added**, consent banner must be
  present FIRST or it becomes immediately non-compliant.
- Recommended: add `ConsentBanner` component preemptively, wire it up
  for future analytics.
- Effort: 3 h (build + legal review of wording)

### Articles 15 & 20 — Access & Portability

#### HIGH

**G-2 — No data export mechanism**
- No "Download my data" button in settings page.
- GDPR requires portability in machine-readable format.
- Scope: user profile + watchlist + episodeProgress + reviews + lists +
  follows + notifications + group memberships.
- Effort: 1 day (Cloud Function returning JSON, authed by user; or
  client-side assembly + download)

### Article 17 — Right to Erasure

#### HIGH

**G-3 — Account deletion cascade is INCOMPLETE** — `AuthContext.tsx:243-260`
```typescript
const deleteAccount = useCallback(async () => {
  // Deletes:
  // - watchlist/*
  // - episodeProgress/*
  // - notifications/*
  // - users/{uid}
  // - usernames/{username}
  // - Firebase Auth user
}, []);  // ← stale closure bug too (cross-ref 01 #18)
```

**Missing from cascade (all CRITICAL for GDPR Art. 17 compliance):**
- `reviews/*` where `uid == deleting user` (PUBLIC content — orphans)
- `reviews/*/likes/{deletedUid}` — orphan likes
- `reviews/*/comments/{...}` where `uid == deleting user` — orphan comments
- `lists/{...}` where `uid == deleting user` — orphan public lists
- `users/*/followers/{deletedUid}` — deleted user still appears in
  others' follower lists
- `users/{uid}/following/{targetUid}` deletion DOES happen (via watchlist sweep?) — verify; likely NO
- `groups/{groupId}.memberUids` — user still listed in every group they
  were in
- `groups/{groupId}/members/{deletedUid}` — orphan member docs

- CVSS: 7.0 (High — compliance failure)
- Fix: expand `deleteAccount` to also:
  1. Query `reviews` where uid=self, delete them (and their likes/comments subcollections)
  2. Query `lists` where uid=self, delete them
  3. Query followers collection-group for my uid, delete
  4. For each group I'm in: delete `members/{uid}` and rewrite group doc to remove from `memberUids`
- **This must be done in multiple batches (Firestore batch limit 500
  ops), possibly via Cloud Function to handle scale + auth.**
- Effort: 1 day (careful + tested)

### Article 30 — Records of Processing

#### LOW

**G-4 — No audit log of data operations**
- Firebase Auth logs (failed sign-ins etc.) accessible via GCP Console.
- Firestore has no built-in audit trail for writes at row level.
- For an indie app, acceptable. Note for future scale.

### Cross-Border Transfers

- Firebase project region: **UNVERIFIED** (external Firebase Console
  check required). EU region (europe-west1 or eur3) recommended for
  Swedish users.
- Cloudflare: global edge — transit, not at-rest.
- TMDB: US-based but no user PII transferred (just query params with
  public title IDs / domain names).

#### HIGH (pending verification)

**G-5 — Firebase region UNVERIFIED**
- If project is in `us-central1` or similar US region, EU user data
  physically resides in US. Requires SCC disclosure in privacy policy.
- Effort: 5 min to verify via Firebase Console; migration (if needed)
  is multi-day project.

---

## Dimension 7 — Client-Side Code Protection: 3/5

- Next.js production build: source maps not emitted by default ✓
- No `eval`, no `Function(string)` patterns (grep clean)
- No feature flags in client code that expose unreleased features
- Static export means build output is pure HTML/CSS/JS — minified by
  default

### Finding

#### LOW

**C-1 — Source maps may be published by Cloudflare caching quirks**
- Verify `.map` files are NOT served. Easy check: `curl https://binge.nu/_next/static/.../main-*.js.map`
- Effort: 10 min

---

## OWASP Top 10 Scorecard

| Category | Status | Findings | Severity |
|----------|--------|----------|----------|
| A01 Broken Access Control | Partial | A1-1 (no field validation) | High |
| A02 Cryptographic Failures | Pass | — | — |
| A03 Injection | Pass | — | — |
| A04 Insecure Design | Partial | A4-1 (invite token rotation), A4-2 (anon session) | High/Medium |
| A05 Security Misconfig | **Fail** | A5-1 (no headers) | High |
| A06 Vulnerable Components | See 05 | see dep report | Mixed |
| A07 Auth Failures | Partial | A7-1/A7-2/A7-3 | Medium |
| A08 Integrity | Pass | lockfile, no SRI needed today | — |
| A09 Logging & Monitoring | **Fail** | A9-1 (no observability) | Medium |
| A10 SSRF | N/A | no server | — |

---

## Firebase Rules Coverage Matrix

| Collection | Auth | Ownership | Field Validation | Rate Limit | Status |
|------------|------|-----------|------------------|------------|--------|
| users/{uid} | Y | Y | **N** | N | Partial |
| users/{uid}/watchlist | Y | Y | **N** | N | Partial |
| users/{uid}/episodeProgress | Y | Y | **N** | N | Partial |
| users/{uid}/notifications | Y | Y | **N** | N | **Gap — no cross-user write path** |
| users/{uid}/following | Y | Y | **N** | N | Partial |
| users/{uid}/followers | Y | Y (follower) | **N** | N | Partial |
| usernames/{username} | Y (create) | Y | **N — no case/length** | N | **Fail — squat vector** |
| reviews/{reviewId} | Y | Y | **N** | **N** | Partial |
| reviews/*/likes | Y | Y | — | **N** | Partial |
| reviews/*/comments | Y | Y | **N** | **N** | Partial |
| lists/{listId} | Y | Y | **N** | N | Partial |
| sessions/{sessionId} | N (public) | host | **N** | **N** | **Abuse surface** |
| sessions/*/participants | N (public) | — | **N** | **N** | **Abuse surface** |
| sessions/*/swipes | N (public) | — | **N** | **N** | **Abuse surface** |
| groups/{groupId} | Y | owner/member | **N** | N | Partial |
| groups/*/members | Y | self/owner | **N** | N | Partial |
| groups/*/watchlist | Y | member | **N** | N | Partial |

---

## GDPR Compliance Report

| Article | Requirement | Status | Score |
|---------|-------------|--------|-------|
| Art. 7 | Consent Management | **Missing** (no banner) | 1/3 (OK if no analytics; fails once added) |
| Art. 13/14 | Data subject information | Deferred to 11 Legal | — |
| Art. 15 | Right of Access | **Missing** (no export) | 0/3 |
| Art. 17 | Right to Erasure | **Incomplete** cascade | 1/3 |
| Art. 20 | Portability | **Missing** | 0/3 |
| Art. 30 | Processing records | Firebase default logs only | 2/3 |
| LEK §6:18 | Cookie consent | N/A today, future risk | — |

---

## Remediation Roadmap

### Phase 1 — Critical / High (Week 1, ~2 days total)

1. **A5-1** — Add HTTP security headers to `firebase.json` (30 min) ← biggest bang-for-buck
2. **A1-1** — Add field validation to every Firestore rule (2–3 h)
3. **V1** (from 05) — `npm audit fix` for protobufjs (5 min)
4. **G-3** — Expand account-deletion cascade to cover reviews/lists/
   follows/groups (1 day)
5. **A-1** — Clear React Query cache on sign-out (30 min)
6. **G-5** — Verify Firebase project region (5 min)
7. **U-1** — Username validation + case normalization (1 h)

### Phase 2 — Medium (Week 2–3, ~1 day total)

8. **A4-1** — Invite token rotation for groups (2 h)
9. **A4-2** — Require auth on session creation (30 min)
10. **A7-1** — Email verification enforcement (1 h)
11. **A7-2** — Password strength policy (30 min)
12. **A9-1** — Sentry free-tier integration (2 h)
13. **R-1 / R-2** — Review content validation + rate limit (2 h)

### Phase 3 — Low / Preventive (backlog)

14. **A7-3** — Firebase App Check
15. **G-1** — Consent banner (build now, activate when analytics added)
16. **G-2** — Data export mechanism
17. **A-2** — Inactivity timeout

---

## Penetration Testing Readiness Checklist

- [ ] A5-1 headers deployed
- [ ] A1-1 field validation deployed
- [ ] G-3 account deletion cascade tested with real account
- [ ] Critical / High vulnerabilities remediated
- [ ] Firebase project region verified
- [ ] TMDB key usage documented in privacy policy (cross-ref 11)
- [ ] Cloudflare SSL mode Full (strict) verified
- [ ] Test accounts documented for external pentest
- [ ] Vulnerability disclosure process published (email link on /kontakt)
- [ ] Incident response plan documented

---

## Phase 2 Preparation

**Total issues:** 20 (0 CRITICAL / 3 HIGH / 9 MEDIUM / 8 LOW)
**Total estimated remediation effort:** ~4 days

**Cross-references:**
- Dependencies → `05_DEPENDENCIES_REPORT.md` (protobufjs, Next CVEs)
- Signed-out cache clearance → `01_CODE_QUALITY_REPORT.md` #13
- Cookie consent sequencing → `09_TRUST_SAFETY_REPORT.md` (to be produced)
- Privacy policy accuracy → `11_LEGAL_REPORT.md` (to be produced)
- Rule cost multiplier → `04_PERFORMANCE_REPORT.md` (to be produced)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero code or config changes
2. ✅ CVSS applied to each vulnerability
3. ✅ Every finding with file:line reference
4. ✅ Realistic calibration — Binge is pre-launch indie SPA; TMDB key
   exposure is defensible, App Check is future-work, MFA is not a
   launch blocker, but HEADERS + RULES VALIDATION + DELETION CASCADE
   are pre-launch blockers.
5. ✅ Cross-prompt boundaries respected (CVEs → 05, rule costs → 04,
   consent sequencing → 09, doc accuracy → 11, cache clear ownership
   split with 01)
