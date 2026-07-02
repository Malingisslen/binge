'use client';

import { createContext, useContext, useMemo, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { fsdb, lazySubscribe } from '@/lib/firebase/db';
import { toDate } from '@/lib/firebase/utils';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';
import { migrateStatus } from '@/lib/watchStatus.migration';
import { buildStatusUpdate, normalizeTags } from '@/lib/watchlistWrites';
import type { ItemVisibility, WatchlistItem, WatchStatus, MediaType } from '@/types';

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
  updateVisibility: (tmdbId: number, visibility: ItemVisibility | null) => Promise<void>;
  updateStatus: (tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<void>;
  updateWatchedAt: (tmdbId: number, watchedAt: Date) => Promise<void>;
  updateRating: (tmdbId: number, rating: number | null) => Promise<void>;
  updateNotes: (tmdbId: number, notes: string | null) => Promise<void>;
  updateProgress: (tmdbId: number, season: number, episode: number) => Promise<void>;
  updateTmdbStatus: (tmdbId: number, tmdbStatus: string | null) => Promise<void>;
  setRuntime: (tmdbId: number, runtime: number | null) => Promise<void>;
  updateTags: (tmdbId: number, tags: string[]) => Promise<void>;
  removeItem: (tmdbId: number) => Promise<void>;
  getByStatus: (status: WatchStatus, mediaType?: MediaType) => WatchlistItem[];
  getItem: (tmdbId: number) => WatchlistItem | null;
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
  // BIN-164: tags live in a SEPARATE owner-only subcollection (never on the
  // publicly-readable watchlist doc), so they arrive on their own subscription
  // and are joined onto items in-memory below. Map keyed by tmdbId.
  const [tagsByTmdbId, setTagsByTmdbId] = useState<Record<number, string[]>>({});

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
        const map: Record<number, string[]> = {};
        snap.docs.forEach(d => {
          const tags = (d.data().tags as string[] | undefined) ?? [];
          if (tags.length > 0) map[Number(d.id)] = tags;
        });
        setTagsByTmdbId(map);
      }));
  }, [uid]);

  // Join tags onto items in-memory. Consumers read `item.tags` (default []);
  // the raw `items` state (used by the mutators' current-item lookups) stays
  // tag-free since mutators never need tags.
  const itemsWithTags = useMemo(
    () => items.map(i => ({ ...i, tags: tagsByTmdbId[i.tmdbId] ?? [] })),
    [items, tagsByTmdbId],
  );

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
    const ref = doc(db, 'users', uid, 'watchlist', String(item.tmdbId));
    // BIN-349: addItem is ALSO a merge-write re-mark path (useMarkSeen /
    // StatusButton / QuickAddButton re-mark an in-library title, passing
    // rating: current?.rating). So compare against the current rating and stamp
    // ratedAt only on a genuinely new/changed rating — a blind stamp would
    // re-bump recency on every re-mark, the exact drift this fix removes.
    const currentForRating = items.find(i => i.tmdbId === item.tmdbId);
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
    await setDoc(ref, {
      ...item,
      dropped: false,
      effectiveVisibility: defaultVisibility,
      isPublic: defaultVisibility === 'public',
      addedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      watchedAt: item.status === 'sedd' ? serverTimestamp() : null,
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

  const updateVisibility = useCallback(async (tmdbId: number, visibility: ItemVisibility | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
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

  const updateStatus = useCallback(async (tmdbId: number, status: WatchStatus, watchedAt?: Date) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const currentItem = items.find(i => i.tmdbId === tmdbId);
    const visFields = currentItem?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, buildStatusUpdate(status, {
      now: serverTimestamp(),
      visFields,
      currentStatus: currentItem?.status,
      currentRewatchCount: currentItem?.rewatchCount,
      // BIN-91: backdaterat sett-datum (film). undefined → faller tillbaka på now.
      watchedAtOverride: watchedAt ? Timestamp.fromDate(watchedAt) : undefined,
    }), { merge: true });
    trackEvent('status_changed', { mediaType: currentItem?.mediaType ?? 'movie', status });
  }, [uid, items, effectiveVisibilityNow]);

  // BIN-154: redigera enbart sett-datumet. Får INTE gå via updateStatus(...,'sedd')
  // — det tolkas som en omtitt (isRewatch = sedd→sedd) och räknar upp rewatchCount
  // varje gång man justerar datumet. Detta rör bara watchedAt + updatedAt.
  const updateWatchedAt = useCallback(async (tmdbId: number, watchedAt: Date) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp, Timestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, { watchedAt: Timestamp.fromDate(watchedAt), ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, items, effectiveVisibilityNow]);

  const updateRating = useCallback(async (tmdbId: number, rating: number | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId);
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

  const updateNotes = useCallback(async (tmdbId: number, notes: string | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, { notes, ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, items, effectiveVisibilityNow]);

  const updateProgress = useCallback(async (tmdbId: number, season: number, episode: number) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    // Progress ändrar aldrig status: TV bor redan i 'mina' (vill_se för TV är
    // avskaffat och normaliseras vid läsning), och sub-state (ej_paborjad →
    // aktiv/ikapp) härleds — inget statusbyte behövs när första avsnittet
    // markeras. (Gamla auto-promote-flytten vill_se→mina togs bort 2026-06.)
    const current = items.find(i => i.tmdbId === tmdbId);
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

  const updateTmdbStatus = useCallback(async (tmdbId: number, tmdbStatus: string | null) => {
    if (!uid) return;
    const { db, doc, setDoc, serverTimestamp } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlist', String(tmdbId));
    const current = items.find(i => i.tmdbId === tmdbId);
    const visFields = current?.visibility == null ? effectiveVisibilityNow() : {};
    await setDoc(ref, { tmdbStatus, ...visFields, updatedAt: serverTimestamp() }, { merge: true });
  }, [uid, items, effectiveVisibilityNow]);

  // BIN-93: lazy runtime backfill from title-detail views. Writes only when the
  // title is already in the library and runtime is still unknown — and never
  // bumps updatedAt (it's a silent denormalisation, not a user edit, so it must
  // not reorder "senast ändrad").
  const setRuntime = useCallback(async (tmdbId: number, runtime: number | null) => {
    if (!uid || runtime == null) return;
    const current = items.find(i => i.tmdbId === tmdbId);
    if (!current || current.runtime != null) return;
    const { db, doc, setDoc } = await fsdb();
    // Best-effort denormalisering: anropas fire-and-forget (`void setRuntime`)
    // från titelsidor. Ett avslag (t.ex. en token som tillfälligt desynkat) får
    // INTE bubbla upp som en ofångad promise-rejection → Sentry-brus. Sväljs
    // tyst; nästa titelvisning försöker igen.
    try {
      await setDoc(doc(db, 'users', uid, 'watchlist', String(tmdbId)), { runtime }, { merge: true });
    } catch (err) {
      console.warn('[watchlist] runtime-backfill misslyckades:', err);
    }
  }, [uid, items]);

  const removeItem = useCallback(async (tmdbId: number) => {
    if (!uid) return;
    const { db, doc, deleteDoc } = await fsdb();
    await deleteDoc(doc(db, 'users', uid, 'watchlist', String(tmdbId)));
    // Best-effort: drop the sibling tags doc so it never orphans (its own
    // owner-only collection isn't cascaded by the watchlist delete).
    try {
      await deleteDoc(doc(db, 'users', uid, 'watchlistTags', String(tmdbId)));
    } catch { /* no tags doc for this title — fine */ }
  }, [uid]);

  // BIN-164: write the owner-only tags doc. normalizeTags enforces the per-tag
  // length + dedup + count caps (the rules bound the array size server-side but
  // can't iterate elements). Empty result → delete the doc rather than store [].
  const updateTags = useCallback(async (tmdbId: number, tags: string[]) => {
    if (!uid) return;
    const clean = normalizeTags(tags);
    const { db, doc, setDoc, deleteDoc } = await fsdb();
    const ref = doc(db, 'users', uid, 'watchlistTags', String(tmdbId));
    if (clean.length === 0) { await deleteDoc(ref); return; }
    // Full replace (the doc's only field is `tags`) — not a merge.
    await setDoc(ref, { tags: clean });
  }, [uid]);

  const getByStatus = useCallback((status: WatchStatus, mediaType?: MediaType) => {
    return itemsWithTags.filter(i => i.status === status && (!mediaType || i.mediaType === mediaType));
  }, [itemsWithTags]);

  const getItem = useCallback((tmdbId: number) => {
    return itemsWithTags.find(i => i.tmdbId === tmdbId) ?? null;
  }, [itemsWithTags]);

  const value = useMemo(() => ({
    items: itemsWithTags, loading, addItem, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, updateTags, updateVisibility, removeItem, getByStatus, getItem,
  }), [itemsWithTags, loading, addItem, updateStatus, updateWatchedAt, updateRating, updateNotes, updateProgress, updateTmdbStatus, setRuntime, updateTags, updateVisibility, removeItem, getByStatus, getItem]);

  return (
    <WatchlistContext.Provider value={value}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  return useContext(WatchlistContext);
}
