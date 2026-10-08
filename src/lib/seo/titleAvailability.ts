/**
 * BIN-1439 steg 2 (ADR 0024) — "Så ser du X i Sverige": en titels svenska
 * tjänster som rader, med pris där binges prislista har ett kontrolldatum.
 *
 * Ren funktion av TMDB:s SE-block, så tabellen kan renderas i den statiska
 * HTML:en ur build-initialData. Hyrpriser finns bara klientsidigt och tas inte
 * med här.
 */

import type { TMDBProvider, TMDBProviderData } from '@/types/tmdb';
import { canonicalProviderId, cheapestEntertainmentTierFrom, getProvider } from '@/lib/tmdb/providers';
import { providerHubHref } from '@/lib/seo/hubLinks';

/** Hur tjänsten ger tillgång. `reklam` är reklamfinansierat och aldrig "0 kr". */
export type AvailabilityHow = 'gratis' | 'reklam' | 'abonnemang' | 'hyr-kop';

export interface AvailabilityRow {
  /** Visningsnamnet, samma nyckel som `contentFloorInput` deduplicerar på. */
  name: string;
  how: AvailabilityHow;
  /** Billigaste månadspris, bara för abonnemang med kontrollerat pris. */
  monthlyFrom: number | null;
  tierName: string | null;
  verifiedOn: string | null;
  hubHref: string | null;
}

export interface TitleAvailability {
  rows: AvailabilityRow[];
  /** Namnet på billigaste raden, när minst två rader har ett pris och varje abonnemang har ett. */
  cheapestName: string | null;
  /** Det äldsta kontrolldatumet bland raderna som visar ett pris (YYYY-MM-DD). */
  pricesVerifiedOn: string | null;
}

const HOW_RANK: Record<AvailabilityHow, number> = { gratis: 0, reklam: 1, abonnemang: 2, 'hyr-kop': 3 };

function displayName(p: TMDBProvider): string {
  return getProvider(canonicalProviderId(p.provider_id))?.name ?? p.provider_name;
}

function rowFor(p: TMDBProvider, listed: AvailabilityHow): AvailabilityRow {
  const known = getProvider(canonicalProviderId(p.provider_id));
  let how = listed;
  if (listed === 'abonnemang' && known?.isFree) how = 'gratis';
  else if (listed === 'abonnemang' && known?.isAds) how = 'reklam';

  let monthlyFrom: number | null = null;
  let tierName: string | null = null;
  let verifiedOn: string | null = null;
  if (how === 'abonnemang' && known?.priceVerifiedDate) {
    const { cost, tier } = cheapestEntertainmentTierFrom(known);
    if (Number.isFinite(cost)) {
      monthlyFrom = cost;
      tierName = tier?.name ?? null;
      verifiedOn = known.priceVerifiedDate;
    }
  }
  return { name: displayName(p), how, monthlyFrom, tierName, verifiedOn, hubHref: providerHubHref(p.provider_id) };
}

function priceOf(r: AvailabilityRow): number | null {
  return r.how === 'gratis' ? 0 : r.monthlyFrom;
}

export function titleAvailability(se: TMDBProviderData | undefined): TitleAvailability {
  const byName = new Map<string, AvailabilityRow>();
  const listed: [TMDBProvider[] | undefined, AvailabilityHow][] = [
    [se?.free, 'gratis'],
    [se?.ads, 'reklam'],
    [se?.flatrate, 'abonnemang'],
    [se?.rent, 'hyr-kop'],
    [se?.buy, 'hyr-kop'],
  ];
  for (const [list, how] of listed) {
    for (const p of list ?? []) {
      const row = rowFor(p, how);
      const prev = byName.get(row.name);
      if (!prev || HOW_RANK[row.how] < HOW_RANK[prev.how]) byName.set(row.name, row);
    }
  }

  const rows = [...byName.values()].sort((a, b) => {
    const byHow = HOW_RANK[a.how] - HOW_RANK[b.how];
    if (byHow !== 0) return byHow;
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa !== pb) return pa === null ? 1 : pb === null ? -1 : pa - pb;
    return a.name.localeCompare(b.name, 'sv');
  });

  // Ett abonnemang utan kontrollerat pris kan vara billigare än det märkta, och
  // CheapestPathVerdict på samma sida rankar det — då märks ingen rad alls.
  const unpricedSubscription = rows.some(r => r.how === 'abonnemang' && r.monthlyFrom === null);
  const priced = rows.filter(r => priceOf(r) !== null);
  const cheapestName = priced.length >= 2 && !unpricedSubscription
    ? priced.reduce((a, b) => ((priceOf(b) as number) < (priceOf(a) as number) ? b : a)).name
    : null;
  const dates = rows.map(r => r.verifiedOn).filter((d): d is string => d !== null).sort();

  return { rows, cheapestName, pricesVerifiedOn: dates[0] ?? null };
}
