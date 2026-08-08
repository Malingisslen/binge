# Plan Review Checklist

Referenced by the `plan-review-gate` hook (workflow-guards plugin). Before presenting a
plan, verify each section — mark N/A where genuinely irrelevant.

1. **Scope & simplicity** — smallest change that solves the problem; no future-proofing;
   single-file fixes need no plan ceremony.
2. **Architecture fit** — follows this repo's existing patterns (components, contexts,
   lib helpers); reuses existing utilities instead of duplicating.
3. **Security & data** — auth flows, Firestore rules/indexes, PII handling named and
   reviewed if touched; no secrets in code.
4. **UI states** — loading / empty / error states specified for any new surface.
5. **Testing** — how the change is verified (test file(s), manual steps); tests assert
   intent, not implementation details.
6. **Edge cases** — offline, slow network, empty data, concurrent edits considered.
7. **Rollback** — how to undo if it misbehaves.
8. **Open questions** — blast-radius-ranked questions asked via AskUserQuestion with the
   answers folded in, or the explicit line "No architecture-changing unknowns" + assumptions.
9. **Plain-language summary** — a "What this means in plain language" section for the
   founder: what changes visibly, what could break, how easy to undo. No jargon.
