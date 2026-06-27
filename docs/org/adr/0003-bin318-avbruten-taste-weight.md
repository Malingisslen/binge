# 0003. BIN-318 — taste weight for rated-but-abandoned titles

- **Date:** 2026-06-27
- **Status:** Accepted (proceed-with-ruling)
- **Trigger:** `/sprint-execute` selected BIN-318 (rated `avbruten` items get a positive
  genre weight instead of the −0.5 penalty). Routed `medium` → owning specialist.
- **Stakeholder:** Recommendations / Scoring-Integrity Engineer #28 (medium) — owns the
  correctness of `buildTasteVector`.

## Context
`weightForItem` (`src/lib/taste/vector.ts`) tested `item.rating != null` **before**
`item.status === 'avbruten'`, so an abandoned-but-rated title returned a positive weight
and never reached the −0.5 penalty — pushing the taste vector *toward* a genre the user
quit. The ticket proposed a flat fix: guard the rating branch so abandoned items always
return −0.5.

## Conflict
Step-0 code re-read surfaced a **committed test asserting the opposite**:
`vector.test.ts:62` — `'avbruten med rating använder rating-vikten (rating vinner)'` —
asserted that rating wins for abandoned-but-rated items, *as intended behavior*, using
off-scale data (`rating: 8`; the watchlist scale is 0.5–5). The testing-honesty policy
forbids rewriting a passing assertion just to make a fix go green. So which is intended —
the ticket, or the test? This is a scoring-design call owned by #28.

## Decision — #28's ruling: REPLACE the test; implement a THRESHOLD rule (neither extreme)
Both the existing test ("rating wins") **and** the ticket ("flat −0.5") are wrong:
- "Rating wins" is indefensible: a 1–2★-rated *and* abandoned title is the strongest
  negative signal, yet the old code gave it a *positive* weight.
- "Flat −0.5" over-corrects: a 5★-rated-but-abandoned title (loved the genre, bailed on
  the title — e.g. a show that jumped the shark) should not penalize that genre.

**Implemented rule:**
```
if (item.status === 'avbruten') {
  return item.rating != null && item.rating >= 4 ? 0 : -0.5;
}
```
- Threshold **4** (on the 0.5–5 scale) matches `classifySeeds`' raw strong-seed cutoff.
- High-rated abandon → **0** (neutral). `w === 0` is short-circuited in `buildTasteVector`,
  so these items also drop out of `sampleSize` — an ambivalent signal shouldn't inflate
  vector confidence. Correct.
- Unrated or low-rated abandon → **−0.5** (the genuine anti-signal).
- **Deciding tier:** scoring correctness (tier 3) — a domain-owner ruling, no human needed.

## Consequences
- `vector.test.ts:62` REPLACED with two real-scale cases: `avbruten`+4.5 → 0 (and
  `sampleSize === 0`); `avbruten`+1.5 → −0.5. The unrated-avbruten → −0.5 case stands.
- Block comment in `vector.ts` updated to document the threshold (keeps the intentional
  divergence with `stats.ts` documented, per #28's standing watch-item).
- This is the ONLY surface where abandoned-genre signal flows (seed classifiers already
  gate to `sedd`/`mina`), so the weight is load-bearing — noted in code.

## Decided by
Recommendations / Scoring-Integrity Engineer #28 (owns the weighting). Test replacement is
a corrected bug-encoding under the owner's ruling, not a weakened assertion.
