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
