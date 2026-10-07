// Build-time TMDB read for the "Värt det" month page: what premieres on a service
// during the month. Films by release date, new series by first air date, and new
// seasons of running series by the season's air date. TMDB's provider data is the
// title's availability when the site is built, which is why the page says
// "enligt TMDB".

import { discoverMovies, discoverTV, getTVShowLite } from '@/lib/tmdb/client';
import { buildSignal } from '@/lib/tmdb/buildFetch';
import { getProvider } from '@/lib/tmdb/providers';
import { inMonth, type Premiere, type VartDetMonth } from '@/lib/seo/vartDet';

// Series airing in the month that get a detail read to find a new season; the
// build reads one page of the most popular per service.
const SEASON_LOOKUPS = 10;

async function premieresFor(providerId: number, month: VartDetMonth): Promise<Premiere[]> {
  // TMDB files some services under alias ids (TV4 Play 1944, SkyShowtime 1773).
  const ids = [providerId, ...(getProvider(providerId)?.aliases ?? [])].join('|');
  const base = { with_watch_providers: ids, with_watch_monetization_types: 'flatrate', sort_by: 'popularity.desc', page: '1' };
  const [films, airing] = await Promise.all([
    discoverMovies({ ...base, 'primary_release_date.gte': month.firstDay, 'primary_release_date.lte': month.lastDay }, { signal: buildSignal() }),
    discoverTV({ ...base, 'air_date.gte': month.firstDay, 'air_date.lte': month.lastDay }, { signal: buildSignal() }),
  ]);
  const out: Premiere[] = [];
  for (const f of films.results ?? []) {
    if (f.title && f.release_date && inMonth(f.release_date, month)) out.push({ title: f.title, date: f.release_date, popularity: f.popularity ?? 0 });
  }
  const running: number[] = [];
  for (const s of airing.results ?? []) {
    if (!s.name) continue;
    if (inMonth(s.first_air_date, month)) out.push({ title: s.name, date: s.first_air_date!, popularity: s.popularity ?? 0 });
    else running.push(s.id);
  }
  // A failed lookup throws, so the service gets no level rather than a short count.
  const shows = await Promise.all(
    running.slice(0, SEASON_LOOKUPS).map(id => getTVShowLite(id, { signal: buildSignal() })),
  );
  for (const show of shows) {
    const season = show.seasons?.find(se => se.season_number >= 2 && inMonth(se.air_date, month));
    if (season) out.push({ title: `${show.name} säsong ${season.season_number}`, date: season.air_date, popularity: show.popularity ?? 0 });
  }
  // The cell shows the premiere TMDB ranks most popular first.
  return out.sort((a, b) => b.popularity - a.popularity);
}

/**
 * Premieres per service. A service whose read fails gets null, and the page then
 * shows no level for it rather than "Inget nytt".
 */
export async function fetchMonthPremieres(providerIds: readonly number[], month: VartDetMonth): Promise<Map<number, Premiere[] | null>> {
  const entries = await Promise.all(providerIds.map(async id => {
    try {
      return [id, await premieresFor(id, month)] as const;
    } catch {
      return [id, null] as const;
    }
  }));
  return new Map(entries);
}
