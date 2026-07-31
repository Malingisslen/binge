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

const setDoc = vi.fn(async (..._args: unknown[]) => {});
const deleteDoc = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@/lib/firebase/db', () => ({
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    const kit = {
      db: {},
      collection: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
      onSnapshot: (
        ref: { _path?: string },
        cb: (snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void,
      ) => {
        if ((ref?._path ?? '').endsWith('watchlistTags')) {
          tagsSnapshotCallback = cb as typeof tagsSnapshotCallback;
        } else if ((ref?._path ?? '').endsWith('watchlistNotes')) {
          notesSnapshotCallback = cb as typeof notesSnapshotCallback;
        } else {
          snapshotCallback = cb;
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
      commit: async () => {},
    }),
    deleteField: () => 'DELETE_FIELD',
    serverTimestamp: () => 'ts',
    Timestamp: { fromDate: (d: Date) => d },
  }),
}));

import { WatchlistProvider, useWatchlist } from './WatchlistContext';
import type { WatchlistItem, MediaType, WatchStatus } from '@/types';

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
let addItemRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>, opts?: { countsAsViewing?: boolean }) => Promise<void>) | null = null;
let updateStatusRef: ((mediaType: MediaType, tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<void>) | null = null;
let updateProgressRef: ((mediaType: MediaType, tmdbId: number, season: number, episode: number) => Promise<void>) | null = null;
let setRuntimeRef: ((mediaType: MediaType, tmdbId: number, runtime: number | null) => Promise<void>) | null = null;
let removeItemRef: ((mediaType: MediaType, tmdbId: number) => Promise<void>) | null = null;
let updateTagsRef: ((mediaType: MediaType, tmdbId: number, tags: string[]) => Promise<void>) | null = null;
let updateRatingRef: ((mediaType: MediaType, tmdbId: number, rating: number | null) => Promise<void>) | null = null;
let updateNotesRef: ((mediaType: MediaType, tmdbId: number, notes: string | null) => Promise<void>) | null = null;
let refreshTmdbFieldsRef: ((mediaType: MediaType, tmdbId: number, fields: Record<string, unknown>) => Promise<void>) | null = null;

function Harness() {
  const wl = useWatchlist();
  useEffect(() => {
    addItemRef = wl.addItem;
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

function newTitle(tmdbId: number, mediaType: MediaType = 'tv'): Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'> {
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
  } as Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>;
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
  snapshotCallback = null;
  tagsSnapshotCallback = null;
  notesSnapshotCallback = null;
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
      await addItemRef!(newTitle(101));
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
      await addItemRef!(newTitle(4));
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
      await addItemRef!(newTitle(5));
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
      await addItemRef!(newTitle(10, 'movie'));
    });
    expect(firstTitleAddedCount()).toBe(1);
    expect(trackEvent).toHaveBeenCalledWith('first_title_added', { mediaType: 'movie' });

    // En andra add ska INTE re-fyra.
    await act(async () => {
      await addItemRef!(newTitle(11));
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
      await addItemRef!(newTitle(201, 'movie'));
    });
    await act(async () => {
      await addItemRef!(newTitle(202, 'tv'));
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
      await addItemRef!(newTitle(301));
    });
    await act(async () => {
      await addItemRef!(newTitle(302));
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
  it('addItem does NOT rewrite addedAt when re-marking a title already in the library', async () => {
    // addedAt drives Bibliotek's "Tillagd" sort, backlogResurface's oldest-first
    // ranking, taste/stats' 30-day counter and the GDPR export's "added" value.
    // Re-stamping it on a status change silently re-dated a years-old title.
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await addItemRef!({ ...newTitle(9), status: 'avbruten' });
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

  it('addItem DOES stamp addedAt + tmdbFieldsRefreshedAt on a genuine new add', async () => {
    // The other half of the guard: omitting these on a real first add would leave a
    // doc that sorts nowhere (toDate(undefined) re-dates it on every read) and that
    // the ToS sweep would treat as stale.
    await mountSeeded([]);

    await act(async () => {
      await addItemRef!(newTitle(77));
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
    // The asymmetry: `addedAt` is gated on `currentForRating` alone, so during a cold
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
      await addItemRef!(newTitle(101));
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
  describe('BIN-641: rewatch counting on the addItem path', () => {
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
      await mountSeeded([seenFilm(2)]);
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });
      expect(lastPayload('users/u1/watchlist/movie_42').rewatchCount).toBe(3);
    });

    it('counts NOTHING for the same write without that intent', async () => {
      // This is the ordinary "Sedd" tap — re-picking the status a title already has,
      // which Malin ruled must not count — AND every bulk caller. Counting on the
      // transition alone would count both.
      await mountSeeded([seenFilm(2)]);
      await act(async () => { await addItemRef!(markSeen()); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    it('counts nothing on a FIRST viewing, however the caller asks', async () => {
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se' })]);
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    it('counts nothing for a series — only film has a terminal sedd', async () => {
      await mountSeeded([seedDoc({ tmdbId: 7, status: 'mina' })]);
      await act(async () => { await addItemRef!(newTitle(7), { countsAsViewing: true }); });
      expect('rewatchCount' in lastPayload('users/u1/watchlist/tv_7')).toBe(false);
    });

    // The re-date gates on the COUNTED OUTCOME, not on the intent flag. Without
    // that, intent on a tracked title that is NOT sedd would stomp the stored
    // date while counting nothing — a write that re-dates without counting is
    // incoherent, and watchedAt is user-authored.
    it('neither counts nor re-dates a tracked film that is not sedd', async () => {
      const STORED = new Date('2019-04-02T00:00:00Z');
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'vill_se', watchedAt: STORED })]);
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });

      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect('rewatchCount' in payload).toBe(false);
      expect('watchedAt' in payload).toBe(false);
    });

    it('counts nothing during a cold load, when the library is not known yet', async () => {
      // itemsRef is empty, so a re-mark is indistinguishable from a new add. The
      // count is not user-fixable, so an unsettled snapshot guesses nothing.
      render(<WatchlistProvider><Harness /></WatchlistProvider>);
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });
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
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });

      const payload = lastPayload('users/u1/watchlist/movie_42');
      expect(payload.watchedAt).toBe('ts');
      expect(payload.rewatchCount).toBe(2);
    });

    // …and the ordinary re-mark still must NOT (BIN-593 unchanged).
    it('leaves the stored date alone without that intent', async () => {
      const STORED = new Date('2019-04-02T00:00:00Z');
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);
      await act(async () => { await addItemRef!(markSeen()); });

      expect('watchedAt' in lastPayload('users/u1/watchlist/movie_42')).toBe(false);
    });

    // #14 Software Architect's binding acceptance criterion. `countsAsViewing`
    // is a second PARAMETER, never a payload field, because WatchlistAddPayload
    // is contractually the exact key set written to Firestore and
    // isValidWatchlistItem uses a hasOnly allowlist — a stray key either lands
    // as junk or fails the whole merge-write with permission-denied. That
    // already happened once, with `notes`. So: prove the flag never reaches the
    // document, by diffing the two key sets.
    it('never writes the intent flag itself to Firestore', async () => {
      await mountSeeded([seedDoc({ tmdbId: 42, mediaType: 'movie', status: 'sedd', rewatchCount: 2, watchedAt: new Date('2019-04-02T00:00:00Z') })]);
      await act(async () => { await addItemRef!(markSeen(), { countsAsViewing: true }); });
      const withIntent = Object.keys(lastPayload('users/u1/watchlist/movie_42'));

      setDoc.mockClear();
      await act(async () => { await addItemRef!(markSeen()); });
      const without = Object.keys(lastPayload('users/u1/watchlist/movie_42'));

      expect(withIntent).not.toContain('countsAsViewing');
      // The only differences the flag may make to the DOCUMENT are the counter
      // and the re-date. Everything else must be the same key set — and the flag
      // itself must never appear, which is the half that protects the hasOnly rule.
      expect(withIntent.filter(k => k !== 'rewatchCount' && k !== 'watchedAt').sort()).toEqual(without.sort());
    });
  });

  // ── BIN-593 — watchedAt is user-authored data ────────────────────────────────
  // Malin, 2026-07-25: "har man manuellt justerat 'sett' ska det bara ändras om
  // man själv manuellt ändrar igen". addItem is the re-mark path (useMarkSeen /
  // StatusButton / QuickAddButton), and it used to write serverTimestamp() on
  // every 'sedd' and an explicit null on every other status.

  it('BIN-593: addItem does NOT rewrite watchedAt when the film already has one (re-mark)', async () => {
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 31, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await addItemRef!(newTitle(31, 'movie')); // status 'sedd' — a rewatch re-mark
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_31');
    expect(call).toBeDefined();
    // ABSENT, not null — addItem merges, so an omitted key preserves the backdated date.
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-593: addItem DOES stamp the first watchedAt (new add, and a seen-mark of a title that has none)', async () => {
    // Both halves of "stamp only when we know there is none".
    await mountSeeded([seedDoc({ tmdbId: 32, mediaType: 'movie', status: 'vill_se' })]);

    await act(async () => {
      await addItemRef!(newTitle(32, 'movie')); // vill_se → sedd, no stored date
      await addItemRef!(newTitle(33, 'movie')); // genuinely new, status 'sedd'
    });

    for (const id of [32, 33]) {
      const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === `users/u1/watchlist/movie_${id}`);
      expect(call).toBeDefined();
      expect((call![1] as Record<string, unknown>).watchedAt).toBe('ts');
    }
  });

  it('BIN-593: addItem never writes a null watchedAt when the status is not sedd', async () => {
    // The other data-loss half: the old code wrote `watchedAt: null` on every
    // non-sedd status, erasing the date the moment a film left 'sedd'.
    const STORED = new Date('2019-04-02T00:00:00Z');
    await mountSeeded([seedDoc({ tmdbId: 34, mediaType: 'movie', status: 'sedd', watchedAt: STORED })]);

    await act(async () => {
      await addItemRef!({ ...newTitle(34, 'movie'), status: 'avbruten' });
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
    const staleAddItem = addItemRef!;

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
      await addItemRef!(newTitle(51, 'movie')); // status 'sedd'
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
      await addItemRef!(newTitle(61, 'movie')); // status 'sedd' — an ordinary re-mark
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
      await addItemRef!(newTitle(62, 'movie'));
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
      await addItemRef!(newTitle(64, 'movie'));
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_64');
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.effectiveVisibility).toBe('public');
    expect(payload.isPublic).toBe(true);
  });

  it('BIN-593: COLD LOAD — addItem stays silent about watchedAt', async () => {
    render(
      <WatchlistProvider>
        <Harness />
      </WatchlistProvider>,
    );
    expect(screen.getByText('ready')).toBeTruthy();

    await act(async () => {
      await addItemRef!(newTitle(38, 'movie')); // status 'sedd'
    });

    const call = setDoc.mock.calls.find(c => (c[0] as { _path: string })._path === 'users/u1/watchlist/movie_38');
    expect(call).toBeDefined();
    expect('watchedAt' in (call![1] as Record<string, unknown>)).toBe(false);
  });

  it('BIN-505: addItem never writes a non-null inline note to the watchlist doc', async () => {
    // addItem is also the re-mark path (QuickAddButton/StatusButton/useMarkSeen
    // pass current?.notes to preserve it). notes now lives in watchlistNotes and
    // the watchlist-doc rules reject a non-null inline note — so the write must
    // NOT carry `notes`, else re-marking a noted title is permission-denied.
    await mountSeeded([]);
    await act(async () => {
      await addItemRef!({ ...newTitle(77), notes: 'en privat anteckning' });
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

  it('addItem stamps ratedAt on a new/changed rating, NOT on a same-rating re-mark (BIN-349)', async () => {
    // Seed an already-rated in-library title (id 60, rating 5).
    await mountSeeded([seedDoc({ tmdbId: 60, mediaType: 'movie', status: 'sedd', rating: 5 })]);

    // Re-mark it via the addItem merge-write path (useMarkSeen/StatusButton/
    // QuickAddButton) carrying the UNCHANGED rating → ratedAt must NOT be written
    // (a blind stamp here re-bumped recency — the exact bug this fix closes).
    await act(async () => { await addItemRef!({ ...newTitle(60, 'movie'), rating: 5 }); });
    let payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect('ratedAt' in payload).toBe(false);

    // A brand-new pre-rated title (CSV import) → stamped.
    await act(async () => { await addItemRef!({ ...newTitle(61, 'movie'), rating: 5 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A re-mark that genuinely CHANGES the rating (5 → 4) → stamped.
    await act(async () => { await addItemRef!({ ...newTitle(60, 'movie'), rating: 4 }); });
    payload = setDoc.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(payload.ratedAt).toBe('ts');

    // A brand-new unrated title → no ratedAt key at all.
    await act(async () => { await addItemRef!({ ...newTitle(62, 'movie'), rating: null }); });
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
