# Sprint 2026-08-05 — per-batch commit sprint (CLOSED)

Base: `f6cdbe1`. Six batches selected, four committed and pushed to `main`, two held.
The 2026-08-04b plan that used to live here is deleted, not archived: its work landed
(`1ad688b`, `f6cdbe1`) and its "Needs you" section had gone false — it still claimed
BIN-700/643/729 were unbuilt after they shipped. Plans are disposable (code-style rule);
a stale plan that states false things is worse than no plan.

## Outcome

| Batch | Tickets | Result |
| --- | --- | --- |
| batch-0 (auth) | BIN-748 | **HELD** — security + integration reviewers both failed it, 1 blocking each; outcome verification failed on all three axes. Nothing reached the app. Work recoverable: stash `sprint-parallel-cleanup-held-batch-0`, patch `.claude/state/binge/batch-0-20260805-151400.patch`. |
| batch-1 (watchlist) | BIN-643, BIN-729, BIN-700 | Committed `2dbf487`, pushed. BIN-643/729 → Done. BIN-700 → In Review (see below). |
| batch-2 (social) | BIN-752 | Committed `2ce3b2c`, pushed → Done. |
| batch-3 (frontend) | BIN-747 | Committed `24bdd3e`, pushed → Done. |
| batch-4 (streaming) | BIN-746 | Committed `c28b90d`, pushed → Done. |
| batch-5 (infra-docs) | BIN-706 | **HELD** — outcome verification failed on all three axes. Nothing reached the repo. Work recoverable: stash `sprint-parallel-cleanup-held-batch-5`. |

Review findings across the run: 28, of which 2 blocking — both fixed before their batch
committed. Whole-diff cross-batch review: clean. Excluded per Malin's standing calls:
BIN-521, BIN-189.

## Needs Malin

- **BIN-700 — In Review.** The library error state and its "Försök igen" button are LIVE on
  main. This ticket (with BIN-643/729) was explicitly parked on her A/B choice and was built
  anyway; option (a) was self-approved by the sprint. She confirms the copy and the shape, or
  it is a revert/rework. See the lesson "Not built this sprint is a binding parking brake".
- **`.claude/state/workflow-map-stale.json` is still present** and now names three files
  batch-1 actually changed — the workflow map describes onboarding/import/watchlist flows
  that no longer behave as documented, and the linter cannot see it. BIN-706 must run from
  Malin's own machine (the flag is gitignored and unreachable from a worktree).

## Follow-ups filed

BIN-754 (close-out wrote zero transitions), BIN-755 (retryListener has no tests),
BIN-756 (BIN-747 fixed one of three untrimmed bio sources), BIN-757 (security reviewer
never opens the client bulk-write paths), BIN-758 (no medium-tier stakeholder critique ran),
BIN-759 (BIN-752's "never resync" wording vs open BIN-624), BIN-760 (global-error.tsx is an
undocumented Sentry/analytics egress point).
