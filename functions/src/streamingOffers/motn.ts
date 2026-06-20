// functions/src/streamingOffers/motn.ts
import { logger } from 'firebase-functions/v2';
import { parseStreamingOptions } from './parse';
import type { Offer } from './types';

const HOST = 'streaming-availability.p.rapidapi.com';

/**
 * Fetch SE offers for one title from MOTN. Returns null on failure (caller
 * skips + retries next run), [] when the title has no SE offers.
 * Reads process.env.MOTN_API_KEY (bound via defineSecret in index.ts).
 */
export async function fetchOffers(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): Promise<Offer[] | null> {
  const key = process.env.MOTN_API_KEY;
  if (!key) { logger.error('streamingOffers: MOTN_API_KEY not set'); return null; }

  // Path confirmed in Step 1. Example v4 form:
  const url = `https://${HOST}/shows/${mediaType}/${tmdbId}?country=se&output_language=sv`;
  try {
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
    });
    if (res.status === 404) return []; // not in MOTN catalogue == no offers
    if (!res.ok) { logger.warn(`streamingOffers: MOTN ${mediaType}/${tmdbId} -> ${res.status}`); return null; }
    const json = await res.json() as Record<string, unknown>;
    return parseStreamingOptions((json?.streamingOptions as Record<string, unknown> | undefined)?.se);
  } catch (err) {
    logger.warn(`streamingOffers: MOTN fetch failed for ${mediaType}/${tmdbId}`, err);
    return null;
  }
}
