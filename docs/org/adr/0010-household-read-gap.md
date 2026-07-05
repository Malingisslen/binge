# ADR 0010 — Household facet: read-gap disclosure + share-to-see reciprocity (BIN-184)

**Date:** 2026-07-05 · **Status:** Accepted (founder decision, live) · **Via:** /sprint-execute top-tier panel

## Context
BIN-184 adds an opt-in "Hushåll" facet on groups: members share subscription data
(`groups/{gid}/household/{uid}`, self-written) and see an aggregate household view.
The full panel (Security #4, Legal #5, DPO #6, DBA #27, Scoring #28) returned 5×
proceed-with-conditions, 41 raw must-haves, and escalated two judgment calls that
rules alone couldn't settle:

1. **Technical read-gap** — the UI shows aggregates only, but Firestore rules let a
   member read another member's itemized contribution doc. A true barrier needs a
   Cloud Function proxy (cost + complexity vs the 25 SEK/mån cap and the app's
   no-server pattern). Legal deemed disclosure-based mitigation workable *if
   prominent*; called it a conscious product-trust risk-acceptance.
2. **Reciprocity** — should contributions be readable by ALL group members
   (consistent with watchlist/progress precedent) or only by members who share
   their own data? First time the membership line would gate money-shaped data.

## Decision (Malin, 2026-07-05)
1. **Honest disclosure, no proxy.** The consent copy states plainly that the app
   shows only totals but opted-in group members can technically reach the itemized
   list. No Cloud Function.
2. **Share-to-see.** Household docs are readable only by members who have their own
   contribution doc (`exists()` reciprocity check in rules). Non-sharing members
   see a "dela för att se" gate, not the aggregate.
3. **No account-sharing disclaimer.** Copy never suggests sharing logins; adding a
   disclaimer would plant the idea (Scoring #28's flag resolved by staying silent).

## Consequences
- Rules read-gate costs one extra `exists()` get per read — acceptable at household
  scale (≤ a handful of docs per view).
- Revoking (deleting your doc) immediately removes your own access to others'
  contributions — coherent with the fairness rationale.
- The disclosure sentence is a **binding** part of the consent copy (Legal #3);
  removing it later reopens this ADR.
