/** True when the logged progress is at or past the given episode of a series. */
export function isEpisodeSeen(
  progress: { lastWatchedSeason: number | null; lastWatchedEpisode: number | null } | null | undefined,
  season: number,
  episode: number,
): boolean {
  if (!progress || progress.lastWatchedSeason == null) return false;
  const e = progress.lastWatchedEpisode ?? 0;
  return progress.lastWatchedSeason > season || (progress.lastWatchedSeason === season && e >= episode);
}

export function episodeCodeLabel(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}
