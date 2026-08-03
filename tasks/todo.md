# Recovery session 2026-08-03c — land what three sprints built and never shipped

Base: `ea5e6b5` (local, unpushed docs commit) on top of `b557be6`. Working tree clean.
All material verified present: `stash@{2}` (batch 0), `stash@{1}` (batch 1), `stash@{0}`
(BIN-638 tests), `.claude/state/sprint-patches/2026-08-03-0026-batch-4.patch` (SEO,
`git apply --check` clean).

**Not in this session:** the shared sprint-engine tickets (BIN-683/684/713/639/628). They
live in `C:/claude-plugins`, and per the 2026-08-03 lesson a refused edit to shared infra
contaminates every subagent launched afterwards in the same session. Separate session.

## Stakeholder routing (done before this plan — `node docs/org/route.mjs`)

`tier: top` — high-stakes path `src/contexts/AuthContext.tsx`. Full panel run blind,
sonnet/low: #5 Legal/GDPR, #14 Software Architect, #19 Customer Support, #27 DBA.

Binding conditions folded in below:

- **#19 Support (BLOCKING):** BIN-596's dead-listener hold renders as `disabled` +
  `title=` tooltip. A native `title` never appears on touch, and a `disabled` button fires
  no tap event — so on mobile the visitor gets a grey control that does nothing, with no
  message, for an unbounded time (a failed listener has no auto-recovery). → **Item 1b.**
- **#14 Architect (BLOCKING ×3):** (a) batch 0 makes `StatusButton` *disable* a signed-out
  visitor while `QuickAddButton` already *redirects* — landing batch 0 alone ships two
  add-affordances on one page that disagree; BIN-714 must be written against the LANDED
  file, not speculatively. (b) BIN-714 must be ONE shared helper, not a third inline copy
  of the remember-and-redirect rule (the BIN-645/668/669 drift lineage). (c) The BIN-669
  "split" is not a file exclusion — it interleaves with BIN-659 inside `finish()` and spans
  four files; a half-applied result compiles clean and is behaviorally wrong. → **Items 2, 3.**
- **#5 Legal:** no blocking conditions. Confirms the `findItem`/`itemsRef` migration in
  batch 0 closes a real BIN-595-class privacy-timing gap (a stale closure could re-stamp a
  profile default over a just-privatized title, or skip stripping a legacy inline note).
- **#27 DBA:** no blocking conditions. Ruled on the BIN-701 dispute — see below.

## Adjudicated: the BIN-701 verdict that withdrew batch 0 was WRONG

The sprint held all of BIN-596/598/617/701 because BIN-701 graded `correctness=fail`
`data-safety=fail`. BIN-701 is a **comment-only** change; no executing code.

Traced independently (me) and confirmed independently (#27 DBA), against
`WatchlistContext.tsx:371-411`: the effect's deps are `[uid, items, notesByTmdbId]`;
`legacy` takes `.slice(0, NOTES_MIGRATE_CAP)` of items still carrying an inline `notes`;
the batch DELETES that inline field; the listener echo drops those docs out of the filter
and re-fires the effect on the new `items`, which takes the next 300. `migratedNotesRef`
guards RETRIES, not the session. So `NOTES_MIGRATE_CAP` **paces**, it does not bound —
exactly what the new comment says. A 5000-note account migrates all 5000 in one session.

Cost: ~10 000 writes for such an account, under the 20 000/day free tier; pre-existing
BIN-505 behavior, unchanged by a comment. Not a new cost.

Two of three verifiers were wrong. Recorded on BIN-712.

## Found during analysis: BIN-669 has a REAL defect — fix it, don't park it

The sprint's `data-safety=fail` on BIN-669 is correct, and I verified the mechanism myself:
`AuthContext.signOut` (`AuthContext.tsx:601-613`) does **not** navigate. So signing out on a
guarded page flips `uid → null` on the still-mounted page, `AuthGuard`'s effect fires, and
BIN-669's new `rememberNextPath(location.pathname + location.search)` stores the *departing*
user's private path (e.g. `/grupper/<id>/`). Nothing clears it. BIN-669 then makes that value
survive a *different* account's onboarding (`login/page.tsx` leaves it unconsumed,
`OnboardingFlow.finish()` navigates to it). On a shared device, user B registering in the
same tab is auto-routed into user A's group URL. `firestore.rules` denies the content, so
there is no data leak — but B learns A's group id and lands on a permission error.

Parking BIN-669 is the wrong call for two reasons: the architect's condition (c) says the
split is the risky operation, and BIN-714 (Malin's decision today) rides on exactly this
return-path machinery — without BIN-669, a brand-new account that taps "sedd" loses its
return path at onboarding. **Fix BIN-669 and land all three together.**

## Order is binding (architect's mitigation). One commit per step.

### 1. Batch 0 — watchlist + auth write-path (BIN-596/598/617/701)
`git stash apply "stash@{2}"` — 9 files. Adds render-visible `snapshotSettled` /
`listenerFailed`, the `itemsRef`/`findItem` live-ref migration, `shouldStampVisibility`,
and the corrected BIN-701 comment (already inside the stash — verified; no separate edit).

**1b (Support's blocking condition).** The dead-listener hold must be perceivable without
hover.

**LANDED DESIGN — supersedes this item's first draft.** The draft said "a visible inline
notice … No toast". What shipped is the opposite: the failed state stays TAPPABLE and
answers on tap via the existing toast. Reason, decided while building it: `QuickAddButton`
is a 28px badge on a poster grid, and a permanent inline red line under every poster wrecks
the grid it sits in — while a toast is one mechanism that works identically in both
components, on touch and on desktop, and reuses machinery the app already has. The
transient holds (`Laddar…`) keep the disabled+tooltip form, because they end on their own.
The rule and the Swedish copy live in `src/components/title/libraryHold.ts` so the two
buttons cannot word it differently.

**1c (integration review, blocking — found after 1b).** `loading` was still the gate on
three sibling WRITE surfaces, which is the same defect one level out: `CollectionSection`'s
bulk "Lägg alla osedda i vill se" (hard-writes `status: 'vill_se'` over up to 50 films —
`status` is the field no payload shape can protect), `MoviePageClient`'s Bevaka CTA, and
`CompanionSection`'s add. All three now consume a single derived `libraryKnown` exposed by
`WatchlistContext`, rather than each re-deriving it. This was BIN-596's acceptance criterion
#2, which the first draft of this plan dropped.

**1d (security review, blocking).** `findItem` read one shared mutable `itemsRef` with no
account check, unlike the two sibling effects on the same ref. On a shared device an
in-flight call from account A could make its DECISION from account B's rows — sharpest in
`updateNotes`, where B's note-less copy would skip stripping A's legacy inline note (the
BIN-505 PII leak). Now guarded on `itemsUidRef`, answering `undefined` on mismatch.

**1e (test review, blocking).** `updateRating`'s migration to the live ref had no test —
reverting it left the suite green. Pinned now.

Acceptance: `npm run typecheck` clean; full `npx vitest run` green; every new guard
mutation-verified (mutant killed, then restored from a scratchpad snapshot and re-run).

### 2. Batch 1 — onboarding (BIN-664, BIN-659, BIN-669 fixed)
`git stash apply "stash@{1}"` — 7 files. Then fix BIN-669's defect:

`AuthGuard` must not remember the path on a **deliberate sign-out**. Implement as an
explicit signal from `AuthContext` (a `signingOut` flag set before `firebaseSignOut` and
cleared after the guard has run), NOT by ordering `clearNextPath()` inside `signOut` —
`signOut` is async and the guard's effect fires between its awaits, so a trailing clear is
a race, not a fix.

Acceptance: a test drives sign-out from a guarded page and asserts nothing is remembered;
a second test drives A-signs-out → B-registers → B finishes onboarding and asserts B lands
on `/`, never on A's path. `nextPath.ts` is a pure lib with no Firebase import, so this
stays testable without the emulator.

### 3. BIN-714 — signed-out tap routes to `/login` (Malin's decision, 2026-08-03)
Written against the file batch 0 landed, never speculatively. One shared helper
(`useSignedOutRedirect()`), called by BOTH `StatusButton` and `QuickAddButton`; the helper
documents its call sites the way `nextPath.ts` does. Replaces batch 0's
`holdReason = 'Logga in för att lägga till'` disabled branch with the redirect, ordered
BEFORE the library-known gate — matching QuickAddButton's existing BIN-645 order.

Return path via `sessionStorage` (`rememberNextPath`), NEVER `?next=`. Gate on `uid` before
any Firestore call (#27 DBA) so no write is fired that only fails at the rules layer.

Acceptance: both buttons behave identically for a signed-out visitor; a test pins the
order (redirect wins over the library gate); no `?next=` anywhere.

### 4. BIN-638 — streaming-offer tests
`git stash apply "stash@{0}"` — 1 test file, 9/9 green when the sprint ran it. Re-run.

### 5. BIN-687/688 — SEO content floor
`git apply .claude/state/sprint-patches/2026-08-03-0026-batch-4.patch` — 5 files,
`--check` already clean. Last, lowest coupling.

### 6. Housekeeping
- BIN-707: date-namespace this run's `batch-0/2/3.patch` before the next sprint reuses the
  slots. Gitignored — no diff, so record the disposition in the ticket, not in a commit.
- BIN-706: `.claude/state/workflow-map-stale.json` must be re-derived from the ACTUAL
  committed tree after steps 1-5, not from its current trigger list (which names files that
  were withdrawn). Own commit — never bundled with feature code.

## Gates

Each step: `npm run typecheck` → targeted tests → full `npx vitest run` before the last
commit. Reviewers per `.claude/shared-plugin.json` `reviewGates` (ledger mode — the agents
record their own verdicts; nothing is hand-written). Push once, at the end; that triggers
`deploy.yml` (hosting only). No rules/functions deploy is needed — no `firestore.rules`,
no `functions/**` in scope. Cloudflare purge after the deploy goes green.

## Still Malin's, not mine
- BIN-596 acceptance #3: she signs off a screenshot of the resting/disabled state. Item 1b
  changes what that screenshot shows, so it is taken AFTER 1b.
- Follow-up worth filing (Support, non-blocking): a return-toast after the login round-trip
  — a visitor who tapped "sedd" comes back to an unmarked title and may believe it was saved.
