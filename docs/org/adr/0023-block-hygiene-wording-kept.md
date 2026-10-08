# 0023. Block texts: the "hygiene, not a security boundary" wording stays as it is for now

- **Date:** 2026-10-01
- **Status:** Accepted
- **Trigger:** BIN-1358 / BIN-1388 / BIN-1387 — comment-only edits in `firestore.rules` and `docs/moderation.md` §6 about blocking after BIN-1349
- **Stakeholders (panel):** #4 Security Architect (approve-with-conditions), #12 Trust & Safety (approve-with-conditions), #21 Technical Writer (approve-with-conditions), Codebase Archaeologist. #6 and #27 dropped: comment-only rules edit, no data-scope change.

## Context
The bundle corrects text that described blocking as it worked before BIN-1349. Next to the
edited comment sit sentences saying blocking is "hygien-nivå, inte säkerhetsgräns" (in
`firestore.rules` and in the header of `src/hooks/useBlockedUsers.ts`), which match the
accepted deviation "Blocking is hygiene-level, not a security boundary".

## Conflict
#21 wanted those sentences struck or scoped to the content filter in this bundle, because the
friend-request create rule reads the block document. #4 wanted their meaning kept unchanged
and the accepted deviation left untouched, so that content blocking is never described as
enforced by the rules.

## Decision
Kept unchanged in this bundle. Resolved by the priority order: security (#4) over
documentation (#21). Scoping the sentences is filed as its own follow-up ticket, where the
accepted-deviation entry can be considered with them.

## Consequences
The bundle ships as text corrections only. The follow-up covers the two sentences and the
accepted-deviation entry together.

## Decided by
Synthesizer (priority order: security over documentation)
