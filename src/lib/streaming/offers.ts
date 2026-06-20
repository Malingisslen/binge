export type OfferType = 'subscription' | 'rent' | 'buy' | 'free';

export interface Offer {
  providerId: number;
  type: OfferType;
  link: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  leaving: string | null;
}

export interface StreamingOffersDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: Offer[];
  checkedAt: number;
  source: 'motn';
}

const DAY_MS = 86_400_000;

export function offerForProvider(offers: Offer[], providerId: number): Offer | undefined {
  return offers.find((o) => o.providerId === providerId);
}

export function daysUntilLeaving(offer: Offer | undefined, nowMs: number): number | null {
  if (!offer?.leaving) return null;
  return Math.round((Date.parse(offer.leaving) - nowMs) / DAY_MS);
}

export function isLeavingSoon(offer: Offer | undefined, nowMs: number, withinDays = 14): boolean {
  const d = daysUntilLeaving(offer, nowMs);
  return d != null && d >= 0 && d <= withinDays;
}

export function formatLeaving(offer: Offer): string {
  if (!offer.leaving) return '';
  const d = new Date(offer.leaving);
  const date = d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `lämnar ${date}`;
}
