// Rader till prissidan (/streamingpriser/): en per nivå, en för en tjänst utan
// nivåer. Ren — läser katalogen, räknar ingenting.

import { PRICE_CHANGES, getProvider, type PriceChange } from '@/lib/tmdb/providers';
import { GUEST_PRICED_PROVIDERS } from '@/lib/guestProviders';

export interface PriceRow {
  key: string;
  providerId: number;
  providerName: string;
  /** Abonnemangets namn (`planName`) för en tjänst utan nivåer, annars null där också. */
  tierName: string | null;
  kr: number;
  sport: boolean;
  verifiedDate?: string;
}

export type PriceSort = 'provider' | 'cheapest';

export function buildPriceRows(): PriceRow[] {
  return GUEST_PRICED_PROVIDERS.flatMap((p): PriceRow[] => {
    if (p.tiers && p.tiers.length > 0) {
      return p.tiers.map(t => ({
        key: `${p.id}:${t.id}`,
        providerId: p.id,
        providerName: p.name,
        tierName: t.name,
        kr: t.cost,
        sport: t.kind === 'sport',
        verifiedDate: p.priceVerifiedDate,
      }));
    }
    return [{
      key: `${p.id}`,
      providerId: p.id,
      providerName: p.name,
      tierName: p.planName ?? null,
      kr: p.defaultMonthlyCost ?? 0,
      sport: false,
      verifiedDate: p.priceVerifiedDate,
    }];
  });
}

/** 'provider' behåller katalogens ordning; 'cheapest' sorterar på pris, sedan namn. */
export function sortPriceRows(rows: readonly PriceRow[], mode: PriceSort): PriceRow[] {
  if (mode === 'provider') return [...rows];
  return [...rows].sort((a, b) =>
    a.kr - b.kr
    || a.providerName.localeCompare(b.providerName, 'sv')
    || (a.tierName ?? '').localeCompare(b.tierName ?? '', 'sv'));
}

export interface PriceChangeRow extends PriceChange {
  providerName: string;
  tierName: string | null;
}

/** Prisändringarna nyast först, med namn ur katalogen. */
export function priceChangesNewestFirst(changes: readonly PriceChange[] = PRICE_CHANGES): PriceChangeRow[] {
  return changes
    .map(c => {
      const provider = getProvider(c.providerId);
      const tier = c.tierId ? provider?.tiers?.find(t => t.id === c.tierId) : undefined;
      return {
        ...c,
        providerName: provider?.name ?? `Tjänst ${c.providerId}`,
        tierName: tier?.name ?? null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
