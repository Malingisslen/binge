# Binge — Trust, Safety & Advanced Privacy Compliance Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20

---

## Executive Summary

```
OVERALL SCORE: 49/100
├── UGC Moderation Capability:             8/18   ← no report/block/rate-limit
├── Cookie Consent & Tracking Transparency: 14/20  ← cookie-free today (no analytics) → dormant risk
├── SDK Consent Sequencing:                10/12   ← no SDKs fire non-essentially
├── Data Transfer Compliance:               5/12   ← Firebase region UNVERIFIED
├── Privacy/ToS/CG Accessibility:           2/10   ← NO legal documents
├── Children's Data Protection:             1/8    ← no age gate
├── Community Guidelines & Spam:            3/10   ← zero rate limits
└── Third-Party Script & Iframe Discipline: 6/10

STATUS: Gaps Found — clean consent posture today (no analytics),
         BUT: legal documents missing + Firebase region unverified +
         no age gate = launch-blockers under Swedish consumer law.
```

| Severity | Count |
|----------|-------|
| CRITICAL | 2 (legal docs, age gate) |
| HIGH | 5 |
| MEDIUM | 6 |
| LOW | 4 |

---

## Dimension 1 — UGC Moderation Capability: 8/18

### UGC Surface (from `firestore.rules`)

- **Reviews** (public read, author write) — reviews/{reviewId}
- **Comments** on reviews (authed create, author/review-owner delete)
- **Lists** (public if isPublic)
- **Usernames** (public read)
- **User profiles** (public if isPublic)
- **Group names** (member-read)
- **Tillsammans sessions** (unlisted-link)
- **Notes on watchlist** (private to user)

### Findings

#### HIGH

**M-1 — No report mechanism** — no Firestore collection `reports`
- Search: zero "report" / "flagga" UI components
- Zero "reports" Firestore collection
- Required by reality of public UGC: some users will post abusive
  reviews, offensive usernames, or misuse Tillsammans.
- Fix: add `reports/{reportId}` collection + UI on reviews/comments
  + admin-only Firestore Console for triage.
- Effort: **1 day**

**M-2 — No block/mute mechanism**
- User A can follow user B. User B cannot block user A.
- Fix: `users/{uid}/blocked/{targetUid}` subcollection + filter at
  read time.
- Effort: **1 day**

**M-3 — No rate limits on UGC creation** — `firestore.rules` (all
  user-content paths)
- A user can post 10,000 reviews in a minute (only limited by
  network).
- Firestore rules don't support per-time-window limits natively; needs
  per-user counter doc + rule check, or Cloud Function.
- Fix: Phase 2, not blocking for tiny scale.
- Effort: **2 h** for rule-based throttle (per-user `lastReviewAt` field)

#### MEDIUM

**M-4 — No content length / type validation in rules**
- Cross-ref 02 A1-1 — zero field validation anywhere. A malicious user
  can post a 900 KB review (technically under 1 MB doc limit).
- Bundled with 02 A1-1 remediation.

**M-5 — No profanity / Swedish scam-phrase filter**
- For an indie app of this scale, server-side filter is over-engineering.
  But: manual review via admin access + reporting (M-1) covers cases.
- Defer.

**M-6 — No "admin UID" concept**
- If a review must be removed, only the review author can delete it
  via rules. The admin (Binge dev) can only delete via Firestore
  Console (admin SDK).
- Document this in `docs/moderation.md` as the operational path.
- Effort: **30 min** docs

### Strengths

- UGC surface is intentionally limited: no replies, no threads, no
  global comment feed. Easier to moderate at this scale.
- Tillsammans sessions are unlisted-link: voting is local to whoever
  has the link, not public discourse.

---

## Dimension 2 — Cookie Consent & Tracking Transparency: 14/20

### Current Cookie / Storage Inventory

**Confirmed:**
- **Firebase Auth**: IndexedDB (tokens) — NOT cookies, NOT consent-
  requiring (essential)
- **Cloudflare** (when serving traffic): `__cf_bm`, `__cflb` (functional
  / bot-management) — EU-generally-accepted-essential
- **App localStorage** (if any): not audited in depth

**Not present:**
- ZERO analytics cookies (no analytics integrated — cross-ref 08 E-CRIT)
- No tracking pixels
- No marketing / retargeting
- No third-party script that sets cookies

### Findings

#### GOOD — Privacy baseline today

Binge is currently **compliant-by-default** with Swedish LEK §6 kap 18§
because no non-essential cookies are set. This can stay true indefinitely
if Plausible (cookie-free) is chosen per 08 report recommendation.

#### MEDIUM

**C-1 — No ConsentBanner component exists** — Dormant risk
- If Firebase Analytics / GA4 / any tracking is added later, ABSENT
  consent banner = immediate GDPR violation.
- Fix (Phase 2, build preemptively):
  - Add `ConsentBanner.tsx` with Accept / Reject
  - Granular categories: essential / analytics (start with just these)
  - Persist decision in localStorage
  - Reject = "non-essential SDKs never load"
  - Versioning: bump version when policy changes → re-prompt
- Effort: **3 h** build + **1 h** legal-wording review (cross-ref 11)

**C-2 — No "withdraw consent" / privacy control UI**
- Even without active tracking, a future-facing settings section
  "Integritet och cookies" would be a trust signal.
- Effort: **1 h** after C-1

#### LOW

**C-3 — No GPC / Do-Not-Track respect**
- No code reads `navigator.doNotTrack` or GPC signal.
- When analytics lands, auto-decline on DNT/GPC is good practice.
- Effort: **15 min** when analytics lands.

---

## Dimension 3 — SDK Consent Sequencing: 10/12

### Init Order (Providers.tsx)

```
QueryClientProvider (in-memory, essential)
  → AuthProvider (Firebase Auth, essential)
    → WatchlistProvider (Firestore, essential)
      → ToastProvider (in-memory, essential)
        → children
```

All essential. No consent-requiring SDK loaded. ✓

### Findings

#### LOW

**S-1 — Forward-looking: if GA4 / Firebase Analytics added, init must be
gated**
- Pattern for Phase 2:
  - Default consent state: denied
  - Load Firebase Analytics ALWAYS but call
    `setAnalyticsCollectionEnabled(false)` by default
  - Flip to true ONLY after user accepts in ConsentBanner
- If Plausible (cookie-free, GDPR-exempt per most interpretations) is
  chosen: no gating needed.
- Document in CLAUDE.md.
- Effort: **1 h** when analytics lands.

---

## Dimension 4 — Data Transfer Compliance: 5/12

### Third-Party Data Processor Inventory

| Service | Data Sent | Location | DPA | Basis |
|---------|-----------|----------|-----|-------|
| Google Firebase (Auth, Firestore, Hosting) | User data, scan data | **UNVERIFIED region** | Google DPA standard | SCCs + DPA |
| TMDB (api.themoviedb.org) | Query params (tmdbId, title ids) | US | No Binge-specific DPA | Not required — no PII |
| Cloudflare | Proxy traffic, IP, UA | Global edge | Cloudflare DPA | SCCs |
| Lucide icons | N/A (client-side bundled) | — | — | — |

### Findings

#### HIGH

**T-1 — Firebase region UNVERIFIED** — must check externally
- `.firebaserc` shows `binge-nu` project but no region.
- Critical: if project is in `us-central1` or similar US region, EU
  user data physically resides in US.
- Mitigation if US: Google DPA + SCCs cover it, but requires disclosure
  in privacy policy + higher latency for Swedish users.
- Preferred: `europe-west1` / `europe-west3` / `eur3`.
- Fix: verify via Firebase Console → Firestore → Location. If US,
  plan migration (Firestore location cannot be changed after creation —
  requires creating new project + migration).
- Effort: **5 min** verification; **weeks** if migration needed.

#### MEDIUM

**T-2 — IP address handling not disclosed**
- IP addresses are personal data under GDPR.
- Firebase Functions (if deployed later) would log client IPs.
- Firebase Auth and Firestore may log IPs server-side for security.
- Cloudflare logs IPs at the edge.
- Privacy policy (when it exists — cross-ref 11) must disclose.
- Effort: cross-ref 11

**T-3 — TMDB data flow — minor concern**
- Binge sends: API key + query params (title ID, search term).
- What if a user searches for their own name? "john doe" → TMDB
  receives "john doe" query (low privacy impact — they might also
  find no results).
- Low risk. No PII transferred beyond incidental search strings.
- Effort: 0

---

## Dimension 5 — Privacy/ToS/CG Accessibility: 2/10

### Current State

```
grep for "integritet\|villkor\|terms\|privacy" in src/app:
  → 0 route files

public directory:
  → robots.txt, sitemap.xml, no legal documents
```

NO LEGAL DOCUMENTS EXIST.

### Findings

#### CRITICAL

**L-CRIT — NO privacy policy, NO terms of service, NO community guidelines**
- Binge is a Swedish consumer service processing personal data (email,
  username, watchlist).
- GDPR Art. 13/14 requires privacy information at data collection.
- Swedish Dataskyddslagen enforces.
- EU e-commerce law § 3 requires contact info, company info, etc.
- LAUNCH BLOCKER for public launch with users.
- Fix: create `/integritet`, `/villkor`, `/community-guidelines` routes
  with full content.
- Cross-ref 11 Legal for document authoring scope.
- Effort: **1 week** for legally-reviewed Swedish documents. Could be
  AI-drafted + human-reviewed for faster iteration. If lawyer available:
  quicker.

#### HIGH

**L-2 — No acceptance mechanism on sign-up**
- Typical pattern: checkbox + links to ToS + PP.
- `src/app/login/page.tsx` — sign-up form would need:
  - "Genom att skapa ett konto godkänner du våra [Villkor] och vår
    [Integritetspolicy]" with working links.
- Currently: sign-up has no explicit acceptance step.
- Fix: add after L-CRIT.
- Effort: **1 h**

**L-3 — Footer / settings link to legal absent**
- Layout / AppShell has no footer observed in shown files.
- Footer or settings-page section linking to Privacy / Terms is
  standard + legally required.
- Effort: **30 min** after L-CRIT

---

## Dimension 6 — Children's Data Protection: 1/8

### Current State: NO Age Handling

- No date-of-birth on sign-up
- No "confirm you are 13+" checkbox
- No special handling for minors

### Findings

#### CRITICAL

**Children-CRIT — NO age gate / age verification**
- Swedish digital-consent age per GDPR Art. 8 national implementation:
  **13 years**
- Under 13: parental consent required (unless Swedish exception —
  Sweden actually implements Art. 8 at age 13, the lower bound of the
  13-16 range EU states can choose).
- Binge is general consumer service; children might use it.
- Without any age capture:
  - Under-13 users sign up unknowingly
  - Binge processes their data without parental consent
  - GDPR violation if challenged
- Fix (minimum): checkbox "Jag är 13 år eller äldre" at sign-up.
- Better: date-of-birth with local-only validation (don't store).
- CVSS-equivalent: HIGH (compliance)
- Effort: **30 min** (checkbox) + privacy-policy update

#### LOW

**Children-2 — App scoring for age-appropriateness: none**
- No "mature content" filter on TMDB calls. Child user can search for
  and see adult-titled content.
- This is content-filter territory; TMDB has content ratings.
- Low priority unless a child-safe mode is a positioning goal.
- Effort: defer

---

## Dimension 7 — Community Guidelines & Spam: 3/10

### Current State: NONE

- No community guidelines document
- No spam prevention mechanisms
- No rate limits on any UGC
- No cooling-off periods for new accounts

### Findings

#### HIGH

**CG-1 — No community guidelines**
- Required to set expectations + enable enforcement action.
- Without them, "this user violated guidelines" has no reference.
- Fix: draft `/community-guidelines` page. Short is fine:
  > "Binge ska vara ett trovärdigt och trevligt verktyg.
  >  Följ detta:
  >  - Var respektfull
  >  - Posta inte spam, reklam, eller olagligt innehåll
  >  - Tillskansa dig inte andras identitet
  >  - ..."
- Cross-ref L-CRIT.
- Effort: **2 h** docs

**CG-2 — No rate limits** (cross-ref 02 A-1 + M-3)
- Already flagged. Here: for moderation perspective.

#### LOW

**CG-3 — Username content restriction**
- Cross-ref 02 U-1. Relevant here from community angle: a username
  like "hitler_rules" survives because there's no filter.
- Bundled with 02 U-1.

---

## Dimension 8 — Third-Party Script & Iframe Discipline: 6/10

### External Scripts

```
grep for <script src="http..." → 0
next/script usage → not found via grep
```

No external scripts loaded. ✓ (Analytics is absent per 08.)

### Iframes

No `<iframe>` usage observed. Trailer embeds (YouTube) commonly used
on detail pages — verify if present.

### Findings

#### MEDIUM

**TP-1 — TMDB trailer embed status unknown**
- `getMovie` / `getTVShow` append `videos` in TMDB response. If
  Binge embeds YouTube trailers:
  - Use `youtube-nocookie.com/embed/{id}` (not `youtube.com/embed/{id}`)
  - Cookieless until playback
  - Saves one consent-surface.
- Audit `MoviePageClient.tsx` + `TVShowPageClient.tsx` for iframe usage.
- Effort: **30 min** audit; 15 min fix if any.

**TP-2 — TMDB image requests leak Referer**
- Without `Referrer-Policy: strict-origin-when-cross-origin` (cross-ref
  02 A5-1), every image request to `image.tmdb.org` carries the full
  Binge page URL.
- Privacy minor (TMDB sees user's navigation pattern via Referer).
- Bundled with 02 A5-1 security-headers remediation.

#### LOW

**TP-3 — No `<meta name="referrer">` in layout**
- Could explicitly set `strict-origin-when-cross-origin` at HTML level
  as belt-and-braces.
- Bundled with 02 A5-1.

---

## Compliance Dashboard

| Requirement | Status | Severity |
|-------------|--------|----------|
| Cookie banner (if tracking) | N/A today (no tracking) | MEDIUM (dormant) |
| Reject-button on banner | N/A | — |
| Consent withdrawal UI | N/A | LOW |
| SDK consent-gated | N/A (no SDKs) | — |
| Firestore EU region | **UNVERIFIED** | HIGH |
| Privacy policy exists | ✗ | CRITICAL |
| Terms of service exists | ✗ | CRITICAL |
| Community guidelines exists | ✗ | HIGH |
| Acceptance at sign-up | ✗ | HIGH |
| Age gate (13+) | ✗ | CRITICAL |
| UGC report mechanism | ✗ | HIGH |
| UGC block mechanism | ✗ | HIGH |
| Rate limits on UGC | ✗ | MEDIUM |
| YouTube embed uses nocookie.com | UNVERIFIED | MEDIUM |
| Referrer-Policy header | ✗ (part of 02 A5-1) | HIGH |
| Contact email on site | UNVERIFIED | HIGH |
| IP handling disclosed | ✗ (no policy exists) | CRITICAL-dependent |

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | CRITICAL | NO privacy policy / ToS / community guidelines | (missing) | 1 week docs |
| 2 | CRITICAL | No age gate for users under 13 | `src/app/login/page.tsx` | 30 min |
| 3 | HIGH | Firebase region UNVERIFIED | External check | 5 min |
| 4 | HIGH | No UGC report mechanism | Firestore + UI | 1 day |
| 5 | HIGH | No UGC block mechanism | Firestore + UI | 1 day |
| 6 | HIGH | Sign-up missing T&C acceptance | `src/app/login/page.tsx` | 1 h |
| 7 | HIGH | Referrer-Policy missing (cross-ref 02 A5-1) | `firebase.json` | — |
| 8 | MEDIUM | No ConsentBanner (dormant risk) | (build preemptively) | 4 h |
| 9 | MEDIUM | YouTube embed nocookie.com verification | detail pages | 30 min |
| 10 | MEDIUM | No rate limits on UGC (cross-ref 02) | `firestore.rules` | — |

---

## Phase 2 Preparation

**Total issues:** 17 (2 CRITICAL / 5 HIGH / 6 MEDIUM / 4 LOW)
**Total estimated effort:** ~2 weeks (dominated by docs authoring)

**Sprint 1 — Legal docs + age gate (1 week):**
- L-CRIT — privacy policy + ToS + community guidelines (Swedish)
  (1 week — depends on lawyer or AI-draft + human review)
- Children-CRIT — age checkbox at sign-up (30 min)
- L-2 — T&C acceptance at sign-up (1 h)
- L-3 — footer / settings legal links (30 min)
- T-1 — verify Firebase region (5 min)

**Sprint 2 — UGC infrastructure (1 week):**
- M-1 — report mechanism (1 day)
- M-2 — block mechanism (1 day)
- CG-1 — community guidelines content (2 h)
- C-1 — ConsentBanner component preemptively (4 h)
- TP-1 — YouTube nocookie verification (30 min)

**Sprint 3 — Hardening (1 day):**
- M-3 — rate limits on reviews/comments (2 h)
- Moderation runbook (`docs/moderation.md`) (30 min)
- Follow-ups from 02 A5-1 headers land (bundled)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero changes
2. ✅ File:line references where applicable
3. ✅ EU / Swedish calibration — LEK, Dataskyddslagen, e-commerce law
4. ✅ Cross-prompt dedup — SSRF / rules field validation → 02;
   document wording → 11; analytics consent gating → 08
5. ✅ Dormant risks flagged (consent banner becomes critical the day
   analytics lands)
