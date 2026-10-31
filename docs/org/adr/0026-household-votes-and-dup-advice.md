# 0026. Household votes with names, the "nytt inom 30 dagar" flag, and advice on a service paid twice

- **Date:** 2026-10-31
- **Status:** Accepted
- **Trigger:** plan `tasks/radgivaren-hushall-plan.md` (Rådgivaren steg 2, hushållsläge och röster), section "Beslut"
- **Stakeholders (panel):** #4 Security, #5 Legal / GDPR, #6 DPO, #27 DBA, #28 Scoring: all proceed with conditions

## Context
The household facet (ADR 0010) shares each member's subscription costs inside a group and
shows only totals. The advisor's household mode needs two more facts per member: on which
services the member has something new within 30 days, and what the member thinks the
household should do with each service this month. Both are added as optional fields on the
member's own contribution, `groups/{gid}/household/{uid}`, so no new collection, read path
or deletion path exists.

## Decision (Malin, 2026-10-31)
1. **Votes are shown with the voter's name.** A vote is `ok`, `keep` or `wait` per provider
   id, stored in `votes` with the month it applies to in `votesMonth` ("YYYY-MM", Swedish
   time). The name is never stored in the contribution: the UI reads it from
   `members/{uid}.displayName`, which every member of the group can already read. A vote
   from an earlier month is ignored when read and overwritten by the next write; no server
   job deletes it. Voting is a separate, active choice: a contribution is written without
   `votes` until the member votes.
2. **The soon flag.** `soonProviderIds` lists provider ids where the member has something
   new within 30 days, derived from the next-air date already stored on the member's
   watchlist rows. No title, date or count is stored. It is written only after the member
   presses Dela in the consent view that names it. A member who shared before this field
   existed is shown as "har inte delat nytt inom 30 dagar" and asked to share again; until
   then every aggregate counts them as unknown, never as "nothing new". The "N av M"
   figure is hidden when fewer than three members carry the flag, because with two each
   member can read the other's answer.
3. **The rules check the shape of the new fields, not each vote.** `votes` is a map of at
   most 100 entries and `votesMonth` matches `^\d{4}-\d{2}$`, but the rules cannot check
   every value in a map without a loop. The client validates the vote and the provider id
   before every write, and every reader treats an unknown value or key as no vote. This is
   recorded as an accepted deviation in `.claude/accepted-deviations.md`.
4. **Successor to ADR 0010 point 3.** A household is the people who live together. Two
   subscriptions to the same service in one household are a mistake to correct, not
   account sharing. "Betalas dubbelt" and advice to keep one of the two may be shown.
   ADR 0010 is otherwise unchanged, including its binding disclosure sentence in the
   consent copy and the share-to-see read gate.

## Consequences
- `firestore.rules`: `hasAll` keeps the five original fields; `hasOnly` adds exactly
  `soonProviderIds`, `votes` and `votesMonth`. The read, delete and reciprocity branches are
  unchanged, so a document written before this change can still be read and written.
- A vote write rebuilds the whole contribution in one `setDoc`, so `updatedAt` stays a true
  freshness stamp. The dirty-check covers the new fields, so rendering never causes a write.
- Export, opt-out, leaving the group, account deletion, group handover and the retention
  sweep already act on the whole document; their tests now seed the new fields.
- The consent copy gains a line on "nytt inom 30 dagar" and a line saying votes are shown
  with the member's name. The privacy policy is bumped in the same change.

## Decided by
Human owner (Malin), 2026-10-31, with the panel's conditions as binding acceptance criteria.
