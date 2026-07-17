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
 *  - **vendor-quota windows** that must mirror an external API's own reset —
 *    OMDb's 900/day (`titleRatings`) resets on the vendor's UTC clock, so its budget
 *    doc-id stays UTC. Aligning it to Stockholm would misalign our counter against the
 *    vendor's reset and risk overshooting a paid/throttled cap. (BIN-350 / Financial
 *    Controller review.) MOTN used to be listed here as another 100/day case — BIN-541
 *    (2026-07-17) found that assumption was never verified and wrong: MOTN's real Basic
 *    plan is 500 requests/MONTH, not 100/day. See `motnBillingCycleId` below instead.
 *  - **data-dates** — an offer's own leaving/release timestamp is a stored data field,
 *    not a "today" bucket; localizing it would silently shift displayed dates.
 */
export function stockholmDayId(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(date);
}

/**
 * MOTN (RapidAPI Streaming-Availability) billing-cycle id. BIN-320 assumed a
 * 100/day UTC-reset quota; BIN-541 (2026-07-17) found the real Basic plan is
 * **500 requests/MONTH, hard limit**, checked directly on the RapidAPI dashboard.
 * The cycle does NOT reset on the UTC calendar month — the subscription was
 * created 2026-06-21, so the working assumption is a rolling window anchored to
 * the 21st of each month (Malin could not confirm the exact renewal date; both
 * `streamingOffers` and `leavingRollup` keep a safety buffer under 500 combined
 * specifically because this anchor is a best guess, not a confirmed fact — if a
 * run is ever rejected well before the next 21st, that's a signal to revisit it).
 *
 * Returns a stable id for "the billing cycle that most recently started on/before
 * `date`" — e.g. with the default anchor (21), any date from the 21st through the
 * following month's 20th maps to the same id. UTC-based like other vendor-quota
 * windows (never Stockholm — see the note above).
 *
 * `anchorDay` is clamped to each month's actual day count (`min(anchorDay,
 * daysInMonth)`), so an anchor in 29-31 still produces exactly one cycle
 * boundary per calendar month — e.g. anchor=30 rolls onto Feb 28 in a non-leap
 * year (not a nonexistent "Feb 30"), and March 1-29 correctly stay in that same
 * Feb-started cycle. This is dormant at the current default anchor (21, which
 * every month has) but matters if the anchor is ever corrected to a date late
 * in the month (BIN-541 code review, 2026-07-17).
 */
export function motnBillingCycleId(date: Date = new Date(), anchorDay = 21): string {
  const daysInMonth = (year: number, month: number): number =>
    new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); // day 0 of next month = last day of this month

  let year = date.getUTCFullYear();
  let month = date.getUTCMonth(); // 0-indexed
  const effectiveAnchorThisMonth = Math.min(anchorDay, daysInMonth(year, month));
  if (date.getUTCDate() < effectiveAnchorThisMonth) {
    month -= 1;
    if (month < 0) { month = 11; year -= 1; }
  }
  const effectiveAnchor = Math.min(anchorDay, daysInMonth(year, month));
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(effectiveAnchor).padStart(2, '0')}`;
}
