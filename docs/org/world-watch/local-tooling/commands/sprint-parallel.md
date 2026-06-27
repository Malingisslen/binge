---
description: Parallel autonomous sprint — fan area-clusters across isolated git worktrees
---

# /sprint-parallel — Binge parallel sprint

A higher-throughput variant of `/sprint-execute` that fans **independent area
clusters** across isolated git worktrees so they can be built without colliding.
Binge supports worktrees (the repo already uses `C:/binge-wt-*` worktrees). Use this
only when the selected tickets split cleanly into non-overlapping areas — otherwise
prefer plain `/sprint-execute` (parallel worktrees over the same files cause merge
pain that outweighs the speedup).

Everything in `/sprint-execute` applies — selection, tiers A–D, **router-based review
routing + the default-ON stakeholder panel before building (§2b), the unified
router-tier risk signal, the `--no-review` opt-out, and the non-halt park rule**,
acceptance criteria, risk-gated plan mode, Step 0 re-read, fresh-context verification,
the commit gate, and the follow-up rule. That includes the **shared-team rule**: select
ONLY with `list_issues project:"Binge"`, never by team (Synat shares the `Binge` team).

Run the per-ticket route + panel (§2b) **inside each worktree** alongside implementation,
and honour the non-halt rule per cluster: a high-stakes panel conflict parks that one
ticket In Review and the cluster moves on — it never blocks the worktree or the
integration barrier. `--no-review` and `--pick` propagate from `/sprint-execute`
(though `--pick` + parallel worktrees is rarely worth it — prefer plain `/sprint-execute
--pick` for interactive single-pick). The additions:

## Clustering

1. After selection, group tickets by **area label** into clusters whose file
   footprints don't overlap (use the area→path map in `.claude/commands/linear.md`).
   A good split: `frontend` vs `data` vs `infra` rarely touch the same files;
   `watchlist` + `streaming` often do — keep those in ONE cluster.
2. **Cap concurrency** — at most 3–4 worktrees at once. Each worktree is a full
   checkout; more than that thrashes disk and review attention.

## Worktree lifecycle (per cluster)

1. Create: `git worktree add C:/binge-wt-<area> -b sprint/<area>` (worktree dirs are
   already permitted; `binge-wt-*` is the naming convention).
2. Implement the cluster's tickets inside its worktree, following all
   `/sprint-execute` rules. **Scope agents to the cluster's files** — never a tree
   walk (`node_modules`, `.next`, `out/`, `.tmdb-cache/` will stall it).
3. Run the stack gates **inside the worktree** before integrating:
   `npm run lint && npm run typecheck && npm test` (+ `build` for the final merge).

## Integration (serialized — the one barrier)

Worktrees build in parallel, but **integrate to `main` one at a time** to keep the
deploy sane:

1. For each cluster in priority order: rebase its branch on latest `main`, resolve
   any conflicts, run `npm run build` once more, then fast-forward/merge into `main`.
2. Commit + push via `/commit` (gated by the review hook — run reviewers per cluster).
3. Tier A → Done; Tier B/C → In Review + notify.
4. `git worktree remove C:/binge-wt-<area>` and delete the branch.

## Cleanup guarantee

On success OR failure, remove every `binge-wt-*` worktree you created and prune
(`git worktree prune`). Never leave orphaned worktrees. Deferred scope → new tickets.
