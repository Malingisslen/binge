# tasks/todo.md — scratch

## ACTIVE PLAN — BIN-608

A post-cutover vote hides every pre-cutover vote on the same title.

### What's broken

BIN-569 moved Tillsammans swipe docs from `sessions/{id}/swipes/{tmdbId}` to
`swipes/{movie_N|tv_N}`. The read path in `indexSwipes` falls back at the **document**
level:

```ts
byKey.get(candidateKey(candidate))?.votes ?? legacyByTmdbId.get(candidate.tmdbId)?.votes ?? {}
```

`swipes.votes` is a MAP that every participant appends to. So the first vote cast after
the deploy creates a namespaced doc holding one entry, and that doc — being present —
suppresses the legacy doc holding everyone else's. Anna/Bo/Cissi vote pre-cutover; Anna
votes again post-cutover; Bo's and Cissi's votes vanish from the tally. A veto that was
already spent (`vetoRemaining: 0` on the participant doc) becomes un-re-castable.

Reachable for any session in flight across the deploy of 0c83c45. Binge is pre-launch, so
the realistic blast radius today is small — but it silently discards user-authored data,
which is never acceptable.

### Stakeholder routing

`node docs/org/route.mjs src/lib/together/matching.ts src/lib/firebase/sessions.ts` →
`tier: "skip"` (no owning role). No panel required.

### The fix

**Read-side value-level merge, namespaced wins per participant.** In `indexSwipes`, when
both a legacy and a namespaced doc exist for the same number, return
`{ ...legacyVotes, ...namespacedVotes }` instead of picking one document.

#### Deviation from the lessons-digest entry — write-side fold-forward is NOT done

The digest entry written 2026-07-28 prescribes "fold legacy forward on write". Rejected,
deliberately:

- `recordSwipe` was made read-free on purpose (M4) because a read-modify-write clobbered
  concurrent voters. Re-adding a `getDoc` walks that back.
- Folding legacy votes into the namespaced doc would overwrite a participant's *newer*
  namespaced vote with their *older* legacy one (Bo votes `no` pre-cutover, `yes`
  post-cutover, then Anna's write folds `no` back over it).
- The read-side merge already delivers the whole outcome — every vote counts, newest wins
  — with no write-path risk.

Legacy docs are left to expire with their session.

#### Known, accepted ambiguity

A legacy doc keyed on bare `42` cannot be attributed to movie 42 vs serie 42 — that
ambiguity IS the bug BIN-569 fixed, and it is baked into data already written. Merging it
into both media types is exactly what the pre-BIN-569 code did — but it is NOT unchanged
versus the shipped middle state in 0c83c45, which silenced the legacy doc as soon as a
namespaced one existed and thereby "healed" the collision by discarding the vote. We keep
the user's vote instead. That is a deliberate, narrow widening for the session's remaining
TTL, documented as a WHY comment at the merge site and pinned by an executable test.

### Acceptance criteria

1. A legacy doc with votes from `b`+`c` and a namespaced doc with a vote from `a` yields a
   tally containing **all three** — the failing case today.
2. A participant present in BOTH docs resolves to the **namespaced** value (newest wins).
   The test must seed *different* participants across the two docs, or it cannot
   distinguish document-pick from value-merge — the flaw in the existing
   "a namespaced swipe doc wins over a legacy one" test.
3. A veto held only in the legacy doc still sinks the candidate after a namespaced doc
   exists.
4. `nextCandidate` / `participantSwipeProgress` see the merged view, so a participant is
   not re-asked a title they voted on pre-cutover.
5. Everything BIN-569 fixed still holds: movie 42 and tv 42 keep separate *namespaced*
   tallies even when an ambiguous legacy doc is merged into both.
6. The accepted ambiguity is PINNED by a test, not just described in a comment — an
   unattributable legacy veto sinking both media types must be a recorded decision, or a
   future reader cannot tell it from drift. (Added after review: all three reviewers
   independently found the original criterion-5 test seeded no legacy doc at all and so
   tested nothing.)
7. `npm test src/lib/together/matching.test.ts` green, `npm run typecheck` clean, and the
   new block must FAIL under a revert to document-level fallback.

### Files

- `src/lib/together/matching.ts` — `indexSwipes` merge + the WHY comment
- `src/lib/together/matching.test.ts` — the cases above
- `src/lib/firebase/sessions.ts` — comment only, in `swipeDocToObject`; no write-path
  change (see deviation above)
- `.claude/rules/data-model.md` — the swipes schema line

### Ship

Own commit, references BIN-608. Push triggers hosting deploy; no functions or rules in
this diff, so the deploy.yml guard will not trip.
