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
- **`log_event.mjs`** — the only IN-REPO writer helper. Stamps `ts` (ISO-UTC) + `type`,
  appends one line. **Fails open** — logging must never break a caller, so a broken log
  silently no-ops. **Corrected 2026-08-17 (BIN-918):** this line said "the only writer",
  and that is not true. `sprint-execute-parallel.js` and `suggest-stakeholder-review.mjs`
  (both in `C:/claude-plugins`) append to `events.jsonl` directly and never call it —
  including the four rows the `correction` section below exists for. TWO live callers do
  use it: `.claude/shared-plugin.json` → `delivery.metrics.logReviewCommand` for `review`
  rows, and the `/org-retro` skill for its `retro` row (all three `retro` rows in
  `events.jsonl` — 1, 25 and 26 — were written THROUGH the helper; only row 25's `shakedown`
  is a mode that skill emits today, so "through the helper" is the claim, not "by the skill"). The four copies under `docs/org/world-watch/local-tooling/` are dead
  mirrors, not running code. Read any statement about "the writer" with that in mind.
  **Second correction, same day:** the first version of this note said `logReviewCommand`
  was the ONE caller. That was asserted, not measured, and `/org-retro` disproves it — a
  helper with a single caller hardcoding `review` would never need the SIX-type enum this
  very commit widens. (It said "seven-type" for one round. The enum is
  `review | trigger | world-watch | freshness | retro | correction` — five before this diff,
  six after. A miscount inside the sentence recording a previous miscount; twelfth
  integration pass.)
- **`check_events.mjs`** + its test — fails when a row claims the work reached main without
  naming evidence for it. See the BIN-918 section below for what a clean run does and does
  not prove.

## Logging
```bash
node docs/org/metrics/log_event.mjs <type> '<json-payload>'
```
`<type>` ∈ `review | trigger | world-watch | freshness | retro | correction`. The helper adds `ts`
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

### A row's prose is not authoritative on its own (BIN-918, 2026-08-17)

**Before trusting what a `review` row says, look for a later `correction` event.** The log is
append-only, so a false row is never edited — it is retired by a row of type `correction`
carrying `corrects: {ts, ticket}`. A reader going chronologically hits the false row FIRST
and has no signal in it that a correction exists further down. This paragraph is that signal.

Four rows stamped `2026-08-16T13:53:30.297Z` are corrected this way. They were written in the
unattended sprint's SELECTION step — before anything was built — but phrased in the past
tense ("BIN-880 — BUILT and committed"). Three of the four became true later that afternoon —
BIN-908 in `049f21b` at 14:32:45Z (39 minutes after the row), BIN-880 and BIN-906 in
`851696d` at 15:25:30Z (92 minutes after it); the
fourth, BIN-909, was never built at all. All four share a **byte-identical `ts`** and carry no
`ticket` field, which is exactly why the correction key is `{ts, ticket}` and never `ts`
alone, and never `commit_sha` — the row most needing correction is the one with no commit.

**Two new fields:**

| field | meaning |
| --- | --- |
| `commit_sha` | *(required on any **`review`** row claiming the work reached main)* the commit that is the evidence for that claim. Scoped to `review` rows because that is what `check_events.mjs` examines — the four `correction` rows below name commits in their prose and carry no `commit_sha`, and one of them (BIN-909) never can, since the work was never built |
| `corrects` | *(on `type: "correction"` rows)* `{ts, ticket}` of the row being retired |

**Tense rule for writers:** a row written before the build is written in the PRESENT
("review declined, outcome unknown"). The past tense belongs to whoever holds the commit sha
and writes it into `commit_sha`. Be aware this is a spec for a writer that does not read it:
the sprint engine lives in `C:/claude-plugins`, must not be edited from this repo (Malin,
2026-08-06), and nothing here stops it writing another past-tense row tomorrow.

**What `node docs/org/metrics/check_events.mjs` does and does not prove.** A clean run means
no unevidenced claim **stands** — which is weaker than "every claim is evidenced", and the
run prints the breakdown so the two cannot be confused. A claim stops standing in four
different ways: it names a `commit_sha` that exists and is not newer than the row
(*evidenced*); a later `correction` retires it (*retracted, not verified*); it predates
`RULE_EFFECTIVE_FROM` (*grandfathered*); or the checkout is shallow and the sha cannot be
resolved at all (*unverified* — see below). At the bytes shipping with this section the live
file scores **0 evidenced, 4 retired, 1 grandfathered**: no row in the log carries a
`commit_sha` yet, so a reader who took "clean" as "verified" would have it exactly backwards.

It does **NOT** verify that the named commit actually contains that ticket's work — a
real sha cited for the wrong ticket, or a docs-only commit cited for a code claim, is
invisible to it. That is deliberate: the first attempt at this check tried to close that gap
by matching commit SUBJECT LINES and certified a docs commit for a code claim, so this
version refuses the inference and discloses where verification stops instead of guessing.
**It blocks no commit — but it does gate the deploy, and that is worth knowing before the
first one fires.** `check_events.test.mjs` asserts the LIVE `events.jsonl`, and `npm test` is
a blocking step in `deploy.yml` and `preview.yml` (and runs without `continue-on-error` in
`ci.yml`). Nothing here stops the sprint engine writing another past-tense
`declined-unattended-shipped` row tomorrow, so the next one turns CI red and holds the
production hosting deploy of unrelated code until someone appends a `correction`. That is a
deliberate trade — the row means unreviewed code reached main, which is worth stopping for —
but the remedy must be obvious to whoever meets it at 2am: **append a `correction` row keyed
on `{ts, ticket}`, or add the `commit_sha` the claim is missing.** If this proves too blunt,
the fix is to move the live-file assertion into a CLI-only check rather than to weaken the
rule.

**And that escape hatch has a TRIGGER, so it does not need re-arguing.** Binding condition
C2 from #25 Engineering Manager / Release Manager's blind critique, 2026-08-17: *the first
time this assertion reddens `deploy.yml` or `preview.yml` for a commit unrelated to the
flagged ticket, it converts to a CLI-only check on the next commit that touches it — not
re-litigated as a fresh decision.* Whoever meets it at 2am inherits a made decision, not an
open question. Until that happens the live-file assertion stays: a false row means unreviewed
code reached main, which is worth stopping for.

**Where you will actually meet it first, which is NOT in CI.** The engine's own prompt says
"Do not commit and do not stage" for these rows, and `.claude/shared-plugin.json` lists
`docs/org/metrics/events\.jsonl$` in `delivery.cleanTreeIgnore`, so the sprint's clean-tree
check waves the new row through. The first symptom is therefore a red **local** `npm test`
on an UNSTAGED row — which a sprint that just wrote it will read as its own batch failing.
Check `git status` for `events.jsonl` before suspecting the code under test. CI and the
deploy only redden once the row is committed. Claims written before
`2026-08-16T00:00:00.000Z` predate the rule and are grandfathered; the run prints how many.
In a SHALLOW checkout (`ci.yml` and `preview.yml` use the default depth 1; only `deploy.yml`
sets `fetch-depth: 0`) no historical sha resolves, so the existence and freshness lookups are
reported as *unverified* rather than answered as absence — otherwise the first row written to
this contract would fail CI while passing on deploy, and a check that punishes the first
person to obey it gets switched off.

> ⚠️ **The counts in the sections BELOW this block are stale.** They were measured when each
> was written and have not been re-derived; the 2026-08-17 date on this block applies to this
> block only. Measured 2026-08-17 for comparison: 53 `ran: false` rows (48 `declined-unattended`
> + 4 `declined-unattended-shipped` + 1 `already-satisfied`), 52 of 53 via `sprint-parallel`,
> 53 of 109 non-`skip` `review` rows. Every qualitative claim below still holds and every
> ratio moved the same direction, so nothing there is misleading in substance — but the
> figures are not current. Disclosed rather than silently re-derived, which is the same
> discipline as the `correction` rows above. Tracked as BIN-929.

**Rows with `ran: false` are NOT reviews and must be excluded from every rate.** They exist
because a review that was OWED and refused has to leave a trace — a repo where nothing
sensitive was touched would otherwise look identical. The unattended sprint writes TWO
different outcomes, and the second is the alarming one:

- `outcome: "declined-unattended"` — the ticket was pulled OUT of the run before building.
  Nothing shipped.
- `outcome: "declined-unattended-shipped"` — the ticket was **built and committed with the
  review still owed** (the `panelPolicy: park` path). Code reached main unreviewed. Do not
  read the `ran: false` family as "nothing happened".

  **Updated 2026-08-17 (BIN-918).** This paragraph used to end "*Zero rows in the log carry
  this today* — every one of the 41 sprint-written rows is the pulled-out variant", and
  predicted that the day the first one appeared it should be legible as the different,
  worse thing it is. That day was 2026-08-16: four rows carry it, stamped
  `2026-08-16T13:53:30.297Z`. Three describe code that did reach main unreviewed
  (`049f21b`, `851696d`); the fourth, BIN-909, describes a build that never happened. All
  four are retired by `correction` rows — see the section above. Left as a corrected
  sentence rather than a silent edit, because a count in prose going stale without anyone
  noticing is the same defect class the correction rows exist for.

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
