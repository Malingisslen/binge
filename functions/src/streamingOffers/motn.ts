// functions/src/streamingOffers/motn.ts
import { logger } from 'firebase-functions/v2';
import { parseStreamingOptions } from './parse';
import type { Offer } from './types';

const HOST = 'streaming-availability.p.rapidapi.com';

// BIN-320: discriminated 429 signal. The run loop must tell "rate-limited —
// stop spending the whole day" apart from null ("skip this one title, retry
// next run"); folding 429 into null would keep hammering a rate-limited API.
export const RATE_LIMITED = 'rate_limited' as const;
export type FetchOffersResult = Offer[] | null | typeof RATE_LIMITED;

/**
 * Fetch SE offers for one title from MOTN. Returns [] when the title has no SE
 * offers, null on a per-title failure (caller skips + retries next run), or
 * RATE_LIMITED on a 429 (caller stops the whole run for the day).
 * Reads process.env.MOTN_API_KEY (bound via defineSecret in index.ts).
 */
export async function fetchOffers(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): Promise<FetchOffersResult> {
  const key = process.env.MOTN_API_KEY;
  if (!key) { logger.error('streamingOffers: MOTN_API_KEY not set'); return null; }

  // Path confirmed in Step 1. Example v4 form:
  const url = `https://${HOST}/shows/${mediaType}/${tmdbId}?country=se&output_language=sv`;
  try {
    // BIN-157: Node fetch has no default timeout; one hung MOTN response could
    // block the sequential refresh loop and burn the whole 300s function budget.
    // 10s ceiling per request — the catch below already maps a throw to null
    // (skip + retry next run), so no other handling is needed.
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return []; // not in MOTN catalogue == no offers
    // BIN-320: 429 = daily quota / rate gone. Signal the loop to stop for the
    // day (no in-run backoff — RapidAPI's Retry-After on a quota 429 is 60s+,
    // pointless inside a 300s budget; the next scheduled run resumes tomorrow).
    if (res.status === 429) { logger.warn(`streamingOffers: MOTN 429 rate-limited on ${mediaType}/${tmdbId}`); return RATE_LIMITED; }
    if (!res.ok) { logger.warn(`streamingOffers: MOTN ${mediaType}/${tmdbId} -> ${res.status}`); return null; }
    const json = await res.json() as Record<string, unknown>;
    return parseStreamingOptions((json?.streamingOptions as Record<string, unknown> | undefined)?.se);
  } catch (err) {
    logger.warn(`streamingOffers: MOTN fetch failed for ${mediaType}/${tmdbId}`, err);
    return null;
  }
}
