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

// BIN-145: tolka bara-datum (YYYY-MM-DD) som LOKAL midnatt, inte UTC. Date.parse
// av ett rent datum ger UTC-midnatt → i UTC+2 har "sista dagen" redan passerat
// ~02:00 svensk tid och badgen försvinner en halv dag för tidigt. NaN-resultat
// (trasigt/epoch-"0"-värde) faller igenom som "ingen leaving-info".
function parseLeavingMs(leaving: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(leaving)
    ? new Date(`${leaving}T00:00:00`).getTime()
    : Date.parse(leaving);
}

function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function daysUntilLeaving(offer: Offer | undefined, nowMs: number): number | null {
  if (!offer?.leaving) return null;
  const leavingMs = parseLeavingMs(offer.leaving);
  if (Number.isNaN(leavingMs)) return null;
  // Heldagsdiff: en titel som lämnar idag är "0 dagar kvar" HELA dagen (inte
  // negativ efter midnatt). Båda sidor floor:ade till lokal dagstart.
  return Math.round((localDayStart(leavingMs) - localDayStart(nowMs)) / DAY_MS);
}

export function isLeavingSoon(offer: Offer | undefined, nowMs: number, withinDays = 14): boolean {
  const d = daysUntilLeaving(offer, nowMs);
  return d != null && d >= 0 && d <= withinDays;
}

export function formatLeaving(offer: Offer): string {
  if (!offer.leaving) return '';
  const ms = parseLeavingMs(offer.leaving);
  if (Number.isNaN(ms)) return '';
  const date = new Date(ms).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  return `lämnar ${date}`;
}
