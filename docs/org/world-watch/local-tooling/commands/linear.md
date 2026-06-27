---
description: Linear work-tracking for Binge — scan, ticket, backlog, clean, status
---

# /linear — Binge work tracker

A self-contained suite for turning observations about the Binge codebase into
well-formed Linear tickets, and for working those tickets back down. Adapted to
Binge's stack (Next.js 16 static-export SPA + Firebase + TMDB) and domains.

`$ARGUMENTS` selects the subcommand. **No args → print the cheat sheet below and stop.**

```
/linear scan [deep|ultrathink|creative|hygiene|night]   analyze the repo → Backlog tickets
/linear ticket <thought>                          turn one raw thought into a ticket
/linear clean                                      flag stale / fixed / inflated tickets
/linear status                                     dashboard: counts, blind spots, last scan
```

> **Building a ticket?** Use **`/sprint-execute --pick`** — it shows the backlog grouped
> by type/area/effort + owning specialist, lets you pick one (or a few), and runs the
> full route → review → verify → commit → close ceremony. (The old `/linear backlog`
> was folded into it so single-pick and batch share one door — see `sprint-execute.md`.)

**Every ticket this command creates is stamped with its owning specialist(s)** — the
expert review layer is on by default, starting at ticket creation. See *Stakeholder
routing* below.

---

## Prerequisites (run first, every invocation)

1. **Linear MCP must be connected.** Confirm the `list_issues` tool is available
   (Linear server `51df735d-d0bd-40c0-89b8-d55c22df080e`). If it is not, STOP and
   tell the user: *"Linear MCP isn't connected — run `/mcp` to connect it, then
   re-run `/linear`."* Do not retry in a loop.
2. **Load the tracker** `.claude/linear-tracker.json`. If missing, recreate it from
   the empty skeleton (`{ "issues": {}, "lastScanDate": null, "lastScanFocus": null,
   "lastIssueId": null, "lastAuditDate": null, "pendingTickets": [] }`). If it is
   present but unparseable, copy it to `.claude/linear-tracker.json.bak` and recreate.
3. **Never crash on tracker problems** — a corrupt tracker degrades to "no dedup
   memory", never to a failed command.

---

## Fixed Binge context (do not re-derive)

> **⚠️ SHARED TEAM — read this first.** The `Binge` Linear team also hosts a separate
> **Synat** project (free-plan 2-team cap). `team = "Binge"` is therefore **NOT** a
> safe filter — it sees Synat's tickets too, and `clean` could close them. **Every
> read / scan / status / clean MUST filter by `project: "Binge"`.** Every ticket you
> create MUST be stamped with `project: "Binge"`, or it falls out of Binge's own
> filters (and into Synat's view). **NEVER rename or delete any label** — `frontend`,
> `infra`, and the other area labels are shared with Synat, which depends on them.
> These commands only ever *attach* labels, never mutate them.

- **Project (PRIMARY FILTER):** `Binge` — id `52e1084e-e01b-46b1-9520-4ef5a13622ee`,
  slug `binge-ba712d0954e6`. Every `list_issues` call passes `project: "Binge"`.
- **Team:** `Binge` — id `1ca8fd6c-4e67-4df6-8090-a0a6cec0e205` (key `BIN`).
  `save_issue` requires a team, so **creates pass BOTH** `team: "Binge"` **and**
  `project: "Binge"`.
- **Intake state:** `Backlog`. New tickets from `scan` and `ticket` are created with
  `state: "Backlog"` (Binge has no Triage lane — Backlog *is* the triage inbox).
- **Label rule (enforced everywhere):** exactly **1 type label + ≥1 area label** per
  ticket. Verify a label exists (it's in the table below) before using it; never
  invent a label name on the fly.

### Type labels (reuse — workspace-level)
| name | id |
|---|---|
| `Bug` | `5eb64f75-32e0-48d2-a9c1-577c0b73e590` |
| `security` | `46d77c96-60c0-44c7-9b8f-75f437f8aff6` |
| `tech-debt` | `bcd167f8-fe4d-44a5-ba69-b6f586fb1855` |
| `performance` | `fe10e751-608a-44ae-9d5e-12c009fe750b` |
| `test-gap` | `c930c60d-a7f2-40bc-93d8-df091ddb294a` |
| `dependency` | `79518062-439a-49db-901c-c90af400a2a9` |
| `idea` | `9a8eb87f-951a-411b-8778-0d2f40361088` |

### Area labels (Binge)
| name | id | covers / path signals |
|---|---|---|
| `frontend` | `9fe55c67-f613-4e66-9763-018f482e5fb2` | `src/components/**`, `src/app/**`, `globals.css`, `tailwind.config.ts`, design system, a11y |
| `watchlist` | `938b9615-5b7c-439e-b293-825eed1e375a` | `src/lib/watchStatus*`, `libraryView`, `WatchlistContext`, `episodeProgress`, `src/components/watchlist/**` |
| `streaming` | `54d85e79-dc82-4f11-ae1f-67982506a025` | `src/lib/tmdb/providers*`, `useSubscriptionAdvisor*`, `useCalendar`, `src/lib/calendar/**`, advisor |
| `social` | `ead0017c-f761-4df6-8c67-dd03d1c478ae` | `src/components/groups/**`, Group/Tillsammans/User pages, reviews, `firebase/groups`/`sessions`, follow, notifications/FCM |
| `auth` | `c6514e45-74ac-4279-8028-2f408d054281` | `AuthContext`, `passwordStrength`, GDPR `dataExport`/`userData`, account/profile, App Check |
| `data` | `793260db-a604-4f7b-8491-08f56e2665e5` | `src/lib/firebase/**` collectors, `src/lib/tmdb/client`/`cacheTiers`/`buildFetch`/`buildCache`, migrations |
| `seo` | `852c6094-ec8d-4607-b73c-708c2214a4ca` | `generateStaticParams`, sitemap, `usePageMeta`, Schema.org, `seoCoverage` |
| `infra` | `f3e652dc-19c2-49f0-b615-e61b7f7a0cb9` | `firebase.json`, `firestore.rules`, `.github/workflows/**`, `next.config`, Cloudflare, deploy |

> A ticket may carry more than one area label when it genuinely spans domains
> (e.g. a provider-card redesign = `frontend` + `streaming`). Prefer the single
> best fit; add a second only when both are clearly load-bearing.

### Hygiene commands + thresholds (this stack)
| check | command | flag when |
|---|---|---|
| lint | `npm run lint` | any error |
| types | `npm run typecheck` | any error |
| unit tests | `npm test` | any failure; any non-trivial module with 0 test coverage |
| rules tests | `npm run test:rules` | any failure (needs Java on PATH — JBR) |
| dep audit | `npm audit` | any High/Critical CVE; any prod dep ≥1 major version behind |
| bundle | `npm run analyze` | First Load JS regression vs the tracked baseline |
| file size | (Grep/Read heuristic) | source file > 400 lines |
| TODO age | (Grep `TODO`/`FIXME` + `git blame`) | TODO older than 30 days |

---

## Dedup system (before creating ANY ticket)

1. **Tracker check** — is there an entry in `issues` whose title is a near-match
   (same verb + same target)? If yes, skip; report the existing id.
2. **Live check** — `list_issues project:"Binge"` (filter by the candidate's area
   label when possible) and compare titles for near-duplicates across all open
   states. **Always `project:"Binge"`, never `team:"Binge"`** — the team also holds
   Synat's tickets.
3. **Create only if no match.** Create with BOTH `team:"Binge"` and `project:"Binge"`.
   After `save_issue` succeeds, write the new `id → title` mapping into the tracker
   `issues` map.

Batching rule: the **same** issue appearing in N files = **1** ticket that lists the
files, never N tickets.

---

## Ticket format

- **Title** starts with a verb: Fix / Add / Refactor / Update / Remove / Improve /
  Investigate. Concrete and specific — name the file or surface.
- **Priority** assigned autonomously, no asking:
  - `Urgent` (1) — broken in production, data loss, security hole, build red.
  - `High` (2) — should land this week; user-visible breakage or risk.
  - `Medium` (3) — this month; quality, polish, non-urgent debt.
  - `Low` (4) — someday; nice-to-have, speculative.
- **No effort estimates in tickets.** Effort is judged at selection time
  (`/sprint-execute` / `--pick`), not now.
- **Body — bug / debt / perf / security / test-gap / dependency:**
  ```
  ## Finding
  What's wrong, where (file:line), how it manifests.
  ## Why It Matters
  User-facing or correctness/security impact. Concrete.
  ## Suggested Fix
  The smallest change that addresses the root cause.
  ## Stakeholders
  <from `node docs/org/route.mjs --md <touched paths>` — see Stakeholder routing>
  ```
- **Body — idea:**
  ```
  ## Opportunity
  ## Current State
  ## Proposed Improvement
  ## Effort vs Impact
  ## Stakeholders
  <from `node docs/org/route.mjs --md <touched paths>` — see Stakeholder routing>
  ```

Every finding referenced in a ticket must be **verified against the actual code**
before the ticket is created — open the file, confirm the line, confirm the premise
still holds. No tickets from assumption.

---

## Stakeholder routing (default ON — every created ticket)

The virtual role-org's expert layer starts at ticket creation: every ticket is stamped
with the specialist(s) who own the code it touches, so the right reviewer is assigned
**from the moment the ticket exists** — not discovered later at build time.

After verifying a finding (and before `save_issue`), run the committed router on the
**paths the finding touches** (the file:line(s) in its body):

```bash
node docs/org/route.mjs --md <path> [<path> ...]
```

It reads `docs/org/ownership-map.json` (28 roles) + the high-stakes list in
`docs/org/world-watch/DESIGN.md §1.3` and returns a ready `## Stakeholders` block with
the **tier** (top / medium / skip) and owning role(s). **Append that block to the ticket
body.** This is the SAME router `/sprint-execute` and `/stakeholder-review` use — one
source of truth, no second risk formula.

- **tier top / medium** → paste the `## Stakeholders` block as-is.
- **tier skip** (trivial / doc-only) → omit the block (or paste the "_None_" line); the
  ticket simply carries no review owner. Don't manufacture one.
- The stamp is **informational** — it records who *should* weigh in. The actual panel
  runs at build time in `/sprint-execute` (gated on the same tier), or on demand via
  `/stakeholder-review`. `/linear` never convenes a panel itself (it files, it doesn't
  build).

The router is deterministic string-matching — no model call, no network — so stamping is
free and fits the $0/interactive cost model.

---

## Subcommand: `scan [mode]`

Gap-aware analysis that creates **Backlog** tickets. Common pipeline for every mode:

1. Read existing open issues (`list_issues project:"Binge"`) so you know what's
   covered. (Project filter, not team — Synat shares the team.)
2. Check `git log` since `lastScanDate` (tracker) — what changed recently is where
   fresh bugs hide.
3. **Pick focus** = (coverage gap from `status` blind spots) + (recently-changed
   areas) + (rotation: avoid repeating `lastScanFocus`).
4. Analyze (mode-specific, below).
5. **Verify each finding against the real code.**
6. Dedup (above).
7. **Route each finding** through `node docs/org/route.mjs --md <touched paths>` and
   create Backlog tickets with correct 1-type + ≥1-area labels **and** the resulting
   `## Stakeholders` block in the body (see *Stakeholder routing*).
8. Update tracker: `lastScanDate`, `lastScanFocus`, new `issues` entries.
9. Report a **one-line summary**: `Created N tickets (focus: <area>) — A bugs, B
   hygiene, C ideas. Skipped D dupes.`

**Modes:**

- **`scan`** (balanced, default): aim ~40% bugs/security, ~30% hygiene/tech-debt,
  ~30% ideas. One focused pass.
- **`scan deep`** / **`scan ultrathink`**: launch **4–6 parallel Explore agents**,
  each scoped to ONE focused area (e.g. `src/lib/calendar`, `src/lib/firebase`,
  `src/hooks/useSubscriptionAdvisor*`, `firestore.rules`, `src/lib/watchStatus*`).
  Each hunts correctness / security / concurrency / data-integrity bugs and returns
  structured findings. **Always pass explicit file/dir scopes — never let an agent
  loose on the whole tree** (the working copy includes `node_modules`, `.next`,
  `out/`, and a ~25k-file `.tmdb-cache/`; an unscoped walk times out). Cap fan-out.
- **`scan creative`**: product-designer mode. Hunt UX friction, feature gaps,
  refactors, rework, modern-tech adoption. Use `WebSearch`/`WebFetch` to benchmark
  Binge against comparable products — JustWatch, Letterboxd, Serializd, Trakt,
  TV Time, Reelgood — for the streaming-availability / tracking experience. Tickets
  land as `idea` (+ area).
- **`scan hygiene`**: ONLY the automated checks in the hygiene table. Run them, apply
  the thresholds, one ticket per distinct finding (batched across files). Lint/type
  failures → `tech-debt`; missing coverage → `test-gap`; outdated/CVE deps →
  `dependency`; bundle regressions → `performance`.
- **`scan night`**: unattended, loopable inventory pass — see its own section below.

---

## Subcommand: `scan night` — unattended overnight inventory

Built to run repeatedly via `/loop` while nobody's watching. Its job is to surface the
**true scale** of real work — defects AND missing/feature gaps — without inventing
anything and without hiding anything behind a cap. Precision keeps junk out; reality
decides the volume.

> Like every scan, this only files to **Backlog** and never writes code — the worst
> case of an over-eager night is a few tickets you close in the morning. Always
> `project:"Binge"` (Synat shares the team).

### Two anti-fabrication gates (nothing is filed that doesn't pass its gate)

- **Defects** (file as the matching type label + area): a deterministic tooling
  failure (`lint`/`typecheck`/`test`/`audit`), or a correctness/security bug in code
  changed recently (`git log` since `lastScanDate`), **confirmed at a real file:line**
  with a stated failure path.
- **Feature gaps** (file as `idea` + area, body marked *"Proposed — needs sign-off"*):
  must cite an **anchor**, or it is not filed —
  - *code anchor* — a `TODO`/`FIXME`/"not implemented", a half-built path, a film↔TV
    asymmetry, data captured-but-never-surfaced, or a flow dead-end, quoted at file:line;
  - *roadmap anchor* — an item in `project_roadmap.md` / `docs/analysis/FUTURE_ROADMAP.md`
    not yet built;
  - *benchmark anchor* — a specific competitor doing it. File these **sparingly** and
    mark them *speculative* — they're the only judgement-based class.
- **Both classes:** run an adversarial self-check (try to disprove it; discard if you
  can't confirm it reproduces / the gap is real), **dedup** vs open `project:"Binge"`
  issues + the tracker, then **stamp** the `## Stakeholders` block from
  `node docs/org/route.mjs --md <touched paths>` into the body (see *Stakeholder
  routing*) — overnight tickets get the same owning-specialist assignment as any other.

### Volume — let reality decide (NO findings cap)

- **Never cap verified findings.** The count is the signal you want.
- **Aggregate:** identical issue across N files = **one** ticket that lists every site
  and the count — never N cards. For mass-mechanical findings (>~50 sites), file **one
  theme ticket** and write the full list to `.claude/scan-night/inventory/<area>-<slug>.md`,
  referenced from the ticket body, instead of flooding the board.
- **Rank** everything filed worst-first (Urgent → Low).

### Stop condition — dryness OR effort budget, never a number

- Stop after **two consecutive passes that surface nothing new and verified**.
- If an effort/token/time budget is given for the night, stop when it's spent — and on
  a budget-stop, **report exactly what remains unscanned** (which dirs/areas, rough
  expected count). **Never truncate silently.**
- Across passes, accumulate state in `.claude/scan-night/digest.md` (census + filed +
  rejected + stop-reason) and keep `lastScanDate`/`lastScanFocus` current so each wake
  rotates focus instead of re-reporting.

### Morning digest (write to `.claude/scan-night/digest.md`, in this order)

1. **CENSUS first** — total distinct verified issues by **class / area / severity**
   (e.g. "6 correctness bugs · ~40 zero-coverage modules · ~1900 token violations
   across 380 files · 12 anchored feature gaps"). This headline IS the deliverable for
   "how much is there". Note which counts are *measured* (grep/tooling — high trust)
   vs *anchored-but-judged* (feature gaps — worth review, not gospel).
2. **Tickets filed**, worst-first, in **two buckets**: *Verified — safe to fix* (hand
   straight to `/sprint-execute`) and *Proposed — needs your call*.
3. **Rejected** (+1 line why each) and **where it stopped** (dry vs budget; what's left).

### Resilience to interruptions (Max-plan 5-hour usage ceiling)

Designed to be run unattended via `/loop /linear scan night`. On the Max plan the
rolling 5-hour usage window will eventually be hit; when it is, the platform PAUSES the
session until the window resets — you cannot override that. Your job is to make
resuming **free**, so a pause costs only wall-clock time:

- **Checkpoint after every pass.** Persist the tracker, `.claude/scan-night/digest.md`,
  and any inventory files to disk as you go — never hold a pass's findings only in
  context. An interruption (ceiling, crash, manual stop) must lose nothing.
- **Resume by reading state.** On every fresh start, read `.claude/scan-night/digest.md`
  + the tracker FIRST to see what's already filed and which areas are scanned, then
  continue from there. Never restart from scratch; never re-file a dup.
- **Keep a standing wake-up.** Maintain a scheduled wake so the loop auto-resumes after
  a pause. Wake delays cap at ~1h, so on a ceiling-hit schedule ~1h and re-check each
  hour; once the window has reset, proceed.
- **Cumulative census.** The morning census spans the WHOLE night across any pauses —
  report everything found, not just the segment after the last resume.

---

## Subcommand: `ticket <thought>`

Parse one raw thought into a structured ticket. Infer type + area label(s) and
priority from the text. Dedup. If the thought names a file/surface, **route it**
(`node docs/org/route.mjs --md <path>`) and add the `## Stakeholders` block to the body.
Create in **Backlog**. Confirm in one line
(`LIN-123 created: <title> [type/area, Priority, stakeholders: #N…]`). Do not interrupt
the user's flow with questions unless the thought is too vague to label at all.

---

## Building a ticket → `/sprint-execute --pick`

The old `/linear backlog` (browse the backlog, pick one, build it) was **merged into
`/sprint-execute`** so single-pick and batch share one door and one ceremony. To build
interactively:

```
/sprint-execute --pick           browse backlog grouped by type/area/effort + owner, pick 1+, build with full review→verify→commit→close
```

`--pick` runs the same route → stakeholder-panel → implement → verify → ship flow as a
batch sprint, and it's where live high-stakes escalation happens (you're present, so a
panel conflict asks you directly instead of parking the ticket). See `sprint-execute.md`.

---

## Subcommand: `clean`

> **Scope guard (critical):** `clean` only ever operates on
> `list_issues project:"Binge"`. It must NEVER query or mutate by team — closing or
> re-prioritising a Synat ticket would be a cross-project accident. If a project
> filter can't be applied for any reason, **abort** rather than fall back to team.
> `clean` touches ticket *state/priority* only — it never renames or deletes labels.

> **Protect horizon-scan tickets.** Tickets whose title starts with `[world-watch]` are
> filed by the `/world-watch` skill on its own cadence (weekly/monthly/quarterly) and may
> sit open legitimately while the owner works through them — they are NOT drift. **Exclude
> `[world-watch]`-titled tickets from the stale sweep** (don't propose closing them for
> age). They're still subject to the *already-fixed* check (if the underlying advisory is
> resolved in code, closing with a note is fine).

Flag, then confirm each action before executing (never bulk-mutate silently):

- **Stale** — tickets untouched 90+ days, **excluding `[world-watch]`-titled tickets**
  (see above). Propose: close, or re-prioritise.
- **Already fixed** — verify against current code; if the premise is gone, propose
  closing with a note pointing at the commit/file that resolved it.
- **Priority inflation** — if `High`+`Urgent` exceed ~20% of open tickets, propose
  demotions starting with the weakest justifications.

Update `lastAuditDate` in the tracker when done.

---

## Subcommand: `status`

Dashboard (read-only) — all counts from `list_issues project:"Binge"` (never team):
- Open ticket **counts by state** (Backlog / Todo / In Progress / In Review / Done).
- **Area-label blind spots** — any area label with **0 open** tickets (candidate
  focus for the next scan).
- **Last scan** date + focus (from tracker).
- **Stale count** — tickets untouched 90+ days (excluding `[world-watch]`-titled
  tickets, which run on their own cadence — count those separately if any).

---

## Error handling

- No retry loops on Linear API failures — report the error and stop.
- Verify every label exists (table above) before applying it.
- Never crash on tracker read/parse problems (degrade to no-dedup, back up `.bak`).

## Incidental discovery (outside `/linear`)

- Issue in a file you are **not** editing → mention it inline and ask *"Want a
  ticket?"*. Don't create one unprompted.
- XS fix in a file you **are** editing → boy-scout-fix it, note it in the commit
  message, no ticket.
