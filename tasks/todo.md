# Sprint 2026-07-11 — follow-up cleanup batch

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

- [ ] **BIN-463** [Tier C · build] — Cache the resolved SE digital release date per title so
  `availableNotify`'s release phase stops calling `GET /movie/{id}/release_dates` for every
  `vill_se` movie on every daily run.
  Files: `functions/src/availableNotify/index.ts`, `functions/src/availableNotify/tmdb.ts`,
  `functions/src/releaseNotify/logic.ts`, `functions/src/releaseNotify/tmdb.ts`,
  `functions/src/releaseNotify/logic.test.ts` (+ new per-title cache doc, e.g.
  `digitalReleaseState/{tmdbId}`).
  Acceptance:
  1. A movie with a stored FUTURE `seDigitalDate` is not re-fetched from TMDB on subsequent
     daily runs until the date passes or a re-check TTL elapses.
  2. Movies with an unknown/near-term date are still checked, so the "släpps idag" push is
     never missed because of the cache.
  3. New pure-logic unit test(s) cover the caching gate, with no `firebase-admin` import
     (root vitest constraint).
  4. Push semantics are unchanged — a film still fires exactly once, on the correct
     Stockholm calendar day.
  Stakeholders: router `single` (Data/Integrations Engineer, #13) — one blind critique.
  requiresPlanMode: false (priority Low, single-tier only escalates at priority ≤2 or
  security label).

- [ ] **BIN-464** [Tier C · build] — Replace the release-push dedup (keyed on the deletable
  `${tmdbId}-release` inbox-doc's existence, exact-day match) with a dedicated per-user
  marker storing the notified date + a small grace window.
  Files: same as above, plus wherever the new marker doc/collection lives (top-level
  Admin-SDK state doc per the ticket's own preference, to avoid new GDPR-export wiring) or
  `src/lib/firebase/userData.ts` if a user-owned subcollection is used instead.
  Acceptance:
  1. The new dedup marker is separate from the deletable "släpps idag" inbox card (deleting
     the card doesn't cause a same-day duplicate push).
  2. A missed/delayed daily run still fires the push on a later run within the grace window
     (no more permanent drop on a skipped day).
  3. A genuine new future type-4 SE date on the same title (re-release) is allowed to notify
     again — not blocked forever by the old marker.
  4. If a user-owned subcollection is chosen for the marker, `collectUserDataSnapshots` in
     `src/lib/firebase/userData.ts` is updated so GDPR export/delete still covers it; if a
     top-level admin doc is chosen instead, this criterion is N/A.
  Stakeholders: router `single` (Data/Integrations Engineer, #13) — one blind critique
  (same routing as BIN-463, same files).
  requiresPlanMode: false.

### Agent B — area: workflow-map
- [ ] **BIN-451** [Tier A · build] — Add the already-shipped `tmdbFieldsSweep` scheduled
  function to the workflow-map coverage universe and give it a flow.
  Files: `docs/workflow-map-universe.json`, `docs/workflow-map.html`.
  Acceptance:
  1. `tmdbFieldsSweep` appears in `docs/workflow-map-universe.json`'s `functions[]` list.
  2. `docs/workflow-map.html` has a new flow (scheduled trigger → dry-run gate →
     collectionGroup scan → stale-field clear → audit record), referencing BIN-402/468.
  3. `node scripts/check-workflow-map.mjs` passes with updated coverage (not the stale
     59/59).
  4. This commit touches ONLY workflow-map files — no feature code bundled (lessons-digest
     rule from the BIN-459 incident).
  Stakeholders: router `skip` (doc-only).
  requiresPlanMode: false.

- [ ] **BIN-459** [Tier A · build] — Extend the workflow-map coverage linter with a
  content-level check so a feature-revert that thins a flow's description fails CI instead
  of passing silently (this bit BIN-422/423's docs on 2026-07-10).
  Files: `scripts/check-workflow-map.mjs` (+ any snapshot/baseline file it needs).
  Acceptance:
  1. The linter gains a check beyond path-existence (e.g. per-flow content
     snapshot/ticket-id-retention assertion).
  2. `node scripts/check-workflow-map.mjs` still passes cleanly on the current, unmodified
     `workflow-map.html` (no false positive).
  3. A repro (test or manual, documented in the commit) shows the new check FAILS when a
     flow's description is reverted/thinned back to a prior version.
  4. Don't edit `docs/workflow-map.html` content in this ticket — matches the ticket's own
     "process fix already landed, this is the CI-fix half" framing.
  Stakeholders: router `skip` (doc/tooling-only).
  requiresPlanMode: false.

### Agent C — area: seo
- [ ] **BIN-460** [Tier B · build] — `/billigaste/[slug]` renders a resilient, indexable
  "kommer snart" state instead of `notFound()` when a franchise has zero SE-streamable
  released films or a flaked build-time TMDB fetch, so a transient flake can't ship a
  soft-404 URL that the sitemap + `/guider` hub already advertise.
  Files: `src/app/billigaste/[slug]/page.tsx`.
  Acceptance:
  1. When `rows.length === 0`, the page renders a 200 indexable page using the design
     system's `EmptyState` pattern (not `notFound()`).
  2. JSON-LD / canonical metadata degrades gracefully on the thin state — no schema errors.
  3. Existing happy-path rendering (`rows.length > 0`) is byte-for-byte unchanged.
  4. No new TMDB calls added; still uses the existing `fetchForBuild` + `withRetry` pattern.
  Stakeholders: router `skip`.
  requiresPlanMode: false.

### Agent D — area: functions-tests
- [ ] **BIN-452** [Tier A/C (mechanical exception) · build] — Extract the `tmdbFieldsSweep`
  orchestration decisions (dry-run gate default, cursor-resume-only-in-mutate-mode,
  budget-abort thresholds, idempotent skip) into an admin-free pure helper and unit-test
  them — currently zero coverage on the whole-DB-blast-radius loop.
  Files: `functions/src/tmdbTosSweep/logic.ts`, `functions/src/tmdbTosSweep/logic.test.ts`,
  `functions/src/tmdbTosSweep/index.ts` (wire the scheduled function through the extracted
  helper — no behavior change).
  Acceptance:
  1. New tests cover: `mutateEnabled` defaults false (dry-run), cursor resumes only when
     `mutateEnabled` is true (dry-run always starts from `null`), and budget-abort triggers
     at `MAX_DOCS_PER_RUN`/`MAX_CLEARS_PER_RUN`/`SOFT_DEADLINE_MS`.
  2. A test asserts the clear payload never includes `updatedAt` (test-locked invariant
     already documented in `index.ts`).
  3. Extracted helper(s) import no `firebase-admin`/`firebase-functions` (root-vitest
     constraint — reference_functions_test_import).
  4. `index.ts`'s scheduled-function body calls through the extracted helper — no logic
     duplicated/forked between the two files.
  Stakeholders: router `skip`.
  requiresPlanMode: false.

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
*(append here as execution diverges from this plan)*

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
