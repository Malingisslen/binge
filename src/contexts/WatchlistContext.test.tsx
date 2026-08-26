import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';

// --- Mocks -----------------------------------------------------------------
// trackEvent: fångar alla analytics-anrop.
const trackEvent = vi.fn();
vi.mock('@/lib/analytics', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

// useAuth: styrs per test via en mutable referens.
const authState = { uid: 'u1' as string | null, user: { defaultVisibility: 'private' } as { defaultVisibility: string } | null };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

// migrateStatus: identitets-mappning (vi bryr oss inte om migration här).
vi.mock('@/lib/watchStatus.migration', () => ({
  migrateStatus: (status: string) => ({ status, dropped: false }),
}));

// buildStatusUpdate: spioneras (BIN-332) så updateStatus-testet kan verifiera
// vad contexten FÖR VIDARE från items-state (currentStatus/currentRewatchCount).
// Själva payload-logiken (dropped:false, rewatch-uppräkning) bor i
// watchlistWrites och testas där — här bryr vi oss bara om forwarding.
const buildStatusUpdate = vi.fn((..._args: unknown[]) => ({}) as Record<string, unknown>);
// Spy buildStatusUpdate but keep the REAL normalizeTags (BIN-164) so the
// updateTags test verifies genuine normalization, not a stub.
vi.mock('@/lib/watchlistWrites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/watchlistWrites')>();
  return {
    ...actual,
    buildStatusUpdate: (...args: unknown[]) => buildStatusUpdate(...args),
  };
});

// syncProgressToGroups: fire-and-forget grupp-synk som updateProgress kör via
// dynamisk import — mockad så vi kan verifiera att rätt status forwardas (BIN-332).
const syncProgressToGroups = vi.fn();
vi.mock('@/lib/firebase/groups', () => ({
  syncProgressToGroups: (...args: unknown[]) => syncProgressToGroups(...args),
}));

// firebase/utils toDate: passthrough.
vi.mock('@/lib/firebase/utils', () => ({
  toDate: (v: unknown) => v ?? null,
}));

// BIN-954: updateProgress reaches TMDB (dynamic import, same shape as the groups sync
// above) when it has to ADD a series the user just started ticking. Only getTVShowLite is
// stubbed — `extractYear` stays REAL so the releaseYear assertion proves the actual
// derivation rather than a fixture echo.
const getTVShowLite = vi.fn();
vi.mock('@/lib/tmdb/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmdb/client')>();
  return { ...actual, getTVShowLite: (...args: unknown[]) => getTVShowLite(...args) };
});

// BIN-954: the add path's only failure channel — a TMDB error must be reported, not
// swallowed into silence, and must NOT fall back to writing the identity-less fragment.
const captureError = vi.fn();
vi.mock('@/lib/sentry', () => ({
  captureError: (...args: unknown[]) => captureError(...args),
}));

// --- Firestore-mock --------------------------------------------------------
// lazySubscribe: kör attach() synkront och exponerar onSnapshot-callbacken
// så testet kan driva snapshot-sekvensen manuellt. BIN-164: contexten har nu
// TVÅ subscriptions (watchlist + watchlistTags) — routa på collection-path så
// `snapshotCallback` fortsatt driver watchlist-items (tags-callbacken separat).
let snapshotCallback: ((snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void) | null = null;
let tagsSnapshotCallback: ((snap: { size: number; docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null;
// BIN-505: third subscription — per-title notes (watchlistNotes). Routed separately
// so it doesn't clobber the watchlist items callback.
let notesSnapshotCallback: ((snap: { size: number; docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null;
// BIN-601: the watchlist listener's terminal-error callback.
let snapshotErrorCallback: (() => void) | null = null;
// BIN-755: how many watchlist listens have been opened, and how many torn down.
// "Försök igen" (retryListener) claims to open a FRESH subscription for the same
// uid; re-assigning `snapshotCallback` proves nothing on its own, because the
// mock would hand back the same live callback whether the effect re-ran or not.
// Counting the onSnapshot calls — and the unsubscribes React runs before them —
// is the only externally visible evidence that the old listener actually died.
let watchlistListenCount = 0;
let watchlistUnsubscribeCount = 0;

const setDoc = vi.fn(async (..._args: unknown[]) => {});
// BIN-640: the batch commit, as its own spy so a test can make it reject.
const batchCommit = vi.fn(async () => {});
const deleteDoc = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@/lib/firebase/db', () => ({
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    const kit = {
      db: {},
      collection: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
      onSnapshot: (
        ref: { _path?: string },
        cb: (snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void,
        // BIN-601: the watchlist listen now takes an ERROR callback too. Captured
        // so tests can drive a terminal listen failure for real, instead of poking
        // the ref the production code reads — a mocked ref would pass even if the
        // callback were never wired up, which is the whole bug.
        onError?: () => void,
      ) => {
        if ((ref?._path ?? '').endsWith('watchlistTags')) {
          tagsSnapshotCallback = cb as typeof tagsSnapshotCallback;
        } else if ((ref?._path ?? '').endsWith('watchlistNotes')) {
          notesSnapshotCallback = cb as typeof notesSnapshotCallback;
        } else {
          snapshotCallback = cb;
          snapshotErrorCallback = onError ?? null;
          // BIN-755: only the watchlist listen is counted — the tags/notes
          // subscriptions are keyed on uid alone and must NOT re-run on a retry.
          watchlistListenCount += 1;
          return () => { watchlistUnsubscribeCount += 1; };
        }
        return () => {};
      },
    };
    return attach(kit);
  },
  fsdb: async () => ({
    db: {},
    // Path-kodande doc-ref så mutation-testerna kan pinna VILKEN doc som
    // skrivs/raderas (BIN-332), likt friends.test-harnessen.
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    setDoc,
    deleteDoc,
    // BIN-505: updateNotes + the eager notes migration use an atomic batch +
    // deleteField. Record ops on the shared spies so a note-write can be asserted.
    writeBatch: () => ({
      set: (ref: unknown, data: unknown) => setDoc(ref, data),
      update: (ref: unknown, data: unknown) => setDoc(ref, data),
      delete: (ref: unknown) => deleteDoc(ref),
      // BIN-640: commit is its OWN spy so a test can make the batch FAIL. It used
      // to be a bare `async () => {}`, which meant no test could tell "the dedup
      // ref is marked before the write" from "marked after a successful commit" —
      // and the second is the retry storm this design was blocked on. A rejection
      // reaches production's `try { await batch.commit(); } catch {}`.
      commit: () => batchCommit(),
    }),
    deleteField: () => 'DELETE_FIELD',
    serverTimestamp: () => 'ts',
    Timestamp: { fromDate: (d: Date) => d },
  }),
}));

import { WatchlistProvider, useWatchlist } from './WatchlistContext';
import type { WatchlistItem, MediaType, WatchStatus, ItemVisibility } from '@/types';
import type { ItemWriteOutcome } from './WatchlistContext';
import type { TitleWriteOutcome } from '@/lib/watchlistWrites';

// Hjälpare: en watchlist-doc med minimala fält som docToItem läser.
function doc(tmdbId: number, mediaType: MediaType = 'tv') {
  return {
    data: () => ({
      tmdbId,
      mediaType,
      status: mediaType === 'tv' ? 'mina' : 'sedd',
      title: `Title ${tmdbId}`,
    }),
  };
}

function snap(docs: { data: () => Record<string, unknown> }[]) {
  return { size: docs.length, docs };
}

// Rikare seed-doc för mutation-testerna: överlagra valfria docToItem-fält
// (status, rewatchCount, runtime, …) ovanpå förnuftiga TV-default (BIN-332).
function seedDoc(over: { tmdbId: number } & Record<string, unknown>) {
  return {
    data: () => ({ mediaType: 'tv', status: 'mina', title: `Title ${over.tmdbId}`, ...over }),
  };
}

// Testharness: exponerar mutatorerna så testet kan trigga dem. Refsen pekar
// alltid på den SENASTE closuren (de återskapas när items-state ändras), så ett
// anrop efter en seedad snapshot ser de seedade titlarna (BIN-332).
// BIN-814: `subscriptionProviders` is OPTIONAL here, not omitted. Mechanically
// omitting it (as the first pass did) makes it structurally impossible for any
// fixture in this file to supply the field — which silently un-tests addItem's
// stamping decision, the one place that decides whether providersCheckedAt is
// written at all.
// BIN-895: both doors now RESOLVE with what the write did (`TitleWriteOutcome`), so
// these refs carry that through — typing them `Promise<void>` would no longer compile,
// and widening them to `Promise<unknown>` would let the outcome assertions below read
// anything at all.
let upsertTitleRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility' | 'subscriptionProviders'> & { subscriptionProviders?: number[] }) => Promise<TitleWriteOutcome>) | null = null;
let logViewingRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility' | 'subscriptionProviders'> & { subscriptionProviders?: number[] }) => Promise<TitleWriteOutcome>) | null = null;
let updateStatusRef: ((mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<ItemWriteOutcome>) | null = null;
let updateProgressRef: ((mediaType: MediaType, tmdbId: number, season: number, episode: number, opts?: { addIfMissing?: boolean }) => Promise<ItemWriteOutcome>) | null = null;
let setRuntimeRef: ((mediaType: MediaType, tmdbId: number, runtime: number | null) => Promise<void>) | null = null;
let removeItemRef: ((mediaType: MediaType, tmdbId: number) => Promise<void>) | null = null;
let updateTagsRef: ((mediaType: MediaType, tmdbId: number, tags: string[]) => Promise<void>) | null = null;
let updateRatingRef: ((mediaType: MediaType, tmdbId: number, rating: number | null) => Promise<ItemWriteOutcome>) | null = null;
let updateNotesRef: ((mediaType: MediaType, tmdbId: number, notes: string | null) => Promise<void>) | null = null;
let refreshTmdbFieldsRef: ((mediaType: MediaType, tmdbId: number, fields: Record<string, unknown>) => Promise<void>) | null = null;
// BIN-598/BIN-630: the two mutators that had zero coverage.
let updateWatchedAtRef: ((mediaType: MediaType, tmdbId: number, watchedAt: Date) => Promise<ItemWriteOutcome>) | null = null;
let updateTmdbStatusRef: ((mediaType: MediaType, tmdbId: number, tmdbStatus: string | null) => Promise<ItemWriteOutcome>) | null = null;
// BIN-942: the sixth guarded edit path had no test handle at all — it is the one mutator
// nothing in this file could reach, which is why it needed adding rather than reusing.
let updateVisibilityRef: ((mediaType: MediaType, tmdbId: number, visibility: ItemVisibility | null) => Promise<ItemWriteOutcome>) | null = null;
// BIN-596: the readiness flags the add surfaces gate on, as the components see
// them (a ref is invisible to a component).
let readiness: { loading: boolean; snapshotSettled: boolean; listenerFailed: boolean; libraryKnown: boolean } | null = null;
// BIN-755: the "Försök igen" the failure surfaces render (components/title/libraryHold.ts).
let retryListenerRef: (() => void) | null = null;

function Harness() {
  const wl = useWatchlist();
  useEffect(() => {
    readiness = { loading: wl.loading, snapshotSettled: wl.snapshotSettled, listenerFailed: wl.listenerFailed, libraryKnown: wl.libraryKnown };
    retryListenerRef = wl.retryListener;
    updateWatchedAtRef = wl.updateWatchedAt;
    updateTmdbStatusRef = wl.updateTmdbStatus;
    updateVisibilityRef = wl.updateVisibility;
    upsertTitleRef = wl.upsertTitle;
    logViewingRef = wl.logViewing;
    updateStatusRef = wl.updateStatus;
    updateProgressRef = wl.updateProgress;
    setRuntimeRef = wl.setRuntime;
    removeItemRef = wl.removeItem;
    updateTagsRef = wl.updateTags;
    updateRatingRef = wl.updateRating;
    updateNotesRef = wl.updateNotes;
    refreshTmdbFieldsRef = wl.refreshTmdbFields as typeof refreshTmdbFieldsRef;
  }, [wl]);
  return <div>ready</div>;
}

function newTitle(tmdbId: number, mediaType: MediaType = 'tv'): Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility' | 'subscriptionProviders'> & { subscriptionProviders?: number[] } {
  return {
    tmdbId,
    mediaType,
    status: mediaType === 'tv' ? 'mina' : 'sedd',
    rating: null,
    notes: null,
    title: `Title ${tmdbId}`,
    posterPath: null,
    releaseYear: null,
    totalSeasons: null,
    lastWatchedSeason: null,
    lastWatchedEpisode: null,
    providers: [],
    genreIds: [],
    tmdbStatus: null,
  } as Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility' | 'subscriptionProviders'> & { subscriptionProviders?: number[] };
}

function firstTitleAddedCount() {
  return trackEvent.mock.calls.filter(c => c[0] === 'first_title_added').length;
}

beforeEach(() => {
  trackEvent.mockClear();
  setDoc.mockClear();
  deleteDoc.mockClear();
  buildStatusUpdate.mockClear();
  syncProgressToGroups.mockClear();
  getTVShowLite.mockReset();
  captureError.mockClear();
  snapshotCallback = null;
  tagsSnapshotCallback = null;
  notesSnapshotCallback = null;
  snapshotErrorCallback = null;
  readiness = null;
  retryListenerRef = null;
  watchlistListenCount = 0;
  watchlistUnsubscribeCount = 0;
  batchCommit.mockClear();
  batchCommit.mockImplementation(async () => {});
  authState.uid = 'u1';
  authState.user = { defaultVisibility: 'private' };
});

describe('WatchlistContext — first_title_added gating (BIN-56 + BIN-38)', () => {
  it('(a) ny användare lägger till första titeln UNDER kall laddning → eventet fyras exakt en gång (tappas inte)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();
    // Snapshoten har INTE landat än (kall laddning, loading===true, items===[]).
    expect(snapshotCallback).not.toBeNull();
    expect(firstTitleAddedCount()).toBe(0);

    // Användaren lägger till sin första titel FÖRE snapshoten.
    await act(async () => {
      await upsertTitleRef!(newTitle(101));
    });
    // Beslutet skjuts upp — inget fyras vid add-tid under kall laddning.
    expect(firstTitleAddedCount()).toBe(0);
    expect(setDoc).toHaveBeenCalledTimes(1);

    // Första snapshoten landar nu och innehåller den tillagda titeln.
    await act(async () => {
      snapshotCallback!(snap([doc(101)]));
    });
    // Den uppskjutna första-titel-eventet fyras nu — exakt en gång.
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'tv' });
  });

  it('(b) återvändande användare med befintliga titlar lägger till en till → eventet fyras INTE', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Första snapshoten landar med befintliga titlar.
    await act(async () => {
      snapshotCallback!(snap([doc(1), doc(2), doc(3)]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Lägger till ännu en titel.
    await act(async () => {
      await upsertTitleRef!(newTitle(4));
    });
    // title_added_watchlist fyras men ALDRIG first_title_added (BIN-38).
    expect(firstTitleAddedCount()).toBe(0);
    expect(trackEvent).toHaveBeenCalledWith('title_added_watchlist', expect.anything());
  });

  it('(b2) återvändande användare lägger till UNDER kall laddning → eventet fyras INTE (BIN-38-racen)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Add sker FÖRE snapshoten (kall laddning) — kan inte skiljas från ny
    // användare vid add-tid, så beslutet skjuts upp.
    await act(async () => {
      await upsertTitleRef!(newTitle(5));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Första snapshoten landar och avslöjar ett FULLT bibliotek (>1 titel) →
    // återvändande användare. Den uppskjutna kandidaten ska INTE fyra.
    await act(async () => {
      snapshotCallback!(snap([doc(5), doc(6), doc(7)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });

  it('(c) kall snapshot-laddning (utan add) fyrar inte eventet av sig själv', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Tomt bibliotek landar (ny användare som inte gjort något än).
    await act(async () => {
      snapshotCallback!(snap([]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Sen full snapshot.
    await act(async () => {
      snapshotCallback!(snap([doc(8), doc(9)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });

  it('ny användare lägger till EFTER att en tom snapshot settlat → fyras exakt en gång', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // Tom snapshot settlar (vet säkert: biblioteket är tomt).
    await act(async () => {
      snapshotCallback!(snap([]));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Add efter settle → fyrar direkt.
    await act(async () => {
      await upsertTitleRef!(newTitle(10, 'movie'));
    });
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });

    // En andra add ska INTE re-fyra.
    await act(async () => {
      await upsertTitleRef!(newTitle(11));
    });
    expect(firstTitleAddedCount()).toBe(1);
  });

  it('(d) ny användare lägger till TVÅ titlar FÖRE första snapshoten → eventet fyras exakt en gång (BIN-110)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(snapshotCallback).not.toBeNull();
    expect(firstTitleAddedCount()).toBe(0);

    // Två adds UNDER kall laddning, FÖRE snapshoten landar — first add film,
    // sen tv (driver att payloaden = första addens mediaType, inte sista).
    await act(async () => {
      await upsertTitleRef!(newTitle(201, 'movie'));
    });
    await act(async () => {
      await upsertTitleRef!(newTitle(202, 'tv'));
    });
    // Beslutet är fortfarande uppskjutet — inget fyrat vid add-tid.
    expect(firstTitleAddedCount()).toBe(0);
    expect(setDoc).toHaveBeenCalledTimes(2);

    // Första snapshoten landar och innehåller BÅDA optimistiska skrivningarna
    // (size===2). Gamla `snap.size <= 1`-grinden hade tappat eventet här.
    await act(async () => {
      snapshotCallback!(snap([doc(201, 'movie'), doc(202, 'tv')]));
    });
    // Fyras exakt en gång, med FÖRSTA addens mediaType.
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });
  });

  it('(e) återvändande användare (1 befintlig titel) lägger till TVÅ under kall laddning → eventet fyras INTE (BIN-110/BIN-38)', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(snapshotCallback).not.toBeNull();

    // Två adds FÖRE snapshoten.
    await act(async () => {
      await upsertTitleRef!(newTitle(301));
    });
    await act(async () => {
      await upsertTitleRef!(newTitle(302));
    });
    expect(firstTitleAddedCount()).toBe(0);

    // Första snapshoten landar med size===3: de två sessionens adds PLUS en
    // titel som redan fanns (303) → återvändande användare. snap.size(3) -
    // pendingCount(2) = 1 > 0 → fyra inte.
    await act(async () => {
      snapshotCallback!(snap([doc(301), doc(302), doc(303)]));
    });
    expect(firstTitleAddedCount()).toBe(0);
  });
});

describe('WatchlistContext — mutation paths (BIN-332)', () => {
  // Montera och seeda biblioteket via en första snapshot; efteråt pekar mutator-
  // refsen på closurer som ser de seedade titlarna.
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
  }

  // BIN-814. The pure gate lives in tmdbFieldsRefresh and is exhaustively tested
  // there — but the DECISION that matters is the composition here: addItem is what
  // actually writes providersCheckedAt, and stamping with the subset missing would
  // gate the title-page repair out for 60 days on a title the user just added. The
  // caller was unpinned until now: reverting it to the pre-ticket two-argument form
  // left this whole file green.
  it('stamps providersCheckedAt on a genuine new add carrying BOTH provider fields', async () => {
    await mountSeeded([]);
    await act(async () => {
      await upsertTitleRef!({ ...newTitle(900, 'movie'), providers: [76, 8], subscriptionProviders: [8] });
    });
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.providers).toEqual([76, 8]);
    expect(payload.subscriptionProviders).toEqual([8]);
    expect(payload.providersCheckedAt).toBe('ts');
  });

  it('does NOT stamp when the add carries only the broad list — the repair must stay open', async () => {
    await mountSeeded([]);
    await act(async () => {
      await upsertTitleRef!({ ...newTitle(901, 'movie'), providers: [76, 8] });
    });
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.providers).toEqual([76, 8]);
    expect('subscriptionProviders' in payload).toBe(false);
    // Absent stamp reads as stale, so the next title-page view writes both fields.
    expect('providersCheckedAt' in payload).toBe(false);
  });

  it('stamps when the subset is supplied and genuinely EMPTY (rent-only is an answer)', async () => {
    await mountSeeded([]);
    await act(async () => {
      await upsertTitleRef!({ ...newTitle(902, 'movie'), providers: [76], subscriptionProviders: [] });
    });
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.subscriptionProviders).toEqual([]);
    expect(payload.providersCheckedAt).toBe('ts');
  });

  it('updateStatus forwards the seeded currentStatus + currentRewatchCount to buildStatusUpdate', async () => {
    // En sedd film med 2 tidigare omtittningar. En stale-closure eller off-by-one
    // i rewatchCount-forwardingen vore osynlig utan denna assertion.
    await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount: 2 })]);

    await act(async () => {
      await updateStatusRef!('movie', 42, 'sedd');
    });

    expect(buildStatusUpdate).toHaveBeenCalledTimes(1);
    const [status, opts] = buildStatusUpdate.mock.calls[0] as [WatchStatus, Record<string, unknown>];
    expect(status).toBe('sedd');
    expect(opts.currentStatus).toBe('sedd');
    expect(opts.currentRewatchCount).toBe(2);
    // Skrivningen merge:as (aldrig overwrite) och status_changed loggas med rätt mediaType.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
    expect(trackEvent).toHaveBeenCalledWith('status_changed', { mediaType: 'movie', status: 'sedd' });
  });

  it('setRuntime backfills runtime WITHOUT bumping updatedAt when runtime is unknown', async () => {
    await mountSeeded([seedDoc({ tmdbId: 7, runtime: null })]);

    await act(async () => {
      await setRuntimeRef!('tv', 7, 95);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>, unknown];
    expect(ref._path).toBe('users/u1/watchlist/tv_7');
    expect(payload).toEqual({ runtime: 95 }); // ren denormalisering — INGEN updatedAt
    expect(opts).toEqual({ merge: true });
  });

  it('setRuntime skip-guard: no write when runtime is already known', async () => {
    await mountSeeded([seedDoc({ tmdbId: 7, runtime: 120 })]);
    await act(async () => {
      await setRuntimeRef!('tv', 7, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('setRuntime skip-guard: no write when the title is not in the library', async () => {
    await mountSeeded([]);
    await act(async () => {
      await setRuntimeRef!('tv', 999, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  // BIN-957. Both halves in one assertion each, because the two failure modes are
  // opposites: reporting it and still swallowing it. A future edit that re-throws turns a
  // fire-and-forget denormalisation into an unhandled rejection; one that drops the
  // captureError call puts the failure back where Sentry cannot see it (globalHandlers
  // report unhandled rejections, never a console line), which is what console.warn did.
  it('BIN-957: setRuntime reports a failed backfill to Sentry AND still swallows it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mountSeeded([seedDoc({ tmdbId: 7, runtime: null })]);
      setDoc.mockRejectedValueOnce(new Error('permission-denied'));

      await act(async () => {
        await expect(setRuntimeRef!('tv', 7, 95)).resolves.toBeUndefined();
      });

      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        { scope: 'watchlist', kind: 'setRuntime' },
      );
      expect(consoleError.mock.calls.some(c => String(c[0]).includes('runtime-backfill'))).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('updateProgress writes progress fields (never status) and forwards status to group-sync', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => {
      await updateProgressRef!('tv', 5, 2, 3);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/tv_5');
    expect(payload.lastWatchedSeason).toBe(2);
    expect(payload.lastWatchedEpisode).toBe(3);
    // Progress ändrar ALDRIG status (regeln: status härleds, skrivs inte).
    expect(payload.status).toBeUndefined();

    // Fire-and-forget grupp-synk får seedad status, inte en gissning.
    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalledTimes(1));
    expect(syncProgressToGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1', tmdbId: 5, lastWatchedSeason: 2, lastWatchedEpisode: 3, status: 'mina',
      }),
    );
  });

  // --- BIN-954 -------------------------------------------------------------
  // Ticking an episode on a series you do NOT follow used to write a document carrying
  // ONLY lastWatchedSeason/lastWatchedEpisode/updatedAt — no tmdbId, no mediaType, no
  // status, no title. Same broken document BIN-942 is about, but reached by an ordinary
  // deliberate gesture instead of a race, every time. Malin, 2026-08-20: add the series
  // properly, with a full payload.
  //
  // The three identity fields asserted below are exactly the ones BIN-942's create-floor
  // will require, which is why this ticket blocks that one.
  const TV_SHOW = {
    id: 1399,
    name: 'Sagan om is och eld',
    original_name: 'Game of Thrones',
    poster_path: '/got.jpg',
    first_air_date: '2011-04-17',
    number_of_seasons: 8,
    genres: [{ id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' }],
    status: 'Ended',
  };

  it('BIN-954: ticking an episode on an untracked series ADDS it with a full payload', async () => {
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await mountSeeded([]); // settled snapshot, empty library — the title is genuinely absent

    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/tv_1399');
    // The three whose absence IS the bug.
    expect(payload.tmdbId).toBe(1399);
    expect(payload.mediaType).toBe('tv');
    expect(payload.status).toBe('mina');
    // ...and the display fields, so the row is not a blank line in the library.
    // preferOriginalTitle: the Latin original wins over the localized name.
    expect(payload.title).toBe('Game of Thrones');
    expect(payload.posterPath).toBe('/got.jpg');
    // Real extractYear (only getTVShowLite is stubbed), so this is a derivation, not an echo.
    expect(payload.releaseYear).toBe(2011);
    // The position rides in the SAME write: one Firestore write per gesture, not two.
    expect(payload.lastWatchedSeason).toBe(2);
    expect(payload.lastWatchedEpisode).toBe(5);
    // No half-stamped provider group — shouldStampProvidersAtAdd needs BOTH provider
    // fields, and supplying neither is what keeps the title page's repair reachable.
    expect(payload.providersCheckedAt).toBeUndefined();

    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalledTimes(1));
    expect(syncProgressToGroups).toHaveBeenCalledWith(expect.objectContaining({ status: 'mina' }));
  });

  it('BIN-954: the same gesture on a series ALREADY in the library still writes progress only', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => {
      await updateProgressRef!('tv', 5, 2, 3, { addIfMissing: true });
    });

    // The intent flag is permission to add a MISSING title, never a re-add of a present
    // one: progress must still never touch status (WatchlistContext's own rule).
    expect(getTVShowLite).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.status).toBeUndefined();
    expect(payload.title).toBeUndefined();
    expect(payload.lastWatchedSeason).toBe(2);
  });

  it('BIN-954: UN-ticking on an untracked series writes nothing at all — no fragment', async () => {
    await mountSeeded([]);

    await act(async () => {
      // The un-tick path (and markSeasonUnwatched) pass no intent, deliberately: removing
      // an episode is not "I am watching this". Before this ticket the merge-write below
      // created the identity-less ghost anyway.
      await updateProgressRef!('tv', 1399, 0, 0);
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(getTVShowLite).not.toHaveBeenCalled();
    // The group sync still fires on the write-nothing branch: a series followed only
    // inside a group (SeasonPageClient with ?fromGroup=) is absent from the personal
    // library but its progress still belongs to the group.
    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalledTimes(1));
  });

  it('BIN-954: during a cold load the OLD merge-write is kept — the add is never guessed', async () => {
    // No snapshot delivered, so the listener has not settled. "Absent from items" and
    // "absent from Firestore" are indistinguishable here, and guessing "add it" could
    // rewrite the status of a series the user had set to 'avbruten'. This negative case is
    // what stops the add branch from quietly becoming unconditional.
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );

    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
    });

    expect(getTVShowLite).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.status).toBeUndefined();
    expect(payload.lastWatchedSeason).toBe(2);
    expect(payload.lastWatchedEpisode).toBe(5);
  });

  // #27 Database Administrator, binding condition 1 (blind critique 2026-08-20).
  it('BIN-954: the auto-advance write inside the SAME gesture is not dropped', async () => {
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await mountSeeded([]);

    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
      // useEpisodeProgressWithSync's auto-advance: same gesture, intentionally NO flag,
      // and the snapshot has not landed — so findItem is still empty. Without the
      // session ref this second call would read as "absent, no intent" and be silently
      // dropped, losing the season+1 pointer for the very gesture that created the row.
      await updateProgressRef!('tv', 1399, 3, 0);
    });

    expect(setDoc).toHaveBeenCalledTimes(2);
    // Added ONCE. A second add would mean a second TMDB fetch and a second analytics event.
    expect(getTVShowLite).toHaveBeenCalledTimes(1);
    expect(trackEvent.mock.calls.filter(c => c[0] === 'title_added_watchlist')).toHaveLength(1);
    const [, second] = setDoc.mock.calls[1] as [unknown, Record<string, unknown>];
    expect(second.lastWatchedSeason).toBe(3);
    expect(second.lastWatchedEpisode).toBe(0);
    expect(second.status).toBeUndefined(); // an update, not a second add
  });

  // #27 Database Administrator, binding condition 2 (blind critique 2026-08-20).
  it('BIN-954: a TMDB failure writes nothing, reports it, and leaves the add retryable', async () => {
    getTVShowLite.mockRejectedValueOnce(new Error('tmdb down'));
    await mountSeeded([]);

    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
    });

    // Never the fragment: no title data means no honest document.
    expect(setDoc).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: 'watchlist', kind: 'updateProgress-add' }),
    );

    // Self-correcting: the failed attempt is NOT memoised, so the next tick adds for real.
    // That is what makes the residual (a tick recorded in episodeProgress with no library
    // row) temporary rather than permanent.
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 6, { addIfMissing: true });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.tmdbId).toBe(1399);
    expect(payload.status).toBe('mina');
  });

  // The integration reviewer's blocking finding, 2026-08-20. `addedByProgressRef` is a
  // SECOND cache of "this document exists", and removeItem pruned only the first
  // (`itemsRef`). Add-by-ticking then remove is the likeliest sequence a user performs,
  // and it turned every later progress write back into a fragment-creator.
  it('BIN-954: a series added by ticking and then removed does not resurrect as a fragment', async () => {
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await mountSeeded([]);

    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);

    // "Undo what I just did" — and no snapshot lands in between, which is the whole point.
    await act(async () => {
      await removeItemRef!('tv', 1399);
    });
    setDoc.mockClear();

    // Un-ticking carries no watch intent, and the document is gone. A stale session mark
    // would read as "it exists", send this down the merge branch, and CREATE the ghost.
    await act(async () => {
      await updateProgressRef!('tv', 1399, 0, 0);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  // The narrower half of the same defect, found by the code reviewer one round later.
  // Pruning the session mark inside removeItem only helps when the add has already
  // finished. Firestore applies a pending write optimistically, so "Ta bort" becomes
  // clickable the moment the add's setDoc is ISSUED — a removal in that window prunes a
  // key that is not there yet, and the add then writes it back over a deleted document.
  it('BIN-954: a removal issued WHILE the add is in flight leaves no stale mark', async () => {
    await mountSeeded([]);
    // Hold the TMDB fetch open so the add is provably still in flight during the removal.
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let addSettled = false;
    let add!: Promise<void>;
    await act(async () => {
      add = updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true })
        .then(() => { addSettled = true; });
    });
    expect(addSettled).toBe(false);

    await act(async () => { await removeItemRef!('tv', 1399); });
    await act(async () => { releaseShow(TV_SHOW); await add; });
    setDoc.mockClear();

    // The document is deleted. A mark that outlived it would send this un-tick down the
    // merge branch and re-create the identity-less fragment.
    await act(async () => {
      await updateProgressRef!('tv', 1399, 0, 0);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  // Kills a mutant the first round of tests left alive: deleting the `mediaType === 'tv'`
  // guard changed nothing observable. No production caller can pass a film (films have no
  // episodes, verified by grep — all six call sites pass 'tv'), so the guard's only job is
  // to stop a FUTURE caller from adding one, and the payload hardcodes mediaType: 'tv'.
  it('BIN-954: the add branch is TV-only — a progress write never adds a film', async () => {
    await mountSeeded([]);

    await act(async () => {
      await updateProgressRef!('movie', 550, 1, 1, { addIfMissing: true });
    });

    expect(getTVShowLite).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  // Kills the other surviving mutant: moving the session mark to BEFORE the write left the
  // suite green, because `known` is computed before any await, so no sequence of SUCCESSFUL
  // calls can tell the two apart. A FAILED write can — and that is exactly the property the
  // ordering exists for.
  it('BIN-954: an add whose write FAILS stays retryable — the session mark is never a lie', async () => {
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await mountSeeded([]);
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await act(async () => {
      await expect(updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true })).rejects.toThrow();
    });

    // The write never landed, so the document does not exist. Marking it as present before
    // the write would send the next gesture down the merge branch — a create of the very
    // fragment this ticket removes. The retry must be a full add.
    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 6, { addIfMissing: true });
    });

    expect(setDoc).toHaveBeenCalledTimes(2);
    const [, second] = setDoc.mock.calls[1] as [unknown, Record<string, unknown>];
    expect(second.tmdbId).toBe(1399);
    expect(second.mediaType).toBe('tv');
    expect(second.status).toBe('mina');
  });

  // BIN-955. The window BIN-954's session mark structurally cannot cover: it is written
  // AFTER the add resolves, so two ticks issued before either TMDB fetch lands both read
  // "absent" and both enter the add branch. Nothing disables the checkboxes while a write
  // is in flight, so this is a gesture a user can perform. Driven with a held fetch rather
  // than by hoping two calls interleave — the state appears and vanishes, so it has to be
  // held open to be observed at all.
  it('BIN-955: two concurrent ticks on the same untracked series add it exactly ONCE', async () => {
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let first!: Promise<ItemWriteOutcome>;
    let second!: Promise<ItemWriteOutcome>;
    await act(async () => {
      first = updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
      second = updateProgressRef!('tv', 1399, 2, 6, { addIfMissing: true });
    });
    // Deliberately NOT asserting the fetch count mid-flight: the branch's `await
    // import('@/lib/tmdb/client')` is a real dynamic import, so whether it has resolved by
    // this point depends on whether an earlier test in the file already warmed the module
    // cache — green in a full run, red when this test is run alone. The counts below say
    // the same thing and say it after both calls have settled.
    await act(async () => {
      releaseShow(TV_SHOW);
      await Promise.all([first, second]);
    });

    // One fetch, one add, one analytics event — for one logical add.
    expect(getTVShowLite).toHaveBeenCalledTimes(1);
    expect(trackEvent.mock.calls.filter(c => c[0] === 'title_added_watchlist')).toHaveLength(1);
    expect(setDoc).toHaveBeenCalledTimes(2);
    const [, add] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(add.tmdbId).toBe(1399);
    expect(add.status).toBe('mina');
    // The waiter's own position still lands — as an UPDATE onto the document the first
    // call created, never as a second add.
    const [, update] = setDoc.mock.calls[1] as [unknown, Record<string, unknown>];
    expect(update.lastWatchedEpisode).toBe(6);
    expect(update.tmdbId).toBeUndefined();
    expect(update.status).toBeUndefined();
  });

  // BIN-955, the direction that matters more than the duplicate: a waiter must read a
  // FAILED add as "the document does not exist". The auto-advance carries no add intent,
  // so if it believed the add had landed it would merge onto a missing document — a create,
  // and the identity-less fragment BIN-954 removed.
  it('BIN-955: a concurrent auto-advance writes nothing when the add it waited for FAILED', async () => {
    await mountSeeded([]);
    let rejectShow: (err: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise((_resolve, reject) => { rejectShow = reject; }));

    let tick!: Promise<ItemWriteOutcome>;
    let advance!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
      advance = updateProgressRef!('tv', 1399, 3, 0); // no flag — the auto-advance
    });

    await act(async () => {
      rejectShow(new Error('tmdb down'));
      await Promise.all([tick, advance]);
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(await advance).toBe('refused');
    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ scope: 'watchlist', kind: 'updateProgress-add' }),
    );

    // And the in-flight entry did not outlive its own promise: the next tick adds for real.
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await act(async () => {
      await updateProgressRef!('tv', 1399, 2, 11, { addIfMissing: true });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.tmdbId).toBe(1399);
  });

  // BIN-955, the other way an add can fail — and the one the waiter's own `.catch` exists
  // for. A TMDB failure is caught INSIDE the add and reported as "did not happen"; a
  // REFUSED WRITE rejects, and that rejection belongs to the gesture that made it. The
  // waiter must read it as "the document does not exist" rather than inherit the error, and
  // must certainly not read it as success: a `.catch(() => true)` here sends the
  // auto-advance's merge onto a document Firestore just refused to create.
  it('BIN-955: a REFUSED add is not success for the call waiting on it', async () => {
    getTVShowLite.mockResolvedValue(TV_SHOW);
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));

    let tickError: unknown;
    let tick!: Promise<unknown>;
    let advance!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true })
        .catch((err: unknown) => { tickError = err; });
      advance = updateProgressRef!('tv', 1399, 3, 0); // no flag — the auto-advance
    });

    await act(async () => {
      releaseShow(TV_SHOW);
      await Promise.all([tick, advance]);
    });

    // The add rejected, and that rejection stayed with the gesture that made it.
    expect(tickError).toBeInstanceOf(Error);
    // One attempt, the refused one. A second setDoc here would be the auto-advance merging
    // onto a document that does not exist — a create, and the fragment BIN-954 removed.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(await advance).toBe('refused');
  });

  // BIN-965. Three tests for one gesture, because the three ways it can go wrong are
  // independent. The verifier on the 2026-08-22 batch found the first, four reviewers
  // having passed it; the other two came out of the blind role critique on the first
  // attempted fix, which reported the outcome correctly and still let the write out.
  // All three are driven with a held TMDB fetch — the state appears and vanishes.
  it('BIN-965: a removal mid-flight cancels the add itself — the deleted series stays deleted', async () => {
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let tick!: Promise<ItemWriteOutcome>;
    let advance!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
      advance = updateProgressRef!('tv', 1399, 3, 0); // no flag — the auto-advance, a waiter
    });

    await act(async () => { await removeItemRef!('tv', 1399); });
    await act(async () => {
      releaseShow(TV_SHOW);
      await Promise.all([tick, advance]);
    });

    // NOT "one write, correctly reported" — none. The add's own payload carries tmdbId,
    // mediaType, status and title, so BIN-942's floor would have passed it and the series
    // the user just deleted would be back in the library.
    expect(setDoc).not.toHaveBeenCalled();
    expect(await tick).toBe('refused');
    expect(await advance).toBe('refused');
    // And nothing claims a status for a title that is gone.
    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalled());
    expect(syncProgressToGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ tmdbId: 1399, status: null }),
    );
  });

  // The half a session-wide counter cannot express. `removalTickRef` counts EVERY removal
  // by design — over-declining costs one redundant re-add, which is the right trade for the
  // session mark it gates. Letting that same value decide whether a write goes out, or what
  // the caller is told, makes an unrelated title's removal refuse this one.
  it('BIN-965: removing a DIFFERENT title does not disturb an add in flight', async () => {
    await mountSeeded([seedDoc({ tmdbId: 550, mediaType: 'movie' })]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let tick!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
    });
    await act(async () => { await removeItemRef!('movie', 550); });
    await act(async () => { releaseShow(TV_SHOW); await tick; });

    // The add landed, and says so.
    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, added] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(added.tmdbId).toBe(1399);
    expect(await tick).toBe('written');
    await vi.waitFor(() => expect(syncProgressToGroups).toHaveBeenCalled());
    expect(syncProgressToGroups).toHaveBeenLastCalledWith(
      expect.objectContaining({ tmdbId: 1399, status: 'mina' }),
    );
  });

  // The waiter's own add intent. Once the promise it waited on answers "does not exist", a
  // second tick carrying `addIfMissing` falls into the add branch on its own account — and
  // would re-add the very title the removal just took away, with a second TMDB fetch and a
  // second analytics event. Its snapshot is taken at the TOP of updateProgress, before it
  // ever waited, which is what makes the removal visible to it.
  it('BIN-965: a second ticking waiter does not re-add the title the removal took away', async () => {
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let first!: Promise<ItemWriteOutcome>;
    let second!: Promise<ItemWriteOutcome>;
    await act(async () => {
      first = updateProgressRef!('tv', 1399, 2, 5, { addIfMissing: true });
      second = updateProgressRef!('tv', 1399, 2, 6, { addIfMissing: true });
    });
    await act(async () => { await removeItemRef!('tv', 1399); });
    await act(async () => {
      releaseShow(TV_SHOW);
      await Promise.all([first, second]);
    });

    expect(setDoc).not.toHaveBeenCalled();
    // One fetch, not two: the waiter bails before spending a second one.
    expect(getTVShowLite).toHaveBeenCalledTimes(1);
    expect(trackEvent.mock.calls.filter(c => c[0] === 'title_added_watchlist')).toHaveLength(0);
    expect(await first).toBe('refused');
    expect(await second).toBe('refused');
  });

  // The fourth case, and the one that forces the generation to COUNT rather than merely
  // mark. Every test above removes the title at most once, so `set(key, 1)` — "this title
  // has been removed" — is indistinguishable from `set(key, prev + 1)`. The Map is never
  // pruned and lives as long as the tab, so a second remove/re-add cycle on the same title
  // is an ordinary session, not an exotic one: with a constant, a call that snapshotted the
  // value after the FIRST removal sees no change after the second and writes the title back.
  // Found by mutation (test review, 2026-08-26): the constant survived all three above.
  it('BIN-965: a SECOND removal of the same title is still seen by an add in flight', async () => {
    await mountSeeded([]);
    // First removal — the title has a generation now.
    await act(async () => { await removeItemRef!('tv', 1399); });

    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));
    let tick!: Promise<ItemWriteOutcome>;
    await act(async () => {
      // Snapshots the generation as it stands AFTER the first removal.
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
    });

    // Second removal, while that add is in flight. A counter moves; a constant does not.
    await act(async () => { await removeItemRef!('tv', 1399); });
    await act(async () => { releaseShow(TV_SHOW); await tick; });

    expect(setDoc).not.toHaveBeenCalled();
    expect(await tick).toBe('refused');
  });

  // BIN-1011 — the OTHER deleting actor, and the one `removalGenRef` structurally cannot
  // see. `src/lib/firebase/accountDeletion.ts` deletes every watchlist document through
  // its own cascade, never through `removeItem`, so no generation is bumped. Driven with
  // a HELD TMDB fetch, because the marker goes down WHILE the add is in flight: a test
  // that sets it before calling `updateProgress` sets up a different situation, and never
  // reaches the branch this guards.
  //
  // What it costs to miss: the leftover row BIN-965 accepts is self-owned and re-deletable
  // with the same button. This one lands under a uid whose Auth account is about to be
  // gone, and the server sweep looks for Auth accounts WITHOUT a profile — so nothing ever
  // finds it again.
  it('BIN-1011: an account deletion starting mid-flight cancels the add', async () => {
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let tick!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
    });

    // `deleteAccount` puts the marker down BEFORE it runs the cascade. This is that
    // moment, and the add's fetch has not resolved yet.
    window.localStorage.setItem('binge:deletionStarted:u1', JSON.stringify({ startedAt: 1 }));
    try {
      await act(async () => { releaseShow(TV_SHOW); await tick; });

      expect(setDoc).not.toHaveBeenCalled();
      expect(await tick).toBe('refused');
    } finally {
      window.localStorage.removeItem('binge:deletionStarted:u1');
    }
  });

  it('BIN-1011: and the identical add still goes through with no deletion in flight (control)', async () => {
    // Without this the assertion above passes on an add that never ran at all — the
    // failure mode where the precondition is set wrong and the test is green for the
    // wrong reason.
    await mountSeeded([]);
    let releaseShow: (show: unknown) => void = () => {};
    getTVShowLite.mockReturnValue(new Promise(resolve => { releaseShow = resolve; }));

    let tick!: Promise<ItemWriteOutcome>;
    await act(async () => {
      tick = updateProgressRef!('tv', 1399, 2, 10, { addIfMissing: true });
    });
    await act(async () => { releaseShow(TV_SHOW); await tick; });

    expect(setDoc).toHaveBeenCalled();
    expect(await tick).toBe('written');
  });

  it('removeItem deletes the watchlist doc AND its sibling tags doc (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await removeItemRef!('tv', 9);
    });

    // The watchlist doc + the owner-only tags AND notes docs are removed so
    // neither orphans (their own collections aren't cascaded by the watchlist delete).
    expect(deleteDoc).toHaveBeenCalledTimes(3);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlist/tv_9');
    expect((deleteDoc.mock.calls[1][0] as { _path: string })._path).toBe('users/u1/watchlistTags/tv_9');
    expect((deleteDoc.mock.calls[2][0] as { _path: string })._path).toBe('users/u1/watchlistNotes/tv_9');
    expect(setDoc).not.toHaveBeenCalled();
  });

  // The batch's only user-visible data-model change. The pure helper cannot
  // preserve anything on its own — `addItem` is what writes — so these assertions
  // have to live here. Both stamps were previously UNCONDITIONAL; mutation-proven
  // that reverting either leaves every other test in this file green.
  it('the add path does NOT rewrite addedAt when re-marking a title already in the library', async () => {
    // addedAt drives Bibliotek's "Tillagd" sort, backlogResurface's oldest-first
    // ranking, taste/stats' 30-day counter and the GDPR export's "added" value.
    // Re-stamping it on a status change silently re-dated a years-old title.
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await upsertTitleRef!({ ...newTitle(9), status: 'avbruten' });
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/tv_9');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    // ABSENT, not null — addItem merges, so an omitted key preserves the stored date.
    expect('addedAt' in payload).toBe(false);
    // …and the same re-mark must not re-certify carried-forward TMDB data as fresh,
    // which would make the static field group un-sweepable for another 5 months.
    expect('tmdbFieldsRefreshedAt' in payload).toBe(false);
  });

  it('the add path DOES stamp addedAt + tmdbFieldsRefreshedAt on a genuine new add', async () => {
    // The other half of the guard: omitting these on a real first add would leave a
    // doc that sorts nowhere (toDate(undefined) re-dates it on every read) and that
    // the ToS sweep would treat as stale.
    await mountSeeded([]);

    await act(async () => {
      await upsertTitleRef!(newTitle(77));
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/tv_77');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.addedAt).toBe('ts'); // serverTimestamp sentinel
    expect(payload.tmdbFieldsRefreshedAt).toBe('ts');
  });

  it('COLD LOAD: the two stamps deliberately DIVERGE — addedAt is written, tmdbFieldsRefreshedAt is not', async () => {
    // The branch the production comment defends, and the reason it says "do not
    // unify these guards". Both new tests above run with the snapshot SETTLED, so a
    // refactor collapsing the two conditions either way would leave them green.
    //
    // The asymmetry: `addedAt` is gated on `current || listenerFailed`, so during a cold
    // load (items === []) it still writes — a doc landing without addedAt sorts
    // nowhere and never recovers. `tmdbFieldsRefreshedAt` additionally requires the
    // snapshot to have settled, so it stays SILENT here — an absent freshness stamp
    // is repaired by the title-page lazy refresh, whereas a false-fresh one would
    // suppress that repair for 90 days.
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();
    // Deliberately do NOT invoke snapshotCallback — this is the unsettled window.
    expect(snapshotCallback).not.toBeNull();

    await act(async () => {
      await upsertTitleRef!(newTitle(101));
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/tv_101');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.addedAt).toBe('ts');
    expect('tmdbFieldsRefreshedAt' in payload).toBe(false);
    // BIN-593 joins the STRICT camp — a stomped watch date is unrecoverable, a
    // missing one is user-fixable via the date picker. Three-way divergence now.
    expect('watchedAt' in payload).toBe(false);
  });

  // ── BIN-641 — only a deliberate "Sedd igen" counts a rewatch ────────────────
  // Malin, 2026-07-31: only a deliberate "Sedd igen" counts. Re-picking the
  // status a title already has must not — that gesture is ambiguous, and
  // rewatchCount is editable nowhere. addItem is also the BULK path, so the
  // decision cannot live in the transition alone: the caller states intent.
  describe('BIN-641: rewatch counting on the add path', () => {
    const seenFilm = (rewatchCount = 0) =>
      seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount });
    const markSeen = () => ({ ...newTitle(42, 'movie'), status: 'sedd' as const });
    // LAST write to that doc, not the first — the key-set test below writes twice.
    const lastPayload = (path: string): Record<string, unknown> => {
      const calls = setDoc.mock.calls.filter(c => (c[0] as { _path: string })._path === path);
      expect(calls.length).toBeGreaterThan(0);
      return calls[calls.length - 1][1] as Record<string, unknown>;
    };

    it('counts a rewatch when the caller says a human logged a re-viewing', async () => {
      // BIN-655: the intent is the ENTRY POINT now. This is `logViewing`, the only
      // write that may count — and `upsertTitle` right below is the same payload
      // through the other door, counting nothing.
      await mountSeeded([seenFilm(2)]);
      await act(async () => { await logViewingRef!(markSeen()); });
      expect(lastPayload('users/u1/watchlist/movie_42').rewatchCount).toBe(3);
    });

    it('counts NOTHING for the same write without that intent', async () => {
      // This is the ordinary "Sedd" tap — re-picking the status a title already has,
      // which Malin ruled must not count — AND every bulk caller. Counting on the
      // transition alone would count both.
      await mountSeeded([seenFilm(2)]);
      await act(async () => { await upsertTitleRef!(markSeen()); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    // BIN-895. The confirmation toast has to describe THIS write, and it cannot see
    // `current` — it holds the row as it was at render, while the write re-reads the
    // live ref after its own await. So the write reports back, and what it reports has
    // to be the payload's own answer: asserted against `rewatchCount` in the SAME
    // payload, so a report derived from anything else shows up as a disagreement.
    it('reports the counted rewatch back to the caller', async () => {
      await mountSeeded([seenFilm(2)]);
      let outcome: TitleWriteOutcome | null = null;
      await act(async () => { outcome = await logViewingRef!(markSeen()); });
      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect(payload.rewatchCount).toBe(3);
      expect(outcome).toEqual({ countedRewatch: true });
    });

    it('reports NO count back when the same write counts nothing', async () => {
      // The half that matters: a report hard-coded to the intent (or to the caller's
      // stale view of the status) would claim a rewatch here, on a write that carries
      // no rewatchCount at all. That sentence is the only place the user is ever told
      // a permanent counter moved.
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se' })]);
      let outcome: TitleWriteOutcome | null = null;
      await act(async () => { outcome = await logViewingRef!(markSeen()); });
      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect('rewatchCount' in payload).toBe(false);
      expect(outcome).toEqual({ countedRewatch: false });
    });

    it('counts nothing on a FIRST viewing, however the caller asks', async () => {
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se' })]);
      await act(async () => { await logViewingRef!(markSeen()); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    it('counts nothing for a series — only film has a terminal sedd', async () => {
      await mountSeeded([seedDoc({ tmdbId: 7, status: 'mina' })]);
      await act(async () => { await logViewingRef!(newTitle(7)); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/tv_7')).toBe(false);
    });

    // The re-date gates on the COUNTED OUTCOME, not on the intent flag. Without
    // that, intent on a tracked title that is NOT sedd would stomp the stored
    // date while counting nothing — a write that re-dates without counting is
    // incoherent, and watchedAt is user-authored.
    it('neither counts nor re-dates a tracked film that is not sedd', async () => {
      const STORED = new Date('2019-04-02T00:00:00Z');
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se', watchedAt: STORED })]);
      await act(async () => { await logViewingRef!(markSeen()); });

      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect('rewatchCount' in payload).toBe(false);
      expect('watchedAt' in payload).toBe(false);
    });

    it('counts nothing during a cold load, when the library is not known yet', async () => {
      // itemsRef is empty, so a re-mark is indistinguishable from a new add. The
      // count is not user-fixable, so an unsettled snapshot guesses nothing.
      render(<WatchlistProvider><Harness /></WatchlistProvider>);
      await act(async () => { await logViewingRef!(markSeen()); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
      // …and stamps no date either. Intent must not short-circuit the BIN-593
      // tri-state: re-dating OVERWRITES user-authored data, so an unknown
      // library state says nothing rather than guessing.
      expect('watchedAt' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    // BIN-641 + BIN-593 — the one case that OVERWRITES a stored date. Malin,
    // 2026-07-31: "Sedd igen" is the user manually saying they watched it now,
    // which is the carve-out BIN-593 leaves open. Without this the count says
    // x2 while Dagbok and Statistik keep crediting the original viewing.
    it('re-dates the film to now, replacing the stored date', async () => {
      const STORED = new Date('2019-04-02T00:00:00Z');
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount: 1, watchedAt: STORED })]);
      await act(async () => { await logViewingRef!(markSeen()); });

      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect(payload.watchedAt).toBe('ts');
      expect(payload.rewatchCount).toBe(2);
    });

    // …and the ordinary re-mark still must NOT (BIN-593 unchanged).
    it('leaves the stored date alone without that intent', async () => {
      const STORED = new Date('2019-04-02T00:00:00Z');
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);
      await act(async () => { await upsertTitleRef!(markSeen()); });

      expect('watchedAt' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    // #14 Software Architect's binding acceptance criterion, and BIN-655 made it
    // structural: intent is no longer a parameter that COULD leak into the payload —
    // it is which function you called, and neither takes a second argument. The
    // assertion is kept and sharpened, because it is now the parity check between
    // the two entry points: same title, same payload, different door.
    //
    // Why it matters at all: WatchlistAddPayload is contractually the exact key set
    // written to Firestore, and isValidWatchlistItem uses a hasOnly allowlist — a
    // stray key either lands as junk or fails the whole merge-write with
    // permission-denied. That already happened once, with `notes`.
    it('the two entry points differ ONLY by the counter and the re-date', async () => {
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount: 2, watchedAt: new Date('2019-04-02T00:00:00Z') })]);
      await act(async () => { await logViewingRef!(markSeen()); });
      const withIntent = Object.keys(lastPayload('users/u1/watchlist/movie_42'));

      setDoc.mockClear();
      await act(async () => { await upsertTitleRef!(markSeen()); });
      const without = Object.keys(lastPayload('users/u1/watchlist/movie_42'));

      expect(withIntent).not.toContain('countsAsViewing');
      // The only differences the INTENT may make to the DOCUMENT are the counter and
      // the re-date. Everything else must be the same key set — and no intent field
      // may appear, which is the half that protects the hasOnly rule.
      expect(withIntent.filter(k => k !== 'rewatchCount' && k !== 'watchedAt').sort()).toEqual(without.sort());
    });
  });

  // ── BIN-593 — watchedAt is user-authored data ────────────────────────────────
  // Malin, 2026-07-25: "har man manuellt justerat 'sett' ska det bara ändras om
  // man själv manuellt ändrar igen". addItem is the re-mark path (useMarkSeen /
  // StatusButton / QuickAddButton), and it used to write serverTimestamp() on
  // every 'sedd' and an explicit null on every other status.

  it('BIN-593: the add path does NOT rewrite watchedAt when the film already has one (re-mark)', async () => {
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 31, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await upsertTitleRef!(newTitle(31, 'movie')); // status 'sedd' — a rewatch re-mark
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_31');
    expect(call).toBeDefined();
    // ABSENT, not null — addItem merges, so an omitted key preserves the backdated date.
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-593: the add path DOES stamp the first watchedAt (new add, and a seen-mark of a title that has none)', async () => {
    // Both halves of "stamp only when we know there is none".
    await mountSeeded([seedDoc({ tmdbId: 32, mediaType: 'movie', status: 'vill_se' })]);

    await act(async () => {
      await upsertTitleRef!(newTitle(32, 'movie')); // vill_se → sedd, no stored date
      await upsertTitleRef!(newTitle(33, 'movie')); // genuinely new, status 'sedd'
    });

    for (const id of [32, 33]) {
      const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === `users/u1/watchlist/movie_${id}`);
      expect(call).toBeDefined();
      expect((call![1] as Record<string, unknown>).watchedAt).toBe('ts');
    }
  });

  it('BIN-593: the add path never writes a null watchedAt when the status is not sedd', async () => {
    // The other data-loss half: the old code wrote `watchedAt: null` on every
    // non-sedd status, erasing the date the moment a film left 'sedd'.
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 34, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await upsertTitleRef!({ ...newTitle(34, 'movie'), status: 'avbruten' });
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_34');
    expect(call).toBeDefined();
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-593: updateStatus forwards the stored watchedAt so the helper can protect it', async () => {
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 35, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await updateStatusRef!('movie', 35, 'sedd');
    });

    const [, opts] = buildStatusUpdate.mock.calls[0] as [WatchStatus, Record<string, unknown>];
    expect(opts.currentWatchedAt).toBe(STORED);
  });

  it('BIN-593: updateStatus reports a KNOWN-absent date as null — both when found dateless and when genuinely new', async () => {
    // This is the `null` half of the tri-state only; the `undefined` (cold-load)
    // half is pinned by the COLD LOAD test below, and collapsing the two is what
    // the pair guards against. Named for what it asserts — an earlier name
    // promised both directions while every assertion here checks null.
    await mountSeeded([seedDoc({ tmdbId: 36, mediaType: 'movie', status: 'vill_se' })]);
    await act(async () => {
      await updateStatusRef!('movie', 36, 'sedd');
    });
    expect((buildStatusUpdate.mock.calls[0][1] as Record<string, unknown>).currentWatchedAt).toBe(null);

    // A title absent from a SETTLED snapshot is genuinely new → null.
    buildStatusUpdate.mockClear();
    await act(async () => {
      await updateStatusRef!('movie', 999, 'sedd');
    });
    expect((buildStatusUpdate.mock.calls[0][1] as Record<string, unknown>).currentWatchedAt).toBe(null);
  });

  it('BIN-593: COLD LOAD — updateStatus reports the watch date as unknown, not absent', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();
    // Deliberately do NOT invoke snapshotCallback — the unsettled window.

    await act(async () => {
      await updateStatusRef!('movie', 37, 'sedd');
    });

    const opts = buildStatusUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect('currentWatchedAt' in opts).toBe(true);
    expect(opts.currentWatchedAt).toBeUndefined();
  });

  it('BIN-593: a mutator reads the LIVE snapshot, not the render closure it was created in', async () => {
    // The race the itemsRef exists for. addItem awaits fsdb() — a dynamic import
    // that can take hundreds of ms — before deciding what to write, so the first
    // snapshot can land mid-call. Reading the closure's `items` there would pair
    // an EMPTY list with an already-flipped settled-ref, resolve "unknown" to
    // "known-absent", and stamp over the backdated date. Capturing the closure
    // BEFORE the snapshot and invoking it after reproduces exactly that pairing.
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([]); // settled, empty → this closure sees items === []
    const staleAddItem = upsertTitleRef!;

    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 41, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]));
    });

    await act(async () => {
      await staleAddItem(newTitle(41, 'movie')); // status 'sedd' — a re-mark
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_41');
    expect(call).toBeDefined();
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
    // …and the same freshness must protect the sibling add-time stamps.
    expect('addedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-593: a title removed then immediately re-added as sedd gets a FRESH date', async () => {
    // The write side of the itemsRef invariant (the test above covers the read
    // side). removeItem deletes the doc, but the snapshot echo takes a moment —
    // and it awaits two more sibling deletes before returning. Until the ref is
    // pruned it still holds the deleted row WITH its 2019 date, so the guard would
    // read that as "a date is stored", omit the key, and leave the brand-new doc
    // dateless. Required finding from binge-test-reviewer: commenting out the
    // prune left all other tests in this file green.
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 51, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await removeItemRef!('movie', 51);
      // Deliberately NO new snapshot in between — that is the window.
      await upsertTitleRef!(newTitle(51, 'movie')); // status 'sedd'
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_51');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.watchedAt).toBe('ts');
    // …and it really is treated as a new doc, not a re-mark.
    expect(payload.addedAt).toBe('ts');
  });

  // ── BIN-595 — a per-title privacy override must survive a status change ──────
  // addItem is also the re-mark path, and it wrote the PROFILE-WIDE default over
  // the two denormalised visibility fields unconditionally. On a public profile that
  // WOULD republish a title the user had deliberately hidden, on nothing more than a
  // status change. Conditional, not past tense: no released version ever shipped a UI
  // for the per-title override, so that state has never existed in real data — these
  // tests pin the guard for when it does.

  it('BIN-595: re-marking a title the user HID does not republish it', async () => {
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([seedDoc({
      tmdbId: 61, mediaType: 'movie', status: 'vill_se',
      visibility: 'private', effectiveVisibility: 'private', isPublic: false,
    })]);

    await act(async () => {
      await upsertTitleRef!(newTitle(61, 'movie')); // status 'sedd' — an ordinary re-mark
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_61');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    // ABSENT, not 'private' — the write merges, so omitting preserves the stored
    // value. Writing ANYTHING here is what leaked the title.
    expect('effectiveVisibility' in payload).toBe(false);
    expect('isPublic' in payload).toBe(false);
  });

  it('BIN-595: a title WITHOUT an override still gets the visibility re-assert (A4.3)', async () => {
    // The other half. This lazy-on-write stamp is how pre-cascade docs acquire the
    // denormalised fields at all — suppressing it wholesale would be its own bug.
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([seedDoc({ tmdbId: 62, mediaType: 'movie', status: 'vill_se' })]);

    await act(async () => {
      await upsertTitleRef!(newTitle(62, 'movie'));
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_62');
    const payload = call![1] as Record<string, unknown>;
    expect(payload.effectiveVisibility).toBe('public');
    expect(payload.isPublic).toBe(true);
  });

  it('BIN-595: a title NOT in the local snapshot still gets the visibility fields', async () => {
    // The most common real add path. It is NOT the only one where the live
    // `itemsRef.current.find(...)` returns undefined — a re-mark during a cold load
    // does too, since itemsRef is [] until the first snapshot lands, and THAT is the
    // case BIN-598 has to reason about for the six sibling mutators. Both stamp
    // today; the guard does not distinguish them. The two "should stamp" tests
    // above both seed the title first, so end-to-end this branch was unexercised —
    // a guard that refused to stamp new docs would have left every new title
    // relying on the rules' legacy parent-profile fallback, and all of them stayed
    // green.
    //
    // Deliberately NOT framed as "on a settled snapshot": shouldStampVisibility
    // never reads firstSnapshotSettledRef, so this passes identically during a cold
    // load. An earlier version of the guard DID branch on settledness and was
    // reverted; the old name was a holdover that overclaimed sensitivity to
    // snapshot timing.
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([]); // settled, and empty — nothing for the lookup to find

    await act(async () => {
      await upsertTitleRef!(newTitle(64, 'movie'));
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_64');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.effectiveVisibility).toBe('public');
    expect(payload.isPublic).toBe(true);
  });

  it('BIN-593: COLD LOAD — the add path stays silent about watchedAt', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();

    await act(async () => {
      await upsertTitleRef!(newTitle(38, 'movie')); // status 'sedd'
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_38');
    expect(call).toBeDefined();
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-505: the add path never writes a non-null inline note to the watchlist doc', async () => {
    // addItem is also the re-mark path (QuickAddButton/StatusButton/useMarkSeen
    // pass current?.notes to preserve it). notes now lives in watchlistNotes and
    // the watchlist-doc rules reject a non-null inline note — so the write must
    // NOT carry `notes`, else re-marking a noted title is permission-denied.
    await mountSeeded([]);
    await act(async () => {
      await upsertTitleRef!({ ...newTitle(77), notes: 'en privat anteckning' });
    });
    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/tv_77');
    expect(call).toBeDefined();
    expect('notes' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('updateTags writes normalized tags to the owner-only tags doc (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      // Duplicate + whitespace → normalizeTags collapses to one clean tag.
      await updateTagsRef!('tv', 9, ['  Mysrys ', 'mysrys']);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlistTags/tv_9');
    // BIN-560 Phase 4: the tags doc carries the self-describing mediaType field.
    expect(payload).toEqual({ tags: ['Mysrys'], mediaType: 'tv' });
  });

  it('updateTags deletes the tags doc when cleared to empty (BIN-164)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await updateTagsRef!('tv', 9, ['   ']); // normalizes to []
    });

    expect(setDoc).not.toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlistTags/tv_9');
  });

  // BIN-349: ratedAt stamps rating-recency; the serverTimestamp mock returns 'ts'.
  it('updateRating stamps ratedAt when a rating is set (BIN-349)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9, rating: null })]);

    await act(async () => {
      await updateRatingRef!('tv', 9, 5);
    });

    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/tv_9');
    expect(payload.rating).toBe(5);
    expect(payload.ratedAt).toBe('ts'); // serverTimestamp sentinel
  });

  it('updateRating clears ratedAt to null when the rating is unset (BIN-349)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9, rating: 4 })]);

    await act(async () => {
      await updateRatingRef!('tv', 9, null);
    });

    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.rating).toBeNull();
    // A stale rating-recency must NOT survive a cleared rating.
    expect(payload.ratedAt).toBeNull();
  });

  it('the add path stamps ratedAt on a new/changed rating, NOT on a same-rating re-mark (BIN-349)', async () => {
    // Seed an already-rated in-library title (id 60, rating 5).
    await mountSeeded([seedDoc({ tmdbId: 60, mediaType: 'movie', status: 'sedd', rating: 5 })]);

    // Re-mark it via the addItem merge-write path (useMarkSeen/StatusButton/
    // QuickAddButton) carrying the UNCHANGED rating → ratedAt must NOT be written
    // (a blind stamp here re-bumped recency — the exact bug this fix closes).
    await act(async () => { await upsertTitleRef!({ ...newTitle(60, 'movie'), rating: 5 }); });
    let payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('ratedAt' in payload).toBe(false);

    // A brand-new pre-rated title (CSV import) → stamped.
    await act(async () => { await upsertTitleRef!({ ...newTitle(61, 'movie'), rating: 5 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A re-mark that genuinely CHANGES the rating (5 → 4) → stamped.
    await act(async () => { await upsertTitleRef!({ ...newTitle(60, 'movie'), rating: 4 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A brand-new unrated title → no ratedAt key at all.
    await act(async () => { await upsertTitleRef!({ ...newTitle(62, 'movie'), rating: null }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('ratedAt' in payload).toBe(false);
  });
});

// BIN-522: pin the BIN-505 notes invariants that reviewers previously verified
// only by manual trace — (1) a note write NEVER bumps updatedAt on the watchlist
// doc (a note edit must not surface as fake "activity" in followers' feeds nor
// leak the timing of a private edit), (2) the eager inline-note migration never
// writes a previous account's notes under a new uid on a same-session account
// switch (itemsUidRef cross-account guard), and (3) updateNotes skips the
// item-doc write entirely on a true no-op (no inline note to strip, visibility
// already stamped) so a note edit costs one billed write.
describe('WatchlistContext — updateNotes + eager notes migration (BIN-505/BIN-522)', () => {
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
    return view;
  }

  function callsTo(pathPrefix: string) {
    return setDoc.mock.calls.filter(c => (c[0] as { _path: string })._path.startsWith(pathPrefix));
  }

  // BIN-942 — the one create-floor-exposed write that deliberately keeps THROWING.
  //
  // The item-doc write here is batched atomically with the user's own note text, so a
  // refusal discards what they just typed; a silent swallow would make a lost note look
  // like a saved one. Same rule as the add path, opposite of the six edits that ARE
  // swallowed. Nothing pinned that decision until now, so a later "make it consistent with
  // the six" tidy-up would reopen it with the whole suite green.
  //
  // `captureError` is asserted beside the rejection because the caller does not await this
  // (`NotesBlock`'s onChange returns void), so the only signal that survives is the tagged
  // Sentry report — which is exactly what the dated deviation entry names as its re-open
  // trigger. Untagged, it would be indistinguishable from every other unhandled rejection.
  it('a floor refusal REJECTS rather than being swallowed — and is tagged (BIN-942)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);
    batchCommit.mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }),
    );

    await act(async () => {
      await expect(updateNotesRef!('tv', 5, 'min anteckning')).rejects.toThrow();
    });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'permission-denied' }),
      expect.objectContaining({ scope: 'watchlist', kind: 'updateNotes' }),
    );
  });

  // BIN-533: the eager migration's async IIFE (`await fsdb()` then `await
  // batch.commit()`, both no-internal-await mocks) needs a couple of
  // microtask ticks to register its setDoc calls — act() only flushes work
  // that drives a React state update, and this async tail drives none. The
  // old `vi.waitFor` polled with REAL timers to catch it, which could rarely
  // miss under CI load (~1/31 runs). Draining a fixed number of microtask
  // ticks is deterministic — no wall-clock dependency — while still waiting
  // for the exact same completion signal.
  async function flushMigration() {
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  it('updateNotes writes the note to the owner-only subcollection and strips the inline note WITHOUT bumping updatedAt', async () => {
    // Legacy title: inline note still on the doc, visibility never stamped →
    // the item-doc write is needed (strip + visibility re-stamp) but must not
    // carry updatedAt. The notes snapshot lands in the same batch so the eager
    // migration sees the note as already-migrated and stays out of the way —
    // this test isolates the updateNotes path.
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // BIN-533: land the notes subcollection snapshot BEFORE the watchlist
    // items snapshot. Both used to fire in the same act() in the opposite
    // order, relying on React auto-batching both setState calls into a
    // single render — if a rare scheduling hiccup rendered them separately,
    // the intermediate render (item has an inline note, notesByTmdbId still
    // empty) would trip the eager migration for real, and its async tail
    // could land its writes inside a LATER act() and intermittently double
    // up the updateNotes assertions below. With notes landing first, no
    // ordering of the two setState calls can ever produce that intermediate
    // state — deterministic regardless of batching.
    await act(async () => {
      notesSnapshotCallback!({ size: 1, docs: [{ id: 'tv_21', data: () => ({ note: 'gammal inline-anteckning' }) }] });
      snapshotCallback!(snap([seedDoc({ tmdbId: 21, notes: 'gammal inline-anteckning' })]));
    });
    expect(setDoc).not.toHaveBeenCalled(); // migration correctly idle

    await act(async () => {
      await updateNotesRef!('tv', 21, '  ny anteckning  ');
    });

    // Owner-only subcollection gets the trimmed note (+ self-describing mediaType).
    const noteCalls = callsTo('users/u1/watchlistNotes/tv_21');
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][1]).toEqual({ note: 'ny anteckning', mediaType: 'tv' });

    // The public/friends-readable watchlist doc: inline note stripped +
    // visibility stamped, and INVARIANT — no updatedAt (feed orders by it).
    const itemCalls = callsTo('users/u1/watchlist/tv_21');
    expect(itemCalls).toHaveLength(1);
    const payload = itemCalls[0][1] as Record<string, unknown>;
    expect(payload.notes).toBe('DELETE_FIELD');
    expect(payload.effectiveVisibility).toBe('private');
    expect('updatedAt' in payload).toBe(false);
  });

  it('updateNotes skips the item-doc write on a true no-op (no inline note, visibility already stamped) — BIN-522', async () => {
    await mountSeeded([seedDoc({ tmdbId: 22, visibility: 'private' })]);

    await act(async () => {
      await updateNotesRef!('tv', 22, 'en anteckning');
    });

    // Exactly ONE write: the owner-only note doc. No touch of the watchlist doc.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect((setDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlistNotes/tv_22');
    expect(callsTo('users/u1/watchlist/tv_22')).toHaveLength(0);
  });

  it('updateNotes(null) deletes the owner-only note doc (and still skips a no-op item write)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 23, visibility: 'private' })]);

    await act(async () => {
      await updateNotesRef!('tv', 23, '   '); // whitespace-only → cleared
    });

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlistNotes/tv_23');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('eager migration moves inline notes to watchlistNotes and strips them WITHOUT bumping updatedAt', async () => {
    await mountSeeded([seedDoc({ tmdbId: 50, notes: 'privat om en vän' })]);

    await flushMigration();
    expect(callsTo('users/u1/watchlistNotes/tv_50')).toHaveLength(1);
    expect(callsTo('users/u1/watchlistNotes/tv_50')[0][1]).toEqual({ note: 'privat om en vän', mediaType: 'tv' });

    const itemCalls = callsTo('users/u1/watchlist/tv_50');
    expect(itemCalls).toHaveLength(1);
    // System-only cleanup, not user activity: the inline field is deleted and
    // NOTHING else is written — no updatedAt, no visibility churn.
    expect(itemCalls[0][1]).toEqual({ notes: 'DELETE_FIELD' });
  });

  it('eager migration writes NOTHING while a deletion of this account is unfinished (BIN-816)', async () => {
    // `WatchlistProvider` mounts ABOVE `AppShell`, so it survives the swap to the
    // limbo screen and keeps running its auto-writers off the snapshot with no
    // user action at all. `isOwner(uid)` in firestore.rules never requires
    // users/{uid} to exist, so those writes land after the profile is gone —
    // and the server sweep, which looks for accounts WITHOUT a profile, can
    // never see them. Personal data outliving an Art. 17 request, not an untidy
    // screen (security + test review, 2026-08-13).
    window.localStorage.setItem('binge:deletionStarted:u1', JSON.stringify({ startedAt: 1 }));
    try {
      await mountSeeded([seedDoc({ tmdbId: 50, notes: 'privat anteckning' })]);
      await flushMigration();

      expect(setDoc).not.toHaveBeenCalled();
    } finally {
      window.localStorage.removeItem('binge:deletionStarted:u1');
    }
  });

  it('and resumes normally for an account with no deletion in flight (control)', async () => {
    // Without this, the assertion above passes on a migration that never runs.
    await mountSeeded([seedDoc({ tmdbId: 50, notes: 'privat anteckning' })]);
    await flushMigration();

    expect(callsTo('users/u1/watchlistNotes/tv_50')).toHaveLength(1);
  });

  it('eager migration never writes a previous account\'s notes under the new uid (itemsUidRef cross-account guard)', async () => {
    // Account A (u1) has a legacy inline note; its migration runs.
    const view = await mountSeeded([seedDoc({ tmdbId: 50, notes: 'A:s privata anteckning' })]);
    await flushMigration();
    expect(callsTo('users/u1/watchlistNotes/tv_50')).toHaveLength(1);
    setDoc.mockClear();

    // Same-session switch A→B: uid flips but B's watchlist snapshot has NOT
    // landed yet, so `items` still holds A's rows (and the per-uid migration
    // dedup set was just reset). Without the guard the migration would write
    // A's note under users/u2/watchlistNotes — a cross-account PII leak.
    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    expect(callsTo('users/u2/')).toHaveLength(0);
    expect(setDoc).not.toHaveBeenCalled();

    // Positive control: once B's OWN snapshot lands the migration runs for B —
    // the guard defers, it never dead-locks the new account.
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 60, notes: 'B:s egen anteckning' })]));
    });
    await flushMigration();
    expect(callsTo('users/u2/watchlistNotes/tv_60')).toHaveLength(1);
    expect(callsTo('users/u1/')).toHaveLength(0); // and nothing leaks back to A
  });
});

// BIN-508: hook-level coverage for the title-page lazy-refresh (refreshTmdbFields).
// The pure decision (planTmdbFieldsRefresh + the group-freshness predicates) is unit-
// tested in tmdbFieldsRefresh.test.ts; here we pin the CONTEXT wiring the pure layer
// can't see: the in-library guard, the echo-proof per-session dedupe, that the write
// is a merge that NEVER bumps updatedAt, and the BIN-468 independent gating (a stale
// providers group repairs even when the static stamp is fresh). We keep the REAL
// tmdbFieldsRefresh helpers (not mocked) so these tests exercise genuine gating.
describe('WatchlistContext — refreshTmdbFields lazy-refresh wiring (BIN-508/402/468)', () => {
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
  }

  it('repopulates the static TMDB block + freshness stamp for a swept-clean title (no updatedAt)', async () => {
    // No tmdbFieldsRefreshedAt on the doc → the sweep cleared it (or it was never
    // stamped) → the read-side must rewrite the denormalized block and re-stamp.
    await mountSeeded([seedDoc({ tmdbId: 77, title: 'Old', posterPath: null })]);

    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 77, { title: 'Fresh', posterPath: '/p.jpg', genreIds: [18], tmdbStatus: 'Ended' });
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>, unknown];
    expect(ref._path).toBe('users/u1/watchlist/tv_77');
    expect(opts).toEqual({ merge: true });
    // Static block re-written + re-stamped from the detail the title page already had.
    expect(payload.title).toBe('Fresh');
    expect(payload.posterPath).toBe('/p.jpg');
    expect(payload.genreIds).toEqual([18]);
    expect(payload.tmdbStatus).toBe('Ended');
    expect(payload.tmdbFieldsRefreshedAt).toBe('ts'); // serverTimestamp sentinel
    // INVARIANT: this silent denormalisation must never reorder "senast ändrad".
    expect('updatedAt' in payload).toBe(false);
  });

  it('de-dupes per session: a second call for the same title writes nothing (echo-proof)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 78 })]);

    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 78, { title: 'A' });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);

    // The pending serverTimestamp reads back null on the echo snapshot, which would
    // re-trip the staleness gate — the session dedupe must suppress the re-fire.
    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 78, { title: 'A' });
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the title is not in the library (only library titles carry the stamp)', async () => {
    await mountSeeded([]);
    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 999, { title: 'Ghost' });
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('does nothing when both the static stamp and the providers stamp are fresh', async () => {
    const now = new Date();
    await mountSeeded([seedDoc({ tmdbId: 79, tmdbFieldsRefreshedAt: now, providersCheckedAt: now })]);
    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 79, { title: 'B', providers: [8] });
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('BIN-468: a stale providers group repairs even when the static stamp is fresh (independent gating)', async () => {
    // Static freshly stamped, but providersCheckedAt absent → the providers group is
    // stale and must repair on its own — WITHOUT rewriting the static block/stamp.
    await mountSeeded([seedDoc({ tmdbId: 80, tmdbFieldsRefreshedAt: new Date() })]);

    await act(async () => {
      await refreshTmdbFieldsRef!('tv', 80, { title: 'C', providers: [8, 9] });
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    // Only the providers group is written (fallback), never the fresh static block.
    expect(payload.providers).toEqual([8, 9]);
    expect(payload.providersCheckedAt).toBe('ts');
    expect('title' in payload).toBe(false);
    expect('tmdbFieldsRefreshedAt' in payload).toBe(false);
    expect('updatedAt' in payload).toBe(false);
  });

  it('swallows a Firestore failure without throwing (best-effort, next view retries)', async () => {
    await mountSeeded([seedDoc({ tmdbId: 81 })]);
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));

    // Must resolve, not reject — a rejected best-effort write would surface as an
    // unhandled promise rejection (Sentry noise), the setRuntime-pattern this follows.
    await act(async () => {
      await expect(refreshTmdbFieldsRef!('tv', 81, { title: 'D' })).resolves.toBeUndefined();
    });
  });

  // BIN-957: the same swallow, now reported. See setRuntime's twin test for why both
  // halves are asserted together.
  it('BIN-957: reports a failed lazy-refresh to Sentry AND still swallows it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await mountSeeded([seedDoc({ tmdbId: 82 })]);
      setDoc.mockRejectedValueOnce(new Error('permission-denied'));

      await act(async () => {
        await expect(refreshTmdbFieldsRef!('tv', 82, { title: 'E' })).resolves.toBeUndefined();
      });

      expect(captureError).toHaveBeenCalledWith(
        expect.any(Error),
        { scope: 'watchlist', kind: 'refreshTmdbFields' },
      );
      expect(consoleError.mock.calls.some(c => String(c[0]).includes('tmdb-fields lazy-refresh'))).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
  });

  // BIN-560 Phase 4 COLLISION GUARD: a movie and a TV show sharing one tmdbId must
  // each get their own refresh in a session — the session-dedup key must be composite,
  // not bare `${uid}:${tmdbId}` (a bare key would let the first-viewed title starve the
  // second's sweep-protection stamp for the rest of the session).
  it('refreshes BOTH a movie and a same-numbered tv show in one session (composite dedup)', async () => {
    await mountSeeded([
      seedDoc({ tmdbId: 100, mediaType: 'movie' }),
      seedDoc({ tmdbId: 100, mediaType: 'tv' }),
    ]);

    await act(async () => {
      await refreshTmdbFieldsRef!('movie', 100, { title: 'M' });
      await refreshTmdbFieldsRef!('tv', 100, { title: 'T' });
    });

    // Two DISTINCT writes — one per namespaced doc — not one suppressed by a shared key.
    expect(setDoc).toHaveBeenCalledTimes(2);
    const paths = setDoc.mock.calls.map(c => (c[0] as { _path: string })._path).sort();
    expect(paths).toEqual(['users/u1/watchlist/movie_100', 'users/u1/watchlist/tv_100']);
  });
});

// BIN-601 + BIN-640 — a terminally failed watchlist listener.
//
// BIN-601: with the listener dead, `itemsRef` is empty, so every status change
// looks like a genuine new add and rewrites `addedAt` — silently re-dating a
// title that may be years old. Unrecoverable.
//
// BIN-640: simply not stamping trades that for a doc with NO addedAt, which
// `toDate()` reported as "added now" on every load, forever — top of Bibliotek's
// "Tillagd" sort and permanently inside the PUBLIC profile's 30-day counter. Also
// unrecoverable, because addItem is the only writer of the field.
//
// These drive the real error callback the provider registers. Poking a ref would
// pass even if the callback were never wired up, which is precisely the defect.
describe('WatchlistContext — dead listener: addedAt is neither destroyed nor faked (BIN-601/640)', () => {
  async function mount() {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
  }

  it('registers an error callback on the watchlist listen at all', () => {
    mount();
    // The premise every other test in this block rests on. Without it the
    // provider hangs in `loading` forever and never learns the listener died.
    expect(snapshotErrorCallback).toBeTypeOf('function');
  });

  it('does NOT rewrite addedAt on a re-mark once the listener has failed', async () => {
    mount();
    await act(async () => { snapshotErrorCallback!(); });

    // The user re-marks a title that has been in their library for years. The
    // library is invisible to us, so this looks exactly like a new add.
    await act(async () => { await upsertTitleRef!(newTitle(42)); });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('addedAt');
  });

  it('still stamps addedAt during an ordinary cold load — a dead listener is not an empty library', async () => {
    mount();
    // No error, no snapshot yet: the genuine-new-add path must keep working, or
    // every title added before the first snapshot lands with no date at all.
    await act(async () => { await upsertTitleRef!(newTitle(42)); });

    const payload = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.addedAt).toBe('ts');
  });

  it('resumes stamping once a snapshot proves the listener recovered', async () => {
    mount();
    await act(async () => { snapshotErrorCallback!(); });
    await act(async () => { snapshotCallback!(snap([])); });
    setDoc.mockClear();

    await act(async () => { await upsertTitleRef!(newTitle(42)); });

    const payload = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.addedAt).toBe('ts');
  });

  it('repairs a doc that has no stored addedAt, writing ONLY addedAt', async () => {
    mount();
    // A title added during an earlier outage: updatedAt present, addedAt absent.
    const updated = new Date('2025-11-20T18:30:00Z');
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: updated })]));
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/tv_7');
    // addedAt ONLY. An updatedAt here would surface a system repair as fake user
    // activity at the top of every follower's feed (feed queries order by it).
    expect(payload).toEqual({ addedAt: updated });
  });

  it('leaves a doc that already has addedAt completely alone', async () => {
    mount();
    await act(async () => {
      snapshotCallback!(snap([seedDoc({
        tmdbId: 7,
        addedAt: new Date('2024-03-01T09:00:00Z'),
        updatedAt: new Date('2025-11-20T18:30:00Z'),
      })]));
    });

    expect(setDoc).not.toHaveBeenCalled();
  });

  it('never repairs twice, even when the write failed and the field is still missing', async () => {
    // The guard has to be a session ref marked BEFORE the write, not "the field
    // exists now" — a failed write never makes it exist, and snapshot events fire
    // on ANY change in the collection, so the post-write reading is a retry storm.
    //
    // The failure is injected at COMMIT, which is the only place it is real: the
    // batch's own commit is what production awaits and catches. Rejecting the
    // per-doc spy instead would leave commit resolving, and the test would pass
    // against a version that marked the ref only after a successful write.
    batchCommit.mockRejectedValueOnce(new Error('permission-denied'));
    mount();
    const updated = new Date('2025-11-20T18:30:00Z');
    const stillMissing = snap([seedDoc({ tmdbId: 7, updatedAt: updated })]);

    await act(async () => { snapshotCallback!(stillMissing); });
    expect(setDoc).toHaveBeenCalledTimes(1);

    // An unrelated title changes; the same addedAt-less doc is in the snapshot.
    await act(async () => {
      snapshotCallback!(snap([
        seedDoc({ tmdbId: 7, updatedAt: updated }),
        seedDoc({ tmdbId: 8, addedAt: updated, updatedAt: updated }),
      ]));
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('addedAt-reparationen skriver INGENTING under en påbörjad radering (BIN-816)', async () => {
    // Systemisk skrivning, ingen användarhandling — samma resonemang som
    // notes-migreringen ovan. Den här effekten ligger i samma provider och
    // överlever på exakt samma sätt att skälet bytts ut mot limbo-skärmen.
    window.localStorage.setItem('binge:deletionStarted:u1', JSON.stringify({ startedAt: 1 }));
    try {
      mount();
      await act(async () => {
        snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: new Date('2025-11-20T18:30:00Z') })]));
      });

      expect(setDoc).not.toHaveBeenCalled();
    } finally {
      window.localStorage.removeItem('binge:deletionStarted:u1');
    }
  });

  it('does not repair a previous account\'s rows on a same-session uid switch', async () => {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    const updated = new Date('2025-11-20T18:30:00Z');
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: updated })]));
    });
    setDoc.mockClear();

    // A→B switch: uid flips but B's snapshot has NOT landed, so `items` still
    // holds A's rows — and the per-uid dedup set was just reset, making them
    // eligible again. Without the guard the repair writes A's dates under
    // users/u2, the same cross-account hazard the notes migration guards against.
    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });
    expect(setDoc).not.toHaveBeenCalled();

    // Positive control: once B's OWN snapshot lands the repair runs for B. The
    // guard defers; it never dead-locks the new account.
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 60, updatedAt: updated })]));
    });
    await act(async () => { await Promise.resolve(); });
    expect((setDoc.mock.calls as [{ _path: string }][]).map(c => c[0]._path))
      .toEqual(['users/u2/watchlist/tv_60']);
  });

  it('does NOT repair the local echo of an ordinary add — the hottest path in the app', async () => {
    // Firestore's latency-compensated local snapshot reports a still-pending
    // serverTimestamp() as null, so the echo of a genuine new add arrives as
    // { addedAt: null, updatedAt: null } — the both-missing shape. If that looked
    // repairable, EVERY add by EVERY user would fire an extra billed write
    // carrying a client-clock "now", racing the server timestamp it overwrites.
    // The `updatedAt != null` term in addedAtIsRepairable is what prevents it, and
    // this is the test that stops someone deleting it as dead weight.
    mount();
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 7, addedAt: null, updatedAt: null })]));
    });

    expect(setDoc).not.toHaveBeenCalled();
  });

  it('a second tab repairs independently — the bound is per session, not global', async () => {
    // Honest statement of the invariant: the dedup ref is per provider instance,
    // so two tabs holding the same stale snapshot each queue a write. Same value,
    // so harmless — but "exactly one write ever" would be a false claim, and a
    // future reader deserves the real one.
    const updated = new Date('2025-11-20T18:30:00Z');
    const tabA = render(<WatchlistProvider><Harness /></WatchlistProvider>);
    await act(async () => { snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: updated })])); });
    expect(setDoc).toHaveBeenCalledTimes(1);

    // A second tab mounts its own provider, with its own dedup set, and sees the
    // same not-yet-repaired doc.
    render(<WatchlistProvider><Harness /></WatchlistProvider>);
    await act(async () => { snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: updated })])); });

    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(setDoc.mock.calls[1][1]).toEqual({ addedAt: updated });
    tabA.unmount();
  });

  it('repairs a title touched TWICE during one outage to its LAST touch, not to now', async () => {
    // The honest cost of the updatedAt proxy: added, then marked seen, both while
    // the listener was down. The repair can only see the last write. Drift is
    // bounded by how long the outage lasted — stated rather than hidden.
    mount();
    const secondTouch = new Date('2025-11-25T08:00:00Z');
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 7, updatedAt: secondTouch })]));
    });

    const payload = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.addedAt).toEqual(secondTouch);
  });
});

// BIN-596 — what the ADD SURFACES have to gate on, and why `loading` cannot be it.
//
// `loading` flips to false in two states that call for opposite decisions: the
// first snapshot landed (we know the library) and the listener died (we never
// will, this session). StatusButton/QuickAddButton must hold their write in the
// second, so the context exposes the two facts separately.
describe('WatchlistContext — readiness the add surfaces gate on (BIN-596)', () => {
  async function mount() {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {});
  }

  it('starts as "we know nothing yet"', async () => {
    await mount();
    expect(readiness).toEqual({ loading: true, snapshotSettled: false, listenerFailed: false, libraryKnown: false });
  });

  it('a landed snapshot settles it', async () => {
    await mount();
    await act(async () => { snapshotCallback!(snap([doc(1)])); });
    expect(readiness).toEqual({ loading: false, snapshotSettled: true, listenerFailed: false, libraryKnown: true });
  });

  it('a dead listener stops loading WITHOUT ever claiming the library is known', async () => {
    // The distinction the whole ticket rests on. `loading` alone is false in both
    // this state and the one above — which is why gating on it would let a write
    // through against a library we never read.
    await mount();
    await act(async () => { snapshotErrorCallback!(); });
    expect(readiness).toEqual({ loading: false, snapshotSettled: false, listenerFailed: true, libraryKnown: false });
  });

  it('a recovering snapshot clears the failure and settles', async () => {
    await mount();
    await act(async () => { snapshotErrorCallback!(); });
    await act(async () => { snapshotCallback!(snap([doc(1)])); });
    expect(readiness).toEqual({ loading: false, snapshotSettled: true, listenerFailed: false, libraryKnown: true });
  });

  it('a failure AFTER a landed snapshot leaves settled true — and libraryKnown false', async () => {
    // The fourth combination, and the only one that tells `&&` from `||`. It is
    // also the state the whole ticket turns on: we still hold contents, so
    // `snapshotSettled` cannot honestly go back to false — but they are stale,
    // so nothing may write from them. Without this case a provider mutated to
    // `snapshotSettled || !listenerFailed` passes the entire suite.
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotCallback!(snap([doc(1)])); });
    expect(readiness?.libraryKnown).toBe(true);

    await act(async () => { snapshotErrorCallback!(); });

    expect(readiness).toEqual({
      loading: false, snapshotSettled: true, listenerFailed: true, libraryKnown: false,
    });
  });

  it('a uid switch goes back to unknown — the previous account\'s snapshot is not this one\'s', async () => {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotCallback!(snap([doc(1)])); });
    expect(readiness?.snapshotSettled).toBe(true);

    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });

    // Not merely "loading again": a button gated on `loading` alone would be held
    // here too, but so would one that had already concluded u1's library was u2's.
    expect(readiness).toEqual({ loading: true, snapshotSettled: false, listenerFailed: false, libraryKnown: false });
  });

  it('a NEW listener does not inherit the previous uid\'s failure', async () => {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotErrorCallback!(); });
    expect(readiness?.listenerFailed).toBe(true);

    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });

    expect(readiness?.listenerFailed).toBe(false);
  });
});

// BIN-700/BIN-755 — "Försök igen", the only way out of a dead listener.
//
// The failed state never ends on its own, so every surface that renders the
// failure (components/title/libraryHold.ts) offers `retryListener` as its retry.
// It had NO provider-level coverage at all: a mutant that made it inert — drop
// the nonce from the effect's dependency array, or make the callback a no-op —
// passed the entire suite, and the button would spin the user back to the same
// dead state forever with no way to reach their library short of a page reload.
//
// The three things it must get right, and the three ways it can silently fail:
//  1. it really does tear down and re-open the listen (not just re-render);
//  2. it must NOT reset the account-scoped first_title_added bookkeeping — a
//     session that already added titles has not stopped having done so, and the
//     deferred decision from a cold load must survive the outage that hit it;
//  3. a REAL uid change must still reset all of that, or a new account inherits
//     the previous one's history.
describe('WatchlistContext — retryListener re-subscribes the dead listener (BIN-700/755)', () => {
  async function mount() {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {});
  }

  it('opens a FRESH listen for the same uid, and reports the new listener honestly', async () => {
    await mount();
    expect(watchlistListenCount).toBe(1);

    await act(async () => { snapshotErrorCallback!(); });
    expect(readiness?.listenerFailed).toBe(true);

    await act(async () => { retryListenerRef!(); });

    // Torn down AND re-opened. Either half alone is a bug: no teardown leaks a
    // listener (and its reads) per press; no re-open is the inert mutant.
    expect(watchlistUnsubscribeCount).toBe(1);
    expect(watchlistListenCount).toBe(2);
    // Back to "we know nothing yet" — the retry is a new question, not an answer.
    // A retry that left `listenerFailed` true would keep every write surface held
    // even after the library came back.
    expect(readiness).toEqual({ loading: true, snapshotSettled: false, listenerFailed: false, libraryKnown: false });

    // …and the fresh listener's own outcome is what settles it.
    await act(async () => { snapshotCallback!(snap([doc(1)])); });
    expect(readiness).toEqual({ loading: false, snapshotSettled: true, listenerFailed: false, libraryKnown: true });
  });

  it('re-subscribes AGAIN after a second failure — the nonce is a counter, not a flag', async () => {
    await mount();
    await act(async () => { snapshotErrorCallback!(); });
    await act(async () => { retryListenerRef!(); });
    // The retried listener dies too (a genuinely offline device).
    await act(async () => { snapshotErrorCallback!(); });
    expect(readiness?.listenerFailed).toBe(true);

    await act(async () => { retryListenerRef!(); });

    // A boolean "retried" flag would stop here: the effect's deps would no longer
    // change, so the second press would do nothing and the user would be stuck.
    expect(watchlistListenCount).toBe(3);
    expect(readiness?.listenerFailed).toBe(false);
  });

  it('re-subscribes ONLY the watchlist listener, not the tags and notes ones', async () => {
    await mount();
    const tagsCb = tagsSnapshotCallback;
    const notesCb = notesSnapshotCallback;

    await act(async () => { snapshotErrorCallback!(); });
    await act(async () => { retryListenerRef!(); });

    // Those two are keyed on uid alone and did not fail; re-running them would
    // bill a fresh full read of both collections on every press of a button the
    // user is likely to press repeatedly (Blaze, 25 SEK/mån cap). Identity, not a
    // count: their onSnapshot callback is created inside the effect, so an equal
    // reference is proof the effect did not re-run.
    expect(tagsSnapshotCallback).toBe(tagsCb);
    expect(notesSnapshotCallback).toBe(notesCb);
  });

  it('does not re-fire first_title_added for a session that already fired it', async () => {
    await mount();
    // Brand-new user: an empty library settles, then they add their first title.
    await act(async () => { snapshotCallback!(snap([])); });
    await act(async () => { await upsertTitleRef!(newTitle(101)); });
    expect(firstTitleAddedCount()).toBe(1);

    await act(async () => { retryListenerRef!(); });
    // The fresh listener lands EMPTY — the optimistic write has not round-tripped
    // yet, which is exactly the frame that makes this mutant reachable.
    await act(async () => { snapshotCallback!(snap([])); });
    await act(async () => { await upsertTitleRef!(newTitle(102)); });

    // A retry that reset `everNonEmptyRef` (account-scoped state, not the
    // listener's) would read this session as a brand-new user all over again and
    // bill a duplicate first_title_added — a metric no later analysis can undo.
    expect(firstTitleAddedCount()).toBe(1);
  });

  it('does not LOSE a first_title_added that the outage interrupted', async () => {
    await mount();
    // The other direction of the same rule. The user's very first add happens
    // during a cold load, so the decision is deferred (BIN-56/110) — and then the
    // listener dies before any snapshot lands.
    await act(async () => { await upsertTitleRef!(newTitle(201, 'movie')); });
    await act(async () => { snapshotErrorCallback!(); });
    expect(firstTitleAddedCount()).toBe(0);

    await act(async () => { retryListenerRef!(); });
    await act(async () => { snapshotCallback!(snap([doc(201, 'movie')])); });

    // The pending count and its mediaType had to survive the retry: clearing them
    // there drops the event permanently, because a later snapshot always contains
    // the title and `items.length === 0` never becomes true again.
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });
  });

  // The other half of the guard: both branches of `subscribedUidRef.current !== uid`
  // need a test of their own, or "never reset" and "always reset" each pass half
  // the suite. Split in two because the two consequences are independent — one is
  // about whose rows a write is decided from, the other about whose history the
  // analytics event belongs to.
  async function switchToU2(view: ReturnType<typeof render>) {
    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });
  }

  it('a uid change does not let the previous account\'s rows decide the new one\'s write', async () => {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotCallback!(snap([doc(1), doc(2)])); });

    await switchToU2(view);

    // u2's snapshot has not landed yet — the window where a leftover `itemsRef`
    // would still be answering with u1's titles. A title u1 owned must read as a
    // genuine new add for u2 (addedAt stamped), never as a re-mark of u1's row
    // (addedAt withheld, so u2's title would sort nowhere and never recover).
    // `itemsRef` is cleared here AND `findItem` refuses to answer until
    // `itemsUidRef` matches — belt and braces, so this asserts the outcome both
    // mechanisms exist for rather than reaching into either one.
    setDoc.mockClear();
    await act(async () => { await upsertTitleRef!(newTitle(1)); });
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u2/watchlist/tv_1');
    expect(payload.addedAt).toBe('ts');
  });

  it('a uid change re-arms first_title_added for the new account', async () => {
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    // u1 is a returning user with a library, so their session can never fire the
    // first-title event.
    await act(async () => { snapshotCallback!(snap([doc(1), doc(2)])); });
    await act(async () => { await upsertTitleRef!(newTitle(3)); });
    expect(firstTitleAddedCount()).toBe(0);

    await switchToU2(view);
    // u2's own (empty) library settles first, so nothing here goes through the
    // deferred cold-load path — the event can only fire from `everNonEmptyRef`
    // having been reset for the new account.
    await act(async () => { snapshotCallback!(snap([])); });
    await act(async () => { await upsertTitleRef!(newTitle(301)); });

    expect(firstTitleAddedCount()).toBe(1);
  });
});

// BIN-598/BIN-630 — updateWatchedAt and updateTmdbStatus had ZERO coverage while
// they were migrated from the render-closure `items` to the live `itemsRef`. Both
// write the denormalised visibility fields, so a stale read there is not cosmetic
// staleness: it is BIN-595's leak (re-publishing a title the user hid), one
// mutator over.
describe('WatchlistContext — updateWatchedAt / updateTmdbStatus (BIN-598, coverage gap BIN-630)', () => {
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotCallback!(snap(docs)); });
  }

  const writeTo = (path: string) =>
    setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === path);

  it('updateWatchedAt writes the caller\'s date and nothing that belongs to a status change (BIN-154)', async () => {
    const chosen = new Date('2024-02-11T20:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 70, mediaType: 'movie', status: 'sedd' })]);

    await act(async () => { await updateWatchedAtRef!('movie', 70, chosen); });

    const call = writeTo('users/u1/watchlist/movie_70');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    // The date the user picked, through Timestamp.fromDate (the harness returns
    // the Date itself).
    expect(payload.watchedAt).toEqual(chosen);
    expect(payload.updatedAt).toBe('ts');
    // BIN-154: editing the date must NOT be routed through updateStatus, which
    // reads sedd → sedd as a rewatch and would count one on every date edit.
    expect('status' in payload).toBe(false);
    expect('rewatchCount' in payload).toBe(false);
    // No per-item override on this title → the lazy visibility re-assert applies.
    expect(payload.effectiveVisibility).toBe('private');
    expect(payload.isPublic).toBe(false);
    expect(call![2]).toEqual({ merge: true });
  });

  it('updateWatchedAt leaves a title the user HID alone (per-item override wins)', async () => {
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([seedDoc({
      tmdbId: 71, mediaType: 'movie', status: 'sedd',
      visibility: 'private', effectiveVisibility: 'private', isPublic: false,
    })]);

    await act(async () => { await updateWatchedAtRef!('movie', 71, new Date('2024-02-11T20:00:00Z')); });

    const payload = writeTo('users/u1/watchlist/movie_71')![1] as Record<string, unknown>;
    // ABSENT, not 'private' — this is a merge, so omitting preserves the stored
    // value. Writing the profile default here is what republished the title.
    expect('effectiveVisibility' in payload).toBe(false);
    expect('isPublic' in payload).toBe(false);
    // …and the date itself still landed.
    expect(payload.watchedAt).toEqual(new Date('2024-02-11T20:00:00Z'));
  });

  it('updateWatchedAt reads the LIVE snapshot, not the closure it was created in', async () => {
    // The BIN-598 migration itself. The mutator awaits fsdb() — a dynamic import —
    // before deciding what to write, so a render-closure `items` can be a whole
    // snapshot stale by then. Capturing the callback while the library is empty
    // and calling it after the override arrives reproduces exactly that pairing:
    // reading the closure re-publishes the title.
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([]);
    const captured = updateWatchedAtRef!;

    await act(async () => {
      snapshotCallback!(snap([seedDoc({
        tmdbId: 72, mediaType: 'movie', status: 'sedd',
        visibility: 'private', effectiveVisibility: 'private', isPublic: false,
      })]));
    });
    // …and the identity survives that snapshot, which is the other half of the
    // migration: `items` is out of the dep array, so a consumer's effect no longer
    // re-fires once per snapshot.
    expect(updateWatchedAtRef).toBe(captured);

    await act(async () => { await captured('movie', 72, new Date('2024-02-11T20:00:00Z')); });

    const payload = writeTo('users/u1/watchlist/movie_72')![1] as Record<string, unknown>;
    expect('effectiveVisibility' in payload).toBe(false);
    expect('isPublic' in payload).toBe(false);
  });

  it('findItem refuses to answer from another account\'s rows (itemsUidRef cross-account guard)', async () => {
    // `itemsRef` is ONE shared mutable ref, so a mutator that started under A can
    // reach `findItem` after a sign-out+sign-in has repopulated it with B's rows.
    // The WRITE still lands under A (each mutator closes over its own uid) — the
    // danger is the DECISION. Here: A's title carries a legacy inline note, and
    // `updateNotes` reads `current?.notes` to decide whether to strip it. If
    // findItem answered from B's copy (no note), the strip would be skipped and
    // A's inline note — the BIN-505 third-party-PII leak — would survive.
    const view = render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 88, mediaType: 'movie', notes: 'A:s privata anteckning' })]));
    });
    // Captured while A is signed in — this is the in-flight call.
    const captured = updateNotesRef!;

    // A→B, and B's OWN snapshot lands — so itemsRef now holds B's rows and
    // itemsUidRef says 'u2'. B tracks the same film, with NO inline note and an
    // explicit visibility override (so nothing else would force the item write).
    await act(async () => {
      authState.uid = 'u2';
      view.rerender(
        <WatchlistProvider>
          <Harness />
        </WatchlistProvider>,
      );
    });
    await act(async () => {
      snapshotCallback!(snap([seedDoc({
        tmdbId: 88, mediaType: 'movie',
        visibility: 'private', effectiveVisibility: 'private', isPublic: false,
      })]));
    });
    setDoc.mockClear();

    // A's in-flight call finally runs. Read from B's row it would conclude
    // "no inline note, visibility already stamped" and take BIN-522's no-op
    // skip — leaving A's inline note in place, readable, for another session.
    await act(async () => { await captured('movie', 88, 'ny text'); });

    const itemWrite = setDoc.mock.calls.find(
      c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_88',
    );
    expect(itemWrite).toBeDefined();
    expect((itemWrite![1] as Record<string, unknown>).notes).toBe('DELETE_FIELD');
    // And nothing was written under B.
    expect(setDoc.mock.calls.filter(c => (c[0] as { _path: string })._path.startsWith('users/u2/'))).toHaveLength(0);
  });

  it('updateRating reads the LIVE snapshot, not the closure it was created in', async () => {
    // Same migration, same failure, and the one the sweep left unpinned: reverting
    // `updateRating` alone to `items.find(...)` left the whole suite green, so
    // nothing stopped it drifting back. The pairing that breaks it is the same as
    // updateWatchedAt's — capture the callback while the library is empty, let a
    // per-title `private` override land, then call the captured reference. A
    // render-closure read sees the empty library, concludes "no override", and
    // re-publishes a title the user had just hidden.
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([]);
    const captured = updateRatingRef!;

    await act(async () => {
      snapshotCallback!(snap([seedDoc({
        tmdbId: 77, mediaType: 'movie', status: 'sedd',
        visibility: 'private', effectiveVisibility: 'private', isPublic: false,
      })]));
    });
    // The other half of the migration: `items` is out of the dep array, so the
    // identity survives the snapshot and a consumer's effect stops re-firing.
    expect(updateRatingRef).toBe(captured);

    await act(async () => { await captured('movie', 77, 4); });

    const payload = writeTo('users/u1/watchlist/movie_77')![1] as Record<string, unknown>;
    expect(payload.rating).toBe(4);
    expect('effectiveVisibility' in payload).toBe(false);
    expect('isPublic' in payload).toBe(false);
  });

  it('updateTmdbStatus writes the TMDB status + the visibility re-assert, and nothing else', async () => {
    await mountSeeded([seedDoc({ tmdbId: 73, mediaType: 'tv', status: 'mina' })]);

    await act(async () => { await updateTmdbStatusRef!('tv', 73, 'Ended'); });

    const call = writeTo('users/u1/watchlist/tv_73');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({
      tmdbStatus: 'Ended',
      effectiveVisibility: 'private',
      isPublic: false,
      updatedAt: 'ts',
    });
    expect(call![2]).toEqual({ merge: true });
  });

  it('updateTmdbStatus can clear the field to null without touching a hidden title\'s visibility', async () => {
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([seedDoc({
      tmdbId: 74, mediaType: 'tv', status: 'mina',
      visibility: 'private', effectiveVisibility: 'private', isPublic: false,
    })]);

    await act(async () => { await updateTmdbStatusRef!('tv', 74, null); });

    expect(writeTo('users/u1/watchlist/tv_74')![1]).toEqual({ tmdbStatus: null, updatedAt: 'ts' });
  });

  it('updateTmdbStatus reads the LIVE snapshot too', async () => {
    authState.user = { defaultVisibility: 'public' };
    await mountSeeded([]);
    const captured = updateTmdbStatusRef!;

    await act(async () => {
      snapshotCallback!(snap([seedDoc({
        tmdbId: 75, mediaType: 'tv', status: 'mina',
        visibility: 'private', effectiveVisibility: 'private', isPublic: false,
      })]));
    });
    expect(updateTmdbStatusRef).toBe(captured);

    await act(async () => { await captured('tv', 75, 'Ended'); });

    expect(writeTo('users/u1/watchlist/tv_75')![1]).toEqual({ tmdbStatus: 'Ended', updatedAt: 'ts' });
  });

  it('neither writes anything when nobody is signed in', async () => {
    authState.uid = null;
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {});

    await act(async () => {
      await updateWatchedAtRef!('movie', 76, new Date());
      await updateTmdbStatusRef!('tv', 76, 'Ended');
    });

    expect(setDoc).not.toHaveBeenCalled();
  });
});

// BIN-598 acceptance #3 — the regression the 2026-07-29 attempt SHIPPED, and the
// only reason `setRuntime` / `refreshTmdbFields` were left reading the render
// closure while every other mutator moved to `findItem`.
//
// Those two are called fire-and-forget from MoviePageClient / TVShowPageClient,
// out of an effect that depends on THE FUNCTION ITSELF. Their per-snapshot
// identity is therefore not incidental — it is the reactivity: it is what re-runs
// the page effect after a snapshot lands, so a title the visitor adds while
// reading its page gets its runtime and its denormalised TMDB block backfilled on
// that same visit instead of the next one. Make the identity stable (the obvious
// "finish the migration" edit) and the backfill silently waits for a future
// visit. Migrating them means changing those two page components in the SAME
// diff; it is not a WatchlistContext-only edit.
describe('WatchlistContext — title-page backfill reactivity is NOT migrated away (BIN-598 #3)', () => {
  async function mountEmpty() {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => { snapshotCallback!(snap([])); });
  }

  it('a new snapshot hands the title page a FRESH setRuntime/refreshTmdbFields — and leaves the migrated mutators alone', async () => {
    await mountEmpty();
    const runtimeBefore = setRuntimeRef!;
    const refreshBefore = refreshTmdbFieldsRef!;
    const watchedAtBefore = updateWatchedAtRef!;
    const tmdbStatusBefore = updateTmdbStatusRef!;
    const addItemBefore = upsertTitleRef!;

    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 80, runtime: null })]));
    });

    // The two deliberately-unmigrated ones: identity CHANGED, which is what makes
    // the page effect re-fire. Migrating either onto `findItem` (stable `[]`-dep
    // identity) kills this and re-ships the 2026-07-29 regression.
    expect(setRuntimeRef).not.toBe(runtimeBefore);
    expect(refreshTmdbFieldsRef).not.toBe(refreshBefore);
    // …while the migrated mutators are stable across that very same snapshot —
    // that is the BIN-598 win, and it must not have been bought by breaking the
    // two assertions above.
    expect(updateWatchedAtRef).toBe(watchedAtBefore);
    expect(updateTmdbStatusRef).toBe(tmdbStatusBefore);
    expect(upsertTitleRef).toBe(addItemBefore);
  });

  it('backfills a title that only ENTERS the library while its page is open', async () => {
    // The user-visible half of the same rule, end to end: the page calls
    // setRuntime before the title is in the library (skip-guard, no write), the
    // add lands in a later snapshot, and the fresh closure asserted above lets the
    // re-fired effect finish the backfill on THIS visit rather than the next one.
    await mountEmpty();

    await act(async () => { await setRuntimeRef!('tv', 81, 95); });
    expect(setDoc).not.toHaveBeenCalled();

    await act(async () => {
      snapshotCallback!(snap([seedDoc({ tmdbId: 81, runtime: null })]));
    });
    await act(async () => { await setRuntimeRef!('tv', 81, 95); });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/tv_81');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ runtime: 95 }); // pure denormalisation — never updatedAt
  });
});

// ── BIN-942: the create-floor's blast radius on the ordinary edit paths ───────────────
//
// `firestore.rules` now refuses a CREATE into the watchlist collection unless the payload
// carries tmdbId + mediaType + status. Every one of these six mutators writes a partial
// merge, so in one narrow race — the user deletes the title between the snapshot this call
// read and the write landing — the merge is a create and the server refuses it.
//
// That refusal is the fix working: before the floor, those same writes silently RESURRECTED
// the deleted title as an identity-less ghost on the publicly-readable profile. So the six
// swallow `permission-denied` (the title is gone, the listener drops the row, there is
// nothing to say and nothing to retry) and rethrow everything else.
//
// The negative half of each pair is the load-bearing one. A bare `catch` here would eat
// `unavailable`, `deadline-exceeded` and every offline error on six of the app's most
// common writes — the exact mistake this repo shipped once in `joinGroupViaToken` and rolled
// back, where a bad mobile connection was reported as "the invite link is invalid".
describe('WatchlistContext — the create-floor refusal is swallowed, nothing else is (BIN-942)', () => {
  async function mountSeeded(docs: { data: () => Record<string, unknown> }[]) {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    await act(async () => {
      snapshotCallback!(snap(docs));
    });
  }

  function denied() {
    return Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  }
  function offline() {
    return Object.assign(new Error('The service is currently unavailable.'), { code: 'unavailable' });
  }

  // One row per guarded call site, so a seventh mutator added without a guard has no row
  // here and a guard removed from one of the six fails exactly one row.
  const GUARDED: [kind: string, run: () => Promise<ItemWriteOutcome>][] = [
    ['updateVisibility', () => updateVisibilityRef!('tv', 5, 'public')],
    ['updateStatus', () => updateStatusRef!('tv', 5, 'avbruten')],
    ['updateWatchedAt', () => updateWatchedAtRef!('tv', 5, new Date('2026-01-02'))],
    ['updateRating', () => updateRatingRef!('tv', 5, 4)],
    ['updateProgress', () => updateProgressRef!('tv', 5, 2, 3)],
    ['updateTmdbStatus', () => updateTmdbStatusRef!('tv', 5, 'Ended')],
  ];

  it.each(GUARDED)('%s: a floor refusal resolves and is reported to Sentry', async (kind, run) => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);
    setDoc.mockRejectedValueOnce(denied());

    // Resolving is not on its own proof that anything was logged — assert the report too,
    // and assert the `kind`, which is what the dated deviation entry names as its re-open
    // trigger. A shared helper with a wrong `kind` would be invisible without this.
    //
    // BIN-942 review round 1: it resolves to 'refused', not to undefined, and that is the
    // load-bearing half. Swallowing makes the promise RESOLVE, and two callers outside the
    // context read a resolved promise as success — a toast and a permanently-retired card.
    // The outcome is what lets them tell the difference.
    await act(async () => { await expect(run()).resolves.toBe('refused'); });
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'permission-denied' }),
      expect.objectContaining({ scope: 'watchlist', kind }),
    );
  });

  it.each(GUARDED)('%s: any OTHER error still rejects — the catch is not broad', async (_kind, run) => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);
    setDoc.mockRejectedValueOnce(offline());

    await act(async () => { await expect(run()).rejects.toThrow('The service is currently unavailable.'); });
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(GUARDED)('%s: a write that LANDS answers written', async (_kind, run) => {
    // The positive half of the same contract. Without it, a helper hard-wired to return
    // 'refused' would pass every test above and silently suppress every confirmation in the
    // app — the failure mode is invisible precisely because nothing throws.
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => { await expect(run()).resolves.toBe('written'); });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a refused status write does NOT report status_changed to analytics', async () => {
    // Same root cause one layer in: the context's own analytics call sat after the guarded
    // write and fired regardless, recording a status nobody has.
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);
    setDoc.mockRejectedValueOnce(denied());

    await act(async () => { await updateStatusRef!('tv', 5, 'avbruten'); });
    expect(trackEvent).not.toHaveBeenCalledWith('status_changed', expect.anything());
  });

  it('a status write that LANDS still reports status_changed', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => { await updateStatusRef!('tv', 5, 'avbruten'); });
    expect(trackEvent).toHaveBeenCalledWith('status_changed', { mediaType: 'tv', status: 'avbruten' });
  });

  // The add path is deliberately NOT guarded. It reports its outcome back to the caller
  // (BIN-895), so swallowing a refusal here would make the button say "added" about a title
  // Firestore refused — the exact false confirmation BIN-895 closed, reopened on the create
  // path the floor introduces.
  it('the ADD path is not swallowed — a refused create still rejects for the caller', async () => {
    await mountSeeded([]);
    setDoc.mockRejectedValueOnce(denied());

    await act(async () => {
      await expect(upsertTitleRef!(newTitle(900, 'movie'))).rejects.toThrow();
    });
    expect(captureError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'writeTitle' }),
    );
  });
});
