# Sprint 2026-07-11c — follow-up completeness batch (post BIN-472 ship)

**Selection context:** the prior sprint (66c4ad9) shipped BIN-472/470/473 and its own
post-sprint completeness sweep filed four gap tickets: BIN-480 (security review found a
firestore.rules hardening gap), BIN-479 (a new test file isn't wired into CI), BIN-478
(a partially-met acceptance criterion), BIN-477 (workflow-map still stale for BIN-472's
own new behavior). Those four are the entire actionable backlog this pass — everything
else is either a carried-over `needsApproval` idea/decision or not yet actionable
(ops-blocked or date-gated). Linear MCP connected, scoped to project "Binge" throughout
(shared team). No ticket selected carries `onboarding-reserved`/`launch-gated`.

**Step-0 grep-of-main check (all 4 candidates):** confirmed each gap is still real on
current `main`, not already closed under a different id —
- BIN-480: `firestore.rules:840-850` `joinAttempts` create rule still only has
  `hasOnly(['token','createdAt'])`, no `is timestamp`/`== request.time` bind (pattern
  exists elsewhere at line 975, `updatedAt == request.time`, so the fix is a known mirror).
- BIN-479: `ci.yml`/`deploy.yml` still only run `node scripts/check-workflow-map.mjs`,
  not `node --test scripts/check-workflow-map.test.mjs`.
- BIN-478: `src/app/billigaste/[slug]/page.test.tsx` exists (BIN-473) but has zero
  `JSON.parse`/`ld+json`/`generateMetadata` assertions.
- BIN-477: `docs/workflow-map.html` release-phase steps (~line 1581) still only describe
  `shouldNotifyRelease` + marker advance — no mention of the legacy-card read / seed
  action / `viaMarker` stamp BIN-472 added.

No obsolete tickets.

## Mandate gate — full pass over every open ticket

| Ticket | Verdict | Why |
|---|---|---|
| BIN-480 | **build-review** | Mandate is unambiguous (mechanical rule-hardening mirroring an existing pattern, closes a real GDPR Art.17 gap a security review found) — but it touches `firestore.rules`, a CLAUDE.md sensitive domain that the ticket's own text flags as needing a written plan + explicit go-ahead before the edit. Building it best-guess, parking for her sign-off rather than auto-closing. |
| BIN-479 | **build** | Pure CI-wiring fix, no product decision, mirrors an existing step |
| BIN-478 | **build** | Test-only completeness fix on already-shipped, already-approved behavior |
| BIN-477 | **build** | Mechanical doc re-trace, satisfies existing CLAUDE.md workflow-map-freshness rule |
| BIN-468 | **needsApproval** *(carried over)* | Unvetted Stage-2 redesign of a whole-DB blast-radius sweep; wants a dedicated planned session per prior sprint's note, nothing changed since |
| BIN-173 | **needsApproval** *(carried over)* | Needs a manual affiliate-network signup + a legal disclosure decision before the code does anything real |
| BIN-189 | **needsApproval** *(carried over)* | Speculative social feature, no mockup/spec |
| BIN-170 | **needsApproval** *(carried over)* | Speculative shareable feature, no mockup/spec |
| BIN-185 | **needsApproval** *(carried over)* | Speculative AI-recap feature, cost/product shape undecided |
| BIN-461 | **needsApproval** *(carried over)* | Ticket's own text already records Malin's call ("build as its own workstream, not now") — surfacing only so it isn't silently dropped, not re-asking |
| BIN-454 | *(excluded, Tier D)* | Pure ops runbook, blocked on BIN-468 landing first |
| BIN-447 | *(excluded, not yet actionable)* | Blocked on the ~2026-07-13 weekly cache refresh (2 days out) |
| BIN-419 | *(excluded, not yet actionable)* | Due 2026-08-28 — measurement window hasn't elapsed |

## Batches (parallel worktrees, disjoint files per batch)

### Agent A — area: security-rules (firestore)
- [ ] **BIN-480** [Tier C · build-review] — `joinAttempts` create rule doesn't enforce
  `createdAt` presence/type/freshness, so a hand-crafted create (bypassing the app's own
  `groups.ts`, which always sets it) can produce an undateable doc that `retentionCleanup`'s
  `isStaleJoinAttempt` will never reap ("never delete data we can't date") — a residual
  GDPR Art. 17 retention gap on a spent invite token, specifically in the
  Firebase-Console-deleted-account case the sweep exists to cover. Fix: mirror the existing
  `updatedAt == request.time` pin pattern (firestore.rules:975) on the joinAttempts create
  rule — add `request.resource.data.createdAt is timestamp` +
  `request.resource.data.createdAt == request.time`. NOT currently exploited (live client
  always sets it) — this is defense-in-depth hardening, not an incident.
  Files: `firestore.rules`, `src/test/rules/firestore-rules.test.ts`.
  Acceptance:
  1. The `joinAttempts` create rule requires `request.resource.data.createdAt is timestamp`
     AND `request.resource.data.createdAt == request.time` (mirroring the `updatedAt`
     pattern already used elsewhere in this file).
  2. A new rules test proves a create with `{token}` only (no `createdAt`) is DENIED, and
     a create with a correct server-time `createdAt` is ALLOWED.
  3. `npm run test:rules` passes (all existing + new rules tests green).
  4. The live client (`src/lib/firebase/groups.ts`) is untouched — it already always sets
     `createdAt`; only the rule (+its test) changes.
  Stakeholders: router `top` → canonical `full-panel` (#4 Security Architect, #6 Data
  Protection Officer, #27 Database Administrator / Data-layer Engineer) — full panel,
  each blind.
  requiresPlanMode: **true** (full-panel tier). Additionally: CLAUDE.md sensitive-domain
  carve-out (firestore.rules) — build a best-guess implementation + expanded plan block,
  but this parks **In Review** for Malin's explicit go-ahead before the manual
  `firebase deploy --only firestore:rules` is ever run. Do NOT deploy rules from this
  sprint even if the diff is clean.
  Signoff reason: confirm the fix is scoped correctly (createdAt enforcement only, no
  behavior change to the live client) before the manual rules deploy — rules deploys are
  a one-way, unreviewable-by-CI risk surface.

### Agent B — area: ci-tooling
- [ ] **BIN-479** [Tier A · build] — `scripts/check-workflow-map.test.mjs` (added by
  BIN-470, 11 tests) is only runnable by hand (`node --test ...`) because vitest's
  `include` doesn't pick up `scripts/*.test.mjs`. Wire a
  `node --test scripts/check-workflow-map.test.mjs` step into both `ci.yml` and
  `deploy.yml`, next to the existing `check-workflow-map` linter step. Deliberately NOT
  touching vitest config (ticket explicitly scoped this out — apply-conflict risk).
  Files: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`.
  Acceptance:
  1. Both `ci.yml` and `deploy.yml` gain a `node --test scripts/check-workflow-map.test.mjs`
     step positioned next to the existing `node scripts/check-workflow-map.mjs` step.
  2. The new step actually runs the 11 tests and passes (verify locally before commit).
  3. Neither workflow's existing `check-workflow-map.mjs` step is removed, reordered
     into a broken position, or made conditional.
  4. No change to `vitest.config.ts` / any `include` glob (ticket explicitly scoped this out).
  Stakeholders: router `medium` → canonical `single` (#8 DevOps / SRE) — one blind critique.
  requiresPlanMode: false (single-tier, priority Low, no security label).

### Agent C — area: seo-tests
- [ ] **BIN-478** [Tier A · build] — BIN-473's empty-branch render test for
  `/billigaste/[slug]` proves the JSON-LD script tag doesn't throw, but never asserts the
  emitted JSON-LD actually parses/is well-formed, and never exercises `generateMetadata`
  at all. Add: (1) `JSON.parse()` on the emitted `ld+json` for the empty branch + assert
  `@type`/`@context`, (2) call `generateMetadata({ params })` for the zero-row slug and
  assert it resolves without throwing.
  Files: `src/app/billigaste/[slug]/page.test.tsx`.
  Acceptance:
  1. A test asserts `JSON.parse(...)` succeeds on the empty-branch's emitted `ld+json`
     content and checks `@type`/`@context` are present and correct.
  2. A test calls `generateMetadata({ params })` for the zero-row slug and asserts it
     resolves without throwing.
  3. The existing BIN-473 populated-branch and empty-branch render assertions remain
     intact (not weakened or removed to make the new assertions pass).
  4. `src/app/billigaste/[slug]/page.tsx` itself is untouched — test-only ticket, per the
     constraint BIN-473 already established for this page.
  Stakeholders: router `skip` (test-only, no production behavior change).
  requiresPlanMode: false.

### Agent D — area: workflow-map
- [ ] **BIN-477** [Tier A · build] — The BIN-471 re-trace covered BIN-463/464 but shipped
  before BIN-472 landed in the same working tree; BIN-472 added a legacy-card read
  (`hasLegacyReleaseCard` on the `${tmdbId}-release` inbox doc), a `seed` action (advances
  the per-user notified marker without pushing), and a `viaMarker: true` stamp — none of
  which are in the map's release-phase steps yet. The staleness flag
  (`.claude/state/workflow-map-stale.json`) is still present, deliberately left uncleared.
  Extend the `flow-available` release-phase steps to cover all three, regenerate
  `docs/workflow-map-content-baseline.json` if prose length changed, run the linter, then
  delete the stale flag.
  Files: `docs/workflow-map.html`, `docs/workflow-map-content-baseline.json`,
  `.claude/state/workflow-map-stale.json` (deleted).
  Acceptance:
  1. The `flow-available` release-phase steps in `docs/workflow-map.html` describe the
     legacy-card read (`hasLegacyReleaseCard` / `${tmdbId}-release` inbox check).
  2. The same steps describe the `seed` action (advance marker without push) and the
     `viaMarker: true` stamp on marker-path cards.
  3. `node scripts/check-workflow-map.mjs` passes (including against the regenerated
     content baseline, if prose length changed enough to need one).
  4. This commit touches ONLY `docs/workflow-map.html` +
     `docs/workflow-map-content-baseline.json` — no feature code bundled (lessons-digest
     rule) — and `.claude/state/workflow-map-stale.json` is deleted as part of it.
  Stakeholders: router `skip` (doc-only).
  requiresPlanMode: false.

## Needs you (Tier D / ops-blocked, doesn't count toward N)
*(none new this sprint — BIN-454 carries over, still blocked on BIN-468)*

## Parked for your call (needsApproval — not built this sprint)
- **BIN-468** (BIN-402 Stage 2) — carried over unchanged: build it as a dedicated
  planned session with the 4-role panel re-convened, not an auto parallel-worktree
  sprint.
- **BIN-173** (affiliate-tag deeplinks) — carried over unchanged: needs an
  Adtraction/affiliate account + your call on disclosure copy/placement.
- **BIN-189/170/185** — carried over unchanged: speculative social/AI features, worth a
  scoping pass each, not a blind build.
- **BIN-461** (genre hub pages) — not a new ask: the ticket text already records your
  call from the BIN-424 scoping pass ("its own workstream, not now"). Flagging only so
  it isn't silently forgotten.

## Post-sprint steps
1. Full `npm run typecheck` + `npm run lint` + `npm test` (root) + `npm run test:rules`
   if Java/JBR is on PATH.
2. File follow-ups for anything deferred mid-implementation.
3. Commit through the reviewer gates (`binge-code-reviewer` always applicable batches;
   `binge-security-reviewer` on Agent A's batch — firestore.rules; `binge-test-reviewer`
   on Agent A's, Agent C's, and Agent B's test-touching files) + `/code-review high`
   (xhigh on Agent A's batch — touches `firestore.rules`).
4. Push to main (triggers deploy.yml, hosting + CI workflow files only — Agent B's diff
   changes CI/deploy YAML itself, verify the workflow syntax is valid before push).
   Agent A's `firestore.rules` change is **NOT** covered by `deploy.yml` — per
   `reference_deploy_scope` AND this ticket's explicit CLAUDE.md carve-out, do **not** run
   `firebase deploy --only firestore:rules` from this sprint. It waits for Malin's
   explicit go-ahead on the parked In Review ticket.
5. Transition tickets: Agent B/C/D (Tier A builds, all-pass criteria) → Done. Agent A
   (BIN-480, Tier C + build-review + sensitive domain) → **In Review regardless of
   pass/fail**, with the plan-mode expansion block echoed in the ticket comment and an
   explicit note that the rules deploy is blocked on her go-ahead.

## Deviation log
*(append here as execution diverges from this plan)*

---

# Archived — Sprint 2026-07-11b post-shipment cleanup batch (superseded above, SHIPPED)

**Selection context:** the prior sprint's plan (archived below) already shipped —
BIN-451/452/459/460/463/464 are gone from the backlog and their code is on `main`
(ddeac3e, f1ebe89). This pass only found their **follow-up spawn**: BIN-459 filed
BIN-470 (verification failed on acceptance #3); BIN-463/464/451 filed BIN-471/472/473.
Linear MCP connected, scoped to project "Binge" throughout (shared team). No ticket
selected carries `onboarding-reserved`/`launch-gated`.

## Mandate gate — full pass over every open ticket

| Ticket | Verdict | Why |
|---|---|---|
| BIN-473 | **build** | Mechanical test-gap fix on already-shipped behavior, no product decision |
| BIN-472 | **build** | Finishes a pre-deploy safety gate the prior sprint's own follow-up flagged (GDPR sweep re-review + avoiding a one-time duplicate push); the conservative fix (seed dedup markers so no one double-pings) is the obvious-benefit option, not a debatable one |
| BIN-471 | **build** | Mechanical doc re-trace, satisfies existing CLAUDE.md workflow-map-freshness rule |
| BIN-470 | **build** | Tooling/CI fix closing a documented, verification-FAILED acceptance gap on BIN-459 |
| BIN-468 | **needsApproval** *(carried over)* | Unvetted Stage-2 redesign of a whole-DB blast-radius sweep; wants a dedicated planned session per prior sprint's note, nothing changed since |
| BIN-173 | **needsApproval** *(carried over)* | Needs a manual affiliate-network signup + a legal disclosure decision before the code does anything real |
| BIN-189 | **needsApproval** *(carried over)* | Speculative social feature, no mockup/spec |
| BIN-170 | **needsApproval** *(carried over)* | Speculative shareable feature, no mockup/spec |
| BIN-185 | **needsApproval** *(carried over)* | Speculative AI-recap feature, cost/product shape undecided |
| BIN-461 | **needsApproval** | Ticket's own text already records Malin's call ("build as its own workstream, not now") — surfacing only so it isn't silently dropped, not re-asking |
| BIN-454 | *(excluded, Tier D)* | Pure ops runbook, blocked on BIN-468 landing first |
| BIN-447 | *(excluded, not yet actionable)* | Blocked on the ~2026-07-13 weekly cache refresh |
| BIN-419 | *(excluded, not yet actionable)* | Due 2026-08-28 — measurement window hasn't elapsed |

No obsolete tickets found — the six tickets the prior sprint targeted are already gone
from the backlog (closed) and their code is live on `main`.

## Batches (parallel worktrees, disjoint files per batch)

### Agent A — area: release-notify (functions)
- [x] **BIN-472** [Tier C · build] — SHIPPED (66c4ad9).
### Agent B — area: workflow-map
- [x] **BIN-471** [Tier A · build] — SHIPPED (4d61263).
- [x] **BIN-470** [Tier A · build] — SHIPPED (66c4ad9).
### Agent C — area: seo
- [x] **BIN-473** [Tier A · build] — SHIPPED (66c4ad9).

## Post-sprint steps
1. Full `npm run typecheck` + `npm run lint` + `npm test` (root) + `npm run test:rules`
   if Java/JBR is on PATH.
2. File follow-ups for anything deferred mid-implementation.
3. Commit through the reviewer gates (`binge-code-reviewer` always; `binge-security-reviewer`
   on Agent A's batch — functions + GDPR-adjacent; `binge-test-reviewer` on Agent A's
   and Agent C's test files) + `/code-review high` (xhigh on Agent A's batch — touches
   `functions/src/`).
4. Push to main (triggers deploy.yml, hosting only). Agent A's `functions/**` change is
   NOT covered by deploy.yml — it needs a manual, separately-confirmed
   `firebase deploy --only functions:availableNotify` after the hosting push, per
   `reference_deploy_scope`. This IS the deploy BIN-472 is a pre-deploy gate for, so
   don't run it before Agent A's diff is reviewed and merged.
5. Transition tickets: Tier A builds with all-pass criteria → Done. BIN-472 (Tier C,
   security-sensitive, requiresPlanMode) → In Review regardless of pass/fail, per tier
   rules.

## Deviation log
*(shipped clean, no deviations logged — filed BIN-477/478/479/480 as follow-ups, see
current sprint above)*

---

# Archived — Sprint 2026-07-11 follow-up cleanup batch (superseded above, SHIPPED)

**Selection context:** backlog was almost entirely BIN-402/360/424 follow-up tickets from
the last few days plus a handful of untouched "idea" tickets from the 2026-06-22 ideation
batch. Linear MCP connected, scoped to project "Binge" throughout (shared team). No ticket
selected carries `onboarding-reserved`/`launch-gated`.

## Mandate gate — full pass over every open ticket

| Ticket | Verdict | Why |
|---|---|---|
| BIN-459 | **build** | Tooling-only fix (linter content-check), no product decision |
| BIN-460 | **build** | Defensive correctness fix, uses existing EmptyState pattern |
| BIN-463 | **build** | Backend efficiency fix, design already specified in ticket |
| BIN-464 | **build** | Backend correctness fix, design already specified in ticket |
| BIN-451 | **build** | Mechanical doc-coverage fix, satisfies existing CLAUDE.md rule |
| BIN-452 | **build** | Test-gap fix on already-shipped code, no behavior change |
| BIN-468 | **needsApproval** | Unvetted Stage-2 redesign of a whole-DB blast-radius sweep; same area had a same-day failed/reverted attempt. CLAUDE.md's risky-migration carve-out wants an explicit go-ahead, not just the routine risk-gate. |
| BIN-454 | *(excluded, Tier D)* | Pure ops runbook (manual `firebase deploy`, Console flip), blocked on BIN-468 |
| BIN-173 | **needsApproval** | Needs a manual affiliate-network signup + a legal disclosure decision before the code does anything real |
| BIN-189 | **needsApproval** | Speculative social feature, no mockup/spec |
| BIN-170 | **needsApproval** | Speculative shareable feature, no mockup/spec |
| BIN-185 | **needsApproval** | Speculative AI-recap feature, cost/product shape undecided |
| BIN-447 | *(excluded, not yet actionable)* | Ops action gated on the ~2026-07-13 weekly cache refresh; nothing to do today |
| BIN-419 | *(excluded, not yet actionable)* | Due 2026-08-28 — measurement window hasn't elapsed |

No obsolete tickets found — recent commits (234ea1f…fdc175e) don't resolve any currently-open
ticket outright.

## Batches (parallel worktrees, disjoint files per batch)

### Agent A — area: release-notify (functions)
Both tickets touch the same release-phase code in `availableNotify`/`releaseNotify`, so they
stay in one worktree to avoid cross-batch conflicts.

- [x] **BIN-463** [Tier C · build] — SHIPPED (ddeac3e).
- [x] **BIN-464** [Tier C · build] — SHIPPED (ddeac3e).

### Agent B — area: workflow-map
- [x] **BIN-451** [Tier A · build] — SHIPPED (f1ebe89).
- [x] **BIN-459** [Tier A · build] — SHIPPED (ddeac3e), partial (BIN-470 filed for the
  gap verification found).

### Agent C — area: seo
- [x] **BIN-460** [Tier B · build] — SHIPPED (ddeac3e).

### Agent D — area: functions-tests
- [x] **BIN-452** [Tier A/C (mechanical exception) · build] — SHIPPED (ddeac3e).

## Needs you (Tier D / ops-blocked, doesn't count toward N)
- **BIN-454** — tmdbFieldsSweep rollout runbook. Blocked on BIN-468 landing first (per
  memory: do NOT flip `mutateEnabled` before BIN-468). Manual steps: deploy rules, deploy
  function, dry-run, record cost, flip the Console flag — all outside this sprint's reach.

## Parked for your call (needsApproval — not built this sprint)
- **BIN-468** (BIN-402 Stage 2) — build it, but as a dedicated planned session with the
  4-role panel re-convened for the revised multi-stamp design (not an auto parallel-worktree
  sprint) — this exact area had a same-day failed/reverted attempt.
- **BIN-173** (affiliate-tag deeplinks) — the single highest-ROI idea in the backlog per its
  own writeup, but needs an Adtraction/affiliate account (ops, outside the loop's reach) +
  your call on disclosure copy/placement before the code does anything real.
- **BIN-189** (seasonal challenges), **BIN-170** (Binge Wrapped), **BIN-185** (spoiler-safe
  recaps) — all speculative social/AI features with no mockup or spec. Worth a scoping pass
  each, not a blind build.

## Post-sprint steps
1. Full `npm run typecheck` + `npm run lint` + `npm test` (root) + `npm run test:rules` if
   Java/JBR is on PATH.
2. File follow-ups for anything deferred mid-implementation.
3. Commit through the reviewer gates (`binge-code-reviewer` always; `binge-security-reviewer`
   on the two functions-touching batches; `binge-test-reviewer` on BIN-452/463/464's test
   files) + `/code-review high` (xhigh on Agent A's batch — touches `functions/src/`).
4. Push to main (triggers deploy.yml). This repo's `functions/**` changes (Agent A, Agent D)
   are NOT covered by `deploy.yml` — they need a manual, separately-confirmed
   `firebase deploy --only functions:<name>` after the hosting push, per
   `reference_deploy_scope`.
5. Transition tickets: Tier A/mechanical builds with all-pass criteria → Done. BIN-460
   (Tier B, user-facing) → In Review regardless of pass/fail, per tier rules.

## Deviation log
*(append here as execution diverges from this plan — this batch shipped clean, no deviations logged)*

---

# Archived — BIN-402 relaunch sprint (2026-07-11, superseded above)

# BIN-402 relaunch — TMDB-field ToS sweep (Stage 1 + Stage 2), FULL build

**Status:** APPROVED by Malin 2026-07-11 (build Stage 1 + Stage 2 now). 4-role blind panel
(Security #4 / DPO #6 / DBA #27 / Legal #5) cleared it — full plan + conditions:
`~/.claude/plans/binge-bin402-relaunch.md`. **Top-tier sensitive** (firestore.rules + functions
+ client). Deploy = Tier-D manual, ordered rules → function → client (workflow_dispatch).

## Built (all verified green: functions build, typecheck, 47 unit + 148 rules tests, lint)
- `functions/src/tmdbTosSweep/**` — restored monthly sweep, dry-run default, hard field
  allowlist, cursor+budget, audit record. **+ DBA ~270s soft-deadline** so `lastRun` survives.
- `firestore.rules` — `tmdbFieldsRefreshedAt` in watchlist `hasOnly` + type-bind, **+ Security
  `<= request.time` hardening** (no forged-future stamp). One-way-ratchet documented in-rule.
- `functions/src/index.ts` — export (corrected the "no rules change" comment).
- `src/test/rules/firestore-rules.test.ts` — 4 tests (3 reviewed + future-stamp rejection).
- **BIN-453 stamp-writer** — `tmdbFieldsRefreshedAt = serverTimestamp()` on `addItem`
  (WatchlistContext) + `nextAirReadRepair.buildRepairPayload`. Never bumps `updatedAt` (test-locked).
- **Lazy-refresh (Stage 2 precondition)** — `src/lib/watchlist/tmdbFieldsRefresh.ts` (pure gate,
  90-day interval < 5-mo sweep) + `refreshTmdbFields` in WatchlistContext + wired into
  Movie/TVShowPageClient (reuses the page's TMDB detail — no extra fetch). Repopulates a swept
  doc; keeps a viewed title from being swept.
- `src/types/domain.ts` — `tmdbFieldsRefreshedAt` on WatchlistItem; mapped in context.
- `docs/data-retention-policy.md` — documents the sweep (DPO binding).

## Deferred to existing tickets (non-blocking; linter green without them)
- BIN-451 (workflow-map flow + universe entry) — intricate doc edit, own ticket.
- BIN-452 (sweep-orchestration test) — index.ts needs firebase-admin (not in CI root); own ticket.

## Deploy + ENABLE sequence (Tier-D)
1. `firebase deploy --only firestore:rules` — confirm SUCCESS (Security: literal check).
2. `firebase deploy --only functions:tmdbFieldsSweep` (dry-run default).
3. Client via `workflow_dispatch` (functions/rules guard blocks push-deploy) + Cloudflare purge.
4. Manually trigger a dry-run → verify `lastRun.fullPassCompleted === true` + cost (DBA).
5. Flip `sweepState/tmdbFieldsSweep.mutateEnabled = true` in Console → watch one live run.

## Binding invariants
Never bump `updatedAt` (continueWatching sort, test-locked). Rules entry is a ONE-WAY RATCHET
(never revert in isolation; roll back client stamp-writer first). Rules deploy STRICTLY before
client. See `~/.claude/plans/binge-bin402-relaunch.md` for the full panel conditions.
</content>
