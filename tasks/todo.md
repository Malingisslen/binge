# PLAN — BIN-541: MOTN vendor quota is monthly (500/mo hard limit), not daily (100/day) — 2026-07-17

**Class:** `functions/**` (sensitive domain, router tier `medium`, owning role #13
Data/Integrations Engineer). Blind critique from #13 obtained 2026-07-17 (endorse-with-
changes, 3 blocking concerns folded in below). Awaiting Malin's go-ahead + one missing fact
(exact vendor reset-cycle date) before any Edit/Write.

## Trigger
RapidAPI "quota 85% used" email (2026-07-16) turned out to be real: Malin's dashboard check
(2026-07-17) shows the actual MOTN/RapidAPI Basic plan is **$0.00/mo, 500 API requests/MONTH,
Hard Limit** (calls rejected once exhausted — no overage billing risk, but the vendor
integration goes dark for the rest of the billing period). Code assumed 100/day resetting
UTC daily (BIN-320, docs/org/adr/0006). That assumption was never verified against the real
plan terms and is wrong on both axes: wrong period (monthly, not daily) and wrong size
relationship (an 85-90/day allowance against a 500/month pool can exhaust the month in ~6
days if ever fully used).

## Verified facts
- `functions/src/streamingOffers/index.ts` (BIN-320): reserves slots against
  `motnBudget/{utcDay}`, `HARD_DAILY_CAP=90`, `DAILY_BUDGET=85`. Today's actual usage was
  only ~16 calls (`streamingHealth/current.workSetSize: 16`) — this job alone isn't the
  problem at current library size.
- `functions/src/leavingRollup/index.ts` + `motnChanges.ts` (BIN-178): calls MOTN's
  `/changes` endpoint daily, paginated up to `MAX_PAGES=20` — **zero quota-safety counter**.
  Up to 20 calls/day, completely unmetered — the likelier actual driver of the 85%-used
  alert.
- Vendor "Rate Limit: 1000 requests/hour" is a non-issue at these volumes — not worth gating.

## Fix (role #13 critique folded in)
1. **Do not port the existing 429→"burn to cap" behavior verbatim to a monthly counter.**
   Today a 429 zeroes the *daily* remainder (worst case: one bad day lost). At monthly
   granularity the same logic would zero the *whole month's* remaining budget on a single
   transient hourly-rate-limit 429, which is a different failure and much worse. Must
   distinguish "hourly throttle, retry next run" from "monthly quota actually exhausted"
   (e.g. inspect a `Retry-After`/reset-window header if RapidAPI sends one, or treat repeat
   429s across N consecutive runs as real exhaustion, not the first one).
2. **Fold `leavingRollup` into the SAME shared reservation counter for real** — add an actual
   `reserveSlot`-style check inside `motnChanges.ts`'s pagination loop (per page, before each
   fetch), not just after-the-fact attribution. Both jobs must draw from one Firestore counter
   that reflects true combined vendor usage.
3. **Give each job an explicit sub-allocation, not a free-for-all draw** — e.g. leavingRollup
   gets a fixed small daily/monthly ceiling (it doesn't need much — it's one rollup doc), and
   streamingOffersRefresh gets the remainder. Prevents either job from silently starving the
   other.
4. **Confirm the real reset-cycle boundary before hardcoding a `YYYY-MM` UTC key** — the
   dashboard screenshot shows "500/Month" but not the reset day. If it's a rolling 30-day
   window anchored to signup date rather than a UTC calendar month, a naive calendar-month
   key can either falsely show budget available right after the real reset, or double-spend
   across the mismatch window. **Needs Malin to check** the RapidAPI/Nokia account billing
   page for the actual renewal date (usually shown near the plan/subscription details).
5. **Add a staleness/admin-alert signal for leavingRollup**, mirroring what
   `streamingOffers` already has (`notifyAdmin`/`streamingHealth`) — today leavingRollup has
   no equivalent, so if its slice of the budget runs out, "vad försvinner" goes silently
   stale with no signal.
6. **Rename `DAILY_BUDGET`/`HARD_DAILY_CAP`** to something that names the real unit (e.g.
   `MONTHLY_BUDGET`/`HARD_MONTHLY_CAP`) — role #13: the stale name is exactly how this got
   miscalibrated once already.
7. Leave a new dated decision note (append-only, per repo convention) superseding BIN-320's
   "100/day" assumption — NOT a silent rewrite of ADR-0006 (which is about timezone choice,
   still probably fine) or the BIN-320 comments (historical record of what was believed at
   the time).

## Explicitly not doing
- Not adding any paid tier / clicking "Upgrade Plan" — that's Malin's call alone, not bundled
  into this fix.
- Not building an hourly rate-limit gate (1000/hr is not a real constraint at binge's volume).

## Open question for Malin — RESOLVED 2026-07-17
Subscription was created **2026-06-21**; Malin isn't 100% certain but has no evidence of a
calendar-month reset. **Working assumption: rolling window anchored to the 21st of each
month** (not UTC calendar month). Counter key = the current billing-cycle start date (the
most recent 21st-of-month on/before today), not `YYYY-MM`. Kept a generous buffer (~10%
under 500) regardless, since the anchor-date belief isn't independently confirmed — if a
future run gets rejected well before the next 21st, that's a signal this assumption is wrong
and the anchor needs correcting (log the vendor's actual rejection date if it happens).

## Acceptance criteria (draft — will firm up once reset-date question resolves)
- [ ] One shared Firestore counter reflects combined MOTN usage from BOTH
      `streamingOffersRefresh` and `leavingRollup`, keyed to the vendor's real reset cycle.
- [ ] `leavingRollup`'s `/changes` pagination reserves a slot per page before each call (not
      after-the-fact accounting).
- [ ] A stray 429 no longer zeroes the full month's remaining budget — distinguishes
      transient/hourly throttling from real monthly exhaustion.
- [ ] Each job has an explicit sub-allocation; neither can silently starve the other.
- [ ] leavingRollup gets an admin-visible staleness signal when its allocation is exhausted,
      matching streamingOffers' existing pattern.
- [ ] Constants renamed to name the real unit (monthly, not daily).
- [ ] New/updated tests cover: shared-counter reservation across both jobs, 429 handling that
      doesn't over-burn, sub-allocation isolation.
- [ ] Dated decision note added (not a silent rewrite of BIN-320/ADR-0006).
- [ ] `functions/**` → binge-security-reviewer + binge-code-reviewer gates; Tier-D manual
      `firebase deploy --only functions` (deploy.yml doesn't deploy functions).

## Open questions
No architecture-changing unknowns remain — the one substantive open question (billing-cycle
reset date) was resolved via AskUserQuestion earlier (see "Open question for Malin —
RESOLVED" above: rolling window anchored to the 21st, working assumption, safety buffer
applied). Everything since is fix-forward work under this SAME approved plan, driven by the
`functions/**` review gates this plan itself required (binge-security-reviewer,
binge-test-reviewer, `/code-review xhigh`) — three review rounds each found real defects,
fixed in turn, no new scope or design decision introduced:
- Round 1 (8 findings): PER_RUN_SELECT/cycle-cap pacing mismatch, 429-vs-budget write gating
  on `streamingLeaving/current`, `computeHealth` conflation, `staleNotified` swallow-on-no-op,
  throttle-streak-reset-by-no-signal, `dayId.ts` short-month anchor bug, duplicated
  `markStaleOnce`.
- Round 2 (9 findings): leavingRollup's incomplete-run guard firing the shared alert on an
  UNCONFIRMED single 429 (bypassing the 2-run confirmation the round-1 fix built), a
  mid-pagination non-429 failure not caught by the completeness guard, missing Scheduler
  idempotency guard, `notify()`-throws-skips-budget-write coupling, redundant double-notify,
  missing tests for the extracted `notifyOnceForCycle`, `computeHealth` thresholds
  uncalibrated for the new `PER_RUN_SELECT`, triplicated notification boilerplate.
- Round 3 (7 distinct findings, session hit its usage limit mid-review — sweep/synthesize
  steps didn't complete, fixing the verified findings by hand): `complete` flag incorrectly
  true on `hasMore:true` + missing `nextCursor` (OR-logic bug), `lastRunAt` idempotency marker
  written BEFORE risky pagination instead of after (unlike streamingOffersRefresh's actual
  pattern), `notifyOnceForCycle`'s check-then-act race under Cloud Scheduler's at-least-once
  delivery, duplicated throttle-confirmation block between the two jobs. One round-3 finding
  (streamingOffers no longer burns the bucket on a single 429) is NOT a regression — it's
  restating round 1's deliberate, security-reviewed fix; not changed.

---

# PLAN — BIN-509: Tillsammans session write rules (caller binding) — 2026-07-16

**Class:** firestore.rules (sensitive domain, router tier `top`). Full panel convened
2026-07-16 (Security #4, DPO #6, QA #7, DBA #27 + Codebase Archaeologist), all
approve-with-conditions, zero inter-role conflicts, TWO escalations for Malin (below).
Metrics event logged. Malin gave intent go-ahead ("go ahead") for panel+plan; build
awaits her answers + plan approval.

## The holes (verified against firestore.rules @ HEAD 3644a22)

1. **Swipes (L778-786) — ZERO auth binding.** `allow create, update` checks only doc
   shape (hasOnly['votes','updatedAt'], votes map ≤50). No isSignedIn(), no caller
   binding, no expiry gate. ANY caller (anon link-holder included; participants/swipes
   are public-read so participant ids are enumerable) can setDoc WITHOUT merge and
   replace/forge any participant's vote. matching.ts treats 'veto' as -Infinity → one
   hostile client silently kills every match or fabricates one. "One veto per session"
   is client-UI-only. This hole has existed since Tillsammans launch — BIN-24 only
   touched participants, never swipes (archaeologist-verified).
2. **Participants (L755-776) — uid FIELD bound (BIN-24), doc PATH not.** A signed-in
   user can setDoc(participants/{anyPid}, {uid:<own uid>,…}) overwriting another
   participant's slot — including hijacking an ANON participant's slot (uid-field check
   passes because the field is "honest"). Corrupts displayName/providers → feeds
   computeSessionProviders → candidate filtering.

**Identity model (ground truth):** pid = `existingUid ?? generateSecureToken()` — pid==uid
for signed-in; a random unguessable client token for anon (request.auth is null; NOT
Firebase Anonymous Auth — rules cannot verify anon identity, structurally).

## Fix (panel-conditioned)

### firestore.rules — swipes block
- **Create branch** (resource == null): payload shape checks + votes.keys() constraint —
  NEVER touch resource.data on create (diff()-on-create throws → denies ALL first votes;
  4 roles + archaeologist flagged independently; every existing .diff() use in this file
  is update-only for this reason).
- **Update branch:** `votes.diff(resource.data.votes).affectedKeys()` must be exactly ONE key.
- **Signed-in callers:** that one key must == request.auth.uid (their pid).
- **Anon callers:** single-key constraint only (stops wholesale map replacement /
  veto-storms). NO fake "secret" binding — any secret on a public-read doc is readable,
  a false proof (Security). Residual anon-vs-anon forgery → ESCALATION A.
- **Vote VALUE enum** (`in ['yes','no','veto']`) — trivially adjacent to the diff logic,
  included (archaeologist scope-call).
- **Expiry gate** `get(sessions/$(sessionId)).data.expiresAt > request.time` — reuses the
  existing get() pattern from this block's delete rules. BUT: ESCALATION B (reverses a
  prior founder decision).
- Update the stale block comment (L741-742 "unlisted-link-modellen räcker") — it justifies
  the old loose model and would mislead the next reader.

### firestore.rules — participants block
- Signed-in branch: add `pid == request.auth.uid` (path binding on top of BIN-24's field
  binding). Anon branch (uid == null) unchanged — pid unbindable, token-trust model.
- Expiry gate on participants: ONLY if Escalation B says yes, and then existing BIN-24
  tests (~L697-741, which never seed a parent session doc) must be re-seeded, not loosened.

### src/test/rules/firestore-rules.test.ts (extend BIN-24 describe block + new sibling swipes block, reuse ownerDb/anonDb/otherDb + validParticipant factory)
DENY: signed-in writes vote key ≠ own uid; signed-in overwrites another pid's slot (incl.
hijacking an anon slot); multi-key votes diff (any caller); non-merge setDoc that CHANGES
another participant's existing key (QA: a same-content replacement + one new key is
legitimately allowed — don't assert it as deny); write after expiresAt (if gate ships;
seed parent session via withSecurityRulesDisabled with explicit past/future expiresAt);
invalid vote value. ALLOW (regression): own-vote create (first swipe on fresh tmdbId —
the create branch); own-vote merge update (recordSwipe shape: setDoc merge:true
{votes:{[pid]:vote}, updatedAt} — deep-merges, diff isolates own key); anon participant
create; anon single-key vote. Re-run FULL existing sessions tests — if the expiry gate
breaks BIN-24 tests, seed sessions docs, never weaken the gate.

### Honesty scope (QA/DBA/DPO binding)
Ticket/commit language = "closes SIGNED-IN cross-participant vote + slot forgery; caps
anon writes to single-key; anon-vs-anon forgery remains {per Escalation A}". NEVER "closes
all vote forgery". A test named "anon forgery blocked" cannot be true — don't write one.

### Pre-deploy check (DBA)
Query live sessions/*/participants for docs with uid != null && docId != uid (legacy
pattern-mismatch would brick their lastActiveAt/veto updates under the new path binding).
Any found within TTL window → carve-out or delete before rules deploy.

### Deploy (Tier-D)
Manual `firebase deploy --only firestore:rules` FIRST (deploy.yml ships hosting only);
no client code change expected (recordSwipe's write shape already passes the new rules —
QA traced). xhigh /code-review (rules diff) + binge-security-reviewer + binge-test-reviewer
gates. Accepted-deviations entry for the anon residual (per Escalation A). ADR for
Escalation B's outcome (reverses BIN-24's recorded call).

## ESCALATION A — anonymous-forgery residual (all 4 roles converge, Malin decides)
Rules can't authenticate an anonymous caller. Options:
- **A1 (panel lean):** accept residual — anon participants can still forge OTHER ANON
  participants' single votes (not signed-in ones; not wholesale). Ephemeral 7-day data,
  unlisted-link trust model, zero new data elements. Record in accepted-deviations.md.
- **A2:** require sign-in to swipe — closes everything, breaks anonymous participation
  (product regression for the link-share flow).
- **A3:** Firebase Anonymous Auth — real binding for everyone, but a NEW pseudonymous
  identifier in Firebase Auth: GDPR inventory + retention/reaper story required (DPO:
  anon auth accounts never auto-expire; BIN-480-class follow-up), new auth provider.

## ESCALATION B — expiry gate reverses a recorded founder decision
BIN-24's commit (e6d02e8) explicitly says "Expiry-gate medvetet utelämnad (kostnad)" —
Malin already decided ONCE against this gate on cost grounds. Adding it now = +1 billed
read per swipe write (hottest session write path; ~0.01 kr per 300 swipes — trivial at
current traffic under the 25 SEK cap, but ongoing). Value: blocks zombie-session write
floods in the up-to-30-day window before retentionCleanup reaps expired sessions.
- **B1 (panel lean):** add the gate on swipes (+ participants), document the read cost.
- **B2:** keep BIN-24's call — skip the gate, rely on retentionCleanup's 30d reap.

## Follow-up (file, don't build here): vetoRemaining/isHost value forging
Participants can self-write vetoRemaining:999 / isHost:true raw (hasOnly lists keys, no
value validation; one-veto cap is client-only). Adjacent, real, but its own small ticket.

## Acceptance criteria (panel conditions folded — BINDING)
- [ ] Create/update split — no unconditional resource.data reference (deny-all-creates bug class).
- [ ] Signed-in: vote key == auth.uid; pid == auth.uid path binding. Anon: single-key cap.
- [ ] Vote value enum enforced.
- [ ] Expiry gate per Escalation B (+ re-seeded BIN-24 tests if yes).
- [ ] Deny+allow tests per QA list; full sessions suite green (npm run test:rules, Java/JBR).
- [ ] Legacy pid!=uid spot-check before deploy.
- [ ] Stale block comment updated; accepted-deviations entry (anon residual per A); ADR (B).
- [ ] Honest scope language in ticket/commit.
- [ ] Manual rules deploy + xhigh review + security/test reviewer gates.

---

# Sprint 2026-07-16 — selection

Linear available. 7 tickets selected (`build`), clustered into 6 disjoint-file batches.
0 obsolete (all 7 candidate bugs/gaps re-verified present in current `main` before
selecting — grep-of-main premise check per the skill). 3 needs-approval this round
(BIN-509, BIN-527, BIN-521 carried) — all three get a plain-language reasoning below;
none selected into a batch.

## Batch: streaming (advisor dedup)

- [ ] **BIN-528** [Tier A] `build` — Extract the shared "which watch-statuses count as a
      live reason to keep a service" guard clause out of three separate copies
      (`tvActiveProviderIdsFromItems` in serviceValue.ts, `buildHouseholdContribution` in
      householdAggregate.ts, the active-set derivation in spendSnapshot.ts) into one small
      helper the three consume; keep each surface's extra local filters (e.g. serviceValue's
      `mediaType==='tv'` + `avslutad`-exclusion) local, not folded into the shared helper.
      Files: `src/lib/advisor/serviceValue.ts`, `src/lib/advisor/householdAggregate.ts`,
      `src/lib/spendSnapshot.ts` (+ their `.test.ts` files). Stakeholders: single ·
      #24 Monetization/Partnerships. requiresPlanMode: no.
  - [ ] A single shared helper (new export) encodes the common "which statuses qualify as
        active" rule; all three call sites use it instead of duplicating the status list.
  - [ ] serviceValue's TV-only filter and `avslutad`-exclusion (BIN-513) still apply and are
        NOT moved into the shared helper (they stay local to serviceValue.ts).
  - [ ] All three modules' existing test suites pass unmodified in their assertions — this
        is a pure refactor, not a behavior change to any of the three dead-weight/household/
        spend verdicts.

## Batch: infra (test coverage measurement)

- [ ] **BIN-525** [Tier A] `build` — Run vitest with `--coverage` once, record the measured
      percentage, and wire a report-only (non-blocking) coverage step into CI. Do NOT add a
      blocking coverage floor/threshold — that decision is explicitly Malin's, deferred.
      Files: `package.json`, `vitest.config.ts` (or equivalent), `.github/workflows/ci.yml`.
      Stakeholders: single · #8 DevOps/SRE. requiresPlanMode: **yes** (3-file CI/tooling
      change — working-agreement "large change" threshold).
  - [ ] CI runs a coverage pass and the measured overall percentage is recorded (Linear
        comment on BIN-525 + this ticket's close-out note).
  - [ ] No blocking floor/threshold is added anywhere (`--coverage` reporting only) — CI
        does not go red purely because of a coverage number.
  - [ ] The floor-or-not decision itself is explicitly left open for Malin (surfaced, not
        pre-decided) in the close-out comment.

## Batch: auth (AuthContext bug fixes)

- [ ] **BIN-517** [Tier A] `build` — Stop `register()`'s `setDoc(..., {username: null},
      {merge:true})` from clobbering `ensureUserProfile`'s auto-claimed username (drop
      `username` from `register()`'s payload entirely — merge:true then leaves whatever
      `ensureUserProfile` claimed intact). Files: `src/contexts/AuthContext.tsx` (+ new
      test). Stakeholders: full-panel (AuthContext.tsx high-stakes path) · #5 Legal/GDPR,
      #27 DBA. requiresPlanMode: **yes**.
  - [ ] `register()`'s `setDoc` payload no longer includes a `username` key (or otherwise
        provably can't overwrite a just-claimed username back to null).
  - [ ] A new test proves a registered user ends with a non-null `username` AND exactly one
        `usernames/{name}` reservation (no orphan).
  - [ ] `setProviderCost`/`setProviderCampaign` (BIN-516, same file/batch) are untouched by
        this criterion's diff — the two fixes stay independently reviewable.

- [ ] **BIN-516** [Tier A] `build` — `setProviderCost`/`setProviderCampaign` mutate their
      mirror ref before the Firestore write resolves and never revert on failure, so a
      rejected value silently persists via the next successful edit. Revert the ref (or
      rebuild the payload from committed state) on write failure, for both. Files:
      `src/contexts/AuthContext.tsx` (+ new test). Stakeholders: full-panel (AuthContext.tsx
      high-stakes path) · #5 Legal/GDPR, #27 DBA. requiresPlanMode: **yes**.
  - [ ] Both `setProviderCost` and `setProviderCampaign` revert their ref to the pre-edit
        value (or equivalent non-ref-poisoning fix) when the Firestore write throws.
  - [ ] A new test forces the write to reject, then performs a second successful edit to a
        DIFFERENT provider, and asserts the rejected value is NOT included in that second
        write's payload.
  - [ ] The existing successful-write path test assertions are unmodified.

## Batch: watchlist (BIN-505 follow-up tests + cleanup)

- [ ] **BIN-522** [Tier A] `build` — Pin the four test-coverage gaps BIN-505's reviewers
      verified by manual trace only (updatedAt-omission on notes migration/updateNotes,
      cross-account `itemsUidRef` guard, `useFollowList`'s real 'Privat användare' fallback
      replacing the stale 'ghost'-branch test, `syncMyPublicProfile` field clamping), and fix
      `updateNotes`' unconditional no-op write when there's no legacy inline note and
      `visFields` is empty. Files: `src/contexts/WatchlistContext.tsx` (+ test),
      `src/hooks/useFollowList.helpers.test.ts`, `src/lib/firebase/publicProfile.ts` (+ test).
      Stakeholders: single · #14 Software Architect. requiresPlanMode: **yes** (multi-file,
      privacy-adjacent follow-up to a PII fix).
  - [ ] New tests assert `'updatedAt' in payload === false` for both the eager notes
        migration and `updateNotes` (mirrors the `nextAirReadRepair` pattern).
  - [ ] A new test simulates a mid-session uid switch A→B and asserts the notes migration
        does NOT write A's notes under B.
  - [ ] `useFollowList.helpers.test.ts`'s stale `'ghost'`-branch assertion is replaced with a
        test for the real 'Privat användare' fallback row; no test still asserts `'ghost'`.
  - [ ] `updateNotes` skips the item-level write when there's no legacy inline note AND
        `visFields` is empty (no behavior change to the notes-subcollection write itself).

## Batch: data (availableNotify/priceDropNotify mediaType collision)

- [ ] **BIN-523** [Tier C — functions/** trigger, expanded plan required] `build` — Movie N
      and TV N currently collapse into one `availableNotifyState`/`releaseNotifyState` doc
      (keyed on bare `tmdbId`) and one `processTitle` group, producing wrong/suppressed
      pushes for that overlap. Namespace state-doc ids by media type (`movie_${tmdbId}` /
      `tv_${tmdbId}`) and group `processTitle` by `(mediaType, tmdbId)`; apply the same fix
      to `priceDropNotify` if it shares the pattern. Files:
      `functions/src/availableNotify/index.ts`, `functions/src/priceDropNotify/index.ts`
      (+ tests). Stakeholders: single · #13 Data/Integrations Engineer. requiresPlanMode:
      **yes** (security-labeled + functions/** tierCTrigger).
  - [ ] State-doc ids (both `availableNotifyState` and `releaseNotifyState`) are namespaced
        by media type — a movie and a TV show sharing the same numeric tmdbId get separate
        docs.
  - [ ] `processTitle` groups watchlist rows by `(mediaType, tmdbId)`, not `tmdbId` alone.
  - [ ] A new test proves a user holding movie N and TV N gets two independent notify/dedup
        entries (neither suppresses or mis-types the other).
  - [ ] `priceDropNotify` is checked for the same keying bug; fixed if present, or the ticket
        close-out states explicitly why it doesn't apply.

## Batch: social (groups fan-out cap)

- [ ] **BIN-510** [Tier C — full-panel, expanded plan required] `build` — `syncProgressToGroups`
      (fired on every episode/progress write) and its sibling `array-contains` group queries
      in `groups.ts` (4 call sites: :477, :562, :750, :778) have no `limit()`, unlike
      `useFollow.ts`'s `FOLLOWING_LIMIT = 500` pattern for the analogous following query — a
      direct Blaze-budget risk for heavy group users. Add a bounded limit (mirror
      `FOLLOWING_LIMIT`) to all four call sites; skip the sync entirely when the user has zero
      groups without a collection scan. Files: `src/lib/firebase/groups.ts` (+ tests).
      Explicitly NOT in scope: `AuthContext.tsx:443`'s `updateProviders` group query has the
      same unbounded shape but is a low-frequency (provider-list-edit) call, not the
      per-episode hot path — leave it alone this round (note it in the close-out for a
      possible follow-up ticket). Stakeholders: full-panel · #27 DBA, #4 Security Architect,
      #14 Software Architect. requiresPlanMode: **yes**.
  - [ ] All four `array-contains` group queries in `groups.ts` (:477, :562, :750, :778) carry
        a bounded `limit()`.
  - [ ] `syncProgressToGroups` (or its caller) skips the group-fan-out query entirely for a
        user known to be in zero groups, without a full collection scan.
  - [ ] A new test proves the query is bounded (a user "in" more groups than the limit still
        only reads up to the limit).
  - [ ] `AuthContext.tsx:443` is explicitly left unchanged — no edits to `AuthContext.tsx` in
        this ticket's diff (keeps it disjoint from the auth batch above).

## Needs you (mandate gate — not selected, see reasoning)

- **BIN-509** — Tillsammans session write-rules forgery fix (swipes/participant slot not
  bound to the caller). Real, verified-still-present security bug in a live feature — but
  it's a `firestore.rules` change, and the working agreement's one standing exception is
  that Firestore rules/schema changes get **a written plan and an explicit go-ahead FIRST**,
  not an auto-build that parks in review after already being live (this repo's push-triggers-
  deploy means "In Review" would happen only after the rules are already serving traffic).
  Router confirms full-panel (Security Architect, DPO, DBA). Recommend: **do it** — it's a
  real integrity hole (any link-holder can forge another participant's vote or hijack their
  slot) — but run it as its own `/stakeholder-review` + written plan next, with your sign-off
  before the rules deploy, same as BIN-505's process. Not urgent (data is anonymous/ephemeral,
  7-day TTL, no PII), so safe to schedule rather than rush.
- **BIN-527** — Advisor TV dead-weight shield keys on availability, not actual per-title
  watch location (a show available on 2 owned services shields both, even though the user
  only watches it on one). The ticket itself says "needs a product decision... no clean code
  fix without that call" and lays out 3 options (accept as-is / tighten to attribute-one-
  service like films / require real watch-recency — bigger). This is exactly your call, not
  an engineering one. Recommend: **(b) — tighten to attribute-one-service**, for consistency
  with the film path (BIN-513 already accepted that same false-positive/false-negative
  tradeoff for films), but only when you're ready to sign off on it — not urgent, client-only
  advisor logic, adjustable anytime.
- **BIN-521** — Bundle-rådgivare nudge (multi-service → cheaper operator bundle). Carried
  from the prior sprint's needs-approval queue; ticket self-declares "ren idé, kräver egen
  brainstorm/design innan bygge." Recommend its own `/stakeholder-review`
  (Monetization + Data/Integrations) before any code — unchanged reasoning from 2026-07-15.

## Deferred, no new judgment needed (already-decided in memory, left in Backlog)

BIN-520 (BIN-507 orchestration-test follow-up — low priority, already attempted once this
sprint cycle and dropped for failed verification; description records the intended
"accept pure-helper-only" resolution but it was never actually committed to `index.ts` —
re-verified via grep, the header comment doesn't exist on main. Leaving deferred rather than
re-attempting immediately; low value (doc comment + criteria downgrade only, job stays in
count-only mode regardless)). BIN-402/454/468 (TMDB ToS sweep — mutateEnabled deliberately
deferred to a real-traffic gate ~Aug). BIN-170 (Binge Wrapped — booked Nov). BIN-189
(Seasonal challenges — panel-approved for Aug/Sept build, not now). BIN-419 (SEO
re-measurement, not due until 2026-08-28).

## Post-sprint steps

1. `npm run typecheck` across all touched files.
2. File Linear follow-ups for anything deferred mid-implementation (e.g. the
   `AuthContext.tsx:443` unbounded query noted under BIN-510, if worth its own ticket).
3. Commit through the review gates (code/security/test markers as triggered), conventional
   commit referencing all ticket ids (BIN-528/525/517/516/522/523/510).
4. Push (deploys on push) → poll `deploy.yml` → purge Cloudflare. BIN-523/510 touch
   `functions/**` respectively `src/lib/firebase/groups.ts` — confirm whether either needs a
   manual `firebase deploy --only functions` (deploy.yml only deploys hosting).
5. Transition: Tier A build + all-pass → Done. Any Tier C ticket with an unresolved
   full-panel conflict or a failed/unclear acceptance criterion → In Review instead, with a
   note on what to look at.

## Deviation log (filled post-sprint 2026-07-16)

- BIN-528: no host file named for the shared helper → watchStatus.ts is the semantic home but plan-gated + outside the batch fileset → hosted in `src/lib/spendSnapshot.ts` (oldest surface, defines the concept, no import cycles).
- BIN-528: householdAggregate.test.ts already pins the guard ('sedd' exclusion case) → left untouched, no redundant coverage.
- BIN-525: functions/src admin entrypoints fail v8 coverage remap (PARSE_ERROR, silently excluded) → coverage.include scoped to `src/**/*.{ts,tsx}` with WHY comment — denominator declared, not accidental.
- BIN-522: 'Privat användare' fallback tests already existed; the genuinely stale part was the dead 'ghost' union member (unreachable since BIN-505) → retired 'ghost' from FollowProfile/resolveFollowRows, tests pin null→fallback + order/count.
- BIN-522: publicProfile.ts clamping already shipped in d6ff035 → tests only, no production change there.
- BIN-522: WatchlistContext test gaps live in WatchlistContext.test.tsx, not useFollowList.helpers.test.ts as ticketed.
- BIN-522: mutation-verification `git checkout --` wiped the real edit → re-applied + re-verified; lesson filed (tasks/lessons.md + digest).
**BIN-523 + BIN-510 were REVERTED before deploy (2026-07-16) — failed verification.** The
notes below record what the sprint *attempted*; none of it is in the code. Read them as
rework input for the returned tickets, NOT as shipped fact. The code is back at `fd4b14e`.

- BIN-523 [REVERTED]: attempted — releaseNotifyState doc ids deliberately NOT namespaced (movie-only by construction; renaming orphans live per-user dedup markers → double pushes in the 3-day catch-up window).
- BIN-523 [REVERTED]: attempted — priceDropNotifyState verified movie-only at the query → no change, invariant claimed in a header comment. **The verification rejected exactly this claim:** the query filter only protects priceDropNotify's READ side; `priceHistory/{tmdbId}` is written by `streamingOffers`, which dedupes by bare tmdbId and carries the SAME collision. The header comment (now reverted away) asserted a safety property that does not hold. Any rework must fix `streamingOffers/logic.ts` too, or drop the claim.
- BIN-523 [REVERTED]: attempted — FCM tag `available-${tmdbId}` shared the collision → include mediaType in the namespaced key. Residual: inbox doc id still bare → BIN-529.
- BIN-510 [REVERTED]: attempted — zero-groups skip via per-uid 5-min TTL cache seeded by first scan/subscription, invalidated by in-module membership mutations. Failed correctness/intent verification.
- BIN-510 [REVERTED]: attempted — refreshMyHouseholdContributions got the bounded limit() only, not the skip (low-frequency caller). Bounded-query test missing → BIN-530; AuthContext:443 → BIN-536.

---

# Archive — Sprint 2026-07-15 (shipped 4ae5735 + fd4b14e)

BIN-511/512/513/514/515/518/519 shipped; BIN-505 (PII leak) landed separately (d6ff035).
BIN-520 dropped (failed verification, see "Deferred" section above for current state).
Full archived plan detail available via `git show 4ae5735:tasks/todo.md` if needed.

---

# Archive — BIN-505 full plan (SHIPPED 2026-07-16, d6ff035)

Full design + panel record: `tasks/bin-505-plan.md`,
`docs/incidents/2026-07-14-bin505-profile-pii-exposure.md`. Follow-ups filed as BIN-522
(above) and BIN-523 (mediaType collision, unrelated surface found by the same review pass).
