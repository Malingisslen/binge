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

### 1. Route → resolve the blast radius, then pick a tier
- **Resolve the blast-radius fileset.** For a fileset, the paths themselves; for a plan,
  the files it will create/change (infer from the plan text) **plus their direct imports**
  (one hop — the files those touched files import, not the whole graph). This concrete
  fileset is what scopes critic reading in step 2 — there is no free repo exploration.
- **Run the committed router to get the tier + panel** (the single source of truth that
  `/linear` and `/sprint-execute` also use — don't hand-roll a second risk judgment):
  ```bash
  node docs/org/route.mjs <blast-radius paths>
  ```
  It returns `{ tier, panel, roles, highStakes, reason }` by matching the paths against
  `ownership-map.json` + the high-stakes list. Use its `tier` and `panel` directly; the
  manual rubric below is the explanation of *what it computes* (and your fallback if you're
  reviewing a pure plan whose paths you had to infer):
- **Pick the tier from the blast radius (NOT from "is it a plan"):**
  - **TOP → full panel.** Any blast-radius path is **high-stakes** —
    `firestore.rules`, `firestore.indexes.json`,
    `src/lib/firebase/{groups,userData,dataExport}.ts`, `functions/src/submitReport/`,
    `src/contexts/AuthContext.tsx` — **or** the change deletes/migrates user data or
    touches auth/security. Convene the panel, **capped at 3–5 roles** (below).
  - **MEDIUM → single stakeholder.** One medium-impact feature area, no high-stakes path:
    review with **just the one most-relevant owning role**. Don't convene five for a
    one-area change.
  - **SKIP** if trivial / doc-only (no owning role, or only Technical Writer #21) — say so
    and stop.
- **Cap the panel at 3–5 roles with GENUINE stake in the changed files** — not every
  nominally-adjacent role. A role earns a seat only if a blast-radius file is in its owned
  paths AND it has a distinct concern (security / legal-privacy / data-integrity / cost /
  ops). Drop roles whose only link is incidental; **list who you dropped and why.**

### 2. Parallel BLIND critiques (one subagent per stakeholder)
Spawn the stakeholders **concurrently**, each blind to the others. Give each agent ONLY:
- its role dossier (its `## N` section of the role doc + its world-model block),
- **the specific blast-radius files it owns** (the intersection of step-1's fileset with
  this role's owned paths) — an explicit path list,
- the plan / fileset.

**Scope its reading hard:** instruct each critic *"Read ONLY these listed files (and, if
strictly needed, a file one of them directly imports). Do NOT grep or explore the rest of
the repo."* This is for **sharpness and blast-radius hygiene**, not headline cost:
measured, bounding the reading cut tool-calls ~37% and made critiques *sharper* (close
reading of the exact files beats broad skimming), but it barely moved token count —
per-subagent overhead (~55–60k each) dominates when the blast-radius files are small.
**The real token-cost lever is the number of critics** (the tier + cap in step 1):
one reviewer for MEDIUM plans, ≤5 for TOP. So right-size the panel first; scope the
reading for quality. (For LARGE blast-radius filesets, bounded reading also prevents an
agent from runaway-exploring — that's when it saves real tokens too.)

Each returns structured JSON: `{ role, verdict: approve|approve-with-conditions|object,
stake: high|medium|low, risks: [...], objections: [...], must_haves: [...],
one_line: "..." }`. Instruct them: critique from YOUR stake + world-model only; do not
rubber-stamp; if it's fine from your angle, say so plainly. **No round-robin** — they
never see each other. (One round by default; a second only if the synthesizer says a
conflict is reconcilable with more info.)

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

### 6. Log the review (measurement — required)
Append one `review` event so the measurement layer can compute the **rubber-stamp rate**
(a clean approval with no conditions/ADR is the signal that the panel didn't earn its
cost). `rubber_stamp` is **true** iff there were **no** must-haves, conflicts,
escalations, or ADRs. Fire-and-forget (the helper fails open):
```bash
node docs/org/metrics/log_event.mjs review '{"tier":"top","panel":[3,4,6,8,27],"recommendation":"proceed-with-conditions","must_haves":10,"conflicts":3,"escalations":1,"adrs":["0001"],"rubber_stamp":false,"approx_tokens":355000,"plan":"activate dormant retention cleanup"}'
```
Fill the fields from this run (panel = role numbers convened; counts from the synthesis;
`approx_tokens` ≈ sum of subagent token usage). A **skip** (trivial/doc-only) logs
`{"tier":"skip","rubber_stamp":false,"plan":"..."}` so skips are visible too.

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
