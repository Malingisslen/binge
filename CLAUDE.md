# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreement

- **Solo, push-direct-to-main.** No PRs, no feature branches — commit and push to
  `main` (which deploys via `deploy.yml`, see Commands). The one exception: a genuinely
  risky migration (Firestore rules/schema/status-model) gets a written plan and an
  explicit go-ahead first.
- **Explain in product terms.** Malin directs the work but doesn't read code —
  describe changes by what they do for users and the trade-offs they carry, not by
  diff mechanics.
- **Reply shape.** Answer in one or two lines, then bullets (five max, one line each),
  then what she needs to do, then "also found" for anything you tripped over. No
  preamble, no narration between tool calls, one topic per reply, no error logs unless
  asked. On her own machine an output style enforces this; this bullet is what reaches
  cloud and phone sessions, which never see `~/.claude`.
- **Long answers become a page, not a wall.** Anything past ~15 lines — sprint recaps,
  plans, reviews, audits, research — is written as one self-contained HTML page instead
  of printed. Locally: write it under `C:/Users/malla/claude-reports/binge/` and open it.
  In a cloud or phone session: publish it as an Artifact and give her the link.
- **Minimize running costs.** Firebase is Blaze with a 25 SEK/mån cap. Flag anything
  that would add a paid service.
- **Testing honesty.** Tests prove intended behavior. Never weaken, skip, or rewrite
  an assertion just to go green — if a test fails, the production code is the suspect.

### Plan before large changes — and cast the role-org first

Applies to ad-hoc chat, not just `/sprint-execute`. Malin's decision 1 (2026-10-05,
BIN-1426): role critiques and reviewer agents only for database rules, sign-in, personal
data, server functions and new features.

**A written plan + Malin's approval before any Edit/Write, cast as below**, for:
- a **new feature**: new behaviour a user notices (a `feat` commit) or a new screen (an added
  `src/app/**/page.tsx`). A new or rebuilt screen starts with sketches (`html-previews.md`).
- a **sensitive path**: anything a review gate in `.claude/shared-plugin.json` covers. That
  is Firestore rules and indexes, sign-in, personal data, Cloud Functions, and the review and
  deploy machinery itself. The router lists such paths under `sensitive`.
- anything that adds a paid service or moves Firebase cost.

**Everything else ships on typecheck, lint and tests**, with no plan, critique or ticket
(the risky-migration exception in the working agreement still holds). A feature also gets
one `binge-code-reviewer` run over its diff before commit; a sensitive path gets the
reviewers its commit gate names.

**Cast the stakeholders BEFORE writing the plan**:
1. `node docs/org/route.mjs <paths>` → `{ tier, reasonCode, policy, sensitive, panel, roles,
   highStakes, reason, unmappedCode, unownedCode }`, `tier` ∈ `skip` / `medium` / `top`.
   Route a new feature or a cost move with `--feature`: the router cannot see either from
   the paths. Deterministic, no agents. Don't hand-roll a second risk judgment — this is the
   same router `/linear` and `/stakeholder-review` use.
   **Branch on `reasonCode`, not on the prose in `reason`**. `skip` is always
   harmless (`ordinary` / `doc-only` / `no-code-paths`). Do not write a consumer that tests
   for `skip` + `unmapped-code`
   (no such state exists, and the branch would read as satisfied forever). And
   `unownedCode` can be non-empty even when `reasonCode` is `'owned'`, when only SOME of
   the paths have an owner: read the array, not only the code.
2. `medium` → one blind critique from the owning role; `top` → the full panel concurrently,
   each grounded in its dossier section (`docs/role-responsibilities.md §N` +
   `docs/org/world-watch/ROLE_WORLD_MODEL.md`) and blind to the others. Critiques run on
   **sonnet at low effort**; the commit-gate reviewers stay on **opus**.
3. Fold their conditions into the plan as binding acceptance criteria. An unresolved
   high-stakes conflict — a block from Security #4 / DPO #6 / Legal #5, or anything legal /
   privacy / interpretive — is surfaced to Malin IN the plan, never buried.

`skip` → no panel.

## Commit gates (shared workflow-guards plugin; config in .claude/shared-plugin.json)

Each gate prints its own remedy, so follow the block message rather than reciting the
procedure from here.

The gates also name `.claude/rules/accepted-deviations.md`: deliberate deviations are
decided, and a review must not re-flag them. That file is a trigger-loaded index of headings;
each entry is in full in `.claude/accepted-deviations.md`, the ledger. When you dispatch a
reviewer some other way, point it at both.

## Standing "do not do this" calls

- **Never flip tmdbTosSweep's `mutateEnabled`.** It writes to EVERY user's watchlist. The
  flip is Malin's Firebase Console action. A sprint may never do this.
- **Tillsammans carries two accepted security/cost risks** (anon-vs-anon vote forgery; no
  session-expiry gate on writes). See ADR 0015
  before touching `firestore.rules`' session block, and never "fix" the first with a token
  stored on a public-read doc.
- **Never approve a run waiting in the `backend` environment, and never tick
  `backend_deployed_by_hand` unless Malin says the backend is deployed by hand.** The
  click is Malin's: it is what puts a rules or functions deploy in her hands (BIN-1426). A
  session that pushes in her name can technically give it too, and then the click guards
  nothing. The tick skips the approval altogether, and the run's success makes the next
  comparison start after changes nobody deployed.

## Project Overview

Binge (binge.nu) is a Swedish media tracker for movies and TV shows — track what you're
watching, want to watch, and have watched, with Swedish streaming availability as the
killer feature (Prisjakt for media: dense, functional, data-forward). UI is in Swedish.
Metadata comes from the TMDB v3 REST API (fetched directly, no SDK); everything else about
the stack lives in `package.json` — read it rather than trusting a copy here (a prior
version of this section claimed Next 14 while the app ran 16).

## Commands

`package.json` holds the script list. `deploy.yml` ships a push to `main`: the site, and
before it the rules, indexes and functions changed since its last successful run, once Malin
approves the run in the `backend` environment (BIN-1426; which files count is `watchedPaths`
in `scripts/check-deploy-drift.mjs`). A push that only touches `docs/` (the workflow map
aside), `tasks/`, `.claude/` or Markdown starts no run. By hand only when that job fails,
then Run workflow with `backend_deployed_by_hand` to ship the site (`docs/RUNBOOK.md` §6e):

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
firebase deploy --except hosting
```

## Architecture

Client-side-only SPA: Next.js App Router + `output: 'export'`, all data fetched
client-side with React Query, no server routes. Deep reference lives in the trigger-loaded
rules below — a `/compact` drops them until the matching file is opened again, so open it
before trusting your own judgment on that surface.

## Trigger-loaded reference (`.claude/rules/`, `paths:` frontmatter)

Not loaded every session — only when Claude reads a file matching a rule's `paths:`.

Which paths trigger a rule is answered only by that file's own `paths:` frontmatter (BIN-1020), and
this hand-kept list says only what each rule is for: `ls .claude/rules/` if you doubt it is complete.

- `design-system.md` — Direction H layout/tokens/tvåaccentregeln/poster-duotone/new-view
  recipe.
- `calendar.md` — calendar entry model + sources.
- `accepted-deviations.md` — the index of decided deviations; review agents read the
  matching entry in the ledger, `.claude/accepted-deviations.md`, before filing a finding.
- `html-previews.md` — Malin reads pictures, not code: a new or rebuilt screen starts with
  an ASCII sketch in the plan and variants she can react to, before any code is written.
- `tmdb.md` — shared `TMDB_STALE` cache keys, rate-limit/AbortSignal, API conventions,
  provider-id normalization.
- `data-model.md` — full Firestore collection tree, the GDPR export/delete helper contract,
  the WatchStatus + TV sub-state schema (incl. migration), Auth setup.
- `deployment.md` — build pipeline, byggtids-TMDB SEO pre-rendering (cache +
  timeout protections), CI workflow roles.
- `routing.md` — static-export catch-all dispatch for dynamic routes; what breaks if you
  add a route without updating both the dispatcher and the Firebase rewrite.
- `code-style.md`, `lessons-digest.md` — **always-on**, and that is a property of the files
  themselves (they carry no `paths:` block at all), not something to infer from an empty
  one: doc-taxonomy + test-extraction convention, and the running lessons digest.
- `lessons-digest-delivery.md`, `lessons-digest-testing.md` — the lessons that only bind
  during sprint/review-gate work or while writing tests.

Non-rules docs (read on demand, not trigger-loaded): `docs/data-export-format.md` (GDPR
export JSON schema), `docs/data-retention-policy.md` (deletion/anonymization),
`docs/moderation.md` (reports admin runbook), `docs/RUNBOOK.md` (incident playbooks),
`docs/analysis/EXTERNAL_ACTIONS.md` (manual functions/rules deploy, secrets, Cloudflare
cache).

## Workflow map freshness

`docs/workflow-map.html` (interactive, JSON-driven) documents the PWA/Firebase flows.
Deploy fails if a referenced path stops existing OR if any entry in `docs/workflow-map-universe.json` (functions/routes) loses flow coverage (`node scripts/check-workflow-map.mjs`) — a new function or route requires a map flow.
A PostToolUse hook stamps `.claude/state/workflow-map-stale.json` when mapped code is edited.
**If that flag exists:** re-trace ONLY the flows whose nodes match the flag's `triggers`,
update the map's `<script id="data">` JSON (nothing else), run the linter, delete the flag,
commit the map. Don't rebuild the map; don't ignore the flag.
