# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working agreement

- **Solo, push-direct-to-main.** No PRs, no feature branches — commit and push to
  `main` (which deploys hosting via `deploy.yml`). The one exception: a genuinely
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
- **Minimize running costs.** Firebase is Blaze with a 25 SEK/mån cap. Prefer the
  lite TMDB queries on fan-out surfaces, respect the cache tiers, and flag anything
  that would add a paid service.
- **Testing honesty.** Tests prove intended behavior. Never weaken, skip, or rewrite
  an assertion just to go green — if a test fails, the production code is the suspect.

### Plan before large changes — and cast the role-org first

Applies to ad-hoc chat, not just `/sprint-execute`.

**A change is "large"** if it hits ANY of: 3+ files; a new core module / service / hook /
lib; an architectural change; a "refactor" / "migrate" request; a multi-file codemod; or a
**sensitive domain** — Firestore rules / indexes / schema or the watch-status model; auth;
user data / GDPR / privacy; Cloud Functions / FCM / moderation; deploy / hosting /
Cloudflare config; anything legal; or anything that adds a paid service or moves Firebase
cost. Large changes get a written plan + approval before any Edit/Write. Small, obvious,
single-file fixes ship without ceremony.

**Cast the stakeholders BEFORE writing the plan**, for any large change or sensitive domain:
1. `node docs/org/route.mjs <paths>` → `{ tier, reasonCode, panel, roles, highStakes,
   reason, unmappedCode, unownedCode }`, `tier` ∈ `skip` / `medium` / `top`.
   Deterministic, no agents. Don't hand-roll a second risk judgment — this is the same
   router `/linear` and `/stakeholder-review` use.
   **Branch on `reasonCode`, not on the prose in `reason`** (BIN-804). `skip` is always
   harmless (`doc-only` / `no-code-paths`). Code nobody owns routes **`medium`** with
   `reasonCode: 'unmapped-code'`, seated on the #14 fallback and listed in `unownedCode` —
   that is BIN-788's fix, so do not write a consumer that tests for `skip` + `unmapped-code`
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

`skip` tier (doc-only / trivial) → no panel, plan normally.

## Commit gates (shared workflow-guards plugin; config in .claude/shared-plugin.json)

Three gates block `git commit`: specialist reviews, `/code-review`, and plan evidence.
Each one prints its own remedy — including which reviewer is missing and the exact command
to record it — so follow the block message rather than reciting the procedure from here.

The gates also name `.claude/rules/accepted-deviations.md`: deliberate deviations are
decided, and a review must not re-flag them. That file is trigger-loaded (it carries
`paths:` frontmatter) and each reviewer agent reads it — so when you dispatch a reviewer
some other way, point it there too.

## Standing "do not do this" calls

- **Never flip tmdbTosSweep's `mutateEnabled`.** It writes to EVERY user's watchlist. The
  flip is Malin's Firebase Console action, gated on BIN-454/468 (real traffic + recorded
  prod dry-run cost + a missed-run alert) and pegged to ~Nov. Test coverage is NOT the open
  gate — BIN-566 closed that. A sprint may never do this.
- **Tillsammans carries two accepted security/cost risks** (anon-vs-anon vote forgery; no
  session-expiry gate on writes), both decided by Malin against a full panel. See ADR 0015
  before touching `firestore.rules`' session block, and never "fix" the first with a token
  stored on a public-read doc.

## Project Overview

Binge (binge.nu) is a Swedish media tracker for movies and TV shows — track what you're
watching, want to watch, and have watched, with Swedish streaming availability as the
killer feature (Prisjakt for media: dense, functional, data-forward). UI is in Swedish.
Metadata comes from the TMDB v3 REST API (fetched directly, no SDK); everything else about
the stack lives in `package.json` — read it rather than trusting a copy here (a prior
version of this section claimed Next 14 while the app ran 16).

## Commands

`package.json` holds the script list. These are the ones that are NOT in it — `deploy.yml`
ships hosting only, so rules and functions are always manual:

```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only hosting,firestore:rules
```

## Architecture

Client-side-only SPA: Next.js App Router + `output: 'export'`, all data fetched
client-side with React Query, no server routes. Deep reference lives in the trigger-loaded
rules below — a `/compact` drops them until the matching file is opened again, so open it
before trusting your own judgment on that surface.

## Trigger-loaded reference (`.claude/rules/`, `paths:` frontmatter)

Not loaded every session — only when Claude reads a file matching a rule's `paths:`.

**Which paths trigger a rule is answered by that file's own `paths:` frontmatter, and only
there.** This section names what each rule is FOR; it deliberately does not restate what
each loads on. The enumeration that used to sit here was a second list nobody widened when
the first one changed (BIN-1020): it had gone stale on `accepted-deviations.md`, and wrote
`watchStatus*.ts` where the frontmatter names `src/lib/watchStatus.ts` and
`src/lib/watchStatus.migration.ts`, with no glob reaching a third — so a reader trusting the
star believed a new `watchStatus` file would trigger the rule. It would not.
Open the rule file's first lines rather than trusting any paraphrase of them, here or
elsewhere.

The list of rule files below is still hand-maintained, and nothing checks it — `ls
.claude/rules/` if you doubt it is complete. That is a smaller failure than the one above:
a missing entry under-informs, a stale path list actively misdirects.

- `design-system.md` — Direction H layout/tokens/tvåaccentregeln/poster-duotone/new-view
  recipe.
- `calendar.md` — calendar entry model + sources.
- `accepted-deviations.md` — decided deviations; review agents must read before filing a
  finding.
- `html-previews.md` — Malin reads pictures, not code: a new or rebuilt screen starts with
  an ASCII sketch in the plan and variants she can react to, before any code is written.
- `tmdb.md` — shared `TMDB_STALE` cache keys, rate-limit/AbortSignal, API conventions,
  provider-id normalization.
- `data-model.md` — full Firestore collection tree, the GDPR export/delete helper contract,
  the WatchStatus + TV sub-state schema (incl. migration), Auth setup.
- `deployment.md` — build pipeline, byggtids-TMDB SEO pre-rendering (25k titles, cache +
  timeout protections), CI workflow roles.
- `routing.md` — static-export catch-all dispatch for dynamic routes; what breaks if you
  add a route without updating both the dispatcher and the Firebase rewrite.
- `code-style.md`, `lessons-digest.md` — **always-on**, and that is a property of the files
  themselves (they carry no `paths:` block at all), not something to infer from an empty
  one: doc-taxonomy + test-extraction convention, and the running lessons digest.

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
