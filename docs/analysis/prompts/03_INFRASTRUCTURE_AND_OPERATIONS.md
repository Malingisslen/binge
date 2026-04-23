# Infrastructure & Operations Analysis

**Prompt**: 03 of 11
**Analyst**: Claude (Opus 4.7)
**Consolidates**: CI/CD Analysis, Testing Analysis, Monitoring Analysis, Disaster Recovery Analysis, Dev Workflow Analysis

## Mission

Perform a comprehensive DevOps lifecycle audit of the Binge Next.js / Firebase
Hosting application covering build automation, test strategy, deployment
pipeline, monitoring infrastructure, disaster recovery, and developer workflow.
This investigation evaluates operational maturity across the full software
delivery and production operations lifecycle for a small indie SPA.

The scope is deliberately lighter than a large enterprise audit — Binge has
one deploy workflow, one Firebase project, and no Cloud Functions. But the
same fundamentals apply: can we deploy safely, recover from disaster, and
observe what's happening in production?

## Two-Phase Approach

### Phase 1: Investigation and Documentation (THIS PHASE)

Document everything, change nothing.

- Investigate all 8 dimensions systematically
- Document findings with file:line references
- Build inventories, diagrams, and matrices
- ZERO code changes, ZERO pipeline modifications, ZERO configuration changes
- Output: Complete analysis report with scored findings

### Phase 2: Smart Remediation Planning (AFTER Phase 1 Complete)

- Review ALL Phase 1 findings
- Prioritize improvements by impact, effort, and risk
- Create phased implementation plan with cost estimates
- Plan with minimal disruption to current workflow

DO NOT START PHASE 2 UNTIL PHASE 1 IS COMPLETE.

## Cross-Prompt Boundaries

- **Firebase security rules analysis**: Covered in prompt 02. Reference only.
- **Firestore schema, queries, indexing**: Covered in prompt 04. Skip here.
- **Dependency CVEs and licenses**: Covered in prompt 05. Skip here.
- **Design-rule compliance**: Covered in prompt 06. Skip here.
- **Test coverage and strategy**: Owned by THIS prompt.
- **CI/CD pipeline design**: Owned by THIS prompt.
- **Monitoring and observability**: Owned by THIS prompt.
- **Disaster recovery (PITR, backups)**: Owned by THIS prompt.

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), TypeScript, static export intended
Deployment model:    Firebase Hosting (static files) + Cloudflare CDN
Firebase project:    binge-nu (single project, verified in .firebaserc and
                     in deploy.yml: projectId: binge-nu)
Hosting config:      firebase.json — public: "out",
                     rewrites: [{ source: "**", destination: "/_/index.html" }]
CI/CD platform:      GitHub Actions — ONE workflow (.github/workflows/deploy.yml)
                     Trigger: push to main
                     Steps: checkout → setup-node 20 → npm ci → npm run build
                       → FirebaseExtended/action-hosting-deploy@v0 (live channel)
                     Secrets: GITHUB_TOKEN (built-in), FIREBASE_SERVICE_ACCOUNT

No other workflows. No test workflow. No lint-only check on PRs.

Linting:             .eslintrc.json extends [next/core-web-vitals, next/typescript]
                     (no custom rules configured)
TypeScript:          strict: true (tsconfig.json)
Test framework:      NONE (no jest, vitest, playwright, cypress configured
                     in package.json; no test files in repo)

Firebase services in use:
  - Hosting (public: "out")
  - Firestore (rules: 154 lines; indexes: 53 lines)
  - Authentication (partial integration)
  NOT used:
  - Cloud Functions (no functions/ directory)
  - Firebase Storage (no storage.rules; images from TMDB CDN)
  - Cloud Messaging / FCM
  - Remote Config
  - Performance Monitoring
  - Crashlytics
  - Firebase App Check

External services:
  - TMDB API v3 (client-side, NEXT_PUBLIC_TMDB_API_KEY)
  - Cloudflare (DNS, CDN, SSL, WAF unknown)

Environment / secrets:
  - .env.local (gitignored, developer-local)
  - .env.local.example (committed, placeholder values)
  - GitHub Secrets: GITHUB_TOKEN, FIREBASE_SERVICE_ACCOUNT

Known gaps observed (to be confirmed during investigation):
  - No staging environment / no dev-prod separation
  - No PR preview channels on Firebase Hosting (could add via
    action-hosting-deploy with channelId: pr-${{ github.event.number }})
  - No rollback plan documented
  - No PITR / scheduled backups configured on Firestore
  - No observability (Sentry, Crashlytics, LogRocket, etc.)
  - No uptime monitoring (UptimeRobot, Checkly, etc.)
  - No health-check endpoint
  - No DORA metric tracking

Generated / ignored files (skip during analysis):
  - .next/, node_modules/, out/, .firebase/
```

---

## Dimension 1: Build Pipeline & Automation (15 points)

### Investigation Scope

Build automation, CI configuration, build performance, artifact management.

### Investigation Tasks

**1.1 GitHub Actions Workflow Audit**

Audit the single workflow (.github/workflows/deploy.yml):

```yaml
name: Build and Deploy
on:
  push:
    branches: [main]
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

Document:
- Trigger conditions: only push to main (no PR triggers — CRITICAL gap for
  a team workflow; MEDIUM for a solo developer — cross-ref Dimension 6)
- No test step, no lint step, no typecheck step — failures ship to prod
- `npm ci` uses package-lock.json → deterministic builds ✓
- Action pinned to @v4 / @v0 — verify no breaking changes since adoption
- FirebaseExtended/action-hosting-deploy@v0 — the @v0 is a major-version
  alias (like @v4 for checkout); verify GitHub's recommendation here
- Concurrency: no `concurrency:` group set — two pushes to main in quick
  succession race each other

**1.2 Build Performance**

Analyze:
- Cold build (no cache): rough estimate
- Warm build (npm cache hit): rough estimate
- Bundle size from `.next/` output (defer detailed size to 04 Performance)
- Next.js build time vs npm install time breakdown

Identify optimization opportunities:
- Next.js caching (Vercel-style build cache not used on Firebase) — can
  we add Next.js cache directory to actions/cache beyond npm?
- Parallel steps? (Currently sequential)
- Matrix jobs (e.g., run lint in parallel with build)?

**1.3 Quality Gates**

CRITICAL: no quality gates currently.

Recommended gates (for Phase 2):
- `npm run lint` must pass
- `npx tsc --noEmit` must pass
- `npm run build` must succeed
- Test suite (when added) must pass
- Security scan (npm audit --production, Dependabot alerts)

Current state: none blocks merge / deploy.

**1.4 PR Preview Channels**

Firebase Hosting supports preview channels via
`FirebaseExtended/action-hosting-deploy` with `channelId: pr-NN`.

Currently not configured. This means:
- No way to review a PR visually before merge
- No way to share a test URL with stakeholders

Effort: ~30 min config addition for Phase 2.

**1.5 Concurrency & Caching**

- No `concurrency:` group → two pushes can race
- Recommend: `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: true }`

**1.6 Static Export Constraint**

next.config.mjs has `output: 'export'` COMMENTED OUT (per CLAUDE.md) because
dynamic routes don't work without a catch-all pre-rendering strategy.

Current build output is a Next.js server build deployed as static (via
Firebase Hosting's static model). This is a hybrid that relies on the
catch-all `/_/index.html` rewrite.

Investigate:
- Is the build output correct for this serving model?
- Does `out/` contain only HTML/JS/CSS, or also server bundles that never execute?
- Any wasted bytes from server-only code?
- Is there a cleaner deployment config (fully static export with catch-all)?

---

## Dimension 2: Testing Strategy & Coverage (15 points)

### Investigation Scope

Test execution in CI, coverage tracking, test infrastructure.

### Investigation Tasks

**2.1 Current Test Coverage**

CURRENT STATE: ZERO tests.

- No test framework in package.json (no jest, vitest, @testing-library, etc.)
- No *.test.* or *.spec.* files in src/ or anywhere in repo
- No test scripts in package.json
- No CI test job

For a codebase of 14,064 lines with complex advisor logic (393 lines)
and provider mapping, this is a HIGH-priority gap.

**2.2 Recommended Test Strategy**

For Phase 2 planning, propose a test pyramid:
- Unit tests: pure logic (airingState, watchStatus, canonicalProviderId,
  advisor cascade functions, taste similarity, ingredient parsing) →
  Vitest (fast, React-ecosystem-friendly)
- Component tests: key widgets (WatchlistPage filter logic, StatusButton
  state, ProviderTag rendering) → @testing-library/react
- Integration tests: hooks + React Query + Firestore mocks (firebase-mock
  or firestore emulator) → MSW for HTTP
- E2E tests: critical flows (sign-up, search, add to watchlist, mark
  watched, advisor output) → Playwright

**2.3 Priority Targets if Coverage Added**

Golden targets for initial coverage:
- airingState (src/lib/airingState.ts, 17 lines) — trivial, 10 test cases
- watchStatus (src/lib/watchStatus.ts, 29 lines) — movie/TV asymmetry
- canonicalProviderId (src/lib/tmdb/providers.ts, alias logic)
- useSubscriptionAdvisor state-transition table (from 07 prompt's golden
  cases — reuse)
- useRevivalNudges firing conditions
- WatchlistContext state mutations

**2.4 Test Infrastructure Readiness**

- No firebase emulator config observed (.firebaserc, firebase.json)
  — would need to add `"emulators": { "firestore": {...}, "auth": {...} }`
- No test utilities / fixtures / builders
- No CI test job

**2.5 Type-Check as Minimal "Test"**

`npx tsc --noEmit` is effectively Binge's only automated correctness check
today. Is it run in CI? NO (deploy.yml has no tsc step).

MEDIUM finding: add tsc --noEmit to CI as pre-deploy gate.

---

## Dimension 3: Deployment & Release (15 points)

### Investigation Scope

Deployment pipeline, environments, approval gates, rollback, versioning,
staged rollouts.

### Investigation Tasks

**3.1 Deployment Pipeline**

Current: push to main → auto-deploy to production ("live" channel).

Risks:
- No staging step — broken code reaches production immediately
- No smoke test post-deploy
- No canary rollout
- No human approval gate

For an indie app, direct-to-prod is defensible. But note the trade-offs
explicitly.

**3.2 Environment Management**

Single Firebase project (binge-nu), single hosting target, single Firestore DB.

No separation of:
- Development (local dev + local Firestore emulator)
- Staging (preview channel on same Firebase project is closest approximation)
- Production (the "live" channel)

Implications:
- Schema migrations tested only in dev, executed directly on prod Firestore
- Auth test users vs real users share the same user collection
- Analytics events from dev pollute prod data

For Phase 2: consider adding a binge-nu-staging Firebase project.

**3.3 Quality Gates**

CRITICAL: NONE.

| Gate                       | Automated | Blocking | Status      |
|----------------------------|-----------|----------|-------------|
| TypeScript compiles        | No        | No       | Not in CI   |
| ESLint passes              | No        | No       | Not in CI   |
| Unit tests pass            | No        | No       | No tests    |
| E2E tests pass             | No        | No       | No tests    |
| Security scan clean        | No        | No       | Not in CI   |
| Manual QA sign-off         | No        | No       | N/A         |
| Firestore rules tested     | No        | No       | Not in CI   |

**3.4 Rollback Capabilities**

Firebase Hosting has built-in rollback:
- Firebase Console → Hosting → Release history → Revert
- RTO: minutes

Firestore rollback is harder:
- No PITR configured (verify)
- No scheduled backups configured (verify)
- Auth rollback: not applicable (users persist)

Document current RTO/RPO:
- Hosting: RTO < 5 min, RPO = 0 (stateless)
- Firestore: RTO = indefinite (no backup), RPO = total loss possible

**3.5 Version Management**

package.json version: "0.1.0" (pre-1.0).

- No automated version bumping
- No changelog (CHANGELOG.md not observed)
- No git tags for releases
- No release notes

For an indie SPA in pre-launch, this is acceptable. Flag as LOW.

**3.6 Staged Rollouts**

Not applicable for a web SPA (no app stores).

Cloudflare could be used for staged rollout (split traffic to a canary
origin), but this is over-engineering for current scale. LOW priority.

**3.7 Production Readiness Blockers**

| Blocker                                   | Severity | Details                         |
|-------------------------------------------|----------|---------------------------------|
| No PITR enabled on Firestore              | HIGH     | Total data loss risk            |
| No scheduled Firestore backups            | HIGH     | Same                            |
| No test suite                             | HIGH     | Regression risk                 |
| No CI quality gates (lint/tsc)            | HIGH     | Broken builds can deploy        |
| No staging environment                    | MEDIUM   | Can't safely test schema changes|
| No concurrency control on deploy          | LOW      | Race condition on fast pushes   |
| No PR preview channels                    | LOW      | Review friction                 |
| No error tracking in production           | MEDIUM   | Blind to user errors            |
| No uptime monitoring                      | MEDIUM   | Blind to downtime               |

---

## Dimension 4: Backup & Disaster Recovery (18 points)

### Investigation Scope

Firestore PITR, scheduled backups, recovery playbooks, RTO/RPO targets.

### Investigation Tasks

**4.1 Firestore Backup Assessment**

Check project binge-nu:

| Feature                                        | Status                | Quick Win |
|------------------------------------------------|-----------------------|-----------|
| Firestore PITR (7-day, minute granularity)     | Check if enabled      | YES — minutes to enable via CLI |
| Firestore Scheduled Backups (daily, 14w retention) | Check if configured | YES — minutes via gcloud |
| Firebase Auth export                           | Not automated         | N/A       |
| Firebase Hosting versions                      | Built-in (retain 10 by default) | N/A |

**Commands to check** (do NOT run during Phase 1 — document intent):
```
gcloud firestore backups schedules list --database=\"(default)\" --project=binge-nu
gcloud firestore databases describe --database=\"(default)\" --project=binge-nu
  # Check pointInTimeRecoveryEnablement
```

Best practice: BOTH PITR and scheduled backups.
- PITR for recent accidents (7-day window, minute precision)
- Scheduled for longer retention (14-week)

**4.2 Recovery Playbooks**

Define playbooks for each scenario:

| Scenario                    | Detection                 | Method                      | RTO    |
|-----------------------------|---------------------------|-----------------------------|--------|
| Bad Firestore rules deploy  | Permission errors reported| Rollback rules via CLI      | < 15min|
| Bad code deploy             | Error spike / user report | Revert via Firebase Console | < 15min|
| Firestore data corruption   | User report, Analytics    | Restore from PITR (if on)   | 2–4h   |
| Accidental collection wipe  | User report               | PITR restore                | 2–4h   |
| Cloudflare misconfiguration | DNS/SSL errors            | Cloudflare revert           | < 30m  |
| TMDB API down / key revoked | App-wide content failure  | External dependency; wait   | Depends|
| Firebase region outage      | Global errors             | Wait or failover            | Depends|

For each: detection method, assessment checklist, recovery steps,
verification, user communication plan. Currently NOT DOCUMENTED.

**4.3 RTO / RPO Analysis**

| Function                   | Target RTO | Current RTO | Target RPO | Current RPO |
|----------------------------|------------|-------------|------------|-------------|
| User authentication        | 4h         | < 1h        | 0          | 0 (Firebase)|
| Watchlist read             | 4h         | Unknown     | 1h         | Unknown     |
| Watchlist write            | 8h         | Unknown     | 1h         | Unknown     |
| Social features            | 24h        | Unknown     | 24h        | Unknown     |
| Tillsammans sessions       | 24h        | Unknown     | 24h (low)  | Unknown     |

With PITR enabled: RPO = minutes. With scheduled backups: RPO = 24h.
Without: RPO = infinity.

**4.4 Single Points of Failure**

| SPOF                                         | Blast Radius   | Redundancy | Priority |
|----------------------------------------------|----------------|------------|----------|
| Single Firebase project (binge-nu)           | Total app loss | None       | HIGH     |
| No staging environment                       | Prod-only test | None       | HIGH     |
| Single Firebase admin account                | Lockout risk   | Verify     | HIGH     |
| TMDB API (external dependency, no cache)     | App-wide content loss | None | HIGH |
| Single CI account / service account          | Can't deploy   | None       | MEDIUM   |
| Single Cloudflare account                    | DNS/CDN risk   | Verify     | MEDIUM   |
| GitHub repo (source of truth)                | Total dev loss | GitHub's SLA | LOW    |

**4.5 Offline / Degraded Modes**

- Firestore offline persistence: enabled by default in client SDK — verify
- React Query cache: provides seamless offline for already-fetched data
- What breaks first when offline? (advisor depends on many TMDB calls)

**4.6 Data Export (GDPR Article 20)**

- Currently no export mechanism (cross-ref 02 Security)
- For DR purposes: manual Firestore export to GCS bucket is the fallback
- Document a manual export procedure

---

## Dimension 5: Monitoring & Observability (15 points)

### Investigation Scope

Error tracking, performance monitoring, analytics, logging, SLOs/SLIs, uptime.

### Investigation Tasks

**5.1 Error Tracking**

Current: NONE.

- No Sentry
- No Firebase Crashlytics (web SDK available but not installed)
- No LogRocket / Datadog RUM
- No window.addEventListener('error') / unhandledrejection capture

When a user hits a JS error, the team has no visibility.

Recommendation: Sentry Free tier (5k events/month) is the standard for
indie SPAs. Effort: ~2 hours to integrate.

**5.2 Performance Monitoring**

Current: NONE.

- No Firebase Performance Monitoring (web SDK available)
- No Core Web Vitals reporting (defer detailed CWV analysis to 04 Performance)
- No Real User Monitoring

Recommendation: Add web-vitals package + send to an endpoint
(Firebase Analytics or Sentry). Effort: ~1 hour.

**5.3 Analytics**

Unknown — investigate:
- Is Firebase Analytics initialized somewhere? (Search for
  'firebase/analytics', 'getAnalytics')
- Google Analytics via Cloudflare or gtag?
- Any analytics events logged at all?

Cross-ref to 08 Analytics & Growth (which owns event strategy). This
dimension owns INFRASTRUCTURE (SDK integration, consent gating timing
if present).

**5.4 Logging Strategy**

Check:
- console.log calls in production code (cross-ref 01 Code Quality for
  debug leftovers)
- Any structured logging? (none expected — client-side SPA)
- Firebase Auth / Firestore audit logs accessible via GCP Console —
  document access for incident response

No PII should leak into logs. Verify no console.log of user objects,
tokens, or full Firestore documents.

**5.5 SLO / SLI Definition**

Currently NONE defined. Recommend baseline:

| SLI                                 | Target SLO    | Measurement             |
|-------------------------------------|---------------|-------------------------|
| Uptime (index.html 200 OK)          | 99.9%         | External uptime monitor |
| Error rate (JS errors / session)    | < 0.5%        | Sentry (once added)     |
| Largest Contentful Paint (p75)      | < 2.5s        | web-vitals → RUM        |
| Interaction to Next Paint (p75)     | < 200ms       | web-vitals → RUM        |
| TMDB API success rate               | 99%           | Client-side reporting   |
| Firestore success rate              | 99.9%         | Client-side reporting   |

These don't need to be strict SLAs — but tracking them enables informed
trade-offs.

**5.6 Uptime Monitoring**

Currently: NONE.

Recommend UptimeRobot Free (50 monitors, 5-min checks) or Cronitor Free
for at least:
- https://binge.nu (expect 200)
- TMDB connectivity smoke test (can be synthetic from monitor)

**5.7 Alerts**

Currently: NONE.

For solo developer: email / phone on:
- Uptime < 99% over 1h
- Error rate spike (if Sentry added)
- Firebase quota nearing limits

---

## Dimension 6: Development Workflow (7 points)

### Investigation Scope

Branching strategy, local dev setup, developer tooling, DX friction.

### Investigation Tasks

**6.1 Branching Strategy**

Observed:
- Main branch: `main`
- Feature branches: `claude/*` pattern observed in git status
  (current branch: claude/vill-se-advisor)
- Merge to main triggers deploy

Questions to resolve:
- PR required before merge? (GitHub branch protection — verify via
  repo settings)
- Squash vs merge commit? (Recent commits show both — verify intent)
- Branch naming convention documented?

**6.2 Local Development**

- `npm run dev` starts Next.js on http://localhost:3000 (per CLAUDE.md)
- Firebase emulators: NOT configured (no emulator block in firebase.json)
- .env.local.example present for env-var onboarding

Friction points to investigate:
- Does the app work without a real Firebase project? (No emulator fallback)
- Does the app work without a TMDB key? (client.ts throws on getApiKey)
- Onboarding time for new dev: clone → npm install → add .env.local →
  npm run dev. Roughly 15–30 min if Firebase project + TMDB key available.

**6.3 Developer Tooling**

Observed:
- package.json scripts: dev, build, start, lint
- Pre-commit hooks: not observed (no .husky, no simple-git-hooks config)
- Commit message validation: not observed
- Code formatting: Prettier config? (Not observed; next.js has opinionated
  defaults via ESLint)

Recommendations for Phase 2:
- Add pre-commit: tsc --noEmit + lint (husky + lint-staged)
- Add Prettier config for team consistency

**6.4 Hot Reload & DX**

- Next.js Fast Refresh: works by default
- TypeScript errors in terminal during dev
- Verify no `// @ts-ignore` abuse that masks real type errors in dev

---

## Dimension 7: Incident Response (10 points)

### Investigation Scope

Alerting, notification channels, escalation, incident playbooks.

### Investigation Tasks

**7.1 Alerting**

Currently: NONE.

For a solo indie app pre-launch, formal alerting is overkill. But minimum:
- Firebase quota alerts (Firebase Console can email on quota usage)
- Cloudflare alert on upstream errors
- Uptime monitor (if added) emails / SMS on downtime

**7.2 Notification Channels**

Single developer, single email. Simple. Document the email address.

**7.3 Escalation**

Not applicable for solo developer. Document the intent:
- P0: user data loss, site down — respond within 1h
- P1: broken critical flow (sign-up, watchlist) — respond within 4h
- P2: broken minor feature — respond within 24h

**7.4 Incident Playbooks**

Currently: NONE.

Recommend minimum playbook coverage:
- "Site is down" — check Cloudflare, Firebase Hosting, Firebase status
- "Users report missing data" — check Firestore rules deployment history,
  check for recent writes, check Firebase Console
- "TMDB is returning errors" — check TMDB status page, verify API key,
  check quota
- "Firebase quota exceeded" — check Firestore read count, rules efficiency
  (cross-ref 02 for rule cost)

**7.5 Post-Incident Process**

Currently: NONE.

Lightweight recommendation: a `docs/incidents.md` log with one-line
entries for each incident, with root cause + fix. No formal postmortem
template needed at this scale.

---

## Dimension 8: CI/CD Security (5 points)

### Investigation Scope

Secrets management, supply chain, rules deployment, Dependabot.

### Investigation Tasks

**8.1 Secrets Management**

GitHub Secrets in use:
- GITHUB_TOKEN (built-in, scoped per workflow)
- FIREBASE_SERVICE_ACCOUNT

Verify:
- The service account has the MINIMUM necessary roles:
  - Firebase Hosting Admin (deploy)
  - Do NOT grant Firestore Admin unless rules-deploy added
- Rotation: not scheduled. Document rotation procedure.
- No secret exposure in logs (GitHub masks by default; verify no custom
  echo that bypasses masking)

**8.2 Supply Chain**

- package-lock.json committed ✓
- Dependabot: not configured in .github/ (no dependabot.yml observed)

Recommend Phase 2: add .github/dependabot.yml with:
- npm ecosystem, weekly schedule
- grouping: minor/patch updates
- PR limit: 5

**8.3 Firestore Rules Deployment**

Current: manual via `firebase deploy --only firestore:rules` (per CLAUDE.md).

Risks:
- Rules deployed from developer's machine, not versioned or reviewed
- No automated rules test (emulator integration test)
- No rollback procedure documented

Recommend Phase 2:
- Add rules deploy to CI (with test gate)
- Automated rules unit tests via firebase-rules-unit-testing

**8.4 Audit Logging**

- GitHub Actions run history: retained 90 days by default
- Firebase audit logs: accessible via GCP Console (Firestore operations,
  auth events)
- Application-level audit: not implemented (cross-ref 02 GDPR Art. 30)

---

## Modern Tooling Recommendations

Evaluate each for cost/benefit during analysis:

### Deployment & Hosting

| Tool                     | Purpose                          | Effort | Impact |
|--------------------------|----------------------------------|--------|--------|
| Firebase preview channels| PR previews, no infra change     | Low    | High — fills largest gap |
| Firestore PITR           | 7-day point-in-time recovery     | Low    | CRITICAL — data safety |
| Firestore scheduled backups | Daily exports, 14w retention  | Low    | CRITICAL — longer retention |
| Firebase App Check       | Protect Firestore / API from abuse | Medium | Medium — rate-limit abuse |

### Code Quality & CI

| Tool                     | Purpose                          | Effort | Impact |
|--------------------------|----------------------------------|--------|--------|
| PR trigger + tsc+lint    | Quality gate before merge        | Low    | High — catch broken builds |
| Vitest                   | Unit test framework              | Medium | High — regression protection |
| @testing-library/react   | Component tests                  | Medium | Medium |
| Playwright               | E2E tests                        | Medium | Medium — golden flows |
| Dependabot               | Dependency updates               | Low    | Medium — security hygiene |
| firebase-rules-unit-testing | Rules unit tests             | Medium | High — rules regression protection |

### Observability

| Tool                     | Purpose                          | Effort | Impact |
|--------------------------|----------------------------------|--------|--------|
| Sentry (Free)            | Error tracking                   | Low    | High — production visibility |
| web-vitals               | Core Web Vitals RUM              | Low    | Medium — cross-ref 04 |
| UptimeRobot Free         | Uptime monitoring                | Low    | High — know when down |

---

## Output Format

### Executive Summary

```
BINGE INFRASTRUCTURE & OPERATIONS ANALYSIS — PHASE 1
======================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Firebase project: binge-nu
Hosting: Firebase Hosting + Cloudflare CDN

OVERALL SCORE: X/100
DevOps Maturity Level: [1–5]

DIMENSION SCORES:
  Build Pipeline & Automation:      X/15
  Testing Strategy & Coverage:      X/15
  Deployment & Release:             X/15
  Backup & Disaster Recovery:       X/18
  Monitoring & Observability:       X/15
  Development Workflow:             X/7
  Incident Response:                X/10
  CI/CD Security:                   X/5

DORA METRICS (measure or estimate):
  Deployment Frequency: [X per week — based on main branch commits]
  Lead Time for Changes: [X hours — commit to deploy]
  Change Failure Rate:  [X% — if observable]
  MTTR:                 [X hours — target for incidents]

PRODUCTION READINESS: [Ready / Blockers Remain / Not Ready]

CRITICAL FINDINGS: [count]
HIGH FINDINGS:     [count]
MEDIUM FINDINGS:   [count]
LOW FINDINGS:      [count]
```

### Required Deliverables

For each dimension: score, strengths, gaps, risk assessment, findings with
severity, effort estimates.

Required diagrams and tables:
1. CI/CD pipeline flow (source → build → deploy)
2. Quality gate matrix (gate × automated × blocking × status)
3. DR assessment (PITR × scheduled backups × RTO × RPO per function)
4. SPOF inventory
5. SLO / SLI baseline table
6. Production readiness blockers
7. Quick wins vs strategic improvements matrix

---

## Success Criteria

Phase 1 complete when all 8 dimensions investigated and scored, all diagrams
created, DORA metrics estimated, production readiness blockers listed, and
executive summary written. ZERO code changes, ZERO pipeline modifications.

---

## Investigation Process

**Stage 1 — CI & Deploy (1h)**: audit deploy.yml, quality gates, preview
channels, concurrency.

**Stage 2 — Test & Lint (1h)**: current coverage, recommended pyramid,
priority targets, type-check as gate.

**Stage 3 — DR & Backups (1.5h)**: PITR status, scheduled backups, RTO/RPO,
SPOF inventory, playbooks.

**Stage 4 — Monitoring (1h)**: error tracking, performance, uptime, SLOs.

**Stage 5 — Dev Workflow & CI/CD Security (1h)**: branching, local setup,
secrets, Dependabot.

**Stage 6 — Synthesis (1h)**: score dimensions, DORA metrics, exec summary,
prioritized findings.

Total: 6–7 hours.

---

## Critical Reminders

1. DOCUMENT, DO NOT FIX
2. CHECK PITR AND BACKUPS — these are the top quick wins
3. NO TESTS IS THE BIGGEST TECHNICAL RISK — flag clearly
4. INDIE SCALE — don't demand enterprise DevOps. Calibrate.
5. SOLO DEVELOPER — alerting / escalation can be minimal
6. FACTS OVER SPECULATION — mark unknowns explicitly
7. QUICK WINS MATTER — preview channels, PITR, Sentry are each < 2h effort
8. USE FILE REFERENCES — all findings must include file:line where applicable
