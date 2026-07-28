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

### [Workflow] "I read very little of what you reply" is a config bug before it is a style problem
- **Date:** 2026-07-25
- **Trigger:** Malin said she reads very little of the terminal output. The reflex is to write a shorter summary and move on. Checking the actual configuration found the cause: `explanatory-output-style@claude-plugins-official` was enabled in `~/.claude/settings.json`, injecting a SessionStart instruction to add "★ Insight" boxes and stating that Claude "may exceed typical length constraints". Each repo's `CLAUDE.local.md` also carried a "final summaries are written for someone who wasn't watching" bullet that pulled toward longer prose.
- **Rule:** When she complains about how you communicate, audit the always-on configuration BEFORE apologising or self-correcting in prose. Verbosity that survives repeated correction is almost always instructed somewhere — an output style, a SessionStart hook, a plugin, or a stale tuning block written for a superseded model. Fix the mechanism, not the one reply: the reply-shape contract lives in `~/.claude/output-styles/malin.md` (global, all three repos), and conflicting prose in CLAUDE.md-family files is deleted in the SAME edit, or the two instructions fight and the longer one usually wins.
- **Example:** 2026-07-25 — disabled the explanatory plugin, added the `Malin` output style (answer / bullets / what you need to do / also found; no preamble, no inter-tool narration, five bullets max), added a global `report` skill that writes long output as one self-contained HTML page under `C:/Users/malla/claude-reports/<repo>/` and opens it in her browser. Sources: `anthropics/html-effectiveness` for pages-not-walls-of-text, JJ Englert's reply skeleton, Lydia Hallie's ELI5 register.

### [Data] A legacy→namespaced key migration must merge at the VALUE level, never pick a document
- **Date:** 2026-07-28
- **Trigger:** BIN-569 re-keyed Tillsammans swipe docs from a bare `tmdbId` to `movie_N`/`tv_N`. The read path resolved old-vs-new with a document-level `??` chain (`byKey.get(k)?.votes ?? legacy.get(id)?.votes`). That reads fine and passed its own test — but each swipe doc holds a MAP of many participants' votes. The first post-deploy vote creates the namespaced doc with one voter in it, and from that instant the legacy doc holding everyone else's votes is never read again: yes-counts collapse, already-voted participants get re-served cards, and a spent veto vanishes while `vetoRemaining` stays 0 (rules only let it count down, so it can never be re-cast). This is the FOURTH bare-id keying migration in this repo (BIN-523/529/545/586) and the first one where the document held multi-writer state.
- **Rule:** When a doc-id migration adds a fallback for legacy documents, ask what the document CONTAINS before choosing the fallback shape. Scalar/single-owner payload → document-level `??` is fine. A map or list that MULTIPLE writers append to → you must merge per key (`{ ...legacy?.votes, ...namespaced?.votes }`), because the new document starts empty and doc-level precedence silently discards every other writer's contribution. Check the write path too: whoever creates the namespaced doc should fold the legacy one forward, not shadow it.
- **Example:** BAD — `byKey.get(k)?.votes ?? legacy.get(id)?.votes` — and a test that seeds the SAME participant in both docs, which cannot tell doc-level from key-level fallback apart. GOOD — spread-merge both maps, namespaced last, and seed DIFFERENT participants in the two docs so the test actually discriminates.

### [Workflow] A ticket body written in the past tense is not evidence the code shipped
- **Date:** 2026-07-28
- **Trigger:** BIN-569's body carried a dated "Step-0 re-scope … now implemented" section listing the exact six files as "actual scope as built". None of it existed at HEAD: `recordSwipe` still wrote `String(tmdbId)`, `matching.ts` had no `candidateKey`/`indexSwipes`, `SessionSwipe` had no `mediaType`. A prior sprint had evidently written the spec up as done and never landed the code. Selection nearly classified it obsolete on the ticket's own testimony.
- **Rule:** The grep-of-main premise check cuts BOTH ways. It exists to catch tickets already fixed under a different id — but it equally catches tickets whose body CLAIMS completion that never landed. Never classify a ticket obsolete, nor skip implementing it, on prose alone: grep the current tree for the ticket's target symbols. Current code on main is the source of truth; the ticket body is a snapshot of somebody's intent. When the body turns out to be a spec rather than a record, implement it as written and say so in the deviation log rather than rewriting the body.
- **Example:** BAD — body says "now implemented", `git log` shows no matching commit → close as obsolete. GOOD — grep for `candidateKey`/`indexSwipes`/`mediaTypeDocId` in the tree, find nothing, treat the body as a reviewed SPEC and build it.
