# 0027. Joining a household is the consent; a Privat title is kept out

- **Date:** 2026-10-31
- **Status:** Accepted
- **Trigger:** Malin's decision in the thread "Granska och pusha hushållsläget"; plan `radgivaren/hushall-ny-integritetsmodell-plan.md`

## Decision (Malin, 2026-10-31)
1. Joining a household means sharing what you watch at service level: which services you have, what they cost, whether you use them, and whether you have something new coming. Titles, dates and counts are still never shared.
2. The one way to keep a title out is to mark it Privat. A title whose own visibility is `private` is skipped when `activeProviderIds` and `soonProviderIds` are built. A title that only inherits a private profile default is not skipped (the member can see this in the consent text: "en titel du markerat som Privat").
3. Supersedes the part of ADR 0010 and ADR 0026 that treated each extra field as its own consent. The binding disclosure sentence of ADR 0010 and the share-to-see read gate are unchanged. Existing sharers still see the consent text once (`needsReshare`), because they agreed to the earlier wording.

## Consequences
- No rules, field or schema change. The filter is in `buildHouseholdContribution` and `buildSoonProviderIds`.
- The privacy policy needs a version bump and a Legal #5 / DPO #6 read before release.
