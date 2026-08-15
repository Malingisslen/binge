# 0022. The cross-device aborted-deletion gap is accepted; the re-stamped consent record is not

- **Date:** 2026-08-15
- **Status:** Accepted (Malin, 2026-08-15)
- **Trigger:** BIN-879 — "Den som återkommer på en ANNAN enhet efter en avbruten radering
  fångas inte". Filed by #6 DPO during BIN-813's panel on 2026-08-13. The ticket says in its
  own text that it must go via #5 Legal and #6 DPO and not through an unattended sprint.
  Fileset (`docs/data-retention-policy.md` + this ADR) routed `tier: medium`,
  `reasonCode: owned`, seating #6; #5 was added because the ticket names it.
- **Stakeholders (blind critiques, one per role, neither seeing the other):**
  #5 Legal / GDPR Counsel (**accept the gap**), #6 Data Protection Officer
  (**fix with mechanism**).

## The question

`deleteAccount()` erases Firestore first and removes the Firebase Auth user last, because
the client loses every write permission the moment the auth user is gone. If the second
half dies, an Auth account survives with its data erased. `src/lib/deletionMarker.ts`
writes a `localStorage` marker that makes `AppShell` render the limbo screen and
`userDocWrite.ts` refuse every `users/{uid}` write, so the next page load cannot recreate
the profile.

The marker is device-local. ADR 0019 decided that deliberately: anything durable under
`users/{uid}` recreates the very document the deletion is erasing, and #5 Legal was
explicit it must not move there. BIN-879 asks what to do about the gap that leaves —
without reopening that ban.

## What both roles agreed on, independently

Two things, and they matter more than the disagreement.

**First, the sharp end of this is not the retention delay — it is a fabricated consent
record.** When `ensureUserProfile` recreates the profile it stamps `termsAcceptedAt` and
`ageConfirmedAt` with today, having shown no consent step. #5 called it "the part with
actual legal teeth"; #6 made it a binding condition. Neither was told the other's view.

**Second, the published wording had to change regardless of the verdict.**
`docs/data-retention-policy.md` described the point as open, and #6 showed it also
undersold the consequence in two specific ways (below).

## Where they disagreed

**#5 Legal — ACCEPT.** Only the account holder, on their own credentials, can trigger it.
No third party gains anything and no personal data is exposed beyond what that same person
could always see about themself. The substantive data — 25 collections — is already gone;
the cascade ran before this state is reachable. What survives is an account shell and the
consent artifact, and full self-service remains: deleting again restarts the chain.

**#6 DPO — FIX.** ADR 0019 question 2 accepted the surviving auth account as a *delay*
rather than a breach, but conditioned that reading explicitly on the window being real and
swept: *"An undocumented, unbounded delay would not survive this reading; a documented,
swept one does."* A marker-less device merely **loading** an authenticated page recreates
the profile, and `collectOrphanedAuthAccounts` candidates on "Auth account exists AND
profile confirmed absent" — so the account leaves the sweep's candidate set **permanently**.
That converts the bounded delay into an unbounded one, which is the exact failure mode
ADR 0019 said its own reasoning would not survive. #6 also rejects the framing that the
user reopened their own request: a page load on an already-signed-in device is not an
intentional act, and the backdated stamp actively misrepresents that it was.

#6's proposed fix was not to move the marker. It was to stop `ensureUserProfile` from
silently stamping fresh consent when the Auth record's `metadata.creationTime` shows this
is not a fresh signup — routing that case to an explicit welcome-back step instead.

## Decision

**Malin, 2026-08-15: accept the gap. File the consent-stamp fix as its own ticket with its
own panel.**

The accept rests on #5's reasoning. The dissent is not resolved and is not treated as
resolved — it is recorded here in full, and the policy text says a role disagreed rather
than presenting the accept as unanimous.

The two positions are closer than their headline verdicts suggest: #6's proposed mechanism
targets the consent stamp, not the marker's location, and that is precisely the part being
filed rather than dropped. What is being accepted is narrower than "the gap" as the ticket
framed it — it is the account shell outliving the sweep, not the fabricated consent record.

### Conditions carried into the work

1. `docs/data-retention-policy.md` states the accept with its date and reasons, and states
   the three things #6 showed the old wording undersold: the trigger is a **page load**,
   not active use; the account leaves the sweep's candidate set **permanently** rather than
   being delayed; and this **falsifies the precondition** ADR 0019 question 2 rests on.
2. The consent stamp gets its own named line in that document, never folded into the
   device-scope paragraph (#5's condition 3).
3. That document also records that a fix confined to `userDocWrite.ts` is a **no-op** here:
   those write sites read the marker, which is by definition absent on the second device
   (#6's condition 4).
4. `src/lib/deletionMarker.ts`'s header comment is corrected. It claimed the server sweep
   closes this gap, which contradicted the policy document in the same repo — and a
   maintainer would have believed the comment.
5. ADR 0019's ban on a durable `users/{uid}` record is reaffirmed as covering BIN-879
   explicitly, so a later contributor does not treat it as a fresh question (#5's
   condition 5).
6. `docs/RUNBOOK.md` gains the support signature for "the user says they deleted their
   account but can still sign in", and says to treat a live instance as an overdue Art. 17
   request to be completed manually — not as normal operation (#5's §4, #6's §4).
7. If Auth custom claims are ever built to close this, that routes through its own top-tier
   panel — #4 Security and #27 DBA at minimum, for the token-refresh and claims/rules
   interaction — and never inside an unrelated batch (#5's condition 4).

### Re-open triggers

A real support case showing an account in this state. #6's reading is that such an instance
is already a late Art. 17 request by the time it surfaces, so it is completed by hand and
logged, not absorbed as normal operation.

## Consequences

The accept is cheap to reverse and expensive to have gotten wrong silently, which is why
the dissent is preserved verbatim rather than summarized into agreement. The policy document
now describes a decided state instead of an open one, and the one piece with genuine legal
teeth — consent manufactured for someone who asked to leave — is tracked as its own work
rather than riding along inside a retention-timing discussion where it does not belong.
