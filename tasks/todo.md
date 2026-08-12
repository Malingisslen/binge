# Plan 2026-08-12 — Selection: 10 tickets, 6 batches

Full backlog review (49 open tickets across Backlog/Todo/In Progress). Comments checked on
every candidate before selection (step 4 of sprint-execute). Most of the backlog is
already-decided-elsewhere (parked on a review session, routed to a dedicated non-sprint
pass, or an explicit "not now") — see the close-out report for the full accounting. This
file only carries what's actually selected to build.

BIN-856 (streamingHealth, In Progress) is NOT in this plan — its code is committed and
deployed; the only remaining item is a `run`-kind acceptance criterion (proof of an HTTP 200
in the live log after the 2026-08-12T19:29Z scheduled run). Nothing to select or build.

## Batch A — infra-governance (agent: direct or generalist)
Area: `.claude/shared-plugin.json`, `docs/org/route.mjs`, `docs/org/ownership-map.json`,
`docs/org/gen-ownership-map.mjs`, `CLAUDE.md`, `docs/org/world-watch/DESIGN.md`,
`docs/role-responsibilities.md`. Disjoint from every other batch.

- [ ] **BIN-851** [Tier A, build] High — the file that decides which reviewers block a
  commit (`.claude/shared-plugin.json`) is itself reviewed by no one (`tier: skip,
  reasonCode: no-code-paths`). Router: skip. requiresPlanMode: false.
  - Add `^\.claude/shared-plugin\.json$` to a blocking gate (binge-integration-reviewer).
  - Give the file an owner in `docs/org/ownership-map.json` so the router stops answering
    `skip`.
  - Widening only — no existing gate narrowed.
- [ ] **BIN-864** [Tier A, build] Low — `scripts/check-public-env.mjs` (the push-VAPID-key
  guard) matches no gate pattern either. Router: skip. requiresPlanMode: false.
  - Add `check-public-env` to `reviewGates[3].patterns`' existing alternation (stay narrow,
    per Malin's 2026-08-08 call).
  - Check `docs/org/route.mjs`'s `TOOLING_CODE_FILES` for the same gap in the same commit.
- [ ] **BIN-834** [Tier A, build] Medium — the router permanently instructs a fix nobody
  will do (owner gap for `route.mjs`/gate scripts). Router: medium, #25 (decided directly by
  Malin — no critique needed, she wrote the exact wording). requiresPlanMode: false.
  - Write down that the permanent #14 reserve IS the decision (DESIGN.md), not a TODO.
  - `CLAUDE.md`'s router-output description names `unownedCode`.
  - `route.mjs`'s header comment names the right field (`unownedCode`, not `unmappedCode`).
- [ ] **BIN-803** [Tier A, build] Medium — the ownership map was hand-edited despite
  "auto-generated, don't edit"; next regen silently drops the fix. Router: skip.
  requiresPlanMode: false.
  - Additions (patternCount, `src/lib/watchlist/**`) live in `gen-ownership-map.mjs` and
    survive a regeneration.
  - Generator fails when an owned folder gets an unowned sibling (BIN-788 pt.2, never built).
  - A worktree regeneration produces the same pattern set as the main checkout
    (`.tmdb-cache/` divergence must not cause drift).

## Batch B — test-infra (agent: direct)
Area: `vitest.config.ts`, `scripts/check-public-env.test.mjs`, `scripts/check-workflow-map.test.mjs`, `scripts/scripts-self-tests-present.test.mjs` (new), `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`. Also touches `.claude/shared-plugin.json` and `docs/org/route.mjs` as follow-through — both are Batch A's declared area, and Batch A is already committed at HEAD, so there is no conflict.

- [ ] **BIN-850** [Tier A, build-review — signoff #7 QA/Test] High — `npm test` never runs
  anything under `scripts/`, including the test for yesterday's push-VAPID guard. Router:
  medium, #7. requiresPlanMode: **true** (single + priority ≤2) — expand this block before
  building, don't halt.
  - ~~Malin's 2026-08-11 decision: rewrite the test files to the project's engine
    (vitest), don't touch CI.~~ **SUPERSEDED 2026-08-12**, watched session: asked whether
    to leave it (CI already runs the guards) or fix it, she answered "fixa det ändå" to a
    description of moving the tests so they run **both locally and at publish, from one
    place**. #8 DevOps's blind critique then made deleting the CI step in the SAME commit
    a binding condition — leaving it would run the same tests twice, two ways, and its own
    comment says it is designed to start failing once this lands.
  - `vitest.config.ts` `include` gains `scripts/**/*.{test,spec}.mjs` additively.
  - BOTH `scripts/check-public-env.test.mjs` and `scripts/check-workflow-map.test.mjs`
    converted `node:test`→vitest — a one-line import change each; every assertion is
    byte-identical, verified against HEAD by the test reviewer.
  - The `Script self-tests` step is deleted from ci.yml AND deploy.yml, and its `MIN=2`
    floor replaced by `scripts/scripts-self-tests-present.test.mjs` (vitest only fails when
    its WHOLE include set matches nothing, so a shrink of these two would hide in the
    aggregate).
  - ~~Out of scope: `check-workflow-map.test.mjs` throws an unexplained `SyntaxError`
    under vitest.~~ **Did not reproduce.** The one-line import change was enough. A
    separate parse failure DID appear mid-build and was blamed on the files' `#!` shebang;
    the integration reviewer could not reproduce that either, and restoring the shebang in
    the real repo passes 20/20 — so the shebang removal was reverted and both guards are
    byte-identical to HEAD. Cause of the original error: still unknown, and no longer
    load-bearing.

## Batch C — streaming-functions (agent: direct)
Area: `functions/src/streamingOffers/motn.ts`, `functions/src/leavingRollup/motnChanges.ts`,
new `functions/src/util/redactVendorBody.ts`. Disjoint.

- [ ] **BIN-857** [Tier A, build-review — signoff #13 Data/Integrations] Low — the same
  masking-before-truncation logic is duplicated in two MOTN clients, untested. Router:
  medium, #13. requiresPlanMode: false. Not urgent, pure maintenance.
  - `functions/src/util/redactVendorBody.ts` exports one shared function both clients
    import.
  - Test pins: a key at position 0 in a body >300 chars is masked BEFORE truncation, never
    after.
  - Existing MOTN tests in both call sites stay green.

## Batch D — auth-deletion-guard (agent: direct, Tier C — plan expansion required)
Area: `src/contexts/AuthContext.tsx`, `src/components/onboarding/OnboardingFlow.tsx`,
`src/components/settings/DeleteAccountSection.tsx` (or wherever it lives — verify path),
`src/lib/firebase/accountDeletion.ts`, new `functions/src/retentionCleanup/` reaper,
`docs/data-retention-policy.md`, `.claude/rules/accepted-deviations.md`, `docs/RUNBOOK.md`.
Disjoint from every other batch.

- [ ] **BIN-816 + BIN-813** [Tier C, build-review — signoff: UX copy + scope growth] High —
  an aborted account deletion recreates `users/{uid}` with a fresh consent timestamp, and a
  second delete attempt can falsely claim "nothing was deleted." Router: **top** (full
  panel — AuthContext.tsx, userData.ts). requiresPlanMode: **true**.
  - **Panel already ran** 2026-08-11 in a watched session (5 roles + archaeologist,
    approve-with-conditions, zero blocks). Both escalated questions answered by Malin the
    same session. Full record: `docs/org/adr/0019-aborted-deletion-marker-scope.md` — read
    before building, all 9 conditions are binding.
  - Every write path that can recreate `users/{uid}` (8 identified, incl.
    `OnboardingFlow.tsx`) goes through one shared chokepoint, not per-call-site patches.
  - Marker set only after `STALE_SESSION_PREFLIGHT` passes, immediately before the cascade;
    `deleteAccount()` and its retry are never gated on the marker; the second-attempt
    "nothing was deleted" message only shows when no write was attempted this session.
  - A server-side reaper (`retentionCleanup` family) deletes Firebase Auth accounts with no
    matching `users/{uid}`, on a stated schedule, independent of the client marker — and
    never deletes on an inconclusive (loading/unreadable) read.
  - `docs/data-retention-policy.md` names the sweep window (this is what makes "delay, not
    breach" honest per Malin's Art. 12(3) ruling); `.claude/rules/accepted-deviations.md`
    records the marker's no-natural-retirement property as a conscious BIN-748 departure.
  - Manual `firebase deploy --only functions` for the reaper is a required follow-up step,
    not assumed done by push.

## Batch E — watchlist-daterule (agent: direct, serial — not inside a parallel batch)
Area: `src/hooks/useServiceValue.ts`, `src/components/pages/DiaryPageClient.tsx`,
`src/components/pages/UserProfilePageClient.tsx`, `src/app/stats/page.tsx`,
`src/components/pages/WatchlistPage.tsx`, `src/lib/taste/stats.ts`, `src/lib/diary.ts`, new
`src/lib/seenDate.ts`. Disjoint from every other batch.

- [ ] **BIN-689** [Tier A, build-review — signoff #28 Recommendations/Scoring-Integrity]
  Medium — BIN-598 part 2: "watchedAt counts only when status is seen" is hand-copied in 7
  files. Router: medium, #28. requiresPlanMode: false.
  - Malin's 2026-08-06 decision: **build it, as its own isolated pass, not bundled with
    other work in the same files.**
  - One shared helper (`seenDate()` or equivalent) replaces all 7 hand-copied call sites.
  - A mutation-style test kills "remove the seen-gate."
  - Do this as a single serial change — not split across a parallel batch (this is what
    sank the third review round last time).

## Batch F — crash-boundaries (agent: direct)
Area: `docs/workflow-map-universe.json`, `scripts/check-workflow-map.mjs`, ten
`src/app/{feed,films,grupper,my,search,series,[...path]}/error.tsx`. Disjoint.

- [ ] **BIN-808** [Tier A, build-review — signoff #15] Medium — BIN-789 part 2 was never
  built: no mechanical detection of crash boundaries, and 10 error.tsx wrappers are missing
  from `boundaries` coverage. Router: medium, #15. requiresPlanMode: false.
  - Malin's 2026-08-08 decision: **build.**
  - The 10 error.tsx wrappers appear in `boundaries` (or are explicitly, justifiably
    excluded).
  - A file importing `captureError`/`trackEvent` without being a route or function export
    is caught mechanically, matching `check-workflow-map.mjs`'s existing approach.

## Needs you (Tier D / needs-approval / parked)

See the close-out report (StructuredOutput) for the full list — `alreadyDecided`,
`needsApproval`, and `parked` buckets. Highlights: BIN-624 (rules change, needs a planned
panel pass, not a sprint), BIN-766 (needs #27's own review session before rebuild — prior
attempt failed data-safety), BIN-754/BIN-790/BIN-781 (fix lives in the shared
`C:/claude-plugins` engine, not this repo), BIN-815 (deploy-hang retry work — her own note
asks for a scheduling decision, unanswered).

## Deviation log

(none yet — filled in during execution)

---

# Archive — Plan 2026-08-12 — BIN-856: MOTN svarar 400 på varje anrop

## Problemet (bevisat, inte antaget)

`functions/src/streamingOffers/motn.ts` byggde varje förfrågan som
`/shows/{mediaType}/{tmdbId}?country=se&output_language=sv`. Leverantören avvisar det sista
värdet:

```
HTTP 400
{"message":"parameter \"output_language\" has an invalid value: sv"}
```

Nio anrop per dygn, varje dygn sedan minst 2026-07-11, noll lyckade. Samma nio tv-id:n varje
dag — urvalet rör sig aldrig eftersom `checkedAt` bara skrivs efter ett lyckat svar.

Verifierat live mot den skarpa nyckeln 2026-08-11: samma URL **utan** parametern ger HTTP 200
för **alla nio** id:n som legat och failat. Alltså inte en utgången nyckel och inte ett ändrat
gränssnitt — ett felformat anrop.

Ingenting nedströms läste någonsin lokaliserad text: `parse.ts` konsumerar bara
`streamingOptions.se` (service-id, type, link, price, expiresOn).

## Router

`node docs/org/route.mjs functions/src/streamingOffers/motn.ts …` → `tier: "medium"`,
`panel: [13]`, inga high-stakes. En blind kritik från #13 Data / Integrations Engineer kördes
före bygget. Utfall: **approve-with-conditions**, två bindande villkor (se nedan).

## Acceptanskriterier

### Del 1 — MOTN-anropet (commit `d3505f8`, deployad 2026-08-11T22:55Z)

- [x] `npx tsc --noEmit -p functions/tsconfig.json` exit 0
- [x] Hela vitest-sviten grön, och `motnRequest.test.ts` syns i en ofiltrerad körning
- [x] Mutationstestat: en mutant som återinför en uppräknad 4xx-lista dödas
- [x] Alla tre grindgranskarna pass (säkerhet, test, integration) — fyra rundor
- [x] **`firebase deploy --only functions:streamingOffersRefresh,functions:leavingRollup`**
- [ ] **Bevis: ett HTTP 200 från MOTN i den skarpa loggen för binge-nu** — Väntar på den
      schemalagda körningen 2026-08-12T19:29Z. ENDA kvarvarande punkten i del 1.

### Del 2 — hälsomätaren (Malins B-svar 2026-08-12, commit `3e74e5f`)

- [x] Kapacitetsberäkningen bit-för-bit orörd; `status` = `worstStatus(kapacitet, flöde)`
- [x] Mutationstestat: alla fem mutanter dödas var för sig
- [x] Kvotslut driver INTE flödesräknaren; ett 404 räknas som levererat
- [x] Två skilda larm — ett trasigt flöde kan aldrig avfyra "överväg betalplan"
- [x] Deploy av del 2 (committed + deployed samma dygn som del 1 per project memory)

## Medvetet utelämnat

- **Extrahera `redactVendorBody()`** — filad som **BIN-857**, nu selected i denna sprint
  (Batch C).
- **`motnChanges.ts` får ingen egen `rejected`-gren** — strukturellt onödigt, se original-
  resonemang i git-historiken.
