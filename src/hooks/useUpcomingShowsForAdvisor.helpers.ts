// Pure helpers for useUpcomingShowsForAdvisor.
//
// Extracted so the provider-attribution logic can be unit-tested without
// pulling in React Query / calendar / auth dependencies.

export interface AttributionProvider {
  providerId: number;
  shortName: string;
  color: string;
  shows: { tmdbId: number }[];
}

export interface ShowAttribution {
  providerId: number;
  providerShortName: string;
  providerColor: string;
}

// BIN-15: en serie som finns hos flera prenumererade tjänster attribueras till
// den tjänst som bär FLEST av användarens andra kommande serier — inte den
// första vi råkar iterera (gamla first-seen-beteendet). Det koncentrerar
// per-tjänst-räkningen rätt så att behåll/säg-upp-matematiken och paus-rådet
// speglar var tittandet faktiskt ligger: en multi-provider-serie räknas på den
// tjänst du har mest annat på, inte en där den är ensam.
//
// "Tyngd" = antal av användarens serier tjänsten bär. Serien själv ligger på
// alla kandidater så den påverkar inte vilken som vinner — att jämföra rå
// tyngd är ekvivalent med "flest ANDRA serier". Vid lika tyngd behålls först
// sedda tjänst (strikt >, inte >=) → bevarar gammalt deterministiskt
// tie-beteende. Pausade tjänster exkluderas helt (som tidigare).
export function attributeShowsToProviders(
  providers: AttributionProvider[],
  userPaused: Set<number>,
): Map<number, ShowAttribution> {
  const active = providers.filter(p => !userPaused.has(p.providerId));

  const map = new Map<number, ShowAttribution>();
  // Tyngden på den hittills valda tjänsten per show — så vi bara byter vid
  // STRIKT högre tyngd.
  const chosenLoad = new Map<number, number>();

  for (const p of active) {
    const pLoad = p.shows.length;
    for (const show of p.shows) {
      const prev = chosenLoad.get(show.tmdbId);
      if (prev === undefined || pLoad > prev) {
        chosenLoad.set(show.tmdbId, pLoad);
        map.set(show.tmdbId, {
          providerId: p.providerId,
          providerShortName: p.shortName,
          providerColor: p.color,
        });
      }
    }
  }

  return map;
}
