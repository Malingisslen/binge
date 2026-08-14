// functions/src/util/motnVendor.ts
//
// The two things both MOTN clients need and had their own copy of: the vendor
// host, and the rule for how a vendor error body may be logged.
//
// Binge talks to MOTN (RapidAPI streaming-availability) from two places on the
// SAME vendor account and key — `streamingOffers/motn.ts` (per-title SE offers)
// and `leavingRollup/motnChanges.ts` (the "vad försvinner" rollup). BIN-856
// taught that a blind spot in one is a blind spot in both: streamingOffers threw
// away the vendor's own error text and kept only the status number, so a 400
// that said in plain words what was wrong read as ordinary flakiness for a
// month. The fix was applied to both halves — and then existed twice, verbatim,
// rationale comment and all, which is how the two copies start drifting.
//
// Admin-free ON PURPOSE: no `firebase-admin`, no `firebase-functions/v2`. Both
// callers import a logger; this module must not, or its test can't be imported
// under the root CI vitest toolchain's `npm ci` (the same reason
// `streamingOffers/motnRequest.ts` and `leavingRollup/config.ts` exist).
//
// Named for the vendor rather than for either export: it is the shared MOTN
// surface, and a module called `redactVendorBody.ts` holding a hostname would
// be a worse home for the next thing both clients turn out to share.
//
// Deliberately NOT moved here: `classifyStatus`. The two endpoints disagree
// about what 404 MEANS — on `/shows/{type}/{id}` it is a real answer ("this
// title isn't in the catalogue", i.e. no SE offers), while on `/changes` it is
// an error like any other. Folding them together would let a 404 on /changes
// be read as benign and kill the rollup silently, which is BIN-856's failure
// shape exactly. #13 Data / Integrations made that a binding condition on
// BIN-857; it stays two predicates until someone proves the vendor's /changes
// 404 semantics against the live API.

/** RapidAPI host for MOTN (Streaming Availability). Same account for both clients. */
export const MOTN_HOST = 'streaming-availability.p.rapidapi.com';

/** How much of a vendor error body reaches the log. A 5xx can return a whole HTML page. */
const MAX_LOGGED_BODY_CHARS = 300;

/**
 * Prepare a vendor error body for logging: mask the API key, THEN truncate.
 *
 * The order is the whole point and is not interchangeable — but not for the
 * reason it first appears. A key sitting at the START of the body is redacted
 * either way, because it lies wholly inside the kept slice; that case, which
 * BIN-857's acceptance criterion named, cannot tell the two orders apart, and
 * a test built only on it passes against the swapped implementation. Verified
 * by mutation 2026-08-14 and independently reproduced by both the security and
 * test reviewers.
 *
 * The orders diverge only when the key STRADDLES the cap. Truncating first
 * cuts the credential in half and strands its leading characters, unmasked, at
 * the end of the logged line — `replaceAll` then searches for a whole key that
 * is no longer there. Masking first removes it before the cut. That is the
 * case the test pins ("leaves no fragment of a key that straddles the
 * truncation boundary"); the offset-0 test stays as the plain-language promise
 * and as the guard against redaction being dropped altogether.
 *
 * Security review (2026-08-11) asked for redaction at all rather than trusting
 * the vendor not to echo the key; the 400 body demonstrably doesn't, but the
 * same branch also carries 401/403.
 *
 * `key` is masked even when empty is impossible in practice — both callers
 * return early without a key — but an empty needle would make `replaceAll`
 * insert the placeholder between every character, so it is guarded.
 */
export function redactVendorBody(body: string, key: string): string {
  const masked = key ? body.replaceAll(key, '[redacted]') : body;
  return masked.slice(0, MAX_LOGGED_BODY_CHARS);
}
