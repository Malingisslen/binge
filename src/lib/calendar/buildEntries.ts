import { formatEpisodeCode } from '@/lib/utils';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { pickSwedishDigitalRelease } from './releaseDate';
import { streamingProviderName } from './nextAir';
import type { TMDBTVShow, TMDBEpisode, TMDBMovie } from '@/types';
import type { CalendarEntry } from './types';

export interface SeasonDatum {
  showId: number;
  show: TMDBTVShow;
  season: { episodes: TMDBEpisode[] } | null;
}

/**
 * Bygger CalendarEntry[] från hämtade säsonger PLUS show.next_episode_to_air.
 * Seedingen från next_episode_to_air är fixen för att kommande avsnitt inte
 * ska tappas när TMDB:s säsong-episodes-array släpar efter show-nivåns
 * next_episode_to_air. Dedupe på `${tmdbId}-S{n}E{n}` så ett seedat avsnitt
 * aldrig dubblerar ett som redan finns i säsong-arrayen.
 */
export function buildCalendarEntries(
  seasonData: SeasonDatum[],
): CalendarEntry[] {
  const result: CalendarEntry[] = [];
  const seen = new Set<string>();
  const key = (id: number, s: number, e: number) => `${id}-S${s}E${e}`;

  for (const item of seasonData) {
    const { show } = item;
    const providerName = streamingProviderName(show['watch/providers']?.results?.SE);
    const showGenreIds = show.genres?.map(g => g.id) ?? [];
    const episodes = item.season?.episodes ?? [];
    // Fälla in det seedade next_episode_to_air i finale-beräkningen: när TMDB:s
    // säsong-array släpar (t.ex. har E1–E9 men next_episode_to_air är E10) är
    // det seedade avsnittet ofta självaste säsongsfinalen. Utan detta skulle
    // det märkas isFinale: false eftersom array-maxet bara är E9.
    const seeded = show.next_episode_to_air;
    const sameSeasonSeed =
      seeded && (episodes.length === 0 || seeded.season_number === episodes[0].season_number)
        ? seeded.episode_number
        : 0;
    const maxKnownEp = Math.max(
      0,
      ...episodes.map(e => e.episode_number),
      sameSeasonSeed,
    );
    // BIN-13: korskolla mot säsongens FAKTISKA episode_count innan ett avsnitt
    // flaggas som final. TMDB:s säsong-array är community-redigerad och back-half-
    // avsnitt saknas ofta för en pågående säsong — då skulle maxKnownEp landa på
    // ett mittenavsnitt och ge fel "säsongsfinal"-badge. Sätt finaleEp bara när
    // listningen är KÄND komplett (når episode_count). Saknas episode_count →
    // ingen final (hellre fel åt säkra hållet).
    const seasonNumber = episodes[0]?.season_number ?? seeded?.season_number;
    const seasonEpisodeCount = show.seasons?.find(s => s.season_number === seasonNumber)?.episode_count;
    const finaleEp =
      seasonEpisodeCount != null && maxKnownEp >= seasonEpisodeCount ? maxKnownEp : 0;

    const push = (ep: TMDBEpisode) => {
      if (!ep.air_date) return;
      const k = key(show.id, ep.season_number, ep.episode_number);
      if (seen.has(k)) return;
      seen.add(k);
      result.push({
        kind: 'episode',
        mediaType: 'tv',
        tmdbId: show.id,
        title: preferOriginalTitle(show.name, show.original_name),
        posterPath: show.poster_path,
        backdropPath: ep.still_path ?? show.backdrop_path ?? null,
        season: ep.season_number,
        episode: ep.episode_number,
        episodeCode: formatEpisodeCode(ep.season_number, ep.episode_number),
        episodeName: ep.name,
        episodeOverview: ep.overview ?? undefined,
        airDate: ep.air_date,
        provider: providerName,
        runtime: ep.runtime ?? undefined,
        isPremiere: ep.episode_number === 1,
        isFinale: finaleEp > 0 && ep.episode_number === finaleEp,
        genreIds: showGenreIds,
      });
    };

    for (const ep of episodes) push(ep);
    if (show.next_episode_to_air) push(show.next_episode_to_air);
  }

  return result;
}

/**
 * Bygger MovieEntry[] för filmer du vill se. Tar bara med filmer som har ett
 * svenskt digitalt släppdatum (se pickSwedishDigitalRelease) och vars datum
 * ligger i framtiden — gamla katalogtitlar ska inte skräpa ner kalendern.
 *
 * `now` injiceras för testbarhet. Ren funktion.
 */
export function buildMovieEntries(
  movies: TMDBMovie[],
  now: Date = new Date(),
): CalendarEntry[] {
  const todayKey = toDateKey(now);
  const result: CalendarEntry[] = [];

  for (const movie of movies) {
    const releaseDate = pickSwedishDigitalRelease(movie);
    if (!releaseDate) continue;
    // Endast framtida släpp (>= idag). Datumjämförelse på yyyy-mm-dd-strängar
    // är lexikografiskt korrekt.
    if (releaseDate < todayKey) continue;

    const providerName = streamingProviderName(movie['watch/providers']?.results?.SE);

    result.push({
      kind: 'movie',
      mediaType: 'movie',
      releaseType: 'digital',
      tmdbId: movie.id,
      title: preferOriginalTitle(movie.title, movie.original_title),
      posterPath: movie.poster_path,
      backdropPath: movie.backdrop_path,
      airDate: releaseDate,
      provider: providerName,
      overview: movie.overview || undefined,
      runtime: movie.runtime || undefined,
      genreIds: movie.genres?.map(g => g.id) ?? [],
    });
  }

  return result;
}

function toDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
