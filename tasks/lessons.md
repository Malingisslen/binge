# Lessons — global self-improvement loop

On ANY correction from Malin, append an entry **before continuing** the task. This is
the durable record of "things I got wrong once and shouldn't repeat." Newest at the
bottom.

Format:
```
### [Category] Short title   <!-- template shows the REAL heading level (###) so copy-paste stays visible to the digest drift-check -->
- **Date:** YYYY-MM-DD
- **Trigger:** what I did / the situation that prompted the correction
- **Rule:** the corrected behavior, stated as a directive
- **Example:** a concrete before/after if useful
```

Categories: `[Workflow]` `[Design]` `[Data]` `[Security]` `[Testing]` `[Linear]`
`[Communication]` `[Deploy]`.

---

<!-- append entries below -->

### [Workflow] Never bundle workflow-map.html edits with feature code
- **Date:** 2026-07-10
- **Trigger:** Reverting the BIN-402 TMDB-field sweep (commit e2cf608) also silently deleted the *unrelated* BIN-422/423 franchise+person flow documentation, because a prior sprint had bundled that map edit into the same feature commit (38bfd3b). The coverage linter (`scripts/check-workflow-map.mjs`) stayed green — it only checks that covered paths exist, not that a flow's description still holds its content — so nothing flagged the loss; it was caught only by a manual grep.
- **Rule:** Keep `docs/workflow-map.html` edits in their own dedicated commit, separate from feature code that might later be reverted. A feature-revert must never be able to take unrelated flow docs down with it. (Structural CI guard tracked in BIN-459.)
- **Example:** BAD — one commit carries `functions/src/tmdbSweep.ts` + a `flow-titlepage` description edit; reverting the function drops the flow prose too. GOOD — feature code in commit A, the map re-trace in commit B; reverting A leaves the map intact.

### [Workflow] A review-gate ticket isn't done until its marker names the surface it was filed to protect
- **Date:** 2026-07-11
- **Trigger:** BIN-472 existed purely as a pre-deploy gate: run a fresh `binge-security-reviewer` pass over the `retentionCleanup` GDPR-erasure sweep before the manual `firebase deploy --only functions` (which ships both `availableNotify` AND `retentionCleanup`). The review ran, but its `security-done.marker` was **scope-limited** — it said `retentionCleanup NOT covered`. Marking the ticket Done on the marker's mere existence would have shipped the exact gap the ticket was filed to close, with a live GDPR-erasure sweep unreviewed.
- **Rule:** When a ticket's *deliverable is a review of surface X* (security/test/design), don't accept the review marker at face value — read it and confirm it explicitly names surface X. A scope-limited marker that reviewed a neighbouring file is an UNMET acceptance criterion, not a pass. File a blocking follow-up and gate the deploy.
- **Example:** BAD — `security-done.marker` exists → grade acceptance "review retentionCleanup" as met. GOOD — marker says "scope-limited … retentionCleanup NOT covered" → acceptance failed → file blocking BIN-476, hold the functions deploy.

### [Workflow] In a parallel sprint, a review marker can cover ONE batch and silently leave the sibling batch un-reviewed
- **Date:** 2026-07-14
- **Trigger:** A 2-batch parallel sprint (BIN-496 SEO + BIN-495 watchlist Firestore-write). The `code-review-done.marker` and `test-done.marker` both passed the mtime gate but their CONTENT named only the SEO area — the BIN-495 hook diff (a user-data Firestore write) would have committed through the reviewer gate un-reviewed by `binge-code-reviewer`, and its one risky acceptance criterion had no test-reviewer verdict. Separately the `simplify-done.marker` mtime was fresh (2026-07-14) but its CONTENT was stale BIN-185 text (HEAD 0a3e021, a different sprint). The gate keys on mtime, so all three would have passed silently.
- **Rule:** In post-sprint, read EVERY review marker's content and confirm it names EACH batch's surface, not just one. When a parallel sprint fans work across worktrees, the per-batch review evidence must be reconciled at merge — a marker that names only the loudest batch is an unmet gate for the quiet one. Re-review the un-named surface (opus, the correctness model, for small diffs) and re-stamp the marker to name it before commit; never trust marker mtime over marker content.
- **Example:** BAD — `code-review-done.marker` says "SEO area reviewed", mtime fresh → commit both batches. GOOD — notice it never names `useEpisodeProgress*.ts`, re-review that diff, re-stamp the marker naming the watchlist batch, file BIN-499 for the missing test-reviewer verdict, then commit.

### [Testing] Mutation-verification restore via `git checkout --` can wipe the real unstaged edit
- **Date:** 2026-07-16
- **Trigger:** During BIN-522, a mutation-verification pass (deliberately breaking a line to prove a test catches it) restored `WatchlistContext.tsx` with `git checkout -- <file>` — which restored to HEAD, wiping the sprint's real no-op-gate edit along with the deliberate mutations, since the real edit was unstaged working-tree state, not committed. The loss was only caught because the implementer re-diffed afterwards; the identical edit had to be re-applied and the full suite + typecheck re-run.
- **Rule:** Never use `git checkout -- <file>` / `git restore <file>` to undo a deliberate mutation when the file also carries uncommitted real work. Snapshot the pre-mutation file first (`cp` to scratchpad, or `git stash push` scoped to the file, or apply the mutation as a patch you can reverse-apply), and after restoring, verify with `git diff` that the real edit is still present before moving on.
- **Example:** BAD — edit file (real fix) → mutate line → `git checkout -- file` → real fix gone. GOOD — edit file → `cp file $SCRATCH/file.pre-mutation` → mutate → `cp $SCRATCH/file.pre-mutation file` → `git diff` shows the real fix intact.
