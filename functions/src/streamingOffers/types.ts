// functions/src/streamingOffers/types.ts
import type { MediaType } from '../shared/mediaTypeDocId';

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

/** The shared per-title document at streamingOffers/{mediaType}_{tmdbId} (BIN-523). */
export interface StreamingOffersDoc {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  offers: Offer[];
  /** Epoch millis of the last successful MOTN fetch. */
  checkedAt: number;
  source: 'motn';
}

export type HealthStatus = 'ok' | 'warn' | 'critical';

/** What one run proved about the vendor feed. See classifyRunOutcome. */
export type RunOutcome =
  /** At least one real vendor response — the feed works. */
  | 'delivered'
  /** Calls were spent and none came back usable — the feed is down. */
  | 'no-delivery'
  /** Nothing was asked, or the quota is out. Proves nothing either way. */
  | 'inconclusive';

/**
 * The delivery half of health: what the feed has actually produced lately, as
 * opposed to how fast it could theoretically cycle. Persisted on the health
 * doc between runs, so it must be carried forward in the write (index.ts uses
 * `.set()` without merge — anything omitted is erased).
 */
export interface DeliveryState {
  /** Consecutive runs that spent vendor calls and got nothing usable. */
  runsWithoutSuccess: number;
  /** Epoch ms of the last run that got real data, or null if never. */
  lastSuccessAt: number | null;
  /** Coarse reason for the latest non-delivery; the vendor's own words are in the log. */
  lastFailureReason: string | null;
}

/** The singleton document at streamingHealth/current. */
export interface HealthDoc extends DeliveryState {
  computedAt: string;
  workSetSize: number;
  dailyBudget: number;
  refreshIntervalDays: number;
  /**
   * BIN-856: the WORSE of capacityStatus and feedStatus (Malin's choice,
   * option B, 2026-08-12). It used to be the capacity projection alone, which
   * is why this document read "ok" through a month in which not one vendor
   * call succeeded — both its inputs are the library size and a constant, so
   * nothing about a failing feed could ever move it.
   */
  status: HealthStatus;
  /** Can we cycle the library often enough? The pre-BIN-856 meaning of `status`. */
  capacityStatus: HealthStatus;
  /** Is data actually arriving? Derived from runsWithoutSuccess. */
  feedStatus: HealthStatus;
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

/** One title the governor may refresh, identified by (mediaType, tmdbId) — BIN-545. */
export interface WorkItem {
  tmdbId: number;
  mediaType: MediaType;
}

/** Existing streamingOffers doc state the governor reads to prioritize. */
export interface ExistingOffer {
  tmdbId: number;
  /** Read from the doc's own field, so legacy bare-id docs still match (BIN-523). */
  mediaType: MediaType;
  checkedAt: number;
  /** Earliest leaving date across offers, or null. */
  nextLeaving: string | null;
}
