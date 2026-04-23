# 05 — Dependencies & Supply Chain Security Analysis

**Analyst:** Claude (Opus 4.7)
**Mission:** Secure, maintainable dependency stack with zero known CVEs.
**Orchestrator weight:** 5% of overall codebase health score.

---

## Two-Phase Approach

- **Phase 1: Investigation only.** No code changes, no `npm update`,
  no package.json edits. Produce findings with package names, versions,
  and file:line references where applicable.
- **Phase 2: Upgrade plan.** Prioritized remediation roadmap based on
  Phase 1 findings.

**Cross-prompt note:** This prompt's CVE findings feed into 02 (Security &
Compliance). This prompt is independent and can run first or in parallel.

---

## Shared Project Context

```
Project:             Binge (binge.nu — Swedish media tracker)
Framework:           Next.js 14 (App Router), TypeScript
Runtime:             Node.js 20 (per deploy.yml: actions/setup-node@v4 node-version: 20)
Package manager:     npm (package-lock.json committed)
Deployment:          Firebase Hosting + Cloudflare CDN

Direct dependencies (package.json):
  dependencies:
    @tanstack/react-query    ^5.95.2
    clsx                     ^2.1.1
    firebase                 ^12.11.0
    lucide-react             ^1.6.0
    next                     14.2.35
    react                    ^18
    react-dom                ^18
    tailwind-merge           ^3.5.0

  devDependencies:
    @types/node              ^20
    @types/react             ^18
    @types/react-dom         ^18
    eslint                   ^8
    eslint-config-next       14.2.35
    postcss                  ^8
    tailwindcss              ^3.4.1
    typescript               ^5

Total direct dependencies: 8 runtime + 8 dev = 16 direct
Transitive dependencies: to be counted via npm ls

CI/CD:
  - .github/workflows/deploy.yml (single workflow)
  - No Dependabot configuration observed (.github/dependabot.yml missing)
  - No npm audit in CI
  - No Snyk / Mend / similar scanner configured

Version constraint style: caret (^) for most, exact for next (14.2.35) and
eslint-config-next (14.2.35 — implicitly pinned alongside next)

Security-critical packages:
  firebase         — auth, firestore, security boundary
  next             — SSR framework (broad attack surface even in static
                     build because build tooling runs in CI)
  react            — rendering layer
  @tanstack/react-query — state management
  tailwind-merge   — classname merge; small surface

Generated / ignored files:
  .next/, node_modules/, out/, .firebase/
```

---

## Pre-Analysis Commands

Run these before starting. Attach output as context.

```bash
# 1. Direct dependencies
cat package.json

# 2. Full resolved tree
npm ls --all --json > /tmp/npm-deps.json      # if shell available
npm ls --depth=0                              # direct deps with resolved versions

# 3. Outdated packages
npm outdated --json

# 4. Vulnerability scan
npm audit --production --json
npm audit --json                              # includes dev deps

# 5. Unused dependencies (install if possible)
npx depcheck

# 6. Lockfile integrity
npm ls --package-lock-only
```

If a tool is not installed, note its absence.

---

## Known Dependency Context

- **16 direct dependencies** (8 runtime, 8 dev)
- **Estimated 400–600 transitive dependencies** for a Next.js 14 project
  (typical: React + Next transitively brings in a lot)
- **package-lock.json committed** to version control
- **No pubspec_overrides / dependency resolutions section observed**
- **No Dependabot configuration**
- **No private npm registry — all from public npm**

### Packages Requiring Extra Scrutiny

- **next (14.2.35)**: major attack surface, frequent security advisories.
  Check latest patch within 14.x — 14.2.x may have patches available.
  Next.js 15 released — migration cost vs security value?
- **firebase (^12.11.0)**: Google-maintained, well-audited, but the caret
  allows any 12.x — ensure no breaking minor releases.
- **@tanstack/react-query (^5.95.2)**: active maintenance, caret OK.
- **lucide-react (^1.6.0)**: check — 1.6.0 is OLD. Lucide is on major
  version 0.x / 0.400.x in recent years. Verify this version number and
  that it's still maintained. This might be a typo / old version in
  package.json.
- **eslint (^8)**: ESLint 9 is out. ^8 pins to v8 major — acceptable if
  eslint-config-next still targets v8.
- **tailwindcss (^3.4.1)**: Tailwind v4 is in beta. v3 is stable.

---

## Analysis Framework: 7 Dimensions (100 Points)

### Dimension 1: Vulnerability Scanning & CVEs (25 points)

Gold standard: Zero known vulnerabilities, active monitoring in place.

Investigate:

1. **Known vulnerabilities**
   - Run `npm audit --production` and `npm audit`
   - Cross-reference with GitHub Dependabot alerts if repo has Dependabot on
   - For each vulnerability:
     - CVE ID, CVSS score, affected package + version range
     - Is it in a direct dep or transitive?
     - Is there a patched version?
     - Is a direct-dep upgrade required to pull in the fix?

2. **CVSS categorization**
   - CRITICAL (9.0–10.0): immediate
   - HIGH (7.0–8.9): current sprint
   - MEDIUM (4.0–6.9): scheduled
   - LOW (0.1–3.9): monitor

3. **Transitive dependency tree**
   - `npm ls --all` for the full tree
   - Identify vulnerable transitive packages
   - Determine if direct-dep upgrade resolves the CVE

4. **Feature impact mapping**
   - Map each vulnerability to the Binge features it affects
   - Assess exploitability in context:
     - Client-side only SPA: XSS, prototype pollution, denial-of-service
       are real
     - No server component: SSRF, path traversal, RCE risks on server
       are limited to build-time tooling in CI

**Output:** Table of all CVEs with CVSS, affected package, remediation,
feature impact.

---

### Dimension 2: Version Currency & Maintenance (20 points)

Gold standard: All packages within 1–2 minor versions of latest, all
actively maintained.

Investigate:

1. **Version currency (`npm outdated`)**
   - For each direct dependency:
     - Current version
     - Wanted (next compatible under caret)
     - Latest (may include breaking changes)
     - Classify: current / minor-behind / major-behind

   **Suspected status** (verify):
   - next: 14.2.35 vs Next 15.x latest — 1 major behind (acceptable if
     team doesn't want migration cost)
   - firebase: 12.11.0 vs latest 12.x — check minor lag
   - react / react-dom: 18 (caret resolves to latest 18.x) — React 19
     stable; ^18 means we stay on 18
   - lucide-react: 1.6.0 — VERIFY; lucide's current versioning is 0.x
     series (0.400+). "1.6.0" may be a typo or a very old pinned version.
     Flag as HIGH if truly ancient.
   - eslint: ^8 — ESLint 9 is stable; eslint-config-next 14.2.x targets
     ESLint 8; acceptable coupling

2. **Maintenance status**
   - Last-published date on npm (via `npm view <pkg> time.modified`)
   - GitHub activity: last commit / release / issue response
   - Classification:
     - Active: updated within 6 months
     - Monitor: 6–12 months
     - At risk: 12–24 months
     - Abandoned: > 24 months no commit

3. **Deprecation**
   - Deprecated packages: `npm view <pkg> deprecated`
   - Discontinued: check GitHub archive status

4. **Node / TypeScript / React compatibility**
   - Node 20 (from deploy.yml) — verify all packages support Node 20
   - React 18 — verify compatibility (React 19 migration is future work)
   - TypeScript ^5 — current

**Output:** Full dependency table: current / latest / gap / maintenance status.

---

### Dimension 3: License Compliance (18 points)

Gold standard: All licenses commercial-safe, zero GPL/AGPL unless intentional.

Investigate:

1. **License inventory**
   - `npx license-checker --production --summary` (or equivalent)
   - Or npm ls output combined with per-package license field
   - Categorize:
     - Permissive (MIT, BSD, Apache 2.0, ISC): commercial-safe ✓
     - Weak copyleft (LGPL, MPL): review; usually safe for JS (no static
       linking)
     - Strong copyleft (GPL, AGPL): source disclosure required — CRITICAL
       for a proprietary SaaS
     - Custom / proprietary / unknown: flag for review

2. **Expected license profile for Binge stack**
   - React, Next.js, Firebase SDK: MIT
   - Tailwind, PostCSS: MIT
   - TanStack React Query: MIT
   - lucide-react: ISC / MIT (icons may have individual licenses)
   - clsx, tailwind-merge: MIT
   - ESLint, TypeScript: MIT / Apache-2.0

   Verification: `npx license-checker` output should be entirely MIT/BSD/
   ISC/Apache/0BSD/Unlicense. Flag any outliers.

3. **Attribution requirements**
   - Apache-2.0 packages require attribution
   - Does Binge have an open-source licenses page? (Usually in about /
     settings). Currently expected: none. Cross-ref 11 Legal for final
     verdict.

**Output:** License compliance matrix by license type with counts. GPL/AGPL
flagged as CRITICAL. Attribution gap for Apache-2.0 packages.

---

### Dimension 4: Dependency Bloat (12 points)

Gold standard: Every dependency justified, no unused packages, no overlap.

Investigate:

1. **Dependency counts**
   - Direct: 16 (observed)
   - Transitive: via `npm ls --all | wc -l` or similar

2. **Unused dependencies**
   - Run `npx depcheck`
   - For each flagged unused package, verify manually (depcheck has
     false positives for transitively-required packages like `postcss`)

3. **Overlapping functionality**
   - Any two packages serving the same purpose?
     - clsx AND tailwind-merge: different purposes (clsx = conditional
       classes, tailwind-merge = resolve Tailwind conflicts); both commonly
       used together ✓
     - No observed duplicate HTTP client, no duplicate state management
   - Verify after depcheck output

4. **Bundle size impact**
   - Largest contributors (cross-ref 04 Performance):
     - firebase (huge — but modular imports help)
     - next (mostly dev / build tooling; runtime portion smaller)
     - react + react-dom
     - @tanstack/react-query
     - lucide-react (tree-shakable icons)
     - tailwindcss (CSS output size, not JS)

5. **Replacement candidates**
   - clsx (~400 bytes) — could be replaced by tailwind-merge's cn helper,
     but clsx is so small it's not worth the refactor
   - Any heavy dep with a lighter alternative?

**Output:** Unused dependency list, overlapping packages, bundle impact
ranking, replacement recommendations.

---

### Dimension 5: Supply Chain Integrity (12 points)

Gold standard: Verified maintainers, locked dependencies, reproducible builds,
automated updates.

Investigate:

1. **Lock file and pinning**
   - package-lock.json committed ✓
   - Pinning strategy: caret for most, exact for next (14.2.35) and
     eslint-config-next (coupled)
   - Are any packages pinned exact when they should be floating (or vice versa)?
   - Build reproducibility: same lock file → same build

2. **Publisher verification**
   - For each direct dependency, check:
     - npm maintainer list (who publishes?)
     - GitHub owner (individual vs org vs known vendor)
     - 2FA enforced on publisher account (if known)
   - Security-critical: firebase (Google), next (Vercel), react (Meta),
     @tanstack/react-query (known maintainer Tanner Linsley) — all trusted
   - Lucide: community-driven, verify publisher

3. **Dependabot configuration**
   - `.github/dependabot.yml` — NOT PRESENT (observed)
   - Recommendation for Phase 2:
     ```yaml
     version: 2
     updates:
       - package-ecosystem: npm
         directory: /
         schedule:
           interval: weekly
           day: monday
         groups:
           react:
             patterns: ["react*", "react-dom*"]
           firebase:
             patterns: ["firebase*"]
           next:
             patterns: ["next*", "eslint-config-next"]
           minor-and-patch:
             update-types: [minor, patch]
         open-pull-requests-limit: 5
       - package-ecosystem: github-actions
         directory: /
         schedule:
           interval: weekly
         open-pull-requests-limit: 3
     ```

4. **Checksum / integrity**
   - package-lock.json includes integrity hashes (SHA-512) — verify
   - No manually edited lock entries (lockfile integrity check)
   - No dependency-confusion risk (no private-named packages on public
     registry)

5. **Npm audit signatures**
   - Run `npm audit signatures` (newer npm versions support it)
   - Flags packages published without valid signatures

**Output:** Supply chain risk assessment, publisher verification table,
Dependabot recommendation.

---

### Dimension 6: Platform Compatibility (8 points)

Gold standard: All packages support target runtime.

Investigate:

1. **Browser compatibility**
   - Next.js 14 targets: modern browsers (last 2 versions, ES2022)
   - Check `browserslist` config in package.json — not present, so
     Next.js defaults apply
   - Core Web Vitals audiences: Chrome, Safari, Firefox, Edge
   - Any polyfills needed for older Safari? (unlikely)

2. **Node.js compatibility**
   - All dependencies support Node 20 (build environment)
   - TypeScript types alignment

3. **ESM vs CJS**
   - Next.js 14 supports both; most modern packages are ESM
   - Any legacy CJS-only packages blocking modern tooling?

**Output:** Platform compatibility matrix.

---

### Dimension 7: Upgrade Path & Migration (5 points)

Gold standard: Clear, sequenced upgrade roadmap with effort estimates.

Investigate:

1. **Major version upgrades pending**
   - next 14 → 15: cross-reference Next 15 migration guide
     - App Router already in use ✓
     - Breaking changes: async Request APIs, caching changes
     - Effort: medium (few breaking changes that affect Binge)
   - react 18 → 19: cross-reference React 19 migration
     - Effort: low (mostly automatic, some deprecated APIs removed)
   - eslint 8 → 9: requires eslint-config-next 15+
     - Effort: bundled with Next upgrade
   - tailwindcss 3 → 4: v4 in beta; not urgent
     - Effort: medium when GA (new config style)

2. **Cascade dependencies**
   - next + eslint-config-next must upgrade together
   - react + react-dom must upgrade together
   - @types/react + react major versions usually aligned

3. **Upgrade risk assessment**
   - Simple: clsx, tailwind-merge, @tanstack/react-query minor updates
   - Medium: next major, react major
   - Complex: tailwindcss major (config rewrite)

4. **Recommended upgrade sequence**
   - Phase 1: patches + minors (weekly via Dependabot)
   - Phase 2: React 19 (when RQ and Firebase SDKs confirmed compatible)
   - Phase 3: Next 15 (when React 19 is in)
   - Phase 4: Tailwind v4 (when GA)

5. **Testing requirements**
   - With no test suite (cross-ref 03), every upgrade requires manual
     smoke testing
   - Add smoke tests BEFORE committing to any major upgrade

**Output:** Prioritized upgrade roadmap with sequence, effort, risk.

---

## Investigation Process

### Stage 1: Automated Scanning

1. `cat package.json` — inventory
2. `npm ls --depth=0` — direct versions
3. `npm outdated --json` — currency
4. `npm audit --production --json` — vulnerabilities (production)
5. `npm audit --json` — including dev
6. `npx depcheck` — unused
7. `npx license-checker --production --summary` — license profile
8. `npm ls --package-lock-only` — lockfile integrity

### Stage 2: Manual Review

1. **Vulnerability audit**: CVE DB cross-reference
2. **Maintenance**: npm view <pkg> time / GitHub activity
3. **License**: license-checker output review
4. **Bloat**: depcheck + manual verification + bundle size (cross-ref 04)
5. **Supply chain**: publisher check, Dependabot proposal
6. **Compatibility**: verify browser / Node support
7. **Upgrades**: Next + React + Tailwind roadmap

### Stage 3: Report Compilation

Score dimensions, classify findings, produce upgrade roadmap.

---

## Output Format

### Executive Summary

```
BINGE DEPENDENCIES & SUPPLY CHAIN SECURITY ANALYSIS — PHASE 1
================================================================
Analysis Date: [Date]
Analyst: Claude (Opus 4.7)
Direct Dependencies: 8 runtime, 8 dev
Transitive (total resolved): [X]
Node: 20.x | Next: 14.2.35 | React: 18.x | TypeScript: 5.x

OVERALL DEPENDENCY HEALTH SCORE: X/100
├── Vulnerability Scanning & CVEs:   X/25
├── Version Currency & Maintenance:  X/20
├── License Compliance:              X/18
├── Dependency Bloat:                X/12
├── Supply Chain Integrity:          X/12
├── Platform Compatibility:          X/8
└── Upgrade Path & Migration:        X/5

SECURITY STATUS: [Secure | Needs Attention | Critical Vulnerabilities]

CRITICAL ISSUES: X (active CVEs, GPL licenses, abandoned packages)
HIGH PRIORITY:   X
MEDIUM PRIORITY: X
LOW PRIORITY:    X
```

### Package Health Dashboard

```
| Package                | Current | Latest | Gap | License | Last Updated | Status |
|------------------------|---------|--------|-----|---------|--------------|--------|
| @tanstack/react-query  |         |        |     |         |              |        |
| clsx                   |         |        |     |         |              |        |
| firebase               |         |        |     |         |              |        |
| lucide-react           |         |        |     |         |              |        |
| next                   |         |        |     |         |              |        |
| react                  |         |        |     |         |              |        |
| react-dom              |         |        |     |         |              |        |
| tailwind-merge         |         |        |     |         |              |        |
| (dev deps)             |         |        |     |         |              |        |
```

### Vulnerability Report

For each vulnerability:
- CVE ID, CVSS score, severity
- Affected package + version
- Exploitability in Binge context
- Remediation (upgrade to X or workaround Y)
- Feature impact

### License Compliance Matrix

Grouped by license:
- Permissive (MIT, BSD, Apache, ISC, 0BSD): X packages
- Weak copyleft (LGPL, MPL): X packages
- Strong copyleft (GPL, AGPL): X packages — CRITICAL if > 0
- Unknown / missing: X packages — CRITICAL if > 0

### Bloat Analysis

- Unused dependencies (zero imports): list
- Overlapping packages: pairs
- Heaviest (by installed size / bundle impact): ranking
- Replacement candidates: table

### Supply Chain Assessment

- Publisher verification (known vendor × maintained × trusted)
- Dependabot config recommendation
- Lockfile integrity
- Build reproducibility

### Upgrade Roadmap

Grouped by complexity:

```
## Simple Upgrades (minor/patch, no breaking)
| Package | From | To | Effort |

## Medium Upgrades (major with migration guide)
| Package | From | To | Breaking Changes | Effort |

## Complex Upgrades (multi-package cascade)
| Packages | From | To | Risk | Effort | Notes |
```

### Issues by Severity (Phase 2 Input)

```
## CRITICAL (fix immediately)
- [List with package, issue type, remediation]

## HIGH (fix within current sprint)
## MEDIUM
## LOW (backlog)

Total issues: X
Estimated total remediation effort: X days
```

---

## Phase 1 Deliverables Checklist

- [ ] Executive summary with overall score
- [ ] Detailed findings for all 7 dimensions
- [ ] Package health dashboard (all direct deps)
- [ ] Vulnerability report with CVE + CVSS
- [ ] License compliance matrix
- [ ] Bloat analysis (unused / overlap / heavy)
- [ ] Supply chain assessment
- [ ] Dependabot config recommendation
- [ ] Platform compatibility matrix
- [ ] Upgrade roadmap with sequence + effort
- [ ] Issues classified by severity
- [ ] ZERO dependency changes made

---

## Scoring Guide

| Range | Rating | Interpretation |
|-------|--------|----------------|
| 90–100 | Excellent | Healthy stack |
| 75–89 | Good | Minor attention |
| 60–74 | Acceptable | Remediation within 2 sprints |
| 40–59 | Needs work | Block features |
| 0–39 | Critical | Stop work, fix first |

### Per-Dimension Scoring Guidance

**Vulnerability (25)**: Start 25. −10 per CRITICAL, −5 per HIGH, −2 per MEDIUM, −1 per LOW. Floor 0.
**Currency (20)**: Start 20. −3 per abandoned, −2 per severely outdated (2+ major), −1 per deprecated, −0.5 per 1-major-behind. Floor 0.
**License (18)**: Start 18. −9 per GPL/AGPL, −6 per no-license, −2 per weak-copyleft unreviewed, −1 per missing attribution. Floor 0.
**Bloat (12)**: Start 12. −2 per unused, −1 per overlapping pair, −1 per unjustified heavy dep. Floor 0.
**Supply Chain (12)**: Start 12. −4 if lock not committed, −2 per unverified publisher, −2 if Dependabot missing. Floor 0.
**Platform (8)**: Start 8. −2 per incompatibility, −1 per deprecated runtime. Floor 0.
**Upgrade Path (5)**: Start 5. −2 if no sequence documented, −1 per unresolved cascade. Floor 0.

---

## Begin Phase 1 Investigation

Execute the dependency and supply chain security investigation across all
7 dimensions. Use automated scanning first, then manual review. Compile
findings into the output format above.

**Rules:**
- NO dependency changes. Investigation and documentation only.
- Document every finding with package name and version.
- Categorize by severity (Critical / High / Medium / Low).
- Provide effort estimates for every remediation or upgrade.
- Assess each security-critical package individually.
- Remember: Binge is a small indie SPA. Don't demand enterprise-grade
  supply-chain security; prioritize the fundamentals (lockfile, Dependabot,
  zero CVEs) over exotic controls (SBOM, reproducible build attestation).
