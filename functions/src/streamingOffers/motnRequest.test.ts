import { describe, it, expect } from 'vitest';
import { offersUrl, classifyStatus } from './motnRequest';
import { MOTN_HOST } from '../util/motnVendor';

/**
 * BIN-856 regression guard. The whole streamingOffers feed was dead for a month
 * because of ONE extra query parameter the vendor rejects — every call returned
 * HTTP 400 and the run loop dutifully treated each as a per-title failure, so
 * nothing ever surfaced except a status code in the log.
 */
describe('offersUrl', () => {
  it('targets the vendor /shows endpoint for the right media type and id', () => {
    const url = new URL(offersUrl('tv', 1399));
    expect(url.host).toBe(MOTN_HOST);
    expect(url.pathname).toBe('/shows/tv/1399');

    expect(new URL(offersUrl('movie', 550)).pathname).toBe('/shows/movie/550');
  });

  it('asks for Swedish availability', () => {
    expect(new URL(offersUrl('tv', 1399)).searchParams.get('country')).toBe('se');
  });

  // The actual BIN-856 bug: `output_language=sv` is not a value MOTN accepts.
  // Live vendor response was {"message":"parameter \"output_language\" has an
  // invalid value: sv"} — a hard 400, never a partial result.
  it('never sends output_language', () => {
    expect(new URL(offersUrl('tv', 1399)).searchParams.has('output_language')).toBe(false);
  });

  // Pinned as an ALLOWLIST, not just "the bad parameter is gone": the failure
  // mode is "someone appends a parameter MOTN doesn't accept", and only an
  // exact-key assertion catches the NEXT one. Verified by mutation during
  // review — a different bad key (`format: 'json'`) reddens this test alone.
  it('sends ONLY parameters parse.ts actually consumes', () => {
    // parse.ts reads streamingOptions.se — service id, type, link, price,
    // expiresOn. None of that is localized, so `country` is the whole contract.
    // Adding a key here must be a deliberate edit to this list, with the new
    // parameter verified against the live API first.
    const keys = [...new URL(offersUrl('tv', 1399)).searchParams.keys()].sort();
    expect(keys).toEqual(['country']);
  });
});

/**
 * The second half of BIN-856: a malformed request must not be able to spend
 * the whole month's vendor quota nine calls at a time. These tests pin WHICH
 * statuses stop the run, because that distinction is the only thing standing
 * between "one wasted call" and "198 wasted calls".
 */
describe('classifyStatus', () => {
  it('parses a success', () => {
    expect(classifyStatus(200)).toBe('ok');
  });

  it('treats "not in the catalogue" as a real answer, not a failure', () => {
    // 404 means MOTN simply doesn't carry the title — that is genuine
    // information ("no SE offers"), not an error to retry.
    expect(classifyStatus(404)).toBe('no-offers');
  });

  it('stops the run when the vendor throttles us', () => {
    expect(classifyStatus(429)).toBe('rate-limited');
  });

  // THE BIN-856 BEHAVIOUR. A 400 is our own malformed request; it will fail
  // identically for every remaining title. If this ever returns 'retry' again,
  // the run resumes burning a vendor call per title on a guaranteed failure —
  // which is exactly how 198 of 300 monthly calls were lost.
  it('stops the run when the vendor rejects the request itself', () => {
    expect(classifyStatus(400)).toBe('rejected');
    expect(classifyStatus(401)).toBe('rejected'); // bad or expired key
    expect(classifyStatus(403)).toBe('rejected'); // key lacks access
  });

  it('retries only the title when the vendor itself is having trouble', () => {
    // 5xx genuinely can differ between titles and clears on its own, so it
    // must NOT stop the run — that would turn a blip into a dark day.
    expect(classifyStatus(500)).toBe('retry');
    expect(classifyStatus(502)).toBe('retry');
    expect(classifyStatus(503)).toBe('retry');
  });

  it('never lets a request-shape error masquerade as a per-title miss', () => {
    // The property that matters, stated once as a property rather than as a
    // list: nothing in 4xx except 404 and 429 may be retried per-title.
    for (let status = 400; status < 500; status += 1) {
      if (status === 404 || status === 429) continue;
      expect(classifyStatus(status)).not.toBe('retry');
    }
  });
});
