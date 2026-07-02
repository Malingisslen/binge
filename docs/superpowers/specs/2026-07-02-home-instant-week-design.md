# Home "instant week" — Phase A polish + Phase B next-air denormalization

**Date:** 2026-07-02 · **Status:** Approved by Malin (design + legal recommendation)
**Panel:** top-tier, full panel convened (Security #4, Legal #5, DPO #6, Architect #14,
DBA #27, plus earlier Recs-Integrity #28). All verdicts: go-with-conditions — every
binding condition is folded in below as acceptance criteria.

## Problem

Measured 2026-07-01 (real account, prod): home fires ~216 TMDB requests per cold
load. The progressive-hero fix (d1d58c1) unblocked the hero at ~9% of the fan-out,
but three symptoms remain: (1) a ~2s beat before the hero (auth → watchlist →
first TMDB resolve), (2) detail surfaces visibly trickle in behind the hero,
(3) one focal "upgrade swap" reads as flicker.

## Phase A — polish (small)

**A2′ App Check chunk prefetch.** Keep the documented boot ORDER in
`AuthContext.tsx` (`await initAppCheck()` before `onAuthStateChanged` — it guards a
documented hang; two reviewers independently blocked reordering). Instead, start the
`firebase/app-check` dynamic-import download earlier so the awaited init is mostly
chunk-cache-hit. Update the code comment to say why the order is load-bearing.

**A3 Transition smoothing.** Brief CSS fade on skeleton→content swaps on the home
page (design system: no new shadows/gradients; opacity transition only).

**Dropped (do not resurrect):**
- Focal flicker guard — `pickFocalEntry` over an accumulate-only entry set is
  monotonic (focal can only move earlier). The swap is one correct upgrade; Phase B
  removes it by being right on first paint.
- Auth/App Check parallelization — blocked (Security + Architect).

## Phase B — denormalize next-air onto watchlist docs

### Fields (flat, on `users/{uid}/watchlist/{tmdbId}`)

| Field | Type | Notes |
|---|---|---|
| `nextAirDate` | string \| null | YYYY-MM-DD, next episode air date (TV) |
| `nextAirCode` | string \| null | e.g. "S2E03" |
| `nextAirProvider` | string \| null | streaming-service short name for the show |
| `nextAirUpdatedAt` | timestamp | freshness stamp (cache-marker, like `providersCheckedAt`) |
| `digitalReleaseDate` | string \| null | movies: Swedish digital release (type 4 SE) |

### Write path (read-repair)

- New module `src/lib/watchlist/nextAirReadRepair.ts`:
  - pure `computeNextAirFields(show|movie) → fields` (Firebase-free, unit-tested)
  - thin `writeNextAirReadRepair(uid, tmdbId, fields)` via `fsdb()`, best-effort,
    swallowed errors — modeled on the `setRuntime` precedent.
- Called from ONE place (the calendar fan-out hook layer), keyed off
  `dataUpdatedAt` so it fires once per resolved title, not per render.
- Writes batched (`writeBatch`), coalesced per session; strict no-op when values
  unchanged (null vs absent-field is NOT a diff).
- The home fan-out itself is the repair trigger → entire library populated after
  ONE visit; ended shows get `nextAirDate: null` written once and then quiesce.

### Shared derivation (removes existing duplication)

Hoist `getNextAirInfo` (the more complete variant, from
`useSubscriptionAdvisor.helpers.ts:131-150`, incl. seasons-array fallback) into
`src/lib/calendar/nextAir.ts`. Consumers: `buildEntries.ts`, advisor helpers, and
the read-repair module. `digitalReleaseDate` reuses `pickSwedishDigitalRelease`
from `src/lib/calendar/releaseDate.ts`. No third implementation, ever.

### Read path (home)

Denormalized fields are adapted into `CalendarEntry`-shaped seed values feeding the
SAME `pickFocalEntry`/render path as today; the live TMDB fan-out overwrites them
as it resolves. One code path, two data sources — no forked renderer. **Escape
hatch (Architect):** if the adapter is not trivially small, ship Phase B fields for
advisor/calendar use only and defer home integration to its own follow-up.

### Rules (deploy FIRST, manual `firebase deploy --only firestore:rules`)

- Add the five fields to `isValidWatchlistItem`'s `hasOnly([...])` whitelist
  (`firestore.rules:91-101`) — without this every write is silently rejected.
- Size caps mirroring existing precedent: dates/timestamps `is string && size() <= 32`
  (where string), `nextAirCode <= 16`, `nextAirProvider <= 80`.
- Extend `src/test/rules/firestore-rules.test.ts` with accept AND reject cases.

## Acceptance criteria (binding, from panel)

1. Rules whitelist + caps deployed and rules-tested BEFORE any client write ships.
2. Read-repair writes NEVER include `updatedAt` — unit test asserts the payload
   excludes it (protects `continueWatching.ts:108` "most recent activity" sort).
3. Single writer: one shared reconciliation path; the same show's delta written at
   most once per session across calendar/advisor/title-page consumers.
4. Idempotence test: stable show → zero writes across repeated resolutions.
5. Advisor untouched: `useSubscriptionAdvisor`'s own fetch set and
   `useCalendarEntries().isLoading` strict semantics unchanged (BIN-lineage: prior
   review conditions still stand).
6. LWW across tabs/devices explicitly accepted for these derived fields (documented
   in the module header — they're recomputable, unlike `communityRatings`).
7. `docs/data-export-format.md` watchlist field table updated (also closing the
   pre-existing `providers`/`providersCheckedAt` documentation gap).
8. `<JustWatchCredit />` remains in view wherever `nextAirProvider` renders (home
   already carries it; any FUTURE surface — notification/email/share — needs its own).
9. No new paid services; write volume trivially within the 25 SEK/mån cap.

## Legal decision (Malin, 2026-07-02)

TMDB ToS §1.C caps caching at 6 months. Watchlist docs already store TMDB-derived
fields indefinitely (title/posterPath/providers/…) — same risk class, pre-existing.
**Decision: accept and ship; file a Linear ticket** for a future refresh-or-clear
sweep covering ALL denormalized TMDB fields older than 6 months (not a gate for
this work). AI/ML-use prohibition not applicable (display data only).

## Sequencing

1. Phase A (A2′ + A3) — small, ships independently.
2. Phase B step 1: rules + rules-tests, manual rules deploy.
3. Phase B step 2: `nextAir.ts` helper hoist + `nextAirReadRepair.ts` + tests.
4. Phase B step 3: home read path (seed adapter) — or deferred per escape hatch.
5. Re-measure live (baseline: 216 requests, hero at ~9% of fan-out; target: hero +
   week strip correct on first paint from snapshot).

Commit-gate reviewers (code/security/test) run on opus per the global model rule.
