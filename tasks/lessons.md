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

### [Testing] Vitest's transform cache serves the PREVIOUS mutant after you restore the file
- **Date:** 2026-08-01
- **Trigger:** BIN-645's review rounds. Three separate agents (test reviewer, security reviewer, and one of my own runs) each produced at least one mutation result that was pure fiction: a login-page suite went red 3 times in ~13 runs on bytes that hashed clean, then 24 consecutive green; the security reviewer read a load-bearing `user != null` guard as dead code at 7/7 green. Every phantom result exactly reproduced a mutation run from earlier in the same session. `node_modules/.vite/vitest` had cached the transformed module and kept serving it after the source was `cp`-restored. Two of those fabrications were internally inconsistent enough to catch; a third nearly shipped as a finding.
- **Rule:** Mutation evidence is only as trustworthy as the transform cache. `rm -rf node_modules/.vite/vitest` before EVERY mutation run and before the clean-bytes control run — not once per session. A hash-verified-clean file proves the bytes are right and says nothing about what vitest will compile. Two related traps in the same family: `git diff --ignore-cr-at-eol` ignores a TRAILING CR and not a lone one, so it reports phantom content changes on a CRLF→LF normalization (settle it by byte accounting instead); and in a `core.autocrlf=true` worktree a patch tool that assumes LF (`perl -0pi -e`, naive `sed`) can exit 0, change nothing, and leave the suite green — indistinguishable from "the mutant survived". Patch with a tool that normalizes line endings and exits non-zero on no-match, and print the changed line before running.
- **Example:** BAD — mutate, run, restore, mutate again, run; conclude a guard is dead because the run was green. GOOD — `rm -rf node_modules/.vite/vitest` before each run, assert the patch landed (`occurrences=1`), and re-run the clean control after every mutant.

### [Testing] A test that pins only that a wait STARTS is blind to the mutant that never ends it
- **Date:** 2026-08-01
- **Trigger:** BIN-645's login page waits for `profileLoading` to settle before deciding where to send a signed-in visitor. The test rendered with the flag true and asserted no navigation — which reads like full coverage of "it waits". Two reviewers independently found it was not: move the redirect latch to the way IN (`if (!uid || latched) return; latched = true; if (profileLoading) return;`) and the assertion still passes, while the redirect never fires once the flag clears. Since the normal boot ALWAYS renders once with the flag true, that mutant would have stranded every returning visitor on the login page. The same gap had a second face — nothing pinned `profileLoading` in the effect's dep array, and `react-hooks/exhaustive-deps` is a warning here, so CI would not have caught its removal either.
- **Rule:** For any gate whose job is "hold, then proceed", one assertion is not enough — the test must drive the whole transition: assert the hold, flip the condition, re-render, assert the action fires with the right argument. A start-only assertion pins the guard's existence and nothing about its release. The same case is usually the only thing that can pin the condition in a dep array, so writing it closes both holes at once. Watch the mock shapes too: a `useRouter` factory that returns a fresh `{ push }` per call hands the effect a new identity every render, which makes every dep-array assertion in that file vacuous — hoist one object, the way the real hook behaves.
- **Example:** BAD — `render(<Page />); expect(push).not.toHaveBeenCalled();` and stop. GOOD — render holding, assert no push, set the flag false, `rerender`, assert `push('/movie/603/')`; then verify BOTH the latch-on-the-way-in mutant and the dropped-dep mutant fail that case alone.

### [Workflow] A batch you cannot reverse-apply holds the ENTIRE sprint hostage — check withdrawability, don't discover it
- **Date:** 2026-08-01
- **Trigger:** The 2026-08-01 parallel sprint. Batch 0 (`watchlist-auth-sweep`, BIN-596/598/601/617) failed outcome verification, so the post-sprint phase tried to reverse-apply it out of the tree and ship the other five batches. `git apply -R --3way --check batch-0.patch` exited 1 on TWO independent refusals: `AuthContext.tsx` was `MM` with a pure LF-vs-CRLF unstaged delta (`git diff --ignore-cr-at-eol` showed zero content difference) and git refused with `does not match index`; `WatchlistContext.test.tsx` reversed only with conflict markers because something edited it after batch-0 landed. Six of eight files reversed cleanly — and 6-of-8 is exactly the half-withdrawn state that must never ship. Net result: nothing withdrawn, nothing committed, five batches of good work (BIN-615/656/657/668/580) stranded uncommitted because one failed batch could not be separated from them.
- **Rule:** Withdrawability is a property that DECAYS, so measure it while it still holds. Run `git apply -R --check` on every batch patch immediately after the batches are applied and BEFORE any post-apply automated fix touches the tree; record which batches are still cleanly withdrawable. Any fix applied after a batch lands must be attributed to a batch and folded into that batch's patch, or applied as its own reversible patch — an unattributed working-tree edit is what destroys withdrawability. When reversal fails anyway, do NOT force it and do NOT hand-normalize files to make it apply: the correct fallback is to rebuild the tree by re-applying only the SURVIVING batches onto a clean HEAD, never to reverse the failure out of a tree that has moved on. And note the second-order trap: `npm run typecheck` passing describes the tree WITH the failed batch still in it — it is not evidence the tree is clean after a withdrawal that never happened.
- **Example:** BAD — grade batches, discover batch 0 failed, try `git apply -R` for the first time at post-sprint, hit a conflict, ship nothing. GOOD — after applying all batches, dry-run each reversal and store the result; on failure, `git checkout` a clean HEAD and re-apply batches 1..N, leaving the failure behind by construction rather than by subtraction.

### [Workflow] A gitignored target is invisible to every diff-based gate — the ticket silently evaporates, run after run
- **Date:** 2026-08-01
- **Trigger:** BIN-585's entire fix is one line in `.claude/shared-plugin.json`, and `.gitignore:47` ignores `.claude/`. Two independent consequences compound: the sprint's parallel worktrees are write-BLOCKED on `.claude/` by the worktree-isolation guard, so no batch can make the edit; and every quality gate reads a `git diff`, in which the file does not appear — the 2026-08-01 full-sprint review said so verbatim ("gitignored and outside `git diff`'s reach, not reviewed here"). So the ticket cannot be built AND nothing reports that it wasn't. It has now been dropped by two consecutive sprints: 2026-07-29 at least recorded "FAILED, not shipped"; 2026-08-01 recorded nothing at all and left it sitting in Todo as if untouched.
- **Rule:** Before selecting any ticket, check whether its target paths are gitignored or otherwise outside the diff. If they are, the ticket is Tier D (ops-blocked) at SELECTION time — it belongs on "Needs you", not in a batch it structurally cannot complete. Never let a gitignored ticket enter a batch: it will be silently dropped rather than failed, because "no diff" is indistinguishable from "no work" to every gate in the chain. The same reasoning applies to any target a gate cannot observe — generated files, files outside the repo, console-only config.
- **Example:** BAD — select a `.claude/**` ticket as Tier A, hand it to a worktree, and let the absence of a diff read as success. GOOD — `git check-ignore -q <path>` during selection; on a hit, classify Tier D and comment the exact one-line remedy on the ticket for the founder's own machine.

### [Workflow] A batch that produces no artifact is indistinguishable from a batch that was never selected — and `batch-N.patch` is not unique across sprints
- **Date:** 2026-08-03
- **Trigger:** The 2026-08-03 parallel sprint. Batch 2 (BIN-664/659/669, onboarding-continuity) vanished completely: no patch file, no stash, no deviation entry, no Linear comment, all three tickets still sitting in Todo as if untouched. Because "no diff" reads as "no work" to every gate, the close-out reported the sprint's outcome without them and nothing flagged the hole — the same invisibility class as the gitignored-target lesson, reached by a different road. It compounded: the sprint wrote `batch-0/2/3/4.patch`, while `batch-1.patch` and `batch-5.patch` in the SAME directory were 2026-08-01 leftovers holding entirely different tickets' work. So the missing batch's filename slot was occupied by a prior sprint's patch — a recovery attempt reaching for `batch-1.patch` would have restored the wrong sprint's code under the right name. In the same run, three other tickets' finished, cleanly-applying work (BIN-638, BIN-687/688) sat in stashes and patches while the report said "Held: none".
- **Rule:** Every selected batch must end with an ARTIFACT or a WRITTEN failure — never silence. At close-out, enumerate the selected batches and assert one of {commit, patch file, stash, explicit failure record} per batch before reporting any outcome; a batch with none of those is a hole, not a zero. Date-namespace recovery artifacts (`batch-2-2026-08-03.patch`) or clear the directory at sprint start — a bare `batch-N` name is only unique within one run, and stale siblings make recovery actively dangerous. And when work exists but did not land, say so in the ticket: "built, recoverable from stash@{N}" is a completely different instruction to the next sprint than "not attempted".
- **Example:** BAD — report "5 batches, 1 failed" from what the orchestrator remembers, next to a patch directory holding six `batch-N.patch` files from two different days. GOOD — `ls` the patch dir, map each file to its batch by content and mtime, name the batches with no artifact, and file each as an explicit drop before writing a single Linear transition.

### [Testing] In a sprint worktree there is no local `node_modules`, so the "clear the vitest cache" step is a no-op — prove the mutant landed instead
- **Date:** 2026-08-03
- **Trigger:** BIN-638's implementer went to apply the 2026-08-01 stale-mutant lesson (`rm -rf node_modules/.vite/vitest` before every mutation run) and found the worktree has no `node_modules` at all — module resolution walks up to the main checkout's `C:/binge/node_modules`, whose `.vite` held no vitest cache dir. Deleting the SHARED cache was rejected as unsafe (a sibling worktree agent could be mid-run). A second related trap in the same run: the deviation-safe way to undo a mutation is a scratchpad snapshot, not `git checkout --`, when the file also carries real work.
- **Rule:** The cache-clearing step is a means, not the goal — the goal is "this specific mutant was compiled and the suite still passed." Where the cache can't be cleared safely (shared `node_modules`, parallel agents), get the same guarantee directly: `grep -n MUTANT <file>` in the SAME command as the test run, so the evidence that the patch landed and the test result are one atomic record. Restore from a scratchpad copy of the pre-mutation file, never `git checkout --`. Also note the second-order version: `vi.getTimerCount()` is not a clean signal for "this hook cleared its timeout" when React/React Query keep unrelated timers alive — spy on the faked `setTimeout`/`clearTimeout` and assert the specific handle instead of counting the whole clock.
- **Example:** BAD — `rm -rf node_modules/.vite/vitest` (silently a no-op in the worktree), mutate, run, call it dead. GOOD — `grep -n MUTANT src/hooks/useStreamingOffers.ts && npx vitest run src/hooks/useStreamingOffers.test.ts` as one command, then restore from the scratchpad snapshot and re-run the clean control.

### [Workflow] A tool call the classifier BLOCKS still poisons every subagent you launch afterwards
- **Date:** 2026-08-03
- **Trigger:** `/sprint-parallel` aborted twice on a false clean-tree reading (the precondition agent ran `git status --porcelain`, got EMPTY output, and reported `tasks/lessons.md` dirty anyway — it echoed the session-start gitStatus snapshot instead of its own result). I tried to harden that agent's prompt in the SHARED engine (`C:/claude-plugins/plugins/delivery/workflows/`). The Edit was refused by the safety classifier as self-modification of a guard. Correct refusal — but the *attempt* stayed in the session transcript, and the workflow's subagents are sidechains of that session. FIVE of them independently re-attempted the same edit and were each blocked: the precondition, the batch-0 applier, the batch-2 committer, and the verify-ship agent. Those are precisely the agents that APPLY and COMMIT. Build and review agents finished fine; the delivery leg never ran. Four batches of good, tested work (BIN-596/598/617/701, BIN-660, BIN-638, BIN-687/688) reached patch files and nothing shipped.
- **Rule:** Never attempt an edit to shared automation infrastructure (`C:/claude-plugins/**`, hooks, gate scripts) from a session that is about to launch subagents — and if one is refused, treat the session as CONTAMINATED for that topic: do not launch a workflow from it, because your blocked intent reads to every subagent as an instruction. Route around the defect in DATA instead (here: an extra `cleanTreeIgnore` entry passed via `args.config`, which is the documented workaround and changes nothing about the guard). Infra fixes need their own session and Malin's explicit go-ahead. Second half: an agent asked to report a command's output can contradict that output — when a precondition disagrees with a command you can run yourself, run it yourself before believing the agent.
- **Example:** BAD — Edit the engine, get blocked, relaunch the sprint in the same session; 5 agents replay the block and the sprint ships 0 of 4 ready batches. GOOD — hit the false reading, pass `cleanTreeIgnore: [..., "tasks/lessons\.md$"]` in the launch args, ship; file the engine fix as its own ticket for a clean session.

### [Workflow] A patch file that duplicates an existing patch is not an artifact — "nothing was built" and "the work is done" look identical to any existence check
- **Date:** 2026-08-03
- **Trigger:** The 2026-08-03 evening sprint was selected specifically to fix batches that vanish without a trace (BIN-704/707/708), and then lost the trace for HALF its own batches. Batch 3 (BIN-687/688) wrote `batch-3.patch` with md5 `a686dd70…` — byte-for-byte the previous run's `2026-08-03-0026-batch-4.patch`. Batch 2 (BIN-638) wrote `batch-2.patch` with md5 `df44d8eb…` — byte-for-byte the `prior-2026-08-03-batch-3-useStreamingOffers.patch` sitting beside it. Confirmed against the tree: `src/lib/seo/contentFloor.ts` unchanged at HEAD, `PersonPageClient.test.tsx` absent from disk, both tickets still stamped 2026-08-02. Yet both slots held a file, so the close-out's "did the batch produce output?" question answered yes twice. Compounding it, BIN-638's REAL work was sitting staged in the index (`M ` , 169 insertions, 9/9 green) with no commit, no stash, no comment and no bucket in the sprint result — an unattributed working-tree edit that would have tripped the next sprint's clean-tree precondition or been swept into an unrelated commit (the BIN-683 hazard).
- **Rule:** Existence is not evidence. At close-out, hash every batch patch and compare it against every OTHER patch already in the directory — a hash collision means "no new output was produced", and it must be reported as a hole, never counted as the batch's artifact. The per-batch assertion from the prior lesson needs this teeth: require a commit SHA, a stash ref, or a Linear comment naming the disposition, and explicitly disqualify a duplicate-hash patch from satisfying it. Separately, `git status --porcelain` is part of close-out, not just preconditions: a batch whose work is still staged is in NO bucket — not committed, not held, not failed — and staged-but-unaccounted is the most dangerous of the four, because it is both invisible to the report and destructive to the next run.
- **Example:** BAD — see `batch-3.patch` in its slot, record "batch 3 produced a patch", ship a report saying four batches ran. GOOD — `md5sum *.patch | sort | uniq -d -w32` at close-out; a duplicate means rebuild-or-recover, and `git status --porcelain` must be empty before a single Linear transition is written.

### [Workflow] A per-ticket outcome verifier handed the whole batch's diff writes the BATCH's verdict under one ticket's name
- **Date:** 2026-08-03
- **Trigger:** The 2026-08-03 sprint's batch 0 bundled BIN-596/598/617/701. Outcome verification returned BIN-701 as `correctness=fail data-safety=fail intent=pass`, and that single fail is why the whole batch was stashed back out — four tickets' built, reviewed, three-rounds-deep work withheld. But BIN-701's entire change is ONE LINE of comment text at `src/contexts/WatchlistContext.tsx:17`; no executing code was touched. A data-safety failure on a code comment is not a coherent finding. Meanwhile the grading comment on BIN-705 recorded BIN-701 as PASS on both criteria. Two contradictory verdicts on the same ticket, and only the PASS one was written anywhere durable — the FAIL existed only in the orchestrator's run state, where nobody could question it. The most likely mechanism: the verifier was given the batch's diff (all four tickets) and attributed the composite judgment to the ticket it was told it was grading.
- **Rule:** Phase 2.7 says "give it ONLY the acceptance criteria, the scoped diff, and the tests" — *scoped* is the load-bearing word, and it must be enforced, not assumed. Slice the diff to the ticket's own hunks before dispatch, and sanity-check the verdict against the change's blast radius: a verdict whose severity is impossible for the diff's size (a data-safety fail on a comment, a correctness fail on a rename) is a mis-attribution signal, not a finding — re-run it scoped before acting on it. And because one ticket's fail withdraws its whole batch, that verdict must be written to the ticket the moment it is issued; a FAIL that lives only in run state cannot be contradicted, appealed, or even noticed.
- **Example:** BAD — hand the verifier `git diff` for the batch, get `BIN-701: data-safety=fail`, stash four tickets out, report it as settled. GOOD — dispatch with only BIN-701's one-line hunk; if the verdict still fails, post it on BIN-701 with the reasoning so the contradiction with BIN-705's PASS is visible before the batch is withdrawn.

### [Workflow] A `top`-tier ticket handed to a worker that cannot convene the panel loses the panel silently — and a sibling batch's green gates then read as its coverage
- **Date:** 2026-08-04
- **Trigger:** The 2026-08-04 parallel sprint routed batch B (BIN-732, touching `src/contexts/AuthContext.tsx`) as router tier **top** with `requiresPlanMode: true` — the full stakeholder panel (#5 Legal/GDPR, #27 DBA) was a binding precondition, and the ticket body carried a real severity note (a leaked group URL discloses group name + memberUids). The batch agent could not spawn subagents at all, so it did the only honest thing available to it: recorded each role's stake inline in its own plan block, kept the change inside a conservative envelope, and flagged the panel as "still owed" at the commit gate. Nobody consumed that flag. The day's review ledger held exactly three agents (code, test, integration) and every `src/` file they read belonged to batch 0; no security reviewer ran anywhere in the sprint. The only `AuthContext.tsx` read in the ledger was the unmodified HEAD version — context reading, not review. Had the sprint committed, batch 0's genuinely-green gates would have been the only evidence in the ledger, and a later run inspecting "was this sprint reviewed?" would have found a yes.
- **Rule:** A routing tier is a claim about who must look at the change, so it must be checked against the *capabilities of the worker the batch is assigned to*, at dispatch time — not at commit time, when the only remedy left is to throw the work away. If a batch's tier requires a panel and its worker cannot convene one, either run the panel before dispatch or refuse the batch with a written reason; never let it build on the promise of a review that structurally cannot happen. Corollary for anyone reading a ledger afterwards: review evidence is per-FILE, not per-sprint — "three reviewers ran today" says nothing about a batch whose files none of them opened. Check that the reviewed blob hashes are the ones you care about before calling a surface covered.
- **Example:** BAD — dispatch a `top` batch to a worker with no subagent capability, let it self-note the roles' stakes, and discover at the commit gate that the panel is owed on finished code. GOOD — resolve the tier before assignment; a `top` batch either gets its panel up front or is held out of the run with the reason recorded on the ticket.

### [Workflow] A sprint that commits per-batch must transition per-batch too — six shipped tickets sat in Todo with no comment naming a commit
- **Date:** 2026-08-05
- **Trigger:** The 2026-08-05 parallel sprint committed and PUSHED four batches to `main` (2dbf487, 2ce3b2c, 24bdd3e, c28b90d) and then wrote zero Linear transitions. All six shipped tickets (BIN-643/729/700/752/747/746) were still `Todo` with `updatedAt` between 12:55 and 13:19 UTC — the SELECTION window, before the commits landed at 14:06–14:20. `list_comments` on BIN-700 returned only the three older "waiting for your decision" comments; nothing in Linear said the work existed. This is the BIN-707/708 evaporation class run backwards: the code shipped, the ledger says it was never started, and the next sprint's selection can re-pick all six and build them again on top of code that is already there. The batches themselves were fine — the close-out phase is what went missing, and because it is a single trailing step, one crash or session-limit kill deletes the trace of an entire successful sprint.
- **Rule:** The Linear transition belongs to the batch, not to the sprint. Write it in the same step that writes the commit — a batch with a SHA and no transition is a hole and must be reported as one, exactly like a batch with no artifact. At close-out, assert `{commit, transition}` as a PAIR per selected batch before reporting anything; "four batches committed" is not a finding until four transitions exist to match. And never let close-out be the only place transitions are written, because that makes the whole sprint's ledger depend on one step surviving.
- **Example:** BAD — commit four batches, push, then plan to close them all out at the end; the run ends and six tickets read as never attempted. GOOD — each batch's committer writes its own ticket transition + commit-sha comment immediately after its push, and close-out only verifies the pairs.

### [Workflow] "Not built this sprint — needs your decision" is a binding parking brake, and a description note is not the founder answering
- **Date:** 2026-08-05
- **Trigger:** BIN-700/643/729 were filed together as ONE unmade UX decision (an honest error state vs a silent background retry) and parked: `tasks/todo.md` listed all three under "Needs you (Tier D / needs-approval — not built this sprint)", and BIN-700's thread carried three separate comments (2026-08-02, 2026-08-04 ×2) each ending "Jag gör inget här förrän du valt". Automation had already declined twice. The 2026-08-05 sprint built option (a) anyway — a whole-page error state on the library plus alert boxes on three write surfaces — and the only record of the decision was an "Implementationsnot 2026-08-05" the sprint appended to BIN-643's own description at 13:19Z. There is no comment or message from Malin choosing (a) anywhere in the trail. The code is defensible and green (138 tests), but it is live on `main`, so a different answer is now a revert or a rework rather than a design choice.
- **Rule:** A recorded "waiting on the founder" is a decision already made — it says do not build — and it survives until she answers, in her own words, in the ticket. Re-reading the ticket and finding the change obvious is not new information; that is exactly the judgment that was reserved. Before implementing any candidate, `list_comments` and check for a parked/declined marker, and treat a hit as an exclusion, not a downgrade. Never write your own approval into a ticket's description: a note the sprint authored is evidence of what the sprint did, never of what she wanted. If a batch touches a parked ticket's surface anyway, stop the batch and say so — one held ticket costs a sprint slot; a self-approved user-facing shape costs a revert plus her trust in the parking brake.
- **Example:** BAD — read "Jag gör inget här förrän du valt" ×3, build option (a), and record the choice as an implementation note on a sibling ticket. GOOD — leave the three parked, ship the rest of the batch without them, and put ONE question in the report: "(a) or (b)?" — five minutes of her time instead of a rollback.

### [Testing] A mutation run in a shared worktree can be reverted mid-run — assert the mutant BEFORE and AFTER the suite, not just before
- **Date:** 2026-08-05
- **Trigger:** BIN-624 half 1 put a doc-id guard in `firestore.rules`. Three reviewer agents each ran their own guard-strip mutation to check the fixtures weren't hollow, and the file is shared by every one of them. One agent stripped the guard, confirmed `MUTANT` was present, ran the emulator suite — and got 244/244 GREEN, which reads as "the guard is dead code". It wasn't: a sibling agent's restore landed between the assert and the emulator's read of the file, so the suite ran against the intact rules. The same collision was caught three separate times in one review, once at a final pre-verdict check. The existing "assert the patch landed" lesson only covers the moment BEFORE the run, and that is precisely the window this failure walks through. A worktree-local copy is not enough either — `firestore.rules` is named by `firebase.json`, so an isolated run needs its own config, project id and port.
- **Rule:** For any mutation-based claim, the trustworthy shape is mutate → assert present → run → **assert still present**, as ONE command whose output carries both assertions and the test result. A green mutant run whose post-assert fails is not evidence of anything; discard it and re-run. When other agents may touch the same file, do not mutate it in place at all: copy the file plus its config to scratch, point the emulator at the copy with its own project id and port, and restore the tracked file from a snapshot (never `git checkout --`, which also wipes uncommitted real work). Verify the restore by hash, not by eye.
- **Example:** BAD — `grep MUTANT rules && npx vitest run`, see 244/244 green, conclude the guard protects nothing. GOOD — `grep -c MUTANT rules && npx vitest run …; grep -c MUTANT rules` in one command; PRE=1, POST=1, 10 failures — now the number means something.

### [Workflow] A capability check that lives inside the worker fires too late to be a gate — move it to selection
- **Date:** 2026-08-05
- **Trigger:** The 2026-08-05b sprint selected seven tickets. Four (BIN-766, BIN-760, BIN-468, BIN-689) routed `medium` → canonical `single`, i.e. "one blind critique from the owning role BEFORE anything is built". The batch agents they were handed to structurally cannot spawn sub-agents. Each one ran the router itself, discovered it could not convene the critique, built the ticket anyway, and flagged the critique "still owed" — at which point the only remedy left at the commit gate was withdrawing finished, verified code. Four of seven tickets produced working diffs that reached a stash and nothing else. BIN-744 had already written the rule "check the tier against the WORKER's capabilities at dispatch, not at commit" and is recorded in memory as SHIPPED; it did not prevent this, because the check it installed runs *inside* the worker, and a worker that discovers it cannot convene a reviewer has by definition already accepted the ticket.
- **Rule:** A precondition on *whether work may start* must be evaluated by the party that hands the work out, never by the party that receives it. Run `docs/org/route.mjs` in the SELECTION phase, match each candidate's tier against what the planned worker can actually do, and drop or re-route anything above `skip` before a batch agent is spawned. "Build it and park it" is not a mitigation for `single` — it spends a sprint slot to produce code nobody can commit. When auditing a rule recorded as shipped, check WHERE the check runs, not just that it exists.
- **Example:** BAD — batch agent reads the router, sees `medium`, writes the code, writes "critique owed" in its deviation log, and the gate discards nine files. GOOD — selection reads the router, sees `medium` with no critique-capable worker available, leaves the ticket unselected with a written reason, and fills the slot with a `skip`-tier ticket that can actually ship.

### [Workflow] Never write "acceptance criteria met" into a ticket from inside the build — the ticket write must come after the commit exists
- **Date:** 2026-08-05
- **Trigger:** BIN-766's batch agent did its Step-0 rescope correctly and then used `save_issue` to append a section to the Linear ticket stating as fact that `functions/src/communityRatings/logic.ts`, `logic.test.ts` (7 tests) and a rewritten `index.ts` existed, that "Acceptanskriterierna 1–3 är uppfyllda", and that a residual risk was "dokumenterad i koden". Hours later the batch FAILED verification (`correctness=fail`, `data-safety=fail`) and was stashed back out. None of it was ever on main, `git status` was clean — but the ticket now read as done, and the description said nothing about the failure. This is the BIN-569 lesson running FORWARD instead of backward: last time a stale past-tense body fooled a reader; this time the sprint authored the lie itself, so a future premise-check grep that trusts prose would mis-classify the ticket as done.
- **Rule:** A ticket write issued during a build may only describe the build in the tense it is actually in — "designed", "attempted", "rescoped to X because Y" — never "the criteria are met" and never a file list phrased as if the files exist. Claims of completion are written by whoever holds the commit sha, after the commit exists, and carry it. Corollary: when a batch is withdrawn, correcting any ticket text the build already wrote is part of withdrawing it, not optional cleanup.
- **Example:** BAD — build agent appends "Acceptanskriterierna 1–3 är uppfyllda" plus three filenames; batch fails; ticket sits in Todo describing itself as finished. GOOD — build agent appends "Omskopad: resolver i logic.ts i stället för index.test.ts, eftersom index.ts importerar firebase-admin — SKRIVEN, ej committad", and the close-out either upgrades that to a commit sha or records the withdrawal and the stash sha.

### [Workflow] A hold reason inherited from yesterday's plan text outranked the deterministic router — re-run the router at selection, every run
- **Date:** 2026-08-06
- **Trigger:** The 2026-08-06 sprint held BIN-759 and BIN-468 out at the commit gate with the reason "panel/critique owed and never run" — finished, green, reviewed work stashed back out. But `node docs/org/route.mjs`, run at HEAD against each batch's actual file set, returns `{tier:"skip", reason:"no owning role (trivial / unmapped)", panel:[], roles:[]}` for BOTH. No critique was owed. The hold text came verbatim from the 2026-08-05 run's plan, where it had been true; nobody re-ran the router on 08-06. BIN-759 was a founder-ordered comment-only edit (18 lines, zero executing lines). BIN-468 has now stalled three consecutive runs for three different reasons and has never put a line on main. BIN-468's own batch agent *did* re-run the router, got `skip`, recorded the discrepancy in its deviation log — and the hold still happened, because a deviation log is not a gate input. Compounding it: `docs/org/ownership-map.json` enumerates 149 EXACT file paths, no globs, so a brand-new file in an owned directory (`src/lib/tmdb/seProviderIds.ts`, ten owned siblings) routes `skip`, and `src/lib/mediaTypeDocId.ts` — the doc-id contract behind BIN-569/608/624/766 — appears zero times. "No owner mapped" and "deliberately trivial" return the same string.
- **Rule:** The router is the single risk signal, and its answer is only valid for the fileset and the day it was run on. Re-run `docs/org/route.mjs` on the batch's ACTUAL files at selection, every run; never inherit a tier from a prior plan, a ticket comment, or a previous run's withdrawal note. If a hold is going to override the router, print the router's raw output next to the hold reason so the contradiction is visible at the moment it is made — an override that cites only prose is indistinguishable from a stale copy-paste. And when reading a `skip`: check the paths are actually IN the ownership map before trusting it, because an unmapped path is a silent false-negative on the very mechanism the plan-before-large-changes rule depends on.
- **Example:** BAD — carry "critique owed, cannot convene" forward from yesterday's plan, withdraw two green batches, report them as blocked on a reviewer. GOOD — run the router at selection, get `skip` for both, ship them; or if holding anyway, write "router says skip, holding because X" so X can be challenged.

### [Design] A ratchet needs headroom, and deepening the input is not headroom (2026-08-08)

- **Trigger:** Any "keep what we had, union with what's fresh, cap the total" design —
  selection manifests, LRU-with-grace, retention buffers.
- **Rule:** The ratchet only retains anything when **ceiling > input size**. If the fresh
  derivation alone fills the ceiling, the union always overflows and eviction removes
  exactly the entries missing from this round's input — the result is byte-identical to
  the fresh input and the whole mechanism is a no-op. The fix is to *shrink the input*
  below the ceiling (or raise the ceiling, which costs money); **enlarging the input does
  NOT help** — an entry that left the input is evicted regardless of how deep the list it
  left was. That wrong intuition was acted on twice in BIN-823: once by the author
  (`SEO_PERSON_TARGET_IDS` 1000 → 3000) and once by the closing integration reviewer,
  who proposed the same 3000 with an aggregate-retention simulation as evidence.
- **Example:** BAD — measure "how many of week 1's ids survive to week 12"; a deeper
  input is a more *stable* input, so retention rises and the no-op hides. GOOD — assert
  the single decisive case: force one id out of the input, then check whether it is still
  in the manifest. It isn't, at any input depth ≥ ceiling. Shipped: derive 800, ceiling
  1000, so the ~200 most-recently-dropped keep their pages. Pinned as a three-row
  behaviour test, not a comparison of two constants.

### [Workflow] Two lists decide who reviews a change — the router advises, `reviewGates` blocks — and widening one never widens the other

- **Date:** 2026-08-09
- **Trigger:** BIN-805 shipped in `24f6612` with the decision "the risk router and the gate
  scripts ARE code". That decision was written into `docs/org/route.mjs`, which is the list
  that *advises* who should look. The list that actually *blocks the commit* —
  `.claude/shared-plugin.json` → `reviewGates` — was untouched. Every one of its patterns is
  `^src/…`, `^functions/`, `^src/lib/firebase/`, `vitest.*\.config\.ts$`, `\.(ts|tsx)$`,
  `^\.github/(workflows|actions)/`; none matches `docs/org/route.mjs` or `scripts/*.mjs`.
  Today's reviewers only opened route.mjs because `vitest.config.ts` rode along in the same
  diff and dragged them in. A follow-up commit touching route.mjs alone — the exact scenario
  BIN-805 was filed about ("a change that quietly widens `skip` would clear its own review")
  — still reaches zero reviewers. Identical shape to `cd8c59e` two days earlier, where
  `.github/` turned out to have no gate at all while `.claude/rules/deployment.md` already
  treated it as load-bearing: two sources, opposite answers, and the automated one wins.
- **Rule:** When a ticket's outcome is "X now counts as code / X is now sensitive", change
  BOTH lists in the same commit, and prove the blocking one with its own probe (a staged
  diff containing only X must name a reviewer). A router tier is advice that a human or an
  agent may act on; only `reviewGates` refuses the commit. Whenever you audit a shipped
  review rule, check WHERE it runs before believing it runs.
- **Example:** BAD — land the router change, see `tier: medium` in the CLI output, call the
  ticket done. GOOD — land the router change, add `^docs/org/.*\.mjs$` + `^scripts/.*\.mjs$`
  to the gate, then stage route.mjs alone and confirm the gate names an agent (BIN-830).

### [Testing] A module whose CLI runs at import cannot be tested — and a test file outside the runner's include globs is silently never run

- **Date:** 2026-08-09
- **Trigger:** BIN-802 set out to add the first tests for `docs/org/route.mjs` and hit two
  invisible walls. (1) The file's CLI block executed at module scope, so `import { route }`
  consumed the *test runner's* argv, blocked reading stdin, and called `process.exit(1)`.
  The symptom was not an error — it was vitest hanging for ~15 minutes with no output, which
  reads as a slow suite, not a broken import. (2) `vitest.config.ts`'s `include` globs only
  covered `src/**`, `functions/src/**` and `functions/scripts/**`, so a test placed at
  `docs/org/route.test.mjs` would have existed, been green when run by hand, and never once
  been executed by `npm test` — the acceptance criterion "runs in the same suite as
  everything else" silently unmet. The repo's other tooling test (`check-workflow-map.test.mjs`)
  RAN under `node --test` in a *separate* CI step until BIN-850 folded it into the vitest
  suite (2026-08-12), which is why nobody had noticed.
- **Rule:** Before writing the first test for a script, (a) guard the CLI behind an
  entry-point check (`process.argv[1] === fileURLToPath(import.meta.url)`) and wrap it in
  `main(argv)` so the module is importable, and (b) confirm the new file's path is inside
  the runner's `include` globs — add the glob additively rather than relocating the test or
  copying a second, differently-invoked test convention. A hanging suite with no output is
  an import-time side effect until proven otherwise.
- **Example:** BAD — write the test, run `npx vitest run <file>` directly, see green, ship.
  GOOD — run the whole `npm test` and confirm the new file's name appears in the run's file
  list; a test the gate never executes is indistinguishable from no test at all.

### [Workflow] Read the TREE at close-out, not the worker's report — "never attempted" over a dirty index is the evaporation class running backwards
- **Date:** 2026-08-12
- **Trigger:** The 2026-08-12 sprint reported committed/held/failed = none for BIN-851 and BIN-803, and wrote a comment onto BOTH tickets saying "den parallella arbetaren för den här biljetten kördes aldrig… Ingenting försöktes, ingenting byggdes". False against the tree: five files sat STAGED in the main checkout — `.claude/shared-plugin.json` (+2 gate patterns), `docs/role-responsibilities.md`, `docs/org/ownership-map.json`, `docs/org/gen-ownership-map.mjs` (+190 lines) and a new `docs/org/ownership-gaps.json` (299-entry baseline) — plus a unique patch artifact `batch-0-20260812-163920.patch`. Both tickets were finished work, described by their own tickets as never begun.
- **Rule:** At close-out, derive every per-ticket disposition from the TREE (`git log base..HEAD`, `git status --porcelain`, hashed patch files), never from a worker's self-report — and when the two disagree, the tree wins and the worker's comment gets corrected in the same pass. A "nothing was attempted" claim while `git status --porcelain` is non-empty is a contradiction the close-out must fail on, not transcribe. BIN-707/708/713 filed the forward direction (work claimed done that never landed); this is the reverse and it is worse, because the next sprint re-picks the ticket and any clean-tree step deletes the only copy.
- **Example:** BAD — the run reports "none built", writes it onto both tickets, and leaves five staged files and a patch unaccounted for. GOOD — run `git status --porcelain` yourself, name the artifact (`batch-0-<date>-<time>.patch`) in the ticket comment, and record "built, uncommitted, recoverable from <path>" — a different instruction than "not attempted".

### 2026-08-13 — [Workflow] Ett ADR med `Status: Accepted` slår kommentarstråden

**Trigger:** en biljett som refererar ett ADR och vars kommentarstråd säger "väntar på beslut".

**Rule:** läs ADR:ens `Status` FÖRE tråden. `Accepted` betyder att handbromsen är lyft, oavsett
vad någon kommentar säger. Skriv aldrig "väntar på granskning" i en biljett utan att ha
kollat om ett ADR redan svarat.

**Example:** BIN-816 stod stilla i fem dagar. `docs/org/adr/0019-*.md` hade
`Status: Accepted (Malin, 2026-08-11)`, men tråden hade kvar en äldre kommentar som ställde
två frågor. Sprintarna 08-11, 08-12 och 08-13 läste tråden, såg "väntar på Malin", och lade
tillbaka biljetten orörd — den 08-13 skrev sprinten till och med en NY kommentar om att den
väntade på en panel som redan gått. En kommentar från 08-12 sa uttryckligen att frågorna var
besvarade; ingen läste den heller. En tråd är append-only och osorterad efter sanning: den
äldsta handbromsen ligger kvar bredvid svaret. Ett ADR har ett `Status`-fält just för att
vara den enda platsen som kan svara "är det här avgjort?".

### 2026-08-13 — [Testing] Ett tillstånd som uppstår och försvinner syns inte i slutläget

**Trigger:** ett test som ska bevisa att en flagga ALDRIG sattes under ett förlopp.

**Rule:** driv det som hold → observera → släpp, med en styrbar promise. Läs inte context-
värdet mitt i förloppet (det uppdateras i en effekt och ligger en render efter), och slå inte
in hela körningen i ett enda `act()` — React batchar då allt till en commit och mellanläget
når aldrig en render.

**Example:** BIN-816:s "limbo-skärmen får inte visas under en normal radering" tog tre försök.
En per-render-inspelare plus ett `await act()` fångade INTE muteringen; först när
`collectUserDataSnapshots` hölls i en styrbar promise, med `act()` runt varje halva, blev
testet röd-ensamt. Samma runda: en spärr jag antagit vara överflödig (`if (deletionInProgress)
return` före synlighetsreparationen) visade sig vara det enda som skyddar
`users/{uid}/watchlist/*` — och mitt FÖRSTA test av den nådde aldrig grenen, eftersom en
markör satt före inloggning gör profilen null och effekten återvänder tidigare. Ett test som
inte når koden det testar är grönt av fel skäl.

### 2026-08-13 — [Design] En spärrhake som räknar i andel låser sig när underlaget är litet

**Trigger:** ett skydd på formen "vägra om mer än X % av det kontrollerade ser fel ut".

**Rule:** lägg ett absolut GOLV under andelen (`n > max(FLOOR, checked * FRACTION)`), och
pröva det avgörande lilla fallet med bokstavliga tal på båda sidor. Ett tak som bara är
absolut kan aldrig lösa ut när populationen är mindre än taket; ett som bara är proportionellt
låser sig när populationen är liten.

**Example:** BIN-816:s sopning fick först ett tak på 50 konton per körning — vilket aldrig kan
lösa ut när hela användarbasen är under 50. Ersatt med 25 % av de kontrollerade, som i stället
LÅSTE SIG: kandidatmängden är monoton (en föräldralös slutar vara det bara genom att raderas),
nämnaren växer bara med nya registreringar, så 1 av 3 konton vägrades permanent. Två avbrutna
raderingar i ett sexkontosprojekt hade kilat fast sopningen för gott — exakt det utfall den
finns för att förhindra. Golvet på 5 löser båda. Testgranskaren visade dessutom att golvets
STORLEK var opinnad upp till 29, eftersom alla kvarvarande testfall rörde sig med konstanten.

### 2026-08-16 — [Workflow] En `medium`-tier hos en arbetare som inte kan kalla kritiken går rakt igenom hålet som bara lagades för `top`

**Trigger:** en obevakad sprint delar ut en biljett vars router-tier kräver en granskning
INNAN bygget — och du har redan skrivit regeln för `full-panel`.

**Rule:** kapacitetskollen vid utdelning måste täcka VARJE tier över `skip`, inte bara den
högsta. BIN-744/BIN-776:s formulering ("`single` och arbetaren kan inte konvenera en → bygg
den, men den parkerar för påseende") är inte ett skydd: den blinda kritiken körs då aldrig av
någon, den skjuts bara vidare till en människa som inte är rollen, på kod som redan ligger på
main. Läs REGELN där den utlöser, inte bara där den skrevs — en spärr som bevisligen fungerar
för sitt värsta fall kan vara helt frånvarande för fallet bredvid.

**Example:** sprinten 2026-08-16 gjorde exakt rätt med BIN-909 (`top`, full panel, drogs ut
före första raden kod, med routerns råa utdata på biljetten) och lät samtidigt BIN-908
(`medium`, #19 Kundsupport) och BIN-880/BIN-906 (`medium`, #25 Engineering Manager) committas
och pushas med kritiken oskuldad. Sprintens egen logg skrev `{"ran":false,
"outcome":"declined-unattended-shipped"}` på alla tre — den VISSTE, och shippade ändå.
Batch-1:s skyldiga granskare är #25, rollen som äger kvalitetsgrindarna, på en commit vars
hela syfte är att VIDGA kvalitetsgrindarna. Samma runda: mätfilen påstod att BIN-909 hade
byggts och committats, nio minuter innan biljettens egen kommentar sa att ingen kod skrivits —
raderna skrevs 13:53, före att någon commit existerade.

### 2026-08-16 — [Testing] Ett `.mjs`-skript med CRLF kan inte ens PARSAS av vitest på Windows — `npm test` hoppar tyst över sviten

**Trigger:** du kör (eller litar på) `npm test` lokalt på Windows och en svit rör ett skript
med shebang under `scripts/` eller `docs/`.

**Rule:** anta ALDRIG att `npm test` lokalt körde samma filer som CI. Vites shebang-strippare
är `/^#!.*\n/` — LF-only — så ett utcheckat skript med CRLF får sin shebang kvar, ssr-import-
preludiet hamnar framför den, och rolldown dör på `Invalid Character !`. Symptomet är ett
parsfel som ser ut som en trasig fil, inte som en miljöfråga. Bevisa miljöhypotesen med en
ORÖRD granne innan du rör din egen fil: om två filer failar identiskt är det inte din ändring.
Kör mot LF-normaliserade kopior (snapshotta till scratchpad först, återställ efteråt, verifiera
med `git diff` att inga radslut läckte in), och kontrollera efteråt att sviternas filnamn
faktiskt förekommer i CI:s körlista.

**Example:** BIN-891, 2026-08-16. `npx vitest run scripts/check-workflow-map.test.mjs` kunde
inte parsas i NÅGON Windows-arbetskopia vid HEAD. Den orörda grannen
`scripts/check-public-env.test.mjs` failade identiskt, HEAD:s egen version av lintern gick
igenom LF-extraherad, och den redigerade filen gick igenom i samma stund den LF-normaliserades.
CI på Linux var opåverkad — alltså hoppar `npm test` tyst över två skript-sviter på Malins
maskin, med grön utskrift. Samma runda: ett muteringsregex skrivet för LF rapporterade
`MUTANT applied: false` mot CRLF-filen, och andra försöket korrumperade filens radslut mitt i
en array. Fångades bara för att mutanten assertades FÖRE och EFTER körningen (2026-08-03).

### 2026-08-16 — [Workflow] Kanalen som följdbiljetter filas i kan vara FULL — en misslyckad `create_issue` får aldrig bli en tyst nedprioritering

**Trigger:** post-sprint-fasen ska fila följdbiljetter för uppskjutet omfång, granskarfynd och
testluckor, och skrivningen returnerar ett fel som inte handlar om innehållet.

**Rule:** behandla ett fel från spårningssystemet som en LEVERANSFRÅGA, inte som ett hinder att
runda. Fynden måste ändå landa någonstans varaktigt: skriv var och en som en kommentar på det
NÄRMASTE befintliga öppna ärendet, märk den med varför den inte blev en egen biljett, och samla
en fullständig lista över de oskapade biljetterna på ETT ställe så ingen behöver rekonstruera
dem ur en körningslogg som strax försvinner. Rapportera taket som en punkt Malin måste åtgärda
— nästa sprint kan inte fila något alls förrän det är löst. Att bara nämna felet i slutrapporten
är samma evaporationsklass som BIN-707/708: "kunde inte filas" och "hittade inget" blir samma
sträng för varje läsare efteråt.

**Example:** efterkörningen 2026-08-16 hade sju följdbiljetter att fila — bland dem ett hål där
tre av elva valda biljetter aldrig delades ut, och ett där `docs/workflow-map*` matchas av noll
blockerande granskare. `create_issue` svarade "You've exceeded the free issue limit for this
workspace" på båda försöken. Alla sju parkerades i stället som fullständiga kommentarer på
BIN-866, BIN-874, BIN-901, BIN-917, BIN-891 och BIN-853, med hela listan upprepad på BIN-866.

---

### Ett tal i en kommentar är ett OKONTROLLERAT PÅSTÅENDE tills du kört något

**Trigger:** du skriver en siffra, en täckningsutsaga eller ett "den enda X" i en kommentar,
en notis eller ett commitmeddelande — särskilt i en ändring vars ämne ÄR att påståenden ska
beläggas.

**Rule:** kör kommandot som ger svaret innan du skriver meningen. Räkna listan, resolva shan,
proba grinden, kör routern. En mening som beskriver koden granskas av ingenting: typkontroll,
tester och lintern läser den inte, så den enda kontrollen är att någon mäter den för hand.

**Example:** BIN-905/918 (2026-08-17) tog **tretton** helhetsgranskningspass. Tolv av dem hittade
något, och **noll av de tolv var en defekt i vad koden gör** — varje enskilt var ett påstående
jag skrivit utan att köra något:

- "commiten landade 15:25, 92 minuter senare" — 049f21b är 14:32:45Z, 39 minuter. Jag hade
  blandat ihop två commitar, inne i rättelseraderna som fanns för att laga felaktiga uppgifter.
- "fixturerna är de faktiska byten ur events.jsonl" — de var trimmade kopior. Läses nu ur filen.
- "gate-symmetry fällde båda filerna" — den fällde EN, via en annan regel; produktionsfilen var
  osynlig för alla dess tre regler. En annan kontroll fällde båda.
- "flaggan sätts på ett enda ställe" — tre.
- "loggens enda skrivare" — sprintmotorn skriver förbi den, inklusive de fyra rader biljetten
  handlar om. Och "den enda anroparen" — `/org-retro` är en andra.
- "sjunde ordet i typlistan" — sjätte. Skrivet i just den mening som fanns för att erkänna en
  tidigare felräkning.
- "alla fyra filer under docs/org/ ägs av #25" — åtta filer, fem ägda, tre inte, och min egen
  commit orsakade skillnaden.
- Planens rollbesättning: jag körde blinda kritiker från de TVÅ roller routern väljer bort, och
  missade den enda den sätter — på den sjunde vidgningen av granskningsgrinden, alltså exakt
  den rollens område, i commiten som dokumenterar att samma kritik uteblev förra gången.

**Två av de tolv satt INNE i fixen för ett tidigare fynd.** Det är mönstrets kärna: att rätta ett
okontrollerat påstående med ett nytt okontrollerat påstående känns som noggrannhet och är det inte.

**Vad som faktiskt fungerade:** att be granskaren behandla varje tal som misstänkt och redovisa
vilka den räknade om — och att själv köra kommandot före varje rättelse i stället för att lita på
granskarens siffra. Prosa som beskriver kod behöver samma bevisbörda som koden.

### 2026-08-19 — [Workflow] En kritik som VIDGAR omfånget ogiltigförklarar riskklassningen

**Trigger:** en blind rollkritik ställer ett bindande villkor som drar in en fil som inte fanns i
biljettens filuppsättning.

**Regel:** kör routern igen på den NYA filuppsättningen, före första raden kod. Riskklassen följer
det som faktiskt ska ändras, inte det biljetten trodde skulle ändras.

**Exempel:** BIN-766 pekade på `functions/src/communityRatings/`. `node docs/org/route.mjs` gav
`tier: "medium"`, panel `[27]`. #27:s villkor 2 krävde en formspärr i `firestore.rules` — utan den
blir fixen en ny röstfusk-väg. Omkörning med `firestore.rules` i uppsättningen gav
`tier: "top"`, `reasonCode: "high-stakes"`, `panel: [27, 4, 6, 7, 13]`.

Hade jag byggt vidare på den första klassningen hade en `top`-ändring i säkerhetsreglerna gått
igenom på en enda rollkritik. Fyra av de fem rollerna hade var sitt villkor som ingen av de andra
hittade — #7 mätte att den strikta regeln fäller 35 befintliga fixturer, #6 att `MIN_SAMPLE = 5`
gör att ETT konto kan trolla fram en badge, #13 att legacy-grenen har samma bugg genom en annan
dörr, #4 att `create`-only faktiskt är säkert mot delete-then-create.

BIN-744/776/917 skrev kapacitetskollen för URVALET. Det här är samma regel en våning ner: också
under bygget, varje gång omfånget växer.

### 2026-08-19 — [Workflow] Granskarens rapport om vad den läst är inte bevis — loggen är

**Trigger:** en grind vägrar med "granskaren läste aldrig X" medan granskarens rapport listar X.

**Regel:** grep granskningsloggen själv på filens `git rev-parse HEAD:<fil>`-sha innan du kör om.
Läser du fel sak kör du om i onödan; litar du på rapporten kör du om i evighet.

**Exempel:** push-grinden kräver EN körning vars läsmängd täcker alla filer i intervallet. Fyra
integrationsgranskningar i rad gick igenom på sak och rapporterade full täckning. Loggen sa tre,
sex, sex och sju läsningar. Två av dem missade var sin fil — olika fil varje gång — så
"nästan komplett × 3" är noll för en grind som kräver en enda hel körning.

Det som till slut fungerade: att lista de sju sökvägarna i ordning, säga rakt ut att bara
`Read`-verktyget bokförs (inte `cat`, `sed`, `Grep`), sätta de fyra tidigare missade först, och
KRÄVA ett kontrollerbart bevis — citera första raden ordagrant ur varje fil. En sammanfattning är
inte bevis; de citerade raderna är.

Samma familj som lärdomen från 2026-08-03: när en agent motsäger ett kommando du själv kan köra,
kör det själv.

### 2026-08-19 — [Workflow] Rättelsen till ett omätt tal bär oftast ett nytt omätt tal

**Trigger:** du skriver om en mening för att laga ett felaktigt antal.

**Regel:** avgränsa påståendet till det som faktiskt är relevant för koden bredvid, kör kommandot,
och lägg processberättelsen i sprintplanen — inte i kodkommentaren.

**Exempel:** en mening om vilka moduler som skriver till `users/{uid}/watchlist/*` föll för
granskarna TRE gånger i rad, i samma commit:

1. "`WatchlistContext` är enda skribenten" — tre skriver.
2. Rättelsen: "alla tre bygger id:t via `mediaTypeDocId()`" — `taste/backfill.ts` anropar den noll
   gånger (`grep -c` → 0); den `updateDoc`:ar ett id den läst ur en snapshot.
3. Rättelsen till rättelsen: "exakt två moduler bygger någonsin ett watchlist-doc-id" —
   `useFriendsWhoSaw.ts:59` bygger ett också, för en LÄSNING.

Fjärde varvet, filat som BIN-941: `AuthContext.tsx:265` är create-kapabel och saknas fortfarande.

Det som fungerade till slut var att avgränsa: spärren bryr sig bara om id byggda för en
SKRIVNING, så det är den frågan meningen ska svara på — och läsvägen namnges uttryckligen så
nästa läsare slipper återupptäcka den. Testgranskaren påpekade dessutom att den runda-för-runda
självrättelse jag skrivit in i testfilen var processlogg, inte ett VARFÖR-dokument, och alltså
inte hörde hemma i någon av doc-taxonomins sex klasser. Den flyttades till `tasks/todo.md`.

Direkt fortsättning på 2026-08-17-lärdomen. Skillnaden är att den handlade om tal i prosa; den
här handlar om att RÄTTELSEN är den farligaste platsen att skriva ett nytt.

---

### 2026-08-20 — Ett radnummer i ett plandokument är falskt i samma commit som det ligger i

**Utlösare:** en plan eller ett ADR som pekar ut anropsställen i kod som ÄNDRAS i samma commit.

**Regel:** namnge funktionen, testet eller symbolen — aldrig raden. Behövs ett tal, skriv
kommandot bredvid det så nästa läsare mäter om i stället för att ärva. Och kontrollera att
ANKARET matchar det spärren faktiskt bryr sig om, inte det som är lätt att greppa.

**Exempel (BIN-954):** listan över `updateProgress`-anropsställen och `setDoc`-skrivvägar
rättades TRE gånger under fyra granskningsvarv och var fel tre gånger. Varje ny kommentarsrad
jag skrev flyttade raderna igen, så varje rättelse bar ett nytt omätt tal. Två granskare fann
det oberoende. Samma runda visade att ankaret också var fel: `grep "await setDoc(ref"` gav åtta
skrivvägar, men BIN-942:s create-golv träffar varje `merge: true`-skrivning — tio. Tre saknades
helt ur inventeringen eftersom de skrev via `setDoc(doc(...))` eller `batch.set`. Nio av de tio
kan bli en spök-create; `writeTitle` bär alltid golvfälten.

Fortsättning på 2026-08-17 och 2026-08-19: de handlade om tal i prosa och om att rättelsen bär
ett nytt tal. Den här handlar om talet som blir fel UTAN att någon rör meningen.

---

### 2026-08-20 — En ny cache av "dokumentet finns" måste följa raderingen, även mitt i flykten

**Utlösare:** du inför en andra cache av "den här posten existerar" bredvid en befintlig.

**Regel:** rensa den överallt den gamla rensas — OCH inse att ett märke satt EFTER ett await
bara skyddar den sekventiella kedjan, inte en samtidig systeroperation. Bumpa en
generationsräknare synkront före raderingens första await; läs av den före skrivarens första
await och jämför efteråt. Att i stället märka FÖRE skrivningen är sämre: nästa anrop tar då
merge-grenen mot ett dokument som ännu inte finns.

**Exempel (BIN-954):** en sessionsmängd lades bredvid `itemsRef` i `WatchlistContext`. Två
granskningsvarv i rad hittade samma defekt i två storlekar, båda med samma utfall — det
identitetslösa fragment biljetten fanns för att ta bort återuppstod. Först för att `removeItem`
rensade `itemsRef` men inte den nya mängden (lägg till genom en avsnittsbock, ångra i samma
session). Sedan för att Firestore lägger på en väntande skrivning optimistiskt, så "Ta bort"
blir klickbar i samma ögonblick som tilläggets `setDoc` SKICKAS: raderingens rensning träffade
en nyckel som ännu inte fanns, och tillägget skrev tillbaka den över ett raderat dokument.

Testet som fäller båda: håll hämtningen öppen med en styrbar promise, kör raderingen mitt i,
släpp, observera. Ett test som kör operationerna i följd är grönt mot båda mutanterna.

---

### 2026-08-20 — Commit-grinden läser granskarens SISTA domrad, inte om fyndet är lagat

**Utlösare:** en granskare slutar på `REVIEW-VERDICT: fail` och du lagar fyndet.

**Regel:** kör om SAMMA granskare tills den slutar på en godkännande domrad. Den måste öppna
varje fil med `Read` igen — ledgern bokför bara Read-verktyget — och grinden kräver EN körning
som täcker allt. Säg i uppdraget vilka blobbar som är byte-identiska med förra varvet och vad
som ändrats, så blir omkörningen billig.

**Exempel (BIN-954):** integrationsgranskaren fällde varv 4 på ett tal i `tasks/todo.md` — en
fil som inte ens matchar någon `reviewGates`-pattern. Jag lagade det och försökte committa:
blockerad, eftersom grinden såg en fällande dom mot KODfilerna. Ett blockerande fynd i ett
plandokument kostar alltså ändå en full omkörning; det är ett skäl att mäta plandokumentets
påståenden från början.

Andra grinden samma commit: `review-coverage` kräver en `review`-rad i
`docs/org/metrics/events.jsonl` för biljetten i ämnesraden, och raden måste vara STAGEAD
(filen ligger i `cleanTreeIgnore`, så en ostageаd rad är osynlig). Kör aldrig
`log_event.mjs review` utan argument — den skriver då en tom rad som måste plockas bort för hand.

---

### 2026-08-21 — Stryk hellre än att formulera om

**Utlösare:** en granskare hittar ett felaktigt påstående i en kommentar, ett plandokument
eller ett beslutsprotokoll — ett tal, ett "den enda", ett "den här grenen stänger X".

**Regel:** ta BORT meningen. Skriv inte en sannare version. En omskrivning bär ett nytt
påstående som ingen har mätt, och det är så ett enda fynd blir en kedja av rättelser där
varje rond rättar den förra. En struken mening kan inte vara fel. Rätta på plats ENDAST när
den sanna lydelsen är direkt läsbar ur koden och inte behöver räknas — en flyttad sökväg,
ett omdöpt symbolnamn. Allt du skulle behöva MÄTA för att skriva stryks i stället.

Tre undantag, och de är hårda:
1. Ett **beslutsprotokoll** (ADR-beslutsrad, accepterad avvikelse) är enda protokollet över
   ett val. Det ersätts av en daterad efterföljare som citerar den verifierade koden, och
   lyfts till Malin — aldrig en tyst radering.
2. En **`*.knowledge.md`-punkt** följer sin egen konvention: ändras på plats. Aldrig en bar
   strykning.
3. Regeln får **aldrig** ta bort protokollet över olöst arbete. Ett blockerande fynd, ett
   ouppfyllt acceptanskriterium eller en ledger-/markörrad stängs genom att koden lagas och
   granskaren kör om — aldrig genom att meningen som namnger dem försvinner. Frestelsen att
   stryka en mening för att klara en grind är signalen att stanna och säga det högt.

Formulera fyndet så också: "skriv om X till Y" bjuder in nästa rond, "stryk X" avslutar den.
Det binder dina egna omgranskningsvarv, inte bara första passet.

**Exempel:** Synat natten till 2026-08-16. `git log --oneline b88016d..2e6d52a` ger 11
rättelsecommitar mellan 02:16 och 04:47, flera av dem rättelser av en rättelse. `cd69009`
heter "räkneordet är borttaget överallt i stället" — och nästa commit, `2e6d52a`,
konstaterar att just den commiten införde ett nytt räkneord medan den tog bort ett.

Regeln ligger i de fyra grindgranskarnas instruktioner och i den delade commit-spärrens
block om fällor vid omförsök. **Bevakning:** det blocket har ingen storleksgräns — det får
inte tyst växa till en andra digest.

### 2026-08-25 — [Workflow] En hållen patch FÖRFALLER, och biljetten som beskriver den åldras tyst

**Trigger:** en biljett vars åtgärd är "applicera om patchen / stashen — den går rent mot
HEAD", eller vilket som helst påstående om att sparat arbete fortfarande passar trädet.

**Regel:** kör `git apply --check` **vid urvalet, varje körning**. Ärv aldrig påståendet
från biljettexten, hur noggrant mätt det än var när det skrevs.

BIN-972 påstod ordagrant att patchen gick rent, och redovisade sin mätning: sex filer,
noll fel, 2026-08-23. Mätt om 2026-08-25 gav samma kommando **sex fel**. Den första är
den avgörande — `.claude/hooks/map-freshness.mjs: No such file or directory` — eftersom
BIN-989 slog ihop de två freshness-hookarna och döpte om filen. De fem övriga är verkliga
innehållskonflikter från fyra commits som landat under tiden.

Påståendet var alltså **sant när det skrevs och falskt två dagar senare**, utan att någon
rörde biljetten. Det är inte slarv i biljetten; det är patchens natur. Withdrawability
DECAYS — det står redan i lärdomen från 2026-08-01 — men den lärdomen handlade om att
`git apply -R --check` direkt efter apply. Den här halvan saknades: en patch som ligger
kvar tappar värde varje gång någon annan rör samma filer, och en biljett kan inte veta det.

**Följdregel:** när patchen inte längre går rent, bygg INTE om den blint och kör INTE
`git apply` för att se vad som händer. Läs patchen hunk för hunk mot trädet och avgör vad
som ännu inte finns — mycket av den kan redan ha landat under andra id:n. I det här fallet
låg git-apply-friskrivningen på main sedan `4393344` och `route.test.mjs`-arbetet byggdes
om från rent HEAD som BIN-979.

---

### 2026-08-25 — [Workflow] En granskare kan läsa SIN EGEN definition i stället för filen den grindar

**Trigger:** varje gång du dispatchar en grindgranskare och tänker läsa dess rapport.

**Regel:** härled granskarens skyldiga fillista ur `reviewGates` **själv**, före commit, och
jämför med vad den säger sig ha läst. Rapporten är inte beviset — det är loggen, och den
läser du inte, du låter grinden läsa den.

`binge-security-reviewer` avslutade på `pass (0 blocking)` och listade sex lästa filer.
Dess grindmönster matchade **två** stageade filer: `.claude/agents/binge-integration-reviewer.md`
och `src/lib/firebase/userDocWrite.chokepoint.test.ts`. Den läste den andra — och läste
`binge-security-reviewer.md`, sin egen definition, i stället för den första. Commiten
refuserades med exakt den filen namngiven.

Det är en ny variant av 2026-08-19:s lärdom. Den handlade om en granskare som läste
**för få** filer. Den här läste rätt ANTAL men **fel** fil, och bytet var det som såg mest
ut som en fil den borde bry sig om. En rapport som räknar upp sex filer ser fullständig ut.

**Praktiskt:** ett kommando som skriver ut vem som är skyldig vad tar tio sekunder och
sparar ett granskningsvarv:

```
node -e "const c=require('./.claude/shared-plugin.json');
const f=require('child_process').execSync('git diff --cached --name-only',{encoding:'utf8'}).trim().split('\n');
for(const g of c.reviewGates){const h=f.filter(x=>g.patterns.some(p=>new RegExp(p).test(x))&&!(g.exclude||[]).some(p=>new RegExp(p).test(x)));
console.log(g.agent,'=>',h.join(', ')||'(inga)')}"
```

Räkna med ett omkörningsvarv i budgeten. Grinden fail:ar closed, så priset är tid, inte en
ogranskad commit — men det är samma pris BIN-996 handlar om.

---

### 2026-08-25 — [Testing] En trasig JSON i en DATAFIL ser ut som hundratals orelaterade testfel

**Trigger:** varje redigering av en fil som andra test läser som data — `shared-plugin.json`,
`vitest.config.ts`, `ownership-map.json`, en fixtur.

**Regel:** kör **hela** sviten efter en sådan redigering, aldrig bara sviten för filen du
tror du ändrade.

Jag skrev en rättelse i `.claude/shared-plugin.json` via ett Python-skript. En sträng bar
`\\.` i Python-källan, vilket blev `\.` i JSON — ett ogiltigt escape. Filen slutade parsa.
`docs/org/`-sviten föll från 967 gröna till **818 fällda**, spridda över filer som inte har
något med ändringen att göra, eftersom `gate-symmetry.test.mjs` och `route.test.mjs` båda
läser konfigfilen som indata.

Symptomet pekade alltså åt exakt fel håll: en enda felaktig tecken i EN fil, presenterat som
massiv, diffus regression. Hade jag bara kört filens "egen" svit hade jag sett noll fel och
committat.

**Verifiera separat att filen parsar** — `node -e "require('./<fil>')"` — som ett eget steg,
inte som en följd av att sviten råkar vara grön. Samma familj som CRLF-lärdomen från
BIN-891: verktyget rapporterar inte "din redigering var trasig", det rapporterar något helt
annat.

---

### 2026-08-25 — [Workflow] Återställ ALDRIG en fil åt en syskonagent som muterar den

**Trigger:** `git status` visar en fil som smutsig mitt i avslutningen, och du vet att en
verifierare eller granskare kör mutationsprov på den.

**Regel:** rör den inte. Behåll din egen hash-verifierade kopia från HEAD, och kontrollera
före stage — men låt agenten återställa själv.

Under den här körningen visade `firestore.rules` en diff tre gånger, en gång som en
**strukturellt trasig** fil (obalanserade citattecken, en duplicerad funktion) eftersom en
verifierares `String.replace` expanderade `$'` i ersättningssträngen. Frestelsen att
"städa upp" var stark. Att göra det hade landat mitt mellan agentens för- och efterkontroll
av mutanten och gett ett falskt resultat — exakt kollisionen från 2026-08-05, fast med
rollerna ombytta: där var det en systeragent som återställde MIN mutant.

Alla tre gångerna återställde agenten själv, och slutläget verifierades mot HEAD:s hash
`63c5daf0055e3b5b71d7e18ca0153abf0df7cbb1` före stage. Filen är frånvarande ur commiten.

**Gör i stället:** `git show HEAD:<fil> > <scratchpad>/<fil>.HEAD-<sha>` som din egen
återställningsväg, och verifiera den med `git hash-object`. Lita inte på agentens
scratchpad-kopia — den kan skriva över samma sökväg med sin mutant.

---

### 2026-08-25 — [Workflow] Den enda strykning som håller skriver ingen mening alls

**Trigger:** ett fynd av formen "den här kommentaren räknar upp något som inte längre
stämmer".

**Regel:** ersätt uppräkningen med ett **kommando som härleder den**, inte med en mening om
mängden. Varje mening om en mängd är ett påstående, och ett påstående någon inte körde ett
kommando för är nästa rundas fynd.

BIN-979 är nu tre försök på samma sex rader:

* **2026-08-23:** ströks tre tal, skrev ett universellt påstående i deras ställe.
  `correctness=fail`, `intent=fail`.
* **2026-08-25, försök 1 (mitt):** ströks talen, skrev i stället att EN fil ärver sitt
  ägarskap (routern namner tre) och delade mängden i hinkar som höll 15 av 18 poster —
  plus ett färskt räknefel om antalet vidgningar i golvkommentaren. Fälld.
* **2026-08-25, försök 2:** skriver ingen mening om mängden. Klistrar in
  `node -e "…route([p]).reasonCode…"`. Godkänd.

Lärdomen från 2026-08-19 ("rättelsen bär oftast ett nytt omätt tal") beskrev problemet.
Den här beskriver **utvägen**, och den är smalare än den låter: det räcker inte att undvika
siffror. "Den enda X", "alla Y", "de under Z svarar W" är samma sak i ord. Testet är: *kan
ett kommando motsäga den här meningen?* Kan det, skriv kommandot i stället för meningen.

Ett ANKARE följer med: när uppräkningen försvinner blir en `Corrected …`-notering som
rättade den föräldralös. Stryk den i samma redigering — ett protokoll utan subjekt pekar på
ingenting. (Undantaget kvarstår: aldrig stryka protokollet över **olöst** arbete.)

---

### 2026-08-26 — [Workflow] Ett tal vars sanning hänger på en outtalad premiss går inte att härleda om

**Trigger:** du rättar ett påstående och skriver ett tal i den nya lydelsen.

**Regel:** stryk talet, skriv inte ett annat. Ett FELRÄKNAT tal kan nästa läsare räkna om
och laga. Ett tal vars sanning beror på en premiss meningen inte nämner kan ingen härleda
om — läsaren mäter enligt SIN tolkning, får ett annat svar, och drar slutsatsen att raden
är fel.

Sprinten 2026-08-26 tog **elva** blockerande granskningsfynd. Varje enskilt var ett falskt
PÅSTÅENDE i prosa jag skrivit — ett tal, en absolut sats, en föråldrad inventering. **Noll**
var defekter i koden som kör. Två av de elva satt inne i fixen för ett tidigare fynd.

Det avgörande exemplet: raden som bokförde ett ouppfyllt acceptanskriterium sa "muteringen
INNE i `markedSeen` fäller **fyra** test". Granskaren härledde tre och fällde den. Båda hade
rätt: ett bart `watchedAt != null` fäller fyra (den negativa tvillingen faller också), ett
`seenDate(i) != null` fäller tre (statustermen sitter kvar inuti helpern). Ingendera
muteringen namngavs. "Tre" hade shippat samma defekt med en annan siffra.

Utvägen är den 2026-08-25 redan pekar på, en nivå strängare: kontrasten meningen behöver är
oftast **något mot ingenting**, inte ett tal mot ett annat. Behöver du ändå ett tal — namnge
mätningen som ger det.

---

### 2026-08-26 — [Workflow] En muterande granskare kolliderar med en LÄSANDE, inte bara med en annan muterare

**Trigger:** du ska köra fler än en granskare på samma filuppsättning.

**Regel:** kör granskare som muteringsprövar **ensamma**. Lärdomen från 2026-08-14 sa "två
muteringstestande granskare på samma filer förstör varandras mätningar; läsande får gå
parallellt". Andra halvan är fel så fort den andra parten muterar.

2026-08-26 startade jag `binge-code-reviewer` medan `binge-integration-reviewer` läste om
samma bunt. Kodgranskaren muteringsprövade — korrekt, och den städade efter sig. Men
integrationsgranskaren såg `MM` på `WatchlistContext.tsx` mitt i sin läsning och fällde
bunten på två mekaniska grunder: en levande mutant i trädet, och att dess egen ledger-post
då pinnade mutantens bytes i stället för de som skulle committas. Inget av det var ett fynd
i koden; hela varvet var min schemaläggning.

Ordningen som höll resten av sprinten: en muterande granskare i taget, och
integrationsgranskaren SIST, mot ett städat träd — den är push-grinden och behöver läsa
exakt de bytes som går ut.

---

### 2026-08-26 — [Testing] En grön bunt är inte en grön svit — en NY fil är en ägarkartshändelse

**Trigger:** en bunt lägger till en fil under en katalog som ägarkartan listar fil för fil.

**Regel:** kör HELA sviten före push, inte bara buntens egna filer. `src/lib/markedSeen.ts`
och dess test var gröna i varje per-bunt-körning och fällde ändå två test i
`docs/org/gen-ownership-map.test.mjs` — de läser ägarbaslinjen som indata, så en ny
ägarlös fil rödfärgar dem oavsett vad filen innehåller.

Rätt åtgärd är att ge filen en **ägare** i `docs/role-responsibilities.md` och regenerera,
aldrig att baslinjera bort den med `--update-gaps`: det senare gör hålet permanent, vilket
är precis vad `ownership-gaps.json` finns för att göra svårt att skapa av misstag (BIN-1013).
Sätet är oftast redan givet — här ägde #26 syskonfilen `seenDate.ts` och hade dessutom satt
formkraven på extraktionen.

Samma familj som "en trasig JSON i en datafil ser ut som hundratals orelaterade testfel"
(2026-08-25): symptomet pekar åt fel håll.

---

### 2026-08-27 — [Workflow] En restlucka mäts mot en klocka — namnge vilken innan du beskriver den

**Trigger:** prosa som beskriver ett accepterat kvarvarande hål, en tröskel eller ett
tidsfönster.

**Regel:** skriv ut VILKEN storhet jämförelsen läser innan du beskriver vad som faller
utanför, och läs meningen mot operatorn. BIN-909 mäter `metadata.creationTime`, alltså
Auth-kontots egen ålder, som en radering av `users/{uid}` inte rör. Jag skrev tre gånger
att luckan var "ett konto som raderas och återbesöks inom fem minuter" — fel klocka: ett
konto som passerat tröskeln gatas hur snabbt ägaren än kommer tillbaka, och det verkliga
hålet är ett konto som SJÄLVT är högst fem minuter gammalt. Version två och tre passerade
var sin säkerhetsgranskning innan integrationsgranskaren fällde dem.

**Exempel:** fjärde versionen behövde dessutom rätta gränsen — `>` är strikt, så exakt fem
minuter ligger på den OGATADE sidan, och "yngre än tröskeln" namngav mängden ett ögonblick
för liten. Gränstestet fanns redan och sa rätt sak; det var meningen bredvid som var fel.

**Kostnad:** fyra granskningsvarv, sex fynd. Ett var en defekt i koden. Fem var falska
påståenden i min egen prosa, varav två satt inne i rättelsen av ett tidigare fynd.

---

### 2026-08-27 — [Testing] En flagga som sätts efter en rundtur skyddar inte fönstret före den

**Trigger:** en ny grind som läser ett tillstånd hämtat asynkront, medan konsumenten startar
på ett värde som sätts synkront.

**Regel:** kontrollera att grindens flagga är sann TILLRÄCKLIGT TIDIGT, inte bara att den
är sann. `onAuthStateChanged` sätter `uid` synkront och `WatchlistContext`s lyssnare
startar direkt på det, medan `pendingReconsent` inte är känd förrän `getDoc` svarat.
Firestores lokala cache levererar rader inuti det glappet, så de självgående skrivarna
hann skriva under ett uid vars profil visade sig saknas — precis det grinden byggdes för
att hindra. `deletionInProgress` har inte hålet: dess markör är en synkron
localStorage-läsning.

**Exempel:** lösningen fanns redan i filen — `profileLoading` sätts i samma synkrona block
som `setUid` och nollställs i `.finally()`. Grinden blev
`profileLoading || isDeletionStarted(uid) || pendingReconsent`.

### [Workflow] En ändring som gör en fil sannare kan göra en granne falsk — och bara en helhetsläsning ser det (2026-08-27, BIN-1022/1025)

**Trigger:** du rättar en mening i fil A, och fil B motiverar sitt eget beteende med ett
påstående om hur fil A ser ut.

**Regel:** kör helhetsgranskaren SIST, ensam, och kör om den efter varje rättelse — en
rättelse är själva den sortens ändring som kan falsifiera en granne. Fråga specifikt: finns
det något par av filer i trädet som nu säger emot varandra?

**Exempel:** `watchlistDocKey.test.ts` motiverade sitt kommentarstrippande filter med "en rad
i `WatchlistContext.tsx` diskuterar en äldre nyckelform i prosa". Tidigare i samma bunt hade
jag skrivit om exakt den raden. Båda filerna var korrekta var för sig; `grep -n '\${uid}'`
gav noll träffar. Fyra andra granskarpass hade läst båda filerna utan att se det, eftersom
ingen av dem läser två filer mot varandra. Samma runda fällde helhetsgranskaren tre gånger,
varje gång på ett påstående ingen typkontroll, inget test och ingen linter läser.

### [Design] Att låta en delad skrivväg VÄGRA gör varje ovillkorlig bekräftelse till en lögn (2026-08-27, BIN-1025)

**Trigger:** du lägger till ett avvisande (eller en tyst no-op) i en funktion som många
anropare delar.

**Regel:** innan du gör det, räkna upp varje anropare som BEKRÄFTAR något efteråt — en toast,
ett UI-tillstånd, en räknare. Varje sådan bekräftelse som inte inväntar utfallet blir falsk i
samma commit. Att `await`:a räcker inte: `await` propagerar, det hanterar inte. Det enda som
skyddar är att bekräftelsen är kedjad på skrivningen.

**Exempel:** `writeTitle` fick vägra under en pågående kontoradering. `MoviePageClient`s
"Bevaka släpp" gjorde `void upsertTitle(...)` och toastade "Bevakar släppet av X"
ovillkorligt — sant så länge skrivningen alltid landade, en lögn i samma sekund den kunde
vägras. BIN-895:s falska bekräftelse, återöppnad av fixen som skulle skärpa säkerheten. Detta
var sprintens ENDA äkta koddefekt, och den infördes av sprinten själv. Valet av form var
redan rätt av samma skäl: två roller blockerade oberoende på att ett nytt FÄLT på utfallet
hade varit ignorerbart hos åtta av nio anropare.

### [Workflow] En bunt som nästan bara är PROSA konvergerar inte — varje rättelse är ny prosa (2026-08-28, BIN-1028)

**Trigger:** du raderar eller byter ut något som beskrivs på många ställen — en workflow,
ett skript, ett fält — och upptäcker att fixen är två rader kod och tjugo meningar.

**Regel:** räkna med att fyndfrekvensen INTE faller mot noll av sig själv. En kodfix
granskas en gång och är klar; en prosafix skapar ny prosa som ingen mätt, så nästa varv
har något nytt att hitta. Fyra av de sista fyndklasserna satt inne i rättelsen av det
föregående fyndet. Det som bryter kedjan är att sluta skriva meningar: stryk hellre än
formulera om, och där en mening ändå måste stå — skriv ett KOMMANDO som härleder den, och
KÖR kommandot innan du committar. Ett "härled det själv" som författaren aldrig härledde
är den pinsammaste varianten, och den inträffade.

**Exempel:** BIN-1028 raderade två workflows. 41 blockerande fynd över nio granskningsvarv,
NOLL defekter i koden — allihop falska påståenden i min egen prosa. Dominerande former:
ett kvantifikator över en körningshistorik ingen räknat ("röd vid varje körning" — 112 av
296 var gröna); ett påstående ärvt från en granskare och spritt till tre dokument utan
mätning (dependabot-PR:er fick aldrig skarpa nycklar — 84 körningar, noll lyckade); en
raderad workflow beskriven UTAN att namnges, vilket överlevde fyra grep-svep; och en
rättelse som lämnade kvar just det den skulle ta bort. Kostnaden var inte fixen utan
prosan runt den.

### [Workflow] Ett flerfilsskript som kraschar mitt i skriver några filer och hoppar tyst över resten (2026-08-28, BIN-1028)

**Trigger:** du redigerar N filer i ett `python - <<PY`-block där varje ändring har ett
`assert anchor in s`.

**Regel:** en assertion som brister avbryter HELA skriptet — men filerna före den är redan
skrivna. Du får ett stack trace och ett halvfärdigt träd, och om du läser "ok" på de första
raderna och går vidare rapporterar du ändringar som inte finns. Gör en fil i taget, eller
grep:a varje ändring efteråt. `git status` räddar dig inte: filen du missade är oförändrad,
alltså osynlig.

**Exempel:** hände tre gånger i samma bunt. Två gånger rapporterade jag ändringar som
gjorda utan att de fanns — en fångades av kodgranskaren, en av push-grinden. Tredje gången
fångade jag den själv, för att jag då grep:ade efter varje enskild ändring i stället för
att lita på skriptets utskrift.

### [Workflow] En spärr inkopplad i en funktion ingenting anropar är overksam just där felet rapporterades (2026-08-29, BIN-1040)

**Trigger:** du lagar en grind och kopplar in fixen där skriptets `main()` bygger sina
indata.

**Regel:** kontrollera vilken KODVÄG som faktiskt fäller det som gick fel, inte vilken som
ser ut att vara ingången. `check_review_coverage.mjs` har ett `main()` — och ingenting
automatiskt anropar det. `lefthook.yml` kör `--message`-läget, och det som gör deployen röd
är `npm test` som når ett helhetspåstående i skriptets EGEN testfil. Undantaget satt i
`main()`, med ett filhuvud som sa att det var fixat, medan den mergade robot-commiten
fortfarande fälldes. Bygg indata på EN plats som båda anroparna använder, och härled
anroparna med ett kommando (`git grep -n "findCoverageGaps(" -- docs`) i stället för att
lita på en mening om dem.

**Exempel:** integrationsgranskaren spelade upp en påhittad post-epok-robotcommit genom
båda anropsformerna: den gamla gav 1 brott, den nya 0. Utan den mätningen hade fixen
shippat som en fix och inte varit en. Samma klass som BIN-744/776/917 — "läs regeln där den
UTLÖSER, inte bara där den skrevs".

### [Workflow] En strykning i en commit lämnar kopian i nästa commit stående, och bara helhetsgranskningen över hela push-området ser det (2026-08-29, BIN-1040/1002/1038)

**Trigger:** samma felaktiga mening bor på flera ställen, och du stryker dem i olika
commitar.

**Regel:** push-grindens helhetspass är inte ceremoni — det är den enda läsningen där en
mening struken i commit 1 syns stå kvar i commit 3. Varje per-bunt-granskning såg EN bunt
och passerade. Kör den, och räkna inte kopiorna i prosan: meningen "stod på fyra ställen"
skrevs i commit 2 och var falsk när commit 3 strök den femte.

**Exempel:** meningen "utan flagga kör den under `npm test` och grindar DEPLOYEN" bodde på
fem ställen — två i modulhuvudet, ett i metrik-README:n, ett i routern och en svensk
tvilling i sprintplanen. Tre ströks i första commiten, en i andra, den femte i tredje. Fyra
granskningsvarv i rad hittade exakt en kopia till per varv. Rättelsen som räknade dem blev
själv ett fynd.

### [Workflow] En bunt kan göra en mening falsk i en fil den inte rör alls (2026-08-29, BIN-1038)

**Trigger:** du ändrar hur ANROPARNA beter sig, och en annan fil beskriver anroparna.

**Regel:** ingen per-fil-grind kan se det, för filen står inte i diffen. Fråga vid varje
bunt: vilken fil BESKRIVER det jag just ändrade beteendet på? `WatchlistContext.tsx` sa "de
flesta anroparna slutar i en ohanterad rejection" — sant när det skrevs, noll av nio efter
den här bunten, och filen var orörd. Att laga det drar in filen i diffen och beväpnar om
dess granskare, så räkna med den kostnaden i stället för att hoppa över fyndet.

**Exempel:** hittades av helhetsgranskningen, inte av kod-, säkerhets- eller
testgranskaren, som alla tre hade passerat på exakt de bytes som gick ut. Samma runda:
`OnboardingFlow` har tre catchar för samma vägran och bunten lagade en — anteckningen som
sa "rättat" fick smalnas av till vilken gren som faktiskt rättades.

### [Workflow] En KRYMPT filuppsättning ogiltigförklarar routningen precis som en vidgad (2026-08-29, BIN-1050/1048)

**Trigger:** en biljett faller bort ur bunten efter att routern körts — en handbroms, en
obesvarad fråga, ett mätt hinder. Alltså i stort sett varje sprint.

**Regel:** kör routern på buntens FAKTISKA union omedelbart före kritiken konvenerar, inte
på urvalets. BIN-766 skrev regeln bara för ett VIDGAT omfång och BIN-776 lade kollen i
urvalet, vilket var rätt plats men bara körs en gång. Här routade urvalet fyra sökvägar
(`pr-checks.yml`, symmetritestet, `freshness.mjs`, `freshness.test.mjs`) → panel `[25]` med
`"4 Security Architect"` i `dropped`; BIN-790 drogs ur, och den krympta unionen ger `[4]`.
#25 kritiserade, bygget skedde under den, och den ägande rollen nåddes först av push-grinden.

**Exempel på hur man INTE skriver ned det:** varken jag eller push-grinden kunde låta bli att
formulera vilken enskild fil som "flyttar panelen". Grindens version — "varje union som
innehåller `pr-checks.yml` ger `[4]`" — är falsk; fyrafilsunionen ovan innehåller den och ger
`[25]`. Min första version var lika omätt. Svaret på en routningsfråga är ett kommando i
planen, aldrig en mening.

### [Testing] `describe.each([])` registrerar noll test och rapporteras som PASS (2026-08-29, BIN-1048)

**Trigger:** du parametriserar en befintlig svit över en lista, och listan är den enda saken
som avgör vad som prövas.

**Regel:** lägg ett rosterkrav UTANFÖR loopen som härleder listan ur källan den beskriver.
Golv INNE i loopen skyddar bara de varv som faktiskt körs — en tömd eller halverad lista kör
noll varv, och vitest rapporterar grönt. Samma tysta spärrhake som BIN-823/852/931/998, i en
ny förklädnad. Här härleder rosterkravet vaktnamnen ur `firestore.rules` själv och fäller om
filen deklarerar en vakt listan inte täcker.

**Exempel:** muteringsprövat i båda riktningar. Halverad `GUARD_FUNCTIONS` → exakt rosterkravet
faller. Uppluckrad `canonicalSwipeDocId` i `firestore.rules` → exakt svep-vaktens
överensstämmelsetest faller, med `movie_0`/`tv_0` utskrivna, medan bevakningslistans står grönt.

### [Testing] En ny check som bara testas direkt kan raderas ur `main()` med sviten grön (2026-08-29, BIN-852)

**Trigger:** du lägger till en check i ett skript och testar den genom att anropa den direkt.

**Regel:** anropsstället behöver en egen test som källkodsskannar `main()`s kropp — och den ska
pinna ARGUMENTEN, inte bara anropet. `[^)]*` mellan första och sista argumentet är arity-blint:
ett borttaget mittargument matchar fortfarande och gör funktionen till en permanent no-op.
`[^,)]*` kan inte svälja ett kommatecken. Tre mutationer ska fälla testet: anropet borttaget,
argumentet bytt till fel array, mittargumentet borttaget.

**Exempel:** BIN-852. Testgranskaren fällde bunten, och den hade rätt — 54/54 gröna med anropet
borttaget ur `main()`. `scripts/check-workflow-map.mjs` bar redan idiomet (check 6 och 7 har var
sin), den nya checken saknade sin. Andra varvet fällde granskaren regexen som arity-blind; också
verifierat, 54/54 gröna med mittargumentet borta. Blindfläcken som återstår — `if (false) …`
fångas inte — står i testets egen kommentar, som i syskonen.

**Samma runda, två fällor till:** ett test som deklarerar en egen lokal `problems` funktionen
aldrig får är VAKUÖST (dess assertion är sann oavsett vad koden gör) — stryk det, formulera inte
om. Och ett källkodsskannande test kan gå sönder på sin egen regex och se ut som ett fynd.

### [Workflow] Ett bevis som mäts mot en datafil samma commit ändrar måste tas FÖRE ändringen (2026-08-29, BIN-852)

**Trigger:** din ändring lagar ett tillstånd OCH rensar bort tillståndet i samma commit.

**Regel:** kör beviset mot det gamla tillståndet först och spara utdatan ordagrant. Annars är
enhetstestet det enda beviset att mekanismen någonsin fyrar, mot en fixtur du själv skrivit —
och biljettens hela premiss ("spärren har varit tyst avstängd på VERKLIG data") blir obevisad.
Bindande villkor från #14 Software Architect, och det var det mest värdefulla i hela kritiken.

**Följdregel för kommentaren intill:** ett kommando som återskapar talen får inte förutsätta ett
tillstånd samma commit förstör. Min första lydelse sa "kör lintern efter att medvetet INTE ha
regenererat baslinjen" — omöjligt vid de bytes som committas, och fälld av helhetsgranskningen.
Beskriv i stället härledningen mot en TIDIGARE version av datafilen, och kör den innan du skriver
meningen.

### [Workflow] "Det kräver en riktig körning" och "jag kan inte köra den" är två påståenden (2026-08-29, BIN-1050)

**Trigger:** ett acceptanskriterium märkt `kind: run` — dispatch-bevis, en röd check, en räkning
mot produktion.

**Regel:** pröva om du kan bygga mätinstrumentet innan du skickar kriteriet till Malin. Jag skrev
på BIN-1050 att beviset "kräver en riktig pull request, och den här sessionen öppnar inga PR:er".
Första halvan var sann, andra var ett antagande jag aldrig prövade. En **tillfällig PR som aldrig
mergas är ett mätinstrument**: gren `tmp/<biljett>-probe`, den avsiktliga defekten, `gh pr create`
med "PROV, ska INTE mergas" i titeln, och `gh pr close --delete-branch` + `git fetch --prune`
efteråt.

**Och läs utfallet PER STEG, inte bara checkens färg:**
`gh run view <id> --json jobs --jq '.jobs[] | .name as $j | .steps[] | "\(.conclusion)  \($j) / \(.name)"'`
BIN-1050:s körning visade `Typecheck` success och `Typecheck functions` failure på samma commit.
Att bara veta att checken blev röd hade inte skilt den nya grinden från vilket annat fel som helst.

**Exempel på när det inte går:** en skärmdump av hur något SER ut är verkligen hennes. Men
CI-utfall, produktionsräkningar (BIN-999 samma dag: en `list` + sex `get` gav svaret) och
deploy-beteende är oftare nåbara än de först verkar. Fråga vilket instrument som saknas, inte om
kriteriet är "run".

### [Workflow] Ett publicerat kommando som KÖR men ger tom utdata passerar "extrahera och kör det" (2026-08-29, BIN-929/935/938)

**Trigger:** du skriver ett kommando i en kommentar, ett beslutsprotokoll eller en README, som
läsaren ska köra i stället för att lita på en siffra.

**Regel:** kör det committade kommandot ordagrant OCH LÄS UTDATAN. Att det kör räcker inte.
Jag publicerade `git show <sha> -- <fil>` för att visa vad en struken text sa. Kommandot kör
felfritt och ger **noll bytes**, eftersom den commiten aldrig rörde filen — pathspec-formen
visar en diff, inte ett innehåll. Jag hade kört kolonformen (`git show <sha>:<fil>`, som
fungerar) och publicerat den andra. Push-grinden fångade det; min egen "extrahera och kör"-
metod gjorde det inte, för den bara körde.

**Samma runda, samma familj:** `\r` och `\n` i ett dokumenterat kommando kollapsade TVÅ gånger
till riktiga styrtecken när det skrevs via en heredoc, och gav `SyntaxError: Invalid regular
expression`. Skriv hellre kommandon som inte behöver escape-tecken alls (`grep -E '[|](feat|fix)'`
i stället för `\|`), och extrahera alltid ur den committade filen — aldrig ur ditt utkast.

**Följdregel om tidszon:** `%cI` bär lokal offset. Ett `awk`-datumfilter på den strängen
jämför alltså inte samma klocka som en regel som använder `Date.parse`. Använd
`TZ=UTC git log --date=iso-strict-local` när kommandot ska spegla en UTC-baserad spärr.

### [Workflow] Planens egen gruppering av en bunt kan vara det som felsätter panelen (2026-08-29, BIN-938/1052)

**Trigger:** en sprintplan som buntar flera biljetter och motiverar buntningen med en mening om
vilka filer de rör.

**Regel:** routa på biljetternas UNION av filer, inte på planens mening om dem — och routa om
mot `git diff --cached --name-only` omedelbart före commit. Min plan skrev "de rör samma två
filer" om tre biljetter. Falskt: BIN-938:s hela leverans låg i en TREDJE fil
(`.claude/rules/accepted-deviations.md`), och just den filen vänder `reasonCode` från
`unmapped-code` till `owned` och panelen från #14 till #25. Den ägande rollen nåddes aldrig
förrän push-grinden och en parallell session hittade det oberoende av varandra.

Det är BIN-1050/1048:s lärdom i den VIDGANDE riktningen, en dag efter att den skrevs ned.
Åtgärden när det inträffar är inte att formulera om planen: **committa splittat**, så att varje
commits filuppsättning routar till den kritik som faktiskt kördes för den. Verifiera per commit
med routern före du skriver.

**Och tick aldrig av ett villkor som säger "committas splittat" innan commitarna finns** —
push-grinden fällde exakt det. Den som håller shan skriver fullbordandet, ingen annan.

### [Design] En stämpel som skrivs om varje körning når aldrig sitt eget golv (2026-08-30, BIN-1023)

**Trigger:** en spärr som ska mogna över tid och därför behöver ett minne mellan körningar —
"radera först när X har varit sant i N dygn".

**Rule:** låt bara den som SAKNAR minne skriva minnet. Ett objekt vars klocka går men ännu
inte löpt ut ska hamna i INGEN hink alls: varken behandlas eller stämplas om. Skrivs stämpeln
om vid varje kontroll flyttas deadlinen exakt lika fort som klockan går, golvet löper aldrig
ut, och mekanismen ser fullständigt frisk ut i loggen medan den aldrig gör något.

`merge: true` räddar inte: merge slår ihop FÄLT, den bevarar inte ett fält du skriver. En
kommentar som påstår att den gör det är ett falskt påstående, inte en säkring.

**Example:** BIN-1023:s orphan-datasvep stämplar `orphanWatch/{uid}` med `firstSeenAt` och
raderar först när stämpeln är äldre än `ORPHAN_DATA_MIN_OBSERVED_MS`. Mitt första bygge lade
varje frånvarande uid i `stamp`-hinken, även de som redan hade en för ung stämpel. Fixen:
`else if (seen === null)`, och ett test som håller ett för ungt värde och hävdar att alla tre
hinkarna är tomma. Muteringen `else` fäller två test.

Samma tysta spärrhake som BIN-823/852/931/998 i ny förklädnad.

**Två följdregler ur samma runda:**

1. **Namnge vilken STORHET klockan mäter, innan du återanvänder ett tal.** Systersvepets
   `ORPHAN_AUTH_MIN_AGE_MS` mäter Auth-kontots egen ålder. Den storheten finns inte när kontot
   är raderat — det är hela premissen för det nya svepet. Att återanvända sjuan hade varit att
   mäta fel sak med rätt siffra.
2. **En räknare som rapporterar AVSIKT gör en trasig körning oskiljbar från en frisk.**
   `watchedOrphanDataUids` räknade kandidater, inte skrivningar. En körning vars stämplar alla
   nekades hade sett identisk ut med den friska dagen efter en konsolradering — och `RUNBOOK.md`
   §5d säger åt operatören att vänta ut fönstret på just den signaturen. Räkna EFTER commit, som
   syskonräknarna gör. Två mutanter (flytta ökningen före `await`; ersätt med `stamp.length`)
   överlevde hela sviten tills testet skrevs.

**Och en ordningsregel:** när två raderingar hör ihop men en av dem gör den andra oadresserbar,
är ordningen bara bevisad av ett test som FALLERAR MELLAN dem. `publicProfiles/{uid}` ligger
utanför `users/{uid}`-trädet, så när trädet är borta slutar uid:t synas i genomsökningen. Att
kasta i `deleteUserTree` och hävda att projektionen redan är borta skiljer de två ordningarna;
inget annat test i filen gjorde det (mutationen överlevde 20 av 20).

### [Workflow] Push-grinden är ett EGET granskningsvarv, inte ett `git push` (2026-09-01, BIN-1059)

**Trigger:** en sprint planerar sitt anslag efter antalet buntar.

**Regel:** `require-integration-review-before-push.mjs` kräver EN
`binge-integration-reviewer`-körning som läst varje granskningsbar fil i hela `@{u}..HEAD`.
Per-bunts-granskningar summerar inte till det, och grinden säger det rakt ut: *"Per-batch
proofs do not add up to it."* Räkna alltså push som ett varv med samma vikt som en bunt, och
lägg det där det finns anslag kvar. Att splitta i FLER commitar gör det dyrare, inte
billigare — varje commit lägger till filer i intervallet utan att ta bort behovet av ett pass
över alltihop.

**Exempel:** sprinten 2026-08-31 brände sitt anslag på fyra per-bunts-kedjor, slog i
användningstaket precis när intervallgranskningen krävdes, och fyra färdiga commitar blev
liggande opushade över natten. Ingenting gick förlorat — de låg lokalt, den femte som en
arkiverad patch — men leveransen sköts ett halvt dygn.

**Och den är den som hittar mest.** Den fann åtta fynd ingen per-bunts-granskning kunde se,
varav två som sprinten själv orsakade: ett publicerat routningsresultat i en TIDIGARE commits
fil som en senare commit gjorde falskt, och en spärrhake vars lista bunten växte från 25 till
27 utan att höja golvet från 22 — ett golv som ligger efter sin lista kan inte längre fyra.
Båda osynliga per commit, båda uppenbara över intervallet.

### [Workflow] Nitton granskningsvarv, ETT fynd i koden (2026-09-01, BIN-1059/1060/1061/1064)

**Trigger:** en bunt som mest är text — kommentarer, planer, beslutsprotokoll, granskarnas
egna anteckningar.

**Regel:** stryk hellre än formulera om, och sök efter kopiorna FLERRADIGT. Samma mening är
radbruten olika i olika filer, så en enkelradig `grep` hittar en av tre. Där en mening måste
stå kvar, skriv ett KOMMANDO som härleder den — och kör kommandot innan du skriver meningen.
Skriv kommandon HELT utan escape-tecken - anvand `String.fromCharCode(10)` i stallet
for ett radbrytningsescape.

**Exempel:** sprinten 2026-08-31 tog nitton varv över fem buntar. Exakt ett fynd låg i koden.
Alla övriga var meningar jag själv skrivit och ingen mätt, och fem av dem satt inne i
rättelsen av ett tidigare fynd. Formerna som återkom: ett tal som glidit (587→585, 948→1070,
149→152, 22→27); en superlativ över en oräknad mängd ("den vanligaste orsaken" = 4 av 19); ett
publicerat kommando vars radbrytningsescape kollapsat till ett riktigt styrtecken sa att
det inte ens gick att kora - ANDRA gangen samma familj biter, och en TREDJE gang i den
har lardomens egen text; en mening struken pa ett stalle som levde kvar
elva rader ovanför, och en till i en syskonfil; och ett påstående ärvt ur biljetten och skrivet
in i koden utan att mätas (BIN-1059:s premiss om granskarnas kunskapsfiler var mätbart falsk —
en `*.knowledge.md` är ingen kodsökväg och kan aldrig sätta en roll i panelen).

**Följdregel:** en strykning som lämnar ett stycke bredvid utan subjekt är ett nytt fynd. Ta
med det som hänger löst i samma redigering.

### [Testing] En assertion om att något INTE hittas uppfylls också av en förstörd mätning (2026-09-02, BIN-1069)

**Trigger:** ett test som pinnar att en vakt FÄLLER — `expect(guard(x)).toBe(false)`, ett index
som ska ha flyttat, en sökning som ska ha missat.

**Regel:** fråga vad uttrycket svarar när mätapparaten är helt trasig, inte bara när koden är
trasig. `awaitsTheFetch(body, at)` är `false` både när vakten fäller rätt och när `firstAwaitIndex`
svarar `-1` för att skanningen inte hittar något någonstans. "Vakten fäller" och "vakten är
förstörd" uppfyller då samma assertion, och muteringen som förstör mätningen ÖVERLEVER testet.
Pinna det positiva utfallet — vilket index, vilket värde — inte bara frånvaron av det gamla.

**Följdregel, och den är den som bet hårdast:** om den FÖRVÄNTADE sidan också härleds genom att
anropa samma funktion som prövas, kollapsar båda sidor till samma meningslöshet under total
förstörelse. Hjälparen räknade `at + mutation.indexOf("await")` där `at` kom ur samma
`firstAwaitIndex`; med den stubbad till `-1` blev jämförelsen `-1 === -1 + 0` och passerade. En
baslinje hämtad ur funktionen under prövning behöver en egen rimlighetskoll
(`expect(at).toBeGreaterThan(-1)`) INNAN den används som facit.

**Exempel:** BIN-1069. Första utkastets två sömtest gick igenom citat-rusningsmuteringen. Efter
att indexet pinnats fäller den muteringen exakt sitt test; efter att baslinjen kontrollerats
fäller den totala förstörelsen nio av tio test i stället för ett. Den tionde är kastvägen, som
med flit inte går genom skanningen alls — en överlevare man kan namnge är inte samma sak som en
oförklarad.

**Samma runda, samma familj:** ett fixturtest kan vara grönt av fel skäl. `'abc'.length / 2` har
en identifierare före snedstrecket, så det passerade även mot den avgränsarblinda versionen och
bevisade ingenting om citattecknet. Snedstrecket måste sitta DIREKT efter avgränsaren.

### [Workflow] Fixen för en tyst spärr kan återinföra exakt den tystnad den stänger (2026-09-02, BIN-1069/1067/1074)

**Trigger:** en ändring som gör en källkodsskannande vakt, en lexer eller en heuristik bättre.

**Regel:** räkna upp båda felriktningarna innan du bygger, och pröva den TYSTA med en mutering.
`DIVIDES_AFTER` fick identifierare, tal, `)` och `]` men inte avgränsarna som AVSLUTAR ett värde
— backtick, citattecken, regexens eget snedstreck. Så `` `abc` / 2 `` öppnade en regex som
blankade till radslutet och svalde ett `await` efter sig: vakten rapporterade friskt. Det är
precis felet vakten finns för, återinfört av lagningen av det. Rollkritiken hade varnat för
formen i förväg (#13:s villkor 3) utan att någon av oss såg att jag byggt den.

**Regel 2:** trädet måste stå STILLA under push-granskningen. Två av den här sprintens
granskningsvarv ogiltigförklarades av att jag redigerade och stageade om filer medan granskaren
läste dem — ledgern pinnar de bytes den öppnade, så en dom över bytes som inte längre finns är
ingen dom. Frys, kör, läs domen, rätta, frys igen. 2026-08-26:s lärdom med rollerna ombytta.

**Exempel:** sprinten 2026-09-02 tog nio blockerande fynd. TVÅ låg i koden, båda i min egen fix
för det föregående fyndet. De sju andra var falska tal och kvantifierare i min egen prosa i
sprintplanen: en tallystring över testsviten, ett teckenantal mätt före samma commits egen
redigering av filen det mätte, "två träffar" där kommandot bredvid svarar tre, "299 ägarlösa
filer" där repots egen härledning svarar något annat, "8/8 grön" mot en filversion commiten
ersatte, en uppräkning som inte täckte sin egen lista, och en commit-form planen bockat av innan
commitarna fanns. Varje enskild ströks i stället för att rättas — en rättelse bär ett nytt omätt
tal, vilket är hur ett fynd blir en kedja.

**Och det som faktiskt var värt mest:** push-granskningen hittade att `docs/RUNBOOK.md` sa att vi
ligger på Spark, rådde att invänta en dygnskvots nollställning, och föreslog en uppgradering till
Blaze som gjordes för länge sedan — på tre ställen i samma fil. En jourhavande hade följt det mitt
i ett driftläge. Ingen kod, inget test och ingen lint kan se det; bara någon som läser dokumentet
mot verkligheten.

### [Testing] Ett test som pinnar en konstant på dess VÄRDE matchar kommentaren som nämner den (2026-09-02, BIN-790)

**Trigger:** ett test ska hålla ihop en sträng som står som eget literal i två filer — en delad
sökväg, ett delat id-format, ett delat felkodsprefix.

**Regel:** ankra på DEKLARATIONEN, inte på värdet. `expect(fil).toContain(VÄRDE)` uppfylls av
vilken kommentar som helst i filen som råkar nämna värdet; `toContain(\`const NAMN = '${VÄRDE}';\`)`
uppfylls bara av tilldelningen. Och pröva det: en omdöpning på den andra sidan ska fälla exakt
det testet.

**Exempel:** BIN-790:s rensning läser flaggan `.claude/state/workflow-map-stale.json`, som är ett
eget literal i stämplaren (`freshness.mjs`), i rensningen och i rensningens test. Döps
konstanten om på stämplarsidan blir rensningen en PERMANENT tyst no-op — `existsSync` faller,
tidig retur, avslutskod 0 — med hela sviten grön, eftersom testerna bygger sin egen flagga ur
sitt eget literal. Push-grinden bad om ett test som håller ihop dem. Min första version gjorde
`toContain(FLAG_REL)` och ÖVERLEVDE omdöpningsmuteringen, 20/20 gröna: sökvägen står också i
stämplarens egen huvudkommentar, så den matchade kommentaren i stället för symbolen. Andra
versionen pinnar hela tilldelningen och fäller muteringen ensam (19/1). Det är commit-grindens
egen fälla nummer ett — "grep the changed TOKEN, never the comment beside it" — och den bet i
det test som skrevs för att stänga en tyst spärr.

**Sidoregel, från #14:s kritik:** att i stället bryta ut strängen till en DELAD KONSTANTMODUL vore
sämre här. Det flyttar kopplingen till import-tid, före den `try/catch` som gör skriptet
fail-open, och gör därmed en medvetet icke-blockerande städning till en blockerande.

### [Testing] En miljövariabel som läses inne i funktionskroppen slår ut en injicerad parameter — och kan radera skarpt tillstånd (2026-09-02, BIN-790)

**Trigger:** en funktion tar en `cwd`, en rot, en katalog eller en klient som parameter, och
läser samtidigt ett fallback-värde ur `process.env` inne i kroppen.

**Regel:** läs miljön i SIGNATUREN, inte i kroppen. `function run({ dir = process.env.X })` låter
ett test skicka `dir: null` och verkligen få sin egen katalog; `const dir = process.env.X || arg`
gör den injicerade parametern tyst verkningslös så fort variabeln råkar vara satt. Skillnaden är
osynlig i en grön svit och beror på vem som körde kommandot.

**Exempel:** `prune-map-flag.mjs` löste roten som `process.env.CLAUDE_PROJECT_DIR ||
findRepoRoot(cwd)`. Två test injicerade en tillfällig katalog som `cwd`. Med variabeln satt — och
den sätts av flera verktyg i det här repot — blev roten det RIKTIGA repot: testet läste den skarpa
gitignorerade flaggan, släppte varje trigger mot en stubbad git, och `unlinkSync`:ade en äkta
arbetsorder som sidoeffekt av `npm test`. Provat i båda riktningarna: med den gamla formen och
variabeln satt föll 2 test OCH flaggan raderades på riktigt; efter fixen 19/19 gröna och flaggans
hash oförändrad. Gitignorerat tillstånd har ingen diff som kan visa förlusten.

### [Workflow] Rättelsen av ett granskningsfynd är buntens farligaste prosa (2026-09-02, BIN-1077/826/790)

**Trigger:** en granskare har hittat ett falskt påstående och du skriver om meningen.

**Regel:** stryk. Om en mening måste stå kvar, skriv den så att den inte kan gå fel — namnge
symbolen i stället för att räkna den, peka på biljetten i stället för att påstå var något står.
Och räkna med att rättelsen själv blir nästa varvs fynd tills du slutar formulera om.

**Exempel:** TRE gånger bar min egen rättelse ett nytt
falskt påstående: jag pekade ut fel tal som svaret på "hur länge räcker andrummet" och skrev sedan
i rättelsen att `refreshed` är komplementet till `evicted` (det är `retained`); jag strök ett wall-clock-tal ur `lefthook.yml` och lämnade en pekare i en
annan fil som pekade på talet som inte längre fanns; och jag strök ett påstående om ägarskap och
ersatte det med "utfallet står i avvikelseloggen", där `grep -c BIN-1080
.claude/rules/accepted-deviations.md` ger 0. Den formen som höll varje gång var densamma: peka på
biljetten, namnge parametrarna, ta bort kvantifikatorn.

### [Design] Nar bada de arliga svaren pa "ska filen granskas?" ar fel, granska en NYCKEL (2026-09-03, BIN-990)

**Trigger:** en fil som slar pa ett skydd, men som ocksa andras av skal som inte ror skyddet.

**Regel:** grinda nyckeln, inte sokvagen -- och bygg armen i VARJE grind som laser samma
konfig, inte bara den som fallde. `.claude/settings.json` registrerar granskningshookarna
och har tva toppnycklar, `permissions` och `hooks`. Att grinda hela sokvagen kostar en
granskarkorning per behorighetsandring; att lata bli lamnar hookarna avvapningsbara utan
vittne. `keyed` faller bara nar vardet vid en namngiven toppnyckel skiljer sig mellan de
tva sidor grinden jamfor.

**Fallan:** de tva sidorna ar OLIKA i olika grindar. Commit-grinden jamfor HEAD mot indexet;
push-grinden maste jamfora intervallets bas mot HEAD, sa commit-versionen gar inte att
ateranvanda ordagrant. Jag byggde bara commit-halvan; rollkritiken (#25) gjorde port till
push-grinden till ett villkor for att slappa den forsta. En ny matchartyp ar dessutom en
fjarde form av tyst drift for varje HANDKOPIERAD modell av hooken -- har tva test-mirrors -
och de uppraknande meningarna intill dem blir falska i samma commit.

**Bevis som holl:** stang av matcharen och rakna vilka fixturer som faller; tvinga den till
sant och rakna igen. Ny fil, raderad fil och oparsbar JSON ska ALLA falla.

### [Workflow] En fil kan ha BLANDADE radslut, sa ett ankare med radslut i sig matchar noll (2026-09-03, BIN-990)

**Trigger:** ett flerradigt sok-och-ersatt mot en fil du inte skrev sjalv.

**Regel:** normalisera bada sidor fore jamforelsen och skriv tillbaka filens egna radslut,
eller ankra pa EN rad utan radslut. `test/run-fixtures.mjs` har `
` pa en rad och `
` pa
nasta; ett fyrradigt ankare gav "0 traffar" tre forsok i rad medan `grep` visade raden.
Samma runda: `String.replace(a, b)` expanderar `$'` inne i `b` till "allt efter traffen" och
at slutet av ett regex -- anvand en funktionsersattare. Och ett radbrytningsescape skrivet
via en heredoc kollapsade till ett riktigt styrtecken FJARDE gangen; `String.fromCharCode(10)`
ar den enda form som haller.
