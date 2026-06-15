// Pure helpers for useUpcomingShowsForAdvisor.
//
// Extracted so the provider-attribution logic can be unit-tested without
// pulling in React Query / calendar / auth dependencies.

// BIN-105: vecko-index måste räknas i HELA KALENDERDAGAR, inte fasta
// millisekunder. Den gamla `Math.floor((airMs - anchorMs) / (7*86400000))`
// räknade fel när fönstret korsade en sommartidsövergång (sista söndagen i
// mars i Sverige): vårens "spring forward" gör ett dygn 23h långt, så ett
// 7-kalenderdagars-spann blir 6*24h + 23h < 7*86400000ms och floor() rundar
// ner till vecka 0 istället för 1 — avsnitt hamnade en vecka för tidigt.
//
// Fixen: räkna dagar från lokala datum-komponenter via Date.UTC (båda datum
// vid UTC-midnatt → ingen DST-skew finns att kliva igenom), sedan dela på 7.
// Anchor + datum är båda lokala YYYY-MM-DD-strängar (vecko-måndagens
// lokala datum respektive avsnittets air date), så det här är en ren
// lokal-kalender-dagräkning.
function calendarDaysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((toUtc - fromUtc) / 86400000);
}

// Vecko-index för ett air-date relativt vecko-start-ankaret (måndagen). Räknar
// kalenderdagar (DST-säkert) och delar på 7. Ett datum exakt 7 kalenderdagar
// efter ankaret ger index 1 — även när spannet korsar sommartidsbytet.
export function weekIndexFromAnchor(anchorIso: string, dateIso: string): number {
  return Math.floor(calendarDaysBetween(anchorIso, dateIso) / 7);
}

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
