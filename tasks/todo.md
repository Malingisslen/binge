# Plan 2026-08-13c — the six critiqued tickets

Malin's instruction: build all six. The blind single-role critiques ran today and all
six came back **approve-with-conditions**, 25 binding conditions between them. Those
critiques ARE the stakeholder step — do not convene another. Each ticket's conditions
are on its Linear comment; the ones that shape the batching are repeated here.

**Objection recorded, then overridden:** BIN-655's own ticket says "do not do this
inside a feature commit — it wants its own plan and its own review round", and #27
attached six conditions including a parity-test matrix. Built anyway, as the last
batch, with its own commit and its own review round.

**Superseded a concurrent selection.** A different sprint selection wrote itself into
this file at 21:38 local and stopped after Phase 1; no process was running when I
checked. Its copy is preserved in the session scratchpad. One claim of its own is
checked and WRONG and must not be repeated: it said BIN-809/811's work is recoverable
from stash `2d4d2abc…` and should not be rebuilt. That stash is BIN-583's, its files
all exist on main, and `git diff 2d4d2abc HEAD` shows main is AHEAD of it (extracted
helpers, added cap tests). Recovering would be a regression. Build fresh.

---

## Batching — driven by collisions, not by size

| Batch | Tickets | Why together |
|---|---|---|
| **A** | BIN-869 + BIN-834 + BIN-804 (part A) | All three edit `docs/role-responsibilities.md` §25, `CLAUDE.md`'s router-contract line, and/or regenerate `ownership-map.json`. #25 was explicit: two independent regens clobber each other. ONE regen, after all dossier edits are in the tree. |
| **B** | BIN-808 | Own surface (`workflow-map-universe.json` + `check-workflow-map.mjs`). No overlap. |
| **C** | BIN-811 + BIN-809 | Same row, same files. Malin and #28 both said same pass. |
| **D** | BIN-655 | The single write path for every watchlist document. Own commit, own review round. |

Follow-ups to file, not build:
- The mechanical ownership↔gate symmetry check (#25, BIN-869 condition 4 — this is
  the fourth reactive widening and `_note5` already named the trigger).
- BIN-804 part B in the claude-plugins tracker: make `/stakeholder-review` and the
  sprint selector branch on `reasonCode`. **Must not be built from this repo**
  (Malin's standing rule, 2026-08-06).

---

## Batch A — the org/gate surface

### What ships
1. **§25 gains the paths that decide who reviews everything else**, with the reason:
   `.claude/agents/binge-{code,security,integration,test}-reviewer.md` (the four
   instruction files ONLY), `.claude/hooks/{dossier-freshness,map-freshness,preview-gate}.mjs`,
   `docs/org/route.mjs`, `docs/org/gen-ownership-map.mjs`.
2. **`reviewGates` gains matching narrow patterns** for the reviewer instruction
   files and the three hooks. Narrow alternations, not globs — Malin's 2026-08-08
   call, alternative (a), unchanged.
3. **`CLAUDE.md` line 42's router contract** names `reasonCode` (BIN-804 A) and
   `unownedCode` (BIN-834). One line, both tickets.
4. **`route.mjs`'s header comment** names `unownedCode`, not `unmappedCode`.
   Verified against the shipped router: for `docs/org/route.mjs`, `unmappedCode` is
   `[]` and the path sits in `unownedCode`.
5. **`ownership-map.json` regenerated once**, after 1.

### Conditions this batch is bound by
- **The knowledge files stay out.** `*.knowledge.md` / `*.knowledge.archive.md` are
  appended by the reviewers themselves on every ledger run; gating them puts routine
  bookkeeping behind a review — the same call Malin made for `lessons-digest.md`.
- **Both lists move in one commit**, and the blocking one is proven with a
  staged-diff probe, not asserted.
- **Widening only.** No existing pattern narrows.
- **BIN-869's evidence is partly stale and gets corrected on the ticket**:
  `gen-ownership-map.mjs` already matches the gate since `7051a98`; only its §25
  ownership entry is missing.
- **Write down why `route.mjs` gets an owner** rather than keeping the permanent
  #14 fallback, so `docs/org/` does not end up with two unexplained policies.

## Batch B — BIN-808, crash-boundary coverage

- `boundaries` gains the **ten** `error.tsx` files. Recounted with
  `find src/app -name error.tsx` — the ticket's "ten" was right; my own pre-check
  said seven and missed `src/app/error.tsx`, `movie/[id]`, `tv/[id]`.
- **Criterion 2's heuristic is replaced, not implemented.** "Imports `captureError`,
  is not a route or a function export" is a false negative for all ten (they import
  the shared `SegmentError`, which does) and a false positive for
  `src/lib/queryClient.ts`. Replaced with filename-glob enumeration of
  `src/app/**/{error,global-error}.tsx` diffed against `boundaries` — the same
  enumerate-and-cross-check the linter already does for routes and functions.
- The universe file's own "boundaries = HAND-CURATED, not enumerable" comment is
  wrong for this subset and is corrected in the same change.
- An explicit exemption list, one line of reason each, for legitimate non-route
  `captureError` call sites.

## Batch C — BIN-811 + BIN-809, labelled companion anchors  *(refreshed 2026-08-14, in build)*

Malin chose **(c)** on 2026-08-08: anchor on both followed and finished series, but
each suggestion says which. The labelling is the whole reason (c) beat (b).
Router at these files: `medium`, `owned`, panel **[28]** — the same role whose blind
critique ran today, so the stakeholder step is satisfied and no new panel is due.

### Decisions taken during the build

1. **The pool does not widen, and the old comment saying it could was wrong about the
   data model.** `sedd` is the FILM status; a series never leaves `mina` except to
   `avbruten`. "Finished" is a derived SUB-state of `mina`
   (`librarySubState(item) === 'avslutad'`). Finished shows have anchored this row
   since day one. `ANCHOR_TV_STATUSES` is unchanged.
2. **`CompanionAnchor` gains `reason: 'following' | 'finished'`**, computed per anchor
   from persisted fields only — `librarySubState`'s two live-signal arguments are
   deliberately NOT passed, so the row never depends on whether the Streaming advisor
   has loaded.
3. **The reason reaches rendered copy** via a new exported
   `describeCompanionAnchors()`: "Eftersom du följer A och B, och har sett klart C."
   The row's rendered rationale lives in TWO places and `description` now feeds
   BOTH: `RecRow`'s header `why`-line on /recommendations, and
   `RecommendationsExpanded`'s standfirst behind "visa fler →". Without the first,
   the field has no consumer where the user actually is and (c) collapses into (b)
   — see the corrected assumption (a) below.
   **Deliberately a grouped sentence, not a per-card badge** — the row renders TMDB
   film cards with no per-anchor slot, and inventing one is an undecided UI call.
   **The register break is Malin's decision, 2026-08-14.** Both reviewers flagged
   that this is the one `.why` line written as a sentence where its eight siblings
   are lowercase `·`-separated fragments. She was shown all three renderings side
   by side (`tasks/previews/companion-why-line-directions.html`, disposable) and
   chose the full sentence: naming the shows is the point of (c), and the fragment
   variant is (b) again. Do not harmonise this line with its siblings.
4. **`COMPANION_SCORE` untouched** (argued #28 condition, 2026-08-06). Sort stays
   by title only: the film budget is spent in sort order, so grouping by reason
   would silently change WHICH films an over-budget user is offered.
5. **BIN-809** — the cross-row dedup is wired inline in `RecommendationsHub.tsx` and
   consumed in `useRowCompanion.ts`, neither tested. Extracted to
   `RecommendationsHub.helpers.ts` (`excludedIdsForOtherRows`, `exclusionsForRow`)
   per the repo's test-extraction convention, and tested there — a pure-helper test
   is reachable where a hub render is not.

### Known limitation, written down rather than discovered later

`librarySubState` is persisted-fields-only and lazy-backfilled, so a finished show
whose `tmdbStatus`/`totalSeasons` were never written back reads as `'following'`.
One-directional and safe: the row can under-claim, never call an airing show done.

### Files

`src/types/recommendations.ts`, `src/lib/recommendations/companionSeeds.ts`,
`src/lib/recommendations/cascadePrioritizer.ts`,
`src/components/recommendations/RecommendationsHub.helpers.ts` (new),
`src/components/recommendations/RecommendationsHub.tsx`,
`src/components/recommendations/RecRow.tsx`,
`src/components/recommendations/RecRow.helpers.ts` (new — `whyForRow` extracted so it
is testable without RecRow's Firebase-transitive imports), plus FOUR test files.

### Open questions

**No architecture-changing unknowns** — but one of the three assumptions below was
simply WRONG, and is left here corrected rather than quietly rewritten.

**(a) ~~The row's only rendered copy is `RowSpec.description`~~ — FALSE.** The check
actually run asked whether there is a per-anchor SLOT, which is a different question.
`description` renders in `RecommendationsExpanded`'s standfirst only; the row on
/recommendations renders `RecRow`'s `whyForRow`, which hardcoded "kurerad koppling ·
serien fortsätter som film" for this row kind. So the first version of this batch put
the whole label somewhere the user reaches only by clicking "visa fler →" — option (b)
wearing option (c)'s clothes. Caught by the integration and test reviewers
independently; fixed by making `whyForRow`'s companion case read `spec.description`,
pinned by `RecRow.why.test.ts`.

(b) `prioritizeRows` emits at most one companion row per pass — checked, it is a
single `push` behind one `if`. (c) `librarySubState` is importable from the seeds
module without pulling Firebase into the test environment — checked,
`src/lib/libraryView.ts` is a pure helper.
The one genuine product question — per-card badges instead of a grouped sentence —
is NOT taken here: it needs a UI decision Malin has not been asked for, and is
recorded above as the deliberate scope line.

## Batch D — BIN-655, split `addItem`  *(written 2026-08-14, in build)*

Router at the real change set: `medium`, `reasonCode: owned`, panel **[27]** Database
Administrator — the same role whose blind critique ran on 2026-08-13 with six
conditions. That critique IS the stakeholder step; no new panel is due.
(`firestore.rules` is NOT edited — the rules test only reads it, so the `top`/high-stakes
route that including it produces does not apply.)

**The ticket's own objection, recorded and overridden:** BIN-655 says "do not do this
inside a feature commit — it wants its own plan and its own review round". This IS its
own plan, its own commit and its own review round. Malin instructed all six tickets be
built; this is the last and heaviest.

### The shape

`addItem` infers five things from one call and takes a FLAG for the sixth, because
"did a human just say they watched this?" is the one thing a write path structurally
cannot see. That asymmetry has been patched twice at the call site (BIN-599's
`planQuickRateWrite`, BIN-641's `opts.countsAsViewing`).

Two entry points over ONE shared payload builder:

- **`upsertTitle(payload)`** — bulk/sync. CSV import, onboarding, Collection and
  Companion "add all", "Bevaka", the quick-rate pass, and every non-`sedd` quick add.
  Never counts a viewing.
- **`logViewing(payload)`** — the human mark-seen path. May count a rewatch, and when
  it does, re-dates.

"Did a human do this?" is then answered by WHICH FUNCTION YOU CALLED. `addItem` and its
`opts.countsAsViewing` are removed from the context — a boolean a new caller can forget
is exactly the defect.

### What intent may change — and what it may NOT

Intent gates **two** things and nothing else:
1. whether `rewatchFields` applies at all;
2. the `watchedAt` OVERWRITE half of the `sedd` branch (`'rewatchCount' in rewatch`).

The other disjunct — stamping a title's FIRST watch date via `canAutoStampWatchedAt` —
applies to both paths, exactly as today. So `buildAddWrite(item, 'bulk', ctx)` must be
byte-identical to today's `addItem(item)`, and `buildAddWrite(item, 'viewing', ctx)`
byte-identical to today's `addItem(item, { countsAsViewing: true })`. **This is a
refactor with zero behaviour change**, and the parity matrix is what proves it.

Every other guard moves UNCHANGED and shares one evaluation of `current` /
`snapshotSettled` / `listenerFailed`, never a copy: `addedAt` (loose gate),
`tmdbFieldsRefreshedAt` (strict), `providersCheckedAt` (strict + real providers),
`ratedAt` (changed-rating only), `shouldStampVisibility` (BIN-595), and the BIN-505
runtime `notes` strip. The code states that `rewatchCount` and the `watchedAt` re-date
must always agree; the builder keeps them gated on the same computed outcome.

### Where the builder lives

`src/lib/watchlistWrites.ts`, beside the six helpers it already shares with
`buildStatusUpdate`. It must stay Firebase-free (that file is imported by tests that
have no Firebase env), so `serverTimestamp` is INJECTED as a function and the builder
returns a plain object.

### Tests (all six of #27's conditions)

1. **Parity matrix** — new-add / re-mark / rating-changed / rating-unchanged / cold
   load / dead listener × both intents, against LITERAL expected payloads captured from
   the current behaviour. Not a snapshot: a golden table, so a mutation to any guard
   names which cell moved.
2. **Rules-emulator test** — both entry points' payloads satisfy the `hasOnly`
   allowlist (32 keys, counted; the ticket said 22, which was stale), on create AND
   on merge-update. A differently-shaped payload is a silent
   `permission-denied` in production with no compile-time signal.
3. **Coherence** — in the viewing path, a counted rewatch ALWAYS re-dates and a
   re-date is never written without a count. The one branch that overwrites
   user-authored data.
4. **Bulk can never count** — `upsertTitle` on a `sedd → sedd` write writes no
   `rewatchCount` and no `watchedAt`. This is BIN-599 in test form.
5. **Cold load counts nothing on either path** — an unsettled snapshot re-dates
   nothing and counts nothing.
6. **Every caller moved** — a source-scanning guard that `addItem` has no callers left,
   so a later caller cannot resurrect the flag path.

### Callers, all in this commit

`upsertTitle`: `settings/import/page.tsx`, `OnboardingFlow.tsx`, `CollectionSection.tsx`,
`CompanionSection.tsx`, `MoviePageClient.tsx` (Bevaka), `QuickRateModal.tsx`,
`QuickAddButton.tsx` (non-`sedd`).
`logViewing`: `useMarkSeen.ts` ONLY, and only when its caller passes
`countsAsViewing` — today that is StatusButton's "Sedd igen" alone. StatusButton does
not import it; a plain "Sedd" is also a mark-seen gesture and goes to `upsertTitle`.
(An earlier draft of this line said "and StatusButton.tsx", which reads as though the
plain gesture counts — the exact thing Malin ruled out.)

**BIN-643 rides along only far enough** to point its three callers (QuickRateModal,
OnboardingFlow, settings/import) at `upsertTitle`. Gating them on the snapshot is
BIN-643's own scope and is NOT taken here. **BIN-640 stays separate** — it is a
read-repair, a different concern.

### The five stale comments the ticket names, fixed here

- `rewatchFields`' doc calls `buildStatusUpdate`'s `sedd → sedd` branch "unreachable";
  that branch's own comment says only that no caller can INTEND it. → "not intendable".
- ~~`buildStatusUpdate`'s KNOWN COST bullet calls `sedd → sedd` "the common one"~~ —
  **checked and already fixed at HEAD.** No such text exists; the bullet now reads "No
  updateStatus caller can INTEND it". Left listed rather than deleted, because a
  reader comparing the ticket to the commit would otherwise think it was missed.
- ~~"WatchedDateEditor is the way to re-date a re-viewing" is no longer the only way~~ —
  **checked and NOT stale.** The sentence sits inside the `vill_se/avbruten → sedd`
  bullet, and "Sedd igen" only renders on a title already `'sedd'`, so it cannot reach
  one. A clause saying so is added instead, so the next reader does not re-file it.
- `QuickRateModal.test.tsx` names `isRewatch`, a symbol that no longer exists.
- `StatusButton.tsx` re-derives the rewatch predicate inline in JSX instead of asking
  the helper. Taken as a NAMED predicate, not a third `'rewatchCount' in ...` in JSX.

### Open questions

**No architecture-changing unknowns.** Assumptions, checked against the tree first:
(a) the payload builder can be pure — checked, every input is already resolved at the
call site (`findItem`, the two refs, `effectiveVisibilityNow`) and `serverTimestamp` is
the only Firebase touch; (b) `firestore.rules` needs no change — checked, no new field
is written, so `hasOnly` is unaffected and the test only asserts that; (c) removing
`addItem` from the context breaks no test that cannot move with it — to be verified by
the typechecker, and any test fixture calling it moves in this commit.

The genuine risk #27 named is real and is why condition 1 exists: replacing one skewed
function with two that DRIFT. One builder, parameterised, never copied — and a matrix
test that fails the moment the two paths disagree on a cell they should share.

## Acceptance (all batches)

`npm run typecheck`, `npm run lint` (0 errors in `src/` + `functions/`), `npm test`,
`npm run test:rules`, `node docs/org/gen-ownership-map.mjs --check`,
`node scripts/check-workflow-map.mjs` — all green. Each batch its own commit, each
through the repo's own review gates.
