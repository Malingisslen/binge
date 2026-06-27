# Role-org measurement layer

Does the virtual role-org actually *work*, or is it expensive theatre? This layer
measures it. `events.jsonl` is an append-only log; [`/org-retro`](../world-watch/local-tooling/skills/org-retro/SKILL.md)
reads it (plus the ADRs, world-watch `state.json`, and freshness markers) and scores the
system on its own terms.

## Files
- **`events.jsonl`** — append-only, one JSON object per line. Committed (it's data, not
  glue). Never rewrite past lines.
- **`log_event.mjs`** — the only writer. Stamps `ts` (ISO-UTC) + `type`, appends one line.
  **Fails open** — logging must never break a caller, so a broken log silently no-ops.

## Logging
```bash
node docs/org/metrics/log_event.mjs <type> '<json-payload>'
```
`<type>` ∈ `review | trigger | world-watch | freshness | retro`. The helper adds `ts`
and `type`; the payload carries the rest. Cross-platform (Node; `node` is already a repo
dependency). Callers wrap it so a failure is swallowed.

## Event schema

Every event has `ts` (ISO-UTC) + `type`. Type-specific fields:

### `review` — a `/stakeholder-review` run *(instrumented — this is the rubber-stamp signal)*
| field | meaning |
|---|---|
| `tier` | `top` / `medium` / `skip` (what the router chose) |
| `panel` | array of role numbers convened (e.g. `[3,4,6,8,27]`) |
| `recommendation` | synthesizer verdict (`proceed` / `proceed-with-conditions` / `revise` / `hold`) |
| `must_haves` | count of consolidated conditions |
| `conflicts` | count of genuine disagreements |
| `escalations` | count escalated to the human |
| `adrs` | ADR ids written (e.g. `["0001"]`) |
| `rubber_stamp` | **true** iff the panel approved with **no** conditions, conflicts, escalations, or ADRs (= it added nothing) |
| `approx_tokens` | rough subagent token total for the run |
| `plan` | one-line plan description |

### `trigger` — the ExitPlanMode suggest-hook fired *(instrumented — this is the calibration signal)*
| field | meaning |
|---|---|
| `signals` | the high-stakes tokens that matched in the plan |
| `suggested` | `true` (the hook only logs when it suggests) |

> The hook can't know whether a review *actually ran* — `/org-retro` correlates `trigger`
> events with later `review` events (by time) to score calibration: suggested-and-ran vs
> suggested-and-ignored, and (via the manual spot-check) high-stakes plans that ran with
> no trigger at all.

### `world-watch` — a `/world-watch` scan *(documented-optional)*
`state.json` already records `lastScan` + `snapshot` per role, so this is optional.
If logged: `{ roles_scanned, deltas, tickets, escalations }`.

### `freshness` — a `/refresh-dossiers` run *(documented-optional)*
The `.claude/state/dossier-stale/` markers already capture flag→clear, so this is
optional. If logged: `{ roles_flagged, roles_updated, drift_found }`.

### `retro` — an `/org-retro` run
`{ mode: "shakedown"|"full", summary: "...", scores: {...} }` — a snapshot of each run so
trends are visible across retros.

## Retro cadence

| Mode | When | Question | Method |
|---|---|---|---|
| **shakedown** | ~3–4 days after launch (**due ~2026-06-30/07-01**) | Is it wired and roughly calibrated? Anything obviously broken or noisy? | qualitative — read the handful of events, eyeball the ADRs, run the false-negative spot-check |
| **full** | ~3–4 weeks after launch (**due ~2026-07-18 to 07-25**) | Is it earning its cost? | quantitative — rubber-stamp rate, trigger calibration, world-watch signal-to-noise + source health, freshness accuracy, cost/review |

Both run **interactively** (`/org-retro shakedown` / `/org-retro full`) — never headless
($0 model). The cadence is **automated as a reminder, not a scheduler**:
`retro-schedule.json` (goLive + per-mode `afterDays`) drives a SessionStart hook
(`org-retro-due-check.mjs`) that nudges you once a window passes. It **self-clears** — a
mode counts as done when a `{"type":"retro","mode":"<mode>"}` event lands here (the skill
logs it), so the nudge stops until the next window. The hook only reminds; you run the
retro.

## What `/org-retro` scores
- **Phase-2 value + rubber-stamp rate** — share of `review`s that were `rubber_stamp:true`.
  A high rate means the panel isn't earning its tokens (tighten the trigger / cap).
- **Trigger calibration** — `trigger`s that led to a `review` vs were ignored; plus the
  manual check for high-stakes plans that ran with **no** trigger (under-firing).
- **World-watch signal-to-noise + source health** — deltas that became tickets vs noise;
  dead/redirected/bot-blocked sources from the role world-model.
- **Freshness accuracy** — did a flagged dossier actually contain drift a review caught?
- **Cost/review** — `approx_tokens` per review; trend over time.
- **Manual false-negative spot-check** — pick ONE known recent external change (a real
  CVE / law / release) and verify it actually reached the system (a ticket/escalation
  exists). The logs show what the system *did*, never what it *missed* — only a human
  probe can find a miss.
