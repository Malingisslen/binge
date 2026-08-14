// Pure helper for RecRow, extracted so it can be tested without pulling the
// component's Firebase-touching imports into the test environment (the repo's
// standard test-extraction pattern, `.claude/rules/code-style.md`).

import type { RowSpec } from '@/types';

// Per-row rationale derived from the spec's id.kind. The mockup shows
// things like "vikt: 4,0 ★ · noir + svensk-dansk · liknande tonalitet" —
// we don't have all of that info, so we give a faithful but short line.
//
// This is the ONLY rationale the hub renders. `RowSpec.description` — the
// data-driven, per-row sentence prioritizeRows can build — reaches the screen in
// exactly one other place, RecommendationsExpanded's standfirst, i.e. behind
// "visa fler →". So a row whose reason lives only in `description` says nothing
// where the user actually is (integration review, 2026-08-14: BIN-811 shipped
// against that wrong assumption and was caught here).
export function whyForRow(spec: RowSpec): string {
  switch (spec.id.kind) {
    case 'trending':
      return 'populärt i Sverige · uppdaterat veckovis';
    case 'latest-fav':
      return 'byggd på din senaste 5★-favorit';
    case 'similar':
      return spec.meta?.seed ? 'utgår från en av dina favoriter' : 'baserat på dina betyg';
    case 'person':
      return spec.meta?.person?.knownFor === 'director'
        ? 'samma regissör'
        : 'samma medverkande';
    case 'genre-canon':
      return 'kanon i din mest tittade genre';
    case 'thematic':
      return 'röd tråd i dina favoriter';
    case 'upcoming':
      return 'kommande på dina tjänster';
    case 'free-public':
      return 'gratis via public service · 0 kr';
    case 'companion':
      // BIN-811: the row's own sentence, which NAMES the shows and says for each
      // whether you follow it or have finished it. That distinction is the whole
      // of Malin's option (c) — the generic line below cannot carry it, and the
      // expanded view is one click too far to be where it lands.
      // `.rec-cat .head` is `flex-wrap: wrap`, so the longer line wraps under the
      // title instead of squeezing the row's actions.
      //
      // The register break is DECIDED, not an oversight. Both reviewers flagged that
      // this is the one `.why` line on the page written as a sentence — capitalised,
      // comma'd, full stop — where its eight siblings are lowercase `·`-separated
      // fragments. Malin was shown all three renderings side by side (a short
      // fragment in the sibling style, and a named-but-lowercase middle option) and
      // chose this one on 2026-08-14: naming the shows is the whole point of option
      // (c), and a fragment that says "serier du följer · och serier du sett klart"
      // is option (b) again. Do NOT "harmonise" this line with its siblings.
      return spec.description ?? 'kurerad koppling · serien fortsätter som film';
  }
}
