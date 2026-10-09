import { formatEpisodeCode } from '@/lib/utils';

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
  const code = formatEpisodeCode(ep.season_number, ep.episode_number);
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

/**
 * Nästa avsnitt, eller null när dess datum redan passerat. TMDB:s
 * `next_episode_to_air` kan ligga kvar efter sändningen, och en förrenderad
 * sida bär värdet från byggdagen.
 */
export function upcomingEpisode<T extends { air_date: string | null }>(
  ep: T | null | undefined,
  todayIso: string,
): T | null {
  if (!ep) return null;
  return !ep.air_date || ep.air_date >= todayIso ? ep : null;
}

/** "2019–2023", "2026–" för en pågående serie, och bara "2026" när den slutade samma år. */
export function seriesYearSpan(firstAirDate: string | undefined, lastAirDate: string | undefined, ended: boolean): string {
  const start = firstAirDate?.substring(0, 4) || '—';
  if (!ended) return `${start}–`;
  const end = lastAirDate?.substring(0, 4) ?? '';
  return !end || end === start ? start : `${start}–${end}`;
}
