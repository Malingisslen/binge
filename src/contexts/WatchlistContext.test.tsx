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
vi.mock('@/lib/watchlistWrites', () => ({
  buildStatusUpdate: (...args: unknown[]) => buildStatusUpdate(...args),
}));

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
// så testet kan driva snapshot-sekvensen manuellt.
let snapshotCallback: ((snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void) | null = null;

const setDoc = vi.fn(async (..._args: unknown[]) => {});
const deleteDoc = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@/lib/firebase/db', () => ({
  lazySubscribe: (attach: (kit: unknown) => () => void) => {
    const kit = {
      db: {},
      collection: () => ({}),
      onSnapshot: (
        _ref: unknown,
        cb: (snap: { size: number; docs: { data: () => Record<string, unknown> }[] }) => void,
      ) => {
        snapshotCallback = cb;
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
let addItemRef: ((item: Omit<WatchlistItem, 'addedAt' | 'updatedAt' | 'watchedAt' | 'dropped' | 'rewatchCount' | 'providersCheckedAt' | 'visibility'>) => Promise<void>) | null = null;
let updateStatusRef: ((tmdbId: number, status: WatchStatus, watchedAt?: Date) => Promise<void>) | null = null;
let updateProgressRef: ((tmdbId: number, season: number, episode: number) => Promise<void>) | null = null;
let setRuntimeRef: ((tmdbId: number, runtime: number | null) => Promise<void>) | null = null;
let removeItemRef: ((tmdbId: number) => Promise<void>) | null = null;

function Harness() {
  const wl = useWatchlist();
  useEffect(() => {
    addItemRef = wl.addItem;
    updateStatusRef = wl.updateStatus;
    updateProgressRef = wl.updateProgress;
    setRuntimeRef = wl.setRuntime;
    removeItemRef = wl.removeItem;
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
      await updateStatusRef!(42, 'sedd');
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
      await setRuntimeRef!(7, 95);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>, unknown];
    expect(ref._path).toBe('users/u1/watchlist/7');
    expect(payload).toEqual({ runtime: 95 }); // ren denormalisering — INGEN updatedAt
    expect(opts).toEqual({ merge: true });
  });

  it('setRuntime skip-guard: no write when runtime is already known', async () => {
    await mountSeeded([seedDoc({ tmdbId: 7, runtime: 120 })]);
    await act(async () => {
      await setRuntimeRef!(7, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('setRuntime skip-guard: no write when the title is not in the library', async () => {
    await mountSeeded([]);
    await act(async () => {
      await setRuntimeRef!(999, 95);
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('updateProgress writes progress fields (never status) and forwards status to group-sync', async () => {
    await mountSeeded([seedDoc({ tmdbId: 5, mediaType: 'tv', status: 'mina' })]);

    await act(async () => {
      await updateProgressRef!(5, 2, 3);
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as [{ _path: string }, Record<string, unknown>];
    expect(ref._path).toBe('users/u1/watchlist/5');
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

  it('removeItem deletes the watchlist doc at the correct path', async () => {
    await mountSeeded([seedDoc({ tmdbId: 9 })]);

    await act(async () => {
      await removeItemRef!(9);
    });

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect((deleteDoc.mock.calls[0][0] as { _path: string })._path).toBe('users/u1/watchlist/9');
    expect(setDoc).not.toHaveBeenCalled();
  });
});
