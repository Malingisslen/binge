import type { WatchStatus, ItemVisibility, WatchlistItem } from '@/types';
import type { WatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { shouldStampProvidersAtAdd } from '@/lib/watchlist/tmdbFieldsRefresh';

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
 * Shared by `buildStatusUpdate` and `buildAddWrite` so the rule can't drift between
 * the two write paths.
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
 * the add path would destroy the exact user-authored field this guard protects.
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

/**
 * BIN-641 — the rewatch-count FIELDS for a write, or nothing.
 *
 * Returns the fragment rather than a boolean so the two write paths cannot
 * drift on the increment either — the `?? 0` default is the part that carries
 * risk, not the comparison. Spread it; do not re-derive it.
 *
 * Film-only by construction: 'sedd' is the terminal FILM status, so a TV write
 * (which lands as 'mina') can never be a rewatch — see watchStatus.ts.
 *
 * Knowing the transition is NOT sufficient on the add side. That path is also the
 * BULK path (CSV import, onboarding, "add all" surfaces), where a sedd → sedd
 * write is a restore rather than a viewing. The caller states intent; this only
 * answers the half it can see. Do not re-justify that with a named caller — two
 * attempts to do so cited callers that dedupe.
 *
 * BIN-655: the caller now states it by CHOOSING `upsertTitle` or `logViewing`, and
 * `buildAddWrite` calls this only on the second. Nothing else changed here.
 *
 * NOTE for whoever adds the next caller: `planQuickRateWrite` also encodes
 * 'sedd' + 'sedd' and must NOT be rewired onto this. Expressing the quick-rate
 * rule via a helper named "rewatch" would imply that surface counts one, which
 * is exactly the BIN-599 bug.
 *
 * AND: wherever this counts, the caller must ALSO re-date. `buildAddWrite` does
 * (BIN-641, gated on the counted OUTCOME so the two cannot disagree);
 * buildStatusUpdate does not, only because its branch is NOT INTENDABLE — no
 * caller can mean to reach it, though a render-state-vs-live-ref race still can.
 * (It said "unreachable" until BIN-655; the branch's own comment ~70 lines below
 * already said the weaker thing, and that weaker claim is the stated reason the
 * branch may count without re-dating. One branch, one answer.) Whoever makes it
 * intendable adds the intent gate and the re-date together — a count without a
 * fresh date is the half-feature Malin rejected.
 */
export function rewatchFields(
  status: WatchStatus,
  currentStatus: WatchStatus | null | undefined,
  currentRewatchCount: number | null | undefined,
): Record<string, number> {
  const isRewatch = status === 'sedd' && currentStatus === 'sedd';
  return isRewatch ? { rewatchCount: (currentRewatchCount ?? 0) + 1 } : {};
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
 *    `rewatchCount` (see `rewatchFields`), so re-marking here
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
  // KNOWN COST, now PARTLY ANSWERED. The code cannot tell a date SHE picked from
  // one we auto-stamped (there is no watchedAtSource flag), so her "only a manual
  // change may alter it" rule is implemented as "no automatic write may alter ANY
  // stored date". Two transitions paid; they no longer pay the same:
  //
  //  - sedd -> sedd. No updateStatus caller can INTEND it — which is why the
  //    branch stays (QuickRateModal is gated by planQuickRateWrite, VillSePicker
  //    lists only vill_se films, WatchlistPage bulk writes vill_se/avbruten). All
  //   four decide from RENDER state while ctx.currentStatus comes from the live
  //   ref, so an await in between can still deliver it. The
  //    live rewatch surface is `logViewing`'s "Sedd igen" (BIN-641), which counts AND
  //    re-dates to now — Malin, 2026-07-31, the manual-act carve-out. So the frozen
  //    date this used to describe is not what a user meets today.
  //  - vill_se/avbruten -> sedd (took it off the shelf to watch again). STILL
  //    ESCALATED and still unrecorded: no rewatch (this rule) and no fresh date
  //    (stampWatchedAt below). Before BIN-593 this wrote watchedAt: now. Dagbok,
  //    Statistik's monthly activity and Streamingrådgivarens films-this-month lens
  //    all keep crediting the OLD month, so a service she actually used this month
  //    can read as unused. WatchedDateEditor is the way to fix it by hand — and for
  //    THIS bullet it is still the only way, which is why the wording stays. BIN-641's
  //    "Sedd igen" also re-dates, but that entry only renders on a title already
  //    'sedd', so it cannot reach a vill_se/avbruten title. (BIN-655 checked this:
  //    the ticket listed the sentence as stale, and on this bullet it is not.)
  // BIN-593: `watchedAt` belongs to the user. Two ways it may be written here:
  // an explicit override (the "markera sedd + välj datum" flow — a manual act),
  // or the very first automatic stamp on a title that provably has no date yet.
  // Anything else omits the key, so the merge-write preserves what's stored —
  // including on a rewatch (see rewatchFields above) and on any non-'sedd' status:
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
    ...rewatchFields(status, ctx.currentStatus, ctx.currentRewatchCount),
    // BIN-35: clear the legacy v1/v2 `dropped` flag on any non-avbruten status.
    // migrateStatus lets `dropped:true` win unconditionally, so without this a
    // legacy doc would snap back to 'avbruten' on the next snapshot — making
    // abandoned titles impossible to revive from the UI.
    ...(status !== 'avbruten' ? { dropped: false } : {}),
  };
}

// -- BIN-655 -- the ONE payload builder behind both watchlist write entry points -----
//
// `addItem` used to infer five things from a single call and take a FLAG for the sixth,
// because "did a human just say they watched this?" is the one thing a write path
// structurally cannot see. That asymmetry was patched twice at the call site (BIN-599's
// planQuickRateWrite, BIN-641's opts.countsAsViewing) before it was fixed here.
//
// The answer is now WHICH FUNCTION YOU CALLED -- WatchlistContext exposes `upsertTitle`
// (bulk/sync) and `logViewing` (a human logging a watch) -- but there is deliberately
// only ONE builder underneath. Two independent builders would be exactly the risk #27
// named when it approved the split: replacing one skewed function with two that drift.

/**
 * Which of the two entry points is writing.
 *
 * `'bulk'`    - CSV import, onboarding, "add all", Bevaka, the quick-rate pass, and
 *               every non-`sedd` quick add. A `sedd` -> `sedd` write here is a RESTORE,
 *               not a viewing (BIN-599: counting it inflated a permanent, un-editable
 *               counter once per pass through the quick-rate modal).
 * `'viewing'` - the user just said they watched it. May count a rewatch, and when it
 *               counts, re-dates.
 */
export type WriteIntent = 'bulk' | 'viewing';

/** Everything the builder needs that it cannot see for itself. Resolved ONCE by the
 *  caller and shared by every guard below -- the six gates disagreeing about what
 *  `current` is would be the drift this consolidation exists to prevent. */
export interface AddWriteContext {
  /** The LIVE stored row (read from the ref, never a render closure -- BIN-593), or
   *  `undefined` for a title we have no row for. */
  current: WatchlistItem | undefined;
  /** Has the first watchlist snapshot landed? `false` = cold load: a re-mark is
   *  indistinguishable from a new add, so the STRICT gates say nothing. */
  snapshotSettled: boolean;
  /** BIN-601 -- a DEAD listener is not a cold load. There `current` is undefined for
   *  every title, so stamping `addedAt` would rewrite the real add date of a title that
   *  may be years old. Unrecoverable, so we say nothing and BIN-640's read-repair keeps
   *  that silence from costing anything. */
  listenerFailed: boolean;
  /** The profile default, already resolved. Written only when `shouldStampVisibility`
   *  says so -- see BIN-595. */
  visibilityFields: { effectiveVisibility: ItemVisibility; isPublic: boolean };
  /** Injected, so this module stays Firebase-free and testable without an env. Called
   *  once per stamped field; the tests pass a sentinel and assert on identity. */
  serverTimestamp: () => unknown;
}

/**
 * Build the merge-write payload for one watchlist add / re-mark.
 *
 * INTENT GATES EXACTLY TWO THINGS, and this list is the contract:
 *   1. whether `rewatchFields` applies at all;
 *   2. the OVERWRITE half of the `sedd` watchedAt branch.
 *
 * Everything else is identical on both paths -- including stamping a title's FIRST
 * watch date, which a bulk import of a never-before-seen film must still do. So
 * `buildAddWrite(item, 'bulk', ctx)` is byte-identical to the pre-BIN-655
 * `addItem` called with no options, and `buildAddWrite(item, 'viewing', ctx)` to the
 * same call with `countsAsViewing: true`. The parity matrix in
 * watchlistWrites.addWrite.test.ts is what holds that true. (Not watchlistWrites.test.ts,
 * which is the helpers suite and contains no matrix — integration review, 2026-08-14.)
 */
export function buildAddWrite(
  item: WatchlistAddPayload,
  intent: WriteIntent,
  ctx: AddWriteContext,
): Record<string, unknown> {
  const { current, snapshotSettled, listenerFailed, visibilityFields, serverTimestamp } = ctx;

  // BIN-641 -- computed ONCE so the re-date below can gate on the OUTCOME rather than
  // re-deriving the conditions. The two must agree: a write that re-dates without
  // counting (or the reverse) is incoherent, and the raw intent alone would permit it --
  // intent on a tracked title that is NOT 'sedd' would stomp the stored date while
  // counting nothing. A cold load leaves `current` undefined, so it counts nothing and
  // therefore re-dates nothing either. Neither is user-fixable.
  const rewatch = intent === 'viewing'
    ? rewatchFields(item.status, current?.status, current?.rewatchCount)
    : {};
  const countedRewatch = 'rewatchCount' in rewatch;

  // BIN-505/BIN-164: notes AND tags live ONLY in their owner-only subcollections
  // (watchlistNotes / watchlistTags), because both are free text that captures third-party
  // personal data. The watchlist doc is publicly readable, and isValidWatchlistItem's
  // `hasOnly` allowlist names NEITHER field -- so either one riding along fails the ENTIRE
  // merge-write with permission-denied, on an unrelated status change. Belt AND braces,
  // deliberately: `WatchlistAddPayload` accepts neither key (BIN-894 added `tags` to
  // ServerOwned beside `notes`), which stops every type-checked caller; this runtime strip
  // stays for the ones types cannot reach (a cast, plain JS, a future refactor that widens
  // the signature). Privacy invariants, not conventions.
  //
  // `tags` is the likelier accident of the two: WatchlistContext JOINS the tags listener
  // onto every item in memory, so a caller holding a row it read from the context already
  // has a populated `tags` in hand.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { notes: _strippedNotes, tags: _strippedTags, ...itemFields } =
    item as WatchlistAddPayload & { notes?: unknown; tags?: unknown };

  return {
    ...itemFields,
    dropped: false,
    // BIN-595: only (re-)assert the two DENORMALISED visibility fields
    // (effectiveVisibility + the legacy isPublic mirror -- never the per-item
    // `visibility` override itself, which updateVisibility alone writes) when the title
    // has no per-item override. BOTH entry points are also re-mark paths, so writing the
    // profile default unconditionally WOULD republish a title the user had deliberately
    // hidden, on nothing more than a status change. Conditional, not past tense: no
    // released version ever shipped a UI for the per-title override, so the state this
    // protects has never existed in real data. The guard is here for when it does.
    ...(shouldStampVisibility(current) ? visibilityFields : {}),
    // Write addedAt only when this is NOT a re-mark. This is a merge-write, so an omitted
    // key preserves the stored value -- and re-stamping it on every status change rewrote
    // the original add date, which Bibliotek's "Tillagd" sort, backlogResurface's
    // oldest-first ranking, taste/stats' 30-day counter and the GDPR export all read as
    // the truth.
    //
    // Deliberately NOT gated on `snapshotSettled`, unlike the three STRICT gates below.
    // The cost of guessing wrong is asymmetric per field: during an ordinary cold load we
    // must still stamp, or a genuinely new doc lands with no date at all. Do not "unify"
    // these guards. `listenerFailed` is the one case that suppresses it -- see that
    // field's doc on AddWriteContext.
    ...(current || listenerFailed ? {} : { addedAt: serverTimestamp() }),
    ...rewatch,
    updatedAt: serverTimestamp(),
    // BIN-593 -- `watchedAt` is user-authored. Malin, 2026-07-25: "har man manuellt
    // justerat 'sett' ska det bara andras om man sjalv manuellt andrar igen." Two ways it
    // is written here, and only one of them touches an existing date:
    //
    //  - the FIRST automatic stamp on a title provably without one
    //    (`canAutoStampWatchedAt`). BOTH intents, deliberately: a bulk import of a film
    //    the user has never seen still deserves its first date.
    //  - a COUNTED rewatch, which is the human saying "I watched this, now" -- precisely
    //    the carve-out BIN-593 leaves open ("bara om man sjalv manuellt andrar igen").
    //    `'viewing'` only, by construction, since `rewatch` is empty on the bulk path.
    //    Without it the rewatch is invisible: the count says x2 while Dagbok, Statistik's
    //    monthly activity and Streamingradgivarens films-this-month lens all keep
    //    crediting the ORIGINAL viewing. The cost is real and accepted -- a title stores
    //    one date, so the earlier one is replaced.
    //
    // STRICT about the rest: during a cold load, when `current` is undefined and a
    // re-mark is indistinguishable from a new add, we say nothing. A missing watchedAt is
    // user-fixable (the date picker); a stomped one is gone. Do not unify this with the
    // addedAt guard above -- the safe error inverts per field.
    //
    // Shares `canAutoStampWatchedAt`/`resolveCurrentWatchedAt` with buildStatusUpdate so
    // the "may we stamp?" rule cannot drift between the two write paths. That predicate is
    // ALL they share: buildStatusUpdate also stamps on an explicit `watchedAtOverride`,
    // and this path has no such parameter and no equivalent branch.
    ...(item.status === 'sedd'
      && (countedRewatch || canAutoStampWatchedAt(resolveCurrentWatchedAt(current, snapshotSettled)))
      ? { watchedAt: serverTimestamp() }
      : {}),
    // BIN-402/BIN-453: stamp the doc-level TMDB-fields freshness on a genuine NEW add --
    // that write really does denormalize the TMDB-derived block fresh from TMDB, and
    // without the stamp the ToS sweep (which treats an absent stamp as stale) would clear
    // a just-added title's fields. But NOT on a re-mark: those carry `current`'s cached
    // values forward, so stamping there re-certified data that may be years old as freshly
    // verified -- making the static field-group permanently un-sweepable on exactly the
    // titles users touch most, and defeating the 6-month TMDB ToS clearing the sweep
    // exists to enforce.
    //
    // STRICTER gate than addedAt above -- deliberately the OPPOSITE trade-off, and the
    // same one shouldStampProvidersAtAdd makes below. An ABSENT freshness stamp just reads
    // as stale and the title-page repair refills it, whereas a FALSE-fresh one suppresses
    // that repair for 90 days. So when the snapshot has not settled and we cannot tell a
    // new add from a re-mark, we say nothing.
    ...(snapshotSettled && !current ? { tmdbFieldsRefreshedAt: serverTimestamp() } : {}),
    // BIN-468: stamp the providers group ONLY on a genuine new add carrying real
    // providers. BOTH entry points are also re-mark paths (cached/[] providers); stamping
    // there would falsely re-certify stale providers AND suppress taste/backfill's 60-day
    // re-fetch. "Genuine new add" requires the snapshot to have SETTLED -- during a cold
    // load `items` is [] so an in-library re-mark would otherwise misread as new.
    // `?? undefined`: the payload type allows null, and null here means "not supplied" for
    // stamping purposes exactly like undefined -- only a real array (including an empty
    // one) certifies the group.
    ...(shouldStampProvidersAtAdd(
      snapshotSettled && !current,
      item.providers,
      item.subscriptionProviders ?? undefined,
    )
      ? { providersCheckedAt: serverTimestamp() }
      : {}),
    // BIN-349: stamp ratedAt ONLY on a genuinely new/changed rating in this call --
    // covers pre-rated CSV imports (current undefined) while NOT bumping recency when a
    // re-mark carries the unchanged current rating. Omit the key otherwise so the merge
    // preserves any existing ratedAt.
    ...(item.rating != null && item.rating !== (current?.rating ?? null)
      ? { ratedAt: serverTimestamp() }
      : {}),
  };
}
