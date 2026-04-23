# Binge — Executive Synthesis — Phase 1 Complete

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Scope:** All 11 analysis dimensions from `docs/analysis/prompts/`

---

## Overall Weighted Score: 52 / 100

**Rating:** Acceptable — prioritized remediation within 2 sprints.

Per-prompt (raw) × weight:

| # | Prompt | Raw | Weight | Weighted |
|---|--------|-----|--------|----------|
| 01 | Code Quality & Architecture | 78 | 13% | 10.1 |
| 02 | Security & Compliance | 56 | 12% | 6.7 |
| 03 | Infrastructure & Operations | 38 | 6% | 2.3 |
| 04 | Performance & Scalability | 60 | 10% | 6.0 |
| 05 | Dependencies & Supply Chain | 64 | 5% | 3.2 |
| 06 | UX, Design & i18n | 70 | 15% | 10.5 |
| 07 | TMDB Integration & Recommendation | 61 | 15% | 9.2 |
| 08 | Product Analytics & Growth | 18 | 5% | 0.9 |
| 09 | Trust, Safety & Privacy | 49 | 5% | 2.5 |
| 10 | Monetization & Competitive | 48 | 7% | 3.4 |
| 11 | Legal Review | 22 | 7% | 1.5 |
| **Total** | — | — | **100%** | **56.3** |

Final weighted score: **56** (rounds to "Acceptable — but with
launch-blockers that must be addressed").

---

## Top-Level Diagnosis

### What's Working ✅

- **Code hygiene is excellent.** Zero `any`, zero `@ts-ignore`, zero
  TODOs, zero `console.log`. TypeScript strict clean. Zero test-but
  careful conventions elsewhere. (01)
- **Code organization is coherent.** Next.js 14 App Router used
  correctly. 24 well-scoped hooks. 3 contexts. Shared-component patterns
  (WatchlistPage, MediaTypePage). (01)
- **Swedish positioning is consistent.** Domain vocabulary
  (`följer`/`vill_se`/`sedd`), Swedish UI strings, CLAUDE.md-aligned
  design tokens. (06)
- **Core product features exist.** Tracking, discovery, social
  (groups + Tillsammans + reviews), advisor, revival nudges. (10)
- **Provider catalog is thoughtful** — 19 providers with tiers,
  ads-pricing awareness, TV4 Play alias. (07)
- **Privacy-by-default today** — no analytics, no non-essential cookies.
  Clean starting point. (09)
- **Design rules largely followed.** No shadows, no rounded-lg, 13px
  base, system font stack. (06)

### What's Broken 🚨

| Finding | Prompt | Severity |
|---------|--------|----------|
| **No privacy policy / ToS / community guidelines** | 11 L-CRIT / 09 L-CRIT | CRITICAL |
| **No age gate (Swedish GDPR Art. 8 = 13+)** | 09 Children-CRIT | CRITICAL |
| **Zero analytics** — product development is blind | 08 E-CRIT | CRITICAL |
| **TMDB attribution text missing from UI** (ToS violation) | 07 T-1 / 11 TMDB-CRIT | CRITICAL |
| **Accessibility baseline missing** (WCAG 2.1 AA — EAA in force 2025-06-28) | 06 A-CRIT | CRITICAL |
| **No PITR on Firestore** — total data loss risk | 03 DR1 | CRITICAL |
| **canonicalProviderId not used at 18+ sites** (TV4 alias bug) | 07 P-CRIT | CRITICAL |
| **1 CVE-CRITICAL on protobufjs** | 05 V1 | CRITICAL |
| No HTTP security headers (`firebase.json`) | 02 A5-1 | HIGH |
| Account deletion cascade incomplete (GDPR Art. 17) | 02 G-3 / 11 LC-1 | HIGH |
| Firebase region UNVERIFIED | 02 G-5 / 11 FH-1 | HIGH |
| Zero tests | 03 T1 | HIGH |
| signOut doesn't clear React Query cache | 01/02 | HIGH |
| Context values not memoized (3 contexts) | 01 | HIGH |
| GroupPageClient.tsx is 908-line god-component | 01 | HIGH |

**Summary of blockers: 8 CRITICAL + 7 HIGH = 15 launch-critical items.**

---

## Severity Aggregation

| Severity | Total count across prompts |
|----------|---------------------------|
| CRITICAL | 10 (across 6 prompts) |
| HIGH | 50 |
| MEDIUM | 75 |
| LOW | 55 |
| **Total** | **~190 findings** |

Individual report severity breakdowns:

```
01 Code Quality:     0 CRIT / 5 HIGH / 11 MED / 8 LOW
02 Security:         0 CRIT / 3 HIGH / 9 MED / 8 LOW  (CVSS not all-CRIT)
03 Infrastructure:   1 CRIT / 7 HIGH / 6 MED / 5 LOW
04 Performance:      0 CRIT / 4 HIGH / 9 MED / 5 LOW
05 Dependencies:     1 CRIT / 4 HIGH / 4 MED / 3 LOW
06 UX/Design/i18n:   1 CRIT / 6 HIGH / 10 MED / 7 LOW
07 TMDB:             1 CRIT / 5 HIGH / 10 MED / 6 LOW
08 Analytics:        1 CRIT / 6 HIGH / 6 MED / 3 LOW
09 Trust/Safety:     2 CRIT / 5 HIGH / 6 MED / 4 LOW
10 Monetization:     0 CRIT / 4 HIGH / 8 MED / 5 LOW
11 Legal:            3 CRIT / 5 HIGH / 6 MED / 4 LOW
```

---

## Top 10 Risks (Cross-Prompt, Priority-Ordered)

| # | Risk | Source | Severity | Effort | Launch Blocker? |
|---|------|--------|----------|--------|-----------------|
| 1 | No privacy policy / ToS / community guidelines | 09, 11 | CRITICAL | 1 week | **YES** |
| 2 | `canonicalProviderId` bug breaks "mine" filter for TV4 Play alias | 07 | CRITICAL | 2 h | **YES** — core product broken |
| 3 | TMDB attribution missing from UI (can trigger API key revoke) | 07, 11 | CRITICAL | 30 min | **YES** |
| 4 | Zero analytics → cannot measure anything product-wise | 08 | CRITICAL | 1 day | **YES** (can't iterate without) |
| 5 | Accessibility baseline missing (EAA enforced 2025-06-28) | 06 | CRITICAL | 3-5 days | **YES** for Swedish legal |
| 6 | No age gate | 09 | CRITICAL | 30 min | **YES** (GDPR Art. 8) |
| 7 | No PITR on Firestore | 03 | CRITICAL | 5 min | **YES** (data loss risk) |
| 8 | Protobufjs CRITICAL CVE (moderate exploitability) | 05 | CRITICAL | 5 min | **YES** |
| 9 | Account deletion cascade incomplete (GDPR Art. 17) | 02, 11 | HIGH | 1 day | **YES** (legal) |
| 10 | No HTTP security headers | 02 | HIGH | 30 min | strongly recommended |

---

## Unified Remediation Roadmap

### Sprint 1 — Launch Blockers (1–2 weeks, ~60 h of focused work)

**Day 1 — Quick wins (~3 h):**
- [ ] `npm audit fix` → resolves protobufjs CVE (5 min)
- [ ] Enable Firestore PITR via gcloud (5 min)
- [ ] Verify Firebase region via Firebase Console (5 min)
- [ ] Add HTTP security headers to `firebase.json` (30 min)
- [ ] Add TMDB attribution text + logo to footer/about (30 min)
- [ ] Add age-gate checkbox to `/login` sign-up form (30 min)
- [ ] Fix `signOut` to call `queryClient.clear()` (30 min)
- [ ] Fix `canonicalProviderId` usage at 18+ call sites (2 h — this is
      the biggest correctness bug)

**Day 2 — Context/re-render fixes (~3 h):**
- [ ] Memoize AuthContext provider value (1 h)
- [ ] Memoize WatchlistContext / ToastContext provider values (45 min)
- [ ] Fix `deleteAccount` stale closure on `user.username` (30 min)
- [ ] Fix `useEpisodeProgressWithSync` missing deps (30 min)

**Days 3–7 — Legal docs sprint (~1 week):**
- [ ] Draft Swedish privacy policy (covers GDPR Art. 13/14)
- [ ] Draft Swedish Terms of Service
- [ ] Draft Swedish community guidelines
- [ ] Wire up sign-up T&C acceptance checkbox
- [ ] Add footer + settings legal links
- [ ] Publish at `/integritet`, `/villkor`, `/community-guidelines`

**Days 8–10 — Account deletion + security hardening (~2 days):**
- [ ] Expand account deletion cascade (reviews, lists, follows, groups,
      comments, likes) — 1 day
- [ ] Field validation on all Firestore rules (2-3 h)
- [ ] Username validation + case normalization (1 h)

**Days 11–13 — Accessibility baseline (~3 days):**
- [ ] Audit 141 `onClick` sites for semantic element correctness
- [ ] Add `aria-label` to icon-only buttons
- [ ] Add skip-to-content link
- [ ] Color-contrast audit → palette migrations for `text-muted`/`accent` body-text usage
- [ ] Add `aria-live` to ToastContext
- [ ] Add `prefers-reduced-motion` respect

**Day 14 — Analytics + design-rule cleanup (~4 h):**
- [ ] Integrate Plausible analytics (1 day total but can start this day)
- [ ] Tag core events (signed_up, title_added_watchlist, advisor_viewed,
      revival_nudge_shown) (2-3 h)
- [ ] Remove landing-page gradient (5 min — `src/app/page.tsx:29`)
- [ ] Remove TitleCard hover-transform (5 min)
- [ ] Replace generic "Något gick fel" with specific copy (2 h)

**Sprint 1 exit criteria:** all 10 top risks addressed. Binge is
minimally launch-legal.

### Sprint 2 — Strategic quality (1–2 weeks)

- [ ] Add test framework (Vitest) + 36 unit tests on pure logic (1 week)
- [ ] CI quality gates (lint + typecheck + tests + audit) (30 min after
      tests exist)
- [ ] Sentry free tier + UptimeRobot (2.5 h)
- [ ] Dependabot config (15 min)
- [ ] Firestore scheduled backups (30 min)
- [ ] Firebase emulators config for local dev (30 min)
- [ ] Decompose `GroupPageClient.tsx` (908 lines) (6-8 h)
- [ ] Decompose `WatchlistPage.tsx` (614 lines) (4-6 h)
- [ ] Firestore rule cost fix — denormalize `isPublic` (1 day)
- [ ] Add `limit()` + `useInfiniteQuery` on unbounded lists (1 day)
- [ ] TMDB rate-limit handling + AbortSignal threading (3 h)
- [ ] TMDB advisor fan-out staggering (4 h)
- [ ] Data export mechanism (GDPR Art. 20) (1 day)
- [ ] Images: lazy-load + size-right + srcSet for 28 img sites (1 day)
- [ ] CLAUDE.md updates (drift: static export, auth state, staleTime) (30 min)

### Sprint 3 — Growth + polish (1 week)

- [ ] Dynamic sitemap + per-page metadata + Schema.org JSON-LD (1.5 days)
- [ ] Guided onboarding flow (2 days)
- [ ] Open Graph image + Twitter card (30 min)
- [ ] UGC report mechanism (1 day)
- [ ] UGC block mechanism (1 day)
- [ ] Provider catalog HBO Max / Max alias unification + verification (1 h)
- [ ] Advisor documentation — PrimaryAction state transitions (2 h)
- [ ] Dark mode tokens + implementation (3-5 days — or defer)

---

## Cost / Effort Summary

| Sprint | Scope | Total Effort |
|--------|-------|-------------|
| Sprint 1 | Launch blockers | ~60 h (~2 weeks focused) |
| Sprint 2 | Strategic quality | ~80 h (~2-3 weeks) |
| Sprint 3 | Growth + polish | ~40 h (~1 week) |
| **Total to launch-and-grow-ready** | | **~5-6 weeks focused solo work** |

**Minimum viable launch (Sprint 1 only):** 2 weeks focused work.

---

## Strengths Worth Preserving

Don't let remediation regress these:

1. **Clean TypeScript + zero escape hatches.** Keep the strict bar.
2. **Zero commented-out code + zero TODOs.** Rare for indie. Keep it.
3. **CLAUDE.md discipline.** Design rules + Swedish positioning +
   guidelines. Update drift but don't dilute.
4. **Domain vocabulary (`följer`/`vill_se`/`sedd`).** Signature language.
5. **Shared components (WatchlistPage, MediaTypePage, ProviderTag).**
   Discipline pays off.
6. **No premature native app.** Web-first keeps the team focused.
7. **No analytics until consent banner ready.** Privacy-by-default.
8. **Rule-based advisor (no LLM).** Transparent + defensible +
   maintainable.

---

## Strategic Questions for Product Decisions

These came up during analysis — defer-decisions require answers:

1. **Monetization model?**
   - Recommend: free + donations (Ko-fi / Swish) near-term.
   - Freemium requires 2-3 weeks infrastructure (Cloud Functions, paywall,
     billing). Premature pre-launch.

2. **Import from Trakt / Letterboxd / IMDb?**
   - Required to acquire power users. 3-5 days effort. Prioritize in
     Sprint 2 if power-user acquisition is the strategy.

3. **Native mobile apps?**
   - Defer until DAU justifies. Months-scale investment.

4. **Nordic expansion (Norway / Denmark / Finland)?**
   - Requires provider catalog + UI translation. Consider after Swedish
     market fit.

5. **Public API (Knowledge-API style)?**
   - Cross-ref 10 Monetization prompt. For Binge, less obvious revenue
     path than for synat.se. Defer.

6. **HBO Max (provider_id 384) vs Max (1899) unification?**
   - Post-2024 rebrand. Are they the same service in TMDB? Requires
     empirical check. Alias if yes.

---

## Success Criteria After Sprint 1

Binge is **launch-legal** when:
- [ ] All 10 CRITICAL findings resolved
- [ ] Account deletion cascade covers all user-scoped data
- [ ] Privacy policy + ToS + community guidelines published
- [ ] Age gate at sign-up
- [ ] TMDB attribution visible in UI
- [ ] Security headers deployed
- [ ] Firebase PITR enabled
- [ ] `canonicalProviderId` bug fixed (core product works correctly)
- [ ] Firebase region documented
- [ ] Analytics integrated with consent (Plausible recommended —
      cookie-free, no consent banner needed initially)
- [ ] Accessibility baseline: skip-link + aria-labels + contrast fixes

Binge is **sustainable to operate** when:
- [ ] Sentry catches production errors
- [ ] UptimeRobot alerts on downtime
- [ ] Tests gate deploys (block regressions)
- [ ] Firestore PITR + scheduled backups active
- [ ] Incident playbooks documented

Binge is **competitive** when:
- [ ] Data export / import (power-user retention)
- [ ] Dynamic SEO (long-tail intent traffic)
- [ ] OG image for social share
- [ ] Funnel analytics showing activation
- [ ] Advisor clickthrough proven valuable

---

## Reports Produced

All 11 detailed reports in `docs/analysis/reports/`:

- `01_CODE_QUALITY_REPORT.md`
- `02_SECURITY_REPORT.md`
- `03_INFRASTRUCTURE_REPORT.md`
- `04_PERFORMANCE_REPORT.md`
- `05_DEPENDENCIES_REPORT.md`
- `06_UX_DESIGN_AND_I18N_REPORT.md`
- `07_TMDB_INTEGRATION_REPORT.md`
- `08_ANALYTICS_AND_GROWTH_REPORT.md`
- `09_TRUST_SAFETY_AND_PRIVACY_REPORT.md`
- `10_MONETIZATION_AND_COMPETITIVE_REPORT.md`
- `11_LEGAL_REPORT.md`
- `00_EXECUTIVE_SYNTHESIS.md` (this file)

Total report output: ~12,000 lines of markdown.

---

## Methodology Reminders

- **Phase 1 is investigation only** — zero code changes have been made
  to the binge repo. Only `docs/analysis/reports/` were added.
- **Reports are Phase 1 deliverables**, not Phase 2 fixes. Each finding
  has severity + effort to inform prioritization.
- **Realistic calibration** applied throughout — Binge is a pre-launch
  indie SPA. Enterprise conventions (SBOM, MFA, canary rollouts) were
  not demanded. Indie-appropriate standards (Dependabot, Sentry, PITR,
  basic tests) were.
- **Cross-prompt deduplication** respected — each finding is owned by
  exactly one prompt; others reference and defer.

---

**End of Phase 1.**
**Phase 2 (remediation planning) ready to begin when you decide to
start execution.**
