# scan night — binge, 2026-07-31

Repo 2 of 3 in the overnight tri-repo scheduled sweep, with a per-repo token slice. One
pass. Focus taken straight from the 2026-07-24 resume pointer: **seo and frontend**, the
two backlog blind spots. (Previous digest archived as `digest-2026-07-24.md`.)

## 1. Census

**Distinct verified issues found: 5.** All 5 filed, one ticket each.

- Defects confirmed at a real file:line: **4**
- Deterministic gate findings: **1** (the dependency audit)
- Feature gaps: **0** — none cleared the code-anchor gate. Roadmap anchors were
  unavailable by design this run: `roadmapDocs` still points at two deleted files
  (BIN-585), so there is no roadmap to anchor against.

By severity: 1 High, 3 Medium, 1 Low. By area: frontend 4, seo 1, infra 2, auth 1.

## 2. Tickets filed, worst first

### Verified — safe to fix

| Ticket | Sev | What breaks |
|---|---|---|
| BIN-656 | High | Long-tail movie/TV/person pages ship a generic, duplicated meta description. `buildContentFloor` — written for exactly this and typed "For `<meta name=description>`" — is imported in the same file but wired only to the visible paragraph. Person pages never read `person.biography` at all. Plus a `??`-vs-empty-string bug that can leave the description ending mid-sentence. |
| BIN-657 | Medium | `global-error.tsx` never logs the crash it catches. Every other boundary reports via `SegmentError` (console + Sentry + analytics); the one boundary that catches a root-layout crash reports nothing. |
| BIN-659 | Medium | All three onboarding write handlers are `try`/`finally` with no `catch`. A failed write during first-run leaves the new user with no message and no completion flag — they get dropped back into onboarding next visit. Five settings sections do this correctly, so onboarding is the outlier. |
| BIN-660 | Medium | `EventCard` nests a `<button>` inside its wrapping `<Link>` on `/calendar`. Invalid interactive nesting on the surface's most-used action; the mouse path only works via a `stopPropagation` workaround. |
| BIN-658 | Low | Ten new high CVEs in the eslint toolchain (brace-expansion DoS via minimatch). All devDependencies, none shipped. Needs an eslint 9→10 major. Filed for the record with honest framing, not as urgent work. |

### Proposed — needs your call

None. No speculative or product-decision items this run.

## 3. Rejected, and why

- **Auth and privacy boundaries across all ~30 route segments** — the route scanner's
  primary target, checked deliberately, and it found nothing to file. Worth recording as a
  clean result rather than a silence.
- **File-size findings** — excluded by briefing. This repo has no file-size rule in
  `CLAUDE.md` and no accepted-large-files convention; filing one would invent a rule. Same
  call as the 2026-07-24 run.
- **`next → postcss` and `next → sharp`** — 2 of the 12 audit highs, already BIN-603.
- **Findings inside the parallel session's uncommitted work** (`login/page.tsx`,
  `QuickAddButton.tsx`, `WatchlistContext.tsx`, `useMarkSeen.ts`, `watchlistWrites.ts`) —
  agents were told to treat that fileset with suspicion. Nothing filed from it.
- **Various component-level suspicions** — killed by the agents themselves against the
  co-located `*.test.tsx`, which this repo has in quantity.

## 4. Gates run

- `npm run typecheck` — **clean**.
- `npm audit` — 12 high, 0 critical. 2 are BIN-603; the other 10 became BIN-658.
- `npm run lint`, `npm test`, `npm run test:rules`, `npm run analyze` — **not run**, same
  reason as 2026-07-24: another session's work is live in the tree, so a failure could not
  be attributed to committed code, and filing a ticket against someone's half-written
  change would be wrong.

## 5. Where it stopped

Stopped on **budget**, not dryness — repo two of three with a per-repo slice. One pass, so
dryness is unproven by the skill's own standard.

Covered this pass, for the first time: the `seo` surface end to end, the `src/components`
tree by pattern sweep, and the `src/app` route tree as a group.

Not covered:
- `src/lib/**` beyond seo — the 2026-07-24 run covered data and streaming there.
- `src/components/groups/**` and the social surface — deliberately skipped again; heavily
  covered by the 2026-07-19 reconciliation panel and partly in flight.
- The in-flight watchlist paths.
- The four gates listed above.

## 6. Resume pointer

The seo and frontend blind spots are now genuinely covered, so the churn-driven target is
back on top: **scan whatever the current sprint ships**, including its own fixes — the
watchlist/`useMarkSeen`/`watchlistWrites` work that is in flight tonight is the obvious
first candidate once it lands.

Then re-run the four skipped gates (`lint`, `test`, `test:rules`, `analyze`) the first time
this repo is scanned with a clean tree. They have now been skipped two runs running for the
same reason, which is starting to look less like caution and more like a coverage hole.
