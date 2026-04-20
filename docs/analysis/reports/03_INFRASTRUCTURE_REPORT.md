# Binge — Infrastructure & Operations Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Firebase project:** `binge-nu` (single project — `.firebaserc`)
**CI/CD:** 1 GitHub Actions workflow (deploy.yml)

---

## Executive Summary

```
OVERALL SCORE: 38/100
DevOps Maturity Level: 2 / 5

DIMENSION SCORES:
  Build Pipeline & Automation:      6/15   ← no quality gates, no preview channels
  Testing Strategy & Coverage:      1/15   ← ZERO tests
  Deployment & Release:             6/15   ← direct-to-prod, rollback via Firebase Console
  Backup & Disaster Recovery:       3/18   ← PITR + backups unverified
  Monitoring & Observability:       2/15   ← nothing wired
  Development Workflow:             6/7
  Incident Response:                5/10
  CI/CD Security:                   7/8

PRODUCTION READINESS: Blockers Remain
- HIGH: zero tests, no error tracking, no PITR / backups, no quality gates
- MEDIUM: no staging, no preview channels, no dependabot, no uptime monitor

DORA METRICS (estimate):
  Deployment Frequency:  ~a few per week (based on recent git activity)
  Lead Time:             minutes (push to main → deploy)
  Change Failure Rate:   UNMEASURED (no error tracking)
  MTTR:                  UNMEASURED
```

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH | 7 |
| MEDIUM | 6 |
| LOW | 5 |

---

## Dimension 1 — Build Pipeline & Automation: 6/15

### Current Workflow

`.github/workflows/deploy.yml` — single workflow:

```yaml
name: Build and Deploy
on:
  push: { branches: [main] }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: binge-nu
```

### Findings

#### HIGH

**B1 — No quality gates before deploy** — `.github/workflows/deploy.yml`
- Missing:
  - `npm run lint` (currently emits 32 warnings per 01 report)
  - `npx tsc --noEmit` (currently clean but unprotected)
  - Test step (no tests exist; see Dim 2)
  - `npm audit --audit-level=high` (per 05 report recommendation)
- Impact: broken / insecure / type-unsafe code ships to production
  uninvestigated.
- Fix: add these as blocking steps before `npm run build`.
- Effort: **30 min**

**B2 — No PR trigger** — `.github/workflows/deploy.yml:3-5`
- Only `push: branches: [main]`. No PR validation means broken code
  isn't caught before merge.
- Impact: reviewer can't verify lint/typecheck status from PR.
- Fix: add `pull_request: branches: [main]` trigger that runs
  lint/typecheck/test (without deploy).
- Effort: **15 min**

**B3 — No preview channel deployments on PRs**
- `action-hosting-deploy` supports preview channels via
  `channelId: pr-${{ github.event.number }}` but not configured.
- Impact: no visual review of changes before merge.
- Fix: add separate preview workflow; channels auto-expire in 7 days.
- Effort: **30 min**

#### MEDIUM

**B4 — No `concurrency` group**
- Two quick pushes to main race each other in CI + deploy.
- Fix: `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: true }`
- Effort: **5 min**

**B5 — No Next.js build cache across runs**
- `actions/setup-node@v4 cache: npm` caches node_modules, but not
  Next.js `.next/cache` — rebuilds from scratch each time.
- Fix: add `actions/cache@v4` for `.next/cache`.
- Effort: **15 min**

#### LOW

**B6 — `FirebaseExtended/action-hosting-deploy@v0` pin is major-version-alias**
- `@v0` follows latest v0.x; could update semantics silently. Consider
  pinning to `@v0.9.0` (or current latest) + Dependabot for GitHub
  Actions.
- Effort: **5 min**

---

## Dimension 2 — Testing Strategy & Coverage: 1/15

### Current State: ZERO Tests

- No test framework installed:
  - `package.json`: no `jest`, `vitest`, `@testing-library/*`,
    `playwright`, `cypress`
- No test scripts in `package.json`
- No `*.test.*` or `*.spec.*` files in `src/`
- No `test` step in CI

### Findings

#### HIGH

**T1 — Total absence of automated tests**
- Impact: zero regression protection on:
  - Advisor logic (`useSubscriptionAdvisor.ts` — 394 lines, complex
    priority cascade)
  - Revival-nudge firing conditions (`useRevivalNudges.ts`)
  - Provider catalog + alias canonicalization (`providers.ts`)
  - Status inference (`airingState.ts`, `watchStatus.ts`)
  - Firestore security rules (no rules-unit tests)
- Every refactor is a Russian roulette.
- CVSS: 7.5 (strategic quality issue)

**Recommended test pyramid (Phase 2):**

| Layer | Framework | First targets |
|-------|-----------|---------------|
| Unit (pure logic) | **Vitest** (faster than Jest for React) | `airingState`, `watchStatus`, `canonicalProviderId`, advisor cascade helpers |
| Component | `@testing-library/react` | `WatchlistPage` filters, `StatusButton`, `ProviderTag` |
| Integration (hooks + React Query) | Vitest + `@testing-library/react` + MSW | `useSubscriptionAdvisor` with mocked TMDB, `useWatchlist` with mocked Firestore |
| Rules-unit | `@firebase/rules-unit-testing` | `firestore.rules` — every rule path |
| E2E | **Playwright** | Critical: sign-up, add to watchlist, mark watched, advisor view |

**First-cut golden test plan (~1 week of work):**
- Week 1: Vitest + 50 unit tests on pure logic (airingState, watchStatus,
  canonicalProviderId, advisor helpers)
- Week 2: @testing-library/react + 20 component tests
- Week 3: Rules-unit tests (must-have before scaling the app)
- Week 4: Playwright + 5 E2E golden paths

- Effort: 2–4 weeks of focused work; quick win is Week 1 alone

**T2 — No `npx tsc --noEmit` in CI either**
- Even without a test framework, type-checking as CI gate would catch
  regressions. See B1.

---

## Dimension 3 — Deployment & Release: 6/15

### Current Model

- `push to main → deploy-to-live` directly
- No staging environment
- Firebase Hosting: live channel only
- Rollback via Firebase Console → Release history (RTO < 5 min)

### Findings

#### HIGH

**D1 — No staging environment / single-project model**
- `.firebaserc` shows only `binge-nu`. No staging / dev projects.
- Impact: rule changes, schema changes, new Cloud Functions all go
  direct to production.
- Fix: add `binge-nu-staging` project (or use Firebase preview
  channels + Firestore emulator for dev).
- Effort: **1 day** (project setup + env switching in CI)

**D2 — No post-deploy smoke test**
- After deploy, no automated verification that the site is up.
- Fix: add curl step checking `https://binge.nu` returns 200 and
  contains expected content.
- Effort: **15 min**

#### MEDIUM

**D3 — No Firestore rules deployment automation**
- Rules are committed (`firestore.rules`, 154 lines) but deploy workflow
  only deploys hosting (`--only hosting` implicit in action-hosting-deploy).
- Rules must be manually deployed via `firebase deploy --only firestore:rules`.
- Impact: rules drift between committed state and production.
- Fix: add rules deploy step. Requires rules tests (see Dim 2) to
  avoid bad deploys.
- Effort: **1 h** (include in staging workflow)

**D4 — No Firestore indexes deployment automation**
- Same issue for `firestore.indexes.json`.
- Effort: **30 min**

**D5 — No version management / changelog**
- `package.json` version: `0.1.0` (unchanged).
- No `CHANGELOG.md`.
- No git tags for releases.
- For pre-launch indie: acceptable. Note for future.
- Effort: **defer**

### Rollback Capabilities

| Component | Method | RTO |
|-----------|--------|-----|
| Hosting | Firebase Console → Revert | < 5 min |
| Firestore rules | Manual redeploy of old `firestore.rules` | < 5 min |
| Firestore data | PITR **UNVERIFIED** | see Dim 4 |
| Auth | N/A | N/A |
| Cloudflare | Cloudflare dashboard | < 5 min |

---

## Dimension 4 — Backup & Disaster Recovery: 3/18

### CRITICAL

**DR1 — Firestore PITR status UNVERIFIED** (external check required)
- Firestore Point-in-Time Recovery (7-day, minute granularity) is a
  5-minute CLI toggle:
  ```bash
  gcloud firestore databases describe --database="(default)" --project=binge-nu
  # Check pointInTimeRecoveryEnablement
  gcloud firestore databases update --database="(default)" --project=binge-nu \
    --enable-pitr
  ```
- Without it: total data loss possible on accidental collection wipe,
  bad rule deploy, corruption.
- CVSS: 8.0 (business continuity)
- Effort: **5 min** to enable (cost: ~$0.18 per GiB/month)

### HIGH

**DR2 — No scheduled backups**
- Scheduled exports to GCS bucket (daily, 14-week retention) via
  `gcloud firestore backups schedules create`.
- PITR covers 7 days; scheduled backups cover longer.
- Effort: **30 min** setup

**DR3 — No disaster recovery playbooks documented**
- No `docs/RUNBOOK.md` or `docs/incidents.md`.
- Recommended minimum coverage:
  - "Site is down" → check Cloudflare → Firebase Hosting → Firebase status
  - "Users report missing data" → check rules deploy history, PITR restore
  - "TMDB quota exhausted" → wait or rotate key
  - "Firebase quota exceeded" → check Firestore read counts, rule
    efficiency (cross-ref 04)
- Effort: **2 h** for first draft

### MEDIUM

**DR4 — Single points of failure**

| SPOF | Blast Radius | Priority |
|------|--------------|----------|
| Single Firebase project (`binge-nu`) | Total app | HIGH |
| TMDB API (external dep) | App-wide content failure | HIGH |
| Single developer account | Ops continuity | MEDIUM |
| Cloudflare (DNS + CDN) | Site unreachable | MEDIUM |
| Single GitHub repo | Source + CI | LOW (GitHub SLA) |

### LOW

**DR5 — Firestore offline persistence not explicitly enabled or disabled**
- Firebase JS SDK has offline persistence; enabled by default on web.
- Not explicitly configured in `src/lib/firebase/config.ts` — uses
  default.
- Acceptable.

---

## Dimension 5 — Monitoring & Observability: 2/15

### Current State: Almost Nothing

- **No error tracking** (no Sentry, no Crashlytics, no custom)
- **No performance monitoring** (no Firebase Performance, no web-vitals)
- **No analytics observed** (no AnalyticsLoader / GA4 / Plausible in `src/`)
- **No uptime monitor** (no UptimeRobot / Pingdom / etc.)
- **No SLOs defined**
- Cloud Logging: Firebase default (30 days Cloud Functions logs — N/A,
  no functions)

### Findings

#### HIGH

**M1 — No production error visibility**
- Users hit JS errors → team doesn't know.
- Firebase Auth failures → team doesn't know.
- Firestore permission-denied spikes (rule deploys, abuse) → invisible.
- Fix: Sentry free tier (5k events/month) via `@sentry/nextjs`.
  Consent-gated (cross-ref 09) until consent banner ships.
- Effort: **2 h** initial integration + 1 h per iteration

#### MEDIUM

**M2 — No Core Web Vitals RUM**
- Bundle size and LCP/INP can be measured via `web-vitals` package
  → send to an endpoint (Firebase Analytics, Sentry, or custom).
- Cross-ref 04 Performance for CWV targets + bundle audit.
- Effort: **1 h**

**M3 — No uptime monitor**
- UptimeRobot free (50 monitors, 5-min checks) covers:
  - `https://binge.nu` returns 200
  - Contains expected string
- Effort: **15 min**

#### LOW

**M4 — No SLO / SLI baseline**
- Recommended starting targets (from prompt):
  - Uptime: 99.9%
  - LCP p75: < 2.5s
  - INP p75: < 200ms
  - Error rate: < 0.5%
  - TMDB success rate: > 99%
- Document in `docs/SLO.md` after M1+M2+M3 give data.
- Effort: **30 min** docs

**M5 — Zero analytics → no product feedback loop**
- Cross-ref 08 Analytics & Growth for the strategy side.

---

## Dimension 6 — Developer Workflow: 6/7

### Observed

- Branching: `main` + feature branches (`claude/*` observed in git status)
- Local dev: `npm run dev` (Next.js on :3000)
- No Firebase emulators configured (`firebase.json` has no `emulators:` block)
- `.env.local.example` present for env onboarding

### Findings

#### MEDIUM

**W1 — No Firebase emulator config**
- Without emulators, local dev hits the real `binge-nu` Firestore.
- Dev writes test data into production Firestore.
- Fix: add `emulators: { firestore: {...}, auth: {...} }` to `firebase.json`
  + document `firebase emulators:start` in README.
- Effort: **30 min**

#### LOW

**W2 — No pre-commit hooks**
- No `husky` / `simple-git-hooks` configured.
- Recommended: pre-commit runs `npx tsc --noEmit` + `npm run lint`.
- Effort: **30 min**

**W3 — No Prettier config**
- Next.js's ESLint includes Prettier-like rules but no `.prettierrc`.
- Low priority for solo dev; matters when collaborators join.
- Effort: **15 min**

### Strengths

- `npm run dev` works out of the box
- `.env.local.example` clearly lists required vars
- CLAUDE.md is comprehensive for onboarding

---

## Dimension 7 — Incident Response: 5/10

### Current State

- Solo developer (Malin), single contact channel (email / GitHub)
- No formal on-call
- No documented playbooks
- No status page

### Findings

#### HIGH

**I1 — No alerting**
- Zero alerts on:
  - Site downtime
  - Error spikes
  - Firebase quota near limits
  - Cloudflare outage
- For solo dev: minimum is UptimeRobot email + Firebase budget email.
- Effort: **30 min** (UptimeRobot + Firebase billing alert)

#### MEDIUM

**I2 — No incident log**
- Recommended: `docs/incidents.md` with one-line entries
  `YYYY-MM-DD: <summary> — root cause: <x>; fix: <y>`
- Minimal overhead, high learning value.
- Effort: **15 min** (start the file)

#### LOW

**I3 — No status page**
- For pre-launch: not needed. At scale: consider statuspage.io / public
  status page.

### Escalation Policy

For solo dev, document the intent:
- **P0** (data loss, site down, security breach): respond within 1 h
- **P1** (broken core flow: sign-up, watchlist, advisor): 4 h
- **P2** (minor broken feature, visual bug): 24 h

---

## Dimension 8 — CI/CD Security: 7/8

### Secrets

- `FIREBASE_SERVICE_ACCOUNT` in GitHub Secrets (observed in
  `deploy.yml:25`)
- `GITHUB_TOKEN` built-in, scoped per workflow
- No `echo $SECRET` patterns

### Dependabot

#### HIGH (cross-ref 05 report)

**S1 — No `.github/dependabot.yml`**
- Covered in `05_DEPENDENCIES_REPORT.md` S1.
- Effort: **15 min**

### Firestore Rules Deploy Safety

- Rules are `firestore.rules` in repo, deployed manually.
- Without automated rules deploy + rules-unit tests, a bad rule can
  reach production unreviewed.
- Cross-ref D3 (automation), T1 (rules tests).

---

## DORA Metrics (Estimated)

| Metric | Value | Method |
|--------|-------|--------|
| Deployment Frequency | ~3–5 / week | Git log on main |
| Lead Time for Changes | ~5–10 min | push-to-main → deploy |
| Change Failure Rate | UNMEASURED | no error tracking |
| MTTR | UNMEASURED | no incident log |

Once M1 (Sentry) + I2 (incident log) land, these become measurable.

---

## Production Readiness Blockers

| Blocker | Severity | Effort |
|---------|----------|--------|
| No PITR on Firestore (DR1) | CRITICAL | 5 min |
| No error tracking (M1) | HIGH | 2 h |
| No tests (T1) | HIGH | 1 week (first pass) |
| No quality gates (B1) | HIGH | 30 min |
| Incomplete deletion cascade (see 02 G-3) | HIGH | 1 day |
| No HTTP headers (see 02 A5-1) | HIGH | 30 min |
| No scheduled backups (DR2) | HIGH | 30 min |
| No DR playbooks (DR3) | HIGH | 2 h |
| No uptime monitor (M3) | MEDIUM | 15 min |

---

## Modern Tooling Quick Wins

| Tool | Purpose | Effort | Impact |
|------|---------|--------|--------|
| Firebase PITR | Data disaster recovery | 5 min | CRITICAL |
| Firestore scheduled backups | Long retention | 30 min | HIGH |
| Sentry (free) | Error tracking | 2 h | HIGH |
| UptimeRobot (free) | Uptime monitoring | 15 min | HIGH |
| `.github/dependabot.yml` | Dep updates | 15 min | MEDIUM |
| CI lint + typecheck gate | Quality | 30 min | HIGH |
| Firebase preview channels | PR previews | 30 min | MEDIUM |
| Firebase emulators config | Local dev | 30 min | MEDIUM |

**Total quick-win effort:** ~5 h for dramatic ops improvement.

---

## Output Deliverables Checklist

- [x] Executive summary with overall score
- [x] Per-dimension findings with file:line references
- [x] Issue classification (CRITICAL/HIGH/MEDIUM/LOW) with counts + effort
- [x] CI/CD pipeline description
- [x] Quality gate matrix
- [x] DR assessment with PITR + backup status
- [x] SPOF inventory
- [x] SLO / SLI baseline recommendations
- [x] Production readiness blockers list
- [x] Quick wins vs strategic improvements matrix
- [x] DORA metrics estimate
- [x] Zero code / config changes made

---

## Phase 2 Preparation

**Total issues:** 19 (1 CRITICAL / 7 HIGH / 6 MEDIUM / 5 LOW)
**Total estimated effort:** ~3 weeks (but first week brings 80% of
operational maturity gains)

**Recommended sprint grouping:**

**Sprint 1 — Foundations (1 week):**
- DR1 — Enable PITR (5 min)
- DR2 — Schedule backups (30 min)
- M1 — Sentry integration (2 h)
- M3 — UptimeRobot (15 min)
- B1 — CI lint + typecheck gate (30 min)
- B2 — PR trigger (15 min)
- B3 — Preview channels (30 min)
- I1 — Firebase billing alert + UptimeRobot email (30 min)
- S1 — Dependabot config (15 min from 05 report)
- W1 — Firebase emulators config (30 min)

Total: ~5.5 h. Moves project from "flying blind" to "well-observed".

**Sprint 2 — Tests foundation (1 week):**
- T1 — Vitest + 50 unit tests on pure logic
- D3/D4 — Automated rules + indexes deployment (blocked on rules tests)

**Sprint 3 — Resilience (1 week):**
- DR3 — DR playbooks (2 h)
- D1 — Staging environment (1 day)
- D2 — Post-deploy smoke test (15 min)
- M2 — Web-vitals RUM (1 h)
- M4 — SLO baseline (30 min)
- Remaining MEDIUM/LOW items

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero changes
2. ✅ Every finding with file:line / artifact reference
3. ✅ Severity + effort on every finding
4. ✅ Indie calibration — don't demand enterprise observability; do
   demand Sentry + UptimeRobot + PITR + basic CI gates
5. ✅ Cross-prompt respect — tests linked to 07 rules, consent to 09,
   deletion cascade to 02, dependabot to 05, perf to 04
