import type { WatchStatus, ItemVisibility } from '@/types';

// BIN-164 — pure tag normalization for the owner-only watchlistTags store.
// Firebase-free so it can be unit-tested; the rules cap array size server-side
// (<= MAX_TAGS_PER_ITEM) but can't iterate elements, so per-tag length + dedup
// + reserved-word rejection are enforced here (client-side, defense-in-depth).
export const MAX_TAGS_PER_ITEM = 15;
export const MAX_TAG_LENGTH = 24;

/**
 * Clean a raw tag list into the canonical stored form:
 *  - trim + collapse internal whitespace, drop empties
 *  - truncate each tag to MAX_TAG_LENGTH chars
 *  - case-fold (sv-SE) for dedup + reserved-collision checks, but keep the
 *    first-seen DISPLAY casing ("Mysrys" and "mysrys" collapse to one)
 *  - drop tags whose folded form is in `reserved` (genre/rating chip labels —
 *    caller passes them folded — so a user tag can't masquerade as a real facet)
 *  - cap the list to MAX_TAGS_PER_ITEM
 */
export function normalizeTags(raw: string[], reserved: Set<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawTag of raw) {
    const value = rawTag.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
    if (!value) continue;
    const fold = value.toLocaleLowerCase('sv-SE');
    if (reserved.has(fold) || seen.has(fold)) continue;
    seen.add(fold);
    out.push(value);
    if (out.length >= MAX_TAGS_PER_ITEM) break;
  }
  return out;
}

// Pure builder for the Firestore merge-payload written by
// WatchlistContext.updateStatus. Extracted so the field-inclusion logic can be
// unit-tested without Firebase — the hook injects the serverTimestamp() sentinel
// and visibility fields, this function only decides which keys end up in the doc.
// (Same extract-then-test pattern as sessionTiming.ts / *.helpers.ts.)

export interface StatusUpdateContext {
  /** serverTimestamp() sentinel — injected by the caller so this stays pure. */
  now: unknown;
  /** Visibility fields to merge (empty when the item already has explicit visibility). */
  visFields: Record<string, unknown>;
  /** The item's current status, for rewatch detection. */
  currentStatus?: WatchStatus;
  /** The item's current rewatch count, for the rewatch increment. */
  currentRewatchCount?: number;
  /**
   * BIN-91: optional backdated watch time for a 'sedd'-write (a Timestamp/Date
   * sentinel from the caller). An explicit value here always wins over the
   * protection below, because supplying one IS the user saying what the date is.
   * `updatedAt` always stays `now` — that's the real write time, only the
   * *watched* moment is overridable.
   *
   * NOTE: no production caller currently supplies it. It reaches here only via
   * `updateStatus`'s optional 4th argument, and every call site passes three —
   * the actual date picker (`WatchedDateEditor`) writes through `updateWatchedAt`
   * instead. Treat this as the kept BIN-91 signature, not the live manual path.
   */
  watchedAtOverride?: unknown;
  /**
   * BIN-593 — the item's STORED watch date, as far as the caller knows. Three
   * distinct meanings, all load-bearing:
   *   - a value     → a date is already stored → NEVER auto-overwrite it
   *   - `null`      → we positively know none is stored → safe to auto-stamp
   *   - `undefined` → we don't know (cold load / not in the snapshot) → say nothing
   *
   * `watchedAt` is user-authored data (Malin, 2026-07-25: "har man manuellt
   * justerat 'sett' ska det bara ändras om man själv manuellt ändrar igen"), so
   * the only automatic write left is the FIRST stamp on a title that has none.
   *
   * Typed `Date | null` and NOT `unknown` like its siblings above: those carry
   * Firestore FieldValue sentinels the app's types can't express, this one only
   * ever comes from `WatchlistItem.watchedAt`. The whole guard rests on a strict
   * `=== null`, so a stray truthy non-Date must not be able to reach it.
   */
  currentWatchedAt?: Date | null;
}

/**
 * BIN-593 — resolve the tri-state above from what the caller actually has:
 * the item as found in the watchlist snapshot (or `undefined` if not found),
 * plus whether that snapshot has settled yet.
 *
 * Not-found + settled = genuinely new title → `null` (safe to stamp).
 * Not-found + unsettled = cold load, a re-mark is indistinguishable from a new
 * add → `undefined` (say nothing).
 */
export function resolveCurrentWatchedAt(
  current: { watchedAt: Date | null } | undefined,
  snapshotSettled: boolean,
): Date | null | undefined {
  if (current) return current.watchedAt;
  return snapshotSettled ? null : undefined;
}

/**
 * BIN-593 — the single definition of "may we stamp a watch date automatically?".
 * Shared by `buildStatusUpdate` and `WatchlistContext.addItem` so the rule can't
 * drift between the two write paths.
 */
export function canAutoStampWatchedAt(currentWatchedAt: Date | null | undefined): boolean {
  return currentWatchedAt === null;
}

/**
 * BIN-595 — may this write (re-)stamp the two DENORMALISED visibility fields
 * (`effectiveVisibility` + the legacy `isPublic` mirror) from the PROFILE default?
 *
 * Two, never three. The per-item `visibility` override itself is NOT written here
 * and must never be: it is in buildAddPayload's ServerOwned set precisely so no add
 * path can touch it, and `updateVisibility` is its only writer. Writing it from
 * addItem would destroy the exact user-authored field this guard exists to protect.
 * (An earlier draft of this doc called the three a "trio", which invited exactly
 * that mistake — hence the emphasis.)
 *
 *  - the item carries an explicit per-item override → NO. Writing the profile
 *    default would silently reverse the user's choice, and on a public profile
 *    that means republishing a title they deliberately hid. `visibility` (the
 *    override) survives on the doc, but nothing reads it for access control —
 *    both firestore.rules and usePublicProfile key on `effectiveVisibility`.
 *  - anything else → YES. That covers a genuinely new title AND the A4.3
 *    lazy-on-write re-assert that back-fills pre-cascade docs.
 *
 * This is deliberately the SAME rule the six sibling mutators already inline as
 * `current?.visibility == null` — `undefined?.visibility == null` is true, so a
 * title we haven't loaded yet is stamped exactly as it is today. Extracting it
 * changes no behaviour; it gives the rule one name and one test so BIN-598 can
 * tighten all seven writers together, once the per-title override actually ships.
 *
 * An earlier version of this helper ALSO refused to stamp during a cold load, to
 * protect an override we might not have loaded yet. That was reverted: the
 * override has never been reachable in any released version (no UI calls
 * `updateVisibility`), so the branch protected nothing — while a doc landing with
 * NEITHER field is missing from the owner's own public profile, because
 * `usePublicWatchlist`'s tier queries match `effectiveVisibility` by EQUALITY and
 * Firestore equality never matches an absent field. Real cost, no benefit.
 */
export function shouldStampVisibility(
  current: { visibility: ItemVisibility | null } | undefined,
): boolean {
  return current?.visibility == null;
}

export type QuickRateWrite = 'add-as-seen' | 'rating-and-status' | 'rating-only';

/**
 * BIN-611 — "should this quick rating ALSO write the title's status?"
 *
 * The decision BIN-599 fixed inside QuickRateModal, lifted out so it can be
 * tested without React/Firebase (the fix shipped with no test at all — that gap
 * IS this ticket). Three outcomes, and the middle one is the whole point:
 *
 *  - `add-as-seen`      — not in the library → add it, status 'sedd'.
 *  - `rating-and-status`— tracked but NOT 'sedd' → rate it and promote it.
 *  - `rating-only`      — tracked AND already 'sedd' → rate it, write NOTHING
 *    else. `updateStatus` reads a 'sedd' → 'sedd' write as a rewatch and bumps
 *    `rewatchCount` (see `buildStatusUpdate`'s `isRewatch`), so re-marking here
 *    logged a viewing that never happened — once per pass through the modal,
 *    and permanently, since `rewatchCount` is editable nowhere. This surface is
 *    a RATING pass ("Sett 4★"), not a viewing log.
 *
 * `buildStatusUpdate` can't defend this itself: it only sees the stored status,
 * so "did a viewing actually happen?" is the CALLER's question. This helper is
 * that answer for the quick-rate caller.
 */
export function planQuickRateWrite(
  current: { status: WatchStatus } | null | undefined,
): QuickRateWrite {
  if (!current) return 'add-as-seen';
  return current.status === 'sedd' ? 'rating-only' : 'rating-and-status';
}

export function buildStatusUpdate(
  status: WatchStatus,
  ctx: StatusUpdateContext,
): Record<string, unknown> {
  // BIN-593: this stays sedd→sedd ONLY. It was briefly broadened to count "a
  // stored watch date exists" as evidence of a prior viewing — so that a
  // sedd(2019) → vill_se → sedd(tonight) re-viewing would still be recorded once
  // the date itself became protected. Reverted: since the same ticket stopped a
  // status change from clearing watchedAt, a MIS-CLICK now also leaves a date
  // behind. Undo the mis-click, genuinely watch the film later, and that broader
  // rule counted a rewatch of a film seen exactly once — rendered as "x2" and
  // permanent, since rewatchCount is editable nowhere. A preserved date cannot
  // distinguish "watched" from "tapped by mistake", so it is not evidence.
  //
  // This rule is NOT a general defence against a wrong count — it only sees the
  // stored status, so every caller owns the question "did a viewing actually
  // happen?". QuickRateModal used to re-mark already-'sedd' films on every pass
  // and inflate the count that way; BIN-599 fixed it at that call site (it now
  // writes the status only when it changes), NOT here.
  //
  // KNOWN COST — a real regression, escalated to Malin, not decided here. The
  // code cannot tell a date SHE picked from one we auto-stamped (there is no
  // watchedAtSource flag), so her "only a manual change may alter it" rule is
  // implemented as "no automatic write may alter ANY stored date". Two paths pay:
  //
  //  - sedd -> sedd (the common one: re-mark an already-seen film). The rewatch
  //    IS counted, but the date stays frozen at the first, possibly auto-stamped,
  //    value. The row reads "x2 … Sedd: 2 apr 2019".
  //  - vill_se/avbruten -> sedd (took it off the shelf to watch again). Recorded
  //    NOWHERE: no rewatch (this rule) and no fresh date (stampWatchedAt below).
  //    Before BIN-593 this transition wrote watchedAt: now.
  //
  // Either way Dagbok, Statistik's monthly activity and Streamingrådgivarens
  // films-this-month lens all keep crediting the OLD month — so a service she
  // actually used this month can read as unused. WatchedDateEditor is the way to
  // re-date a re-viewing.
  const isRewatch = status === 'sedd' && ctx.currentStatus === 'sedd';
  // BIN-593: `watchedAt` belongs to the user. Two ways it may be written here:
  // an explicit override (the "markera sedd + välj datum" flow — a manual act),
  // or the very first automatic stamp on a title that provably has no date yet.
  // Anything else omits the key, so the merge-write preserves what's stored —
  // including on a rewatch (see isRewatch above) and on any non-'sedd' status:
  // leaving 'sedd' must not erase the history.
  //
  // CONSEQUENCE FOR EVERY READER: a stored date does NOT mean "currently seen".
  // Gate on `status` first. `useServiceValue`, `DiaryPageClient` and `diary.ts`
  // already did; THREE had to be fixed during BIN-593 — `taste/stats.ts` (which
  // fed a PUBLIC profile counter), `app/stats/page.tsx`, and `WatchlistPage.tsx`,
  // which needed its own per-row `seenDate()` helper because it renders rows of
  // mixed status rather than a pre-filtered list. Do not treat this list as a
  // closed set — BIN-598 tracks giving the rule one shared home.
  const stampWatchedAt =
    status === 'sedd' &&
    (ctx.watchedAtOverride !== undefined || canAutoStampWatchedAt(ctx.currentWatchedAt));
  return {
    status,
    ...ctx.visFields,
    updatedAt: ctx.now,
    ...(stampWatchedAt ? { watchedAt: ctx.watchedAtOverride ?? ctx.now } : {}),
    ...(isRewatch ? { rewatchCount: (ctx.currentRewatchCount ?? 0) + 1 } : {}),
    // BIN-35: clear the legacy v1/v2 `dropped` flag on any non-avbruten status.
    // migrateStatus lets `dropped:true` win unconditionally, so without this a
    // legacy doc would snap back to 'avbruten' on the next snapshot — making
    // abandoned titles impossible to revive from the UI.
    ...(status !== 'avbruten' ? { dropped: false } : {}),
  };
}
