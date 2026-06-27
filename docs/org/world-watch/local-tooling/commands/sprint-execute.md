---
description: Autonomous sprint — select Linear tickets, implement, verify, ship to main
---

# /sprint-execute — Binge autonomous sprint

Select a batch of Linear tickets and implement them in one run, shipping straight to
`main`. Binge is a **solo, push-direct-to-main** workflow — no PRs, no feature
branches (the exception: a genuinely risky migration, which gets a plan parked in
In Review instead). `deploy.yml` deploys hosting on push to main, so **pushing IS
deploying** — treat the push as a release.

`$ARGUMENTS` (optional) narrows selection: an area label, a type, a count, or
specific issue ids. No args → auto-select a sensible batch.

**Flags / modes:**
- `--pick` — **interactive single/few-ticket mode** (replaces the old `/linear backlog`):
  show the backlog grouped by type/area/effort **+ owning specialist**, you pick one (or
  a few), then run the full route → review → verify → commit → close ceremony on them.
  Because you're present, high-stakes panel conflicts **escalate to you live** instead of
  parking (see §2b).
- `--no-review` — **opt out of the stakeholder panel for this run only.** Caution is the
  baseline; lowering it is a deliberate per-run act. Also honoured in natural language
  ("skip the panel", "no review this time"). It does NOT disable routing/tiering — tickets
  are still tier-tagged — it only skips *convening the panel*. Never the default.

**The expert review layer is ON by default.** Every non-trivial ticket is routed and gets
a blind stakeholder critique *before* it's built; its conditions become binding acceptance
criteria. This is bounded by blast radius (see §1 routing) so it's affordable: trivial
tickets are skipped, ordinary tickets draw one owning specialist, only genuinely
high-stakes tickets convene the full panel.

## Prerequisites

1. Linear MCP connected (else STOP, tell user to run `/mcp`).
2. Clean working tree (`git status`). If dirty, STOP and report — never mix
   uncommitted local work into a sprint.
3. On `main` and up to date (the `/commit` skill handles pull/rebase if main moved).

## 1 — Selection

> **⚠️ Shared team.** The `Binge` team also hosts the separate **Synat** project.
> Select ONLY with `list_issues project:"Binge"` — never by team, or you'll pull and
> ship Synat's tickets. Implement only inside the Binge repo (`C:\binge`).

1. Fetch open `Backlog`/`Todo` tickets with `list_issues project:"Binge"`.
2. **Exclude** anything labelled `onboarding-reserved` (capstone — manuell) or
   `launch-gated` (deferred to launch).
3. Priority-score: `Urgent` > `High` > `Medium` > `Low`, tie-break by area blind-spot
   and small-effort-first.

   **`--pick` (interactive mode):** instead of auto-selecting, present the candidates
   **grouped by type / area / effort (XS/S/M/L) + owning specialist** (the routed role
   from step 5 — show its number+title), let Malin pick one or a few, and run the rest of
   the ceremony on just those. This is the merged-in `/linear backlog`: same route →
   review → verify → commit → close flow, single-pick scale. In `--pick` mode the user is
   present, so high-stakes panel conflicts **escalate live** (§2b) rather than parking.

4. **Classify EACH candidate into an autonomy tier:**

   | Tier | What | Outcome |
   |---|---|---|
   | **A — full-auto** | Logic / data / hooks / lib / refactor / test with a clear acceptance test. No user-visible surface change, or change is fully test-covered. | Implement → verify → **Done** |
   | **B — UI-visual** | Anything with a user-visible surface (components, pages, design tokens, copy). | Implement → screenshot/preview → park in **In Review** + notify. Don't auto-close — Malin signs off visuals. |
   | **C — large/risky refactor** | Cross-cutting change, data migration, Firestore-rules change, schema/status-model change. | Write a plan → park in **In Review** + notify. Don't implement unprompted. |
   | **D — ops-blocked** | Needs credentials / external access (Firebase Console, Cloudflare, TMDB key, App Store, secrets, manual `firebase deploy` of rules/functions). | Flag, don't attempt. |

   Binge-specific tier hints: changes touching `firestore.rules`, `functions/**`, the
   watch-status model (`src/lib/watchStatus*`), or Firestore migrations are **C** by
   default. Anything needing a rules/functions deploy (which `deploy.yml` does NOT
   do) is **D** for the deploy step even if the code is Tier A.

   > **Two orthogonal axes — don't conflate them.** The A–D **autonomy tier** decides how
   > a result *ships* (Done vs In Review vs flag). The **review tier** (next step) decides
   > how much expert *critique* happens before building. A ticket can be Tier A (safe to
   > auto-ship) yet route TOP (needs the full panel first), or Tier C (parked) yet route
   > MEDIUM. The router TOP tier is also a strong signal a ticket is really C/risky — if
   > the router says TOP, treat the autonomy tier as **at least C** unless you can justify
   > otherwise.

5. **Route EACH candidate for review (the single risk signal):**
   ```bash
   node docs/org/route.mjs <touched paths>      # the files the ticket will change (from its body)
   ```
   Record each ticket's **review tier** (`top` / `medium` / `skip`) and **panel** (owning
   role numbers) from the JSON. This is the ONE source of truth for risk — the same router
   `/linear` stamps with and `/stakeholder-review` convenes from. **Do not compute a
   separate risk score.**
   - `top` → full blind panel before building (§2b), capped 3–5.
   - `medium` → one owning specialist critiques before building (§2b).
   - `skip` → trivial / doc-only; no panel, build directly.

   If a ticket already carries a `## Stakeholders` block (stamped at creation by
   `/linear`), reuse its tier/panel — only re-route if the touched files changed since.

6. **Acceptance criteria** — write **2–4 gradeable criteria per selected ticket now**.
   These are the rubric the run is graded against later (not "does it build" — real
   behavioural checks, e.g. *"a TV series with no progress shows under 'ej påbörjad'
   on /my/series"*). The stakeholder panel's **must-haves (§2b) are folded into these**
   as additional binding criteria, so the outcome verifier (§4) grades them too.

## 2 — Risk-gated plan mode (driven by the router tier)

> **Order of operations per ticket:** route (§1.5) → **panel critique (§2b)** → risk-gate
> (this section) → execute (§3). The panel runs *before* the gate decides build-vs-park, so
> its must-haves feed whichever artifact results.

The router tier from §1.5 **is** the risk signal — no separate "blast radius ×
reversibility" score. A ticket that routes **TOP**, or is autonomy-Tier C (anything
touching rules / migrations / status-model), gets an explicit **plan step written and
parked before any code** — it does not execute in this run; its plan goes to In Review for
sign-off (a risky migration is the CLAUDE.md exception that needs a written plan first).
**The panel's must-haves (§2b) are written into that parked plan** (not just acceptance
criteria), so the human sign-off sees the expert conditions. Tickets that are *not*
gate-parked (medium tier, or a TOP route that's genuinely Tier-A and fully test-covered)
fold the must-haves into acceptance criteria and proceed to build.

## 2b — Stakeholder review BEFORE building (default ON)

For every selected ticket that routes `top` or `medium` (i.e. not `skip`), run a blind
stakeholder critique **before implementing it**, per `/stakeholder-review`:

1. **Convene the routed panel** (§1.5): spawn one subagent per panel role, each blind to
   the others, each given only its dossier (`docs/role-responsibilities.md §N` +
   `docs/org/world-watch/ROLE_WORLD_MODEL.md`) + the ticket + the specific blast-radius
   files it owns. `medium` = the one owning role; `top` = the capped 3–5 panel.
2. **Synthesize** → consolidated **must-haves** + a conflict table, resolving by the
   priority rubric (`DESIGN.md §1.2`). **Fold the must-haves into the ticket's acceptance
   criteria** (§1.6) so they become binding and get graded by the verifier (§4).
3. **Log** the review event (`node docs/org/metrics/log_event.mjs review '{…}'`) and write
   an ADR for any disagreement (`docs/org/adr/NNNN-*.md`) — same as `/stakeholder-review`.

**`--no-review` (or "skip the panel" in natural language):** skips step 2b entirely for
this run. Tickets are still routed and tier-tagged, but no panel convenes and no
must-haves are added. Caution is the baseline — this is a deliberate, per-run downgrade.

### Non-halt rule (the autonomous loop must never block)

The panel is **advisory** and must **never** stop the sprint:

- A panel that approves / approves-with-conditions → fold conditions in, **build**.
- An **unresolved high-stakes conflict** — a hard objection from a high-stakes role
  (Security #4 / DPO #6 / Legal #5), or any tier-1/2 (user-safety / legal-privacy)
  conflict the synthesizer can't reconcile — does **NOT** call `AskUserQuestion` and does
  **NOT** halt the loop. Instead: **park that ticket in `In Review`** with the conflict
  written into the ticket (the objection, the stakes, the open question), notify Malin,
  and **move on to the next ticket**. One parked ticket never stalls the batch.
- **EXCEPTION — interactive `--pick` mode:** Malin is present, so escalate the conflict to
  her **live** (`AskUserQuestion` is fine here) and act on her answer, rather than parking.

This mirrors the constitution: the review advises, it never auto-acts and never blocks;
unresolved high-stakes ties go to the human — synchronously when she's here, as a parked
In-Review ticket + notification when she's not.

## 3 — Execution (per ticket)

- **Step 0 (mandatory):** re-read the current code for the ticket's target and
  classify it **fits / premise-gone / plan-stale**. Current code trumps ticket text —
  if the bug was already fixed or the premise moved, close the ticket with a note
  instead of implementing. (Binge uses lazy migrations and derived TV sub-states —
  a ticket written weeks ago may describe a state the code no longer has.)
- Implement following repo conventions (see `CLAUDE.md`: design tokens not hex,
  `danger` token not raw red, `PageHeader`/`LoadingView`/`EmptyState` recipe, Swedish
  UI, no `next/image`, shared `TMDB_STALE` constants, lazy `fsdb()` Firestore access).
- **Batch small related tickets** in the same area into one coherent change.
- When delegating to agents, **scope them to explicit files/dirs** and cap fan-out —
  never an unscoped tree walk (the working copy has `node_modules`, `.next`, `out/`,
  and a ~25k-file `.tmdb-cache/`).

## 4 — Outcome verification

With a **fresh-context verifier subagent**, grade each result against its acceptance
criteria — behaviour, not just compilation. A ticket that builds but misses a
criterion is **not** done; fix or re-open.

## 5 — Post-sprint

1. Run the stack gates and confirm green **before** committing:
   `npm run lint` · `npm run typecheck` · `npm test` · `npm run build`
   (and `npm run test:rules` if `firestore.rules` changed — needs Java on PATH).
2. Commit + push to `main` via the `/commit` skill (handles pull/rebase, push,
   Cloudflare purge). Pushing to main deploys hosting via `deploy.yml`.
3. Move tickets: **Tier A → Done**; **Tier B / C → In Review** (with screenshot or
   plan attached) and notify Malin. **Panel-parked tickets** (non-halt rule, §2b) → also
   **In Review**, with the unresolved high-stakes conflict written into the ticket +
   notification — clearly distinct from "done" or "ready visual review".
4. Update `.claude/linear-tracker.json` (`issues` map, `lastIssueId`).

## 6 — Follow-up rule

Any scope you deferred mid-sprint (a sub-fix you punted, an edge case you noticed)
becomes a **new Linear ticket** via the `/linear ticket` path. Nothing silently
vanishes.

## Commit gate

Commits are gated by `.claude/hooks/require-review-before-commit.ps1` — the relevant
reviewer markers (code-review / security / test) must be fresh for the staged diff or
the commit is blocked. Run the reviewers before the commit step, don't fight the gate.
