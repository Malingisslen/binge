# BIN-184 Hushåll — approved plan (2026-07-05)

Malin: "plan out 184 and run it via cheaper subagents where appropriate."
Panel: top tier, roles [4,5,6,27,28] → 5× proceed-with-conditions (event logged).
Founder decisions (ADR 0010): honest disclosure (no CF proxy) · share-to-see
reciprocity · no account-sharing disclaimer.

## Design (final)
`groups/{gid}/household/{uid}` — opt-in, self-written contribution:
```
providerIds: number[]                    // canonical at write
providerCosts: Record<number, number>    // resolved ORDINARY kr at write (tier→custom→default) — NO tier names (DPO#1)
providerCampaigns: Record<number, {monthlyCost, endDate}>  // RAW (BIN-417 contract, read-time resolution)
activeProviderIds: number[]              // providers w/ ≥1 backlog title (provider-level only, DPO#9)
updatedAt: Timestamp
```
Aggregation pure + client-side (`aggregateHousehold(contributions, now)`), no
denormalized totals (DPO#6), no savings/sharing field in output (Scoring#7).

## Binding acceptance criteria (panel must-haves consolidated)

### Rules (firestore.rules + src/test/rules/firestore-rules.test.ts)
- AC-R1 create/update: signed-in && uid==self && self in memberUids && keys().hasOnly([the 5 fields]) && list/map types && size caps ≤100 (Sec#1, DBA#7).
  (Map VALUE shapes deliberately not deep-validated — bounded to the writer's own
  doc, matches user-doc convention; accepted by security review + xhigh.)
- AC-R2 read: GET own doc always (even missing/post-departure — GDPR flows need
  exists=false, not permission-denied; xhigh fix 2026-07-05); others' docs + LIST
  = member AND has own household doc (share-to-see, ADR 0010). Deletion flows
  NEVER list — refs derived from member uids.
- AC-R3 delete: self OR group owner.
- AC-R4 negative tests: non-member no read/write; member w/o own doc no read; member can't write another's doc; departed member no read; self+owner delete OK (Sec#3).
- AC-R5 parent groups update-rule untouched (BIN-276/327/365 pinning intact, Sec#5).

### Cleanup — no orphan paths (all in THIS change)
- AC-C1 leaveGroup + removeMember delete household/{uid} in the same batch (Sec#2, DBA#4). NB: removeMember today cleans nothing but members/{uid} — household must NOT inherit that gap.
- AC-C2 deleteGroup enumerates household in its cascade (DBA#3).
- AC-C3 accountDeletion collectDeletionRefs: owner branch + member branch both cover household; account-deletion.test.ts seeds + asserts it (DPO#3, DBA#5, Legal#4, Sec#4).
- AC-C4 buildUserExport includes own household contributions (per-group getDoc); data-export-format.md + schemaVersion minor bump (Legal#6, DPO#4).
- AC-C5 data-retention-policy.md entry (own line, usage-derived note for activeProviderIds) + integritet page names the new category/recipients/read-gap (Legal#7-8, DPO#2).

### Consent UX (Legal#1-3, DPO#8, DBA#6)
- AC-U1 per-group opt-in, default OFF, joining ≠ consent; pre-toggle disclosure modal (Swedish) stating: what's shared, current AND future members, purpose, one-tap revoke w/ immediate delete, and the technical read-gap sentence (binding, ADR 0010).
- AC-U2 opt-out control deletes own doc without leaving the group; reading clients drop the revoked member live (onSnapshot subscription, DPO#5).

### Write model (DBA#1-2)
- AC-W1 dirty-check: skip write when contribution content unchanged.
- AC-W2 fan-out from mutation sites (provider/cost/campaign edits in AuthContext) to household docs in opted-in groups, mirroring updateMemberProviders; plus lazy refresh on group-page visit.

### Aggregation honesty (Scoring#1-9)
- AC-A1 cross-member canonical merge on ALL id keys incl. activeProviderIds (alias 531+431 → ONE row, paidByCount 2).
- AC-A2 single injected `now`; campaign lapse reverts regardless of contribution age; no hidden Date.now/new Date() in module.
- AC-A3 unknown cost: excluded from totalKr, surfaced via an explicit per-row
  unknownCostCount — never silently 0. (REFINED 2026-07-05 from "counted in
  paidByCount": a separate counter is strictly more informative — the UI shows
  BOTH "betalas av N" and "M med okänd kostnad" — and keeps paidByCount honest
  against the kr-sum next to it. Conscious deviation, xhigh finding resolved.)
- AC-A4 free/ads (0 kr) excluded from spend AND dead-weight eligibility.
- AC-A5 staleness: HOUSEHOLD_STALE_DAYS=30; stale contributor's activity = UNKNOWN → provider never dead-weight on stale evidence; per-row freshness flag (not just household-wide).
- AC-A6 empty input → zeros/null, no crash; uncatalogued id doesn't throw.
- AC-A7 double-count total is deliberate ("betalas av 2 av er"); copy hedges activity as "backlog", never "såg".

## Build order + delegation
1. householdAggregate.ts + tests — main model (correctness-critical).
2. groups.ts: HouseholdContribution type, subscribe/set(dirty-check)/delete, leave/remove/deleteGroup cleanup — main model.
3. accountDeletion.ts + dataExport.ts coverage — main model.
4. firestore.rules household block + rules tests both files — main model.
5. UI: consent modal + HouseholdPanel (left rail after ProviderOverlapPanel) + useGroupHousehold + AuthContext fan-out — main model; preview to Malin.
6. Docs (retention, export-format, integritet page) — DELEGATE sonnet w/ exact shapes.
7. Gates: lint+typecheck+test+build+test:rules (Java via Android Studio JBR). Reviewers: code+security+test (opus). Deploy: hosting via push; rules via manual firebase deploy (standing grant). Verify live.

No architecture-changing unknowns: assumptions locked by panel + ADR 0010.
