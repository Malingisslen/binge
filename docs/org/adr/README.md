# Architecture Decision Records (ADRs)

Append-only, dated records of decisions made by the **stakeholder-review** pipeline
(see [`../world-watch/DESIGN.md`](../world-watch/DESIGN.md) §1.2 + §2.6). Every
disagreement the panel surfaces — whether the Chief-Architect agent resolved it by the
priority rubric or it escalated to Malin — becomes one file here.

The review **advises**; an ADR records *what was decided and why*, not an action taken.

## Convention
- One file per decision: `NNNN-kebab-title.md` (zero-padded, monotonic).
- **Append-only.** Don't rewrite a past ADR; if a decision is reversed, write a new ADR
  that supersedes it and update the old one's `Status` to `Superseded by NNNN`.
- Use the template below. Keep it short — the value is the *record*, not prose.

## Template

```markdown
# NNNN. <Decision title>

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Escalated-to-human | Superseded by NNNN
- **Trigger:** <plan or changed fileset that prompted the review>
- **Stakeholders (panel):** <roles consulted, with their verdicts>

## Context
<The decision at hand and the genuine tension between stakeholders.>

## Conflict
<The specific disagreement: role A wants X (stake), role B wants Y (stake).>

## Decision
<What was decided. If resolved by the rubric, name the **deciding tier**
(e.g. "tier 2 Legal beats tier 5 Cost"). If escalated, state the yes/no question
put to Malin and her answer.>

## Consequences
<What follows — must-haves, conditions, follow-up tickets. The review advises only.>

## Decided by
<Chief-Architect agent (rubric tier N) | Human owner (Malin) | Synthesizer (no conflict)>
```

## Index
- [0001](0001-deploy-retention-cleanup.md) — Deploy dormant retentionCleanup + reclaimOrphanFollows (validation run)
