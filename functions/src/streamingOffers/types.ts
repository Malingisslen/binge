// functions/src/streamingOffers/types.ts

/** Offer category as normalized from MOTN's `type`. */
export type OfferType = 'subscription' | 'rent' | 'buy' | 'free';

/** One way to watch a title on one SE service. */
export interface Offer {
  /** Canonical TMDB watch-provider id (so the client can match it to a chip). */
  providerId: number;
  type: OfferType;
  /** Deep link straight to the title/player on the service. */
  link: string;
  /** Price in minor-unit-free decimal (e.g. 49). Only for rent/buy. */
  priceAmount: number | null;
  /** ISO 4217 currency, e.g. "SEK". */
  priceCurrency: string | null;
  /** ISO date (YYYY-MM-DD) the title leaves this service, or null if unknown. */
  leaving: string | null;
}

/** The shared per-title document at streamingOffers/{tmdbId}. */
export interface StreamingOffersDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: Offer[];
  /** Epoch millis of the last successful MOTN fetch. */
  checkedAt: number;
  source: 'motn';
}

export type HealthStatus = 'ok' | 'warn' | 'critical';

/** The singleton document at streamingHealth/current. */
export interface HealthDoc {
  computedAt: string;
  workSetSize: number;
  dailyBudget: number;
  refreshIntervalDays: number;
  status: HealthStatus;
  /** Epoch ms of the last completed run; used for idempotency guard on Scheduler retry. */
  lastRunAt?: number;
}

/** A watchlist row narrowed to what the governor needs. */
export interface IntentItem {
  tmdbId: number;
  mediaType: string;
  status: string;
  /** Denormalized SE provider ids on the watchlist doc (non-empty => streaming now). */
  providers: number[];
}

/** Existing streamingOffers doc state the governor reads to prioritize. */
export interface ExistingOffer {
  tmdbId: number;
  checkedAt: number;
  /** Earliest leaving date across offers, or null. */
  nextLeaving: string | null;
}
