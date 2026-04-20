# Binge — Legal Review — Juridisk Granskning — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Disclaimer:** "Du är inte jurist och ger inte juridisk rådgivning" —
systematic review, not legal advice.

---

## Executive Summary

```
OVERALL SCORE: 22/100
├── Privacy Policy Presence & Accuracy:     0/25   ← DOES NOT EXIST
├── ToS & Community Guidelines:             0/12   ← DO NOT EXIST
├── TMDB Attribution & Terms Compliance:    5/15   ← attribution missing from UI
├── License Compliance:                    10/12   ← all OSS OK, no licenses page
├── Provider Data & Pricing Accuracy:       3/8    ← hand-maintained, no disclaimer
├── Consent Purpose Alignment:              8/10   ← no consent yet, structure clean
├── Firebase & Hosting Compliance:          5/10   ← region unverified
├── Account Lifecycle & Erasure:            1/8    ← incomplete cascade

STATUS: Critical Discrepancies — Binge is NOT legally launch-ready.
         Privacy policy, ToS, TMDB attribution, and account-deletion
         cascade are all non-negotiable.
```

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 5 |
| MEDIUM | 6 |
| LOW | 4 |

### Top 5 Legal Risks

1. **No privacy policy.** GDPR Art. 13/14 violation by omission.
2. **No Terms of Service.** Sign-up without user acceptance means no
   enforceable contract.
3. **TMDB attribution text missing from UI.** Violation of TMDB API ToS
   — could result in API key revocation (i.e., app shutdown).
4. **Account deletion cascade incomplete.** GDPR Art. 17 violation for
   orphaned reviews/comments/lists/follows/group memberships.
5. **Firebase data residency UNVERIFIED.** EU-user data may be in US
   region → SCC disclosure required, currently not disclosed.

---

## Dimension 1 — Privacy Policy Presence & Accuracy: 0/25

### CRITICAL

**PP-CRIT — No privacy policy exists**

```
grep / find results:
  src/app/integritet/   — no directory
  src/app/privacy/      — no directory
  docs/legal/           — no directory
  public/privacy*       — no file
  public/integritet*    — no file
```

**Legal obligation:** GDPR Art. 13/14 requires privacy information at
data collection. Swedish Dataskyddslagen enforces. The Swedish data
protection authority (IMY) can fine up to 4% of global turnover or
€20M.

**What Binge collects (from code analysis):**
- Email (via Firebase Auth)
- Display name (Google OAuth; user-set)
- Username (user-set, public)
- `myProviders` (TMDB provider IDs — not personal per se but connects
  to profile)
- `providerCosts`, `providerPauses` (subscription pricing preferences)
- Watchlist items (titles user tracks — reveals viewing patterns)
- Episode progress (detailed viewing)
- Reviews, ratings, notes, lists (user-generated content)
- Followers / following (social graph)
- IP addresses (via Firebase / Cloudflare logs)

**Privacy policy must disclose ALL of the above** + third-party
processors + data transfer basis + user rights + retention periods +
contact info + supervisory authority (IMY).

**Fix:** draft a Swedish-language privacy policy. Minimum scope:
1. Who we are (name, contact)
2. What data we collect (list above)
3. Why (legal basis: contract for auth/watchlist; legitimate interest
   for analytics if later)
4. Who we share with (Firebase/Google, Cloudflare, TMDB)
5. Data transfer basis (SCCs for Firebase if US-located)
6. User rights (access, rectification, erasure, portability,
   objection)
7. Retention (how long)
8. Children (13+ Swedish implementation)
9. Contact / rättelse path
10. IMY as supervisory authority

**Effort:** **1 week** for self-drafted + AI-assisted + community review.
**3–5 days** if professional translator + lawyer. Publish at `/integritet`.

---

## Dimension 2 — ToS & Community Guidelines: 0/12

### CRITICAL

**TOS-CRIT — No Terms of Service exists**

No `/villkor` route. No legal document defining:
- Age requirement (should be 13 per Swedish GDPR Art. 8)
- Jurisdiction (should be Swedish law, Swedish courts)
- User content ownership + Binge's license to display
- Account termination process (rules-side already allows; legal side
  must document)
- Prohibited use policy
- Service availability disclaimer (uptime, third-party dependencies)
- Liability limitations
- Change-notice process
- TMDB attribution (required by TMDB ToS — cross-ref Dim 3)

**Fix:** draft Swedish-language ToS alongside privacy policy.
- Effort: **1 week** (parallel with PP-CRIT)

### CRITICAL (related)

**CG-CRIT — No Community Guidelines**

Binge has public UGC (reviews, comments, lists, usernames). Without
community guidelines:
- No reference for "guideline violation"
- No basis for content removal if Binge ever wants to moderate
- Users can't understand expectations

**Fix:** short Swedish-language document covering:
- Respectful communication
- No spam / advertising / illegal content
- No impersonation
- No doxxing / personal info leak
- Enforcement: warnings, content removal, account suspension
- Appeals path (rättelse)

**Effort:** **2 h** content + **1 h** UI link from social surfaces.

### Acceptance Mechanism

**TOS-2 — No acceptance checkpoint at sign-up**

`src/app/login/page.tsx` sign-up form has no:
- Checkbox "Jag godkänner [Villkor] och [Integritetspolicy]"
- Timestamp-versioned acceptance record

**Fix:** once PP-CRIT + TOS-CRIT ship, add acceptance UI.

**Effort:** **1 h** after docs exist.

---

## Dimension 3 — TMDB Attribution & Terms Compliance: 5/15

### Required Attribution (per CLAUDE.md line 58)

> "This product uses the TMDB API but is not endorsed or certified
>  by TMDB"

### Findings

#### CRITICAL

**TMDB-CRIT — Attribution text NOT present in UI**

```
grep "TMDB API" src/  → 0 matches
grep "TMDB\|themoviedb" src/ | grep -v "import\|tmdbFetch\|tmdbId" → nothing user-visible
```

- **This is an explicit term of TMDB's API license.** Non-compliance
  can cause TMDB to revoke the API key (= app shutdown, all titles
  become "unknown").
- **Cross-ref 07 T-1** — flagged there, also flagged here with legal
  severity.

**Fix:**
- Add to footer / About / Settings, visible without login:
  "Binge använder TMDB:s API men är inte godkänd eller certifierad
   av TMDB. Filmdata kommer från themoviedb.org."
- Swedish translation acceptable per TMDB ToS provided meaning preserved.
- Add TMDB logo adjacent (download from themoviedb.org/about/logos-
  attribution).
- Link text: "Data från TMDB" → https://www.themoviedb.org/

**Effort:** **30 min** implementation + 15 min verify.

#### MEDIUM

**TMDB-2 — Image hosting ✓ (no local copies)**
- Verified in `client.ts:14` — images from `image.tmdb.org`. No
  redistribution / rehosting. ✓

**TMDB-3 — TMDB v3 API key usage ✓**
- Cross-ref 02 API-1 + 07 — TMDB docs permit client-side v3 keys.
  Defensible design choice.

**TMDB-4 — Caching / redistribution**
- Binge caches watchlist item metadata (title, posterPath, providers,
  tmdbStatus) in Firestore per-user. This is user-specific persistence,
  not bulk caching. Acceptable per typical interpretation of TMDB ToS
  (which allows reasonable caching for user experience).
- Not a violation. Flagged for transparency.

#### LOW

**TMDB-5 — Commercial use**
- Current Binge is free. If monetization adds (cross-ref 10), check
  TMDB commercial terms. Currently no explicit commercial-tier
  requirement observed in TMDB docs for v3, but verify if a paid
  Binge plan ships.

---

## Dimension 4 — License Compliance: 10/12

### Dependency Licenses (from 05 report)

All direct dependencies MIT/Apache-2.0/ISC. Zero GPL/AGPL. ✓

### Font Licenses

`globals.css` uses system font stack (`system-ui, -apple-system, "Segoe UI", sans-serif`).
No webfont imports, no license obligations. ✓

### Icon Licenses

`lucide-react` is ISC. Permissive. No attribution obligation strict. ✓

### Asset Licenses

`/public/`:
- `robots.txt` — text, no license
- `sitemap.xml` — text, no license
- `mockups/*.html` (untracked) — design references, not production

No TMDB images copied locally. All served from `image.tmdb.org`. ✓

### Findings

#### LOW

**LIC-1 — No open-source licenses page in app**
- Binge doesn't ship source to end users (it's a hosted web service).
  So Apache-2.0 NOTICE redistribution doesn't apply at the user-facing
  level.
- Goodwill recommendation: add `/open-source` or footer link listing
  dependencies + their licenses. Modern best practice + developer
  goodwill.
- Effort: **2 h** (auto-generate via `license-checker` output)

**LIC-2 — Missing license headers in source**
- Binge's own code has no license header. Status of Binge's license:
  unspecified (private repo / proprietary presumably).
- Not a requirement for private SaaS. Noted.

---

## Dimension 5 — Provider Data & Pricing Accuracy: 3/8

### Pricing Data (`src/lib/tmdb/providers.ts`)

Hand-maintained prices for 19 Swedish providers, including multi-tier
listings:
- Netflix: Basic 109, Standard 149, Premium 199
- Viaplay: reklam 79, standard 169, medium 399, total 699
- HBO Max: ads 89, standard 149, premium 189
- (etc.)

### Legal Implications

Binge makes claims about third-party business pricing. Inaccurate
claims could:
- Mislead users (Swedish consumer protection concern via Marknadsföringslagen)
- Draw complaints from providers (trademark / brand misuse — low risk
  since it's informational, not disparaging)

### Findings

#### HIGH

**PRI-1 — Prices are hand-maintained with no "last verified" date**

No comment in `providers.ts` documenting when prices were last verified.
Streaming providers change pricing quarterly.

**Fix:**
1. Add header comment: `// Prices last verified: YYYY-MM-DD. Review quarterly.`
2. Add UI disclaimer on pages showing provider costs (advisor, savings):
   "Priserna är hämtade från respektive tjänst och uppdateras regelbundet,
    men kontrollera alltid aktuellt pris på tjänstens hemsida."
3. Link each provider in the catalog to its official website.

**Effort:** **1 h** initial + **30 min / quarter** review.

#### MEDIUM

**PRI-2 — Savings claims in advisor**
- Advisor output: "Du kan spara 149 SEK/månad om du pausar Netflix i 2 månader."
- If the user's actual Netflix tier cost is different (e.g., they're
  on family plan split with others), the savings claim is wrong for them.
- Current: `user.providerCosts` overrides when set (good), otherwise
  default from catalog.
- Fix: add "Uppskattad besparing" ("estimated saving") Swedish language
  to outputs. Makes the claim advisory not absolute.
- Effort: **1 h** copy updates.

#### LOW

**PRI-3 — Trademark usage (brand names + colors)**
- Binge uses provider names (Netflix, Disney+, etc.) and brand colors.
- Legal position: nominative fair use — using names to refer to the
  service is permitted under EU trademark law (CTM Directive).
- Colors are fact (from brand guidelines) — permitted.
- No logos self-hosted → no copyright concern (TMDB images
  cross-ref 07).
- ✓ Acceptable use.

---

## Dimension 6 — Consent Purpose Alignment: 8/10

### Current State

No consent mechanism exists yet (cross-ref 02 G-1, 09 C-1). When added,
proposed purposes:

| Purpose | What it gates | Required? |
|---------|---------------|-----------|
| essential | Auth + Firestore (for signed-in users) | always (contract basis) |
| functional | User preferences, UI state | always |
| analytics | Plausible / GA4 event logging | consent required |
| marketing | Future email campaigns | consent required |
| socialFeatures | Public profile, public reviews | toggle (already via `isPublic`) |

### Findings

#### LOW

**CON-1 — When consent is added, purposes must map to real implementations**
- For Phase 2. Currently clean slate.
- Effort: design consent UI to match implementation (**1 day** when
  adding consent).

---

## Dimension 7 — Firebase & Hosting Compliance: 5/10

### Data Residency

#### HIGH

**FH-1 — Firestore region UNVERIFIED (cross-ref 02 G-5 / 09 T-1)**
- `.firebaserc` only contains project ID (`binge-nu`), no region.
- Critical legal implication: if project is in US region, EU user data
  resides in US → Google DPA + SCCs apply.
- Privacy policy must state the actual location.
- Fix: verify via Firebase Console. If US, document in privacy policy.
  If migration desired: new project + data migration (multi-week
  project, not recommended mid-launch unless high sensitivity).
- Effort: **5 min** verify; weeks if migration.

### DPA Acceptance

#### MEDIUM

**FH-2 — Google / Firebase DPA acceptance status UNVERIFIED**
- Default with GCP project, but should be confirmed at organization
  level in GCP Console → IAM & Admin → Identity → Data Processing Addendum.
- Effort: **5 min** verify + document.

**FH-3 — Cloudflare DPA acceptance status UNVERIFIED**
- Cloudflare Dashboard → Settings → Data Processing Agreement.
- Effort: **5 min** verify + document.

### Security Headers

**FH-4 — No HTTP security headers (cross-ref 02 A5-1)**
- Legal impact: no direct GDPR requirement, but defense-in-depth expected
  by auditors.
- Bundled with 02 A5-1.

### Cookies Documented

**FH-5 — Cookie inventory must be disclosed in privacy policy**
- Current functional cookies:
  - `__cf_bm`, `__cflb` (Cloudflare)
  - Firebase Auth iframe cookies (rare)
- When added later:
  - Analytics cookies per chosen provider
- Bundled with PP-CRIT.

---

## Dimension 8 — Account Lifecycle & Erasure: 1/8

### Findings

#### HIGH

**LC-1 — Account deletion cascade incomplete (cross-ref 02 G-3)**

`AuthContext.tsx:243-260` deletes:
- watchlist, episodeProgress, notifications
- users/{uid}
- usernames/{username}
- Firebase Auth user

Misses (GDPR Art. 17 violation):
- Reviews by user
- Review likes by user
- Comments by user
- Lists owned by user
- Follower records on OTHER users
- Following records (bidirectional)
- Group memberships
- Tillsammans sessions hosted by user

**Fix:** expand cascade — multi-batch due to 500-op limit, possibly
Cloud Function. See 02 G-3 remediation.

**Effort:** **1 day** careful implementation + testing.

### Data Export

**LC-2 — No data export mechanism (cross-ref 02 G-2, 10 F-1)**
- GDPR Art. 15/20 requires portability in machine-readable format.
- Binge has no "Download my data" button in settings.
- Effort: **1 day** (JSON export of all user-scoped data).

### Retention

#### MEDIUM

**LC-3 — No documented retention policy**
- Binge retains everything indefinitely. GDPR principle of storage
  minimization suggests defined retention.
- Recommended:
  - Session data (Tillsammans): 90 days (ephemeral by design)
  - Notifications: 180 days
  - Inactive accounts: 3 years since last sign-in → anonymize / warn
  - Audit logs (when added): 2 years
- Document in privacy policy.
- Effort: policy decision + doc **30 min** + future cleanup code.

### Anonymization Policy

#### MEDIUM

**LC-4 — Public content policy post-deletion**
- Currently: account deletion removes public content (reviews, lists).
- Alternative: anonymize (replace uid with "deleted_user") to preserve
  context for other users reading the thread.
- Decision needed; document in ToS + privacy.
- Effort: design decision + docs.

---

## Master Checklist

```
PRIVACY POLICY
[ ] Privacy policy document exists (Swedish + English)
[ ] Data controller identity present
[ ] Data categories collected listed accurately
[ ] Legal basis per processing activity
[ ] Third-party processors listed (Firebase, Cloudflare, TMDB)
[ ] Data transfer basis stated (SCCs if Firebase is US-located)
[ ] User rights mechanism described (access, rectification, erasure)
[ ] Retention periods stated
[ ] Minimum age (13) stated
[ ] Contact / rättelse path
[ ] IMY as supervisory authority named
[ ] Accessible from UI (footer + sign-up + settings)
[ ] Cookie usage documented

TERMS OF SERVICE
[ ] ToS document exists
[ ] Age requirement (13+) stated
[ ] Jurisdiction (Swedish law)
[ ] User content ownership clause
[ ] License grant to Binge (non-exclusive)
[ ] Account termination + data retention on termination
[ ] Prohibited uses
[ ] Service availability disclaimer
[ ] Liability limitations
[ ] Change process
[ ] Accessible from sign-up + footer

COMMUNITY GUIDELINES
[ ] Document exists (Swedish primary)
[ ] Covers UGC categories (reviews, comments, lists, groups)
[ ] Prohibited behaviors enumerated
[ ] Enforcement + appeals described
[ ] Accessible from UGC creation points

TMDB COMPLIANCE
[ ] Attribution text visible in UI (footer / about)
[ ] Swedish translation matches meaning ("Binge använder TMDB:s API men är inte godkänd eller certifierad av TMDB")
[ ] TMDB logo displayed
[ ] No TMDB data redistribution
[ ] v3 API key usage (confirmed)

LICENSES
[ ] Dependencies are permissive (MIT/Apache/ISC) — confirmed
[ ] No GPL/AGPL in production code — confirmed
[ ] Apache-2.0 NOTICE forwarded at binary distribution — N/A (SaaS)
[ ] Open-source-licenses page in app — nice-to-have

CONSENT MODEL (when added)
[ ] Granular purposes mapped to implementation
[ ] Opt-in by default
[ ] Withdrawal mechanism
[ ] Version tracking for re-consent on policy change

FIREBASE / HOSTING
[ ] Firebase project region verified (prefer EU)
[ ] Google DPA accepted
[ ] Cloudflare DPA accepted
[ ] Security headers present (cross-ref 02 A5-1)
[ ] Cookies inventory documented in privacy policy

ACCOUNT LIFECYCLE
[ ] Account deletion button in settings
[ ] Deletion cascade covers ALL user-scoped data
[ ] Firebase Auth user deletion triggered
[ ] Data export (JSON) mechanism
[ ] Anonymization-vs-deletion policy defined
[ ] Inactive account retention policy

PROVIDER CLAIMS
[ ] Price disclaimer in UI
[ ] Hyperlinks to provider websites
[ ] Internal quarterly review checklist
```

---

## Top 10 Issues Quick Reference

| # | Severity | Title | Location | Effort |
|---|----------|-------|----------|--------|
| 1 | CRITICAL | No privacy policy | (missing) | 1 week |
| 2 | CRITICAL | No Terms of Service | (missing) | 1 week (parallel) |
| 3 | CRITICAL | TMDB attribution missing from UI | UI (footer/about) | 30 min + ToS update |
| 4 | HIGH | Account deletion cascade incomplete | `AuthContext.tsx:243-260` | 1 day |
| 5 | HIGH | Firebase region UNVERIFIED | External check | 5 min |
| 6 | HIGH | No community guidelines | (missing) | 2 h |
| 7 | HIGH | No data export (GDPR Art. 20) | (missing) | 1 day |
| 8 | HIGH | Provider pricing no "last verified" + no UI disclaimer | `providers.ts` + UI | 1 h |
| 9 | MEDIUM | No acceptance mechanism at sign-up | `src/app/login/page.tsx` | 1 h |
| 10 | MEDIUM | Retention policies not defined | docs | 30 min |

---

## Phase 2 Preparation

**Total issues:** 18 (3 CRITICAL / 5 HIGH / 6 MEDIUM / 4 LOW)
**Total estimated effort:** ~2 weeks (dominated by privacy policy + ToS)

**Sprint 1 — Legal docs sprint (1–2 weeks):**
- PP-CRIT + TOS-CRIT + CG-CRIT — draft all three Swedish-language
  documents (parallel workstream)
- TMDB-CRIT — add attribution text to UI (30 min)
- FH-1 — verify Firebase region (5 min)
- LC-1 — expand account deletion cascade (1 day)

**Sprint 2 — UX integration (3 days):**
- TOS-2 — sign-up acceptance flow (1 h)
- Footer + settings legal links (30 min)
- PRI-1 — price disclaimer + quarterly-review note (1 h)
- LIC-1 — open-source licenses page (2 h)

**Sprint 3 — Data handling hygiene (2 days):**
- LC-2 — data export mechanism (1 day)
- LC-3 / LC-4 — retention + anonymization policy decisions + docs (2 h)
- FH-2 / FH-3 — verify DPA acceptance (15 min)

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero changes
2. ✅ NOT legal advice — systematic findings only
3. ✅ Swedish legal context — GDPR + Dataskyddslagen + LEK + IMY
4. ✅ Cross-prompt dedup — GDPR implementation → 02 / 09; TMDB
   attribution present in 07 also
5. ✅ Realistic severity — pre-launch indie; 3 CRITICALs are
   non-optional before public launch
6. ✅ Accuracy over completeness — docs don't exist, so "accuracy vs
   code" is 0/9 for most items
