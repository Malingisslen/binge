---
name: stakeholder-review
description: Multi-stakeholder blind-critique review of a plan or changed fileset för Binges virtuella roll-org. Routar fram berörda roller via ownership-map, kör PARALLELLA BLINDA kritiker (varje roll från sin dossier + world-model, ser inte de andra), och en syntes som föreslår en rekommendation och eskalerar olösta high-stakes-konflikter till Malin. Skriver ADR. Rådger bara — agerar aldrig. Använd när användaren säger /stakeholder-review, "kör stakeholder review", "review this plan", eller före en riskabel plan.
---

# /stakeholder-review — blind-critique panel for a plan or fileset

Given a plan or a changed fileset, this routes to the affected role-stakeholders, runs
**parallel blind critiques** (each role from its own dossier + world-model, never seeing
the others), and a **synthesizer** reconciles them into one recommendation — escalating
any unresolved high-stakes conflict to Malin and filing an ADR for every disagreement.

**It advises; it never auto-acts.** No app-code edits, no commits of code. Documentation
output only (the recommendation + ADRs). Runs only when invoked interactively ($0 model).

Inputs: a plan (paste/describe it) or a fileset (`git diff --name-only` / staged paths).
Router data: `docs/org/ownership-map.json`. Dossiers: `docs/role-responsibilities.md`
+ `docs/org/world-watch/ROLE_WORLD_MODEL.md`. Rubric: `DESIGN.md` §1.2.

## Flow

### 1. Route → select stakeholders (blast-radius tier)
- Determine the **touched paths**: for a fileset, the paths themselves; for a plan,
  the files/areas it will create or change (infer from the plan text).
- Match each path against `ownership-map.json` patterns → owning role numbers.
- Apply the tier:
  - **Full panel** if it's a *plan*, OR any touched path is **high-stakes**:
    `firestore.rules`, `firestore.indexes.json`,
    `src/lib/firebase/{groups,userData,dataExport}.ts`, `functions/src/submitReport/`,
    `src/contexts/AuthContext.tsx`.
  - **Single stakeholder** if exactly one medium-impact feature area is touched.
  - **Skip** if trivial / doc-only (no owning role, or only Technical Writer #21) —
    say so and stop; don't burn tokens on a typo.
- **Cap the panel** at ~6 roles to keep cost sane: if more match, keep the highest-stakes
  (security/legal/privacy/data first, then the feature owners). List who you dropped.

### 2. Parallel BLIND critiques (one subagent per stakeholder)
Spawn the stakeholders **concurrently**, each blind to the others. Give each agent ONLY:
- its role dossier (its `## N` section of the role doc + its world-model block),
- its `ownedPaths` from the ownership map,
- the plan / fileset.

Each returns structured JSON: `{ role, verdict: approve|approve-with-conditions|object,
stake: high|medium|low, risks: [...], objections: [...], must_haves: [...],
one_line: "..." }`. Instruct them: critique from YOUR stake + world-model only; do not
rubber-stamp; if it's fine from your angle, say so plainly. **No round-robin** — they
never see each other. (Capped at one round; a second round only if the synthesizer says
a conflict is reconcilable with more info — default is one.)

### 3. Synthesize
One synthesizer agent receives all critiques + the plan. It produces:
- a single **recommendation** (proceed / proceed-with-conditions / revise / hold),
- the consolidated **must-haves** (union of blocking conditions),
- a **conflict table**: each genuine disagreement, the two stakes, and its resolution.

Resolve each conflict:
- **Unresolved + high-stakes** (a tier-1 user-safety or tier-2 legal/privacy stake in
  tension, or any conflict the synthesizer can't reconcile) → **escalate to Malin**: a
  clear yes/no question + the tradeoff + each role's stake. Do NOT decide it yourself.
- **Everything else** → the **Chief-Architect** resolves it by the priority rubric
  (`DESIGN.md` §1.2), naming the **deciding tier** (e.g. "tier 2 Legal beats tier 5 Cost").

### 4. Write ADRs
For **every disagreement** (resolved or escalated), write
`docs/org/adr/NNNN-kebab-title.md` from the template in `docs/org/adr/README.md`
(next monotonic NNNN; append-only). Update the README index line. No-conflict reviews
need no ADR (note that outcome instead).

### 5. Report (advise only)
Show Malin: the panel (with anyone dropped), the recommendation + must-haves, the
conflict table, and any **escalation question**. Then stop — the review never edits app
code, never commits code, never files tickets on its own.

## Hard rules
- **Blind**: critics get no shared context and never see each other. That's the whole
  anti-sycophancy point — round-robin chat is forbidden.
- **Advise only**: documentation output (recommendation + ADRs). Never touch `src/`,
  `functions/`, `firestore.rules`, tests, or config.
- **Escalate, don't overrule**: high-stakes (user-safety / legal / privacy) conflicts go
  to Malin, never to the Chief-Architect agent.
- **Cost-aware**: cap the panel; skip trivial; one round by default. If the panel would
  just rubber-stamp (all approve, no stakes in tension), say so — that's a cheap, valid
  outcome, not a reason to manufacture conflict.
- Cite the rubric tier in every rubric-resolved ADR.
