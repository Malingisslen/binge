import { describe, it, expect } from 'vitest';
import type { TMDBProvider, TMDBProviderData } from '@/types/tmdb';
import { titleAvailability } from './titleAvailability';
import { movieContentFloorInput } from './contentFloorInput';
import { cheapestEntertainmentTierFrom, getProvider } from '@/lib/tmdb/providers';
import type { TMDBMovie } from '@/types/tmdb';

const p = (provider_id: number, provider_name = `P${provider_id}`): TMDBProvider => ({ provider_id, provider_name, logo_path: '' });
const se = (d: Omit<TMDBProviderData, 'link'>): TMDBProviderData => ({ link: '', ...d });

const NETFLIX = 8;
const HBO_MAX = 384;
const SVT = 520;
const PLUTO = 300;
const TV4 = 489;
const TV4_ALIAS = 1944;
const DISNEY = 337;
const SF_ANYTIME = 426;

// Förväntningarna läses ur prislistan, så en prisändring där inte fäller testerna.
const expectedFrom = (id: number) => cheapestEntertainmentTierFrom(getProvider(id)!);

describe('titleAvailability', () => {
  it('ger inga rader utan svenska tjänster', () => {
    expect(titleAvailability(undefined)).toEqual({ rows: [], cheapestName: null, pricesVerifiedOn: null });
    expect(titleAvailability(se({})).rows).toEqual([]);
  });

  it('visar pris med nivånamn bara för abonnemang med kontrolldatum', () => {
    expect(getProvider(NETFLIX)?.priceVerifiedDate).toBeTruthy();
    const { rows } = titleAvailability(se({ flatrate: [p(NETFLIX)] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Netflix',
      how: 'abonnemang',
      monthlyFrom: expectedFrom(NETFLIX).cost,
      tierName: expectedFrom(NETFLIX).tier?.name ?? null,
      verifiedOn: getProvider(NETFLIX)?.priceVerifiedDate,
    });
  });

  it('visar inget pris för en tjänst utan kontrolldatum, trots att ett standardpris finns', () => {
    const hbo = getProvider(HBO_MAX)!;
    expect(hbo.priceVerifiedDate).toBeUndefined();
    expect(hbo.defaultMonthlyCost).toBeGreaterThan(0);
    const { rows, pricesVerifiedOn } = titleAvailability(se({ flatrate: [p(HBO_MAX)] }));
    expect(rows[0]).toMatchObject({ how: 'abonnemang', monthlyFrom: null, tierName: null, verifiedOn: null });
    expect(pricesVerifiedOn).toBeNull();
  });

  it('ger en okänd tjänst inget pris och inget hubbnav', () => {
    const { rows } = titleAvailability(se({ flatrate: [p(999_999, 'Okänd')] }));
    expect(rows[0]).toMatchObject({ name: 'Okänd', monthlyFrom: null, hubHref: null });
  });

  it('skiljer gratis från reklamfinansierat', () => {
    const { rows } = titleAvailability(se({ flatrate: [p(SVT), p(PLUTO)], ads: [p(DISNEY)] }));
    const how = Object.fromEntries(rows.map(r => [r.name, r.how]));
    expect(how['SVT Play']).toBe('gratis');
    expect(how['Pluto TV']).toBe('reklam');
    expect(how['Disney+']).toBe('reklam');
    for (const r of rows.filter(x => x.how === 'reklam')) expect(r.monthlyFrom).toBeNull();
  });

  it('slår ihop alias till en rad och låter det bästa sättet vinna', () => {
    const { rows } = titleAvailability(se({ flatrate: [p(TV4_ALIAS)], rent: [p(TV4)], buy: [p(TV4)] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'TV4 Play', how: 'abonnemang' });
  });

  it('ordnar gratis, reklam, abonnemang efter pris med okänt pris sist, sedan hyr och köp', () => {
    const { rows } = titleAvailability(se({
      rent: [p(SF_ANYTIME)],
      flatrate: [p(HBO_MAX), p(NETFLIX), p(TV4)],
      ads: [p(PLUTO)],
      free: [p(SVT)],
    }));
    const order = rows.map(r => r.name);
    const subs = [NETFLIX, TV4].map(id => ({ name: getProvider(id)!.name, cost: expectedFrom(id).cost }))
      .sort((a, b) => a.cost - b.cost).map(x => x.name);
    expect(order).toEqual(['SVT Play', 'Pluto TV', ...subs, 'HBO Max', 'SF Anytime']);
    expect(rows.at(-1)).toMatchObject({ how: 'hyr-kop', monthlyFrom: null });
  });

  it('märker billigast bara när minst två rader har ett pris, och gratis räknas som noll', () => {
    expect(titleAvailability(se({ flatrate: [p(NETFLIX), p(HBO_MAX)] })).cheapestName).toBeNull();
    const two = titleAvailability(se({ flatrate: [p(NETFLIX), p(TV4)] }));
    const cheaper = expectedFrom(NETFLIX).cost <= expectedFrom(TV4).cost ? 'Netflix' : 'TV4 Play';
    expect(two.cheapestName).toBe(cheaper);
    expect(titleAvailability(se({ flatrate: [p(NETFLIX), p(SVT)] })).cheapestName).toBe('SVT Play');
  });

  it('märker ingen rad när ett abonnemang saknar kontrollerat pris', () => {
    expect(titleAvailability(se({ flatrate: [p(NETFLIX), p(TV4)] })).cheapestName).not.toBeNull();
    expect(titleAvailability(se({ flatrate: [p(NETFLIX), p(TV4), p(HBO_MAX)] })).cheapestName).toBeNull();
  });

  it('daterar priserna med det äldsta kontrolldatumet bland raderna som visar ett pris', () => {
    const dates = [NETFLIX, TV4].map(id => getProvider(id)!.priceVerifiedDate!).sort();
    expect(dates[0]).not.toBe(dates[1]);
    const { pricesVerifiedOn } = titleAvailability(se({ flatrate: [p(TV4), p(NETFLIX), p(HBO_MAX)] }));
    expect(pricesVerifiedOn).toBe(dates[0]);
  });

  it('länkar bara till hubbar som finns', () => {
    const { rows } = titleAvailability(se({ flatrate: [p(NETFLIX)], rent: [p(SF_ANYTIME)] }));
    expect(rows.find(r => r.name === 'Netflix')?.hubHref).toBe(`/provider/${NETFLIX}/`);
    expect(rows.find(r => r.name === 'SF Anytime')?.hubHref).toBeNull();
  });

  it('namnger samma tjänster som tillgänglighetsmeningen', () => {
    const movie = {
      id: 1, title: 'X', original_title: 'X', overview: '', genres: [],
      'watch/providers': { results: { SE: se({
        flatrate: [p(TV4_ALIAS, 'TV4 Play alias'), p(NETFLIX)], free: [p(SVT)], ads: [p(PLUTO)],
        rent: [p(TV4), p(SF_ANYTIME, 'SF Anytime')], buy: [p(2, 'Apple TV')],
      }) } },
    } as unknown as TMDBMovie;
    const floor = movieContentFloorInput(movie).providers;
    const floorNames = new Set([...floor.stream, ...floor.rent, ...floor.buy]);
    const tableNames = new Set(titleAvailability(movie['watch/providers']?.results?.SE).rows.map(r => r.name));
    expect(tableNames).toEqual(floorNames);
  });
});
