// Curated "same series" map for TV shows that TMDB files as SEPARATE entries.
//
// Some long-running / rebooted series exist as several unrelated TMDB show ids —
// e.g. Doctor Who is the 1963 classic (121), the 2005 revival (57243) and the 2024
// relaunch (239770). Whichever one a user opens shows only its slice, so the page can
// look absurdly thin ("a 2-season 2024 show that's already cancelled"). Nothing else in
// the app links these together (TMDB's own franchise concept, `belongs_to_collection`,
// is film-only — see src/lib/seo/franchises.ts).
//
// This map lets the TV title page render a small "Samma serie" strip cross-linking the
// eras. Curated by hand (labels are never fetched → zero runtime TMDB cost), same
// hand-picked pattern as FRANCHISES. It is DISPLAY ONLY — it does not merge the shows,
// and touches no watchlist / progress / status data.

export interface SeriesEntry {
  /** TMDB tv id. */
  id: number;
  /** Human era label shown on the chip (the show name is identical across entries). */
  label: string;
}

// A continuity group = TMDB entries that are the same fictional series. Order is
// chronological (oldest era first) so the strip reads left-to-right in air order.
const GROUPS: SeriesEntry[][] = [
  [
    { id: 121, label: 'Klassiska serien · 1963–1989' },
    { id: 57243, label: 'Nystarten · 2005–2022' }, // last special "The Power of the Doctor" aired Oct 2022
    { id: 239770, label: '2024–' },
  ],
];

/** The OTHER TMDB entries that are the same series as `tmdbId` (empty array if none). */
export function relatedSeriesFor(tmdbId: number): SeriesEntry[] {
  const group = GROUPS.find((g) => g.some((e) => e.id === tmdbId));
  return group ? group.filter((e) => e.id !== tmdbId) : [];
}
