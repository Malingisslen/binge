import type { EpisodeProgress } from '@/types';

/**
 * Räknar fram högsta sedda position (säsong/avsnitt) ur en episodeProgress-map,
 * med möjlighet att exkludera en (season, episode) som just markerats osedd,
 * eller en hel säsong (`excludeSeason`) som just "avmarkerats alla".
 * Returnerar null om inga avsnitt är sedda kvar. Specials (säsong 0) räknas med
 * men förlorar mot vilken säsong >= 1 som helst.
 *
 * Ren funktion (ingen Firebase-import) → enhetstestbar utan emulator.
 */
/**
 * BIN-588: är HELA säsongen sedd? Räknar distinkta sedda avsnitt i säsongen ur
 * episodeProgress och jämför med säsongens avsnittsantal (TMDB). `alsoWatched`
 * lägger till avsnittet som just markerats — samma stale-state-skäl som
 * `exclude` i highestWatchedPosition: onSnapshot hinner inte landa innan
 * anroparen behöver svaret.
 *
 * Räknar avsnitt, inte högsta nummer, så en säsong med hål (avsnitt 10 sett men
 * inte 1–9) inte räknas som färdig. Numreringen antas alltså inte vara 1..N.
 *
 * Ren funktion (ingen Firebase-import) → enhetstestbar utan emulator.
 */
export function isSeasonFullyWatched(
  progress: EpisodeProgress | null,
  season: number,
  episodeCount: number,
  alsoWatched?: number,
): boolean {
  // Okänt/orimligt avsnittsantal → vi kan inte bevisa att säsongen är klar.
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) return false;
  const watched = new Set<number>();
  const seasonData = progress?.seasons?.[String(season)];
  if (seasonData && typeof seasonData === 'object') {
    for (const [episodeKey, ep] of Object.entries(seasonData)) {
      if (!ep || typeof ep !== 'object' || !ep.watched) continue;
      const episode = Number(episodeKey);
      if (!Number.isFinite(episode)) continue;
      watched.add(episode);
    }
  }
  if (alsoWatched !== undefined && Number.isFinite(alsoWatched)) watched.add(alsoWatched);
  return watched.size >= episodeCount;
}

export function highestWatchedPosition(
  progress: EpisodeProgress | null,
  exclude?: { season: number; episode: number },
  excludeSeason?: number,
): { season: number; episode: number } | null {
  if (!progress?.seasons) return null;
  let best: { season: number; episode: number } | null = null;
  for (const [seasonKey, seasonData] of Object.entries(progress.seasons)) {
    if (!seasonData || typeof seasonData !== 'object') continue;
    const season = Number(seasonKey);
    if (!Number.isFinite(season)) continue;
    // BIN-171: "Avmarkera alla" rensar en hel säsong — exkludera den helt när vi
    // räknar om högsta kvarvarande position (onSnapshot hinner inte landa).
    if (excludeSeason !== undefined && season === excludeSeason) continue;
    for (const [episodeKey, ep] of Object.entries(seasonData)) {
      if (!ep || typeof ep !== 'object' || !ep.watched) continue;
      const episode = Number(episodeKey);
      if (!Number.isFinite(episode)) continue;
      if (exclude && exclude.season === season && exclude.episode === episode) continue;
      if (!best || season > best.season || (season === best.season && episode > best.episode)) {
        best = { season, episode };
      }
    }
  }
  return best;
}
