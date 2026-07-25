# tasks/todo.md — scratch

## ACTIVE PLAN — BIN-593: `watchedAt` is user-authored data

Approved by Malin 2026-07-25 ("bygg nu"), on her product decision, verbatim:
> "har man manuellt justerat 'sett' ska det bara ändras om man själv manuellt ändrar igen"

Stakeholder routing: `node docs/org/route.mjs src/contexts/WatchlistContext.tsx
src/lib/watchlistWrites.ts` → **tier `medium`**, owning role **#14 Software Architect**
(DB-admin #27 dropped by the router). One blind critique dispatched; its conditions are
folded in below under "Panel conditions".

### The rule

Auto-stamp `watchedAt` ONLY when we positively know none is stored. Never auto-overwrite,
never write `null`. The date picker (`updateWatchedAt`) and an explicit `watchedAtOverride`
are the manual paths and always win.

These are `setDoc(..., {merge:true})` writes: an OMITTED key preserves the stored value, an
explicit `null` DESTROYS it. So "don't touch it" means *omit the key*.

### Steps

1. **`src/lib/watchlistWrites.ts`** — `buildStatusUpdate` gains `currentWatchedAt?: unknown`
   with a tri-state contract: a value = stored (don't touch); `null` = known-absent (stamp);
   `undefined` = unknown (stay silent). Stamp condition becomes
   `status === 'sedd' && (watchedAtOverride !== undefined || currentWatchedAt === null)`.
2. **`src/contexts/WatchlistContext.tsx` `updateStatus`** — pass
   `currentItem ? (currentItem.watchedAt ?? null) : (firstSnapshotSettledRef.current ? null : undefined)`.
3. **`src/contexts/WatchlistContext.tsx` `addItem` (line ~392)** — replace the unconditional
   `watchedAt: item.status === 'sedd' ? serverTimestamp() : null` with the same three-way
   rule, using the already-computed `currentForRating` + `firstSnapshotSettledRef`.
   Removing the `: null` half is the other data-loss fix: leaving 'sedd' must not erase the
   date (`useServiceValue.ts:30-32` already documents survival-after-status-change as the
   intended reality).
4. **`src/app/stats/page.tsx`** — `monthlyActivity` iterates ALL items and counts any with a
   non-null `watchedAt`. Now that the date persists past 'sedd', gate it on the existing
   `watched` (status==='sedd') array, matching `useServiceValue`/`DiaryPageClient`.
5. **Tests** — `watchlistWrites.test.ts` (contract change: existing sedd cases must now seed
   `currentWatchedAt: null`; add stored-date, unknown, and override cases) +
   `WatchlistContext.test.tsx` (re-mark preserves; genuine new add stamps; cold load stays
   silent; leaving 'sedd' writes no null). Mutation-verify each new assertion.

### The asymmetry that must NOT be "unified"

`addedAt` (shipped `1c29882`, same function) stamps when UNSURE — a doc with no `addedAt`
sorts nowhere and never recovers. `watchedAt` inverts: a missing date is user-fixable via the
picker, a stomped one is gone forever. So `watchedAt` joins `tmdbFieldsRefreshedAt` and
`providersCheckedAt` in the strict "stay silent when unsure" camp. Comment it at both sites
and pin both directions in tests, or someone will collapse them.

### Open questions

No architecture-changing unknowns. Explicit assumptions:
- **A genuine rewatch (sedd→sedd) no longer re-dates `watchedAt`.** `rewatchCount` still
  increments, and the picker can set today's date. This is the direct consequence of the
  decision; flagged to Malin rather than silently chosen.
- **Consumers are safe.** `DiaryPageClient.tsx:39`, `useServiceValue.ts:30`,
  `UserProfilePageClient.tsx:82`, `WatchlistPage.tsx:210/740` all gate on `status` already.
  `src/app/stats/page.tsx:75` was the only `watchedAt != null` reader — step 4 fixes it.
- **No rules/schema change.** `watchedAt` is an existing optional field; this only changes
  which client writes touch it. No Firestore rules, indexes or migration.

### Panel conditions — #14 Software Architect (medium tier, blind critique)

No BLOCKING findings. All three actionable items folded in and implemented:

1. **SHOULD-FIX — `currentWatchedAt?: unknown` threw away a real guarantee.** Its siblings
   (`now`, `watchedAtOverride`) are `unknown` because they carry Firestore FieldValue
   sentinels; this one only ever comes from `WatchlistItem.watchedAt`. Now typed
   `Date | null`, so no stray truthy non-Date can sail through the strict `=== null` as
   "known, don't touch". **DONE** (`watchlistWrites.ts:74`).
2. **NOTE → done — the rule existed in two hand-written forms.** `buildStatusUpdate`'s
   `stampWatchedAt` and `addItem`'s inline ternary would have had to be kept in sync by eye,
   unlike the sibling `shouldStampProvidersAtAdd`. Extracted to `resolveCurrentWatchedAt()` +
   `canAutoStampWatchedAt()` in `watchlistWrites.ts`, used by BOTH paths, unit-tested
   directly. **DONE**.
3. **NOTE → done — a newly-exposed surface I had missed.** `/my/all` renders
   `WatchlistPage` unfiltered, and `showWatchedCol` is true whenever no status is set. Since
   the date now survives a status change, the "Sedd"-column and "Sedd datum"-sort would have
   started showing a real historical date next to rows currently marked *Avbruten* / *Vill
   se* — where they previously showed "—". Gated both on `status === 'sedd'` via a local
   `seenDate()` helper, so that screen looks exactly as it does today. **DONE**
   (`WatchlistPage.tsx`).

**Escalated to Malin, not silently chosen** (architect: "a product call worth a one-line
confirmation, not a rework"): once ANY date is stored the code cannot tell *auto-stamped and
never touched* from *deliberately backdated* — both are just a Date. So a plain rewatch
(sedd→sedd, never opened the picker) now freezes the seen-date at the first stamp forever,
changeable only via `WatchedDateEditor`. Distinguishing the two would need a new field. This
is the conservative reading of her decision and the only one that doesn't reopen the exact
stomping bug BIN-593 was filed for.

### Review round 2 — `/code-review high` (17 agents) + specialists

The specialists passed the first diff (test-reviewer independently re-ran all 6 mutation
claims and confirmed each). `/code-review high` then found four more things; three were real:

5. **CONFIRMED — my consumer audit was WRONG.** `src/lib/taste/stats.ts:55` counts
   `recent30.watched` from any item with a `watchedAt` inside 30 days, no status gate — and
   it feeds the PUBLIC `ProfileStatsPanel`. With the date now surviving a status change, a
   film marked seen and then dropped kept counting as watched on a public profile for 30
   days, while the Statistik page fixed in step 4 excluded it. Two surfaces disagreeing about
   the same library. **FIXED + tested** (the fixture varies `status`, so the test would have
   been green either way without that).
6. **CONFIRMED — a re-viewing from 'vill se' recorded nothing at all.** Seen 2019 → moved
   back to "vill se" → marked sedd tonight: the date is protected (correct), but `isRewatch`
   only tested sedd→sedd, so `rewatchCount` did not increment either. My own comment claimed
   "rewatchCount records that" — true only for the sedd→sedd route. `isRewatch` now also
   counts "a watch date already exists", which IS the evidence of a prior viewing. Unknown
   (cold load) deliberately excluded — a phantom increment is as unrecoverable as a stomped
   date. **FIXED + 3 tests**.
7. **CONFIRMED — the tri-state could still collapse, in the exact scenario it guards.**
   `items` is a render closure; `firstSnapshotSettledRef` is a live ref read AFTER
   `await fsdb()` (a dynamic import, hundreds of ms on first use). If the first snapshot
   landed during that await, the pair was `items=[]` + `settled=true` → "known-absent" →
   stamp over a backdated date. Fixed by writing `itemsRef` in the same statement as
   `firstSnapshotSettledRef` and having `addItem`/`updateStatus` read the live ref.
   **FIXED + test** (captures the closure before the snapshot, invokes it after).
8. Stale comments in `CompanionSection.tsx` / `MoviePageClient.tsx` asserted the now-reversed
   invariant ("would erase its watchedAt"). Corrected — both guards still stand on the status
   demotion alone.

**Filed, not fixed** (both pre-existing, both outside this ticket's domain):
- **BIN-595** — `addItem` clobbers a per-title visibility override on every re-mark, flipping
  a deliberately-hidden title world-readable. Privacy domain → own plan and panel.
- **BIN-596** — `StatusButton`/`QuickAddButton` aren't gated on the watchlist snapshot, so a
  cold-load "Sedd" lands with no date at all and nothing repairs it. This is the residual
  cost of choosing silence over guessing; closing it makes that branch near-unreachable.

### Review round 3 — `/code-review high` again, on round 2's fixes

Both specialists passed round 2's diff. `/code-review high` then found three CONFIRMED
defects — and the most important one was **my own round-2 fix**:

9. **CONFIRMED, self-inflicted — the broadened `isRewatch` fabricated rewatches.** Treating
   "a stored date exists" as evidence of a prior viewing looks right until you remember this
   same ticket stopped a status change from CLEARING the date: a **mis-click leaves one
   behind too**. Tap Sedd by accident → undo it → genuinely watch the film later → the
   library row renders "x2" for a film seen once, permanently, because `rewatchCount` is
   editable nowhere. **REVERTED to the original sedd→sedd rule**, with a test that fails if
   anyone re-broadens it. Accepted consequence, narrower and non-regressive: a re-viewing
   routed through "vill se" isn't counted as a rewatch — it never was before either.
10. **CONFIRMED — my comment oversold what is shared.** `addItem` was described as sharing
    the predicate "so the two write paths can't drift apart"; only the STAMP half is shared.
    `addItem` has never written `rewatchCount`, so whether a re-mark counts as a rewatch
    still depends on which button was pressed. Comment corrected, asymmetry filed (BIN-598).
11. **CONFIRMED — the date can now be overwritten but never removed** (BIN-597, filed). No
    write path clears it, `updateWatchedAt` only accepts a Date, and `WatchedDateEditor` is
    only rendered while status is 'sedd' — so it becomes unreachable the moment it would be
    needed. On a public profile the date keeps being served in the raw doc even though every
    UI now hides it. Needs a product call ("Rensa datum" in the picker vs strip it from the
    public projection), so it is escalated, not guessed at.

**Judged and kept as-is:** the reviewer's argument that "Aktivitet per månad" now lets a later
status edit rewrite June's history. True, but the alternative reintroduces exactly the
mis-click phantom that finding 9 is about, and the sibling PUBLIC counter had to be
status-gated (round-2 finding 5, CONFIRMED). Consistency wins; noted on BIN-598.

**Also filed:** BIN-598 (two lookup idioms now coexist in `WatchlistContext`; the
"sedd-gated watchedAt" rule is hand-copied at seven sites — two of which were WRONG and had
to be fixed here, one of them feeding a public profile).

### Review round 4 — `/code-review high`, third pass

Both specialists passed round 3. `/code-review high` found ten more; the pattern shifted from
logic to **comments claiming things the code does not do** — which is precisely what round 2's
headline defect was, so they are treated as defects, not nits.

12. **CONFIRMED — "Sedd datum"-sorteringen was a guaranteed no-op on `/my/avbrutna`.** My
    `seenDate()` gate returns null for every non-sedd row, but the sort option was offered
    for any status except 'mina'. Now gated on `showWatchedCol`, the same condition as the
    column it sorts. Introduced by this ticket.
13. **PLAUSIBLE, fixed — `removeItem` never cleared `itemsRef`.** Remove a film carrying a
    2019 date, re-add it as 'sedd' before the delete's snapshot echo lands, and the guard
    read the deleted row as proof a date was stored — creating a fresh doc with no date at
    all. The ref is now pruned immediately after the delete.
14. **CONFIRMED — three comments were wrong.** "written in the same statement as
    firstSnapshotSettledRef" (they are ~28 lines apart; the real invariant is *same callback,
    no await between*); "useServiceValue relies on this survival" (it does the **opposite** —
    it defends against it by gating on status); "shared, not re-implemented, so the rule
    can't drift" (only `canAutoStampWatchedAt` is shared — `buildStatusUpdate` also stamps on
    an explicit override, a branch `addItem` has no equivalent of). All rewritten.
15. **CONFIRMED — my revert comment overstated its own protection.** It justified the narrow
    `isRewatch` as preventing phantom rewatches, but `QuickRateModal` re-marks already-'sedd'
    films without checking and inflates the count anyway (pre-existing → **BIN-599**). And it
    claimed "nothing regressed"; that was false. A re-viewing routed through 'vill se' is now
    recorded NOWHERE, where pre-diff `updateStatus` wrote today's date. Comment corrected to
    say so, and the cost is escalated to Malin rather than buried.
16. **PLAUSIBLE, fixed — untested combination:** 'sedd' over 'sedd' with
    `currentWatchedAt: null` (a re-mark supplying the FIRST date, e.g. a legacy or
    BIN-596-created doc). Test added; both halves of the write must fire.
17. Cross-file comment references pinned exact line numbers that rot on the first unrelated
    edit. Line numbers dropped, names kept.

### Review round 5 — the specialists' own blocking findings

18. **binge-test-reviewer, REQUIRED finding — `removeItem`'s `itemsRef` prune had zero
    coverage.** It proved it rather than asserting it: commenting the line out left all 42
    tests in the file green. Test added (remove a dated 'sedd' film, re-add it as 'sedd'
    before the snapshot echo, assert the new doc gets a FRESH date and is treated as a new
    add), mutation-verified — commenting the line out now fails exactly that one test.
19. **binge-code-reviewer, BLOCKING — a comment that argued with itself.** The `itemsRef`
    block still opened with "written in the same statement as firstSnapshotSettledRef" while
    its own next paragraph corrected that ("not by adjacency, they sit ~28 lines apart"). The
    correction had been added without touching the sentence it was correcting, and the false
    phrasing was repeated at the write site. Both replaced with the actual invariant: same
    `onSnapshot` callback, no await between the assignments.

### Review round 6 — `/code-review high`, fourth pass: eight documentation defects

No runtime bug. Every finding was a comment or test name asserting something the code does
not do — a class that had now appeared in three consecutive rounds, so they were treated as
defects, not nits. All eight fixed:

20. **The KNOWN COST note only described HALF the regression.** It named the
    vill_se→sedd route but not the far more common sedd→sedd re-mark, which counts the
    rewatch yet freezes the date. Root cause spelled out in-code now: there is no
    `watchedAtSource` flag, so "only a manual change may alter it" is implemented as "no
    automatic write may alter ANY stored date" — including one we auto-stamped. Named
    consequence: Streamingrådgivarens films-this-month lens keeps crediting the OLD month,
    so a service actually used this month can read as unused. **Escalated to Malin.**
21. **`watchedAtOverride` was documented as "the MANUAL path" that "always wins" — but NO
    production caller supplies it.** Every `updateStatus` call site passes three arguments;
    the real picker writes through `updateWatchedAt`. Three comments justified the design by
    pointing at an unreachable branch. Corrected to say what it actually is: the kept BIN-91
    signature, not the live path.
22. **The consumer roll-call was wrong in both directions** — said "two more had to be fixed"
    when it was three, and none of the three sibling comments named `WatchlistPage`'s
    `seenDate()`. That list is the only inventory of "who must gate on status", so an
    incomplete one steers the next maintainer straight into an ungated read. Rewritten as one
    accurate list that explicitly says it is NOT a closed set (→ BIN-598).
23. **`WatchlistPage` still carried "TV i 'mina' har aldrig watchedAt"** — an invariant this
    ticket abolishes (`migrateStatus` can map legacy TV docs to 'mina' with the date intact),
    sitting above a condition that no longer keys on 'mina'.
24. **`removeItem`'s prune called itself "belt and braces… the snapshot overwrites this
    anyway"** — inviting removal of a line the tests now make mandatory. It also suppresses
    `addedAt`, which never recovers. Both stated.
25. **Two test names promised more than their assertions prove.** "forwards null vs undefined
    distinctly" asserted null in both halves; "leaving sedd never writes a null" names a write
    that never lived in `buildStatusUpdate` (it was `addItem`'s), so it passes on pre-BIN-593
    code. Both renamed and re-commented to their honest scope rather than deleted — each
    still pins a real half of the invariant.
26. The `addItem` cold-load comment still said "`items` is []" after the code moved to
    `itemsRef`.

### Verification

- `npx tsc --noEmit` clean; `npm test` 2128/2128 (was 2114 before this batch); eslint 0 errors.
- **Mutation-verified, 6 mutations, each restored from a scratchpad snapshot:** bare
  `status === 'sedd'` stamp guard; `=== null` → `== null` in both the inline and the extracted
  predicate; the old unconditional `addItem` write; `firstSnapshotSettledRef` → `true`;
  `updateStatus`'s tri-state collapsed to `?? null`. Every one failed exactly the tests
  written to catch it, and nothing else.
- **NOT test-covered, stated plainly:** the `stats/page.tsx` and `WatchlistPage.tsx` status
  gates. Neither file has a test harness and both changes preserve today's visible behaviour
  rather than introducing new behaviour; comments at both sites carry the reason.
