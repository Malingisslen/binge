# Sprint 2026-07-14 — Selection

Thin backlog again (matches the 2026-07-13 pattern): the Binge backlog has 9 open items,
but only 2 clear the mandate gate as buildable now. The rest are either already-decided
timing (booked for a later window per memory), ops-blocked pending Malin's action, or a
policy call that's genuinely hers. Not manufacturing build work to fill a bigger N.

## Agent A — seo (BIN-496)

- [ ] **[Tier A] BIN-496** — SEO-page shared helpers: extract `jsonLd()` escaper +
  `withRetry()`, fix bare `surface` class on `/billigaste`
  - Disposition: **build** (follow-up to already-reviewed BIN-461 work; mechanical
    dedup + a live cosmetic bug fix, no product/UX judgement call)
  - Stakeholders: router → tier **skip** (`node docs/org/route.mjs` finds no owning
    role for these SEO route files — unmapped in `docs/org/ownership-map.json`, not a
    high-stakes path). `requiresPlanMode`: **false**.
  - Files: `src/lib/seo/jsonLd.ts` (new), `src/lib/seo/jsonLd.test.ts` (new),
    `src/lib/seo/withRetry.ts` (new), `src/app/genre/[slug]/page.tsx`,
    `src/app/billigaste/[slug]/page.tsx`, `src/app/forsvinner/[id]/page.tsx`,
    `src/app/guider/page.tsx`, `src/app/provider/[id]/page.tsx`
  - Acceptance:
    1. One shared JSON-LD escape helper lives in `src/lib/seo/` and all 5 pages
       (provider, billigaste, forsvinner, guider, genre) import it — no copy-pasted
       escaper left in any of the 5 files.
    2. A new test exercises the actual `<` → `&lt;` escape (not just a round-trip on
       titles without `<`).
    3. The bare `surface` class on `src/app/billigaste/[slug]/page.tsx` is fixed to
       `bg-surface` (grep confirms zero bare `className="...surface..."` without the
       `bg-` prefix in that file).
    4. `withRetry()` is a single shared helper `(fn, attempts, stepMs)` used by both
       billigaste and genre pages — each page keeps its own attempt-count/step-ms
       values; don't touch `/billigaste`'s unrelated logic beyond this dedup + the
       surface fix.

## Agent B — watchlist (BIN-495)

- [ ] **[Tier A] BIN-495** — Batch "unmark all episodes" into one Firestore write
  instead of N separate writes
  - Disposition: **build** (real perf/cost fix — confirmed on main: `markSeasonUnwatched`
    in `src/hooks/useEpisodeProgressWithSync.ts` currently does
    `Promise.all(episodeNumbers.map(ep => markEpisode(season, ep, false)))`, i.e. N
    separate `setDoc` merge writes to the same doc per unmark-season action)
  - Stakeholders: router → tier **medium**, owner #14 Software Architect
    (`src/contexts/WatchlistContext.tsx` area). `requiresPlanMode`: **false** (medium
    tier alone doesn't trigger the gate — priority is Low, no security label).
  - Files: `src/hooks/useEpisodeProgress.ts`, `src/hooks/useEpisodeProgressWithSync.ts`
  - Acceptance:
    1. `markSeasonUnwatched` issues exactly one Firestore write for the whole season
       (not one write per episode).
    2. That single write sets `watched:false` for every episode number passed, under
       the same season key, in one `setDoc`/merge call.
    3. The post-unmark `updateProgress`/`highestWatchedPosition` recompute (season
       exclusion semantics) is unchanged — still one recompute call after the batched
       write, same result as before for a given progress state.
    4. `markSeasonWatched` (already a single write) is not modified or regressed by
       this change.

## Needs you / not selected this sprint

- **BIN-454** (High, due 2026-08-11) — tmdbFieldsSweep rollout runbook. Reason: ops-
  blocked (manual `firebase deploy --only firestore:rules` + Console step) AND
  explicitly blocked on BIN-402's freshness-stamp defect landing first. Matches the
  2026-07-13 decision-queue call to wait until propagation (~Aug 10). Recommendation:
  leave it — don't start until the blocker's fixed and the window arrives.
- **BIN-419** (Low, due 2026-08-28) — SEO content-floor before/after re-measurement.
  Reason: the "after" data isn't collectable yet (needs GSC data at the due date).
  Recommendation: wait, nothing to build now.
- **BIN-189** (Todo, Low) — Seasonal challenges. Reason: per memory, panel-approved
  already for an Aug/Sept build ahead of the Nov 1 launch — correctly not due yet.
  Recommendation: leave scheduled, revisit in the Aug/Sept window.
- **BIN-170** (Todo, Low, due 2026-10-15) — Binge Wrapped year-in-review. Reason: per
  memory, booked for November. Recommendation: leave scheduled.
- **BIN-173** (Medium) — Affiliate-tag rent/buy deeplinks. Reason: per memory this
  shipped as passthrough plumbing already (fabf1b0); what's left needs Malin's actual
  Adtraction account + a real `AFFILIATE_PROGRAMS` entry — ops-blocked on her signup,
  not a code task right now. Recommendation: wait for her to open the account, then
  it's a fast follow-up.
- **BIN-494** (Medium) — Decide: anonymize vs delete public UGC on account deletion.
  Reason: genuinely her call — a GDPR Art. 17 policy question (hard-delete vs
  anonymize reviews/comments), not a code judgement. Recommendation: needs a decision
  from Malin; either answer is implementable in under a day once she picks.
- **BIN-493** (Low) — Library-card layer phase 2 (Viddla scraper + loan-quota budget).
  Reason: speculative scope expansion of BIN-172 — a scraper against a site with no
  public API is a real maintenance commitment, and "badge everywhere" is a design
  choice. Recommendation: drop or reframe smaller; don't build the scraper without her
  explicitly wanting that ongoing maintenance burden.

## Post-sprint steps

1. Run `npm run typecheck` + `npm run lint` + `npm test` after both batches land.
2. `/code-review high` on the combined diff (touches TS/TSX only, no functions/rules —
   `high` not `xhigh`) → touch `.claude/state/simplify-done.marker` → commit.
3. Reviewer gate: `binge-code-reviewer` on both batches; `binge-test-reviewer` on the
   new `jsonLd.test.ts`.
4. Commit → push → deploy.yml green → purge Cloudflare (per `ship.deployAfterCommit`).
5. File follow-up tickets for anything each implementer defers; reference them in the
   commit body.

## Deviation log

(none yet — fill in during execution)

---

# Archived — Sprint 2026-07-13 (thin backlog, BIN-447 closed by hand)

Sprint-parallel found ZERO buildable tickets that sprint (all decision-gated). BIN-447
was closed by hand after verifying the purge + filmography SEO work was already live.
See project memory `project_sprint_2026-07-13_thin_backlog.md` for detail — this file's
prior content was already superseded and is not reproduced here to avoid duplicating
that memory record.
