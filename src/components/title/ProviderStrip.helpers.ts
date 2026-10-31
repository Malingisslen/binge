import type { TMDBProvider } from '@/types';
import { canonicalProviderId, dedupeProvidersByCanonicalId, getProvider } from '@/lib/tmdb/providers';
import { type Offer, type OfferType, formatLeaving, isLeavingSoon } from '@/lib/streaming/offers';

export type StripKind = 'mine' | 'sub' | 'free' | 'ads' | 'rent' | 'buy';

export interface StripRow {
  providerId: number;
  rawProviderId: number;
  name: string;
  logoPath: string | null;
  kind: StripKind;
  label: string;
  link: string | null;
  offerType: OfferType;
  leaving: string | null;
}

export interface ProviderGroups {
  flatrate: TMDBProvider[];
  free: TMDBProvider[];
  ads: TMDBProvider[];
  rent: TMDBProvider[];
  buy: TMDBProvider[];
}

const OFFER_TYPE: Record<Exclude<StripKind, 'mine'>, OfferType> = {
  sub: 'subscription',
  free: 'free',
  ads: 'free',
  rent: 'rent',
  buy: 'buy',
};

const FIXED_LABEL = { sub: 'Ingår', free: 'Gratis', ads: 'Gratis med reklam' } as const;

function priceLabel(verb: 'Hyr' | 'Köp', offer: Offer | undefined): string {
  if (!offer || offer.priceAmount == null) return verb;
  const currency = offer.priceCurrency === 'SEK' || !offer.priceCurrency ? 'kr' : offer.priceCurrency;
  return `${verb} ${offer.priceAmount} ${currency}`;
}

function pickOffer(offers: Offer[], providerId: number, type: OfferType): Offer | undefined {
  const forProvider = offers.filter(o => o.providerId === providerId);
  return forProvider.find(o => o.type === type) ?? forProvider[0];
}

function rowFor(
  p: TMDBProvider,
  base: Exclude<StripKind, 'mine'>,
  offers: Offer[],
  owned: boolean,
  nowMs: number,
): StripRow {
  const providerId = canonicalProviderId(p.provider_id);
  const offerType = OFFER_TYPE[base];
  const offer = pickOffer(offers, providerId, offerType);
  const typedOffer = offer?.type === offerType ? offer : undefined;
  const label =
    base === 'rent' ? priceLabel('Hyr', typedOffer)
    : base === 'buy' ? priceLabel('Köp', typedOffer)
    : owned ? 'Du har'
    : FIXED_LABEL[base];
  return {
    providerId,
    rawProviderId: p.provider_id,
    name: getProvider(p.provider_id)?.name ?? p.provider_name,
    logoPath: p.logo_path || null,
    kind: owned ? 'mine' : base,
    label,
    link: offer?.link || null,
    offerType: offer?.type ?? offerType,
    leaving: offer && isLeavingSoon(offer, nowMs) ? formatLeaving(offer) : null,
  };
}

// Without myProviderIds (server render, signed-out) the order is purely
// abonnemang, gratis, reklam; the owned services move first only once the
// viewer is known, so the pre-rendered HTML lists every service.
export function buildProviderRows(
  groups: ProviderGroups,
  offers: Offer[],
  myProviderIds: number[],
  nowMs: number,
): { main: StripRow[]; rentBuy: StripRow[] } {
  const mine = new Set(myProviderIds.map(canonicalProviderId));
  const seen = new Set<number>();
  const take = (list: TMDBProvider[]) =>
    dedupeProvidersByCanonicalId(list).filter(p => {
      const id = canonicalProviderId(p.provider_id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

  const main = [
    ...take(groups.flatrate).map(p => rowFor(p, 'sub', offers, mine.has(canonicalProviderId(p.provider_id)), nowMs)),
    ...take(groups.free).map(p => rowFor(p, 'free', offers, mine.has(canonicalProviderId(p.provider_id)), nowMs)),
    ...take(groups.ads).map(p => rowFor(p, 'ads', offers, mine.has(canonicalProviderId(p.provider_id)), nowMs)),
  ];
  const ownedFirst = [...main.filter(r => r.kind === 'mine'), ...main.filter(r => r.kind !== 'mine')];

  const rentBuySeen = new Set<string>();
  const rentBuy = [
    ...dedupeProvidersByCanonicalId(groups.rent).map(p => rowFor(p, 'rent', offers, false, nowMs)),
    ...dedupeProvidersByCanonicalId(groups.buy).map(p => rowFor(p, 'buy', offers, false, nowMs)),
  ].filter(r => {
    const key = `${r.kind}:${r.providerId}`;
    if (rentBuySeen.has(key)) return false;
    rentBuySeen.add(key);
    return true;
  });

  return { main: ownedFirst, rentBuy };
}
