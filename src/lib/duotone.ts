// Direction H "Schemat" duotone palette — eight muted tones, one per
// genre/category. Each tone is implemented as an SVG <filter> defined in
// <DuotoneFilters /> and applied via CSS `filter: url(#duo-<tone>)` on the
// poster <img>. See docs/design_handoff_direction_h_schemat/README.md.
//
//   Use duotone for IDENTIFICATION surfaces (lists, library, calendar,
//   recommendations, similar-shows, hero-block poster). Use raw imagery for
//   PREVIEW content (episode stills, trailer, gallery, cast).

export const DUOTONES = [
  'terra',   // drama, family, period
  'slate',   // krim, noir, thriller
  'moss',    // nature, documentary, biographical
  'clay',    // comedy, youth, light
  'plum',    // mystery, fantasy, supernatural
  'steel',   // sci-fi, tech, future
  'olive',   // reality, sport, lifestyle
  'oxblood', // horror, action, intense
] as const;

export type Duotone = (typeof DUOTONES)[number];

// Map a TMDB genre id (movie + tv) to a duotone tone. TMDB genre ids:
//   28 Action  · 12 Adventure · 16 Animation · 35 Comedy · 80 Crime
//   99 Documentary · 18 Drama · 10751 Family · 14 Fantasy · 36 History
//   27 Horror · 10402 Music · 9648 Mystery · 10749 Romance
//   878 Science Fiction · 53 Thriller · 10752 War · 37 Western
//   10759 Action & Adventure (TV) · 10762 Kids · 10763 News
//   10764 Reality · 10765 Sci-Fi & Fantasy (TV) · 10766 Soap
//   10767 Talk · 10768 War & Politics
const GENRE_TO_TONE: Record<number, Duotone> = {
  18: 'terra', 10751: 'terra', 36: 'terra', 10749: 'terra', 10766: 'terra',
  80: 'slate', 53: 'slate', 9648: 'plum',
  99: 'moss', 16: 'moss',
  35: 'clay', 10762: 'clay',
  14: 'plum', 10765: 'plum',
  878: 'steel',
  10764: 'olive', 10767: 'olive', 10402: 'olive',
  27: 'oxblood', 28: 'oxblood', 12: 'oxblood', 10759: 'oxblood', 10752: 'oxblood', 10768: 'oxblood', 37: 'oxblood',
};

export function toneForGenreIds(ids: readonly number[] | undefined | null): Duotone {
  if (!ids?.length) return 'terra';
  for (const id of ids) {
    const t = GENRE_TO_TONE[id];
    if (t) return t;
  }
  return 'terra';
}

// Deterministic fallback when we don't have genre data — derive a tone from
// the TMDB id so the same title always gets the same tone across sessions.
export function toneForId(id: number | string): Duotone {
  const n = typeof id === 'number' ? id : id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return DUOTONES[Math.abs(n) % DUOTONES.length];
}

export function duoClass(tone: Duotone): string {
  return `duo-${tone}`;
}
