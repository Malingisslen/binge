// functions/src/streamingOffers/parse.ts
import type { Offer, OfferType } from './types';

/** MOTN service id -> TMDB watch-provider id (see src/lib/tmdb/providers.ts). */
export const MOTN_TO_TMDB_PROVIDER: Record<string, number> = {
  netflix: 8,
  disney: 337,
  prime: 119,
  max: 384,
  viaplay: 76,
  appletv: 2,         // Apple TV (rent/buy)
  appletvplus: 350,   // Apple TV+
  svtplay: 1773,
  tv4play: 497,
  skyshowtime: 1773,  // verify against providers.ts; adjust if a distinct id exists
  google: 3,
};

function normalizeType(raw: unknown): OfferType {
  if (raw === 'rent') return 'rent';
  if (raw === 'buy') return 'buy';
  if (raw === 'free') return 'free';
  return 'subscription'; // 'subscription' | 'addon' | anything else
}

/** YYYY-MM-DD (UTC) from a unix-seconds timestamp, or null. */
function isoDate(unixSeconds: unknown): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function parseStreamingOptions(seOptions: unknown): Offer[] {
  if (!Array.isArray(seOptions)) return [];
  const out: Offer[] = [];
  for (const opt of seOptions as Record<string, unknown>[]) {
    const service = opt?.service as Record<string, unknown> | undefined;
    const serviceId = service?.id;
    const providerId = typeof serviceId === 'string' ? MOTN_TO_TMDB_PROVIDER[serviceId] : undefined;
    if (providerId == null) continue;
    const price = opt?.price as Record<string, unknown> | undefined;
    const amount = price?.amount;
    out.push({
      providerId,
      type: normalizeType(opt?.type),
      link: typeof opt?.link === 'string' ? opt.link : '',
      priceAmount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
      priceCurrency: typeof price?.currency === 'string' ? (price.currency as string) : null,
      leaving: opt?.expiresOn != null ? isoDate(opt.expiresOn) : null,
    });
  }
  return out;
}
