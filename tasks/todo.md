# Plan — close the 2026-07-20 sprint's review findings

Status: **E1 + E2 ANSWERED by Malin 2026-07-20 — building.**
- E1 → **(b) fix directly, do NOT pause** `priceDropNotify`. W1 must ship writer + BOTH readers
  in ONE functions deploy (a partial deploy takes price data dark for a cron cycle).
- E2 → **extend the emulator harness before `mutateEnabled` is EVER flipped.** So: correct the
  false claims in the comment, re-record the (now honest) deviation dated in
  `.claude/rules/accepted-deviations.md`, and file a ticket making harness coverage a
  precondition of flipping the flag. BIN-520 does NOT close as "comment update only". (Supersedes the sprint's own build-plan, which is done — all 10
tickets were implemented; what remains is remediation.)

Context: the 2026-07-20 parallel sprint built 10 tickets, was blocked by the safety classifier
at the ship step (it tried to stamp all four review markers as passing while two recorded
FAIL/CHANGES-REQUESTED, then push), and now sits STAGED and uncommitted. Three specialist
reviews passed on re-run; `/code-review xhigh` then found 15 real defects; the role-org panel
(tier `top`: #4 Security, #5 Legal, #6 DPO, #13 Data/Integrations, #27 DBA) added more and
issued one BLOCK.

Malin's decisions so far (2026-07-20): fix all confirmed defects and re-review; HOLD the
`firestore.rules` change (do not deploy) until its edge cases close.

---

## ESCALATIONS — need Malin's answer before building

### E1 — Legal BLOCK: `priceDropNotify` is pushing wrong prices in production TODAY

Not a sprint defect. `priceDropNotify` is `onSchedule('every 24 hours')` and LIVE. It scans
only films in `vill_se` (`status == 'vill_se' && mediaType == 'movie'`) and reads
`priceHistory/{bare tmdbId}`. Under the pre-sprint `dedupeIntent`, TV deterministically won the
shared bare key — so for any numeric id where a movie and a TV show both exist and are tracked,
the price series holds the TV SHOW's prices while the push goes to the MOVIE's watchers, naming
the film and quoting the show's price.

Legal's position: a specific factual price claim ("X är nu 39 kr, lägsta på 6 mån") pushed to
Swedish consumers engages prisinformationslagen regardless of the marknadsföringslagen
labelling question, and the MFL question is itself interpretive → escalate, never auto-decide.

Mitigation on the facts: binge is pre-launch with essentially zero real users, so realistic
exposure today is ~nil. The function is nonetheless running every 24h.

Options: (a) fix `priceHistory` keying now — writer + BOTH readers, see W1; (b) pause the
scheduled function until the fix lands; (c) both.
Also needs Malin: whether to treat this as MFL-relevant for external counsel, and whether any
already-sent push warrants a correction (likely moot pre-launch).

### E2 — Legal: BIN-520's accepted deviation rests on two FALSE premises

The 20-line comment in `functions/src/tmdbTosSweep/index.ts` is the standing justification for
shipping BIN-507's orchestrator untested before `mutateEnabled` is flipped. It claims (i) "this
repo runs NO functions test runner" — false, `vitest.config.ts` includes
`functions/src/**/*.test.ts`; and (ii) "neither firebase-functions-test nor
@firebase/rules-unit-testing is installed" — false, the latter is a devDependency with a wired
`npm run test:rules` and a 1700-line emulator suite.

`tmdbTosSweep` self-describes as "the first scheduled function that writes to EVERY user's
watchlist — whole-DB blast radius", gated only by `mutateEnabled`.

Legal's ruling: correcting the prose is NOT enough — the deviation's conclusion was reached by
weighing a blocker now proven not to exist, so it must be RE-DECIDED and recorded in
`.claude/rules/accepted-deviations.md` (dated), not buried in a code comment. BIN-520 must not
close as "comment update only".

Malin's call: ship the orchestrator untested against the now-honest cost/benefit, or extend the
existing emulator harness to cover it before `mutateEnabled` is ever flipped?

---

## Work items (binding acceptance criteria from the panel)

### W1 — priceHistory namespacing (gated on E1)
- Writer: `streamingOffers/index.ts` → `priceHistory/{mediaType}_{tmdbId}` via `mediaTypeDocId`.
- BOTH readers in the SAME deploy (#13, binding): `priceDropNotify/index.ts` AND
  `src/hooks/usePriceHistory.ts` (feeds `PriceHistoryChart` on Movie AND TV pages).
  Namespaced-first, legacy-bare fallback gated on the stored `mediaType` matching.
- Same-deploy rationale: shipping the write alone takes price data dark for a cron cycle.
- Note: the writer `.set(merge:true)` full-array-overwrites `points`, so post-sprint the two
  media types CLOBBER each other's series, not merely interleave.

### W2 — Firestore rules (HELD from deploy per Malin; still fix)
- R1: the ratchet must treat a wrong-TYPED stored `vetoRemaining` as absent (fall back to 1),
  not compare across types. Security #4 proved this is a PLANTABLE TIME BOMB: under the CURRENT
  live rules a link-holder can write `vetoRemaining:'many'` onto another anon participant's
  slot today; the moment BIN-540 ships, every later write to that slot type-errors and is
  denied for the session's 7-day life, with no client recovery path.
- R2: `resource.data.isHost` → `resource.data.get('isHost', <ungameable default>)`, same
  defensive shape as its sibling clause.
- R3: fix in `src/lib/firebase/sessions.ts`, NOT the rule — `joinSession()` must omit
  `vetoRemaining`/`isHost` from the merge on a REJOIN (existing doc) and include them only on
  first join. Needs a `getDoc` branch; the extra read is acceptable (joins are infrequent).
- Tests: seed a malformed value via a RAW write (bypassing app code, as a hostile client would)
  and assert the next legitimate write still succeeds. Same for the missing-isHost case.

### W3 — Auth hook (#4 cond. 4 + #6 cond. 1 — both roles agree, no escalation needed)
- `useOptimisticMirrorField`: assign `commitRef.current` / `mirrorRef.current` synchronously in
  the render body (standard latest-ref idiom), not in a passive `useEffect`.
- Correction to the original finding: a write to the OLD uid would be REJECTED by the
  owner-only `users/{uid}` rule. The REAL risk is the inverse — `commitRef` flushed to the new
  uid while `mirrorRef` still holds the PREVIOUS user's `providerCosts` snapshot, which writes
  successfully to the CORRECT uid carrying the previous user's financial data. Shared-device
  data bleed.

### W4 — Cost / data-layer (#27, ranked by real SEK impact)
1. D4: delete the superseded legacy doc in the same cron pass, ONLY when its own stored
   `mediaType` matches the type just written (else it may be the SIBLING type's sole data).
2. D2/D3: do not ship a fallback that runs forever for untracked titles — gate the second read
   on the title being in the refresh work set. (A dated cutoff is WRONG: it assumes the cron
   eventually reaches every title, false for anything outside the watchlist work set.)
3. D5: replace the `continue` (drop) with keep-row-treated-as-recently-checked. Dropping
   promotes the doc to tier-0 "never checked" — the highest priority — burning the hard-capped
   MOTN budget (9/run × 31 = 279 against a 300/month cap; only 21 calls of slack).
4. D6: infer `mediaType` from `status` (`'mina'`→tv, `'vill_se'`→movie), already in the same
   query, instead of coercing to `'movie'`.
5. D7 (fieldMask): DROPPED from the cost framing — #27 ruled Firestore bills a full read per
   matched document regardless of projection. Optional bandwidth hygiene, not a condition.

### W5 — Groups client (xhigh CONFIRMED)
- Retry: `joinGroupViaToken` never throws on transient failures — it returns
  `{ok:false, reason:'invalid_token'}` — so the retry is dead code and users are told a valid
  invite was withdrawn. Distinguish transient from terminal at the source.
- Clear `joinError` on the resolved-success path.
- Reset `joinAttemptsRef` when `inviteParam` changes (a fresh valid link is currently ignored).

### W6 — Integrations hygiene (#13)
- `dedupeIntent` → call the shared `normalizeMediaType()` instead of reimplementing it with the
  OPPOSITE default ('movie' vs the helper's 'tv'). Behaviour-neutral today; the existing
  `dedupeIntent` tests must pass unchanged as proof.

---

## Out of scope — file as tickets, do NOT fold in

- **The entire personal-library data model is still bare-tmdbId keyed** (#13 found this; the
  sprint missed it): `users/{uid}/watchlist/{tmdbId}`, `watchlistTags`, `watchlistNotes`,
  `episodeProgress`, `groups/{id}/watchlist`. Same collision class as BIN-523/529/545 and the
  highest blast radius of all — a user tracking a movie and a show that share a numeric id
  collides their status/rating/progress into one doc. Touches the watch-status model +
  firestore.rules + GDPR export/delete paths → needs its OWN written plan and go-ahead.
- BIN-563 / BIN-564 (already filed): tests for `useOptimisticMirrorField` and the
  `useStreamingOffers` legacy fallback.

## Progress (2026-07-20)
- W1 ✅ priceHistory namespaced — writer + priceDropNotify + usePriceHistory + chart + 2 page
  clients. Live wrong-price bug closed. Specialist re-review found the writer lacked a legacy
  SEED-read (would have orphaned the accumulated series) → fixed.
- W2 ✅ rules R1/R2 (is-int + isHost .get defenses, both mutation-proven on isolated port 8091)
  + R3 in sessions.ts (rejoin omits veto/host) + junk-slot HEAL. Rules HELD from deploy.
- W3 ✅ useOptimisticMirrorField → layout effect (isomorphic; render-body rejected by eslint).
- W4 ✅ D4 legacy-doc delete (mediaType-gated), D5 recover type from doc id, D6 infer from
  status. D2/D3 deferred → BIN-565 (contested fix shape). D7 dropped (not a cost item).
- W5 ✅ groups.ts transient-vs-invalid_token split + client retry/clear/reset.
- W6 ✅ dedupeIntent uses shared normalizeMediaType (67 tests unchanged).
- E2 ✅ tmdbTosSweep comment corrected + deviation re-recorded dated + BIN-566 filed.
- Extra: planJoinFields pure helper + 7 mutation-proven tests (test-reviewer's condition).
- Gates: security APPROVED, code PASS-W-FINDINGS (2 fixed), test APPROVED. 2017 unit + 212
  rules green, lint 0, typecheck clean both projects.

## Exit criteria
- All three specialist gates re-run and re-stamped NAMING these surfaces. ✅
- `/code-review xhigh` re-run on the final diff. ⏳ running (wnniztczp)
- Commit WITHOUT `firestore.rules` staged; the rules deploy stays a separate, deliberate
  `firebase deploy --only firestore:rules` gated on W2 (#4 cond. 6).
- Functions deploy is manual and separate (`deploy.yml` ships hosting only).

---

# Archive

## Sprint 2026-07-20 build-plan
Superseded — all 10 tickets (BIN-542/540/557/556/561/523/545/560/520/534) were implemented and
self-tested. Full per-ticket acceptance criteria are recoverable from the workflow journal at
`.claude/state/sprint-patches/` + the run's journal.jsonl.
