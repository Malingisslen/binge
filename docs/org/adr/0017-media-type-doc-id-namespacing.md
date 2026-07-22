# ADR 0017 — BIN-560 media-type doc-id namespacing: reset-not-backfill + store-mediaType-as-field

**Date:** 2026-07-22 · **Status:** Accepted (Malin) · **Via:** full role-org panel (tier `top`: #27 DBA, #6 DPO, #5 Legal, #4 Security, #14 Architect) + Codebase Archaeologist, on the phased plan (approve-with-conditions, no block)

## Context
TMDB movie ids and TV ids are INDEPENDENT namespaces — movie 123 and TV 123 are unrelated
titles. Five per-user personal-library collections keyed their docs on the bare `tmdbId`
(`users/{uid}/watchlist|watchlistTags|watchlistNotes|episodeProgress|notInterested/{tmdbId}`),
so a user tracking BOTH a same-numbered movie and show got their status / rating / episode
progress / tags / notes cross-contaminated in their OWN records. The fix namespaces every such
doc id to `${mediaType}_${tmdbId}` (`movie_123` / `tv_1399`). This is the third retrofit of a
media-type composite key (the server-side `titleRatingsAggregate` / `streamingOffers` already
namespace); an ancestor attempt (BIN-523) was **reverted twice** for blast-radius misses.

## Decisions

### Fork A — RESET dev/test data, do NOT backfill
There are no real users yet. Rather than a live data conversion, we wipe the dev/test Firestore
and let every record be recreated in the new format on next write. **Why:** the panel's key catch
was that a lazy per-mutator write cutover on a doc that ALREADY EXISTS does not migrate it — it
**forks** it (the mutator writes a new `movie_123` doc with only that mutation's fields; the old
bare-`123` doc keeps the rest; the watchlist listener has no de-dup by (mediaType,tmdbId), so the
title renders twice with split data). That fork risk is exactly the class BIN-523 was reverted for
twice. Reset sidesteps it entirely — at cutover there are no existing docs to fork — and deletes a
whole category of migration code (no dual-read fallback, no copy-forward-on-touch, no per-doc atomic
migration). The reset is gated behind a mechanical "no real users" re-check performed immediately
before it ships (the single irreversible step; nothing of value is wiped).

### Fork B — STORE mediaType as a real field, not doc-id-parse-only
The docs that lacked a `mediaType` body field (tags/notes/episodeProgress) now carry one, and the
Phase-3 Firestore rules value-check it (`mediaType in ['movie','tv']`, optional-but-validated).
**Why:** panel criterion "never rely on doc-id parsing" — a doc read in isolation (GDPR export,
a future consumer) is self-describing. The doc-id remains the addressing/namespacing source of
truth; the field is redundant belt-and-suspenders. `watchlist` already stored mediaType.

## Consequences
- **Phase 3 (rules) shipped separately and LIVE-first** (0aae24e) — the optional value-check is
  backward-compatible so it can deploy before any namespaced write exists (see the conditional-vs-
  mandatory reasoning in the plan; a mandatory check would have rejected the pre-cutover client).
- **GDPR export schema → MAJOR 2.0** — `id` field meaning changed (encodes `${mediaType}_${tmdbId}`),
  disclosed in the in-export README and `docs/data-export-format.md`. `collectUserDataSnapshots` /
  `deleteAccount` scan by `d.ref`/`d.id` (no path reconstruction) so `KNOWN_USER_SUBCOLLECTIONS`
  needed no change — confirmed, not assumed.
- **communityRatings** (the sole trigger keyed on the `{tmdbId}` wildcard) reads the numeric id from
  the doc body with a `Number.isFinite` guard, since post-rename the wildcard IS `"movie_123"` and
  would otherwise double-prefix.
- **In-memory re-key** (~30 files) composite-keys every Map/Set that mixed movie+TV by bare tmdbId
  (getItem, NotInterested has, tags/notes join, diary showById [fold-fixed by TV source-filter],
  WeekStrip, nextAirByTmdbId, recommendation excludedIds, Tillsammans exclusion, insights rollup),
  shipped in the SAME reviewed unit as the storage cutover (Architect condition: storage + memory
  together, or a window opens where writes land on new ids while reads use old keys).

## Standing follow-up (DBA)
Any NEW per-title user-owned Firestore collection MUST namespace its doc id by media type AT
CREATION. This is the 2nd retrofit; a create-time convention prevents a 3rd.

## Decided by
Malin — Fork A (reset) + Fork B (add-field) chosen via AskUserQuestion 2026-07-22; full panel
returned approve-with-conditions (no block), all conditions folded into the plan's binding
acceptance criteria.
