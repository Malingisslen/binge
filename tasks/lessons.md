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
