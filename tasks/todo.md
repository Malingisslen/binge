# Sprint plan — 2026-08-16 (Selection)

Auto-sized N=7 across 4 batches. Linear: connected, scoped to project "Binge" in
team "Binge" throughout. Backlog/Todo/In Progress pulled (~55 open tickets); most
of the swamp is 2026-08-05→08-14 sprint-engine postmortems and self-created
"needs your decision" tickets that are still unanswered — those are excluded below,
not silently dropped (see **Parked** and **Already decided**).

## Batch A — auth-account-deletion (agent: direct, NOT a parallel worktree)

Full-panel ticket in this batch (BIN-909) — router returned `top` on the combined
fileset. Per BIN-744/BIN-776: a full-panel ticket must go to a worker that can
actually convene the panel, decided at selection, not discovered at the commit
gate. `suggestedAgent: direct` for the whole batch for that reason — do not hand
this to a parallel batch worker.

- [ ] **BIN-908** [Tier A] `build` — `src/components/settings/DeleteAccountSection.test.tsx`
      Scope THIS SPRINT to finding 1 only (the missing `recent-login` +
      `DELETION_HANDED_OFF`-absent test fixture). Finding 2 (a comment-only
      widening in `accepted-deviations.md`) is explicitly NOT to ship as its own
      commit — the ticket says so; that file lives inside the integration gate's
      pattern and a solo edit invalidates the ledger for nothing. Leave it filed,
      fold in next time that file is genuinely open.
      Acceptance:
      - [diff] New test case covers `recent-login` classification WITHOUT the
        `DELETION_HANDED_OFF` tag (the pre-`try`-block throw path), asserting
        `toast.show` fires with `RECENT_LOGIN_MSG` + `RETRY_ACTION`.
      - [diff] `accepted-deviations.md` is untouched in this diff.
      - [run] `npx vitest run src/components/settings/DeleteAccountSection.test.tsx` green.

- [ ] **BIN-909** [Tier C, full-panel] `build-review` — `src/contexts/AuthContext.tsx`
      requiresPlanMode: true (top tier). Router: 5 Legal, 27 DBA, 4 Security,
      6 DPO, 19 Support. Real GDPR bug: a user who deleted their account, then
      returns on a DEVICE WITHOUT the local deletion marker, gets a
      freshly-dated `termsAcceptedAt`/`ageConfirmedAt` fabricated for them —
      manufactured consent, not a delayed deletion (Legal's words). ADR 0022
      accepted the cross-device gap itself; it explicitly did NOT accept this.
      Ticket's own text: "Bygg den INTE i en obevakad sprint." Convene the panel
      on the real fileset before writing code.
      signoffReason: what counts as "markedly older" `creationTime` (hours/days,
      and the boundary), and what the re-consent screen actually says — both are
      Legal/DPO calls, not implementation details.
      Acceptance (binding conditions are #6 DPO's, copied verbatim in intent):
      - [diff] The guard lives in the profile-recreation path itself (currently
        inline in `AuthContext.tsx`), NOT only in `userDocWrite.ts` — the
        localStorage-only fix is a no-op on a second device, which is the whole
        point of this ticket.
      - [diff] No new field/subcollection/sibling doc under `users/{uid}` to
        solve this — ADR 0019's ban stands, reconfirmed by ADR 0022.
      - [diff] `retentionCleanup`'s candidate condition and `withinOrphanCeiling`
        are not weakened — this is a write-time fix, not a detection change.
      - [run] A test drives the whole path: old `creationTime` → profile
        missing → page load → assert NO backdated stamp was written (not just
        that the wait/branch was entered).

- [ ] **BIN-911** [Tier B, legal-gated] `build-review` — `src/components/layout/DeletionLimbo.tsx`
      requiresPlanMode: true (legally-approved copy, pinned text). Router
      (combined fileset): 5 Legal, 19 Support own it. The "cleaned up within 7
      days" promise is only true on the device the deletion started on; ADR
      0022 (2026-08-15) accepted that the cross-device population now never
      gets swept — so the sentence is now false for that group permanently, not
      "not yet true." Reviewer's own suggestion is a clause, not a rewrite; do
      NOT ship new copy without #5 Legal's sign-off on the exact wording.
      signoffReason: does a device caveat belong on a screen meant to be short
      and calming, or should this instead gain an action line ("what to do if
      you change your mind") — and does BIN-909 shipping make this less urgent
      (the reappearing-profile path gets its own explicit re-consent step)?
      Acceptance:
      - [diff] No copy change lands without a comment citing #5 Legal's
        approved wording (or the ticket is left as a filed, unbuilt finding if
        Legal hasn't signed off this sprint — do not guess the sentence).
      - [diff] The rest of the pinned BIN-877/BIN-813-condition-4 text
        (heading, lede, the sweep paragraph, the contact-email fallback) is
        untouched verbatim.

## Batch B — community-ratings

- [ ] **BIN-766** [Tier A, single] `build` — `functions/src/communityRatings/runAggregate.ts`,
      `src/test/rules/community-ratings-orchestrator.test.ts`
      Malin's decision 2026-08-06: run #27 DBA's blind critique first, THEN
      build with its conditions as binding acceptance criteria (this sprint's
      Phase 1.4 does that automatically for `single` tier — router: medium,
      owner #27 DBA). Verified still open at HEAD: `aggregateDocId()` in
      `runAggregate.ts` returns a namespaced `watchlistDocId` VERBATIM once
      `parseMediaTypeFromDocId` recognizes the prefix — so a malformed/aliased
      id like `movie_042` still buckets separately from `movie_42`, splitting
      that title's rating average. BIN-727's refactor moved this logic but did
      not fix it.
      Acceptance:
      - [diff] When the path already carries a namespace prefix, the aggregate
        id is derived via `mediaTypeDocId(pathMediaType, parseTmdbIdFromDocId(docIdRaw))`,
        not `docIdRaw` verbatim — so `movie_042` and `movie_42` land in the same
        bucket.
      - [diff] `Number.isFinite`-style guard on the parsed id (per BIN-624's
        panel note: a strict server parser must not let `mediaTypeDocId('movie', NaN)`
        become the string `"movie_NaN"`).
      - [diff] #27 DBA's blind critique ran (Phase 1.4) and its must-haves are
        folded in here, not left as a deviation note.
      - [run] `firebase deploy --only functions` (targeted) — manual, Tier D,
        after this lands on main; note it as "Needs you" in close-out.

## Batch C — watchlist-seen-date (own isolated pass — DO NOT run alongside another batch)

Malin's decision 2026-08-06: "JA — bygg den, som ett eget litet pass," explicit
that it must NOT be bundled with other watchlist work and must run SERIALLY, not
inside a parallel sprint batch (her words, ticket body: "inte inuti en parallell
sprint-batch"). Honour that literally — if this sprint's execution is the
parallel/worktree kind, pull this batch out and run it alone, before or after the
others, not concurrently.

- [ ] **BIN-689** [Tier B, single] `build` — `src/lib/taste/stats.ts`,
      `src/hooks/useServiceValue.ts`, `src/components/pages/DiaryPageClient.tsx`,
      `src/components/pages/UserProfilePageClient.tsx`, `src/app/stats/page.tsx`,
      `src/components/pages/WatchlistPage.tsx`, `src/lib/diary.ts`, new
      `src/lib/seenDate.ts` (test-extraction root per `.claude/rules/code-style.md`)
      requiresPlanMode: true (her explicit isolation condition, 7 files).
      Router: single, owner #28 Recommendations/Scoring-Integrity (one unowned
      path, `src/app/stats/page.tsx` — note only, doesn't block). A prior build
      exists reusable as notes only, NOT as a drop-in patch — verify against
      current main first (stash sha `7d56bff15021ef21cbaf54822f95bad988e4c89a`
      is 11 days stale as of today and main has moved under it since).
      Acceptance:
      - [diff] One shared `seenDate()`-style predicate/helper in `src/lib/`,
        and all seven listed call sites migrated to it in the SAME change — a
        helper with unmigrated callers is dead code.
      - [diff] A test kills the "remove the `sedd` gate" mutant.
      - [diff] `UserProfilePageClient`'s in-place array mutation and the
        `/stats` "Sedd" counter's own array are deliberately left alone unless
        the diff shows a reason to touch them (per the prior build's notes).
      - [run] #28's blind critique ran (Phase 1.4) before this merges.

## Batch D — infra-tooling

- [ ] **BIN-880** [Tier A, single] `build` — new symmetry-check script under
      `docs/org/`, corrections to `.claude/shared-plugin.json`'s `_note5`/`_note6`
      requiresPlanMode: true (High priority + single tier). Router: medium,
      owner #25 Engineering Manager. Fourth reactive gate-widening incident in a
      row (BIN-830/851/864+873/869) — build the mechanical check instead of a
      fifth patch. Acceptance criteria are the ticket's own (copied verbatim):
      - [diff] A test fails when a path gets an owner in `route.mjs`/
        `ownership-map.json` with no matching blocking pattern in `reviewGates`,
        or vice versa.
      - [run] Mutation-proven: remove one of BIN-869's seven new gate patterns
        and the test fails.
      - [diff] The exception list carries one reason per entry, and a
        now-unnecessary entry fails instead of rotting silently.
      - [diff] `_note5`/`_note6` in `.claude/shared-plugin.json` corrected —
        both currently claim in past tense that this ticket was already filed,
        which was false.

- [ ] **BIN-906** [Tier A, single] `build` — `docs/org/route.test.mjs`
      Five non-blocking findings from BIN-874's review, safe to fold in now
      that BIN-880 has the file open. Acceptance:
      - [diff] The `describe` block at line ~463 is renamed to its true scope
        (tooling `.mjs` only) and names the two uncovered pattern classes
        (`.claude/**` config files, `.github/workflows/**`).
      - [diff] The tautological `Set` dedup assertion at line ~288 is removed
        or gets a one-line reason to stay.
      - [diff] A named assertion on gate-object shape runs BEFORE the loop that
        iterates `reviewGates`, so deleting a whole gate object fails cleanly
        instead of via an unguarded property-read crash.
      - [diff] One block-comment line documents that untested tooling `.mjs`
        files with no `.test.mjs` sibling (`docs/org/metrics/log_event.mjs`,
        `docs/org/world-watch/local-tooling/hooks/org-retro-due-check.mjs`) are
        invisible to this check — narrow-before-broad per Malin's 2026-08-08
        call, not a request to widen anything.

## Needs you (Tier D) — nothing new this sprint

Manual functions deploy for BIN-766 lands after Batch B merges (see above).

## Already decided (excluded from batches, not re-asked)

- **BIN-624** (swipe doc-id firestore.rules guard) — 2026-08-05: build it, but as
  a planned rule-change pass with the #4/#6/#27 panel, NOT a sprint ticket. Half 1
  shipped (`6373f6a`). Half 2 additionally waits on #27's free document-count.
- **BIN-797** (movie_0 swipe id) — 2026-08-08: only as part of BIN-624's pass,
  never alone — and that pass is itself routed out of sprints (above).
- **BIN-603** (postcss/sharp CVEs pinned in Next) — 2026-08-06: wait for Next to
  update upstream. "Frågan är därmed besvarad och ska inte ställas igen."
- **BIN-541** (MOTN vendor quota) — 2026-07-29: blocked on Malin reading the
  Nokia API Hub/RapidAPI dashboard (daily vs monthly cap, and the number).
- **BIN-559** (ensureUserProfile offline-safe create) — 2026-08-06: routed to
  its own design pass; needs a written plan before any code (server-side
  profile creation, sign-in path).
- **BIN-558** (>100 groups truncation) — 2026-07-29: leave as-is, no action —
  hypothetical at current traffic.
- **BIN-613** (First Load JS baseline) — 2026-07-29: yes, but as its own
  dedicated job touching `deploy.yml`, reporting-only at first, never a sprint
  pick.
- **BIN-521** (bundle-rådgivare nudge) — 2026-07-18: routed to its own
  `/stakeholder-review`, not sprint work, per the ticket's own text.

## Parked (unanswered — excluded, not re-asked, not downgraded)

All five below are Claude's own "Behöver ditt beslut" notes from the 2026-08-14
review sweep. No later comment answers any of them.

- **BIN-905** — DeleteAccountSection contact-line reasoning wrong for 2/4 error
  branches, no test. Her decision needed on whether it earns its own slot.
- **BIN-896** — Swedish diacritics (å/ä/ö) lost in two comment blocks moved by
  BIN-655. Cosmetic, comment-only; recommendation was to fold in opportunistically.
- **BIN-895** — Re-view confirmation toast can lie in a sub-second cross-device
  race; the recorded count is never wrong, only the sentence.
- **BIN-894** — `tags` can structurally slip into the public-read watchlist doc
  (same shape as the notes leak); nothing sends it there today.
- **BIN-891** — `docs/workflow-map-universe.json`'s other two lists (guide hub,
  premiere calendar, one background job) have already drifted; the freshness
  guard only watches one of three lists.

## Obsolete (premise gone — verified against current main, not just git log)

- **BIN-904** — claimed `docs/org/gen-ownership-map.test.mjs`'s
  regenerate-identically case is red at HEAD. Verified 2026-08-16:
  `npx vitest run docs/org/gen-ownership-map.test.mjs` → 11/11 green.
- **BIN-902** — claimed the shebang line in `scripts/check-workflow-map.mjs` /
  `scripts/check-public-env.mjs` stops vitest 4 from collecting their test
  files. Verified 2026-08-16: `npx vitest run scripts/check-workflow-map.test.mjs
  scripts/check-public-env.test.mjs` → 2 files, 55/55 green. Resolved by
  BIN-838/BIN-850 (`405a2fc`, `af433aa`).

## Not triaged this run

The backlog carries ~40 more open tickets, almost all 2026-08-05→08-14
sprint-engine postmortems (patch-recovery bookkeeping, review-ledger gaps,
metrics-file accuracy — several explicitly note the fix lives in
`C:/claude-plugins`, a different repo/session) plus a handful of "idea"-labeled
speculative tickets (BIN-170, BIN-189) and BIN-781 (an outcome-reviewer grading
bug, Todo state, not yet comment-checked). None were selected; none were
force-classified. They remain exactly where they were for the next pass.

## Deviation log

(none yet — this is the selection phase; execution appends here.)

---

# Archive

## Plan — BIN-915 avgjord: den svalda transaktionsfelvägen accepteras (closed 2026-08-16)

Datum: 2026-08-16. Bevakad session. Malin: *"jag accepterar risken vid tillfälligt
fel i betygsättningen snarare än att införa en kostnad."*

Det här var inte ett bygge. Det var att skriva ned ett beslut på de tre ställen
som påstod att det var oavgjort — och att stänga biljetten. Klart: `.claude/rules/accepted-deviations.md`
fick den daterade posten, `runAggregate.ts` och testfilens kommentarer rättades,
BIN-915 stängdes som Canceled 2026-08-16. Ingen kodväg ändrades.
