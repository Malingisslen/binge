# The virtual role-org — design & constitution

_How Binge's 28 notional roles (see [`role-responsibilities.md`](../../role-responsibilities.md)
+ the [world-model](./ROLE_WORLD_MODEL.md)) operate as a working org: who decides what,
when a role's watch fires, and what it's allowed to do about it._

This doc has three parts: the **constitution** (decided org-wide — build to it, don't
re-litigate), the **world-watch MVP spec** (what's built now), and **Phase 2** (the
deliberation/stakeholder-review system — specced here but **not built in this pass**).

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

### 1.3 Trigger — blast-radius tiered via a path→role router  ✅ BUILT (§2.6)
The router resolves a plan or changed fileset → owning role(s) via the committed
`docs/org/ownership-map.json` (generated from the role doc), with a **high-stakes path
list** layered on top:
- **Full panel** — plans, and any change touching high-stakes paths: `firestore.rules`,
  `firestore.indexes.json`, `src/lib/firebase/{groups,userData,dataExport}.ts`,
  `functions/src/submitReport/`, `src/contexts/AuthContext.tsx` (security rules, GDPR
  data, moderation, auth).
- **One stakeholder** — a single medium-impact feature area (one owning role).
- **Skip** — trivial / doc-only (no owning role, or only Technical Writer).

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
| SessionStart hook | [`.claude/hooks/world-watch-due.ps1`](../../../.claude/hooks/world-watch-due.ps1) | deterministic due-check; injects a reminder; **does no scanning** |
| `/world-watch` skill | [`.claude/skills/world-watch/SKILL.md`](../../../.claude/skills/world-watch/SKILL.md) | the actual poll → diff → impact-check → route → commit flow |
| Hook registration | [`.claude/settings.json`](../../../.claude/settings.json) | wires the SessionStart hook |

**Why state.json lives in `docs/org/` not `.claude/state/`:** `.claude/state/` is
fully gitignored (it holds ephemeral review markers). The world-watch state — sources,
snapshots, last-scan dates — must be *committed* so it survives across machines and
sessions and is auditable. The once-per-day **lock** is the only ephemeral piece, and
that goes in `.claude/state/` (gitignored).

### 2.2 The SessionStart hook (deterministic, fail-open)
`world-watch-due.ps1` runs on every session start. It:
1. Reads `state.json`.
2. For each MVP role, computes `due = (now − lastScan) ≥ cadence` (weekly=7d,
   monthly=30d, quarterly=90d; `lastScan: null` ⇒ due).
3. Applies a **once-per-day lock** (`.claude/state/world-watch-lastcheck`) so the
   reminder appears at most once per calendar day, never nagging within a day.
4. If anything is due, emits `additionalContext` (the SessionStart JSON contract)
   telling the session to run `/world-watch`.
5. **Fails open** — any error exits 0 with no output. A hook bug must never block a
   session, and it must never scan (no model calls, no network).

It mirrors the conventions of the existing hooks (`inject-checkpoint.ps1`,
`stop-check.ps1`): PowerShell, `$ErrorActionPreference='Stop'`, try/catch → `exit 0`,
repo-root via `git rev-parse`.

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
| Map generator (committed) | `docs/org/gen-ownership-map.mjs` | parses the role doc; run `node docs/org/gen-ownership-map.mjs` |
| PostToolUse hook (local) | `.claude/hooks/dossier-freshness.ps1` | edited path → match → stale marker per owning role |
| `/refresh-dossiers` skill (local) | `.claude/skills/refresh-dossiers/SKILL.md` | re-audit ONLY flagged roles, update their sections, clear markers |
| Stale markers (gitignored) | `.claude/state/dossier-stale/<roleNumber>.marker` | ships empty (all fresh) |

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
| `/stakeholder-review` skill (local) | `.claude/skills/stakeholder-review/SKILL.md` | router → parallel blind critics → synthesizer → escalate/decide → ADR |
| Router data (committed) | `docs/org/ownership-map.json` | plan/fileset → stakeholder roles |
| Priority rubric (committed) | this doc §1.2 | Chief-Architect tiebreak |
| ADRs (committed, append-only) | `docs/org/adr/NNNN-*.md` | one per disagreement |
| ExitPlanMode suggest-hook (local) | `.claude/hooks/exit-plan-suggest-review.ps1` | non-blocking suggestion on high-stakes plans |

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

**Decision on the auto-trigger:** wired, but **gated**. `exit-plan-suggest-review.ps1`
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

### 2.7 Measurement layer (does any of this earn its cost?)
`docs/org/metrics/` (committed): an append-only `events.jsonl`, a fail-open `log_event.mjs`
helper, and a README schema. Two gaps the artifacts can't see are instrumented — the
`/stakeholder-review` skill logs each `review` (so clean no-ADR approvals = the
**rubber-stamp rate**), and the ExitPlanMode hook logs each `trigger` firing (so
suggested-vs-ran **calibration** is measurable). World-watch + freshness are left
documented-optional (`state.json` + markers already cover them). The `/org-retro` skill
reads it all and scores Phase-2 value/rubber-stamp, trigger calibration, world-watch
signal-to-noise + source health, freshness accuracy, and cost/review — plus a **manual
false-negative spot-check** (the logs show what the system *did*, never what it *missed*).
Cadence: **shakedown** (~3–4 days, qualitative) then **full** (~3–4 weeks, quantitative),
both run interactively. See `docs/org/metrics/README.md`.

---

## 3. Rebuild local tooling (durability) — the most important fix

`.claude/` is gitignored here (all Claude harness config is local-only). That means the
world-watch + freshness + stakeholder-review glue — **three hooks, three skills**, and the
`settings.json` wiring — exists only on this machine. **Without this section, the system
silently does not exist on any other checkout.** So everything is split clean:

- **State / data → committed under `docs/`** (survives git): the world-model
  (`ROLE_WORLD_MODEL.md`), `state.json`, `ownership-map.json` + its generator, this
  `DESIGN.md`, and the role map. These are the source of truth.
- **Executable glue → local in `.claude/`** (gitignored), but **mirrored committed** at
  [`local-tooling/`](./local-tooling/) so it can be redeployed.

### What's gitignored, and where its committed source lives

| Gitignored (runs) | Committed source (survives git) |
|---|---|
| `.claude/hooks/world-watch-due.ps1` | `docs/org/world-watch/local-tooling/hooks/world-watch-due.ps1` |
| `.claude/hooks/dossier-freshness.ps1` | `docs/org/world-watch/local-tooling/hooks/dossier-freshness.ps1` |
| `.claude/hooks/exit-plan-suggest-review.ps1` | `docs/org/world-watch/local-tooling/hooks/exit-plan-suggest-review.ps1` |
| `.claude/hooks/org-retro-due-check.mjs` | `docs/org/world-watch/local-tooling/hooks/org-retro-due-check.mjs` |
| `.claude/skills/world-watch/SKILL.md` | `docs/org/world-watch/local-tooling/skills/world-watch/SKILL.md` |
| `.claude/skills/refresh-dossiers/SKILL.md` | `docs/org/world-watch/local-tooling/skills/refresh-dossiers/SKILL.md` |
| `.claude/skills/stakeholder-review/SKILL.md` | `docs/org/world-watch/local-tooling/skills/stakeholder-review/SKILL.md` |
| `.claude/skills/org-retro/SKILL.md` | `docs/org/world-watch/local-tooling/skills/org-retro/SKILL.md` |
| `.claude/settings.json` → `hooks` entries | `docs/org/world-watch/local-tooling/settings.hooks.json` |

The **measurement layer** (`docs/org/metrics/` — `events.jsonl`, `log_event.mjs`,
`retro-schedule.json`, README) is committed data + helper, **not** gitignored glue, so it
needs no mirror/rebuild. Only the `org-retro-due-check.mjs` hook that *reads* the schedule
is gitignored glue (mirrored above).

`state.json` and `ownership-map.json` already live committed under `docs/` — nothing to
rebuild there.

### Rebuild on a fresh checkout (from a Git Bash shell at the repo root)

```bash
# 1. deploy the hooks + skills into the gitignored .claude/ tree
mkdir -p .claude/hooks .claude/skills/world-watch .claude/skills/refresh-dossiers .claude/skills/stakeholder-review
cp docs/org/world-watch/local-tooling/hooks/* .claude/hooks/   # .ps1 + .mjs (org-retro-due-check)
cp docs/org/world-watch/local-tooling/skills/world-watch/SKILL.md .claude/skills/world-watch/
cp docs/org/world-watch/local-tooling/skills/refresh-dossiers/SKILL.md .claude/skills/refresh-dossiers/
cp docs/org/world-watch/local-tooling/skills/stakeholder-review/SKILL.md .claude/skills/stakeholder-review/
mkdir -p .claude/skills/org-retro && cp docs/org/world-watch/local-tooling/skills/org-retro/SKILL.md .claude/skills/org-retro/

# 2. wire the hooks: merge the two entries from settings.hooks.json into
#    .claude/settings.json -> "hooks". If that file doesn't exist, create it as
#    { "hooks": { ...the SessionStart + PostToolUse entries... } }. If a SessionStart
#    array already exists, APPEND the world-watch entry rather than replacing it.
cat docs/org/world-watch/local-tooling/settings.hooks.json

# 3. (re)generate the ownership map so it's honest to the current role doc
node docs/org/gen-ownership-map.mjs

# 4. restart the Claude session so settings.json is reloaded, then the SessionStart
#    hook will remind you when a world-watch scan is due.
```

The exact `settings.json` hook entries to merge (also in `settings.hooks.json`):

```json
"SessionStart": [
  { "matcher": "startup|resume", "hooks": [ { "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$CLAUDE_PROJECT_DIR\\.claude\\hooks\\world-watch-due.ps1\"" } ] },
  { "matcher": "startup|resume", "hooks": [ { "type": "command",
    "command": "node \"$CLAUDE_PROJECT_DIR\\.claude\\hooks\\org-retro-due-check.mjs\"" } ] }
],
"PostToolUse": [
  { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [ { "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$CLAUDE_PROJECT_DIR\\.claude\\hooks\\dossier-freshness.ps1\"" } ] }
],
"PreToolUse": [
  { "matcher": "ExitPlanMode", "hooks": [ { "type": "command",
    "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"$CLAUDE_PROJECT_DIR\\.claude\\hooks\\exit-plan-suggest-review.ps1\"" } ] }
]
```
(If `.claude/settings.json` already has a `PreToolUse` array — e.g. the commit-gate —
**append** this entry rather than replacing it.)

> **Canonical direction:** to *change* the tooling, edit the committed copy under
> `local-tooling/` and re-run step 1 to redeploy — that keeps the surviving copy
> authoritative and avoids drift between the two. (These are PowerShell + Windows
> paths, matching this repo's existing hooks; adapt the shell on another OS.)

---

## 4. Phase 2 — what was specced, and what's now built

The deliberation/stakeholder-review system that was specced here is now **built and
validated** (§2.6):
- ✅ **Path→role router** (§1.3) — via the committed `ownership-map.json` + high-stakes list.
- ✅ **Blind-critique deliberation** (§1.1) — parallel blind critics → synthesizer.
- ✅ **Hybrid authority** (§1.2) — synthesizer + Chief-Architect rubric; unresolved
  high-stakes ties → Malin; every disagreement → an ADR in `docs/org/adr/`.
- ✅ **Dossier-freshness loop** (§1.6, §2.5) — PostToolUse stale-marker + `/refresh-dossiers`.

**Still open (the genuine remainder):**
- **World-watch expansion**: grow `state.json` from 3 → 28 roles; the flag-only roles
  feed a weekly **digest** rather than individual tickets.
- **Capped second round**: the panel currently runs one blind round; a second
  (reconcile-with-more-info) round is specced (§2.6 step 2) but not yet exercised.
- **Router automation**: the router logic lives in the skill; it is not yet a
  standalone committed parser (the ExitPlanMode hook only *suggests*, it doesn't route).

Everything stays inside the $0/interactive envelope: panels and deliberation run when the
owner triggers a review, never headless.
