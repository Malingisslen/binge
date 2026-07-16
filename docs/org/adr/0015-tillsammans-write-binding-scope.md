# ADR 0015 — Tillsammans write binding: anon residual accepted; expiry gate re-declined

**Date:** 2026-07-16 · **Status:** Accepted (Malin, BIN-509 escalations A+B) · **Via:** /stakeholder-review full panel (Security #4, DPO #6, QA #7, DBA #27 + Codebase Archaeologist)

## Context
BIN-509 closed the Tillsammans forgery holes: swipes had ZERO caller binding (anyone could
overwrite any participant's vote — matching treats 'veto' as -Infinity, so one hostile
link-holder could kill or fabricate the group's match), and participants bound the uid
FIELD (BIN-24) but not the doc PATH (slot hijack). The panel converged unanimously on the
fix shape but escalated two decisions to the founder.

## Decision A — anonymous forgery residual: ACCEPT (option A1)
Firestore rules cannot authenticate an unauthenticated caller, and any "secret" persisted
on a public-read doc (participants/swipes are `read: if true`) is readable — a false proof.
Options considered: A1 accept residual · A2 require login to vote (product regression for
the link-share flow) · A3 Firebase Anonymous Auth (real binding, but a NEW pseudonymous
identifier: GDPR inventory + retention/reaper story — anon auth accounts never auto-expire).
**Malin chose A1.** Shipped semantics: signed-in participants' votes/slots are forgeable by
no one; anon writers are verified against the participant doc (`uid == null`) so they cannot
touch signed-in votes either; wholesale votes-map replacement is impossible for everyone;
what remains is one link-holder forging another ANONYMOUS participant's single vote —
ephemeral 7-day data under the unlisted-link trust model. Recorded in
`.claude/rules/accepted-deviations.md`.

## Decision B — session-expiry gate on writes: KEEP THE BIN-24 OMISSION
BIN-24 (e6d02e8) deliberately omitted `get(session).expiresAt > request.time` on
participant/swipe writes for per-write read cost. The BIN-509 panel proposed reversing
that (expired sessions linger up to ~30d before retentionCleanup reaps). **Malin
re-affirmed the omission** — zero extra reads; zombie-session writes accepted until reaped.
Re-open only on new facts (observed abuse), not on re-review.

## Consequences
- Rules read cost: the common signed-in vote path costs no extra reads (short-circuits on
  own-key match); only anon-path votes pay one participant-doc `get()` — required to keep
  signed-in votes unforgeable by anon callers.
- Anon voters cannot CHANGE an already-cast vote (indistinguishable from forging another
  anon's key; add-only). recordSwipe only writes first-votes per title, so no legitimate
  flow hits this; if a re-vote feature ever ships, this rule needs a rethink.
- Follow-up filed for the adjacent, out-of-scope hole: `vetoRemaining`/`isHost` values are
  client-writable (no value validation) — the one-veto cap is UI-only.
