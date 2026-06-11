// T4: TMDB ger generiska avsnittsnamn ("Avsnitt 1" / "Episode 1") när inget
// riktigt namn finns. "S3E1 — Avsnitt 1" är dubbel avsnittsangivelse — visa
// bara koden + datum då. Riktiga avsnittstitlar visas som vanligt.
// T3: countAiredEpisodes gate:ar "Markera alla sedda" på säsonger där inget
// avsnitt sänts ännu.

export interface EpisodeLabelInput {
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string;
}

/** Sant när namnet bara upprepar avsnittsnumret (TMDB-generiskt). */
export function isGenericEpisodeName(name: string, episodeNumber: number): boolean {
  const m = /^\s*(?:avsnitt|episode)\s*#?\s*(\d+)\s*$/i.exec(name);
  if (!m) return false;
  return parseInt(m[1], 10) === episodeNumber;
}

/** "S3E1 — Riktigt namn (2026-07-02)" eller "S3E1 (2026-07-02)" vid generiskt namn. */
export function formatNextEpisodeLabel(ep: EpisodeLabelInput): string {
  const code = `S${ep.season_number}E${ep.episode_number}`;
  const showName = ep.name && !isGenericEpisodeName(ep.name, ep.episode_number);
  const base = showName ? `${code} — ${ep.name}` : code;
  return ep.air_date ? `${base} (${ep.air_date})` : base;
}

/** Antal avsnitt med air_date idag eller tidigare (yyyy-mm-dd-jämförelse). */
export function countAiredEpisodes(
  episodes: readonly { air_date: string | null }[],
  todayIso: string,
): number {
  return episodes.filter(ep => !!ep.air_date && ep.air_date <= todayIso).length;
}
