# The virtual role-org — design & constitution

_How Binge's 28 notional roles (see [`role-responsibilities.md`](../../role-responsibilities.md)
+ the [world-model](./ROLE_WORLD_MODEL.md)) operate as a working org: who decides what,
when a role's watch fires, and what it's allowed to do about it._

> ## STATUS: BUILT & operating — last updated 2026-06-27
> This is no longer a forward spec; the role-org is live. Operating subsystems:
> - **World-watch** (§2.1–2.4) — SessionStart due-check + `/world-watch`; baseline ran for
>   the 3 MVP roles (Security/Legal/DPO) → tickets BIN-213–216.
> - **Dossier-freshness loop** (§1.6, §2.5) — PostToolUse stale-marker + `/refresh-dossiers`,
>   off the generated `ownership-map.json`. Verified live.
> - **Phase-2 stakeholder-review** (§1.1–1.3, §2.6) — path→role router, parallel blind panel,
>   synthesizer + priority rubric (§1.2), ADRs, and the gated ExitPlanMode suggest-hook.
>   Validated → ADR-0001.
> - **Standalone router** (§1.3, §2.8) — `docs/org/route.mjs`: the deterministic, committed
>   blast-radius parser (tier + panel) all three surfaces share. Closes the old §4 remainder.
> - **Default-ON expert review in ticket work** (§2.8) — `/linear` stamps owning specialists
>   into every created ticket; `/sprint-execute` routes each candidate and runs the blind
>   panel **before** building (opt out per-run with `--no-review`); the panel is advisory and
>   non-halting. `/linear backlog` was merged into `/sprint-execute --pick`.
> - **Measurement & tuning** (§2.7) — `events.jsonl` + `log_event.mjs`, review/trigger
>   instrumentation, `/org-retro`, and the self-clearing retro reminder.
>
> **Keep this doc current — nothing automates it.** The dossier-freshness loop tracks the
> role *map* against code, **not this design doc against the system's build state**. So when
> you add or change a subsystem, update the status line above **and** the relevant section in
> the same change. This doc is the one system surface nothing watches — that discipline is
> the fix. (`.claude/` is TRACKED since b20bf69, and the role-org skills ship from the
> `role-org` plugin rather than from this repo — see §3.)

This doc has four parts: the **constitution** (§1, decided org-wide — build to it, don't
re-litigate), the **built system** (§2 — world-watch, Phase-2 deliberation, and the
measurement layer, all live), **rebuild-from-docs durability** (§3), and the **genuine
remainder** (§4).

---

## 0. The cost model is the design constraint

Everything below is shaped by one rule: **$0, interactive-only.**

As of 2026-06-15, interactive Claude Code on Max is flat-rate. But **headless /
automated** use — GitHub Actions, scheduled `claude -p`, the SDK — draws a separate
metered credit and then bills at API rates. So:

> **Nothing in this org runs unattended.** The whole org runs *inside the owner's
> interactive sessions.* No cron, no CI job, no background daemon ever calls the model.

This isn't only a cost choice — it also deletes a class of risk: no long-lived
secrets for an automation to leak, no token rotation, no unattended-error blast
radius, no "the bot filed 40 bad tickets overnight." The human is always the clock
and the circuit-breaker.

Concretely, the machinery is split:
- **Deterministic, no-model parts** (a SessionStart hook that checks dates) run for
  free on every session start. They do arithmetic, never inference.
- **Model parts** (the `/world-watch` skill, any future deliberation) run only when
  the owner invokes them in an interactive session.

---

## 1. Constitution

### 1.1 Deliberation — blind critique, not chat  ✅ BUILT (§2.6)
When a decision needs multiple roles, they do **parallel BLIND critique → synthesis**,
in capped rounds. No round-robin conversation: round-robin drifts toward sycophancy
(each agent softens to agree with the last) and costs more tokens for less signal.
Each stakeholder critiques independently without seeing the others; a synthesizer
merges. Rounds are capped (default 2) so it always terminates.

### 1.2 Authority — hybrid, with everything on the record  ✅ BUILT (§2.6)
- The **synthesizer** resolves most disagreements.
- Genuinely unresolved **high-stakes ties** escalate to the **human owner** (Malin) as
  a clear yes/no question with the tradeoff + each role's stake.
- Everything else is ruled by a **"Chief Architect" agent** against the written
  priority order below.
- **Every disagreement is filed as an ADR** (`docs/org/adr/`, MADR-style), so the
  reasoning is durable and auditable, not lost in a transcript. The review **advises**;
  it never auto-acts.

#### The priority-order rubric — *this IS the politics, made explicit and revisable*

Ties are broken top-down. A higher tier beats every tier below it; the Chief-Architect
agent cites the **deciding tier** in the ADR. This order is a deliberate value
statement for Binge (a solo-built, GDPR-bound Swedish consumer app) — **edit it when
the priorities change**; the whole point is that it's written down rather than implicit
in whoever argues loudest.

| # | Tier | What it means for Binge | Beats… |
|---|---|---|---|
| 1 | **User safety & trust** | Don't harm or mislead users: moderation/abuse handling, spoiler safety, no dark patterns, honest UI. | everything |
| 2 | **Legal / privacy compliance** | GDPR (export/erasure/consent), DSA, EAA, TMDB/JustWatch terms. **Non-negotiable; always escalate-human.** | 3–7 |
| 3 | **Data integrity & security** | Don't corrupt or leak data; `firestore.rules` ownership + field whitelist; auth; no secret exposure. | 4–7 |
| 4 | **Correctness & accessibility** | Tests prove intended behavior (never weakened to go green); EAA AA conformance; no silent regressions. | 5–7 |
| 5 | **Cost ceiling** | Stay under 25 SEK/mån; respect cache tiers + lite queries; never silently add a paid service. | 6–7 |
| 6 | **Velocity & simplicity** | Solo-maintainable; push-to-main; minimal surface; ship the smallest thing that works. | 7 |
| 7 | **Aesthetics & polish** | Design-system niceties, nice-to-haves, refinements with no functional stake. | — |

Rationale for the ordering choices most likely to be questioned: **cost sits below
correctness** (tier 5 < 4) — Binge won't ship a *wrong* result to save a few öre, but
it also won't gold-plate past the 25 SEK cap; and **legal sits above security/data**
(tier 2 > 3) because a compliance breach is existential for a consumer app in the EU,
whereas most security/data issues are fixable defects. Tiers 2 and the user-safety
tier 1 are the only ones that route to **escalate-human** by default.

### 1.3 Trigger — blast-radius tiered via a path→role router  ✅ BUILT (§2.6, §2.8)
The router resolves a plan or changed fileset → owning role(s) via the committed
`docs/org/ownership-map.json` (generated from the role doc), with a **high-stakes path
list** layered on top. Since 2026-06-27 this logic is a committed, deterministic script —
**`docs/org/route.mjs`** (§2.8) — so `/stakeholder-review`, `/linear`, and
`/sprint-execute` all read the *same* tier/panel, with no drifting twin risk formula. The
high-stakes list + tier rules below are the spec; `route.mjs` is their executable form
(keep the two in sync):
- **Full panel** — plans, and any change touching high-stakes paths: `firestore.rules`,
  `firestore.indexes.json`, `src/lib/firebase/{groups,userData,dataExport}.ts`,
  `functions/src/submitReport/`, `src/contexts/AuthContext.tsx` (security rules, GDPR
  data, moderation, auth).
- **One stakeholder** — a single medium-impact feature area (one owning role).
- **Skip** — trivial / doc-only: only Technical Writer owns it, or the set holds no code
  at all (docs, plans, repo tooling under `scripts/`).

**The router does not clear itself (BIN-805, founder's call 2026-08-08).** `CODE_ROOTS`
mirrors the repo's own production globs, so `docs/` and `scripts/` are not code — which
meant `docs/org/route.mjs`, the file that decides who reviews everything else, routed
`skip`. Narrow exception, not a widening: `route.mjs`, its test, and the gate scripts
(`scripts/check-workflow-map.mjs` + its test) count as code; the rest of `docs/` and
`scripts/` routes exactly as before, so an ordinary helper-script tweak still pulls in no
reviewer. Because `docs/` belongs to Technical Writer #21, such a path IS owned — so the
tier now asks whether a *code* role owns it, and code owned only by #21 seats
**#14 Software Architect** under `reasonCode: "unmapped-code"` (field `unownedCode`).

**Unmapped ≠ trivial (BIN-788, 2026-08-06).** The ownership map enumerates files, so a
new file next to ten owned siblings used to match nothing and route `skip` — an unknown
blast radius reported as a cleared one. Two rules close that:
- ownership resolves **by directory** for code paths: owning a file in a directory owns
  that directory's other code files (the router reports these under `inherited`);
- a code path (`src/`, `functions/`, `extension/`, `shared/`, or a root config file) that
  *still* has no owner routes **one stakeholder**, seating **#14 Software Architect**, and
  names the path so the map gets fixed. Only non-code paths route `skip`.

Consumers that must tell the two apart read the router's `reasonCode`
(`high-stakes` / `owned` / `unmapped-code` / `doc-only` / `no-code-paths`), never the
prose in `reason`. The tier vocabulary is unchanged (`top` / `medium` / `skip`).

The role→path mapping (seeded from the reviewer routing, now generalized to all 28
roles via the ownership map):

| Path pattern | Owning role(s) |
|---|---|
| `firestore.rules`, `firestore.indexes.json`, `functions/`, `src/lib/firebase/`, `AuthContext`, `passwordStrength` | Security (4), DBA (27), DPO (6) |
| `src/**/*.tsx?` (non-test) | Architect (14) + the feature-area role |
| `*.test.tsx?`, `__tests__/`, `vitest.config` | QA (7) |
| `src/app/globals.css`, `tailwind.config.ts`, `src/components/ui/`, `src/components/layout/` | Designer (1), Accessibility (2) |
| `src/lib/tmdb/providers.ts`, `src/lib/libraries/` | Localization (11), Monetization (24) |
| `src/lib/recommendations/`, `src/lib/taste/`, `src/lib/advisor/` | Scoring (28) |
| `docs/`, `public/llms.txt` | Technical Writer (21) |

### 1.4 World-watch alerts — tiered by role authority
- **flag-only → digest.** Soft signals accumulate into a digest; no action taken.
- **auto-ticket → issue tracker.** Hard-deadline / ship-breaking roles file a Linear
  issue directly (project **Binge**).
- **escalate-human → ask the owner.** Anything interpretive — **all legal/privacy** —
  is surfaced to Malin with the source link, never actioned autonomously.

### 1.5 World-watch cadence — volatility-matched
- **weekly** — app-store-equivalent policy, CVEs, fast tooling (framework + Claude
  Code releases), the live Swedish streaming market.
- **monthly** — law, pricing, most tooling.
- **quarterly** — slow drift (design, IA, docs, brand).

### 1.6 Dossier freshness — stamp-on-change + re-sweep  ✅ BUILT
A **PostToolUse hook** stamps a role's dossier *stale* when one of its owned paths is
edited (the dossier no longer reflects the code); an interactive `/refresh-dossiers`
re-sweep re-audits **only** the flagged roles. Built — see §2.5. The ownership map that
powers it is generated from the role doc, never hand-maintained.

---

## 2. World-watch MVP — built now

Scope: the **three highest-stakes roles** from the map —
**Security Architect (4)**, **Legal / GDPR Counsel (5)**, **Data Protection Officer
(6)**. (Binge is a web app with no app store, so a Release/Store-Compliance role
doesn't apply; the canonical trio collapses to Legal + Privacy/DPO + Security.)

### 2.1 Artifacts

| Artifact | Path | Role |
|---|---|---|
| Committed state file | [`docs/org/world-watch/state.json`](./state.json) | per-role cadence, authority, verified sources, `lastScan`, `snapshot` |
| SessionStart hook | `C:/claude-plugins/plugins/role-org/scripts/world-watch-due.mjs` | deterministic due-check; injects a reminder; **does no scanning** |
| `/world-watch` skill | `role-org` plugin, `skills/world-watch/SKILL.md` | the actual poll → diff → impact-check → route → commit flow |
| Hook registration | `role-org` plugin, `hooks/hooks.json` | wires the SessionStart hook |

**Why state.json lives in `docs/org/` not `.claude/state/`:** `.claude/state/` is
fully gitignored (it holds ephemeral review markers). The world-watch state — sources,
snapshots, last-scan dates — must be *committed* so it survives across machines and
sessions and is auditable.

### 2.2 The SessionStart hook (deterministic, fail-open)
`world-watch-due.mjs` runs on every session start. It:
1. Reads `state.json`.
2. For each MVP role, computes `due = (now − lastScan) ≥ cadence` (weekly=7d,
   monthly=30d, quarterly=90d; `lastScan: null` ⇒ due).
3. Applies a **once-per-day lock** so the reminder appears at most once per calendar
   day, never nagging within a day.
4. If anything is due, emits `additionalContext` (the SessionStart JSON contract)
   telling the session to run `/world-watch`.
5. **Fails open** — any error exits 0 with no output. A hook bug must never block a
   session, and it must never scan (no model calls, no network).


### 2.3 The `/world-watch` skill (the only model-using part)
Invoked by the owner (prompted by the hook, or manually). Flow:
1. **Read** `state.json`; select due roles (or a role named in args).
2. **Cheap-poll** each due role's sources — prefer `.atom`/RSS/`incidents.json`;
   `WebFetch` the rest. Fetch each URL once even if several roles share it.
3. **Diff vs snapshot** — emit only **deltas** (new advisory, new release, new
   ruling). No delta ⇒ nothing happens for that source.
4. **Impact-check** each delta against the role's *owned paths / watch-items* from the
   role map — does this actually touch Binge? (e.g. a Next.js CVE only matters if it
   hits App Router / static export.)
5. **Route by authority:**
   - `auto-ticket` (Security) → create a Linear issue (project Binge) **after showing
     the candidate**; if the Linear MCP can't create, emit a ready-to-paste draft.
   - `escalate-human` (Legal, DPO) → present to Malin with the source link + concrete
     repo impact; **never** file or assert law without sign-off.
6. **Update** the role's `snapshot` + `lastScan`; **commit** `state.json`.

**Hard rules the skill obeys:** cite every source; never assert law/policy without a
link; never auto-*act* (only flag / ticket / escalate); the baseline run shows
candidates before writing anything to the tracker.

### 2.4 What the MVP deliberately does *not* do
- No scanning in the hook (cost + risk).
- No autonomous ticket creation on the *first* (baseline) run — owner approves first.
- No coverage of the other 25 roles yet — their world-model is documented and
  ready to graft into `state.json` when the MVP proves out.

### 2.5 Dossier-freshness loop (the role map stops drifting)
Separate from world-watch (which watches the *outside* world), this watches the *code*
so the role map doesn't silently drift as files change.

| Artifact | Path | Role |
|---|---|---|
| Ownership map (generated, committed) | `docs/org/ownership-map.json` | role → owned path patterns |
| Ownership-gap baseline (committed) | `docs/org/ownership-gaps.json` | unowned siblings in directories the map already enumerates file-by-file — the baseline the gap check ratchets against |
| Map generator (committed) | `docs/org/gen-ownership-map.mjs` | parses the role doc; `node docs/org/gen-ownership-map.mjs` writes the map and then grades the gaps — see below |
| PostToolUse hook | `.claude/hooks/freshness.mjs` (BIN-989 merged the freshness hooks) | edited path → match → stale marker per owning role |
| `/refresh-dossiers` skill | `role-org` plugin, `skills/refresh-dossiers/SKILL.md` | re-audit ONLY flagged roles, update their sections, clear markers |
| Stale markers (gitignored) | `.claude/state/dossier-stale/<roleNumber>.marker` | ships empty (all fresh) |


The generator is not a plain regeneration, and has not been since BIN-803. Read the exit
code:

- It writes `ownership-map.json` FIRST, then checks whether any tracked code file sits in
  a directory the map enumerates file-by-file with no role naming it, ratcheted against
  `ownership-gaps.json`. So a failing run has still updated the map — nothing is lost.
  Note the narrowness: a file in a directory the map does NOT enumerate never enters this
  computation at all, so the baseline is not a register of everything unowned. The
  generator's own header says so, and names the bigger uncovered hole (a brand-new
  unowned directory).
- **Exit 1** has two causes, and they need different remedies. A NEW unowned sibling
  appeared: that is a finding, not a crash — name the file under its owning role in
  `docs/role-responsibilities.md` and re-run. The baseline file is missing entirely:
  create it with `--update-gaps`. The script prints the right remedy for whichever case
  it hit, so read its output rather than guessing between them.
- `--update-gaps` re-baselines instead, and returns 0. Reach for it only when genuinely no
  role should own the file — baselining is how a gap becomes permanent.
- `--check` grades the COMMITTED map without writing anything.

The same check runs under `npm test`, which gates CI and the deploy, so skipping it here
only moves the failure later.

**Contract.** The hook only ever writes documentation-freshness markers — never touches
app code, never blocks, fails open. It skips the docs that *define* the system
(`.claude/`, `docs/org/`, the role doc itself) so the loop can't self-trigger. The
ownership map is **generated from `docs/role-responsibilities.md`** (28 roles, 149 path
patterns) so it stays honest to source; FS-validation drops non-paths (e.g. a
`/`-containing timezone like `Europe/Stockholm`). `/refresh-dossiers` re-audits **only**
the flagged roles — never all 28 — which is what keeps it cheap and interactive.

---

### 2.6 Stakeholder-review pipeline (Phase 2 deliberation — built + validated)
The blind-critique panel from §1.1–1.3, now built and validated.

| Artifact | Path | Role |
|---|---|---|
| `/stakeholder-review` skill | `role-org` plugin, `skills/stakeholder-review/SKILL.md` | router → parallel blind critics → synthesizer → escalate/decide → ADR |
| Router data (committed) | `docs/org/ownership-map.json` | plan/fileset → stakeholder roles |
| Priority rubric (committed) | this doc §1.2 | Chief-Architect tiebreak |
| ADRs (committed, append-only) | `docs/org/adr/NNNN-*.md` | one per disagreement |
| ExitPlanMode suggest-hook | `C:/claude-plugins/plugins/role-org/scripts/suggest-stakeholder-review.mjs` | non-blocking suggestion on high-stakes plans |

**Pipeline:** route to stakeholders (blast-radius tiered, panel capped ~6) → spawn one
subagent per role that critiques **blind** from its own dossier + world-model (never
seeing the others — this is the anti-sycophancy core) → a synthesizer reconciles into one
recommendation, resolving conflicts by the rubric and **escalating unresolved
high-stakes (tier-1/2) ties to Malin** → an ADR records every disagreement. **It advises;
it never auto-acts** (no code edits, no commits, no tickets).

#### Validation result (2026-06-27) — recorded in [ADR-0001](../adr/0001-deploy-retention-cleanup.md)
Ran the full pipeline on one genuine plan: *activate the dormant `retentionCleanup` +
`reclaimOrphanFollows` functions*. Five blind critics (DPO, Controller, DevOps, DBA,
Security) + a synthesizer.

- **Did debate beat a solo plan? Yes.** The blind panel surfaced things a single planner
  would likely miss: a **factual error in the plan itself** (it said sessions reap at
  `expiresAt + 7d`; the code reaps at `expiresAt`), a **GDPR transparency gap** (privacy
  policy silent on the 90-day notification retention) that became a clean human
  escalation, the **cost mechanism** (full-collection scans bill per-doc-scanned + Cloud
  Scheduler billable-job count against the 25 SEK cap), the **drift-recurrence history**
  (these exact functions were orphaned by deploy-drift once before), and a **security
  edge case** (`followedAt`-less follows aren't grace-protected). A "deploy as-is" plan
  became a 10-condition safe-activation plan + 1 escalation + 6 follow-ups.
- **Was it expensive *agreement*? No — it was productive *convergence*.** All five landed
  on "approve-with-conditions" (no hard veto), but the conditions materially changed the
  plan. Expensive agreement would be "approve, no notes" ×5; this was not that.
- **Cost:** ~355k tokens (5 source-reading critics + synthesizer). Free under
  $0/interactive; in API terms, justified *for a plan that deletes user data on a
  schedule*, but **wasteful if fired on every plan**. → the trigger must be **tiered**.

**Decision on the auto-trigger:** wired, but **gated**. `suggest-stakeholder-review.mjs`
scans a finalized plan for high-stakes signals (rules / GDPR-data / auth / functions /
moderation / destructive-data ops) and only then **suggests** `/stakeholder-review` —
non-blocking, never auto-running the panel. Low-risk plans get silence. This keeps the
expensive panel reserved for the plans where it pays for itself.

#### Cost re-validation (2026-06-27, scoped) — what actually drives the bill
Re-ran the same plan with critics **bounded to their blast-radius files** (no free repo
exploration), to cut the ~355k cost. Result, measured honestly:
- **Findings all survived and got *sharper*.** The three named findings held — the plan's
  factual error (now caught as *three* mismatched session numbers), the GDPR retention gap
  (sharpened: privacy policy says 180d, code enforces 90d), and the `followedAt`-null
  security edge (plus an honest "I can only see the predicate, not the caller" caveat).
  Close reading of the exact files beat broad skimming.
- **But scoping reading barely cut token cost: 301k → 299k critics (flat).** It cut
  *tool-calls* ~37% (27 → 17), but headline tokens are dominated by **fixed per-subagent
  overhead (~55–60k each)**, and the blast-radius files are small, so reading less of them
  saves little.
- **The real token-cost lever is the number of critics, not how much each reads.** The
  big win is the **tier gate**: a MEDIUM plan now convenes **one** reviewer (~60k) instead
  of five (~300k) — ~5× on the common case. Within a TOP-tier panel, the **cap** holds it
  at ≤5. (For this plan, the 3 *named* findings are carried by just DPO + Security ≈ 115k;
  the other three roles ≈ 185k buy the cost/ops/DR findings — real safety value for a
  data-deletion deploy, so they stay. Per the rubric, tier-3 data-integrity beats tier-5
  cost: don't trim a genuine stakeholder to save tokens.)
- **Conclusion:** keep the blast-radius scoping (sharper + bounds runaway exploration on
  *large* filesets), but the cost is controlled by **right-sizing the panel** (tier + cap),
  not by trimming reading. For a genuinely 5-stakeholder destructive-data plan, ~350k is
  the correct price; the savings live in not convening five for medium work. A further $
  lever (not token-count) is running critics on a cheaper model for routine reviews.

### 2.7 Measurement & tuning (BUILT 2026-06-27) — does any of this earn its cost?
`docs/org/metrics/` (committed): an append-only `events.jsonl`, a fail-open `log_event.mjs`
helper, a README schema (`docs/org/metrics/README.md`), and — since BIN-918, 2026-08-17 —
`check_events.mjs` + its test, which fail when a row claims the work reached main without
naming a `commit_sha` that exists and predates the row. That check exists because four rows
stamped 2026-08-16 asserted builds as accomplished fact in the sprint's SELECTION step,
before anything was built; they are retired by `correction` rows rather than edited.

**Two instrumented gaps** (the only ones the artifacts can't already see):
- `/stakeholder-review` logs each `review` event → clean no-condition/no-ADR approvals =
  the **rubber-stamp rate** (is the panel earning its tokens?).
- the ExitPlanMode suggest-hook logs each `trigger` firing → suggested-vs-actually-ran
  **calibration**.

World-watch + freshness are left **documented-optional** (`state.json` + the
`dossier-stale/` markers already record those).

**`/org-retro`** (skill; ships from the `role-org` plugin) reads the
log + ADRs + world-watch state + freshness markers and scores: Phase-2 value/rubber-stamp,
trigger calibration, world-watch signal-to-noise + source health, freshness accuracy, and
cost/review — plus a **manual false-negative spot-check** (the logs show what the system
*did*, never what it *missed*, so a human verifies one known external change actually
reached the system). Two modes: **shakedown** (~3–4 days, qualitative) and **full**
(~3–4 weeks, quantitative). Read-only; advises.

**Self-clearing retro reminder.** `docs/org/metrics/retro-schedule.json` (committed; goLive
2026-06-27, `shakedown@4d` + `full@28d`) plus a SessionStart hook `org-retro-due.mjs`
(Node — deterministic, fails open, once-per-day lock; ships from the `role-org` plugin)
nudge you to run
`/org-retro <mode>` once a window passes. It **self-clears**: a retro counts as done when a
`{"type":"retro","mode":"<mode>"}` event lands in `events.jsonl` (the skill logs it on each
run), so the reminder stops with no separate done-state — and it **survives a fresh
checkout** (the schedule is committed; the hook rebuilds via §3). Written in Node, not
PowerShell, so it runs in any shell rather than silently no-op'ing.

---

### 2.8 Default-ON expert review in ticket work (BUILT 2026-06-27)
Phase-2 review used to be opt-in (you ran `/stakeholder-review` by hand, or took the
ExitPlanMode hook's *suggestion*). As of 2026-06-27 the expert layer is the **baseline
posture for ticket work** — wired into the work-tracker commands so the right specialist
is assigned from ticket creation and review happens before code, silenced only on explicit
opt-out.

**The committed router (`docs/org/route.mjs`).** The §1.3 routing logic is now a
deterministic, committed Node script — no model call, no network, so it runs free inside
the $0/interactive envelope (§0). Given file paths (args or `git diff --name-only` on
stdin) it returns `{ tier, panel, roles, highStakes, reason }`. It is the single source of
truth for the tier; `--selftest` golden-checks it. This closes the §4 "router automation"
remainder.

**Where it's wired** (`/linear` + `/sprint-execute`, which ship from the `delivery`
plugin):
- **`/linear` (ticket creation)** — every `scan` / `scan night` / `ticket` runs the router
  on the finding's touched paths and stamps a `## Stakeholders` block (tier + owning roles)
  into the ticket body. The specialist is assigned the moment the ticket exists. `/linear`
  files only; it never convenes a panel itself.
- **`/sprint-execute` (build time)** — at selection it routes every candidate (tier +
  panel), then for each non-`skip` ticket runs the **blind panel before implementing**
  (§1.1/§2.6); the panel's must-haves fold into that ticket's acceptance criteria (or its
  parked plan) and are graded by the outcome verifier. The router tier is **the** risk
  signal — the old hand-rolled "blast radius × reversibility" score was removed.

**Why always-on is affordable.** Review depth is bounded by blast radius (§1.3): `skip`
(trivial/doc-only) runs no panel; `medium` draws **one** owning specialist (~60k tokens);
only `top` (high-stakes paths) convenes the capped 3–5 panel (~300k). The expensive case is
reserved for the changes where it pays for itself (§2.6 cost re-validation). Free under
$0/interactive; even in API terms the common case is one reviewer, not five.

**Opt-out — explicit and per-run.** `/sprint-execute --no-review` (or "skip the panel" in
natural language) skips convening the panel for that run only. Tickets are still routed and
tier-tagged; only the critique is suppressed. Caution is the default; lowering it is a
deliberate act, never the resting state.

**Non-halt rule (the autonomous loop never blocks).** The panel **advises; it never
auto-acts and never blocks the loop.** An unresolved high-stakes conflict (a hard objection
from Security #4 / DPO #6 / Legal #5, or any tier-1/2 tie the synthesizer can't reconcile)
does **not** call AskUserQuestion and does **not** halt — it **parks that ticket in
`In Review`** with the conflict + open question written out, notifies Malin, and the batch
moves on. **Exception:** in interactive `/sprint-execute --pick` mode Malin is present, so
the conflict **escalates to her live** instead of parking. This is the §1.2 authority rule
expressed for autonomous runs: high-stakes ties go to the human — synchronously when she's
here, as a parked ticket + notification when she's not.

**Command consolidation.** The old `/linear backlog` (browse → pick one → build) was merged
into **`/sprint-execute --pick`**, so interactive single-pick and autonomous batch share one
door and one route→review→verify→commit→close ceremony.

**Horizon-scan protection.** `/linear clean`'s stale sweep **excludes `[world-watch]`-titled
tickets** — they're filed by `/world-watch` on its own weekly/monthly/quarterly cadence and
may sit open legitimately; age is not drift for them.

---

## 3. Durability on a fresh checkout

**Rewritten 2026-08-26 (BIN-872).** This section used to describe a committed *mirror* of
the tooling at `docs/org/world-watch/local-tooling/`, and its whole premise was that
`.claude/` is gitignored. That has been false since `b20bf69` (2026-08-08), which
deliberately committed the harness config. The mirror was deleted in the same commit as
this rewrite; a copy that nobody redeploys from is a second source of truth that drifts.

Derive what is tracked rather than trusting a list here:

```
git ls-files .claude
```

### Where each piece actually lives now

- **State and data — committed under `docs/`, and the source of truth.** The world-model
  (`ROLE_WORLD_MODEL.md`), `state.json`, `ownership-map.json` and its generator,
  `ownership-gaps.json`, `route.mjs`, the role map, this `DESIGN.md`, and the whole
  measurement layer under `docs/org/metrics/`. Nothing here needs rebuilding — cloning the
  repo is the rebuild.
- **Repo-specific harness config — committed under `.claude/`.** Reviewer agents, rules,
  `shared-plugin.json`, settings and hooks. Also just cloned; `git ls-files .claude`
  enumerates it.
- **The role-org's runnable skills — a separate repo.** They ship from the `role-org`
  plugin under `C:/claude-plugins`, installed once per machine rather than copied per
  repo; the delivery commands ship the same way from `delivery`. List them with
  `ls C:/claude-plugins/plugins/*/skills`.

So the durability question this section exists to answer has a different shape than it did:
nothing in this repo needs a deploy step, and what does need installing is a plugin, not a
file copy. What survives a fresh clone is everything except the plugins.

### What that leaves genuinely at risk

The plugins are the part a fresh machine does not get for free, and this repo cannot fix
that from inside itself — `C:/claude-plugins` has its own gate and its own session. The
honest statement is that a checkout without them still builds, tests and deploys (those run
from `package.json` and `.github/workflows/`), but the role-org's review and sprint
machinery is absent until the plugins are installed.

**Do not re-create a mirror to solve that.** It is the same trade this section got wrong
once: a copy that is not the thing that runs tells you what someone intended, not what
happens, and the two separate every time either side changes.


---

## 4. Phase 2 — what was specced, and what's now built

The deliberation/stakeholder-review system that was specced here is now **built and
validated** (§2.6):
- ✅ **Path→role router** (§1.3) — via the committed `ownership-map.json` + high-stakes list.
- ✅ **Blind-critique deliberation** (§1.1) — parallel blind critics → synthesizer.
- ✅ **Hybrid authority** (§1.2) — synthesizer + Chief-Architect rubric; unresolved
  high-stakes ties → Malin; every disagreement → an ADR in `docs/org/adr/`.
- ✅ **Dossier-freshness loop** (§1.6, §2.5) — PostToolUse stale-marker + `/refresh-dossiers`.
- ✅ **Measurement & tuning** (§2.7) — event log, review/trigger instrumentation,
  `/org-retro` scorecard + false-negative spot-check, and the self-clearing retro reminder.

- ✅ **Router automation** (§2.8) — the router is now a standalone committed parser,
  `docs/org/route.mjs`, shared by `/stakeholder-review`, `/linear`, and `/sprint-execute`.
- ✅ **Default-ON ticket-work review** (§2.8) — routing + the blind panel are wired into
  the work-tracker commands as the baseline, opt-out via `--no-review`, non-halting.

**Still open (the genuine remainder):**
- **World-watch expansion**: grow `state.json` from 3 → 28 roles; the flag-only roles
  feed a weekly **digest** rather than individual tickets.
- **Capped second round**: the panel currently runs one blind round; a second
  (reconcile-with-more-info) round is specced (§2.6 step 2) but not yet exercised.
- **ExitPlanMode hook routing**: the suggest-hook still only *suggests* `/stakeholder-review`
  on high-stakes signals; it could now call `route.mjs` to name the tier/panel in its hint.

Everything stays inside the $0/interactive envelope: panels and deliberation run when the
owner triggers a review, never headless.
