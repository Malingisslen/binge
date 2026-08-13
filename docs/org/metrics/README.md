# Role-org measurement layer

Does the virtual role-org actually *work*, or is it expensive theatre? This layer
measures it. `events.jsonl` is an append-only log; `/org-retro` (the live skill lives in
`C:/claude-plugins/plugins/role-org/skills/org-retro/` — the in-repo copy under
`../world-watch/local-tooling/` is an older fork, kept for reference, not what runs)
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

### `review` — a stakeholder-review run *(instrumented — this is the rubber-stamp signal)*

**Two writers emit this event, same schema:** `/stakeholder-review` (ad-hoc) and
`/sprint-execute` §2b (the sprint's pre-build panel). Both MUST use the canonical field
names below — do not improvise (`mustHaves`-array / free-form `outcome`-only payloads
drifted the shakedown data; the writers are now pinned to this contract).

| field | meaning |
|---|---|
| `tier` | `top` / `medium` / `skip` (what the router chose) |
| `panel` | array of role numbers convened (e.g. `[3,4,6,8,27]`) |
| `recommendation` | synthesizer verdict (`proceed` / `proceed-with-conditions` / `revise` / `hold`) |
| `must_haves` | **count** (integer) of consolidated conditions — NOT the array of strings |
| `conflicts` | count of genuine disagreements |
| `escalations` | count escalated to the human |
| `adrs` | ADR ids written (e.g. `["0001"]`) |
| `rubber_stamp` | **true** iff the panel approved with **no** conditions, conflicts, escalations, or ADRs (= it added nothing) |
| `approx_tokens` | rough subagent token total for the run |
| `plan` | one-line plan description |
| `ticket` | *(optional, sprint path)* the BIN-id under review |
| `ran` | *(optional)* `false` when no critique actually happened — see below. NOTE: `trigger` rows also carry a `ran` field, with a DIFFERENT meaning (`null` = "did a review follow? unknown"). One name, two meanings, in one log |
| `outcome` | *(optional)* free-form label (`approved-with-conditions`, `parked-conditional-block`, …) |
| `via` | *(optional)* which writer. FIVE values are live: `"sprint-execute"`, `"stakeholder-review"`, `"sprint-parallel"`, `"manual"`, `"attended-review-pass"`. Only the first is recognised as sprint-routed by `/org-retro` (it tests `via === "sprint-execute"` or a `ticket` field), so the other four land in the **ad-hoc** set and are expected to have a preceding `trigger`. See the `ran: false` note — 42 rows currently land there wrongly |

**Rows with `ran: false` are NOT reviews and must be excluded from every rate.** They exist
because a review that was OWED and refused has to leave a trace — a repo where nothing
sensitive was touched would otherwise look identical. The unattended sprint writes TWO
different outcomes, and the second is the alarming one:

- `outcome: "declined-unattended"` — the ticket was pulled OUT of the run before building.
  Nothing shipped.
- `outcome: "declined-unattended-shipped"` — the ticket was **built and committed with the
  review still owed** (the `panelPolicy: park` path). Code reached main unreviewed. Do not
  read the `ran: false` family as "nothing happened". *Zero rows in the log carry this
  today* — every one of the 41 sprint-written rows is the pulled-out variant. The writer
  exists (`sprint-execute-parallel.js`, the `panelOwed` branch), so the day the first one
  appears it should be legible as the different, worse thing it is.

A third, `"already-satisfied"`, is hand-written by an attended pass that found the review
had already run. All three are excluded by the same `ran !== false` filter.

Today they distort the rubber-stamp rate's **denominator** only — but they distort two
OTHER scores outright, and those have no bool protecting them. All 42 carry
`via: "sprint-parallel"` or `"attended-review-pass"` and no `ticket`, so `/org-retro`
classifies them as **ad-hoc** reviews that should each have had a preceding `trigger`:
42 of 71 non-`skip` ad-hoc reviews against 19 triggers (the fork's calibration one-liner
applies no tier filter and prints `adhoc 72` — the "excluding `tier:skip`" clause is
scoped to the rubber-stamp rate, not to calibration), which reads as the hook massively
under-firing when it is not. None carries `approx_tokens` (0 of 42), which drags the
cost-per-review down the same way. The ONE thing holding the rubber-stamp line is the
canonical `"rubber_stamp": false` every single one of them writes. Do not remove it. The
only executable analyzer that exists is the in-repo FORK's one-liner (the one this file's
opening paragraph calls "not what runs"), and it reads the bool first —
`typeof x.rubber_stamp === 'boolean' ? … : derive`. The live skill has no executable
rubber-stamp analyzer at all (it has a worked-example one-liner, but that one only counts
rows by type), so there the bool is what a reader applies by hand. Either way the
documented legacy derivation — zero conditions, no ADR, no conflicts or escalations, and
an `outcome` carrying no park/override/correction/ruling verb — scores **41 of these 42
rows as rubber-stamps**. Measured, not reasoned: `"declined-unattended"` contains none of
those verbs, and the rows carry `must_haves: 0`, `adrs: []`, `conflicts: 0`,
`escalations: 0`. Only the single `"already-satisfied"` row (`must_haves: 6`) comes back
false. So a future `ran: false` writer that forgets the bool would inflate the
**numerator** — declined reviews counted as panels that agreed with themselves — which is
a sharper reason for the `ran !== false` filter below than mere padding.

(The scorecard's headline definition, `outcome:approve AND conditions:0 AND adr:null AND
escalated:false`, is stated over the whole non-`skip` population rather than as the legacy
path, and by THAT reading none of these rows qualifies: 0 of 42 say `approve`. Three
readings, two answers — which is itself the argument for filtering them out explicitly
instead of relying on whichever one runs.)

What they do today is pad the population — **42 of 93 non-`skip` `review` rows are
`ran: false`**, of which 32 of 83 were already there at `5ea6c3f`. That pushes the headline
rubber-stamp rate DOWN, i.e. it flatters the panel: nearly half its "reviews" never sat.

> **The shipped scorecard does not filter them yet.** `/org-retro` defines the population
> in prose as "`review` events, excluding `tier:skip`" — there is no `ran` clause anywhere
> in the skill. Its only executable one-liner over `events.jsonl` is a worked example that
> groups rows by `x.type` and applies no tier filter at all. (The older in-repo fork's
> one-liner DOES filter `tier !== 'skip'` — it is the copy a reader is likeliest to paste,
> and it has no `ran` clause either.) The live skill lives in `C:/claude-plugins` and
> must not be edited from this repo (Malin, 2026-08-06), so this rule is prose the analyzer
> has never read. Tracked as BIN-881. Until it lands, read the rubber-stamp rate as a lower
> bound and filter `ran !== false` by hand.

Those rows also write `panel` as role-title STRINGS rather than the numbers this table
pins, and `tier` drifts the same way: the table pins the router's `top`/`medium`/`skip`,
but the log actually holds `single` 53, `full` 10, `medium` 21, `top` 8, `skip` 2 and one
row with none — the sprint engine writes its own `tierMap` values, and all 42 `ran: false`
rows are `single` (38) or `full` (4). Both drifts are pre-existing, and both are another
reason to exclude these rows rather than parse them. Do not trust either enum.


> **Legacy tolerance (pre-schema-fix events):** events written before the writer fix carry a
> `mustHaves` *array* + `outcome` string and no `rubber_stamp` bool. `/org-retro`'s analyzer
> derives the score for them (conditions = array length; rubber-stamp = zero conditions AND
> no ADR AND an `outcome` showing no park/override/correction/ruling), so history still
> scores. A legacy event with a `ticket` field is treated as sprint-routed for calibration.

### `trigger` — the ExitPlanMode suggest-hook fired *(instrumented — this is the calibration signal)*
| field | meaning |
|---|---|
| `signals` | the high-stakes tokens that matched in the plan |
| `suggested` | *documented, but ZERO rows carry it* — the live writer emits `fired: true` instead. Pre-existing drift, same class as `signals` |
| `signals` (shape) | documented above as the matched tokens; the live writer emits a comma-separated STRING, not an array — the fork's calibration one-liner does `(x.signals \|\| []).join(',')` on it, which THROWS `TypeError: (x.signals \|\| []).join is not a function` on the FIRST trigger row (run and confirmed 2026-08-13). The two summary lines print, then the per-trigger correlation loop — the whole point of that section — dies before emitting one line. The falsy branch is unreachable: no row carries an empty string |

> The hook can't know whether a review *actually ran* — `/org-retro` correlates `trigger`
> events with later `review` events (by time) to score calibration: suggested-and-ran vs
> suggested-and-ignored, and (via the manual spot-check) high-stakes plans that ran with
> no trigger at all.
>
> **Only ad-hoc plans fire this hook.** `/sprint-execute` convenes its panel internally
> (§2b) without going through ExitPlanMode, so sprint-routed reviews have **no** preceding
> `trigger` by design — `triggers:0` alongside all-sprint reviews is expected, not a broken
> hook. Calibration (over/under-firing) applies to the ad-hoc set only.

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
