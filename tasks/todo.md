# Remediation plan — 2026-07-24 sprint subset (BIN-582/581/566/563)

Fixing the 15 findings from the xhigh `/code-review` on the staged 4-ticket subset,
then shipping what holds. Malin's direction 2026-07-24: "fixa allt nu och släpp det
som håller."

Router: `tier: medium`, panel `[14 Software Architect]` (DBA #27 matched but dropped).
→ one blind critique from #14 on the WatchlistContext write-path change before it lands.

## Ship shape (finding #8 — deploy guard)

`deploy.yml`'s rules/functions drift guard fails the deploy job BEFORE the hosting
step when `functions/**` changes are in the push range. So:

* **Commit 1 — frontend only** (BIN-582/581/563 + their tests). Pushes, deploys hosting.
* **Commit 2 — functions only** (BIN-566: `tmdbTosSweep/{index,runSweep}.ts` +
  `src/test/rules/tmdb-sweep-orchestrator.test.ts`). Needs a manual
  `firebase deploy --only functions:tmdbFieldsSweep`; deploy.yml never deploys functions.

Two commits, pushed separately, so the frontend work is not held hostage by the guard.

## A. `buildWatchlistAddPayload` — invert the contract (#3, #10, #14)

**The defect.** `addItem` writes with `setDoc(…, {merge:true})`: an OMITTED key
preserves the stored value; an explicit `null` DESTROYS it. The helper never omits —
it substitutes `current`'s client-cached value or a `null`/`[]` default. So when
`current` is null (cold load), it writes nulls over a live rating and episode
progress, while its own header promises the opposite.

**Fix.** Make the payload *partial*: omit a field entirely when the caller did not
supply it AND `current` has nothing to carry. Merge then preserves whatever Firestore
holds — which is the only correct answer when the client cache is cold.

* `WatchlistAddPayload` keeps the same `Omit<…>` base with the eight carry-able fields
  optional.
* `carry()` returns `undefined` (→ key omitted) instead of a `null`/`[]` default.
* Restore `??` semantics so an explicit `null` falls through like the pre-diff
  `X ?? current?.X ?? default` chains did (#10) — no caller passes an intentional
  null today, and the migration must not change that behaviour silently.
* Drop the `notes` tier entirely (#14): `addItem` strips `notes` at
  `WatchlistContext.tsx:367` (BIN-505 — notes live in `watchlistNotes/`), so the
  input, the carry and the test assertion all pin a value that cannot reach Firestore.
* Rewrite the header to state the merge contract the right way round.

**Risk.** A genuinely NEW add must still write every field, or the doc lands without
`providers`/`genreIds` and readers that assume arrays break. Guard: the new-add call
sites all pass real values; verified per call site in step D, and the tests pin the
exact key set (#11).

## B. `WatchlistContext.addItem` — stop clobbering on re-mark (#1, #5)

Both fixes use the idiom already established in this file at line 394 ("omit the key
so the merge preserves the existing value"), keyed on the existing `currentForRating`
lookup:

* **`addedAt` (#1)** — currently unconditional, so every status change rewrites the
  original add date (Bibliotek's "Tillagd" sort, `backlogResurface`'s oldest-first
  ranking, taste/stats' 30-day counter, and the GDPR export all read it). Change to
  `…(currentForRating ? {} : { addedAt: serverTimestamp() })`.
* **`tmdbFieldsRefreshedAt` (#5)** — currently unconditional, so a re-mark carrying
  `current`'s cached TMDB values re-certifies stale data as fresh and makes the static
  field-group permanently un-sweepable. Same guard.

**Known residual (accept + document, do not silently ship):** during a COLD load
`items` is `[]`, so `currentForRating` is undefined and a re-mark still looks like a
new add. Stamping is then wrong but omitting is worse (a genuinely new doc would land
with no `addedAt` at all and sort nowhere). This mirrors the same settled-vs-unsettled
ambiguity the providers stamp already documents at lines 381-387. Strictly narrower
than today's behaviour in every settled case; unchanged when unsettled.

## C. `MoviePageClient.handleBevaka` — pass `current` (#4)

The one migrated call site that omits `current: watchlistItem`, so a Bevaka click on a
cold-loaded page rewrites an existing row (rating → null, status → `vill_se`,
`watchedAt` → null). Pass `current`. Note this only fully closes once A lands — with a
cold cache `watchlistItem` is undefined anyway, and A's omit-don't-null behaviour is
what actually protects the stored values.

## D. Call-site re-verification

Re-check all 8 migrated call sites against their pre-diff literals under the NEW
omit-semantics, specifically: does any of them rely on a field being force-cleared?
`StatusButton`'s deliberate explicit-null `totalSeasons` is the known one — it must
keep clearing, so it passes an explicit `null` and A must honour that.

## E. `tmdbTosSweep` audit integrity (#6, #7) — the record that gates `mutateEnabled`

* **#6** `lastRun` is written `set({lastRun}, {merge:true})` and Firestore deep-merges
  nested maps, so `error: true` / `errorMessage` from a failed run are never cleared
  by a later clean run (`buildLastRunAudit` omits those keys on success). Write them
  explicitly `false`/`null` on success.
* **#7** `clearable` is incremented only after `io.commitClears()` resolves for the
  whole page, but the port commits up to 5 batches of 450 per 2000-doc page — a throw
  in a later chunk records `docsCleared: 0` for clears that already landed
  permanently. Count per COMMITTED chunk, not per page.

Both are audit-only (no user-data behaviour change), but BIN-454's runbook reads
exactly this record to decide whether to enable clearing across the whole database.

## F. `.claude/rules/accepted-deviations.md` (#9)

The in-code "do NOT flip mutateEnabled until BIN-566" stop sign was deleted; the rules
file it named as the home of that standing decision still asserts the orchestrator is
untested. Supersede that entry with a dated one recording that the emulator harness now
covers it (append-only, per the file's own contract).

## G. Tests

* **#11** `buildAddPayload.test.ts` uses `toMatchObject`, so nothing pins the exact key
  set — under the new omit-semantics that is the assertion that matters most. Switch
  the carry-path cases to `toEqual` and add a case asserting omitted keys are ABSENT
  (via `Object.keys`), not merely undefined.
* **#12 / #2** `useOptimisticMirrorField.test.ts` is mutation-proved non-discriminating:
  reverting `useIsomorphicLayoutEffect` to a plain `useEffect` leaves all 10 green,
  because RTL's `rerender` is itself `act()`-wrapped. And the "account switch" case
  holds `source` at the same object, so it exercises only the `commitRef` half.
  Rewrite so the account-switch case varies the ACCOUNT while holding `source` at
  `undefined` on both sides — the exact shape that reproduces **BIN-592**.
* Every new/changed test must be mutation-verified: break the branch, confirm the test
  fails, restore. Reasoning is not evidence (this is what the sprint's markers got
  wrong). Snapshot the file before mutating — never `git checkout --` a file that also
  carries real uncommitted work (lessons digest, 2026-07-16).

## H. BIN-592 — the live cross-account leak

Found by this review, filed, and **live on main** (the sprint touched only the test
file). `mirrorRef` re-bases on `[source]`, and `source` is `undefined` on both sides of
an account switch when neither user has saved a price — so one user's price map
survives into the next user's write.

**Decide in-flight:** fixing the hook is a one-line dep change but it is an auth/
profile-write surface. If the fix lands here it goes in commit 1 with a regression
test; if it needs AuthContext restructuring it stays as BIN-592 and the exposing test
is held back rather than shipped failing.

## I. Housekeeping (#13, #15)

* **#13** `.claude/state/workflow-map-stale.json` names two files this diff edits
  (`tmdbTosSweep/index.ts`, `settings/import/page.tsx`). Re-trace ONLY those flows in
  `docs/workflow-map.html`'s `<script id="data">`, run
  `node scripts/check-workflow-map.mjs`, clear the flag. Per the lessons digest this
  goes in its OWN commit — never bundled with feature code.
* **#15** `SeenPosterCard` conveys "Sedd" only as 55% opacity + a `title` on a
  decorative span. Add an accessible name (visually-hidden text), since this component
  now centralizes the gap for both franchise strips.

## Gates before commit

1. `npm run lint`, `npm run typecheck` (root + functions), `npm test` — all green.
2. `binge-code-reviewer` (opus) on the frontend diff; `binge-security-reviewer` (opus)
   on the functions diff; `binge-test-reviewer` (opus) on every changed test file.
   Markers must NAME the files reviewed — read the content, do not trust mtime.
3. Re-run `/code-review xhigh`, rewrite (never bare-touch) `simplify-done.marker`.
4. Rewrite `code-review-done.marker` so it names only what is actually committed — its
   current first entry carries a placeholder `T00:00:00Z` timestamp and describes the
   now-parked BIN-565/564 work, and one entry was flagged as written by an agent that
   was not the reviewer.
