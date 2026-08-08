// BIN-580 — curated "these Season-0 entries are real episodes" allow-list.
//
// TMDB files everything that isn't a numbered season under season 0: bloopers,
// featurettes, video diaries, concerts, making-ofs — AND, for a few shows, whole
// canonical episodes. The app hides season 0 everywhere (SeasonList,
// seasonCompletion, inventoryFromSeasons) because that is right for ~99% of shows
// (Game of Thrones has 300 season-0 featurettes, The Office 106). Doctor Who 2005
// is the case where it hurts: 199 season-0 entries, and entire broadcast years
// (2009, 2013, 2022 — "The Day of the Doctor", "The Power of the Doctor") exist
// ONLY there, so the page silently skips them.
//
// This map is the narrow exception: a hand-picked list of season-0 episode NUMBERS
// per show, rendered as one extra labelled section. It shares relatedSeries.ts's
// SHAPE — hand-curated, no TMDB metadata checked in, only episode numbers and our
// own section label — but not its affordance: relatedSeries is display-only and this
// section is tickable (see below). Nor its cost: relatedSeries fetches nothing, while
// expanding this section fires one lazy season-0 request, and the episode titles,
// stills and synopses all come from it live. The global hide-season-0 rule is
// untouched for every other show.
//
// TICKABLE since BIN-679. It was display-only before that, because
// markEpisodeWatched wrote the exact position you ticked: a season-0 tick parked
// the watchlist marker on S0 and someone caught up on 13 seasons who ticked "The
// Power of the Doctor" read as "bakom" across the library.
//
// That was fixed with a guard, not a new marker model. `useEpisodeProgressWithSync`
// routes season 0 straight to episodeProgress and never calls updateProgress, and
// `highestWatchedPosition` skips season 0 when recomputing the marker backwards —
// both halves are needed, since without the second an un-tick of the last numbered
// episode would fall back onto a watched special. Specials are their own track:
// they live in `episodeProgress.seasons["0"]` and never enter the marker from here.
//
// Still true, and NOT for the old reason: no bulk actions on this section. TMDB's
// season-0 numbering is sparse — this curated list is a handful of numbers scattered
// through ~199 entries — so an episode count and "everything up to N" are both
// meaningless. Per-episode ticks only.

export interface CanonicalSpecials {
  /** Section heading (Swedish UI). */
  label: string;
  /** TMDB season-0 `episode_number`s, in air order. Sparse — TMDB's numbering has gaps. */
  episodeNumbers: readonly number[];
}

// Verified against TMDB tv/57243/season/0 on 2026-08-01. Numbers are TMDB's own
// season-0 episode_number, which is why they are not contiguous: everything left
// out (Proms, "Best of…", video diaries, An Adventure in Space and Time,
// Confidential-style extras) sits between them. Re-verify before adding a show —
// curated ids guessed from memory are wrong more often than not.
const CANONICAL_SPECIALS: Record<number, CanonicalSpecials> = {
  // Doctor Who (2005 revival). The televised specials, in air order.
  57243: {
    label: 'Specialavsnitt',
    episodeNumbers: [
      2,   // The Christmas Invasion (2005)
      4,   // The Runaway Bride (2006)
      7,   // Voyage of the Damned (2007)
      9,   // The Next Doctor (2008)
      13,  // Planet of the Dead (2009)
      14,  // The Waters of Mars (2009)
      16,  // The End of Time (1) (2009)
      17,  // The End of Time (2) (2010)
      34,  // A Christmas Carol (2010)
      47,  // The Doctor, the Widow and the Wardrobe (2011)
      66,  // The Snowmen (2012)
      83,  // The Day of the Doctor (2013)
      84,  // The Time of the Doctor (2013)
      142, // Last Christmas (2014)
      148, // The Husbands of River Song (2015)
      149, // The Return of Doctor Mysterio (2016)
      154, // Twice Upon a Time (2017)
      156, // Resolution (2019)
      158, // Revolution of the Daleks (2021)
      208, // Eve of the Daleks (2022)
      209, // Legend of the Sea Devils (2022)
      210, // The Power of the Doctor (2022)
    ],
  },
};

/** The curated season-0 section for `tmdbId`, or null for the vast majority of shows. */
export function canonicalSpecialsFor(tmdbId: number): CanonicalSpecials | null {
  return CANONICAL_SPECIALS[tmdbId] ?? null;
}

/** True when this season-0 episode is one of the curated canonical ones. */
export function isCanonicalSpecial(tmdbId: number, episodeNumber: number): boolean {
  return canonicalSpecialsFor(tmdbId)?.episodeNumbers.includes(episodeNumber) ?? false;
}
