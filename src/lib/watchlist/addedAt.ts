/**
 * Reading `addedAt` off a watchlist doc that may not have one (BIN-601/BIN-640).
 *
 * A watchlist doc can legitimately exist WITHOUT `addedAt`: when the realtime
 * listener has died, `addItem` deliberately stops stamping it, because the
 * alternative — stamping on every status change while we cannot see the library —
 * silently rewrites the real add date of a title that may be years old, and that
 * is unrecoverable (BIN-601).
 *
 * The trap that made the cure worse than the disease: `toDate()` ends in
 * `return new Date()`, so a missing `addedAt` did not read as "unknown", it read
 * as **added right now** — on every load, forever. That pinned the row to the top
 * of Bibliotek's "Tillagd" sort and parked it permanently inside the 30-day
 * "Tillagda" counter on the owner's PUBLIC profile, and nothing ever repaired it
 * because `addItem` is the only writer of the field and only stamps when the title
 * is absent (BIN-640).
 *
 * So: resolve a missing `addedAt` to the doc's own `updatedAt` instead. Same lazy-
 * field shape `ratedAt` already uses ("old docs have none; consumers fall back to
 * updatedAt"). `toDate()` itself is deliberately NOT changed — ~20 callers trust
 * "this field is always present", and moving its default is a far bigger landmine
 * than the one being closed here.
 *
 * How honest is the proxy? For a doc created during the outage it is EXACT: the
 * add and the `updatedAt` stamp are the same write. It drifts only if the same
 * title is touched AGAIN during the same outage (added, then marked seen), in
 * which case the last touch wins — drift bounded by how long the listener stayed
 * down, or, if the repair write itself fails, until the next session: the dedup
 * ref is marked before the write and never rolled back, so a touch in between
 * moves the proxy forward. For a doc that already existed, `addedAt` is never
 * missing in the first place, so the proxy is only ever applied where it is right.
 */

import { toDate } from '@/lib/firebase/utils';

type TimestampFields = { addedAt?: unknown; updatedAt?: unknown };

/**
 * Is `addedAt` actually stored on this doc? The repair pass needs to tell a real
 * stored date from a resolved fallback, which `resolveAddedAt`'s return value
 * alone cannot express (both are just a Date).
 */
export function hasStoredAddedAt(data: TimestampFields): boolean {
  return data.addedAt != null;
}

/**
 * The doc's add date, falling back to its last-write date when the field is
 * absent. Never returns "now" for a doc that has an `updatedAt` — which is the
 * whole point.
 */
export function resolveAddedAt(data: TimestampFields): Date {
  return hasStoredAddedAt(data) ? toDate(data.addedAt) : toDate(data.updatedAt);
}

/**
 * Can this doc's missing `addedAt` be repaired to a real stored value?
 *
 * Only when there is an `updatedAt` to copy. A doc missing BOTH has no honest
 * date available — repairing it would invent one — so it is left alone.
 *
 * The `updatedAt != null` term is NOT a defensive afterthought: it is what keeps
 * every ordinary add out of the repair pass. Firestore's latency-compensated
 * local snapshot reports a still-pending `serverTimestamp()` as **null**, so the
 * echo snapshot of a genuine new add arrives as exactly `{ addedAt: null,
 * updatedAt: null }`. Without this term that echo would look repairable, and
 * every add by every user would fire one extra billed write carrying a
 * client-clock "now" — racing the pending server timestamp it would overwrite.
 * (Same read-back fact `refreshedThisSession` and the visibility guards in
 * WatchlistContext are built on.) Do not delete it as dead weight.
 *
 * That pending echo is the ONLY production shape this term excludes. `addItem` is
 * the sole creator of a watchlist doc, and it stamps `updatedAt` unconditionally —
 * but NOT `addedAt`, which its dead-listener branch deliberately withholds. That
 * asymmetry is not a gap in this reasoning, it IS the bug being repaired: a real
 * `updatedAt` beside a missing `addedAt` is exactly what a doc created during an
 * outage looks like, so that combination is always a genuine repair candidate.
 *
 * Read the `updatedAt` half narrowly. Plenty of write paths deliberately never
 * touch it — `setRuntime`, `updateNotes`, `refreshTmdbFields`, the notes
 * migration, nextAirReadRepair and this repair itself. "Never bump updatedAt in a
 * system write" is the house rule; nothing here is licence to break it.
 *
 * Deleting the term reddens ~25 tests, but that breadth is collateral from
 * fixtures that omit `updatedAt`; the real event is pinned by two cases, one here
 * and one in WatchlistContext.test.
 */
export function addedAtIsRepairable(data: TimestampFields): boolean {
  return !hasStoredAddedAt(data) && data.updatedAt != null;
}
