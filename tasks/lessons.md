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
