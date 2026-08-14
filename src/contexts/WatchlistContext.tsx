'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { resolveAddedAt, addedAtIsRepairable } from '@/lib/watchlist/addedAt';
import { needsTmdbFieldsRefresh, needsProvidersRefresh, planTmdbFieldsRefresh, type TmdbDenormFields } from '@/lib/watchlist/tmdbFieldsRefresh';
import type { WatchlistAddPayload } from '@/lib/watchlist/buildAddPayload';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { migrateStatus } from '@/lib/watchStatus.migration';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { isDeletionStarted } from '@/lib/deletionMarker';
import { buildStatusUpdate, normalizeTags, resolveCurrentWatchedAt, shouldStampVisibility, buildAddWrite, type WriteIntent } from '@/lib/watchlistWrites';
import type { ItemVisibility, WatchlistItem, WatchStatus, MediaType } from '@/types';

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
   */
  upsertTitle: (item: WatchlistAddPayload) => Promise<void>;
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
   */
  logViewing: (item: WatchlistAddPayload) => Promise<void>;
  // BIN-560 Phase 4: every per-title mutator takes mediaType so it can (a) address
  // the namespaced doc id `mediaTypeDocId(mediaType, tmdbId)` and (b) disambiguate the
  // current-item lookup — a movie and a TV show can share a tmdbId. All call sites
  // already have mediaType in scope; the breaking signature is compiler-enforced.
  updateVisibility: (mediaType: MediaType, tmdbId: number, visibility: ItemVisibility | null) => Promise<void>;
  updateStatus: (mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<void>;
  updateWatchedAt: (mediaType: MediaType, tmdbId: number, watchedAt: Date) => Promise<void>;
  updateRating: (mediaType: MediaType, tmdbId: number, rating: number | null) => Promise<void>;
  updateNotes: (mediaType: MediaType, tmdbId: number, notes: string | null) => Promise<void>;
  updateProgress: (mediaType: MediaType, tmdbId: number, season: number, episode: number) => Promise<void>;
  updateTmdbStatus: (mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => Promise<void>;
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
  upsertTitle: async () => {},
  logViewing: async () => {},
  updateStatus: async () => {},
  updateWatchedAt: async () => {},
  updateRating: async () => {},
  updateNotes: async () => {},
  updateProgress: async () => {},
  updateTmdbStatus: async () => {},
  setRuntime: async () => {},
  refreshTmdbFields: async () => {},
  updateTags: async () => {},
  updateVisibility: async () => {},
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
  const writeTitle = useCallback(async (item: WatchlistAddPayload, intent: WriteIntent) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(item.mediaType, item.tmdbId));
    // BIN-593: read the LIVE ref, not the render-closure `items` -- see itemsRef's
    // declaration. This runs after `await fsdb()`, so the closure value can be a whole
    // snapshot out of date while firstSnapshotSettledRef has already flipped.
    // BIN-598: through the shared `findItem`, so the file teaches one answer.
    const current = findItem(item.mediaType, item.tmdbId);

    // first_title_added-beslut (BIN-56 + BIN-38), se ref-kommentaren ovan:
    //  - Snapshoten har redan settlat -> vi vet sakert om biblioteket ar tomt.
    //    Fyra direkt om inget snapshot annu sett en titel (genuin forsta add).
    //  - Snapshoten har INTE settlat (kall laddning) -> vi kan inte skilja ny fran
    //    atervandande anvandare. Spara en pending-kandidat och lat forsta snapshoten
    //    avgora. Fyra aldrig vid add-tid i detta lage.
    let fireFirstNow = false;
    if (firstSnapshotSettledRef.current) {
      if (!everNonEmptyRef.current) fireFirstNow = true;
      everNonEmptyRef.current = true;
    } else {
      // Kall laddning: rakna varje add (BIN-110) sa snapshoten kan subtrahera
      // sessionens egna skrivningar. Behall bara den FORSTA addens mediaType for
      // event-payloaden (en anvandare har bara EN forsta titel).
      pendingAddCountRef.current += 1;
      if (pendingFirstMediaTypeRef.current == null) {
        pendingFirstMediaTypeRef.current = item.mediaType;
      }
    }

    await setDoc(ref, buildAddWrite(item, intent, {
      current,
      snapshotSettled: firstSnapshotSettledRef.current,
      listenerFailed: listenerFailedRef.current,
      visibilityFields: effectiveVisibilityNow(),
      serverTimestamp,
    }), { merge: true });
    trackEvent('title_added_watchlist', { mediaType: item.mediaType, status: item.status });
    if (fireFirstNow) {
      trackEvent('first_title_added', { mediaType: item.mediaType });
    }
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
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // visibility=null → ta bort override och fall tillbaka till profilens
    // defaultVisibility. Vi skickar bara fältet (Firestore har ingen
    // "delete field" från klienten utan deleteField; istället skriver vi
    // null och låter docToItem normalisera vid läs).
    const effective = visibility ?? user?.defaultVisibility ?? 'private';
    await setDoc(ref, {
      visibility,
      effectiveVisibility: effective,
      isPublic: effective === 'public',
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [uid, user?.defaultVisibility]);

  const updateStatus = useCallback(async (mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-593: live ref, not the render closure — same reason as writeTitle above.
    const currentItem = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(currentItem) ? effectiveVisibilityNow() : {};
    await setDoc(ref, buildStatusUpdate(status, {
      now: serverTimestamp(),
      visFields,
      currentStatus: currentItem?.status,
      currentRewatchCount: currentItem?.rewatchCount,
      // BIN-91: backdaterat sett-datum (film). undefined → faller tillbaka på now.
      watchedAtOverride: watchedAt ? Timestamp.fromDate(watchedAt) : undefined,
      // BIN-593: tri-state — se StatusUpdateContext + resolveCurrentWatchedAt.
      currentWatchedAt: resolveCurrentWatchedAt(currentItem, firstSnapshotSettledRef.current),
    }), { merge: true });
    trackEvent('status_changed', { mediaType, status });
    // BIN-593: reads itemsRef, so `items` is no longer a dependency (see writeTitle).
  }, [uid, effectiveVisibilityNow, findItem]);

  // BIN-154: redigera enbart sett-datumet. Får INTE gå via updateStatus(...,'sedd')
  // — det tolkas som en omtitt (rewatchFields = sedd→sedd) och räknar upp rewatchCount
  // varje gång man justerar datumet. Detta rör bara watchedAt + updatedAt.
  const updateWatchedAt = useCallback(async (mediaType: MediaType, tmdbId: number, watchedAt: Date) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-598: live ref via findItem (was `items.find`). The date itself is the
    // caller's, so the freshness matters for ONE thing here — whether this title
    // carries a per-title privacy override. Reading a stale closure could stamp
    // the profile default over a title the user had just hidden (BIN-595's leak,
    // one mutator over).
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    await setDoc(ref, { watchedAt: Timestamp.fromDate(watchedAt), ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, effectiveVisibilityNow, findItem]);

  const updateRating = useCallback(async (mediaType: MediaType, tmdbId: number, rating: number | null) => {
    if (!uid) return;
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
    await setDoc(ref, {
      rating: safeRating,
      ratedAt: safeRating == null ? null : serverTimestamp(),
      ...visFields,
      updatedAt: serverTimestamp(),
    }, { merge: true });
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
      throw e;
    }
  }, [uid, effectiveVisibilityNow, findItem]);

  const updateProgress = useCallback(async (mediaType: MediaType, tmdbId: number, season: number, episode: number) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // Progress ändrar aldrig status: TV bor redan i 'mina' (vill_se för TV är
    // avskaffat och normaliseras vid läsning), och sub-state (ej_paborjad →
    // aktiv/ikapp) härleds — inget statusbyte behövs när första avsnittet
    // markeras. (Gamla auto-promote-flytten vill_se→mina togs bort 2026-06.)
    // BIN-598: live ref via findItem — `current?.status` is forwarded to the
    // group sync below, so a stale closure syncs a status the user has since
    // changed.
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    await setDoc(ref, {
      lastWatchedSeason: season,
      lastWatchedEpisode: episode,
      ...visFields,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    // Fire-and-forget: sync progress till alla grupper jag är medlem i där
    // titeln finns. Block:ar inte UI:n om en grupp är flaky — fel slukas i
    // syncProgressToGroups.
    void import('@/lib/firebase/groups').then(({ syncProgressToGroups }) =>
      syncProgressToGroups({
        uid,
        mediaType,
        tmdbId,
        lastWatchedSeason: season,
        lastWatchedEpisode: episode,
        status: current?.status ?? null,
      }),
    );
  }, [uid, effectiveVisibilityNow, findItem]);

  const updateTmdbStatus = useCallback(async (mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // BIN-598: live ref via findItem — same privacy reason as updateWatchedAt.
    const current = findItem(mediaType, tmdbId);
    const visFields = shouldStampVisibility(current) ? effectiveVisibilityNow() : {};
    await setDoc(ref, { tmdbStatus, ...visFields, updatedAt: serverTimestamp() }, { merge: true });
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
      console.warn('[watchlist] runtime-backfill misslyckades:', err);
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
      console.warn('[watchlist] tmdb-fields lazy-refresh misslyckades:', err);
    }
  }, [uid, items]);

  const removeItem = useCallback(async (mediaType: MediaType, tmdbId: number) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    const docId = mediaTypeDocId(mediaType, tmdbId);
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
  const libraryKnown = snapshotSettled && !listenerFailed;

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
