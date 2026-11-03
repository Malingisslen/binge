# 0029. Household members see what the others watch, by title and first name

- **Date:** 2026-11-03
- **Status:** Accepted by Malin 2026-11-03 (consent text approved in the thread)
- **Trigger:** Malin's decision in the thread "Skapa hushåll med Malins man": "Ni tittar på" is in the first release of the household page. Panel (Legal #5, DPO #6, Security #4, DBA #27, Community #18) ran 2026-11-03.

## Decision
1. A household member who has shared sees, for the other sharing members, the titles they are currently watching, with the member's first name. Nothing else about a title is shared: no status, rating, timestamp or note.
2. A title whose own visibility is `private` is never part of what is read. It is excluded from the data, not only hidden in the interface.
3. The consent text is shown before "Gå med" and in the sharing dialog, names what is shared, and says that private titles are left out. The purpose is a household overview, not profiling.
4. Supersedes point 1 of ADR 0027 ("Titles, dates and counts are still never shared") for the one case in point 1 above. ADR 0010 and ADR 0026 are affected only for that sentence.
5. Existing sharers get `needsReshare` and see the new text before anything of theirs is shown.
6. Invitations go only to confirmed friends with their own account. No sharing for people without an account, and no copy that implies sharing a streaming account (ADR 0010).

## Consequences
- In the household consent text, ADR 0010's disclosure reads "Tekniskt kan delande medlemmar nå din enskilda lista": its opening clause "I appen visas bara totalsiffror" is no longer true where titles are shown. Ordinary groups keep the sentence unchanged.
- The privacy policy needs a version bump and a Legal #5 / DPO #6 read before release.
- The export and retention documents get the new data; tests cover export, deletion and the private-title exclusion.
- The rules mark a household with `kind: 'household'`, fixed at creation, cap it at 6 members, refuse joining it by link, and allow `watchingNow` (at most 10 entries) only in a household. Invitations into a household carry the kind and go only to a confirmed friend who has not blocked the owner.
- One household per person and the shape of each `watchingNow` entry are checked by the client; the ledger entry of 2026-11-03 in `.claude/accepted-deviations.md` says why.
