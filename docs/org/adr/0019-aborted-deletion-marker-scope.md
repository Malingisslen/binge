# 0019. An aborted deletion is guarded on one device, and the auth account survives

- **Date:** 2026-08-11
- **Status:** Accepted (Malin, 2026-08-11)
- **Extended by:** [0022](0022-cross-device-deletion-gap-accepted.md) (2026-08-15) —
  question 2 below rules the surviving auth account a documented, swept DELAY rather than
  a breach, and conditions that ruling on the window being real. 0022 records that the
  precondition does **not** hold for the cross-device case: a marker-less device merely
  loading an authenticated page recreates the profile, and the account then leaves the
  sweep's candidate set permanently. That consequence was accepted on its own terms
  (Malin, 2026-08-15) with #6 DPO dissenting on the record. Read 0022 before relying on
  question 2's reasoning for anything outside the never-returns case.
- **Trigger:** BIN-816 — an aborted account deletion recreates `users/{uid}` with a fresh
  `termsAcceptedAt`/`ageConfirmedAt`. Fileset routed `tier: top` (high-stakes hits on
  `src/contexts/AuthContext.tsx`, `src/lib/firebase/userData.ts`).
- **Stakeholders (panel):** #5 Legal / GDPR Counsel (approve-with-conditions), #6 Data
  Protection Officer (approve-with-conditions), #4 Security Architect
  (approve-with-conditions), #27 Database Administrator / Data-layer Engineer
  (approve-with-conditions), #19 Customer Support / Success (approve-with-conditions),
  plus a blind Codebase Archaeologist pass. Router dropped #2 Accessibility, #14 Software
  Architect and #18 Community Manager as incidental path matches.

## Context

The ticket's acceptance criteria propose a device-local `localStorage` marker, keyed on
uid, that stops `ensureUserProfile` from recreating the profile document after a deletion
cascade has already run. AC#5 forbids putting the marker in Firestore, on the grounds that
a document under `users/{uid}` recreates exactly what is supposed to be deleted.

All five seated roles approved the shape. None blocked. The panel converged instead on two
things the plan does not do, and both are decisions rather than defects.

## Conflict

**1. Where the marker lives — and therefore who it protects.**

Legal (#5) holds that keeping the marker out of Firestore is correct and must not be walked
back for cross-device convenience. The Codebase Archaeologist independently observed that
this repo's established pattern for cross-session state is the opposite — a pending-flag
field on the profile document (`visibilitySyncPending`, BIN-587) — and that BIN-748
(`src/lib/tabSession.ts`, commit `0b078db`) explicitly *rejected* `localStorage` for a
structurally identical problem because a flag with no natural retirement can never be
safely cleared. The DPO (#6), Security (#4) and Support (#19) each reached the same
consequence from their own seat without seeing the others: on a second device, a private
window, or after clearing site data, there is no marker and the original bug reproduces in
full.

The tension is real but not irreconcilable: no role asked for a Firestore marker. What they
ask for is that the device-local scope be *named* as a decision rather than discovered
later as a fresh bug.

**2. Whether stopping resurrection counts as finishing the erasure.**

Legal (#5) and the DPO (#6) both flagged, independently and both refusing to rule, that the
plan converts a visible defect (data comes back) into an invisible one (a Firebase Auth
account holding the user's email and identity survives indefinitely, with no path that ever
completes the Article 17 request the user actually made). Both cite the interpretive
question their dossiers require them to escalate: whether an auth account surviving an
aborted erasure is a **breach** of Art. 17 or merely a **delay** under the "without undue
delay, within one month" standard of Art. 12(3). Neither found EDPB or IMY guidance
specific to this failure mode.

## Decision

**Escalated to Malin, and answered by her the same session (2026-08-11).**

**Question 1 — scope.** Does BIN-816 grow to include finishing the erasure server-side, or
does that become its own ticket?
→ **Grow the ticket.** BIN-816 now covers both halves: the client-side resurrection guard
*and* a reaper in the `retentionCleanup` family that deletes Firebase Auth accounts with no
matching `users/{uid}` document, independent of any client marker and of whether the user
ever returns. Nothing here is called done until an aborted erasure actually completes.
Malin's stated reason: stopping the profile from coming back is not the same as honouring
the request the user made.

**Question 2 — breach or delay.** Is the surviving auth account a breach of Art. 17, or a
delay under Art. 12(3)?
→ **Delay, written down.** The half-deleted state is treated as a delay inside the law's
one-month window, not as a breach — on the condition that the window is *named* in
`docs/data-retention-policy.md` and that the reaper from question 1 is what holds it. An
undocumented, unbounded delay would not survive this reading; a documented, swept one does.
This is a founder decision on an interpretive question that both Legal (#5) and the DPO (#6)
explicitly declined to rule on, and it is recorded here as hers.

The two answers bind together: the reaper is no longer optional hardening, it is the
mechanism that makes "delay" an honest description rather than a hopeful one.

The device-local scope of the marker (conflict 1) is **resolved by the panel** and needs no
escalation: keep `localStorage` per AC#5, and record the cross-device gap as a named,
accepted limitation in `docs/data-retention-policy.md` and
`.claude/rules/accepted-deviations.md`. Deciding tier: legal/privacy (tier 2) over
data-integrity (tier 3) — Legal's reason for keeping it out of Firestore is that the
alternative reintroduces the erased data itself, which is the stronger harm.

## Consequences

Binding conditions on any BIN-816 build, folded from the panel's must-haves:

1. **Guard every revival path, through one chokepoint.** The ticket names two
   (`markNotificationsSeen`, `updateUserField`). The DBA and the Archaeologist independently
   counted seven `merge:true` writes to `users/{uid}` in `AuthContext.tsx` —
   `writeVisibilitySyncPending`, `updateProviderTier`, `resumeProvider`'s batch,
   `updateDefaultVisibility`, `updateNotificationSettings`, plus the two named — and an
   eighth in `src/components/onboarding/OnboardingFlow.tsx`. Per-call-site patches reopen
   the hole the next time a write site is added.
2. **Set the marker only after the freshness preflight passes**, immediately before the
   cascade starts — never on button click. `STALE_SESSION_PREFLIGHT` must remain a true
   no-op, or a user who merely clicked too late is locked out with nothing deleted.
3. **Never gate `deleteAccount()` itself, or its "Försök igen" retry, on the marker.** The
   cascade is proven idempotent and the retry is the only recovery path there is.
4. **A marked user gets a real, persistent screen** — not the self-dismissing toast — that
   explains the half-finished deletion and offers the way to finish it, on every load, and
   that screen must be reachable while the profile is null.
5. **A returning, freshly re-authenticated marked session should attempt `deleteUser()`
   again** rather than only suppressing recreation forever. Per Malin's answer to question
   1 this is in scope, not a follow-up.
5b. **A server-side reaper** in the `retentionCleanup` family deletes Firebase Auth accounts
   with no matching `users/{uid}` document, on a stated schedule, independent of the client
   marker and of whether the user ever returns. Its window is what makes the "delay"
   reading in question 2 honest, so the window and the sweep must ship together. Note this
   needs a manual `firebase deploy --only functions` — `deploy.yml` ships hosting only —
   and the sweep must not delete an auth account whose `users/{uid}` is merely *loading*
   or temporarily unreadable; a zero-result read means "could not check", not "nothing
   there".
6. **Marker hygiene:** strictly uid-scoped, read fresh from `localStorage` at every guarded
   site (never cached in a ref — BIN-592's stale account-keyed-ref bug), and explicitly
   excluded from the generic PII-localStorage sweep the deletion cascade already performs.
7. **Test bar matching BIN-748's:** assert `users/{uid}` does not exist at all after a
   simulated re-login (not merely that the consent fields are unchanged); cover every
   merge-writer, not just the login path; prove `tryAutoClaimUsername` does not fire; and
   prove an interrupted cascade still converges on retry.
8. **Write down the limits:** the cross-device/private-window/cleared-storage gap in
   `docs/data-retention-policy.md`, and the no-natural-retirement property of the marker in
   `.claude/rules/accepted-deviations.md` as a conscious departure from BIN-748's lesson.
   Per question 2, the same policy document must state the window within which an aborted
   erasure is swept to completion — that named window is the whole basis for treating the
   surviving auth account as a delay rather than a breach.
9. **Support runbook note** in `docs/RUNBOOK.md`: how to recognise a stuck half-deletion
   from the Firebase Console (auth account present, `users/{uid}` absent), since the marker
   lives on the user's device and no admin surface can query it.

This review advises. Nothing was built, committed or deployed.

## Decided by

Panel convened 2026-08-11 by Malin in an attended session, after the ticket sat parked
since 2026-08-08 precisely because an unattended sprint cannot convene one. Both escalated
questions answered by **Malin** the same session: grow the ticket to include the
server-side reaper, and treat the surviving auth account as a documented delay rather than
a breach. Conflict 1 (marker placement) resolved by the synthesizer on the priority rubric,
tier 2 legal/privacy over tier 3 data-integrity.
