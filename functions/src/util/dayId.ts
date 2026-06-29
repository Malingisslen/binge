/**
 * Stockholm-local YYYY-MM-DD day-id — the ONE source of truth for daily/period
 * buckets in product-facing scheduled functions (BIN-343, BIN-350).
 *
 * Functions run in europe-west1 for Swedish users; a UTC `toISOString().slice(0,10)`
 * misfiles late-night events into the previous day and rolls daily windows over at
 * 01:00/02:00 local instead of midnight. `sv-SE` is the locale that natively formats
 * as YYYY-MM-DD, and `timeZone` resolves the wall-clock date including DST (CET/CEST).
 * Pure (no firebase-admin) so it unit-tests under the root vitest toolchain.
 *
 * USE THIS for product-facing reporting/notification windows (insights rollup,
 * weekly digest, rotation reminders, leaving-rollup labels, askBinge throttle/budget).
 *
 * Do NOT use this for:
 *  - **vendor-quota windows** that must mirror an external API's own daily reset —
 *    MOTN's 100/day (`streamingOffers` motnDay) and OMDb's 900/day (`titleRatings`)
 *    both reset on the vendor's UTC clock, so their budget doc-ids stay UTC. Aligning
 *    them to Stockholm would misalign our counter against the vendor's reset and risk
 *    overshooting a paid/throttled cap. (BIN-350 / Financial Controller review.)
 *  - **data-dates** — an offer's own leaving/release timestamp is a stored data field,
 *    not a "today" bucket; localizing it would silently shift displayed dates.
 */
export function stockholmDayId(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
}
