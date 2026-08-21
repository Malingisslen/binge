# Accepted Deviations — archive

Entries removed from `accepted-deviations.md` on 2026-07-25 during `/context-diet`, kept
verbatim. This file is their **readable** record — grep it when you need to know why a
deviation was once written down, or to reconstruct a decision's history. Never loaded
into context.

**Correction (2026-08-12, BIN-803):** this header used to say "`.claude/` is gitignored, so
git history does NOT preserve these". That is false — `.claude/rules/`, the agents, the
hooks and `shared-plugin.json` are all tracked; only per-run state is ignored
(`state/`, `worktrees/`, `cache/`, `hooks/sessions/`, `hooks/__pycache__/`,
`linear-tracker.json`, `scheduled_tasks.lock`, `*.doctor-backup`). Git does preserve
retired entries; this file exists so nobody has to read a diff to find them. The same
false premise was corrected in `rules/accepted-deviations.md` in the same commit, and it
matters beyond tidiness: since BIN-803 a path survives into `docs/org/ownership-map.json`
only if git tracks it.

Two removal reasons appear below:
- **superseded** — a later dated entry explicitly replaced it, and keeping both in an
  always-read file meant a reader could act on the stale half.
- **duplicate** — the same rule is stated, with the same rationale, in a file that is
  already loaded at the moment it matters (`CLAUDE.md` or `design-system.md`). Removing
  the copy changed nothing about what is in force. The live location is named per entry.

---

## Superseded 2026-07-25

### [Testing] tmdbTosSweep's orchestrator ships untested in DRY-RUN mode only — re-decided on true facts
`functions/src/tmdbTosSweep/index.ts` has no unit/emulator test driving the orchestrator
itself: BIN-507 criteria #1 (thrown get/commit still writes the lastRun audit, then re-throws)
and #2 (a second invocation resumes its cursor) are proven at the pure-helper layer in
`./logic.test.ts` only. **Why:** the file imports firebase-admin entrypoints the root Vitest
suite cannot load, so covering it means extending the emulator harness. Count-only dry-run
writes nothing to user data, so the gap is acceptable there.
**IMPORTANT — this supersedes the rationale that lived in the code comment.** That earlier note
justified the gap with two claims the 2026-07-20 Legal panel proved FALSE: "this repo runs NO
functions test runner" (vitest.config.ts includes `functions/src/**/*.test.ts`) and "neither
firebase-functions-test nor @firebase/rules-unit-testing is installed"
(`@firebase/rules-unit-testing` is a devDependency with a wired `npm run test:rules`). A
deviation may not rest on false premises, so Malin re-decided it against the true ones:
**dry-run stays acceptable untested; `mutateEnabled` may NOT be flipped until the emulator
harness covers the orchestrator (BIN-566).** This function writes to EVERY user's watchlist,
so "review-gated, not test-gated" is insufficient for the mutating mode. Do not file "add
functions tests for tmdbTosSweep dry-run"; do not treat the flag as flippable on review alone.
— 2026-07-20

> Superseded by the 2026-07-24 entry: BIN-566 landed, so test coverage is no longer the
> blocker. The live entry states the remaining BIN-454/468 gates.

---

## Removed as duplicates 2026-07-25

Each was stated twice in always-on context. The surviving location is named; none of these
rules changed.

### [Design] Poster hover transform is intentional
`translateY(-2px)` on `.poster` at card hover deviates from the old "no transform/scale on
hover" rule. **Why:** deliberate design call for Direction H; the old rule no longer applies
(recorded in CLAUDE.md Design Constraints). Do not file "remove hover transform". — 2026-06

> Live in `.claude/rules/design-system.md` (Posters och duotone), including the "avsiktlig"
> wording. Loads whenever `src/**` or CSS is read.

### [Design] Duotone hover reveal has no transition
Poster hover sets `filter: none` momentarily with no transition. **Why:** SVG filter → none
cannot be interpolated; a transition is technically impossible, not forgotten. — 2026-06

> Live in `.claude/rules/design-system.md`, same section, same rationale.

### [Architecture] No `next/image`, explicit `<img>` everywhere
**Why:** static export (`output: 'export'`) has no image optimization pipeline; `<img>` with
explicit width/height + lazy/async is the decided pattern. Do not propose next/image. — Sprint 1

> Live in `.claude/rules/design-system.md` (Generella designregler).

### [Performance] Per-title React Query persistence is forbidden, not missing
`shouldPersistQuery` persists ONLY small shared catalog queries; per-title data
(`tv-lite`/`movie-lite`/`tv-season`/`watch-providers`) is never persisted. **Why:** per-title
persistence scales with library size and blew the 5 MB localStorage cap in production
(watch-providers alone was 1396 of 1409 KB). Firestore's IndexedDB cache already makes
revisits fast. Do not file "persist more queries for offline speed". — 2026-06

> Live in `CLAUDE.md` → TMDB staleTime → React Query-persist, same figure.

### [Build] The ~25k-title pre-render count is load-bearing
Build-time TMDB pre-rendering of `/{tv,movie,person}/[id]` is slow-ish by design and must NOT
be cut to speed up builds. **Why:** the catch-all shell is `noindex` by default, so a
non-pre-rendered title indexes unreliably; the file cache + refresh budget already fixed the
build-time mechanics. Do not file "reduce generateStaticParams for CI speed". — 2026-07

> Live in `CLAUDE.md` → Deployment ("Skär inte ner pre-render-antalet…").

### [Product] TV has no 'sedd' terminal state
Film: `vill_se` → `sedd` (terminal). TV: its whole life lives under `'mina'` with a DERIVED
sub-state; TV is never "done". A data-model review may flag the asymmetry — it is the core
product design (shows return from the dead; "vill se en serie" IS following it). Do not file
"unify film/TV status models". — 2026-06

> Live in `CLAUDE.md` → WatchStatus → **Designval**, same rationale.

### [Data] Firestore may carry legacy watch-status strings for months
Lazy client-side migration (`migrateStatus`): docs are rewritten only when the user touches a
title, so `'följer'`/`'vill_se'`-on-TV and English v1 statuses persist in Firestore
indefinitely. Readers normalize. **Why:** rewriting the whole collection would cost writes for
zero user value (Blaze cost cap); the schema contract is "readers normalize", not "storage is
clean". Do not file "inconsistent status data / missing backfill migration". — 2026-06

> Live in `CLAUDE.md` → WatchStatus → **Migration**, same "läsare normaliserar" contract.


---

**Retired 2026-08-20 (BIN-942) — superseded.** The entry below accepted the visibility
cascade's refusal on a LEGACY bare-numeric id, and said in its own words that the same race
on a CANONICAL id was still open. BIN-942 closed that half: `cascadeVisibilityToItems` now
uses `batch.update` (which cannot create), and `firestore.rules` gained a create-only
required-field floor. Its replacement in `rules/accepted-deviations.md` is dated 2026-08-20
and accepts a DIFFERENT thing — the floor's refusal of the ordinary edit paths in the same
race. Kept verbatim below because the file header requires it and because the shape of what
was accepted on 2026-08-19 is the reason the replacement is scoped the way it is.

### [Data/UX] Synlighetskaskaden nekas — med flit — när den råkar återuppväcka ett legacy-id
`cascadeVisibilityToItems` (`src/contexts/AuthContext.tsx:265`) gör
`batch.set(d.ref, {effectiveVisibility, isPublic}, { merge: true })` på referenser den läst
ur en snapshot. Medan dokumentet finns är det en update. Raderar användaren titeln mellan
`getDocs` och `batch.commit()` är merge-mot-ett-borta-dokument i stället en **create**, och
på ett grandfathered bara-numeriskt id nekar BIN-766:s `canonicalWatchlistDocId` den.

**Accepterat:** att nekandet sker, och att det tar hela sin chunk med sig. **Why:** Malins
beslut 2026-08-19. En create under ett icke-kanoniskt id är exakt den alias-multiplikation
BIN-766:s spärr finns för — regler läser form, inte avsikt, så nekandet är spärren som gör
sitt dokumenterade jobb, inte en olycka. Att bygga om kaskaden så den tål ett nekande
avfärdades uttryckligen.

**Omfång — fyra axlar, så tystnaden inte får betyda mer än den ska:**
* **Mekanism:** bara `set(merge:true)` på en snapshot-referens vars dokument hunnit
  raderas. `taste/backfill.ts:74` (`updateDoc`) kan aldrig nå create-grenen; de två
  id-byggande skribenterna kan aldrig avge en alias-form.
* **Allvarlighet:** en batch är allt-eller-inget, så upp till 449 syskon i samma chunk
  blir ostämplade. Det landar i `visibilitySyncPending` (BIN-587, posten 2026-07-30) och
  självläker: nästa `getDocs` ser inte det raderade dokumentet, så samma post kan inte
  fälla igen.
* **Räckvidd:** bara grandfathered bara-numeriska id:n. Kanoniska id:n nekas ALDRIG —
  se nedan.
* **Tid:** gäller tills de sista pre-BIN-560-dokumenten är borta. Mängden krymper bara.

**INTE accepterat, och fortfarande öppet:** samma kapplöpning på ett **kanoniskt** id.
Formen matchar, `isValidWatchlistItem` är ett `hasOnly`-tak utan golv för obligatoriska
fält, och kaskaden återskapar då den raderade titeln som ett tvåfältsspöke
(`effectiveVisibility`, `isPublic`) på den publikt läsbara vägen — vilket avslöjar att
kontot hade titeln efter att användaren bett om att få bort den. Verifierat mot emulatorn
av #7 QA, filat som **BIN-942**. #6 Dataskyddsombudet krävde att den halvan skrivs som
öppen och inte får läsas in i beslutet ovan. Läs alltså aldrig den här posten som att
återuppväckandet är löst — det är löst för legacy-id:n. — 2026-08-19
