# Sprint 2026-08-06c — selection

Third pass today. The morning backlog review (34 tickets) and a follow-on sprint run
(`wf_441ff4b8-9f7`) already answered most open questions and built/held back a lot of
green code that a router bug (BIN-787/788: selection trusted a PRIOR run's plan text
instead of re-running `docs/org/route.mjs` on the actual files) then wrongly withdrew.
This selection re-runs the router on every candidate's real files at selection time —
never inherits a tier from a comment or a prior plan.

11 tickets selected across 6 disjoint-file batches. 7 already-answered tickets kept out
per her recorded decision; 1 unanswered parking-brake left untouched; 7 process/tooling
tickets targeting the shared `C:/claude-plugins` engine routed to needsApproval (that
repo can only be edited from a dedicated non-sprint session — established 3+ times
today already).

## Batch A — watchlist (agent: direct)

Three tickets, same domain, kept in one batch even though their files don't literally
collide — all three touch watched/progress semantics and a cross-batch conflict there
would be silent, not a merge error.

- [ ] **BIN-655** [Tier A · build] `addItem` is two functions wearing one name — split
  the bulk-import path from the human mark-seen path.
  Files: `src/contexts/WatchlistContext.tsx`, `src/lib/watchlistWrites.ts`, tests.
  Acceptance:
  - Two distinct entry points exist (bulk/sync vs. human mark-seen) instead of one
    `addItem` inferring intent from opts flags. [diff]
  - Bulk callers (CSV import, onboarding, Collection/Companion "add all") never count a
    rewatch or re-stamp `watchedAt`/`ratedAt`. [diff]
  - All existing call sites migrated to the correct entry point. [diff]
  - The 3 documented stale comments in `watchlistWrites.ts` (BIN-655's own "unreachable"
    → "not intendable" wording, the `sedd→sedd` bullet, the WatchedDateEditor line) land
    in the same change. [diff]

- [ ] **BIN-679** [Tier C · build-review · requiresPlanMode] Let curated Season-0
  specials be marked watched without regressing the progress marker.
  **Malin said build (2026-08-06), but the ticket's own body says this is a watch-status
  MODEL change (new specials marker) — a CLAUDE.md-named sensitive domain. Write the
  short plan block below before touching code; her "build" was not a substitute for it.**
  Files: `src/contexts/WatchlistContext.tsx` (`updateProgress`), the specials section
  component (BIN-580), `src/hooks/useSubscriptionAdvisor.helpers.ts` (read-only check),
  tests.
  Acceptance:
  - A written plan for the model change (new field or equivalent) is recorded here
    before code. [diff]
  - Ticking a curated special never regresses `lastWatchedSeason/Episode`,
    `continueWatching`, or group progress sync for an otherwise-caught-up title. [diff]
  - "Samla klart" meter inclusion/exclusion of specials is an explicit, documented
    choice, not a side effect. [diff]
  - Parks In Review for Malin's visual sign-off (UI-visible). [run]

- [ ] **BIN-689** [Tier A/B · build-review · single #28 pending] BIN-598 part 2 —
  centralize the "watchedAt counts only when status is sedd" predicate (7 hand-copied
  call sites).
  Files: `src/hooks/useServiceValue.ts`, `src/components/pages/DiaryPageClient.tsx`,
  `src/components/pages/UserProfilePageClient.tsx`, `src/app/stats/page.tsx`,
  `src/components/pages/WatchlistPage.tsx`, `src/lib/taste/stats.ts`, `src/lib/diary.ts`,
  new shared helper under `src/lib/`.
  Acceptance:
  - Predicate extracted to ONE shared helper (test-extraction pattern). [diff]
  - All 7 listed call sites migrated to it. [diff]
  - A test kills the mutant "remove the sedd-gate". [diff]
  - Parks for #28 Recommendations / Scoring-Integrity Engineer sign-off before Done
    (router: single, owner not yet convened by a worker). [run]

## Batch B — data (agent: direct)

- [ ] **BIN-759** [Tier A · build] Soften "never a licence to resync the pair" comment
  (BIN-752) so it doesn't contradict open BIN-624, which asks for exactly one controlled
  resync.
  Files: `src/lib/mediaTypeDocId.ts`, `functions/src/shared/mediaTypeDocId.ts`.
  Built, reviewed green, and withdrawn twice already today by the BIN-787 router bug —
  restore from stash `db35c4b36c78f72ec3910229b4969b51cbb6a68f` if still present,
  otherwise rebuild (18 lines, comment-only).
  Acceptance:
  - Both comment copies (client + server) read "not without BIN-624's decision", not
    "never". [diff]
  - Zero executing-code lines changed. [diff]
  - BIN-624 gets a one-line note that the paired comments were reworded 2026-08-06.
    [diff]

- [ ] **BIN-468** [Tier C (functions/**) · build · requiresPlanMode] BIN-402 Stage 2
  leftovers: dedupe `seProviderIds` derivation + add `refreshTmdbFields` integration
  tests. Scope is narrow — items 1–2 already shipped (dc035c5); only items 3–4 remain.
  Files: new `src/lib/tmdb/seProviderIds.ts` (+ test), both page-effect call sites (+
  tests), `functions/src/tmdbTosSweep/` integration test additions.
  Built 3× already today, withdrawn each time by unrelated process bugs (router
  confirms `skip` on these actual files — no panel owed). Restore from stash
  `4c8066cd672c18e64f64a76512bdf6d038e9ed4d` if present.
  Acceptance:
  - Provider-derivation logic deduped into one shared helper; both call sites use it,
    behavior unchanged (SE-only, includes rent/buy). [diff]
  - `refreshTmdbFields` integration tests added (reusable from the reverted 2026-07-11
    attempt; assert the exact payload key set so `nextAir*`/`digitalReleaseDate` can
    never sneak back in). [diff]
  - `tmdbFieldsSweep` / `mutateEnabled` untouched. [diff]

## Batch C — infra-tooling (agent: direct)

- [ ] **BIN-788** [Tier A · build] Ownership map is exact-filename-only — a new file in
  an owned directory silently routes `skip`.
  Files: `docs/org/ownership-map.json`, `docs/org/gen-ownership-map.mjs`,
  `docs/org/route.mjs`.
  Acceptance:
  - Ownership resolves by directory/glob, not only exact filenames. [diff]
  - `src/lib/mediaTypeDocId.ts` and `src/lib/watchlist/**` get an explicit owner (#27
    DBA). [diff]
  - Router output distinguishes "no owner assigned" from "deliberately trivial" (not the
    same tier/reason string). [diff]

- [ ] **BIN-789** [Tier A · build] The `boundaries` key in
  `docs/workflow-map-universe.json` has no test or mechanical enforcement.
  Files: `scripts/check-workflow-map.mjs`, `scripts/check-workflow-map.test.mjs`.
  Acceptance:
  - A `boundaries` entry with no matching universe-file coverage fails the linter. [diff]
  - Renaming the covers-key still enforces the boundary (no silent loss on rename).
    [diff]
  - A test proves the substring match can't over-match unrelated files. [diff]

## Batch D — frontend-copy (agent: direct)

- [ ] **BIN-796** [Tier A · build-review] Delete-account `REQUIRES_RECENT_LOGIN` error
  says nothing about what deleted — silence reads as "nothing happened".
  Files: `src/components/settings/DeleteAccountSection.tsx`,
  `src/components/settings/DeleteAccountSection.test.tsx`.
  Acceptance:
  - New message claims neither "everything deleted" nor "nothing deleted". [diff]
  - BIN-777's test suite updated to the new exact string. [diff]
  - Parks for Malin's wording sign-off before closing (language choice, not technical).
    [run]

- [ ] **BIN-795** [Tier A · build-review] Privacy policy doesn't mention the theme
  localStorage key (persistent, unlike the two documented sessionStorage keys).
  Files: `src/app/integritet/page.tsx`.
  Acceptance:
  - Storage section lists the theme key with type (localStorage, persistent), purpose,
    "no third party access". [diff]
  - No new consent UI, no new legal basis. [diff]

## Batch E — scheduled-jobs (agent: direct)

- [ ] **BIN-727** [Tier C (functions/**) · build · requiresPlanMode] Scheduled-job
  orchestration is untested (12 of 13 have their Firestore logic inside the
  `onSchedule` wrapper). #27 DBA already ran a blind critique 2026-08-06 and rescoped
  it — binding conditions below are theirs, already satisfied by narrowing scope.
  Files: `functions/src/retentionCleanup/` (+ new `SweepIo`-style port + emulator test),
  `functions/src/availableNotify/` (+ emulator test).
  Acceptance:
  - `retentionCleanup`'s read→apply→write loop is exercised against a real Firestore
    emulator via an injected IO port (tmdbFieldsSweep/SweepIo pattern), not a mock.
    [diff]
  - A doc dated exactly at the TTL threshold is NOT deleted; re-running over the same
    data deletes zero additional docs. [diff]
  - `availableNotify`: a second run doesn't re-send, and a user who declined never
    reaches `sendPushToUser`. [diff]
  - `tmdbFieldsSweep` untouched; `mutateEnabled` never referenced. [diff]

## Batch F — recommendations (agent: direct)

- [ ] **BIN-583** [Tier B · build-review] Fas 2 companion-titles recommendations row —
  Malin overrode the panel's "wait" verdict 2026-08-06 ("bygg en första version"); the
  panel's implementation conditions below still bind.
  Files: `src/hooks/useRecommendationsCascade.ts`, `src/lib/recommendations/rowComposition.ts`
  (or equivalent dedup module), new `useRowCompanion` hook + `<CompanionRow>` component,
  `src/lib/franchise/companions.ts` (read-only).
  Acceptance:
  - Score sits in the existing jtbd=C band (between trending=30 and genre-canon=40), no
    hand-picked "high" number. [diff]
  - A companion film already shown in similar/upcoming/latest-fav isn't silently
    duplicated (shared per-pass render set, or the double-show is documented). [diff]
  - `rowMatchesMediaFilter` filters on the companion FILM's own mediaType — dedicated
    tested branch, never falls under "Serier". [diff]
  - Row renders only when the curated connection has something to show. [diff]
  - Parks In Review for Malin's visual sign-off (UI-visible). [run]

## Needs you (Tier D / routed elsewhere)

- **BIN-794, BIN-792, BIN-791, BIN-790, BIN-787** — real process bugs, but every fix
  target lives in the shared `C:/claude-plugins` sprint engine, not this repo. That
  engine can only be edited from a dedicated non-sprint session (established 3× today:
  BIN-754, BIN-779, BIN-781 hit the same wall). Route there by hand.
- **BIN-797** — `firestore.rules` allows `movie_0`, which the client now refuses to
  read. Real but low-severity (orphaned doc, not a forged vote); fold into BIN-624's
  planned rules session rather than a standalone change.
- **BIN-793** — workflow-map baseline drifted 2 flows behind reality. Trivial
  (`--update-baseline`), but not worth a standalone ticket — fold into the next commit
  that touches the map.

## Parked (unanswered — do not build, do not re-ask)

- **BIN-779** (2026-08-06T11:16): "säg till om jag ska ta den i en separat körning,
  eller om den ska ligga kvar. Jag gör inget förrän du valt." — code-review gate reads
  per-batch not per-file; fix lives in `C:/claude-plugins`. Still unanswered.

## Already answered today — not re-asked (see structured plan for the full list)

BIN-754, BIN-658, BIN-603, BIN-565, BIN-613, BIN-558, BIN-521, BIN-170, BIN-402,
BIN-189 (excluded); BIN-590, BIN-559, BIN-541, BIN-454, BIN-766, BIN-781, BIN-624
(blocked on a plan/panel/credential/session only she can start); BIN-646 (obsolete —
2 of 3 points shipped by hand in `a4a1470`, 3rd deliberately deferred).

## Deviation log

(none yet — filled in during execution)

---

# Archive — Batch 2026-08-06 — de fyra biljetter panelen släppte igenom

Byggda för hand, inte i en sprint: efter BIN-776 plockar urvalsspärren ut varje
biljett vars riskklass ligger över `skip`, och motorn har ingen väg att få veta att
kritiken redan är körd. Rollkritikerna kördes i sessionen 2026-08-06 och deras
villkor står som acceptanskrav på respektive biljett i Linear.

## BIN-555 — ägarlöst gruppdokument rullas tillbaka

Panel: #4 Security Architect, #27 DBA, Codebase Archaeologist (alla tre, blint).

Biljettens egen lösning (atomisk batch/transaktion) **byggdes inte** — den är exakt
det BIN-532 shippade och revertade 2026-07-18, med verifierad produktionskrasch:
`members/{uid}`-regeln gör `get()` på gruppdokumentet, och Firestore-regler löser
`get()` mot tillståndet FÖRE commit, aldrig mot en syskonskrivning i samma batch.

Byggt i stället: två separata skrivningar kvar, plus en kompenserande `deleteDoc`
av gruppdokumentet när ägarens medlemsskrivning failar, och felet kastas vidare så
anroparen aldrig får ett id till en grupp som inte finns.

- `src/lib/firebase/groups.ts` — try/catch + rollback runt medlemsskrivningen
- `src/lib/firebase/groups.test.ts` — 2 nya tester (rollback raderar, originalfelet
  kastas även när rollbacken själv failar)
- Mutationstestat: rollbacken bortkopplad → 2 tester faller. Återställt från
  scratchpad-snapshot, verifierat med md5.
- INTE gjort, medvetet: `firestore.rules` orörd (panelens villkor), och ingen
  engångsstädning av redan befintliga föräldralösa dokument — den är en separat
  operativ åtgärd, inte en kodändring.

## BIN-777 — felrutan vid kontoradering får tester

Kritik: #19 Customer Support / Success.

Två av de tre meddelandena delar identisk inledning; skillnaden är klausulen
"Ingenting har raderats.", som är ett löfte om användarens data. Ett delsträngstest
hade överlevt en grenväxling.

- `src/components/settings/DeleteAccountSection.test.tsx` (ny) — 5 tester: exakt
  full sträng per gren, klausulens närvaro/frånvaro, generiska grenen ber aldrig om
  ny inloggning, icke-Error-fel, och att knappen återställs efter fel.
- Mutationstestat: grenarna växlade → testet faller.

## BIN-767 — integritetspolicyn räknar upp sessionStorage-nycklarna

Kritik: #5 Legal / GDPR Counsel.

- `src/app/integritet/page.tsx` — `binge:nextAfterLogin` och `binge:tabSession` med
  typ (sessionStorage, per flik), syfte, livslängd och att ingen tredje part har
  åtkomst. Ingen ny samtyckesruta, ingen ny rättslig grund.
- Uppföljning filad (BIN-795): temavalet i localStorage saknas fortfarande.

## BIN-646 — två av tre id-skevheter

Routern: `skip` på de faktiska filerna (sprinten blockerade den på gissade sökvägar).

- `src/lib/mediaTypeDocId.ts` — (1) en STRÄNG i `tmdbId`-fältet hålls nu till samma
  kanoniska form som doc-id:t, så `'042'` inte längre räddar ett dokument doc-id-
  grenen redan vägrar; (2) `0` är inte längre ett giltigt id — `Number.isFinite(0)`
  är sant, så `movie_0` gick förbi varje efterföljande vakt som en riktig titel.
- `src/lib/mediaTypeDocId.parity.test.ts` — det tidigare pinnade gapet ersatt med
  det nya kontraktet, plus id-0-fallen.
- **Tredje punkten (skrivsidan) byggdes INTE.** Att låta `mediaTypeDocId` kasta på
  ett icke-kanoniskt id ändrar felbeteendet för ~90 anropsplatser, och ingen
  granskare har tittat på den ändringen. Skrivs upp på biljetten som ett medvetet
  val, inte som förbisett.

## Integrationsgranskningens tre fynd — alla åtgärdade

1. Policyn räknade **två** sessionStorage-värden; appen skriver **tre**.
   `binge:lastReportAt` (rapport-cooldown, `src/lib/firebase/reports.ts`) saknades. En
   räknad utsaga i ett juridiskt dokument som är fel dag ett — nyckeln tillagd, siffran
   rättad.
2. Serverkopians kommentar sa fortfarande "The FIELD branch is a true mirror of the
   client copy — keep those two in sync", vilket efter BIN-646 instruerar exakt den
   resync parity-testet finns för att vägra. Omskriven: båda grenarna är nu diverged,
   och varför.
3. `firestore.rules:834` tillåter `movie_0`, som klienten efter BIN-646 vägrar läsa —
   regeln är alltså bredare än sin läsare, och rules-testet påstod att id 0 vore
   legitimt. En rules-ändring är känsligt område med egen plan och manuell deploy, så
   residualen är dokumenterad i testet och filad som **BIN-797** i stället för att
   smygas in här.

Två valfria fynd: metrics-raden för BIN-727 (granskningen kördes, koden landade inte —
skrivet på biljetten) och BIN-555-radens etikett ("reaper" fast det blev en rollback).

## Verifiering

- `npx vitest run src` → 216 filer / 2552 tester gröna
- `npm run typecheck` → rent
- `npx eslint --fix` på alla ändrade filer → 0 fel (4 sedan tidigare befintliga
  varningar i groups.test.ts)
