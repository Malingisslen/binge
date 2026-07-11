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
