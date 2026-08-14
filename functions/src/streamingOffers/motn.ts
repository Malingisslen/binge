// functions/src/streamingOffers/motn.ts
import { logger } from 'firebase-functions/v2';
import { parseStreamingOptions } from './parse';
import { offersUrl, classifyStatus } from './motnRequest';
import { MOTN_HOST, redactVendorBody } from '../util/motnVendor';
import type { Offer } from './types';

// BIN-320: discriminated 429 signal. The run loop must tell "rate-limited —
// stop spending the whole day" apart from null ("skip this one title, retry
// next run"); folding 429 into null would keep hammering a rate-limited API.
export const RATE_LIMITED = 'rate_limited' as const;
// BIN-856: a second stop-the-run signal, for the case 429 does NOT cover — the
// vendor rejecting the request we built (see classifyStatus). Folding it into
// null ("skip this title") is what let a malformed URL spend 198 of the 300
// monthly vendor calls, nine identical failures a day, for a month.
export const REQUEST_REJECTED = 'request_rejected' as const;
export type FetchOffersResult = Offer[] | null | typeof RATE_LIMITED | typeof REQUEST_REJECTED;

/**
 * Fetch SE offers for one title from MOTN. Four outcomes:
 *  - `Offer[]`         — parsed offers; `[]` also means "no SE offers" (incl. 404).
 *  - `null`            — per-title failure; caller skips it and retries next run.
 *  - `RATE_LIMITED`    — 429; caller stops the whole run for the day.
 *  - `REQUEST_REJECTED` — the vendor rejected the request we BUILT (4xx that
 *    isn't 404/429). Caller stops the run: it will fail identically for every
 *    remaining title, and each attempt still costs a vendor call.
 *
 * Reads process.env.MOTN_API_KEY (bound via defineSecret in index.ts).
 */
export async function fetchOffers(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): Promise<FetchOffersResult> {
  const key = process.env.MOTN_API_KEY;
  if (!key) { logger.error('streamingOffers: MOTN_API_KEY not set'); return null; }

  const url = offersUrl(mediaType, tmdbId);
  try {
    // BIN-157: Node fetch has no default timeout; one hung MOTN response could
    // block the sequential refresh loop and burn the whole 300s function budget.
    // 10s ceiling per request — the catch below already maps a throw to null
    // (skip + retry next run), so no other handling is needed.
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': MOTN_HOST },
      signal: AbortSignal.timeout(10_000),
    });
    const disposition = classifyStatus(res.status);
    if (disposition === 'no-offers') return []; // not in MOTN catalogue == no offers
    // BIN-320: 429 = quota / rate gone. Signal the loop to stop for the
    // day (no in-run backoff — RapidAPI's Retry-After on a quota 429 is 60s+,
    // pointless inside a 300s budget; the next scheduled run resumes tomorrow).
    if (disposition === 'rate-limited') { logger.warn(`streamingOffers: MOTN 429 rate-limited on ${mediaType}/${tmdbId}`); return RATE_LIMITED; }
    if (disposition !== 'ok') {
      // BIN-856: log the vendor's own error text, not just the status. The
      // `output_language=sv` outage was a 400 that said exactly what was wrong
      // ("parameter \"output_language\" has an invalid value: sv") — we threw
      // that sentence away and kept the number, so a month of nine-a-day
      // failures looked like generic per-title flakiness.
      //
      // Security review (2026-08-11): redact the key before logging rather
      // than trusting the vendor not to echo it. The 400 body demonstrably
      // doesn't — but this same branch now also carries 401/403, and a
      // RapidAPI-hosted auth error is exactly the kind of prose that quotes
      // the credential it rejected. BIN-857 moved the mask-then-truncate rule
      // into ../util/motnVendor.ts: motnChanges.ts had a verbatim second copy,
      // and the ORDER is what makes it correct, which nothing was pinning.
      const body = await res.text().catch(() => '');
      const detail = { body: redactVendorBody(body, key) };
      if (disposition === 'rejected') {
        logger.error(`streamingOffers: MOTN rejected our request (${res.status}) on ${mediaType}/${tmdbId} — stopping run`, detail);
        return REQUEST_REJECTED;
      }
      logger.warn(`streamingOffers: MOTN ${mediaType}/${tmdbId} -> ${res.status}`, detail);
      return null;
    }
    const json = await res.json() as Record<string, unknown>;
    return parseStreamingOptions((json?.streamingOptions as Record<string, unknown> | undefined)?.se);
  } catch (err) {
    logger.warn(`streamingOffers: MOTN fetch failed for ${mediaType}/${tmdbId}`, err);
    return null;
  }
}
