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

## Batch C — BIN-811 + BIN-809, labelled companion anchors

Malin chose **(c)** on 2026-08-08: anchor on both followed and finished series, but
each suggestion says which. The labelling is the whole reason (c) beat (b).

- **The ticket describes the change wrongly and gets corrected.** The candidate pool
  does not widen: TV never leaves `mina` except to `avbruten`, so a finished show
  (`librarySubState === 'avslutad'`) already anchors the row today.
  `ANCHOR_TV_STATUSES` itself does not change.
- `CompanionAnchor` gains `reason: 'following' | 'finished'`, computed per anchor
  from `librarySubState(item)` — persisted fields only, no new reads.
- **The reason must reach rendered copy.** Today `cascadePrioritizer.ts` joins ALL
  anchor titles into one hardcoded "Eftersom du följer {A, B och C}" string. A
  `reason` field with no consumer is option (b) with extra steps.
- The stale `sedd` comment in `companionSeeds.ts` is replaced with the real
  mechanism (`sedd` is film-only; this is `mina` + derived sub-state).
- **Do not touch `COMPANION_SCORE`.** Flat scoring for this row is an argued #28
  condition from 2026-08-06; per-anchor weighting is a separate, undecided call.
- Alphabetical-by-title sort contract preserved.
- BIN-809: the row's dedup test (a film must not appear in two rows) lands here.
- Known limitation, written down: `librarySubState` is persisted-fields-only and
  lazy-backfilled, so a finished show whose fields were never backfilled keeps the
  "du följer" label. Safe direction — never mislabels an airing show as done.

## Batch D — BIN-655, split `addItem`

`upsertTitle(payload)` for bulk/sync callers; a human-intent mutator for mark-seen.

- **ONE shared payload builder** for all six stamp conditions plus the BIN-505
  notes-strip and the BIN-595 visibility guard — parameterised on intent, never
  copied. The six guards share one evaluation of `currentForRating` /
  `firstSnapshotSettledRef` / `listenerFailedRef` today, and the code states that
  `rewatchCount` and the `watchedAt` re-date must always agree.
- **A parity test**: for a fixed matrix (new-add / re-mark / rating-changed / cold
  load / dead listener / `countsAsViewing`), both new entry points produce the same
  merge payload as today's `addItem` for the equivalent call.
- **A rules-emulator test** that both entry points still satisfy the 22-field
  `hasOnly` allowlist. A differently-shaped payload is a silent `permission-denied`
  in production with no compile-time signal.
- A test pinning the `rewatchCount`/`watchedAt` coherence in the human mutator —
  now the only path allowed to overwrite a user-authored `watchedAt`.
- **All bulk callers move in the same commit** (CSV import, onboarding,
  Collection/Companion "add all"). No interim state.
- BIN-643 rides along only far enough to point its three callers at the right entry
  point. BIN-640 stays separate — it is a read-repair, a different concern.

---

## Acceptance (all batches)

`npm run typecheck`, `npm run lint` (0 errors in `src/` + `functions/`), `npm test`,
`npm run test:rules`, `node docs/org/gen-ownership-map.mjs --check`,
`node scripts/check-workflow-map.mjs` — all green. Each batch its own commit, each
through the repo's own review gates.
