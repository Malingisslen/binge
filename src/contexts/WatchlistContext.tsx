'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { resolveAddedAt, addedAtIsRepairable } from '@/lib/watchlist/addedAt';
import { needsTmdbFieldsRefresh, needsProvidersRefresh, planTmdbFieldsRefresh, type TmdbDenormFields } from '@/lib/watchlist/tmdbFieldsRefresh';
import { buildWatchlistAddPayload, type WatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { preferOriginalTitle } from '@/lib/utils/preferOriginalTitle';
import { captureError } from '@/lib/sentry';
import { isPermissionDenied } from '@/lib/firebase/errorCodes';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { migrateStatus } from '@/lib/watchStatus.migration';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { isDeletionStarted } from '@/lib/deletionMarker';
import { buildStatusUpdate, normalizeTags, resolveCurrentWatchedAt, shouldStampVisibility, buildAddWrite, outcomeOfAddWrite, type WriteIntent, type TitleWriteOutcome } from '@/lib/watchlistWrites';
import type { ItemVisibility, WatchlistItem, WatchStatus, MediaType } from '@/types';

/**
 * BIN-954 — the ONE definition of "the listener has told us the truth about this library",
 * so the two places that need it cannot drift apart. They genuinely cannot share a VALUE:
 * the context exposes a reactive one derived from state, while `updateProgress` needs the
 * answer after an await, where only the refs are current. They can share the FORMULA, and
 * that is the part that carries the risk — the doc on `WatchlistState.libraryKnown` says
 * re-deriving this per surface is how the gate goes missing.
 */
function isLibraryKnown(snapshotSettled: boolean, listenerFailed: boolean): boolean {
  return snapshotSettled && !listenerFailed;
}

/**
 * BIN-942 — did this call leave the library document reflecting what was asked?
 *
 * `'refused'` means it did NOT: the create-floor said no because the title was deleted
 * mid-flight, or (in `updateProgress`) there was deliberately nothing to write. Either way a
 * caller must not confirm THE LIBRARY WRITE. `'written'` means the write landed.
 *
 * Scoped to the library document on purpose, and the distinction has one trap in it: on the
 * un-tick path `useEpisodeProgressWithSync` has already written `episodeProgress`, so the
 * user's gesture can succeed while this answers `'refused'` because the series is not in the
 * library at all. Do not read this as "the tick failed".
 */
export type ItemWriteOutcome = 'written' | 'refused';

/**
 * BIN-942 — run an edit-path merge-write that the create-floor in `firestore.rules` may now
 * refuse, and swallow ONLY that refusal.
 *
 * The floor (`requiredWatchlistFields`) is create-only, so in the race this ticket is about
 * these writes are denied for one reason: the document was not there, i.e. the user deleted
 * the title between the snapshot this call read and the write itself. Not the ONLY reason a
 * write here can ever be refused — `isValidWatchlistItem` can also reject an update (a
 * `hasOnly` drift after a client-before-rules deploy, say). That is the SYSTEMATIC case the
 * dated entry lists as explicitly not accepted and still fileable, and it is why the log line
 * below exists at all. The title IS gone and the snapshot
 * listener removes the row anyway, so there is nothing to tell the user and nothing to retry.
 * Before the floor these writes silently RESURRECTED the deleted title as an identity-less
 * ghost on the publicly-readable profile; being refused is the fix working.
 *
 * Narrow on purpose. A bare `catch` would also eat `unavailable`, `deadline-exceeded` and
 * every offline error, on six of the app's most common writes — and this repo shipped that
 * exact mistake once and rolled it back (a bad mobile connection reported as "the invite link
 * is invalid"; see `joinGroupViaToken` in `groups.ts`). `isPermissionDenied` is the SAME
 * predicate, shared rather than copied, so the two cannot drift.
 *
 * `captureError` rather than `console.warn`: Sentry's default `globalHandlers` integration
 * already reports an unhandled rejection, so swapping a throw for a `console.warn` would make
 * a real failure LESS visible than doing nothing. This keeps the signal and adds a `kind` to
 * filter on — which is also the re-open trigger the dated entry in
 * `.claude/rules/accepted-deviations.md` names.
 *
 * NOT used by `writeTitle`. An add reports its outcome to the caller (BIN-895), so a refused
 * add must reject, or the button says "added" about a title Firestore refused.
 *
 * RETURNS the outcome rather than `void`, and that is not decoration. Swallowing here makes
 * the promise RESOLVE, and a caller with its own confirmation UI reads a resolved promise as
 * "it worked": `VillSePickerPage` toasts "Markerad som sedd: X" and `QuickRateModal` marks the
 * card permanently handled. Both would then claim success about a write Firestore refused —
 * the same false confirmation BIN-895 closed for the add path, reopened one door over. Two
 * reviewers found this independently. A caller that says nothing can keep ignoring the value.
 */
async function guardedItemWrite(kind: string, write: () => Promise<void>): Promise<ItemWriteOutcome> {
  try {
    await write();
    return 'written';
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
    console.error(`[watchlist] ${kind}: skrivningen nekades — titeln finns inte längre`, err);
    captureError(err, { scope: 'watchlist', kind });
    return 'refused';
  }
}

// BIN-505: note bounds — NOTE_MAX_LEN mirrors the firestore.rules isValidNoteDoc
// cap.
//
// BIN-701 (traced 2026-08-02; two reviewers read the old wording opposite ways,
// this is the verdict): NOTES_MIGRATE_CAP PACES the eager migration, it does NOT
// bound the session. The effect takes `.slice(0, CAP)` of the titles still
// carrying an inline note and marks only that slice in migratedNotesRef; the
// batch then DELETES those inline notes, so the echo drops them out of the filter,
// the effect re-runs on the new `items` and takes the next 300. An account with
// 5000 inline notes migrates all 5000 in one session, in waves of 300 (each wave
// chunked 200 per batch commit). What migratedNotesRef actually bounds is
// RETRIES — a title whose migration write failed is not attempted again this
// session. Worth knowing on a Blaze account with a 25 SEK/mån cap: the write
// volume is "one write per un-migrated note", paid in waves, not capped at 300.
const NOTE_MAX_LEN = 5000;
const NOTES_MIGRATE_CAP = 300;
// BIN-640: the addedAt repair paces the same way, for the same reason — it writes
// a concrete Date, so the echo drops those docs out of the filter and the next
// wave takes the next 300. A 5000-doc account still writes all 5000. That is the
// intended behaviour; only docs written during a dead listener need it, so it
// should be a handful in practice.
const ADDED_AT_REPAIR_CAP = 300;

function docToItem(data: Record<string, unknown>): WatchlistItem {
  const mediaType = data.mediaType as MediaType;
  const { status, dropped } = migrateStatus(data.status as string, mediaType, data.dropped as boolean | undefined);
  return {
    tmdbId: data.tmdbId as number,
    mediaType,
    status,
    rating: (data.rating as number) ?? null,
    notes: (data.notes as string) ?? null,
    title: data.title as string,
    posterPath: (data.posterPath as string) ?? null,
    releaseYear: (data.releaseYear as number) ?? null,
    totalSeasons: (data.totalSeasons as number) ?? null,
    lastWatchedSeason: (data.lastWatchedSeason as number) ?? null,
    lastWatchedEpisode: (data.lastWatchedEpisode as number) ?? null,
    dropped,
    rewatchCount: (data.rewatchCount as number) ?? 0,
    providers: (data.providers as number[]) ?? [],
    // BIN-814: absent → null, NOT [] — the advisor must be able to tell "not
    // backfilled yet" (fall back to `providers`) from "checked, covered by no
    // subscription" (a real empty answer, and a real reason to consider pausing).
    subscriptionProviders: (data.subscriptionProviders as number[] | undefined) ?? null,
    providersCheckedAt: data.providersCheckedAt ? toDate(data.providersCheckedAt) : null,
    visibility: (data.visibility as ItemVisibility) ?? null,
    genreIds: (data.genreIds as number[]) ?? [],
    tmdbStatus: (data.tmdbStatus as string) ?? null,
    runtime: (data.runtime as number | undefined) ?? null,
    nextAirDate: (data.nextAirDate as string | undefined) ?? null,
    nextAirCode: (data.nextAirCode as string | undefined) ?? null,
    nextAirProvider: (data.nextAirProvider as string | undefined) ?? null,
    nextAirUpdatedAt: data.nextAirUpdatedAt ? toDate(data.nextAirUpdatedAt) : null,
    digitalReleaseDate: (data.digitalReleaseDate as string | undefined) ?? null,
    // BIN-640: a doc added while the listener was dead has no addedAt. Resolve it
    // to the doc's own updatedAt rather than letting toDate() report "now" on
    // every load — see src/lib/watchlist/addedAt.ts.
    addedAt: resolveAddedAt(data),
    addedAtIsFallback: addedAtIsRepairable(data),
    updatedAt: toDate(data.updatedAt),
    watchedAt: data.watchedAt ? toDate(data.watchedAt) : null,
    // BIN-349: lazy — old docs have none; consumers fall back to updatedAt.
    ratedAt: data.ratedAt ? toDate(data.ratedAt) : null,
    // BIN-402: doc-level TMDB-fields freshness stamp (lazy — old docs have none).
    tmdbFieldsRefreshedAt: data.tmdbFieldsRefreshedAt ? toDate(data.tmdbFieldsRefreshedAt) : null,
  };
}

interface WatchlistState {
  items: WatchlistItem[];
  /**
   * True medan vi väntar på den första Firestore-snapshoten efter uid blivit
   * tillgängligt. Konsumenter måste skilja "watchlist är tom" från
   * "watchlist laddar fortfarande" för att inte rendera "Välkommen, lägg
   * till titlar"-state mot en användare som faktiskt har 100 serier.
   */
  loading: boolean;
  /**
   * BIN-596 — the two facts `loading` cannot express, for surfaces that WRITE.
   *
   * `loading` flips to false in BOTH terminal states: a landed snapshot AND a
   * dead listener. A writer that reads the second as "loaded, library empty"
   * treats every re-mark as a genuine new add — exactly the state BIN-601 stops
   * the add path from stamping `addedAt` into, and the one that would let a
   * cold-load "Sedd" land without a `watchedAt`. So the add surfaces
   * (StatusButton / QuickAddButton) hold their action on these two instead:
   *
   *  - `snapshotSettled` — the first snapshot for the CURRENT uid has landed, so
   *    `getItem` answers truthfully rather than "not in your library (yet)".
   *  - `listenerFailed` — the listen terminally errored. Stays true until a
   *    snapshot proves it recovered.
   *
   * `snapshotSettled` is false on a failure only when NO snapshot ever landed
   * for this uid. A listener that dies AFTER one landed leaves it true next to
   * `listenerFailed` — what we hold is simply known-stale. So "settled" alone
   * never means "safe to write": test `listenerFailed` too, which is exactly
   * what `libraryKnown` below does for you.
   *
   * Render-visible mirrors of `firstSnapshotSettledRef` / `listenerFailedRef`,
   * which stay the MUTATORS' source of truth (a ref is still correct after an
   * await; a render-closure boolean is not). Both are assigned in the same
   * callbacks as their refs with no await in between — see itemsRef.
   */
  snapshotSettled: boolean;
  listenerFailed: boolean;
  /**
   * BIN-596 — the ONE question every write surface actually has: may I trust
   * what `getItem` just told me?
   *
   * Derived (`snapshotSettled && !listenerFailed`) and exposed rather than
   * re-derived per component, because getting it wrong is silent and expensive.
   * A surface that gates on `loading` instead reopens precisely when the
   * listener has died — and `getItem` then answers "not in your library" for
   * EVERY title. `CollectionSection`'s bulk "Lägg alla osedda i vill se" would
   * hard-write `status: 'vill_se'` over up to 50 films the user had marked
   * `'sedd'`; no payload shape can protect `status`, so this gate is the only
   * defence (same argument as MoviePageClient's Bevaka CTA and CompanionSection).
   */
  libraryKnown: boolean;
  /**
   * BIN-700 — re-subscribe after a terminal listen error, so `listenerFailed` is
   * a state the user can act on rather than one they have to reload out of.
   *
   * The failed state never ends on its own (that is the whole problem — see
   * `components/title/libraryHold.ts`), so every surface that RENDERS the
   * failure offers this as its "Försök igen". It tears the subscription down and
   * starts a fresh one for the same uid: `loading` goes true again, and the next
   * outcome is either a landed snapshot or the same failure, honestly reported.
   *
   * Safe to call at any time — a retry while the listener is healthy is just a
   * re-subscribe. It deliberately does NOT reset the first_title_added
   * bookkeeping: that is keyed on the uid actually changing, because a session
   * that already added titles has not stopped having done so.
   */
  retryListener: () => void;
  /**
   * BIN-655 — the BULK/sync add. THE canonical explanation of the split lives here;
   * `WriteIntent` in src/lib/watchlistWrites.ts carries the payload-level half.
   *
   * Every caller that is REPLAYING data rather than reporting a fresh human act:
   * the CSV importer, onboarding, the Collection and Companion "add all" surfaces,
   * "Bevaka släpp", the quick-rate pass, and every non-'sedd' quick add. A
   * sedd → sedd write through this door is a RESTORE and counts nothing.
   *
   * Until BIN-655 this and `logViewing` were one function taking a
   * `countsAsViewing` boolean, and that shape cost twice — BIN-599 (the quick-rate
   * modal reached the counting path and inflated a permanent, un-editable counter
   * once per pass) and BIN-641 (the flag itself, added because the write path
   * structurally cannot see whether a human just watched something). Both were the
   * same missing distinction, patched at the call site. Now the distinction IS the
   * call site: a caller cannot arrive at the counting path by omission.
   *
   * The transition the boolean guarded is reachable today — re-picking the plain
   * 'Sedd' entry in StatusButton's menu (and QuickAddButton's identical one), which
   * is exactly the gesture Malin ruled must not count, 2026-07-31. It reaches
   * `upsertTitle` via useMarkSeen and counts nothing, and StatusButton.test pins it.
   *
   * BIN-895 — both doors RESOLVE with what the write actually did
   * (`TitleWriteOutcome`), so a caller that DESCRIBES the write to the user reads the
   * payload's own answer instead of deriving it a second time from a render closure
   * that may already be stale. Still exactly one parameter, deliberately: the outcome
   * comes BACK, intent never travels IN — that is the shape BIN-655 removed.
   */
  upsertTitle: (item: WatchlistAddPayload) => Promise<TitleWriteOutcome>;
  /**
   * BIN-655 — the HUMAN add: the user just told us they watched this.
   *
   * The ONLY path that may count a rewatch, and therefore the only one that may
   * overwrite a user-authored `watchedAt`. The two always travel together: a count
   * without a fresh date is the half-feature Malin rejected (BIN-641), so the
   * re-date gates on the counted OUTCOME rather than on the intent — intent on a
   * tracked title that is NOT 'sedd' would otherwise stomp the stored date while
   * counting nothing.
   *
   * `rewatchCount` is editable nowhere, so a wrong count is permanent. Only the
   * "Sedd igen" action reaches this. Both entry points take the SAME payload and
   * take no second argument, so intent can never leak into the document —
   * `WatchlistAddPayload` is contractually the exact key set written to Firestore
   * and firestore.rules' isValidWatchlistItem uses a `hasOnly` allowlist, where a
   * stray key either lands as junk or fails the whole merge-write with
   * permission-denied. That already bit us once, with `notes`.
   *
   * BIN-895 — resolves with `TitleWriteOutcome`; see `upsertTitle` above. This is the
   * door whose answer anyone actually needs: `countedRewatch` is true only here.
   */
  logViewing: (item: WatchlistAddPayload) => Promise<TitleWriteOutcome>;
  // BIN-560 Phase 4: every per-title mutator takes mediaType so it can (a) address
  // the namespaced doc id `mediaTypeDocId(mediaType, tmdbId)` and (b) disambiguate the
  // current-item lookup — a movie and a TV show can share a tmdbId. All call sites
  // already have mediaType in scope; the breaking signature is compiler-enforced.
  updateVisibility: (mediaType: MediaType, tmdbId: number, visibility: ItemVisibility | null) => Promise<ItemWriteOutcome>;
  updateStatus: (mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<ItemWriteOutcome>;
  updateWatchedAt: (mediaType: MediaType, tmdbId: number, watchedAt: Date) => Promise<ItemWriteOutcome>;
  updateRating: (mediaType: MediaType, tmdbId: number, rating: number | null) => Promise<ItemWriteOutcome>;
  updateNotes: (mediaType: MediaType, tmdbId: number, notes: string | null) => Promise<void>;
  /**
   * BIN-954 — `opts.addIfMissing` says "the user just told us they WATCHED this", which is
   * the only intent under which a title absent from the library may be ADDED by a progress
   * write. Ticking an episode off, or the auto-advance that follows a write we just made,
   * pass nothing. The intent cannot be derived from the position: un-ticking down to a
   * lower episode is also a non-zero position, so a derived rule would add a series on the
   * exact gesture that means the opposite.
   */
  updateProgress: (mediaType: MediaType, tmdbId: number, season: number, episode: number, opts?: { addIfMissing?: boolean }) => Promise<ItemWriteOutcome>;
  updateTmdbStatus: (mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => Promise<ItemWriteOutcome>;
  setRuntime: (mediaType: MediaType, tmdbId: number, runtime: number | null) => Promise<void>;
  // BIN-402: title-page lazy-refresh of the denormalized TMDB block + freshness
  // stamp (repopulates a swept-clean doc; keeps a viewed title from being swept).
  refreshTmdbFields: (mediaType: MediaType, tmdbId: number, fields: TmdbDenormFields) => Promise<void>;
  updateTags: (mediaType: MediaType, tmdbId: number, tags: string[]) => Promise<void>;
  removeItem: (mediaType: MediaType, tmdbId: number) => Promise<void>;
  getByStatus: (status: WatchStatus, mediaType?: MediaType) => WatchlistItem[];
  getItem: (mediaType: MediaType, tmdbId: number) => WatchlistItem | null;
}

const WatchlistContext = createContext<WatchlistState>({
  items: [],
  loading: true,
  // Default = "we know nothing yet", the same conservative reading the provider
  // starts from: a consumer rendered outside the provider must not conclude that
  // an empty library is a settled one.
  snapshotSettled: false,
  listenerFailed: false,
  libraryKnown: false,
  retryListener: () => {},
  // BIN-895: outside a provider nothing is written, so nothing was counted. The
  // default has to be a real outcome rather than `undefined` — a consumer that
  // describes the write reads this too.
  upsertTitle: async () => ({ countedRewatch: false }),
  logViewing: async () => ({ countedRewatch: false }),
  // BIN-942: outside a provider nothing is written, so nothing may be confirmed.
  updateStatus: async () => 'refused',
  updateWatchedAt: async () => 'refused',
  updateRating: async () => 'refused',
  updateNotes: async () => {},
  updateProgress: async () => 'refused',
  updateTmdbStatus: async () => 'refused',
  setRuntime: async () => {},
  refreshTmdbFields: async () => {},
  updateTags: async () => {},
  updateVisibility: async () => 'refused',
  removeItem: async () => {},
  getByStatus: () => [],
  getItem: () => null,
});

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { uid, user } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  // BIN-596: render-visible mirrors of firstSnapshotSettledRef / listenerFailedRef
  // (see the WatchlistState doc). Components cannot read a ref, and `loading`
  // collapses "snapshot landed" and "listener died" into one false.
  const [snapshotSettled, setSnapshotSettled] = useState(false);
  const [listenerFailed, setListenerFailed] = useState(false);
  // BIN-700: bumped by retryListener to force the watchlist effect to tear down
  // and re-subscribe for the SAME uid. A counter rather than a boolean so a
  // second "Försök igen" after a second failure still re-runs the effect.
  const [retryNonce, setRetryNonce] = useState(0);
  const retryListener = useCallback(() => setRetryNonce(n => n + 1), []);
  // BIN-402: `${uid}:${tmdbId}` keys of titles whose TMDB block we've lazy-refreshed
  // this session. Marked synchronously before the write so the pending-serverTimestamp
  // echo (which reads back null and would re-trip the staleness gate → write loop)
  // can't re-fire it. Keyed by uid too (mirrors nextAirReadRepair's writtenThisSession)
  // so a same-session account switch doesn't suppress the new user's refresh. Per-session.
  const refreshedThisSession = useRef<Set<string>>(new Set());
  // BIN-164: tags live in a SEPARATE owner-only subcollection (never on the
  // publicly-readable watchlist doc), so they arrive on their own subscription
  // and are joined onto items in-memory below. BIN-560 Phase 4: keyed by the
  // COMPOSITE doc id `mediaTypeDocId(mediaType, tmdbId)` (== the doc's own id), not
  // bare tmdbId — else a movie_123 and tv_123 tag doc collide onto one key.
  const [tagsByTmdbId, setTagsByTmdbId] = useState<Record<string, string[]>>({});
  // BIN-505: per-title notes now live in the owner-only watchlistNotes
  // subcollection (moved OFF the public/friends-readable watchlist doc). BIN-560
  // Phase 4: same composite-doc-id keying as tagsByTmdbId.
  const [notesByTmdbId, setNotesByTmdbId] = useState<Record<string, string>>({});
  // Session guard for the eager notes migration so a mid-run re-render can't
  // re-issue the same batch (echo-proof; mirrors refreshTmdbFields' dedup).
  // BIN-560 Phase 4: composite-keyed (mediaTypeDocId) so a movie/TV tmdbId clash
  // can't false-share the "already migrated / handled" mark.
  const migratedNotesRef = useRef<Set<string>>(new Set());
  useEffect(() => { migratedNotesRef.current = new Set(); }, [uid]);
  // BIN-640: docs this session has already attempted an addedAt repair for.
  // Marked BEFORE the write, exactly like migratedNotesRef — a repair that FAILS
  // must not be retried on every subsequent snapshot. Snapshot events fire on any
  // change in the collection, so "the field exists now" is a post-write fact and
  // would have been a retry storm, not a guard.
  const repairedAddedAtRef = useRef<Set<string>>(new Set());
  useEffect(() => { repairedAddedAtRef.current = new Set(); }, [uid]);
  // BIN-954: doc ids this session's updateProgress has already ADDED (branch B below).
  // Marked only AFTER the write resolves, unlike the two guards above — the point here is
  // not to suppress a retry but to remember that the document now EXISTS, which the
  // snapshot has not told us yet. Two calls land inside one gesture (tick the finale of a
  // completed season → the auto-advance to season+1), and without this the second one
  // re-runs the whole add: a second TMDB fetch and a second `title_added_watchlist`. A
  // FAILED add is deliberately not marked, so the next tick retries it.
  const addedByProgressRef = useRef<Set<string>>(new Set());
  useEffect(() => { addedByProgressRef.current = new Set(); }, [uid]);
  // BIN-955: the add that is running RIGHT NOW, per document — the fact `addedByProgressRef`
  // structurally cannot carry, because it is written after the write resolves and the whole
  // window this closes is the one before that. Two quick ticks on different episodes of the
  // same UNTRACKED series both pass the synchronous `known` check before either TMDB fetch
  // lands, and both then enter the add branch: two fetches, two adds, two
  // `title_added_watchlist` events for one logical add.
  //
  // Registered SYNCHRONOUSLY, before the branch's first await, so a sibling call reaching
  // its own check finds it. A resolved value rather than a bare flag, because the waiter
  // needs the add's OUTCOME: `true` means the document exists and the waiter may take the
  // ordinary merge branch; `false` means nothing was written and the merge branch would
  // CREATE the identity-less fragment BIN-954 closed — so it must not. The entry is removed
  // as the add settles, whichever way it settled, which is what keeps a failed add
  // retryable on the next tick.
  //
  // Not reset per uid, unlike its neighbours above: every key carries the uid and every
  // entry deletes itself in a `finally`, so there is nothing left to clear.
  const inFlightAddsRef = useRef<Map<string, Promise<boolean>>>(new Map());
  // BIN-954: how many removals have STARTED this session. `removeItem` pruning
  // addedByProgressRef is not enough on its own, because the two operations interleave:
  // the add marks the ref only after its write resolves, while a removal issued in that
  // window prunes a key that is not there yet and then lets the add write it back. The
  // mark would then claim a document the user has deleted, and the next progress write
  // would merge into it — the fragment again. So the add snapshots this counter before
  // its write and declines to mark if it moved. Deliberately counts ALL removals, not
  // just this title's: over-declining costs one redundant re-add on the next tick,
  // under-declining costs a ghost row on a public profile.
  const removalTickRef = useRef(0);
  // BIN-965: the SAME question the counter above answers, asked per TITLE instead of
  // per session. The counter's deliberate over-breadth is right for the session mark it
  // was built for — declining to mark costs one redundant re-add — but it cannot decide
  // whether a write goes out or what the caller is told, because then removing title A
  // would refuse title B's add and report a successful write as refused. Keyed by the
  // same `uid:docId` cacheKey as inFlightAddsRef; bumped SYNCHRONOUSLY in removeItem for
  // the reason spelled out there. Never pruned, and NOT reset per uid the way
  // addedByProgressRef is: every key carries the uid, so no account can read another's
  // entry, and dropping one would read as "never removed" — the unsafe direction. What
  // that costs is memory, in a tab that switches accounts and removes titles without
  // ever reloading: one small entry per removed title, for the life of the tab.
  const removalGenRef = useRef<Map<string, number>>(new Map());
  // Which uid the current `items` were loaded for — set by the watchlist listener
  // when a snapshot lands. The migration gates on this so it never runs against a
  // previous account's `items` during a same-session switch (cross-account guard).
  const itemsUidRef = useRef<string | null>(null);

  // first_title_added-grindning (BIN-56 + BIN-38). Den gamla grinden
  // `items.length === 0 && !loading` hade två motstridiga krav:
  //   - BIN-38: en återvändande användare som lägger till en titel UNDER kall
  //     laddning (snapshoten inte landad → items===[]) får INTE fyra eventet.
  //   - BIN-56: en helt ny användare som lägger till sin första titel UNDER
  //     kall laddning MÅSTE fyra eventet — annars tappas det för alltid (när
  //     snapshoten sen landar innehåller den ju titeln, så `items.length===0`
  //     blir aldrig sant igen).
  // Vid add-tid under kall laddning går de två fallen inte att skilja åt — vi
  // vet inte om det tomma biblioteket är "ny användare" eller "snapshot inte
  // landad än". Lösningen: skjut upp beslutet till första snapshoten har
  // settlat, istället för att gissa vid add-tid.
  //
  //  - everNonEmptyRef: har en SNAPSHOT någonsin sett ≥1 titel? Sätts av första
  //    snapshoten för en återvändande användare → deras efterföljande adds är
  //    aldrig "första".
  //  - firstSnapshotSettledRef: har första snapshoten för nuvarande uid landat?
  //  - pendingAddCountRef: hur många adds gjorde DENNA session FÖRE första
  //    snapshoten? (BIN-110) Vi räknar dem alla — inte bara den första — så att
  //    vi kan subtrahera dem från snapshotens storlek och avgöra om biblioteket
  //    var genuint tomt innan sessionen. (En enskild kandidat räckte inte: om
  //    en ny användare hann lägga till 2 titlar före snapshoten landade
  //    snapshoten med size===2, och den gamla `snap.size <= 1`-grinden tappade
  //    eventet.)
  //  - pendingFirstMediaTypeRef: mediaType för den FÖRSTA pre-snapshot-adden,
  //    för event-payloaden (en användare har bara EN första titel).
  const everNonEmptyRef = useRef(false);
  const firstSnapshotSettledRef = useRef(false);
  // BIN-601: has the watchlist listener terminally errored? Set by onSnapshot's
  // error callback, cleared by the next successful snapshot. Distinct from
  // firstSnapshotSettledRef, which stays false in that state — "we never learned
  // the contents" and "the listener is dead" call for different write decisions.
  const listenerFailedRef = useRef(false);
  // BIN-593: the snapshot's items as a LIVE ref, written in the same onSnapshot
  // callback as firstSnapshotSettledRef below. The mutators await `fsdb()` (a dynamic import
  // that can take hundreds of ms on first use) before deciding what to write, so
  // reading the render-closure `items` alongside the live settled-ref could pair
  // an EMPTY item list with settled===true when the first snapshot landed during
  // that await — resolving "unknown" to "known-absent" and stamping over a stored
  // watch date. Both must come from the same generation; refs give us the freshest.
  //
  // The pairing is upheld by both being assigned inside the SAME onSnapshot
  // callback with no await between them — not by adjacency, they sit ~28 lines
  // apart around the first_title_added bookkeeping. Anything added between them
  // must stay synchronous, or the guard silently weakens.
  const itemsRef = useRef<WatchlistItem[]>([]);
  const pendingAddCountRef = useRef(0);
  const pendingFirstMediaTypeRef = useRef<MediaType | null>(null);
  // BIN-700: which uid the CURRENT subscription was opened for. The effect below
  // now re-runs for two different reasons (a uid change and a user-triggered
  // retry), and they must not reset the same state — see inside.
  const subscribedUidRef = useRef<string | null>(null);

  useEffect(() => {
    // BIN-700: account-scoped state. A retry re-subscribes for the SAME uid, and
    // resetting these there would re-arm the first_title_added decision for a
    // session that has already added titles (the event would fire a second time
    // for the same user) and would drop `itemsRef` on the floor while every
    // mutator still reads it. Both belong to the account, not to the listener.
    if (subscribedUidRef.current !== uid) {
      subscribedUidRef.current = uid;
      everNonEmptyRef.current = false;
      itemsRef.current = [];
      pendingAddCountRef.current = 0;
      pendingFirstMediaTypeRef.current = null;
    }
    // Listener-scoped state below: a fresh subscription genuinely has not read
    // the library yet, whatever the reason it was opened.
    firstSnapshotSettledRef.current = false;
    // BIN-596: a NEW listener has not failed — the previous uid's outage says
    // nothing about this one, and leaving it set would make the add surfaces read
    // as "failed" for an account whose listener is fine. Reset with its mirror, in
    // lockstep, so the ref the mutators read and the state the buttons read can
    // never disagree. (Within one uid the flag still survives until a snapshot
    // clears it — that is BIN-601's behaviour, unchanged.)
    listenerFailedRef.current = false;
    setSnapshotSettled(false);
    setListenerFailed(false);
    if (!uid) { setItems([]); setLoading(false); return; }
    // uid bytte (sign-in eller account-switch) → tillbaka till loading
    // tills första snapshoten kommer.
    setLoading(true);
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'watchlist'), (snap) => {
        const wasFirstSnapshot = !firstSnapshotSettledRef.current;
        firstSnapshotSettledRef.current = true;
        // Väntande adds som skedde före första snapshoten: avgör nu om de var
        // en genuin förstagångs-add. Biblioteket var tomt INNAN denna session
        // iff snapshotens storlek inte överstiger antalet adds som denna
        // session gjorde före snapshoten — dvs alla titlar i snapshoten är våra
        // egna optimistiska skrivningar (`snap.size - pendingAddCount <= 0`).
        // Då är användaren ny → fyra det uppskjutna eventet en gång (BIN-56 +
        // BIN-110, fungerar även när 2+ titlar lades till före snapshoten).
        // Annars (snapshoten innehåller titlar utöver sessionens adds) →
        // återvändande användare, fyra inte (BIN-38).
        const pendingCount = pendingAddCountRef.current;
        const pendingMediaType = pendingFirstMediaTypeRef.current;
        if (pendingCount > 0 && pendingMediaType && wasFirstSnapshot) {
          pendingAddCountRef.current = 0;
          pendingFirstMediaTypeRef.current = null;
          if (snap.size - pendingCount <= 0) {
            trackEvent('first_title_added', { mediaType: pendingMediaType });
            // Stäng dörren: även om snapshoten landade tom (skrivningen ännu
            // ej round-trippad) får ingen senare add re-fyra eventet.
            everNonEmptyRef.current = true;
          }
        }
        if (snap.size > 0) everNonEmptyRef.current = true;
        // Tag these items with the uid they belong to, so the notes migration
        // never runs against a previous account's rows on a same-session switch.
        itemsUidRef.current = uid;
        const next = snap.docs.map(d => docToItem(d.data()));
        // Same onSnapshot callback as firstSnapshotSettledRef above, with no await
        // between the two assignments — so a mutator reading both refs can never
        // see "settled" paired with a pre-snapshot item list.
        itemsRef.current = next;
        setItems(next);
        // A snapshot arrived, so the listener is alive again — clear the failed
        // flag before anything can read it alongside these fresh items.
        listenerFailedRef.current = false;
        // BIN-596: the render-visible mirrors, set from the same callback as the
        // refs above. React batches these, so the buttons flip from "held" to
        // usable in one render, alongside the items they just gated on.
        setSnapshotSettled(true);
        setListenerFailed(false);
        setLoading(false);
      },
      // BIN-601: a terminal listen error. Without this the app hangs in `loading`
      // forever AND — the reason this ticket exists — `itemsRef` stays empty, so
      // every later status change looks like a genuine new add and rewrites
      // `addedAt`, silently re-dating a title that may be years old.
      //
      // `firstSnapshotSettledRef` deliberately stays FALSE: we still do not know
      // the library's contents, and the other stamp guards must keep treating it
      // as unknown rather than as empty.
      () => {
        listenerFailedRef.current = true;
        // BIN-596: and say so to the UI. Note what this does NOT do: it never
        // clears `snapshotSettled`. If a snapshot had already landed it stays
        // TRUE alongside this flag — what we hold is known-stale, not unknown.
        // That is why every write surface gates on `libraryKnown` (which folds in
        // this flag) and never on `snapshotSettled` alone.
        setListenerFailed(true);
        setLoading(false);
      }));
    // BIN-700: `retryNonce` is what makes "Försök igen" mean anything — bumping
    // it tears this subscription down and opens a new one for the same uid.
  }, [uid, retryNonce]);

  // BIN-164: parallel owner-only subscription for per-title tags. Kept separate
  // from the watchlist listener (own collection, own rules) — doc id = tmdbId,
  // shape { tags: string[] }. Empty/absent → no entry (join defaults to []).
  useEffect(() => {
    if (!uid) { setTagsByTmdbId({}); return; }
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'watchlistTags'), (snap) => {
        const map: Record<string, string[]> = {};
        snap.docs.forEach(d => {
          const tags = (d.data().tags as string[] | undefined) ?? [];
          // BIN-560 Phase 4: key by the namespaced doc id itself (movie_/tv_),
          // which is exactly `mediaTypeDocId(mediaType, tmdbId)` — the composite
          // key the in-memory join looks the entry up by. No parse needed.
          if (tags.length > 0) map[d.id] = tags;
        });
        setTagsByTmdbId(map);
      }));
  }, [uid]);

  // BIN-505: parallel owner-only subscription for per-title notes — mirrors the
  // tags listener. The collection is SPARSE (only note-bearing titles have a
  // doc), so this listener's read cost scales with the number of NOTES, not
  // library size. Empty/absent → fall back to any legacy inline note in
  // docToItem until the eager migration below moves it off.
  useEffect(() => {
    if (!uid) { setNotesByTmdbId({}); return; }
    return lazySubscribe(({ db, collection, onSnapshot }) =>
      onSnapshot(collection(db, 'users', uid, 'watchlistNotes'), (snap) => {
        const map: Record<string, string> = {};
        snap.docs.forEach(d => {
          const note = d.data().note as string | undefined;
          // BIN-560 Phase 4: key by the namespaced doc id (== composite key).
          if (note) map[d.id] = note;
        });
        setNotesByTmdbId(map);
      }));
  }, [uid]);

  // Join tags + notes onto items in-memory. Consumers read `item.tags` (default
  // []) and `item.notes`; the raw `items` state (used by the mutators'
  // current-item lookups) stays tag/note-free since mutators never need them.
  // Note source of truth: the subcollection wins; the legacy inline note
  // (docToItem) is the fallback until the item is migrated.
  const itemsWithTags = useMemo(
    () => items.map(i => {
      const key = mediaTypeDocId(i.mediaType, i.tmdbId);
      return {
        ...i,
        tags: tagsByTmdbId[key] ?? [],
        notes: notesByTmdbId[key] ?? i.notes,
      };
    }),
    [items, tagsByTmdbId, notesByTmdbId],
  );

  // BIN-505: one-pass EAGER migration — move any inline `notes` still on a
  // watchlist doc into the owner-only watchlistNotes subcollection and delete
  // the inline field atomically. Closes the leak for EXISTING notes without
  // waiting for the owner to re-edit each one (DPO #6: a known third-party-PII
  // leak must close on a bounded timeline, not lazily-on-touch). Bounded +
  // chunked (Blaze cap); sparse in practice. Self-terminating: once inline
  // notes are deleted the watchlist snapshot no longer surfaces them, so the
  // filter empties and the effect no-ops.
  useEffect(() => {
    if (!uid) return;
    // Cross-account safety: only migrate when the current `items` were loaded for
    // THIS uid. On a same-session account switch (A→B) `items` still holds A's
    // rows until B's snapshot lands; without this guard the migration would write
    // A's private notes under users/B/watchlistNotes (a cross-account PII leak).
    if (itemsUidRef.current !== uid) return;
    // BIN-816: a deletion started on this device is running (or stranded), and
    // these system repairs write users/{uid}/watchlist* with no user action at
    // all. `WatchlistProvider` sits ABOVE `AppShell`, so it stays mounted even
    // once the shell has handed over to the limbo screen — "a surface that is
    // never rendered cannot write" is true of pages, not of providers. Read
    // fresh from the marker rather than through context: this is the tab-B case,
    // where React state may not have caught up yet (ADR 0020 q3).
    if (isDeletionStarted(uid)) return;
    const legacy = items
      .filter(i => i.notes != null
        && notesByTmdbId[mediaTypeDocId(i.mediaType, i.tmdbId)] === undefined
        && !migratedNotesRef.current.has(mediaTypeDocId(i.mediaType, i.tmdbId)))
      .slice(0, NOTES_MIGRATE_CAP);
    if (legacy.length === 0) return;
    // Mark in-progress BEFORE the async write so a re-render inside the same
    // session can't re-select the same titles (echo-proof). Composite-keyed.
    legacy.forEach(i => migratedNotesRef.current.add(mediaTypeDocId(i.mediaType, i.tmdbId)));
    let cancelled = false;
    void (async () => {
      const { db, doc, writeBatch, deleteField } = await fsdb();
      for (let i = 0; i < legacy.length && !cancelled; i += 200) {
        const chunk = legacy.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const it of chunk) {
          const note = String(it.notes).slice(0, NOTE_MAX_LEN);
          // BIN-560 Phase 4: namespaced doc id + self-describing mediaType field.
          const docId = mediaTypeDocId(it.mediaType, it.tmdbId);
          batch.set(doc(db, 'users', uid, 'watchlistNotes', docId), { note, mediaType: it.mediaType });
          // Delete the inline note ONLY — never bump updatedAt. This is a
          // system-only cleanup, not user activity; a serverTimestamp here would
          // surface every migrated title as fake "activity" at the top of every
          // follower's feed (feed queries order by updatedAt). Same invariant as
          // nextAirReadRepair / refreshTmdbFields.
          batch.update(doc(db, 'users', uid, 'watchlist', docId), {
            notes: deleteField(),
          });
        }
        try { await batch.commit(); } catch { /* best-effort; retry next session */ }
      }
    })();
    return () => { cancelled = true; };
  }, [uid, items, notesByTmdbId]);

  // BIN-640 — write a real addedAt for docs that were added while the listener
  // was dead. Those docs have no stored addedAt (BIN-601 stops stamping in that
  // state, so a re-mark cannot destroy a real date), and until this runs they are
  // resolved to their own updatedAt at read time. This makes the date permanent,
  // so it survives into Firestore, the GDPR export and every server-side reader.
  //
  // Structure mirrors the notes migration above and nextAirReadRepair, not the
  // snapshot callback: its own effect keyed on `items`, its own in-progress ref
  // marked before the write, chunked writeBatch. Costs no extra READS — the
  // replacement date comes from the snapshot we already received, which is why
  // this is preferred over BIN-640's original getDoc-per-add proposal (billed per
  // add, against the 25 SEK/mån cap, and issued from a client whose reads are
  // already failing).
  useEffect(() => {
    if (!uid) return;
    // Same cross-account guard as the notes migration: on a same-session A→B
    // switch `items` still holds A's rows until B's snapshot lands.
    if (itemsUidRef.current !== uid) return;
    // BIN-816: a deletion started on this device is running (or stranded), and
    // these system repairs write users/{uid}/watchlist* with no user action at
    // all. `WatchlistProvider` sits ABOVE `AppShell`, so it stays mounted even
    // once the shell has handed over to the limbo screen — "a surface that is
    // never rendered cannot write" is true of pages, not of providers. Read
    // fresh from the marker rather than through context: this is the tab-B case,
    // where React state may not have caught up yet (ADR 0020 q3).
    if (isDeletionStarted(uid)) return;
    const missing = items
      .filter(i => i.addedAtIsFallback
        && !repairedAddedAtRef.current.has(mediaTypeDocId(i.mediaType, i.tmdbId)))
      .slice(0, ADDED_AT_REPAIR_CAP);
    if (missing.length === 0) return;
    missing.forEach(i => repairedAddedAtRef.current.add(mediaTypeDocId(i.mediaType, i.tmdbId)));
    let cancelled = false;
    void (async () => {
      const { db, doc, writeBatch } = await fsdb();
      for (let i = 0; i < missing.length && !cancelled; i += 200) {
        const chunk = missing.slice(i, i + 200);
        const batch = writeBatch(db);
        for (const it of chunk) {
          // addedAt ONLY. Never updatedAt — this is system repair, not user
          // activity, and a serverTimestamp here would surface every repaired
          // title as fake activity at the top of every follower's feed (feed
          // queries order by updatedAt). Same invariant as the notes migration,
          // nextAirReadRepair and refreshTmdbFields.
          // `update`, deliberately NOT nextAirReadRepair's set+merge, which is the
          // one place this diverges from the shape cited above. A merge-set would
          // RESURRECT a title deleted between the snapshot and this commit as a
          // ghost doc carrying only addedAt — which isValidWatchlistItem would
          // happily accept. `update` fails on a missing doc instead. The cost:
          // a batch is atomic, so one deleted title fails its whole 200-doc chunk
          // and those docs wait for the next session. Idempotent, so that is fine.
          batch.update(doc(db, 'users', uid, 'watchlist', mediaTypeDocId(it.mediaType, it.tmdbId)), {
            addedAt: it.addedAt,
          });
        }
        try { await batch.commit(); } catch { /* best-effort; retry next session */ }
      }
    })();
    return () => { cancelled = true; };
  }, [uid, items]);

  // Lazy-on-write (A4.3): re-assertera de denormaliserade synlighetsfälten
  // (effectiveVisibility + legacy isPublic-mirror) vid VARJE mutation. Gamla
  // docs som skrevs innan cascade-stämplingen får då fälten första gången
  // användaren rör titeln — ingen migrations-sweep behövs (matchar CLAUDE.md
  // lazy-migration-filosofin; orörda docs förlitar sig på läsar-fallbacken i
  // usePublicProfile). Anropas bara när item saknar per-item visibility-override.
  // BIN-598: ONE lookup idiom for the mutators. Reads the LIVE ref, never the
  // render-closure `items` — every mutator awaits `fsdb()` (a dynamic import that
  // can take hundreds of ms on first use) before deciding what to write, so by
  // then the closure can be a whole snapshot stale. itemsRef's declaration has the
  // data loss that pairing caused (BIN-593). Stable identity (`[]` deps) so the
  // mutators that use it no longer need `items` in their dep arrays: they are
  // recreated per uid, not per snapshot.
  //
  // Two mutators deliberately still read `items` — see setRuntime /
  // refreshTmdbFields below, where the per-snapshot identity is load-bearing.
  // Cross-account guard, same shape (and same reason) as the notes-migration and
  // addedAt-repair effects above: `itemsRef` is ONE shared mutable ref, so on a
  // shared device a call that started under account A can reach this line after a
  // sign-out+sign-in has already repopulated it with account B's rows. The write
  // itself still lands under A (each mutator closes over its own `uid`) — but the
  // DECISION would be made from B's data. Sharpest case: `updateNotes` reads
  // `current?.notes` to decide whether to strip A's legacy inline note, and B's
  // copy of the same title having no note would skip the strip — leaving in place
  // exactly the third-party-PII leak BIN-505 exists to close.
  //
  // Answering `undefined` on mismatch is the safe direction: every caller treats
  // "not found" as "no override / genuine new add", which re-asserts rather than
  // skips. Identity is stable per uid (not per snapshot), so the mutators still
  // keep `items` out of their dep arrays.
  const findItem = useCallback(
    (mediaType: MediaType, tmdbId: number) => {
      if (itemsUidRef.current !== uid) return undefined;
      return itemsRef.current.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    },
    [uid],
  );

  const effectiveVisibilityNow = useCallback((): { effectiveVisibility: ItemVisibility; isPublic: boolean } => {
    const eff = user?.defaultVisibility ?? 'private';
    return { effectiveVisibility: eff, isPublic: eff === 'public' };
  }, [user?.defaultVisibility]);

  // BIN-655 -- ONE write, two names. `writeTitle` is private: the exported entry points
  // differ ONLY in the intent they pass, and that intent is the whole point. A caller
  // says what it is by choosing a function, not by remembering a boolean.
  //
  // The payload itself is built by `buildAddWrite` in src/lib/watchlistWrites.ts, beside
  // the six guards it shares with `buildStatusUpdate`. Keeping it out of this file is not
  // tidiness: it is what makes the parity matrix testable without a Firebase env.
  const writeTitle = useCallback(async (
    item: WatchlistAddPayload,
    intent: WriteIntent,
  ): Promise<TitleWriteOutcome> => {
    // BIN-895: no uid, no write — so nothing was counted, and the caller may say so.
    if (!uid) return { countedRewatch: false };
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(item.mediaType, item.tmdbId));
    // BIN-593: read the LIVE ref, not the render-closure `items` -- see itemsRef's
    // declaration. This runs after `await fsdb()`, so the closure value can be a whole
    // snapshot out of date while firstSnapshotSettledRef has already flipped.
    // BIN-598: through the shared `findItem`, so the file teaches one answer.
    const current = findItem(item.mediaType, item.tmdbId);

    // first_title_added-beslut (BIN-56 + BIN-38), se ref-kommentaren ovan:
    //  - Snapshoten har redan settlat → vi vet säkert om biblioteket är tomt.
    //    Fyra direkt om inget snapshot ännu sett en titel (genuin första add).
    //  - Snapshoten har INTE settlat (kall laddning) → vi kan inte skilja ny från
    //    återvändande användare. Spara en pending-kandidat och låt första snapshoten
    //    avgöra. Fyra aldrig vid add-tid i detta läge.
    let fireFirstNow = false;
    if (firstSnapshotSettledRef.current) {
      if (!everNonEmptyRef.current) fireFirstNow = true;
      everNonEmptyRef.current = true;
    } else {
      // Kall laddning: räkna varje add (BIN-110) så snapshoten kan subtrahera
      // sessionens egna skrivningar. Behåll bara den FÖRSTA addens mediaType för
      // event-payloaden (en användare har bara EN första titel).
      pendingAddCountRef.current += 1;
      if (pendingFirstMediaTypeRef.current == null) {
        pendingFirstMediaTypeRef.current = item.mediaType;
      }
    }

    // BIN-895: the payload is held rather than passed inline, so the outcome reported
    // back is read off the BYTES that were written — not re-derived from `current` a
    // second time. Re-deriving is what put the confirmation toast and the counter in
    // disagreement, and `current` here is already the live row the toast lacked.
    const write = buildAddWrite(item, intent, {
      current,
      snapshotSettled: firstSnapshotSettledRef.current,
      listenerFailed: listenerFailedRef.current,
      visibilityFields: effectiveVisibilityNow(),
      serverTimestamp,
    });
    await setDoc(ref, write, { merge: true });
    trackEvent('title_added_watchlist', { mediaType: item.mediaType, status: item.status });
    if (fireFirstNow) {
      trackEvent('first_title_added', { mediaType: item.mediaType });
    }
    // Only after the await: a rejected write never reports a count (the caller's own
    // await rejects with it), so the toast cannot describe something Firestore refused.
    return outcomeOfAddWrite(write);
    // BIN-593: `items` is deliberately NOT a dep -- the lookup reads itemsRef, so this
    // callback no longer needs to be recreated on every snapshot.
    // BIN-595: depend on effectiveVisibilityNow (which is itself memoised on
    // user?.defaultVisibility), matching every sibling mutator.
  }, [uid, effectiveVisibilityNow, findItem]);

  /**
   * BIN-655 -- the BULK/sync write. CSV import, onboarding, Collection/Companion
   * "add all", Bevaka, the quick-rate pass, and every non-`sedd` quick add.
   *
   * Idempotent by intent: a `sedd` -> `sedd` write here is a RESTORE, never a viewing.
   * That is BIN-599 made structural -- the quick-rate modal used to reach the counting
   * path and inflate a permanent, un-editable counter once per pass.
   */
  const upsertTitle = useCallback(
    (item: WatchlistAddPayload) => writeTitle(item, 'bulk'),
    [writeTitle],
  );

  /**
   * BIN-655 -- the HUMAN write: the user just told us they watched this.
   *
   * The only path that may count a rewatch, and therefore the only one that may
   * overwrite a user-authored `watchedAt`. Both always travel together (BIN-641):
   * a count without a fresh date is the half-feature Malin rejected.
   *
   * Reached ONLY from useMarkSeen, and only when the caller passes
   * `countsAsViewing` -- today that is StatusButton's "Sedd igen" alone. A plain
   * "Sedd" is also a mark-seen gesture, and it goes to `upsertTitle` and counts
   * nothing (Malin, 2026-07-31: re-picking the status a title already has is
   * ambiguous). An earlier version of this comment said "every mark-seen surface",
   * which is the opposite of the rule, and disagreed with the caller inventory this
   * batch's own guard test asserts. StatusButton never imports this directly.
   */
  const logViewing = useCallback(
    (item: WatchlistAddPayload) => writeTitle(item, 'viewing'),
    [writeTitle],
  );

  const updateVisibility = useCallback(async (mediaType: MediaType, tmdbId: number, visibility: ItemVisibility | null) => {
    if (!uid) return 'refused';
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // visibility=null → ta bort override och fall tillbaka till profilens
    // defaultVisibility. Vi skickar bara fältet (Firestore har ingen
    // "delete field" från klienten utan deleteField; istället skriver vi
    // null och låter docToItem normalisera vid läs).
    const effective = visibility ?? user?.defaultVisibility ?? 'private';
    return guardedItemWrite('updateVisibility', () => setDoc(ref, {
      visibility,
      effectiveVisibility: effective,
      isPublic: effective === 'public',
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  }, [uid, user?.defaultVisibility]);

  const updateStatus = useCallback(async (mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => {
    if (!uid) return 'refused';
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-593: live ref, not the render closure — same reason as writeTitle above.
    const currentItem = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(currentItem) ? effectiveVisibilityNow() : {};
    const outcome = await guardedItemWrite('updateStatus', () => setDoc(ref, buildStatusUpdate(status, {
      now: serverTimestamp(),
      visFields,
      currentStatus: currentItem?.status,
      currentRewatchCount: currentItem?.rewatchCount,
      // BIN-91: backdaterat sett-datum (film). undefined → faller tillbaka på now.
      watchedAtOverride: watchedAt ? Timestamp.fromDate(watchedAt) : undefined,
      // BIN-593: tri-state — se StatusUpdateContext + resolveCurrentWatchedAt.
      currentWatchedAt: resolveCurrentWatchedAt(currentItem, firstSnapshotSettledRef.current),
    }), { merge: true }));
    // BIN-942: only a write that LANDED is a status change. The floor refuses this write when
    // the title was deleted mid-flight, and an analytics event for a status nobody has is a
    // quiet lie in the funnel — cheap to avoid, impossible to notice later.
    if (outcome === 'written') trackEvent('status_changed', { mediaType, status });
    return outcome;
    // BIN-593: reads itemsRef, so `items` is no longer a dependency (see writeTitle).
  }, [uid, effectiveVisibilityNow, findItem]);

  // BIN-154: redigera enbart sett-datumet. Får INTE gå via updateStatus(...,'sedd')
  // — det tolkas som en omtitt (rewatchFields = sedd→sedd) och räknar upp rewatchCount
  // varje gång man justerar datumet. Detta rör bara watchedAt + updatedAt.
  const updateWatchedAt = useCallback(async (mediaType: MediaType, tmdbId: number, watchedAt: Date) => {
    if (!uid) return 'refused';
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-598: live ref via findItem (was `items.find`). The date itself is the
    // caller's, so the freshness matters for ONE thing here — whether this title
    // carries a per-title privacy override. Reading a stale closure could stamp
    // the profile default over a title the user had just hidden (BIN-595's leak,
    // one mutator over).
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    return guardedItemWrite('updateWatchedAt', () => setDoc(
      ref, { watchedAt: Timestamp.fromDate(watchedAt), ...visFields, updatedAt: serverTimestamp() }, { merge: true },
    ));
  }, [uid, effectiveVisibilityNow, findItem]);

  const updateRating = useCallback(async (mediaType: MediaType, tmdbId: number, rating: number | null) => {
    if (!uid) return 'refused';
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    // BIN-143: klampa till 0–5 (watchlist-betygsskalan är 0.5–5, ×2 vid visning;
    // defense-in-depth bakom firestore.rules-gränsen) så ett buggigt anrop aldrig
    // skickar ett värde reglerna nekar.
    const safeRating = rating == null ? null : Math.max(0, Math.min(5, rating));
    // BIN-349: stamp ratedAt on set/change; clear to null on unset so a stale
    // rating-recency can't survive a cleared rating (the exact drift this fixes).
    return guardedItemWrite('updateRating', () => setDoc(ref, {
      rating: safeRating,
      ratedAt: safeRating == null ? null : serverTimestamp(),
      ...visFields,
      updatedAt: serverTimestamp(),
    }, { merge: true }));
  }, [uid, effectiveVisibilityNow, findItem]);

  // BIN-505: write the note to the OWNER-ONLY watchlistNotes subcollection and
  // atomically strip any legacy inline `notes` off the public/friends-readable
  // watchlist doc (writeBatch → no half-state where the note lives in both). The
  // watchlist doc keeps getting its visibility re-stamped (lazy-on-write) so the
  // effectiveVisibility cascade is unaffected.
  const updateNotes = useCallback(async (mediaType: MediaType, tmdbId: number, notes: string | null) => {
    if (!uid) return;
    const docId = mediaTypeDocId(mediaType, tmdbId);
    // A user-authored note is the source of truth — mark this title "handled" so
    // the eager migration can never overwrite it with a stale captured inline note.
    migratedNotesRef.current.add(docId);
    const { db, doc, writeBatch, deleteField } = await fsdb();
    const noteRef = doc(db, 'users', uid, 'watchlistNotes', docId);
    const itemRef = doc(db, 'users', uid, 'watchlist', docId);
    const trimmed = notes?.trim();
    const clean = trimmed ? trimmed.slice(0, NOTE_MAX_LEN) : null;
    // BIN-598: live ref via findItem. `current?.notes` decides whether the
    // item-doc write happens at all (the BIN-522 no-op skip), so a stale closure
    // could skip stripping an inline note that IS still there — a PII leak that
    // waits for the next session.
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    const batch = writeBatch(db);
    if (clean) batch.set(noteRef, { note: clean, mediaType });
    else batch.delete(noteRef);
    // Strip any legacy inline note + re-stamp visibility, but NEVER bump
    // updatedAt: a note now lives in the owner-only subcollection, so a note
    // edit must not surface as activity in followers' feeds (feed orders by
    // updatedAt) nor leak the timing of a private edit. BIN-522: skip the
    // item-doc write entirely when it would be a TRUE no-op — no inline note
    // to strip AND visibility already stamped — so the common case (editing a
    // note on an already-migrated title) costs one billed write, not two.
    if (current?.notes != null || Object.keys(visFields).length > 0) {
      batch.set(itemRef, { notes: deleteField(), ...visFields }, { merge: true });
    }
    try {
      await batch.commit();
    } catch (e) {
      // Un-mark on failure so a title that still carries a legacy inline note
      // isn't permanently excluded from the eager migration this session — which
      // would leave that inline note (PII) readable to friends/public until the
      // next session. The mark is only meaningful once the write has committed.
      migratedNotesRef.current.delete(docId);
      // BIN-942 — this path is NOT guarded by `guardedItemWrite`, deliberately, and it is
      // the one write the create-floor can refuse that keeps throwing. Two reasons, and the
      // second is the load-bearing one:
      //   * the item-doc write below is batched ATOMICALLY with the user's own note text in
      //     `watchlistNotes`, so a refusal discards the note they just typed — not merely a
      //     visibility stamp. A failed save must never look like a save.
      //   * `NotesBlock`'s `onChange` returns void, so nobody awaits this. The rejection
      //     surfaces as an unhandled promise rejection, which Sentry's globalHandlers already
      //     report — but untagged, indistinguishable from every other one in the app.
      // Tagging it here is what makes the dated entry's re-open trigger reachable at all
      // (#6 Data Protection, 2026-08-20). Purely additive: still rethrows, still no toast.
      captureError(e, { scope: 'watchlist', kind: 'updateNotes' });
      throw e;
    }
  }, [uid, effectiveVisibilityNow, findItem]);

  const updateProgress = useCallback(async (mediaType: MediaType, tmdbId: number, season: number, episode: number, opts?: { addIfMissing?: boolean }) => {
    if (!uid) return 'refused';
    // Progress ändrar aldrig status för en titel som REDAN finns: TV bor i 'mina'
    // (vill_se för TV är avskaffat och normaliseras vid läsning), och sub-state
    // (ej_paborjad → aktiv/ikapp) härleds — inget statusbyte behövs när ett
    // avsnitt markeras. (Gamla auto-promote-flytten vill_se→mina togs bort
    // 2026-06.) BIN-954 rör inte den regeln: den gäller den motsatta frågan, vad
    // som händer när titeln inte finns alls.
    // BIN-598: live ref via findItem — `current?.status` is forwarded to the
    // group sync below, so a stale closure syncs a status the user has since
    // changed.
    const current = findItem(mediaType, tmdbId);
    const docId = mediaTypeDocId(mediaType, tmdbId);
    const cacheKey = `${uid}:${docId}`;
    // BIN-965 — read BEFORE the first await of this gesture, and that placement is the
    // whole point. A call that ends up WAITING on someone else's in-flight add (the
    // `pendingAdd` branch below) must compare against the world as it was when the user
    // made the gesture, not as it is once the wait ends: a removal that lands during the
    // wait has to be visible to it. Snapshotting inside the add branch instead reads the
    // post-removal value, and the waiter then cheerfully re-adds the title just deleted.
    const removalGenAtStart = removalGenRef.current.get(cacheKey) ?? 0;
    // BIN-954. Three separate facts decide what this write is allowed to be:
    //   * `current`      — the title is in the library, as of the last snapshot.
    //   * the ref        — WE added it moments ago and the snapshot hasn't landed yet.
    //     Both count as "the document exists"; only the second survives inside a single
    //     gesture, and the auto-advance in useEpisodeProgressWithSync is exactly that case.
    //   * `libraryKnown` — the first snapshot has settled AND the listener is alive, so
    //     "absent from `items`" really means "absent from Firestore". Read off the same two
    //     refs writeTitle uses, not the derived `libraryKnown` state, which is computed
    //     below this callback and would drag a new dependency into it.
    const known = current != null || addedByProgressRef.current.has(cacheKey);
    const libraryKnown = isLibraryKnown(firstSnapshotSettledRef.current, listenerFailedRef.current);
    // BIN-955: a fourth fact, and the only one that is not synchronous — is an add for this
    // exact document already running? Consulted only when the three above say "absent", so
    // a title we already know about is never made to wait. `.catch(() => false)` because the
    // add's own caller owns its rejection (the BIN-954 test drives a refused write and
    // asserts updateProgress rejects); a waiter must read a failed add as "the document does
    // not exist", not inherit an error belonging to a different gesture.
    const pendingAdd = known ? undefined : inFlightAddsRef.current.get(cacheKey);
    const documentExists = pendingAdd ? await pendingAdd.catch(() => false) : known;
    // What the group sync should say the status is. `null` = we don't know, unchanged.
    let syncStatus: WatchStatus | null = current?.status ?? null;
    // BIN-942: did the LIBRARY document end up reflecting this call? Three ways it can be
    // 'refused' here, and they are all honestly "no": the floor denied the merge, the TMDB
    // fetch failed so the add never happened, or there was deliberately nothing to write.
    // Starts pessimistic so the branch that writes nothing needs no assignment to be truthful.
    let outcome: ItemWriteOutcome = 'refused';

    if (documentExists || !libraryKnown) {
      // The ordinary write. The second half of that condition is a deliberate
      // fall-through: during a cold load (or a dead listener) "not in `items`" and "not in
      // Firestore" are indistinguishable, and guessing "add it" there could rewrite the
      // status of a series the user had set to 'avbruten'. The residual — a merge that
      // turns out to be a create — is the race BIN-942's create-floor refuses and logs.
      const { db, doc, setDoc, serverTimestamp } = await fsdb();
      const ref = doc(db, 'users', uid, 'watchlist', docId);
      const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
      outcome = await guardedItemWrite('updateProgress', () => setDoc(ref, {
        lastWatchedSeason: season,
        lastWatchedEpisode: episode,
        ...visFields,
        updatedAt: serverTimestamp(),
      }, { merge: true }));
    } else if (opts?.addIfMissing && mediaType === 'tv') {
      // Malin, 2026-08-20: ticking an episode of a series you don't follow means you ARE
      // watching it, so the series is added properly — title, poster, year, status — rather
      // than hidden or deferred. Goes through the ordinary add door (upsertTitle →
      // buildAddWrite) so addedAt, the visibility stamp, `dropped` and the analytics events
      // take the exact shape every other add surface produces; there is no second write
      // path. The position rides along in the SAME write, so the gesture still costs one
      // Firestore write, not two.
      // Snapshotted BEFORE the first await, so any removal that starts while this add is
      // in flight is visible to the mark check below.
      const removalTickAtStart = removalTickRef.current;
      // BIN-955: the whole add — fetch, write, session mark — as ONE promise, created
      // and registered BEFORE its first await so a concurrent tick on the same untracked
      // series waits for THIS outcome instead of starting an add of its own. It resolves
      // `true` only when the document really exists, so a waiter can never be sent down
      // the merge branch against a document that was never created.
      const addPromise = (async (): Promise<boolean> => {
        // BIN-965 — the cheap half of the same guard. A call that reaches this branch
        // only AFTER waiting on someone else's add (whose promise resolved "does not
        // exist") is entering it on a stale reading of the world, so it must not spend a
        // TMDB fetch to arrive at the answer the check before the write would give it
        // anyway. The check below is still required — it covers a removal that starts
        // DURING the fetch, which this one cannot see.
        if ((removalGenRef.current.get(cacheKey) ?? 0) !== removalGenAtStart) return false;
        let payload: WatchlistAddPayload | null = null;
        try {
          // A one-shot imperative fetch, not a query: it runs only on this cold branch, so
          // it is deliberately NOT routed through queryClient.fetchQuery the way
          // useMarkSeen's is. Doing that would give WatchlistProvider — which sits above
          // most of the app — a hard dependency on a QueryClientProvider being mounted
          // above IT, for a cache neither reachable caller (season page, show page) has
          // warmed: the show page holds ['tv', id], the full response, not this lite key.
          //
          // DECISION (BIN-955): still not adopted, and the case for it is now weaker. The
          // one real argument was that `fetchQuery` de-duplicates concurrent identical
          // fetches — which is the double-add above, and `inFlightAddsRef` closes it here,
          // at the gesture rather than at the cache. The costs it would add are unchanged.
          const { getTVShowLite, extractYear } = await import('@/lib/tmdb/client');
          const show = await getTVShowLite(tmdbId);
          payload = buildWatchlistAddPayload({
            tmdbId,
            mediaType: 'tv',
            // The status a newly tracked TV title starts in, and the one the "sedd"
            // shortcut also lands as (useMarkSeen). NOT the only status a TV title can be
            // stored under — 'avbruten' is a real stored TV status StatusButton writes
            // (watchStatus.ts: TV_STATUS_OPTIONS is ['mina','sedd','avbruten']). Reaching
            // this branch means the title is absent from the library, so there is no stored
            // status to disagree with. 'vill_se' for TV was abolished 2026-06.
            status: 'mina',
            title: preferOriginalTitle(show.name, show.original_name),
            posterPath: show.poster_path ?? null,
            releaseYear: extractYear(show.first_air_date),
            totalSeasons: show.number_of_seasons ?? null,
            genreIds: show.genres?.map(g => g.id) ?? [],
            tmdbStatus: show.status ?? null,
            lastWatchedSeason: season,
            lastWatchedEpisode: episode,
            // Empty, not omitted, and not populated. Empty because buildAddPayload's own
            // contract says a genuine NEW add supplies it explicitly so the created doc
            // satisfies WatchlistItem's non-optional array types; not populated because
            // shouldStampProvidersAtAdd needs a NON-EMPTY `providers` to stamp
            // providersCheckedAt, and leaving that stamp absent is what keeps the row
            // reading as stale so the next title-page view refills the pair
            // (planTmdbFieldsRefresh). That is the self-correcting direction BIN-468/814
            // chose; a half-stamped row would sit on the broad fallback for 60 days.
            //
            // `subscriptionProviders` is OMITTED rather than `[]`, and the asymmetry is the
            // point: docToItem reads absent as "never backfilled" and `[]` as "checked,
            // nothing covers it". This surface checked nothing, so it must not claim the
            // second. (An earlier version of this comment also enumerated which other add
            // surfaces do and don't supply the subset. Both halves of that enumeration were
            // wrong when counted; the rule above needs no census to stand.)
            providers: [],
          });
        } catch (err) {
          // No title data means no honest document, and writing the fragment anyway IS the
          // bug this branch exists to close. So nothing is written here — the episode tick
          // itself lands in `episodeProgress` (a separate doc, written in parallel by
          // useEpisodeProgressWithSync), leaving the series un-added until the next tick.
          // Nothing is marked in addedByProgressRef, which is what makes that retry work.
          captureError(err, { scope: 'watchlist', kind: 'updateProgress-add' });
        }
        if (!payload) return false;
        // BIN-965 — the last synchronous moment before the write, and the guard that
        // actually protects the document. The TMDB fetch above takes seconds, and
        // Firestore makes "Ta bort" clickable the instant a pending write is issued, so a
        // removal completing inside that window was previously followed by this add
        // writing the title back — a FULL payload (tmdbId, mediaType, status, title,
        // addedAt), so BIN-942's required-field floor passes it and the series the user
        // just deleted reappears in the library. Reporting that correctly afterwards is
        // not a fix; the write must not happen. Returning `false` also keeps a waiter off
        // the merge branch — the same answer, for the same reason.
        if ((removalGenRef.current.get(cacheKey) ?? 0) !== removalGenAtStart) return false;
        // BIN-1011 — the OTHER deleting actor, and the reason the generation counter
        // above cannot see it. `removalGenRef` only knows about removals that went
        // through `removeItem`; `src/lib/firebase/accountDeletion.ts` deletes every
        // watchlist document via its own cascade and bumps nothing. Read fresh here,
        // never snapshotted at the top of the gesture: `deleteAccount` puts the marker
        // down BEFORE the cascade runs, so an add whose TMDB fetch is still in flight
        // learns about it at exactly this moment. Same argument the notes migration and
        // the addedAt repair already make — a write that can outlive the click that
        // started it must re-ask.
        //
        // The cost of missing it is worse here than the leftover row BIN-965 accepts:
        // that row is self-owned and re-deletable with the same button, whereas once
        // `deleteUser()` succeeds this uid has no Auth account at all, and the orphan
        // sweep looks for Auth accounts WITHOUT a profile — so nothing ever finds it.
        // A residual remains (a write that clears this check microseconds before the
        // cascade's delete lands), and it is deliberately NOT chased with a
        // compensating delete — BIN-965 decided that question.
        if (isDeletionStarted(uid)) return false;
        await upsertTitle(payload);
        // AFTER the write resolves, not before: this marks "the document exists now", and
        // a failed add must stay retryable. Marking BEFORE the write would be worse, not
        // better: a second call would then take the merge branch against a document that
        // does not exist yet, creating exactly the fragment this branch closes. What the
        // ordering does NOT cover is a second call arriving inside this window — that is
        // what `inFlightAddsRef` is for (BIN-955); this mark is what carries the fact
        // onwards once the in-flight entry is gone, for the auto-advance and for every
        // later tick until the snapshot lands.
        //
        // ...and it only marks if no removal STARTED while the write was in flight. The
        // optimistic snapshot makes "Ta bort" clickable the moment the add's setDoc is
        // issued, well before it resolves, so removeItem's own prune can run first and
        // find nothing to prune. Without this check the mark lands afterwards and outlives
        // the document it describes.
        if (removalTickRef.current === removalTickAtStart) {
          addedByProgressRef.current.add(cacheKey);
        }
        // BIN-965 — the RESIDUAL window, and deliberately a different question from the
        // mark above. The check before the write cannot cover a removal that starts after
        // it: `removeItem` bumps synchronously and then awaits its own delete, so the two
        // round trips can land either way round. Per-title, not the session counter — an
        // unrelated title's removal must not turn a successful add into 'refused'.
        //
        // DECIDED (BIN-965): the leftover row is NOT swept up by deleting what we just
        // wrote. A compensating delete that misfires destroys a title the user re-added in
        // the same breath; a stray row destroys nothing. The asymmetry decides this, not
        // the odds — do not "complete" the fix with that delete.
        return (removalGenRef.current.get(cacheKey) ?? 0) === removalGenAtStart;
      })();
      inFlightAddsRef.current.set(cacheKey, addPromise);
      try {
        if (await addPromise) {
          outcome = 'written';
          syncStatus = 'mina';
        }
      } finally {
        // Removed however it settled — a failed add must be retryable on the next tick, so
        // the entry may never outlive its own promise. The identity check keeps this
        // cleanup from dropping a LATER add's entry for the same document.
        if (inFlightAddsRef.current.get(cacheKey) === addPromise) {
          inFlightAddsRef.current.delete(cacheKey);
        }
      }
    }
    // else — the title is known-absent and this is not a watch gesture (un-ticking, or the
    // auto-advance after a write we made). Nothing to update, and a merge-write here would
    // CREATE the fragment: a doc with no tmdbId, no mediaType, no status and no title,
    // which renders as an empty row in the library and on the public profile and which
    // removeItem cannot even target (its delete key is built from those same absent
    // fields). So: no write at all.

    // Fire-and-forget: sync progress till alla grupper jag är medlem i där
    // titeln finns. Block:ar inte UI:n om en grupp är flaky — fel slukas i
    // syncProgressToGroups. Körs på ALLA grenar, även den som inte skriver något:
    // en serie som saknas i det egna biblioteket kan ändå ha progress värd att synka
    // till en grupp. Efter BIN-954 är det AVBOCKNINGSvägen som når det läget — en
    // bockning i en gruppkontext (SeasonPageClient med ?fromGroup=) lägger numera till
    // serien i det egna biblioteket som 'mina', enligt Malins beslut 2026-08-20.
    void import('@/lib/firebase/groups').then(({ syncProgressToGroups }) =>
      syncProgressToGroups({
        uid,
        mediaType,
        tmdbId,
        lastWatchedSeason: season,
        lastWatchedEpisode: episode,
        status: syncStatus,
      }),
    );
    return outcome;
  }, [uid, effectiveVisibilityNow, findItem, upsertTitle]);

  const updateTmdbStatus = useCallback(async (mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => {
    if (!uid) return 'refused';
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-598: live ref via findItem — same privacy reason as updateWatchedAt.
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    return guardedItemWrite('updateTmdbStatus', () => setDoc(
      ref, { tmdbStatus, ...visFields, updatedAt: serverTimestamp() }, { merge: true },
    ));
  }, [uid, effectiveVisibilityNow, findItem]);

  // BIN-93: lazy runtime backfill from title-detail views. Writes only when the
  // title is already in the library and runtime is still unknown — and never
  // bumps updatedAt (it's a silent denormalisation, not a user edit, so it must
  // not reorder "senast ändrad").
  //
  // BIN-598: this one and refreshTmdbFields below deliberately KEEP the
  // render-closure `items` (and `items` in their deps) while every other mutator
  // moved to findItem. The per-snapshot identity is not incidental here, it is the
  // reactivity: MoviePageClient/TVShowPageClient call these from an effect that
  // depends on the function itself, so a title the visitor adds WHILE reading its
  // page gets its runtime + TMDB block backfilled on the resulting snapshot. Make
  // the identity stable and that backfill waits for the next visit — the round-3
  // regression this sweep is explicitly told not to re-introduce. Migrating them
  // means changing those two page effects in the same diff; it is not a
  // WatchlistContext-only edit. Both read `current` only to SKIP a write, so a
  // stale closure costs a no-op, never a wrong write.
  const setRuntime = useCallback(async (mediaType: MediaType, tmdbId: number, runtime: number | null) => {
    if (!uid || runtime == null) return;
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    if (!current || current.runtime != null) return;
    const { db, doc, setDoc } = await fsdb();
    // Best-effort denormalisering: anropas fire-and-forget (`void setRuntime`)
    // från titelsidor. Ett avslag (t.ex. en token som tillfälligt desynkat) får
    // INTE bubbla upp som en ofångad promise-rejection → Sentry-brus. Sväljs
    // tyst; nästa titelvisning försöker igen.
    try {
      await setDoc(doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId)), { runtime }, { merge: true });
    } catch (err) {
      // BIN-957 — `console.error` + `captureError`, the form the six guarded edit paths
      // got in BIN-942. A `console.warn` here was WORSE than not catching at all: Sentry's
      // default `globalHandlers` integration reports an unhandled rejection and
      // `initSentry()` never overrides `defaultIntegrations`, but nothing in this app reads
      // the console. So the catch removed the only report this failure had.
      //
      // DECISION (BIN-957): the catch stays BROAD — deliberately NOT narrowed to
      // `isPermissionDenied` the way the six were. Those had a caller that could confirm a
      // write in words; this one is fire-and-forget (`void setRuntime(...)` from a title
      // page), so re-throwing anything makes an unhandled rejection out of a failure the
      // user cannot act on, and the next title view retries regardless. What was missing
      // was the REPORT, not the swallow. The same reasoning covers `refreshTmdbFields`
      // below and both catch sites in `flushNextAirWrites`.
      console.error('[watchlist] runtime-backfill misslyckades:', err);
      captureError(err, { scope: 'watchlist', kind: 'setRuntime' });
    }
  }, [uid, items]);

  // BIN-402 lazy-refresh (read-side complement to the ToS sweep). Called
  // fire-and-forget (`void refreshTmdbFields`) from title pages, which already have
  // the fresh TMDB detail (no extra request). Re-writes the denormalized TMDB block
  // + freshness stamp ONLY for a library title whose stamp is absent (swept clean /
  // never stamped) or older than the refresh interval — so it repopulates a swept
  // doc and keeps a viewed title from ever reaching the sweep's 5-month clear line.
  // NEVER bumps updatedAt (continueWatching sorts on it). Swallows failures like
  // setRuntime — best-effort, next view retries.
  const refreshTmdbFields = useCallback(async (mediaType: MediaType, tmdbId: number, fields: TmdbDenormFields) => {
    if (!uid) return;
    // Echo-proof dedupe (keyed by uid so an account switch doesn't suppress the new
    // user): once written this session, never re-fire — the pending serverTimestamp
    // reads back null and would otherwise re-trip the gate.
    const dedupeKey = `${uid}:${mediaTypeDocId(mediaType, tmdbId)}`;
    if (refreshedThisSession.current.has(dedupeKey)) return;
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    if (!current) return; // only titles in the library carry the stamp / get swept
    // BIN-468: the static group and the providers group are gated INDEPENDENTLY —
    // a stale providers group must repair even when the static stamp is fresh
    // (DBA decoupling), and providers are written only as a fallback so a fresher
    // advisor value is never clobbered. Decide synchronously so the session dedupe
    // is marked BEFORE any await (echo-proof — the pending serverTimestamp reads
    // back null and would otherwise re-trip the gate).
    const now = Date.now();
    const staticNeeded = needsTmdbFieldsRefresh(current.tmdbFieldsRefreshedAt, now);
    const providersNeeded = fields.providers != null && needsProvidersRefresh(current.providersCheckedAt, now);
    if (!staticNeeded && !providersNeeded) return;
    refreshedThisSession.current.add(dedupeKey); // mark BEFORE the await — synchronous, echo-independent
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    // Build the per-group merge payload (static fields + tmdbFieldsRefreshedAt when
    // stale; providers + providersCheckedAt only as the fallback). Never updatedAt.
    const payload = planTmdbFieldsRefresh(
      { tmdbFieldsRefreshedAt: current.tmdbFieldsRefreshedAt, providersCheckedAt: current.providersCheckedAt },
      fields,
      now,
      serverTimestamp(),
    );
    if (!payload) return; // gated above; defensive
    try {
      await setDoc(doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId)), payload, { merge: true });
    } catch (err) {
      // BIN-957 — reported rather than only logged; broad catch kept. Both halves of that
      // choice are argued at `setRuntime`'s catch above.
      console.error('[watchlist] tmdb-fields lazy-refresh misslyckades:', err);
      captureError(err, { scope: 'watchlist', kind: 'refreshTmdbFields' });
    }
  }, [uid, items]);

  const removeItem = useCallback(async (mediaType: MediaType, tmdbId: number) => {
    if (!uid) return;
    // BIN-1012 — derived ONCE, for the whole function. Both caches this function
    // invalidates key on `uid:docId`, and until now each rebuilt the formula for itself.
    // That is precisely how a guard goes missing: the two stop being the same key and
    // nothing says so. `mediaTypeDocId` is pure and synchronous, so deriving it here puts
    // no await between the top of this function and the bump below — the ordering
    // invariant that follows is untouched.
    const docId = mediaTypeDocId(mediaType, tmdbId);
    const docKey = `${uid}:${docId}`;
    // BIN-954: bumped SYNCHRONOUSLY, before any await, so an add already in flight sees
    // that a removal happened even when this function's own prune below runs first and
    // finds nothing. See removalTickRef's declaration for why the add cannot simply
    // re-check `items`.
    removalTickRef.current += 1;
    // BIN-965 — bumped in the same synchronous breath, never after an await: the add path
    // reads it to decide whether its write may still go out at all.
    removalGenRef.current.set(docKey, (removalGenRef.current.get(docKey) ?? 0) + 1);
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'users', uid, 'watchlist', docId));
    // BIN-593: drop it from the live ref immediately — REQUIRED, not defensive.
    // The snapshot echo can take a moment (and this function awaits two more
    // deletes before returning). Until it lands, both add-time guards would read
    // the deleted row as a still-present title: the watchedAt guard reads it as
    // proof a date is stored, and the addedAt guard reads it as a re-mark. A
    // remove-then-re-add-as-'sedd' in that window would therefore create a fresh
    // doc with NO watch date AND no addedAt — the latter sorts nowhere and never
    // recovers. Pinned by "a title removed then immediately re-added as sedd gets
    // a FRESH date" in WatchlistContext.test.tsx; deleting these lines fails it.
    itemsRef.current = itemsRef.current.filter(
      i => !(i.tmdbId === tmdbId && i.mediaType === mediaType),
    );
    // BIN-954, and REQUIRED for the same reason as the prune above — this is the SECOND
    // cache of "this document exists", and a stale one here is worse than a stale
    // itemsRef. updateProgress reads it as proof the doc is there, so a series added by
    // ticking an episode and then removed in the same session would send every later
    // progress write down the merge branch against a document that no longer exists,
    // re-creating the identity-less fragment this ticket removed — on the add-then-undo
    // sequence a user is most likely to perform. Pinned by "a series added by ticking and
    // then removed does not resurrect as a fragment" in WatchlistContext.test.tsx.
    addedByProgressRef.current.delete(docKey);
    // Best-effort: drop the sibling tags + notes docs so they never orphan
    // (their own owner-only collections aren't cascaded by the watchlist delete).
    try {
      await deleteDoc(doc(db, 'users', uid, 'watchlistTags', docId));
    } catch { /* no tags doc for this title — fine */ }
    try {
      await deleteDoc(doc(db, 'users', uid, 'watchlistNotes', docId));
    } catch { /* no notes doc for this title — fine */ }
  }, [uid]);

  // BIN-164: write the owner-only tags doc. normalizeTags enforces the per-tag
  // length + dedup + count caps (the rules bound the array size server-side but
  // can't iterate elements). Empty result → delete the doc rather than store [].
  const updateTags = useCallback(async (mediaType: MediaType, tmdbId: number, tags: string[]) => {
    if (!uid) return;
    const clean = normalizeTags(tags);
    const { db, doc, setDoc, deleteDoc } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlistTags', mediaTypeDocId(mediaType, tmdbId));
    if (clean.length === 0) { await deleteDoc(ref); return; }
    // Full replace — the doc carries `tags` + the self-describing `mediaType`
    // (BIN-560 Phase 4; the Phase-3 rules allow the optional mediaType field).
    await setDoc(ref, { tags: clean, mediaType });
  }, [uid]);

  const getByStatus = useCallback((status: WatchStatus, mediaType?: MediaType) => {
    return itemsWithTags.filter(i => i.status === status && (!mediaType || i.mediaType === mediaType));
  }, [itemsWithTags]);

  const getItem = useCallback((mediaType: MediaType, tmdbId: number) => {
    return itemsWithTags.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType) ?? null;
  }, [itemsWithTags]);

  // Derived HERE, not per consumer — see the `libraryKnown` doc on WatchlistState
  // for why re-deriving it at each write surface is how the gate goes missing.
  const libraryKnown = isLibraryKnown(snapshotSettled, listenerFailed);

  const value = useMemo(() => ({
    items: itemsWithTags, loading, snapshotSettled, listenerFailed, libraryKnown, retryListener, upsertTitle, logViewing, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, refreshTmdbFields, updateTags, updateVisibility, removeItem, getByStatus, getItem,
  }), [itemsWithTags, loading, snapshotSettled, listenerFailed, libraryKnown, retryListener, upsertTitle, logViewing, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, refreshTmdbFields, updateTags, updateVisibility, removeItem, getByStatus, getItem]);

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
