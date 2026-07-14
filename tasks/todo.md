# Sprint 2026-07-14 (c) — sweep-hardening + advisor money-bug + test-gap

**Selection outcome:** 12 open Backlog items. 7 remain timing/ops-gated (unchanged from the
(a)/(b) sprints this same day — BIN-402/454/468/170/189/173/419, see "Not actionable yet"
below). Of the 5 fresh scan findings, 4 are clear, contained bug/test fixes (**build**) and
1 (BIN-505, PII/financial-data leak via `firestore.rules`) is a **needs-approval** parked
item — the fix is real and urgent, but it's a rules+schema migration, which CLAUDE.md
requires a written plan + Malin's explicit go-ahead for *before* any edit, not just an
In-Review park. Commented on BIN-505 with the reasoning + recommendation; left in Backlog.

N = 4 (all backlog volume that cleared the mandate gate this round — did not manufacture
work to fill a larger N).

## Agent A — tmdb-sweep hardening (Tier: functions/, router=skip per-file but security-reviewer
gate applies at commit; area "data")

- [ ] [Tier A] **BIN-504** — Fix tmdbFieldsSweep: unscoped `collectionGroup('watchlist')` will
  wipe `title`/`posterPath` on every group watchlist doc
  - disposition: build · requiresPlanMode: **false** (router tier `skip`, priority High but
    tier isn't `single`/`full-panel` so the Phase-1.5 formula doesn't fire; the mandatory
    `binge-security-reviewer` commit gate is the real guard here per the ticket's own note)
  - files: `functions/src/tmdbTosSweep/index.ts`, `functions/src/tmdbTosSweep/logic.ts`,
    `functions/src/tmdbTosSweep/logic.test.ts`
  - change: scope the collection-group scan to `users/{uid}/watchlist` docs only (skip any
    doc whose grandparent collection isn't `users`), so `groups/{id}/watchlist` items are
    never classified as stale/clearable.
  - acceptance:
    - [ ] A doc shaped like a group watchlist item (`{title, posterPath, addedBy, addedAt}`,
      no `tmdbFieldsRefreshedAt` stamp) is asserted NOT swept in `logic.test.ts` (new test).
    - [ ] A `users/{uid}/watchlist/{id}` doc with the same stale-stamp shape is still
      correctly classified as clearable (no regression on the real target).
    - [ ] The fix does not change the `__name__`/cursor paging behavior (per the ticket's
      explicit "least-risk" constraint — no `orderBy('status')` swap).
    - [ ] `mutateEnabled` gating and the existing dry-run behavior are untouched.

- [ ] [Tier A] **BIN-507** — Harden tmdbFieldsSweep audit + dry-run budget before enabling
  mutate (BIN-468 gate fidelity)
  - disposition: build · requiresPlanMode: **false** (router tier `skip`; priority Medium)
  - files: `functions/src/tmdbTosSweep/index.ts`, `functions/src/tmdbTosSweep/logic.ts`,
    `functions/src/tmdbTosSweep/logic.test.ts`
  - change: (1) wrap the run so a thrown error still writes `lastRun` with an error flag
    instead of silently no-op'ing the audit doc; (2) give dry-run its own persisted cursor
    (`dryRunCursor`, never colliding with the mutate cursor) so repeated dry-runs don't hit
    the identical 18k-doc wall and under-report; (3) reconcile the `MAX_DOCS_PER_RUN` comment
    (says 50k) with the actual constant (100k).
  - acceptance:
    - [ ] A test forces `q.get()` (or `batch.commit()`) to throw and asserts `stateRef` still
      receives a `lastRun` write (with an error indicator), not silence.
    - [ ] A test with a stale-doc count exceeding the per-run budget shows a SECOND dry-run
      invocation continues past where the first left off (no permanent identical-wall repeat).
    - [ ] The mutate-mode cursor behavior (resume-on-timeout, reset-on-full-pass) is
      unchanged — dry-run gets its own field, doesn't share the mutate cursor.
    - [ ] Comment/constant mismatch fixed to state the true number (100k), not 50k.

## Agent B — advisor money-correctness (area "streaming")

- [ ] [Tier A] **BIN-506** — Advisor marks a paid custom-cost tier-less provider (SVT/Pluto)
  as 'free' — never surfaces it as pausable spend
  - disposition: build · requiresPlanMode: **false** (router tier `medium`/single, priority
    Low, no security label)
  - files: `src/hooks/useSubscriptionAdvisor.helpers.ts`,
    `src/hooks/useSubscriptionAdvisor.helpers.test.ts`, `src/hooks/useSubscriptionAdvisor.ts`
    (call site ~line 248)
  - change: feed `deriveProviderStatus` the resolved **effective** monthly cost (the same
    `resolveEffectiveMonthlyCost(pid, ...)` value already computed at line 266, reused rather
    than recomputed) instead of the immutable catalog `defaultMonthlyCost`, keeping `isFree`
    as the sole genuine-free signal.
  - acceptance:
    - [ ] New/updated test: a tier-less provider (`isFree:false`, `defaultMonthlyCost:0`) with
      a user-assigned custom cost > 0 resolves to a **non-`free`** status (eligible for
      `pause` per the existing precedence rules).
    - [ ] Existing test coverage for genuinely free services (`isFree:true`, e.g. SVT with no
      custom cost) still resolves to `free` — no regression on the real free-service case.
    - [ ] `hasActiveShow`/`hasUpcomingShow`/`hasWillSeeAnchor` precedence over `free` is
      unchanged (don't reorder the branches, only change the cost input).
    - [ ] `totalMonthlyCost` and `ProvidersByValue` remain consistent with the new `status`
      (no new contradiction introduced elsewhere).

## Agent C — fan-out hook test coverage (area "watchlist", test-only)

- [ ] [Tier A] **BIN-508** — Add tests for the instant-week fan-out hooks (useCalendar
  next-air repair + refreshTmdbFields)
  - disposition: build · requiresPlanMode: **false** (router tier `medium`/single, priority
    Low)
  - files (test-only, no production-code changes expected): new
    `src/hooks/__tests__/useCalendar.test.ts` (or extend existing calendar test file if one
    exists), new/extended test file covering `refreshTmdbFields` in
    `src/contexts/WatchlistContext.tsx`
  - change: hook-level tests (renderHook + mocked Firestore per the repo's existing pattern)
    for both fan-out call sites.
  - acceptance:
    - [ ] Test asserts the next-air read-repair payload never includes `updatedAt` (pins the
      load-bearing "never bump updatedAt on a read-repair" invariant at the hook layer, not
      just the pure helper).
    - [ ] Test asserts an item is marked "written" only after its batch actually commits
      (partial-batch failure mid-flush should NOT mark later-chunk items as done).
    - [ ] Test asserts rapid repeated calendar renders coalesce into one flush (debounce),
      not one write per render.
    - [ ] No production code in `useCalendar.ts` / `WatchlistContext.tsx` is modified unless a
      test exposes an actual bug — this ticket is test-coverage only; a real bug found while
      writing tests gets fixed but noted as a deviation, not silently expanded scope.

## Not actionable yet (gated on time/ops/decision — unchanged, not re-litigated this sprint)

- **BIN-402 / BIN-454 / BIN-468** — TMDB ToS sweep "flip to clearing": ops-blocked (manual
  `firestore:rules` deploy) + propagation-timing gated (BIN-454 due 2026-11-01). BIN-504/507
  above are prerequisite bug fixes on the SAME code, not a flip of `mutateEnabled` — that stays
  frozen regardless.
- **BIN-170 / BIN-189** — panel-approved seasonal features, scheduled for Aug/Sept build per
  2026-07-13 decision queue. Not due yet.
- **BIN-173** — waiting on Malin opening an Adtraction affiliate account (Tier D, ops-blocked).
- **BIN-419** — SEO before/after measurement, needs GSC data dated ~2026-08-28. Not due yet.

## Needs you (this sprint)

- **BIN-505** — real, live PII/financial-data leak (email/provider costs/hemkommun/notes
  exposed via `firestore.rules` whole-doc reads). Commented on the ticket with full reasoning;
  **recommendation: approve soon** — it's a genuine security gap, just one that (per CLAUDE.md)
  needs your go-ahead on the schema-migration approach before any rules edit lands.

## Deviation log

(none yet — populated during Phase 2 execution)

---

# Archived — Sprint 2026-07-14 (b) — "with me here" (interactive)

**Outcome: zero code shipped — and that's the correct result.** The backlog holds 8 open
items; none is buildable-and-ungated. The one item with real forward motion (BIN-494) turned
out to be a founder-decision that resolved to *no change*.

## What ran

- **Selection:** classified the full open backlog. Every item is timing-gated (BIN-170 Nov,
  BIN-189 Aug/Sept, BIN-419 GSC-data Aug 28), ops-blocked on Malin (BIN-173 Adtraction
  account; BIN-402/468/454 TMDB-sweep flip waits on real traffic + manual rules deploy), or a
  decision (BIN-494). No "build" tickets — did NOT manufacture work to fill N.
- **BIN-494 — RESOLVED → Done (keep hard-delete).** The ticket's logged "ANONYMIZE" note was a
  Claude-authored decision that, on verify-first + a top-tier role-org panel (DPO/Legal/
  Security/DBA/TechWriter, all blind, sonnet/low), was found to:
  1. contradict the LIVE privacy policy (`integritet/page.tsx` §6: *"Publikt innehåll
     anonymiseras inte — det raderas helt"*), and
  2. reverse a prior *reasoned* hard-delete decision (`data-retention-policy.md`:
     *"anonymisera är en laglig gråzon vi inte vill testa"*).
  Legal + DPO + Security all returned BLOCK; the legal/product conflict was escalated LIVE
  (AskUserQuestion, since Malin was present) → **she chose status quo (keep hard-delete).**
  Ticket closed with the rationale + the panel's buildable-path notes preserved for any future
  revisit. No code / rules / doc change needed — live policy already matches.

## Panel review logged
`docs/org/metrics/events.jsonl` — one `review` event (tier top, outcome escalated→keep-hard-delete).

## Needs you / still parked (unchanged from 2026-07-14 (a))
- **BIN-173** — open an Adtraction affiliate account, then affiliate deeplinks are a fast follow-up.
- **BIN-402/468/454** — TMDB-sweep "flip to clearing": waits on real user traffic (propagation)
  + a manual `firebase deploy --only firestore:rules`. No rush pre-marketing.
- **BIN-189 / BIN-170 / BIN-419** — scheduled (Aug/Sept, Nov, Aug 28). Leave as-is.

## Follow-ups filed
None. Keeping status quo needs no new tickets; `episodeReactions` identity-strip would only be a
sibling ticket *if* anonymize is ever revisited (noted on BIN-494).

## Deviation log
- [discovery] BIN-494: verify-first + panel found the logged "anonymize" decision silently
  reversed a documented prior decision AND contradicted live published policy copy → escalated
  to founder instead of building. Conservative choice: no edits until she confirmed direction.

---

# Archived — Sprint 2026-07-14 (a) — SHIPPED (BIN-496 + BIN-495 + follow-ups BIN-499/500)

Shipped in e0eb215 + f5e9def (live, purged). Full detail in project memory
`project_sprint_2026-07-14.md`. Not reproduced here.
