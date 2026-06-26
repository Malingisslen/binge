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

### 1.1 Deliberation — blind critique, not chat (Phase 2)
When a decision needs multiple roles, they do **parallel BLIND critique → synthesis**,
in capped rounds. No round-robin conversation: round-robin drifts toward sycophancy
(each agent softens to agree with the last) and costs more tokens for less signal.
Each stakeholder critiques independently without seeing the others; a synthesizer
merges. Rounds are capped (default 2) so it always terminates.

### 1.2 Authority — hybrid, with everything on the record (Phase 2)
- The **synthesizer** resolves most disagreements.
- Genuinely unresolved **high-stakes ties** escalate to the **human owner** (Malin).
- Everything else is ruled by a **"Chief Architect" agent** against a written
  priority order (below).
- **Every disagreement is filed as an ADR** (`docs/org/adr/`, MADR-style), so the
  reasoning is durable and auditable, not lost in a transcript.

**Written priority order** (ties broken top-down):
1. **Legal / privacy / security** — compliance is non-negotiable; a legal or security
   objection wins by default.
2. **Data integrity & user trust** — don't corrupt or leak user data; don't break the
   GDPR export/erasure contract.
3. **Cost ceiling** — stay under 25 SEK/mån; never silently add a paid service.
4. **Accessibility & correctness** — EAA conformance; tests prove intended behavior.
5. **Product value** — the streaming-availability killer feature and the advisor.
6. **Velocity / simplicity** — solo-maintainable; push-to-main; minimal surface.

### 1.3 Trigger — blast-radius tiered via a path→role router (Phase 2)
Reuse the commit-gate's path patterns
([`require-review-before-commit.ps1`](../../../.claude/hooks/require-review-before-commit.ps1))
as the router that maps a changed path → the owning role(s):
- **Full panel** — plans and high-stakes paths (`firestore.rules`, `functions/`,
  `src/lib/firebase/`, `AuthContext`, status-model files, anything legal/privacy).
- **One stakeholder** — medium-impact paths (a single `src/` feature area).
- **Skip** — trivial (docs typo, comment, test-only tweak in an isolated file).

The existing reviewer routing is the seed:

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

### 1.6 Dossier freshness — stamp-on-change + re-sweep
A **PostToolUse hook** stamps a role's dossier *stale* when one of its owned paths is
edited (the dossier no longer reflects the code). A scheduled (interactive) re-sweep
revisits stale dossiers. (Phase 2 — not built now; noted so the freshness contract is
explicit.)

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

---

## 3. Phase 2 — specced, NOT built in this pass

The deliberation + stakeholder-review system. Left intentionally unbuilt; this is the
spec for when it's picked up.

- **Path→role router** (§1.3) as a PreToolUse/commit-time component that, on a staged
  diff or a written plan, assembles the right panel (full / single / skip).
- **Blind-critique deliberation** (§1.1): N stakeholders critique in parallel without
  seeing each other → synthesizer merges → capped rounds.
- **Hybrid authority** (§1.2): synthesizer rules most; Chief-Architect agent rules by
  the written priority order; unresolved high-stakes ties → Malin; **every
  disagreement → an ADR** in `docs/org/adr/`.
- **Dossier-freshness PostToolUse hook** (§1.6): stamp a role's dossier stale when its
  owned paths change; interactive re-sweep of stale dossiers.
- **World-watch expansion**: grow `state.json` from 3 → 28 roles; the flag-only roles
  feed a weekly **digest** rather than individual tickets.

All of Phase 2 stays inside the $0/interactive envelope: panels and deliberation run
when the owner triggers a review, never headless.
