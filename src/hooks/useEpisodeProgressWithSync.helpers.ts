import type { EpisodeProgress } from '@/types';

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
 * NUMRERADE säsonger endast, till skillnad från `highestWatchedPosition` nedan som
 * uttryckligen hoppar över säsong 0. Den här funktionen är säsongsagnostisk men nås
 * aldrig med säsong 0: enda anroparen är auto-advance-grenen i
 * `useEpisodeProgressWithSync`, och säsong-0-vakten där returnerar innan dess.
 * Anropa den inte med 0 utan att först tänka igenom vad "hela säsongen sedd" ens
 * skulle betyda för TMDB:s glesa säsong-0-numrering.
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

/**
 * Räknar fram högsta sedda position (säsong/avsnitt) ur en episodeProgress-map,
 * med möjlighet att exkludera en (season, episode) som just markerats osedd,
 * eller en hel säsong (`excludeSeason`) som just "avmarkerats alla".
 * Returnerar null om inga avsnitt är sedda kvar.
 *
 * SÄSONG 0 RÄKNAS INTE (BIN-679). Det enda den här funktionen används till är att
 * räkna om `lastWatchedSeason/Episode` på watchlist-dokumentet, och den markörens
 * ordförråd är numrerade säsonger — det finns ingen position i den som betyder
 * "sett ett specialavsnitt". Före BIN-679 stod här att specials räknades med men
 * förlorade mot varje säsong >= 1; det var sant och ofarligt bara så länge
 * ingenting kunde bocka säsong 0. När de kurerade specialavsnitten blev bockbara
 * blev det en väg in i exakt den korruption BIN-679 finns för att stänga: bocka ett
 * special, avmarkera sedan ditt enda sedda numrerade avsnitt, och "högsta
 * kvarvarande position" blir säsong 0 — markören parkerar där, och serien läses som
 * "bakom" resten av biblioteket igenom. Specials lever i
 * `episodeProgress.seasons["0"]` och når aldrig markören VIA DEN HÄR HOOKEN.
 *
 * Det är inte samma sak som att markören aldrig kan stå på S0 — läs inte det här
 * som en garanti och städa inte bort säsong-0-grenarna i `isUserBehindOnAired` /
 * `librarySubState` på den grunden. `useMarkSeen` skriver fortfarande
 * `last_episode_to_air` rakt in när man markerar en hel serie sedd, och för
 * Doctor Who 2005 är det avsnittet ett special; äldre dokument bär också redan
 * S0-markörer. Det här stänger en väg in, inte alla.
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
    // BIN-679: specials kan inte uttryckas i markören — se docstringen ovan.
    if (season === 0) continue;
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
