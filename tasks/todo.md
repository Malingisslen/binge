# Plan — namespace the personal-library collections by media type

**Status: EXECUTING — Phase 0+1 built & review-passed, awaiting commit (2026-07-22).**
Both Malin decisions RESOLVED 2026-07-21; Malin approved "fold it in" 2026-07-22. This is a
risky migration under CLAUDE.md's working agreement (Firestore schema + watch-status domain +
GDPR paths). Advisory panel already convened (tier `top`: #27 DBA, #6 DPO, #5 Legal, #4
Security, #14 Architect); their binding conditions are folded in below.

### Execution log — this batch (behaviour-neutral groundwork; no doc renamed yet)
- **Phase 0** done: `mediaTypeDocId`/`normalizeMediaType`/`parseTmdbIdFromDocId` ported to
  client `src/lib/mediaTypeDocId.ts` (byte-identical mirror of the functions helper).
- **Phase 1** done: all 9 `?? Number(d.id)` NaN-landmine read-sites converted to
  `parseTmdbIdFromDocId` (availableNotify, insights/rollup, priceDropNotify, followedSeries,
  streamingOffers ×2, weeklyDigest, WatchlistContext tags/notes maps). Hardened the helper to
  strict `/^[0-9]+$/` so an empty/junk suffix is NaN, not a phantom title-id-0.
- **Extra read-sites** converted (same NaN-safety class): diary.ts `flattenEpisodeProgress`,
  groups.ts `watchlistDocToObject`, useGroupMemberProgress (progress subpath now from the real
  doc id — READ half only; see below).
- **/code-review (xhigh) remediation applied** — F6: migrated 3 client hooks
  (useStreamingOffers/usePriceHistory/useCommunityRating) off inline `${mediaType}_${tmdbId}`
  to the shared `mediaTypeDocId()` (criterion 8; the port was otherwise dead code); F4: server
  test made a true mirror of the client test (drift-net symmetry); F1: comment on
  useGroupMemberProgress flagging the Phase-5 WRITE-half debt.
- **Deferred to a follow-up ticket (all correct today, batch where consumers land in Ph2–5):**
  F5 unify the "field-or-parse-docid" idiom into one `resolveTmdbId(field, docId)`; F3
  string-typed tmdbId robustness; F2 `parseMediaTypeFromDocId` inverse (streamingOffers still
  hand-rolls the mediaType half). ⚠️ Phase 5 MUST namespace the group-watchlist WRITE half
  (groups.ts syncProgressToGroups/setGroupMemberProgress, still `String(tmdbId)`) together with
  the already-converted READ half, or writes land on `123` while reads look under `movie_123`.

---

## The problem
TMDB movie ids and TV ids are independent — movie 123 and TV 123 are unrelated titles. Six
personal-library collections key documents on the bare `tmdbId`, so a user tracking BOTH a
movie and a TV show that share a numeric id gets their status/rating/progress/tags/notes
**cross-contaminated**. Same collision class the recent sprint fixed everywhere on the
server/streaming side; this is the last, highest-blast-radius corner. Rare (needs a same-id
movie+show pair, both tracked) but real, and it touches a user's OWN records + GDPR export.

Collections: `users/{uid}/{watchlist, watchlistTags, watchlistNotes, episodeProgress,
notInterested}` and `groups/{groupId}/watchlist`. Target id: `${mediaType}_${tmdbId}`.

## What the panel VERIFIED (facts, not guesses)
- **Rules-safe**: no rule parses/casts/equality-checks the doc-id wildcard on any of the 6
  paths; indexes are field-based. The id change alone needs NO rule edit.
- **GDPR export + account deletion are code-transparent** — both scan whole collections by
  `d.ref`/`d.id`, never reconstruct a path from tmdbId. Zero code change, safe across mixed
  old/new ids mid-migration. Only the export *docs* need updating (below).
- **9 landmine sites** (DBA found 7, verified 9) do `Number(x.tmdbId ?? Number(d.id))` —
  `Number('tv_123')` is `NaN`. Would silently break the moment any doc gets a prefixed id:
  `functions/src/{availableNotify,insights/rollup,priceDropNotify,shared/followedSeries,
  streamingOffers(×2),weeklyDigest}` + client `WatchlistContext.tsx:212,230` (tags/notes
  listeners). **Prerequisite: fix all 9 before any doc gets a prefixed id.**
- **mediaType is NOT stored** on tags/notes/episodeProgress docs (`{tags}`/`{note}`/
  `{tmdbId,seasons}`) — a reader of a legacy bare-id doc there can't self-resolve type; must
  join the sibling `watchlist` doc. episodeProgress is TV-only by construction.
- **Already-merged data is NOT cleanly recoverable**: `addItem` writes `{merge:true}`, so an
  existing collision already blended the two titles' fields. Migration prevents FUTURE mixing;
  it cannot un-merge history. (Tempers the "repair" value — see decision 1.)
- Cost is immaterial either way under the 25 SEK cap (point-reads ≈ 0.4 SEK for 100k extra;
  the real cost driver is collection scans, which are format-agnostic).

## DECISION 1 — RESOLVED (Malin, 2026-07-21): "no real users yet" → NO backfill.
The panel had split (Architect: lazy-only; DBA/Legal/DPO: + targeted backfill of the collision
set for Art. 5(1)(d)). Malin's answer moots the split entirely: with no real users there are no
already-colliding accounts to repair, so the Art. 5(1)(d) argument has no subject and the
backfill has nothing to fill. **Decision: lazy cutover, no backfill.** New writes go straight
to `${mediaType}_${tmdbId}`. The dual-read fallback is kept only as a THIN safety net for any
existing dev/test data (Malin's own), not a permanent production concern — and could even be
dropped if the dev data is cleanly reset first (offer, don't assume). This is materially
simpler than the plan the panel was critiquing.

## DECISION 2 — RESOLVED (Malin, 2026-07-21): MAJOR export-schema bump.
`watchlistTags`/`watchlistNotes` carry no tmdbId in payload — the doc id is the only title
link, so changing its format changes the `id` field's *meaning*. Per data-export-format.md's own
rule ("Ändra betydelse av ett fält: major") and DPO + Legal recommendation → bump to the next
whole version (e.g. 2.0) with a changelog entry.

## Binding acceptance criteria (folded from the panel)
1. **Prerequisite**: fix all 9 `?? Number(d.id)` sites (require the real `tmdbId` field / drop
   the id-parse) + tested, BEFORE any doc gets a prefixed id. (DBA #1, #4)
2. Every migrated doc carries `tmdbId` + `mediaType` as real fields — never rely on doc-id
   parsing going forward. (DBA #4)
3. **Atomicity**: create-new + delete-old in ONE WriteBatch/transaction per doc — especially
   for tags/notes (free-text = possible third-party PII; a two-await gap risks an orphaned old
   doc resurrecting deleted content). (DPO #3, Security #3)
4. Rules edit ships FIRST, rules-test-verified, IF we add a `mediaType` field to
   episodeProgress/tags/notes (their `hasOnly()` rejects it today). Value-validate the new
   field `in ['movie','tv']` (matches reviews/comments/sessionPicks precedent), mutation-proven.
   (Security #1, DBA #6)
5. `groups/{groupId}/watchlist` is a SEPARATE phase/ticket with its own security review —
   cross-user write surface, backfill via a scheduled Admin-SDK function (not client-triggered,
   to avoid the concurrent-writer race), and NOT "skip if target exists" (a member could
   pre-plant a forged doc to discard real data). (DBA #3, Security #2, Architect #4)
6. The in-memory Map collision bugs (`getItem`, `diary.ts` episodeDiaryEntries join,
   `NotInterested.idSet/has`) ship in the SAME phase as the storage cutover — they're the
   user-visible half; a storage-fixed-but-UI-still-mixed state is worse than not shipping.
   (Architect #3)
7. episodeProgress hardcodes `mediaType:'tv'` with an invariant comment (TV-only by
   construction); tags/notes/removeItem/updateTags/groups mutators/useFriendsWhoSaw get
   mediaType THREADED from the caller (all have it on the title page). (Architect #2)
8. Port/reuse the shared `mediaTypeDocId` helper to a client `src/lib/` module — don't reinvent
   the template literal a 4th time. (Architect #6)
9. `docs/data-export-format.md` updated SAME change (id semantics for all 5 collections + the
   parse rule + changelog); `data-retention-policy.md` gets a one-line dated note; the strategy
   decision recorded in an ADR or accepted-deviations (dated). (Legal #3, DPO #1)
10. Get a production count of actually-colliding doc-ids before sizing any backfill — don't
    guess the blast radius. (DBA #7)

## Recommended phasing (Architect #14, adjusted)
- **Phase 0** — port `mediaTypeDocId`/`normalizeMediaType` to client `src/lib/`. Zero behavior.
- **Phase 1** — fix the 9 NaN-landmine sites (criterion 1). Prerequisite, tested, standalone.
- **Phase 2** — thread `mediaType` through the hard spots (plumbing only, no id change yet).
- **Phase 3** — rules edit (criterion 4) if adding mediaType to tags/notes/episodeProgress.
- **Phase 4** — cutover on the 5 per-user collections + re-key the in-memory Maps (criterion 6)
  + export docs (criterion 9, MAJOR bump), one reviewed unit. NO backfill (Decision 1). Thin
  dual-read fallback only for existing dev data — or drop it if dev data is reset first.
- **Phase 5** — `groups/{groupId}/watchlist`, separate PR + security review (criterion 5). With
  no users the Admin-SDK backfill concern is also moot → simple lazy cutover here too.

Each phase is its own commit through the normal gates. Both Malin decisions RESOLVED
2026-07-21; no open conflict. NOT YET APPROVED TO BUILD — awaiting Malin's go on starting
Phase 0/1 (or parking the plan as ready).
