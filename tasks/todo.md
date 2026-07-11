# Sprint 2026-07-11b — post-shipment cleanup batch

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
- [ ] **BIN-472** [Tier C · build] — Close the two pre-deploy gates BIN-464's own
  follow-up flagged before the (still-pending, manual) `firebase deploy --only
  functions` for `availableNotify`/`retentionCleanup`: (1) the GDPR-erasure
  `retentionCleanup` sweep never got its own security-reviewer pass (the original
  review only covered the staged release-notify diff), and (2) cutover from the old
  inbox-doc-existence dedup to the new per-user marker can double-push anyone whose
  film sits inside the 3-day catch-up grace window at deploy time (no marker exists
  yet for them). Build the conservative fix: on first encounter with no marker for a
  (tmdbId, uid) inside the fire window, check whether a `${tmdbId}-release` inbox
  card already exists for that user; if so, seed the marker to `dateToFire` WITHOUT
  sending a push (already notified once under the old scheme) instead of re-firing.
  Files: `functions/src/availableNotify/index.ts`, `functions/src/releaseNotify/logic.ts`,
  `functions/src/releaseNotify/logic.test.ts`.
  Acceptance:
  1. A user who already has a `${tmdbId}-release` inbox card for a film whose
     `dateToFire` matches does NOT receive a second "släpps idag" push after
     deploy — the marker is seeded from the existing card, not from a fresh send.
  2. A user with NO existing inbox card for that title still gets pushed normally
     (the seed-check never suppresses a genuinely new notification).
  3. New pure-logic test(s) cover the seed-vs-notify decision, with no
     `firebase-admin` import (root vitest constraint).
  4. The staged diff carries a fresh `binge-security-reviewer` marker covering
     BOTH `retentionCleanup` and this change (closes the ticket's gap #1 — the
     sweep's security review that never happened).
  Stakeholders: router `medium` → canonical `single` (#27 Database Administrator /
  Data-layer Engineer) — one blind critique.
  requiresPlanMode: **true** (single-tier + priority High ≤ 2 escalates per the
  risk gate).

### Agent B — area: workflow-map
- [ ] **BIN-471** [Tier A · build] — Re-trace the `availableNotify` +
  `retentionCleanup` flows in `docs/workflow-map.html` to reflect BIN-463/464's
  transport change (release-date cache doc + per-user dedup marker + the new
  `retentionCleanup` `notified` collection-group sweep), which the prior sprint's
  doc-only commit only partially covered (it added the new `tmdbFieldsSweep` flow
  but left these two flows stale).
  Files: `docs/workflow-map.html`.
  Acceptance:
  1. The `availableNotify` flow's release-phase description/steps mention the
     `releaseNotifyState/{tmdbId}` cache doc and the per-user
     `releaseNotifyState/{tmdbId}/notified/{uid}` marker (not the old
     inbox-doc-existence check).
  2. The `retentionCleanup` flow lists the `notified` collection-group sweep as a
     step/payload.
  3. `node scripts/check-workflow-map.mjs` passes.
  4. This commit touches ONLY `docs/workflow-map.html` — no feature code bundled
     (lessons-digest rule from the BIN-459 incident this ticket itself exists to
     prevent recurring).
  Stakeholders: router `skip` (doc-only).
  requiresPlanMode: false.

- [ ] **BIN-470** [Tier A · build] — Close BIN-459's failed acceptance #3: add a
  committed per-flow content baseline the linter diffs against (so a revert that
  *thins* a still-substantive flow description — not just guts it to a stub — fails
  CI), plus a test/fixture exercising `checkFlowContent`'s fail path (currently
  untested, so it could silently rot to a no-op).
  Files: `scripts/check-workflow-map.mjs` (+ a new baseline/snapshot file it reads),
  a new test file for the linter (e.g. `scripts/check-workflow-map.test.mjs` or
  under root vitest if the repo's test runner picks up `.mjs`).
  Acceptance:
  1. A committed per-flow baseline exists and the linter fails when a flow's
     current description is a net prose-loss vs. that baseline (not just below
     the absolute floor from BIN-459).
  2. `node scripts/check-workflow-map.mjs` still passes cleanly on the current,
     unmodified `docs/workflow-map.html` (no false positive).
  3. A new automated test proves the fail path: feed `checkFlowContent` (or the
     baseline-diff function) a thinned-but-still-above-floor description →
     assert it reports a problem; feed it a clean/unchanged description → assert
     it passes.
  4. The existing absolute-floor check from BIN-459 is kept, not replaced.
  Stakeholders: router `skip` (doc/tooling-only).
  requiresPlanMode: false.

### Agent C — area: seo
- [ ] **BIN-473** [Tier A · build] — Add a light render test for
  `/billigaste/[slug]`'s `rows.length === 0` branch (BIN-460's "kommer snart"
  resilient page vs. `notFound()`), since the branch currently has zero test
  coverage on all three of BIN-460's own acceptance criteria.
  Files: a new test file, e.g. `src/app/billigaste/[slug]/page.test.tsx` (adjust
  to whatever the page's export shape/test conventions allow — it's an async
  Server Component; test the extractable render/data logic if the component
  itself isn't directly testable under jsdom).
  Acceptance:
  1. A test asserts the `rows.length === 0` case renders the `EmptyState`-based
     "kommer snart" page (200/indexable), not `notFound()`.
  2. A test asserts the thin-state JSON-LD/metadata path doesn't throw or emit
     malformed schema when `rows` is empty.
  3. A test asserts the happy-path (`rows.length > 0`) render is unaffected by
     the new branch (byte-for-byte / structurally unchanged is over-strict for a
     Server Component test — assert the populated-state key content still
     renders).
  4. Don't touch `src/app/billigaste/[slug]/page.tsx` itself unless a test seam
     is strictly required to make it testable — this ticket is test-only.
  Stakeholders: router `skip` (doc/test-only, no production behavior change).
  requiresPlanMode: false.

## Needs you (Tier D / ops-blocked, doesn't count toward N)
*(none new this sprint — BIN-454 carries over from the prior sprint, still blocked
on BIN-468)*

## Parked for your call (needsApproval — not built this sprint)
- **BIN-468** (BIN-402 Stage 2) — carried over unchanged: build it as a dedicated
  planned session with the 4-role panel re-convened, not an auto parallel-worktree
  sprint.
- **BIN-173** (affiliate-tag deeplinks) — carried over unchanged: needs an
  Adtraction/affiliate account + your call on disclosure copy/placement.
- **BIN-189/170/185** — carried over unchanged: speculative social/AI features,
  worth a scoping pass each, not a blind build.
- **BIN-461** (genre hub pages) — not a new ask: the ticket text already records
  your call from the BIN-424 scoping pass ("its own workstream, not now"). Flagging
  only so it isn't silently forgotten — recommendation is to leave it parked until
  you schedule that workstream.

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
   rules, with the plan-mode expansion block echoed in the ticket comment.

## Deviation log
*(append here as execution diverges from this plan)*

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
