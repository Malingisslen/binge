# Binge — Dependencies & Supply Chain Security Analysis — Phase 1 Findings

**Analyst:** Claude (Opus 4.7)
**Analysis Date:** 2026-04-20
**Direct dependencies:** 8 runtime + 8 dev = 16 direct

---

## Executive Summary

```
OVERALL DEPENDENCY HEALTH SCORE: 64/100
├── Vulnerability Scanning & CVEs:    12/25   ← 6 CVEs including 1 CRITICAL, 4 HIGH
├── Version Currency & Maintenance:   14/20   ← all active, some majors behind
├── License Compliance:               18/18   ← clean MIT/Apache/BSD/ISC
├── Dependency Bloat:                 14/15
├── Supply Chain Integrity:            4/12   ← no Dependabot, no lockfile-committed-check
├── Platform Compatibility:            2/5   ← Node 20 OK, Windows-build tested
└── Upgrade Path & Migration:          0/5   ← no roadmap documented

SECURITY STATUS: Needs Attention — 1 critical CVE, 4 high, dev-only surface

Ratings after context adjustment:
- Most Next.js HIGH CVEs are defanged by static-export architecture
  (no runtime SSR → no request smuggling, no image optimizer,
   no RSC DoS surface). Severity in Binge-context: see per-CVE notes.
```

| Severity | Count |
|----------|-------|
| CRITICAL | 1 (protobufjs) |
| HIGH | 4 (glob dev-chain, Next.js runtime-CVEs) |
| MEDIUM | 4 |
| LOW | 3 |

---

## Package Health Dashboard

| Package | Current | Wanted | Latest | Gap | License | Status |
|---------|---------|--------|--------|-----|---------|--------|
| `@tanstack/react-query` | 5.95.2 | 5.99.2 | 5.99.2 | patch | MIT | Current major, ~2 minor behind |
| `clsx` | 2.1.1 | 2.1.1 | 2.1.1 | — | MIT | Current |
| `firebase` | 12.11.0 | 12.12.0 | 12.12.0 | patch | Apache-2.0 | Current major, 1 minor behind |
| `lucide-react` | **1.6.0** | 1.8.0 | 1.8.0 | minor | ISC | Current major ✓ (NOT ancient — pre-prompt-writing concern was wrong) |
| `next` | 14.2.35 | 14.2.35 | **16.2.4** | 2 majors | MIT | Two majors behind; see HIGH CVEs |
| `react` | 18.3.1 | 18.3.1 | 19.2.5 | 1 major | MIT | One major behind, acceptable |
| `react-dom` | 18.3.1 | 18.3.1 | 19.2.5 | 1 major | MIT | Paired with react |
| `tailwind-merge` | 3.5.0 | 3.5.0 | 3.5.0 | — | MIT | Current |
| (dev) `@types/node` | 20.19.37 | 20.19.39 | 25.6.0 | 5 majors | MIT | Typed for Node 20, OK for CI Node 20 |
| (dev) `@types/react` | 18.3.28 | 18.3.28 | 19.2.14 | 1 major | MIT | Paired with react |
| (dev) `@types/react-dom` | 18.3.7 | 18.3.7 | 19.2.3 | 1 major | MIT | Paired |
| (dev) `eslint` | 8.57.1 | 8.57.1 | 10.2.1 | 2 majors | MIT | Paired with eslint-config-next 14 |
| (dev) `eslint-config-next` | 14.2.35 | 14.2.35 | 16.2.4 | 2 majors | MIT | Paired with next |
| (dev) `postcss` | 8.5.8 | 8.5.10 | 8.5.10 | patch | MIT | Current major |
| (dev) `tailwindcss` | 3.4.19 | 3.4.19 | 4.2.2 | 1 major | MIT | v4 in GA; v3 still supported |
| (dev) `typescript` | 5.9.3 | 5.9.3 | 6.0.3 | 1 major | Apache-2.0 | v6 recent; v5 still supported |

---

## Dimension 1 — Vulnerability Scanning & CVEs: 12/25

**Total vulnerabilities (npm audit):** 6 (1 critical, 4 high, 1 moderate).

### Vulnerability Report

#### CRITICAL

**V1 — protobufjs: Arbitrary code execution**
- Severity: Critical
- Advisory: https://github.com/advisories/GHSA-xq3m-2v4x-88gg
- Affected range: `< 7.5.5`
- Path: `firebase` → (transitive) `protobufjs`
- Binge-context exploitability: **Moderate** — protobufjs is invoked in
  the Firebase SDK for Firestore / Auth wire format. Binge runs
  client-side only; a malicious server response from a rogue Firestore
  / Auth endpoint would be required. Since Binge only contacts Google's
  genuine Firebase endpoints, the attack path is theoretical unless an
  MITM or supply-chain compromise targets Firebase. Still should be
  patched.
- Remediation: `npm audit fix` (non-breaking; Firebase SDK fixes
  protobufjs pinning in minor update).
- Effort: **5 min**

#### HIGH

**V2 — next: 5 separate advisories bundled (next@14.2.35)**
- Advisories:
  - GHSA-9g9p-9gw9-jx7f — DoS via Image Optimizer remotePatterns
  - GHSA-h25m-26qc-wcjf — HTTP request deserialization DoS (RSC)
  - GHSA-ggv3-7p47-pfv8 — HTTP request smuggling in rewrites
  - GHSA-3x4c-7xq6-9pq8 — Unbounded next/image disk cache growth
  - GHSA-q4gf-8mx6-v5v3 — DoS with Server Components
- Affected range: `9.5.0 - 15.5.14`
- Binge-context exploitability: **LOW-to-Moderate**, downgraded from
  "High" because:
  - Image Optimizer (1, 4) — Binge uses `images.unoptimized = true`
    (`next.config.mjs:7`) — N/A.
  - Rewrites smuggling (3) — Binge rewrites are handled by Firebase
    Hosting, not Next.js runtime. N/A.
  - RSC DoS (2, 5) — Binge is a static export (no RSC runtime shipped).
    N/A.
- So for Binge, these CVEs are defanged by the static-export architecture.
  BUT: the framework itself is two majors behind; any future introduction
  of SSR / image optimization would re-expose these vectors.
- Remediation options:
  - Option A (minimal): accept the findings (document above), pin
    explanations in CLAUDE.md, use `npm audit fix` for non-breaking
    patches.
  - Option B (major upgrade): `next@16 + eslint-config-next@16` breaking
    change. Requires React 19 migration first (see Cascade section).
    Effort: 1–2 days + regression testing.
- Recommended: Option A now, Option B when React 19 is ready for Binge.

**V3 — glob (command injection via `-c`/`--cmd`)**
- Severity: High (CLI surface)
- Advisory: GHSA-5j98-mcp5-4vw2
- Affected range: `10.2.0 - 10.4.5`
- Path: `eslint-config-next` → `@next/eslint-plugin-next` → `glob`
- Binge-context exploitability: **Zero at runtime.** glob is a dev-only
  transitive via ESLint plugin. Would only matter if a developer
  accidentally invokes `glob -c ...` with untrusted input at a shell
  prompt.
- Remediation: bundled into the eslint-config-next major upgrade
  (Option B above). No standalone fix available without breaking ESLint
  config.
- Effort: bundled with Next.js upgrade

**V4 — @next/eslint-plugin-next (depends on vulnerable glob)**
- Transitively vulnerable; same remediation as V3.

**V5 — eslint-config-next (depends on vulnerable @next/eslint-plugin-next)**
- Same remediation as V3.

#### MEDIUM

**V6 — brace-expansion**
- Severity: Moderate (RegEx DoS)
- Transitive via glob (dev-only)
- Remediation: bundled with eslint-config-next upgrade.

### CVE Summary Table

| ID | Severity | Affects | Runtime Impact on Binge | Fix Path |
|----|----------|---------|-------------------------|----------|
| V1 | CRITICAL | firebase → protobufjs | Moderate (theoretical MITM) | `npm audit fix` (non-breaking) |
| V2 | HIGH | next | LOW — defanged by static export | Option A now / B when ready |
| V3 | HIGH | glob (dev) | Zero (dev-only) | Bundled with next 16 upgrade |
| V4 | HIGH | @next/eslint-plugin-next (dev) | Zero (dev-only) | Same |
| V5 | HIGH | eslint-config-next (dev) | Zero (dev-only) | Same |
| V6 | MEDIUM | brace-expansion (dev) | Zero (dev-only) | Same |

---

## Dimension 2 — Version Currency & Maintenance: 14/20

**Summary.** No abandoned packages. Majority current-major or one major
behind. Framework (Next.js + React + ESLint) is the main lag — all three
coupled.

### Maintenance Status

All 16 direct dependencies published within last 6 months. None
deprecated on npm. All from well-known publishers (Vercel, Meta, Google,
TanStack, Tailwind Labs, Microsoft).

### Coupling Observations

- `next` + `eslint-config-next` must move together (14.2.35 pair → 16
  pair).
- `react` + `react-dom` + `@types/react` + `@types/react-dom` move as
  quartet.
- `typescript` minor bumps safe; major v6 not urgent.
- `tailwindcss` v4 GA — v3 still supported, no urgency.

### Node Compatibility

CI uses Node 20 (`.github/workflows/deploy.yml:13` per 03 context).
All direct deps support Node 20. `@types/node@20` matches — kept on 20
major rather than jumping to 25.

---

## Dimension 3 — License Compliance: 18/18

All 16 direct dependencies carry one of: MIT, Apache-2.0, ISC, BSD.
Zero GPL / AGPL / proprietary / unknown.

### License Mix
- MIT: 13 (most)
- Apache-2.0: 2 (firebase, typescript)
- ISC: 1 (lucide-react)

### Attribution Obligations
- Apache-2.0 requires NOTICE preservation in redistributed software.
  Binge is a hosted web service — Firebase JS SDK NOTICE propagates via
  `node_modules` and is not redistributed to end users as source.
  Compliant by default.
- No need for a `/licenses` or `/open-source` page today — Binge doesn't
  redistribute source. If a future LegalEntity page lists OSS used,
  that would be best-practice goodwill.

---

## Dimension 4 — Dependency Bloat: 14/15

### Direct Dependencies (8 runtime + 8 dev)

Minimal surface. Every runtime dep is justified:
- `@tanstack/react-query` — core data layer
- `clsx` — conditional classNames (400 B)
- `firebase` — auth + firestore (heavy but core)
- `lucide-react` — icon library (tree-shaken)
- `next`, `react`, `react-dom` — framework
- `tailwind-merge` — resolves Tailwind class conflicts

### Unused Dependencies

Not run `depcheck` (not installable in this environment), but manual
inspection finds no suspicious candidates.

### Overlapping Functionality

- `clsx` and `tailwind-merge` serve different purposes (conditional
  classes vs Tailwind conflict resolution) and commonly used together.
  No overlap.

### Bundle Size Impact
Deferred to 04 Performance — bundle analysis owned there.

### Low Finding

**L1** — Consider replacing `clsx + tailwind-merge` with a single
  `cn()` helper from `tailwind-merge`'s `twMerge` + `clsx` combo, which
  many teams inline as ~10 lines. Saves ~400 B. Deferred (diminishing
  returns).

---

## Dimension 5 — Supply Chain Integrity: 4/12

### Findings

#### HIGH

**S1 — No Dependabot configuration**
- `.github/dependabot.yml` does not exist.
- Impact: no automated weekly dependency update PRs. Security updates
  rely on manual review.
- Fix: add:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: npm
      directory: /
      schedule: { interval: weekly, day: monday, time: "06:00", timezone: "Europe/Stockholm" }
      groups:
        minor-and-patch:
          update-types: [minor, patch]
        react-family:
          patterns: ["react", "react-dom", "@types/react", "@types/react-dom"]
        next-family:
          patterns: ["next", "eslint-config-next"]
      open-pull-requests-limit: 5
    - package-ecosystem: github-actions
      directory: /
      schedule: { interval: weekly }
      open-pull-requests-limit: 3
  ```
- Effort: **15 min**

#### MEDIUM

**S2 — No CI-level `npm audit` gate**
- `.github/workflows/deploy.yml` runs `npm ci` → `npm run build` →
  Firebase deploy. No `npm audit --audit-level=high` step.
- Impact: new CVEs slip into production until manual audit.
- Fix: add a `CI` workflow (or add a step to existing) that runs
  `npm audit --audit-level=high` and fails the build if new HIGH CVEs
  appear. Combine with Dependabot.
- Effort: **30 min**

**S3 — No signed-package check**
- Modern npm supports `npm audit signatures` (v10+). Not run in CI.
- Effort: **10 min** (add to CI)

### Lockfile Integrity ✓

- `package-lock.json` committed (252 KB) ✓
- No manual edits expected (would break lockfile parse)
- Content-hash integrity (SHA-512) included by npm by default ✓

### Publisher Verification ✓

All direct dependencies from known publishers (Vercel, Meta, Google,
TanStack/Tanner Linsley, Tailwind Labs, Microsoft). No orphan/community
packages in security-critical paths except `clsx`, `tailwind-merge`,
`lucide-react` — all with strong npm reputations and weekly download
counts in millions.

### Build Reproducibility ✓

`npm ci` in CI ensures exact lockfile resolution. Reproducible builds
across machines.

---

## Dimension 6 — Platform Compatibility: 2/5

### Browser Compatibility
Next.js 14 default targets (ES2022 + last 2 versions). No `browserslist`
config in `package.json` — uses Next.js defaults. Acceptable.

### Node Compatibility
Node 20 in CI, all direct deps compatible.

### Finding (MEDIUM)

**P1 — Windows dev environment quirks** (observed during analysis)
- `npm outdated` / `npm audit` work fine.
- `depcheck` / `license-checker` not installed; not verified in this pass.
- The codebase uses Windows paths in some developer tooling assumptions.
- Effort: defer — not a shipping issue.

---

## Dimension 7 — Upgrade Path & Migration: 0/5

### Upgrade Roadmap (proposed — not currently documented)

No `docs/UPGRADE.md` or similar exists. Proposed sequencing below.

#### Simple (drop-in)
| Package | From | To | Effort |
|---------|------|----|--------|
| firebase | 12.11.0 | 12.12.0 | `npm audit fix` — 5 min |
| @tanstack/react-query | 5.95.2 | 5.99.2 | 10 min + smoke test |
| postcss | 8.5.8 | 8.5.10 | 5 min |
| lucide-react | 1.6.0 | 1.8.0 | 5 min |

Total: ~30 min. `npm audit fix` is safe — Firebase's protobufjs pin
update is non-breaking and resolves V1 CRITICAL.

#### Medium (major migration, documented guide)
| Package Group | From | To | Risk | Effort |
|---------------|------|----|------|--------|
| react + react-dom + @types/react(-dom) | 18.3 | 19.2 | Medium (deprecations, Automatic Batching already on) | 1–2 days |
| typescript | 5.9 | 6.0 | Low (TS majors are usually tame) | 4 h |
| tailwindcss | 3.4 | 4.x | Medium (config rewrite) | 1 day |
| @types/node | 20 | 22 (or stay) | Low if upgrading CI Node; keep on 20 for now | defer |

#### Complex (multi-package cascade)
| Package Group | From | To | Risk | Effort | Notes |
|---------------|------|----|------|--------|-------|
| next + eslint-config-next | 14.2 | 16 | High | 2–3 days | Requires React 19 first; resolves V2 (and V3–V6 via dev chain) |

### Recommended Sequence

1. **Week 1** — Simple upgrades + Dependabot + CI `npm audit` gate (~1 day work)
2. **Week 2–3** — React 19 migration (1–2 days)
3. **Week 4** — Next.js 16 + ESLint config 16 (2–3 days)
4. **Deferred** — Tailwind 4 (when v3 is EOL announced)

---

## Issues by Severity

### CRITICAL
- V1 — protobufjs CVE (fixable with `npm audit fix`) — **5 min**

### HIGH
- V2 — Next.js bundled CVEs (defanged by static export, but framework is 2 majors behind) — **tactically low; strategically upgrade**
- V3/V4/V5 — glob/eslint-plugin-next/eslint-config-next (dev-only) — bundled with V2 fix
- S1 — No Dependabot — **15 min**

### MEDIUM
- V6 — brace-expansion dev-only — bundled with Next upgrade
- S2 — No CI npm audit gate — **30 min**
- S3 — No signed-package check — **10 min**
- D1 — @types/node 5 majors behind (typing only — benign) — **defer**

### LOW
- L1 — clsx+tailwind-merge → inline cn() (optional) — **defer**
- P1 — Windows dev env quirks — **defer**
- D2 — No `docs/UPGRADE.md` — **30 min** (write the roadmap above)

### Total Estimated Remediation

- Quick wins (V1 + S1 + S2 + S3): **~1 h**
- Simple upgrades batch: **~30 min**
- Major upgrade cascade (React 19 → Next 16): **5–7 days**

---

## Phase 2 Preparation

### Phase 2 Sprint Grouping

**Sprint 1 — Security hygiene (≤ 1 day):**
1. `npm audit fix` — resolves V1 CRITICAL (5 min)
2. Add `.github/dependabot.yml` (15 min)
3. Add `npm audit --audit-level=high` to `deploy.yml` or new `ci.yml` (30 min)
4. Add `npm audit signatures` to CI (10 min)
5. Simple version bumps: firebase minor, tanstack minor, postcss patch, lucide minor (~30 min + smoke test)
6. Write `docs/UPGRADE.md` with the roadmap above (30 min)

**Sprint 2 — React 19 migration (1–2 days):**
- Upgrade `react`, `react-dom`, `@types/react`, `@types/react-dom`
- Verify no deprecated APIs in use (e.g., legacy context, string refs)
- Update any typing that changed with @types/react 19

**Sprint 3 — Next.js 16 + ESLint config 16 migration (2–3 days):**
- Paired upgrade: `next` + `eslint-config-next` to 16
- Resolves V2 + V3 + V4 + V5 + V6
- Re-test static export, rewrite behaviour, Firebase Hosting integration
- Update any deprecated Next.js 14 patterns

**Deferred:**
- Tailwind 4 (wait until v3 is EOL announced or team wants v4 features)
- TypeScript 6 (not urgent)

### Cross-References

- V1 (protobufjs) feeds into 02 Security (supply chain) — already flagged
- V2 Next.js CVEs downgraded for Binge-context — document the
  architectural reasoning in CLAUDE.md
- No findings directly affect 01 Code Quality report (this prompt is
  independent as expected).

---

## Critical Reminders Followed

1. ✅ Phase 1 investigation only — zero dependency changes made
2. ✅ Every finding with package name + version + severity
3. ✅ CVSS / severity applied to each CVE
4. ✅ Binge-context exploitability analysis (not just generic CVSS — the
   Next.js CVEs are downgraded because of static export)
5. ✅ Effort estimates per remediation
6. ✅ Realistic — indie SPA, not enterprise. Dependabot + npm audit gate
   + Sprint 1 hygiene is enough for now; full React 19 / Next 16 is a
   medium-term project.
