// functions/src/streamingOffers/motnRequest.ts
//
// How we talk to MOTN: the request URL, and what a response status means for
// the run loop. Kept in its own admin-free module so motnRequest.test.ts can
// import it without transitively pulling in motn.ts's 'firebase-functions/v2'
// logger import — that import isn't resolvable under the root CI vitest
// toolchain's `npm ci` (same reason leavingRollup/config.ts exists as a
// sibling of motnChanges.ts).

export const MOTN_HOST = 'streaming-availability.p.rapidapi.com';

/**
 * SE availability lookup for one title.
 *
 * BIN-856 (2026-08-11): this used to append `output_language=sv`, which the
 * vendor rejects outright — `{"message":"parameter \"output_language\" has an
 * invalid value: sv"}`, HTTP 400 on EVERY request. Nine calls a day since at
 * least 2026-07-11 with not one success.
 *
 * Nothing downstream ever read a localized string: parse.ts consumes only
 * streamingOptions.se (service id, type, link, price, expiresOn), and Binge's
 * Swedish UI copy is authored locally, never vendor-sourced. So the parameter
 * bought us nothing and cost us the entire feed. `country` is the whole
 * contract — motnRequest.test.ts pins that as an allowlist, so adding a
 * parameter here means editing that list and verifying the new key against
 * the live API first.
 */
export function offersUrl(mediaType: 'movie' | 'tv', tmdbId: number): string {
  const params = new URLSearchParams({ country: 'se' });
  return `https://${MOTN_HOST}/shows/${mediaType}/${tmdbId}?${params.toString()}`;
}

/** What a vendor HTTP status means for the run loop. */
export type MotnDisposition =
  /** Parse the body. */
  | 'ok'
  /** Not in MOTN's catalogue — a real answer, meaning "no SE offers". */
  | 'no-offers'
  /** Quota or throttle. Stop the run; the next scheduled run resumes. */
  | 'rate-limited'
  /** The vendor rejected the SHAPE of our request. Stop the run. */
  | 'rejected'
  /** Vendor-side or unknown trouble. Skip this title, retry next run. */
  | 'retry';

/**
 * BIN-856: `rejected` exists so a request WE malformed can't quietly drain the
 * month's vendor quota.
 *
 * A 400/401/403 is never a property of the title being asked about — it's a
 * bad parameter, or a bad/expired key. It will therefore fail identically for
 * every remaining title in the run. Before this, each one mapped to the same
 * `null` as a genuine per-title miss, so the loop shrugged and moved to the
 * next title: nine guaranteed-identical failures per run, every run, which
 * burned 198 of the 300-call monthly cap before anyone noticed. Vendors bill
 * the request, not the success (see reserveMotnSlot), so the loop must stop
 * on the FIRST one.
 *
 * The rule is deliberately the whole 4xx range rather than a list of the codes
 * we happen to have seen (400 bad parameter, 401/403 bad or expired key). Any
 * "you asked wrong" answer to a URL we build identically for every title will
 * repeat identically for every title, so enumerating codes just leaves the
 * next unlisted one (410, 415, 422 …) free to drain the quota the same way.
 * The asymmetry is worth it: stopping wrongly costs one dark refresh cycle,
 * continuing wrongly costs the month.
 *
 * 5xx stays `retry` on purpose — that's the vendor having a bad moment, which
 * genuinely can differ between titles and clears on its own.
 */
export function classifyStatus(status: number): MotnDisposition {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) return 'no-offers';   // not in the catalogue == no offers
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'rejected';
  return 'retry';
}
