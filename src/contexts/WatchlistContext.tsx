'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { needsTmdbFieldsRefresh, needsProvidersRefresh, planTmdbFieldsRefresh, shouldStampProvidersAtAdd, type TmdbDenormFields } from '@/lib/watchlist/tmdbFieldsRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { migrateStatus } from '@/lib/watchStatus.migration';
import { mediaTypeDocId } from '@/lib/mediaTypeDocId';
import { buildStatusUpdate, normalizeTags } from '@/lib/watchlistWrites';
import type { ItemVisibility, WatchlistItem, WatchStatus, MediaType } from '@/types';

// BIN-505: note bounds — NOTE_MAX_LEN mirrors the firestore.rules isValidNoteDoc
// cap; NOTES_MIGRATE_CAP bounds the eager per-session migration write-burst.
const NOTE_MAX_LEN = 5000;
const NOTES_MIGRATE_CAP = 300;

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
    addedAt: toDate(data.addedAt),
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
  addItem: (item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>) => Promise<void>;
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
  addItem: async () => {},
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
  const pendingAddCountRef = useRef(0);
  const pendingFirstMediaTypeRef = useRef<MediaType | null>(null);

  useEffect(() => {
    everNonEmptyRef.current = false;
    firstSnapshotSettledRef.current = false;
    pendingAddCountRef.current = 0;
    pendingFirstMediaTypeRef.current = null;
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
        setItems(snap.docs.map(d => docToItem(d.data())));
        setLoading(false);
      }));
  }, [uid]);

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

  // Lazy-on-write (A4.3): re-assertera de denormaliserade synlighetsfälten
  // (effectiveVisibility + legacy isPublic-mirror) vid VARJE mutation. Gamla
  // docs som skrevs innan cascade-stämplingen får då fälten första gången
  // användaren rör titeln — ingen migrations-sweep behövs (matchar CLAUDE.md
  // lazy-migration-filosofin; orörda docs förlitar sig på läsar-fallbacken i
  // usePublicProfile). Anropas bara när item saknar per-item visibility-override.
  const effectiveVisibilityNow = useCallback((): { effectiveVisibility: ItemVisibility; isPublic: boolean } => {
    const eff = user?.defaultVisibility ?? 'private';
    return { effectiveVisibility: eff, isPublic: eff === 'public' };
  }, [user?.defaultVisibility]);

  const addItem = useCallback(async (item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(item.mediaType, item.tmdbId));
    // BIN-349: addItem is ALSO a merge-write re-mark path (useMarkSeen /
    // StatusButton / QuickAddButton re-mark an in-library title, passing
    // rating: current?.rating). So compare against the current rating and stamp
    // ratedAt only on a genuinely new/changed rating — a blind stamp would
    // re-bump recency on every re-mark, the exact drift this fix removes.
    const currentForRating = items.find(i => i.tmdbId === item.tmdbId && i.mediaType === item.mediaType);
    // first_title_added-beslut (BIN-56 + BIN-38), se ref-kommentaren ovan:
    //  - Snapshoten har redan settlat → vi vet säkert om biblioteket är tomt.
    //    Fyra direkt om inget snapshot ännu sett en titel (genuin första add).
    //  - Snapshoten har INTE settlat (kall laddning) → vi kan inte skilja ny
    //    från återvändande användare. Spara en pending-kandidat och låt första
    //    snapshoten avgöra. Fyra aldrig vid add-tid i detta läge.
    let fireFirstNow = false;
    if (firstSnapshotSettledRef.current) {
      if (!everNonEmptyRef.current) fireFirstNow = true;
      everNonEmptyRef.current = true;
    } else {
      // Kall laddning: räkna varje add (BIN-110) så snapshoten kan subtrahera
      // sessionens egna skrivningar. Behåll bara den FÖRSTA addens mediaType
      // för event-payloaden (en användare har bara EN första titel).
      pendingAddCountRef.current += 1;
      if (pendingFirstMediaTypeRef.current == null) {
        pendingFirstMediaTypeRef.current = item.mediaType;
      }
    }
    // Denormaliserad effectiveVisibility (+ legacy isPublic-mirror) på
    // varje item så läsregeln slipper joina mot parent-user-doc. Nya items
    // ärver default; per-item-override sätts via updateVisibility senare.
    const defaultVisibility = user?.defaultVisibility ?? 'private';
    // BIN-505: notes now lives ONLY in the owner-only watchlistNotes subcollection,
    // and the watchlist-doc rules REJECT a non-null inline `notes`. addItem is also
    // the re-mark path (QuickAddButton/StatusButton/useMarkSeen pass current?.notes
    // to preserve it) — so strip notes here or a re-mark of a NOTED title would be
    // permission-denied. The note itself is untouched in its subcollection.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { notes: _strippedNotes, ...itemFields } = item;
    await setDoc(ref, {
      ...itemFields,
      dropped: false,
      effectiveVisibility: defaultVisibility,
      isPublic: defaultVisibility === 'public',
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      watchedAt: item.status === 'sedd' ? serverTimestamp() : null,
      // BIN-402/BIN-453: stamp the doc-level TMDB-fields freshness. This write
      // denormalizes the whole TMDB-derived block (title/posterPath/providers/
      // genreIds/…) fresh from TMDB, so mark it fresh — else the ToS sweep, which
      // treats an absent stamp as stale, would clear a freshly-added title's fields.
      tmdbFieldsRefreshedAt: serverTimestamp(),
      // BIN-468: stamp the providers group ONLY on a genuine new add carrying real
      // providers. addItem is also the useMarkSeen re-mark path (cached/[] providers);
      // stamping there would falsely re-certify stale providers AND suppress
      // taste/backfill's 60-day re-fetch. "Genuine new add" requires the snapshot to
      // have SETTLED — during a cold load `items` is [] so an in-library re-mark would
      // otherwise misread as new. When unsettled we can't tell → don't stamp; backfill
      // / the title-page fallback owns it.
      ...(shouldStampProvidersAtAdd(firstSnapshotSettledRef.current && !currentForRating, item.providers)
        ? { providersCheckedAt: serverTimestamp() }
        : {}),
      // BIN-349: stamp ratedAt ONLY on a genuinely new/changed rating in this
      // call — covers pre-rated CSV imports (current undefined) while NOT bumping
      // recency when a re-mark carries the unchanged current rating. Omit the key
      // otherwise so the merge preserves any existing ratedAt.
      ...(item.rating != null && item.rating !== (currentForRating?.rating ?? null)
        ? { ratedAt: serverTimestamp() }
        : {}),
    }, { merge: true });
    trackEvent('title_added_watchlist', { mediaType: item.mediaType, status: item.status });
    if (fireFirstNow) {
      trackEvent('first_title_added', { mediaType: item.mediaType });
    }
  }, [uid, user?.defaultVisibility, items]);

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
    const currentItem = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = currentItem?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, buildStatusUpdate(status, {
      now: serverTimestamp(),
      visFields,
      currentStatus: currentItem?.status,
      currentRewatchCount: currentItem?.rewatchCount,
      // BIN-91: backdaterat sett-datum (film). undefined → faller tillbaka på now.
      watchedAtOverride: watchedAt ? Timestamp.fromDate(watchedAt) : undefined,
    }), { merge: true });
    trackEvent('status_changed', { mediaType, status });
  }, [uid, items, effectiveVisibilityNow]);

  // BIN-154: redigera enbart sett-datumet. Får INTE gå via updateStatus(...,'sedd')
  // — det tolkas som en omtitt (isRewatch = sedd→sedd) och räknar upp rewatchCount
  // varje gång man justerar datumet. Detta rör bara watchedAt + updatedAt.
  const updateWatchedAt = useCallback(async (mediaType: MediaType, tmdbId: number, watchedAt: Date) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, { watchedAt: Timestamp.fromDate(watchedAt), ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, items, effectiveVisibilityNow]);

  const updateRating = useCallback(async (mediaType: MediaType, tmdbId: number, rating: number | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
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
  }, [uid, items, effectiveVisibilityNow]);

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
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
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
  }, [uid, items, effectiveVisibilityNow]);

  const updateProgress = useCallback(async (mediaType: MediaType, tmdbId: number, season: number, episode: number) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    // Progress ändrar aldrig status: TV bor redan i 'mina' (vill_se för TV är
    // avskaffat och normaliseras vid läsning), och sub-state (ej_paborjad →
    // aktiv/ikapp) härleds — inget statusbyte behövs när första avsnittet
    // markeras. (Gamla auto-promote-flytten vill_se→mina togs bort 2026-06.)
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
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
        tmdbId,
        lastWatchedSeason: season,
        lastWatchedEpisode: episode,
        status: current?.status ?? null,
      }),
    );
  }, [uid, items, effectiveVisibilityNow]);

  const updateTmdbStatus = useCallback(async (mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', mediaTypeDocId(mediaType, tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId && i.mediaType === mediaType);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, { tmdbStatus, ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, items, effectiveVisibilityNow]);

  // BIN-93: lazy runtime backfill from title-detail views. Writes only when the
  // title is already in the library and runtime is still unknown — and never
  // bumps updatedAt (it's a silent denormalisation, not a user edit, so it must
  // not reorder "senast ändrad").
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

  const value = useMemo(() => ({
    items: itemsWithTags, loading, addItem, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, refreshTmdbFields, updateTags, updateVisibility, removeItem, getByStatus, getItem,
  }), [itemsWithTags, loading, addItem, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, refreshTmdbFields, updateTags, updateVisibility, removeItem, getByStatus, getItem]);

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
