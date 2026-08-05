# Sprint 2026-08-04b — land the previous sprint's stranded work, then close its own gaps

Base: `8855ed7` (docs/lessons) on `4397db5` (fix(seo): BIN-687/688). Working tree clean.

**Why "b":** the 2026-08-04 sprint (`sprint-parallel`) built four batches, reviewed and
tested them, then crashed at close-out without committing anything (BIN-743/744 explain
why). Nothing reached `main`. The work is real and green — this sprint's job is mostly
**recovery**, not re-implementation. Do not rewrite from scratch; apply the named
stash/patch, re-verify, then continue past it where a decision was left open.

## Land in this order (dependency chain, not batch-number order)

1. **Agent C (streaming)** — standalone, zero conflicts, lands first.
2. **Agent A (seo-titlepage-recovery)** — touches `useSignedOutRedirect`'s caller list;
   Agent B's patch was rebased to apply cleanly *after* this lands.
3. **Agent B (auth)** — full stakeholder panel MUST run before this is graded done (BIN-744:
   last time it wasn't, and nobody caught it until after the fact).
4. **Agent D (infra-docs)** — re-traces the workflow-map flows that A/B/C just touched, so it
   must run last, in its own commit, never bundled with feature code.
5. **Agent E (social-data)** — independent, any time.

## Agent A — seo-titlepage-recovery [Tier B]

Recover from `git stash apply` on
`sprint-parallel-cleanup-unaccounted-batch-0-2026-08-04-BIN-731-730-734-715-735-titlepage-signedout-contentfloor`
(patch twin, if the stash is gone: `.claude/state/sprint-patches/batch-0-20260804-212000.patch`,
verified applies clean against `main`). 27 tests were green, 3 reviewers (code/test/integration)
read exactly these files. Re-run the suite after applying — don't trust a green claim from
a prior run.

- [ ] **BIN-731** — Signed-out visitors lose the cinema-countdown strip and the Companion
  "lägg till" button entirely (`libraryKnown` is permanently false with no listener running).
  Fix reuses BIN-714's shared `useSignedOutRedirect()` helper — same decision, new call
  sites. Files: `src/components/pages/MoviePageClient.tsx`, `src/components/franchise/CompanionSection.tsx`.
  Disposition: build.
  Acceptance:
  - [ ] Signed-out + logged-out states render the strip/button (not hidden), tap routes to `/login` via `sessionStorage`, never `?next=`.
  - [ ] `useSignedOutRedirect`'s own logic is unchanged — only its caller list grows (confirmed as the right call in the recovery comment).
- [ ] **BIN-730** — `CompanionSection` (`addOne`/disabled) and `MoviePageClient`'s Bevaka CTA
  got BIN-596's `libraryKnown` gate with no dedicated test; the gate can regress silently.
  Files: `src/components/pages/MoviePageClient.test.tsx`, new `src/components/franchise/CompanionSection.test.tsx`.
  Disposition: build.
  Acceptance:
  - [ ] `libraryKnown` in both test mocks is a GETTER derived from `snapshotSettled`/`listenerFailed` (same pattern as `CollectionSection.test.tsx`), not a hardcoded value production can't reach.
  - [ ] Mutation-verified: removing the gate fails exactly these new tests.
- [ ] **BIN-734** — Person-page biography was gated on a bare truthy check while
  film/series pages use `hasSubstantialText`; applying that same function here would
  delete every short-but-real biography on the site (mutation-tested — it turns the new
  BIN-687 test red). Correct fix (already reasoned through, reused as-is): gate on
  `biography.trim()` only (kills whitespace-only stubs), add the code comment explaining
  why `hasSubstantialText` is deliberately NOT used here, keep the pinning test.
  Files: `src/components/pages/PersonPageClient.tsx`, `src/components/pages/PersonPageClient.test.tsx`.
  Disposition: build.
  Acceptance:
  - [ ] A thin-but-real Swedish biography (e.g. "Svensk skådespelare, född 1974.") still renders on the page.
  - [ ] `<meta description>` still uses the generated line via `buildPersonDescription`'s 60-char rule — page body and meta stay allowed to differ (that's the decision, not a bug).
  - [ ] **Do NOT** apply `hasSubstantialText` to the visible biography — that is the literal one-liner this ticket exists to reject.
  - Note (out of batch — gitignored, cannot be done by a batch, see Housekeeping): the decision still needs a manual entry in `.claude/rules/accepted-deviations.md` on Malin's machine so a future scan doesn't re-flag it.
- [ ] **BIN-715** — No test pins that the film/series pages actually call the shared
  `hasSubstantialText` threshold for the visible body paragraph — today only the helper
  itself is tested. Files: `MoviePageClient.test.tsx`, `TVShowPageClient.test.tsx`.
  Disposition: build.
  Acceptance:
  - [ ] Each test renders the real page body (not `isLoading: true`) with a thin (<60 char) description and asserts the paragraph does NOT render.
  - [ ] Must land together with BIN-735 (same files) — resolve both in the same commit.
- [ ] **BIN-735** — **Needs Malin's A/B call, built as A.** BIN-688 reused the 60-char
  `MIN_SUBSTANTIAL_TEXT` snippet-quality threshold to gate whether the film/series body
  paragraph renders at all — a real, short, true description now vanishes and is replaced
  by the generated sentence. Built (Alternative **A**, per the recovery comment's own
  recommendation): render the real short description **and** the generated sentence
  together on thin pages — two paragraphs, page loses nothing. Alternative B (real text
  only, one paragraph, meta-only threshold) was NOT built.
  Files: `MoviePageClient.tsx:317`, `TVShowPageClient.tsx:307` + tests.
  Disposition: build-review.
  Signoff: **RESOLVED 2026-08-05 — Malin picked A**, live in this session, shown both
  layouts side by side before choosing. A ships as built; B is not to be re-proposed.
  (The ask was: it changes the visible layout on every thin long-tail film/series page.
  Recommendation was A — the generated sentence carries real utility (where to stream)
  and dropping it would weaken exactly the pages that need the most search help.)
  Acceptance:
  - [ ] Whichever alternative ships, pin the user-visible outcome in a test (not just the helper).
  - [ ] Land in the same commit as BIN-715 (shared files, sequential dependency).

## Agent B — auth [Tier top, requiresPlanMode]

Recover from `.claude/state/sprint-patches/batch-1-20260804-211200.patch` (6 files, 12 new
tests, verified applies clean against `main` **after** Agent A lands — it conflicted with
Agent A's `useSignedOutRedirect.ts` changes before that).

- [ ] **BIN-732** — BIN-669's fix (landed 4397db5-lineage, `isSigningOut()` flag) only
  covers the tab that actually called `signOut()`. Firebase Auth broadcasts the logout to
  every same-origin tab via a storage event; a second tab on a guarded page also sees
  `uid → null`, but its own `isSigningOut()` is `false`, so it remembers ITS OWN page as
  the return path. Narrow blast radius (shared device, multiple tabs, next person picks up
  the leftover tab) but real: a leaked `/grupper/<id>/` URL exposes the group's name +
  member uids (`firestore.rules:973-974`, `allow read: if isSignedIn()` — accepted
  "unlisted link" model, same family as ADR 0015 — not a new hole, just a new way in).
  Fix direction (from the recovery comment, already built): listen to the
  `onAuthStateChanged` transition itself rather than trusting the local flag — clear
  `binge:nextAfterLogin` whenever uid goes from set to null for ANY reason, and only
  remember a return path when uid was ALREADY null when the guard mounted (a genuine
  bounce must still be remembered).
  Files: `src/contexts/AuthContext.tsx`, `src/components/auth/AuthGuard.tsx` (deviation:
  half the fix could only live here, not in the file the original plan named — reasonable,
  keep it), + 4 more per the patch.
  Disposition: build-review.
  **requiresPlanMode: true.** Router: `node docs/org/route.mjs --md src/contexts/AuthContext.tsx`
  → tier **top**, full panel (#5 Legal/GDPR, #27 DBA). **This is the exact failure BIN-744
  documents — last time this ticket's panel never ran and nobody caught it before commit.**
  The panel MUST convene on this specific diff (not batch-0's green status — no reviewer
  touched this code yet) before it counts as done. If the executing agent cannot dispatch
  the panel itself, STOP and hand this ticket back rather than build-and-hope.
  Acceptance:
  - [ ] Full panel (#5 Legal/GDPR, #27 DBA) runs against THIS diff specifically; its binding conditions are folded in before commit.
  - [ ] A second-tab test: tab B (never called `signOut`) does not remember its page as a return path when tab A signs out.
  - [ ] `isSigningOut()`'s doc comment is updated — it currently claims coverage it doesn't have (the exact gap this ticket closes).
  - [ ] A genuine bounce (signed-out visitor opens a deep link) still remembers the page — the fix must not regress that.

## Agent C — streaming [Tier A]

Recover from `.claude/state/sprint-patches/batch-2-20260804-205700.patch` (3 files,
+72/−9, includes a new test, verified applies clean against `main`, no conflicts with
anything else this sprint).

- [ ] **BIN-733** — The streaming-offers box waits ~22s before giving up, not the 10s its
  own per-attempt budget implies: `useStreamingOffers`' 10s `Promise.race` timeout doesn't
  match any of React Query's no-retry predicates (`permission-denied` /
  `unauthenticated` / `not-found`), so the shared client retries once after a ~2s backoff.
  Fix (built): add `streamingOffers timeout` to the no-retry predicate in
  `src/lib/queryClient.ts` — a timeout after an already-generous 10s budget isn't worth a
  retry. Two clean extractions along the way: the retry predicate became a named function
  (was anonymous, untestable without a full client), and the duplicated error string became
  a shared constant.
  Files: `src/lib/queryClient.ts`, `src/hooks/useStreamingOffers.ts` (or wherever the error
  string lived), + the new test.
  Disposition: build.
  Acceptance:
  - [ ] A hanging connection now gives up in ~10s, not ~22s — pinned in a test against the REAL client config (`useStreamingOffers.test.ts` runs with `retry: false` by design and cannot catch this on its own).
  - [ ] No other query type's retry behavior changes.
  - [ ] Mutation-verified (remove the predicate entry, confirm the new test goes red).

## Agent D — infra-docs (workflow-map re-trace) [Tier A, own commit]

- [ ] **BIN-706** — `.claude/state/workflow-map-stale.json` has been live since
  2026-08-01, re-stamped as recently as 2026-08-04T05:24, and has now survived three
  sprints untouched (`docs/workflow-map.html` last updated `dc71bdd`, before any of
  today's or the last two days' changes). **Run this LAST**, after Agents A/B/C land, so
  it documents what's actually on `main` — not what a flag guessed hours ago.
  Disposition: build.
  Acceptance:
  - [ ] Re-trace ONLY the flows whose nodes match the CURRENT flag's `triggers` at the time this runs (read the file fresh — don't copy the list from this ticket, it will be stale by the time Agent D starts).
  - [ ] Update only `docs/workflow-map.html`'s `<script id="data">` JSON — nothing else in the file.
  - [ ] `node scripts/check-workflow-map.mjs` passes; `.claude/state/workflow-map-stale.json` is deleted.
  - [ ] Committed ALONE — never bundled with feature code (2026-07-10 lesson: a feature revert would silently drop the flow docs too).

## Agent E — social-data (mediaTypeDocId parity test) [Tier A]

- [ ] **BIN-636** — The client (`src/lib/mediaTypeDocId.ts`) now rejects aliased swipe doc
  ids (`movie_042`, `zmovie_42`); the server copy (`functions/src/shared/mediaTypeDocId.ts`)
  still accepts them — a deliberate, documented divergence (BIN-618/624). Nothing enforces
  that the two stay apart on purpose rather than by accident; a future "resync these files"
  cleanup would silently reopen the client-side hole with every test still green.
  Files: new parity test (e.g. `src/lib/mediaTypeDocId.parity.test.ts`), read-only against
  both `src/lib/mediaTypeDocId.ts` and `functions/src/shared/mediaTypeDocId.ts`.
  Disposition: build.
  Acceptance:
  - [ ] A test asserts the client rejects at least one id shape (`movie_042`) the server still accepts — it must FAIL loudly the day the two files are made to match again.
  - [ ] BIN-624's Linear description gets the residual-risk note this ticket asks for (which server paths still parse an aliased id) — a comment is enough, doesn't need code.
  - [ ] No production code changes — this ticket is test/doc only, per its own scope.

## Needs you (Tier D / needs-approval — not built this sprint)

- **BIN-700 / BIN-643 / BIN-729 — one UX decision, three sites.** When the watchlist
  listener is unreachable (dead permanently, or just not loaded yet), should the app show
  an honest "couldn't load your library, try again" state, or retry silently in the
  background? Automation has declined to build any of the three twice now (2026-08-02 and
  2026-08-04) specifically because the naive version — just blocking until the list is
  in — was tried once already and reverted: it produced a library that *looked* confidently
  empty (with delete buttons next to nothing), which is worse than a spinner. All three
  tickets are the same question from different angles (CSV import, quick-rate modal /
  onboarding, and the read-side empty state) and should get one answer, not three. My read:
  option (a), an honest error state with retry, is safer than a silent background retry a
  user can't see progress on — but the visual form is yours to set.
- **BIN-732's panel is the gating risk for this whole sprint, not a footnote.** Restated
  here because BIN-744 exists precisely because this got missed last time: if whoever
  executes Agent B cannot itself convene a full stakeholder panel, that ticket must NOT be
  graded done on green tests alone.
- **BIN-624** — rules change (`firestore.rules` swipe doc-id format guard) is explicitly
  out of autonomous-batch scope per its own body (sensitive domain, needs a manual
  `firebase deploy --only firestore:rules`) and needs a decision on whether the server
  (`functions/src/shared/mediaTypeDocId.ts`) should adopt the client's stricter parsing.
- **BIN-707** — sprint-patches directory hygiene. Same mechanical trap as BIN-585 below:
  `.claude/` is gitignored, so a sprint batch can't write there and no diff-based gate can
  see it done. Now worse than when filed: today's run added a fresh set of undated
  `batch-0/1/2/3.patch` sitting next to their already-dated twins
  (`batch-0-20260804-212000.patch` etc). Needs a direct pass in a normal session: verify
  each undated file is byte-identical to its dated twin (md5), then delete the duplicate —
  never rename blind.
- **BIN-585** — one-line fix, `.claude/shared-plugin.json` → `roadmapDocs: []` (both listed
  files are confirmed deleted). Failed via the sprint mechanism three times running for the
  same structural reason (`.claude/` is gitignored — no batch can write it, no gate can see
  it). **This session tried the direct edit too and was blocked by the permission
  classifier** — so even a same-session direct edit isn't the fix; it needs Malin's own
  hands on the file, or an explicitly-granted permission first.
- **BIN-743 / BIN-744** — both are about the sprint-engine's own close-out and risk-gate
  behavior. The fix lives in `C:/claude-plugins` (the shared `delivery`/`workflow-guards`
  plugins), not in this repo — building it from inside a binge sprint is the exact
  poisoned-session pattern the 2026-08-03 lesson warns about. Route to a dedicated
  `C:/claude-plugins` session.
- **BIN-189 (seasonal challenges)** — already fully planned and panel-approved
  (2026-07-13, `~/.claude/plans/binge-bin189-seasonal-challenges.md`, full panel
  approve-with-conditions), build window "a calm week in Aug/Sept," launch Nov 1. Not
  scheduled into this sprint — it's a multi-week feature (new Firestore collection +
  rules + GDPR export update) that also needs you to author the first challenge's content
  before it can ship. Worth booking its own week rather than splitting across ticket batches.
- **BIN-521 (bundle-rådgivare)** — still routed to its own `/stakeholder-review`
  (Monetization + Data/Integrations) per your 2026-07-18 call, reaffirmed 2026-07-29. Not
  reopened here.

## Deviation log

*(append as Agents A–E run: `- [deviation|discovery|needs-human] <id>: <plan said> → <found> → <conservative choice>`)*

## Gates

Each agent: `npm run typecheck` on changed files → targeted tests → full `npx vitest run`
before the sprint's last commit. Reviewers per `.claude/shared-plugin.json` `reviewGates`
(ledger mode). Agent B's security marker must show it read `AuthContext.tsx`/`AuthGuard.tsx`
from THIS diff — a marker naming only Agent A's files does not cover it (2026-08-04 lesson).
Push once, at the end — `deploy.yml` is hosting-only, no rules/functions in scope this
sprint. Cloudflare purge after the deploy goes green.

---

# Recovery session 2026-08-03c — land what three sprints built and never shipped (ARCHIVED — fully shipped)

All five steps landed: BIN-596/598/617/701 (`3a0632e`), BIN-664/659/669 (`17d799b`),
BIN-714 (`6a5d641`), BIN-638 (`e78b878`), BIN-687/688 (`4397db5`). Housekeeping items
BIN-707/706 were NOT fully done by that session — see BIN-707/BIN-706 above, carried
forward into this sprint.

Base: `ea5e6b5` (local, unpushed docs commit) on top of `b557be6`. Working tree clean.
All material verified present: `stash@{2}` (batch 0), `stash@{1}` (batch 1), `stash@{0}`
(BIN-638 tests), `.claude/state/sprint-patches/2026-08-03-0026-batch-4.patch` (SEO,
`git apply --check` clean).

(full original plan text omitted from the archive — see git history of this file if the
detail is needed again; the acceptance conditions that mattered are captured in the
lessons digest and in the commits themselves.)
