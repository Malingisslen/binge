import { describe, it, expect } from 'vitest';
import { buildWatchlistAddPayload, type WatchlistAddPayload } from './buildAddPayload';
import type { WatchlistItem } from '@/types';

const base = {
  tmdbId: 1399,
  mediaType: 'tv' as const,
  status: 'mina' as const,
  title: 'Game of Thrones',
  posterPath: '/poster.jpg',
  releaseYear: 2011,
};

function existing(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    tmdbId: 1399,
    mediaType: 'tv',
    status: 'mina',
    rating: 4.5,
    notes: 'bästa säsongen är 4',
    title: 'Game of Thrones',
    posterPath: '/poster.jpg',
    releaseYear: 2011,
    totalSeasons: 8,
    lastWatchedSeason: 3,
    lastWatchedEpisode: 9,
    dropped: false,
    rewatchCount: 0,
    providers: [8],
    subscriptionProviders: null, providersCheckedAt: null,
    visibility: null,
    genreIds: [18, 10765],
    tmdbStatus: 'Ended',
    addedAt: new Date(0),
    updatedAt: new Date(0),
    watchedAt: null,
    ...overrides,
  };
}

/**
 * These tests assert the EXACT key set, not a subset (`toEqual` / `Object.keys`,
 * never `toMatchObject`). That is deliberate and load-bearing: `addItem` merges,
 * so which keys are PRESENT is the whole contract — a stray key is a silent
 * overwrite of stored data, and a missing key is the mechanism that preserves it.
 * A subset assertion cannot see either.
 */
describe('buildWatchlistAddPayload', () => {
  it('writes only the identity fields for a title the user does not track yet', () => {
    // Nothing is known and nothing is stored, so nothing else may be written.
    // The previous version filled null/[] defaults here, which is what let a
    // cold-cache status change wipe a live rating and episode position.
    expect(buildWatchlistAddPayload(base)).toEqual({ ...base });
  });

  it('omits — does not null — a field with no caller value and no current (the onboarding shape)', () => {
    const keys = Object.keys(buildWatchlistAddPayload(base));
    for (const absent of [
      'rating', 'totalSeasons', 'lastWatchedSeason',
      'lastWatchedEpisode', 'providers', 'genreIds', 'tmdbStatus',
    ]) {
      expect(keys).not.toContain(absent);
    }
    // `notes` is not merely absent from the output — it is not part of the input
    // type at all, because addItem refuses to write notes (BIN-505).
    expect(keys).not.toContain('notes');
  });

  it('a genuine new add that supplies arrays writes them, so the created doc keeps its array contract', () => {
    const payload = buildWatchlistAddPayload({ ...base, providers: [], genreIds: [18] });
    expect(payload.providers).toEqual([]);
    expect(payload.genreIds).toEqual([18]);
    expect(Object.keys(payload)).toContain('providers');
  });

  it('carries rating and episode progress forward from the existing row', () => {
    const payload = buildWatchlistAddPayload({ ...base, status: 'avbruten', current: existing() });
    expect(payload).toEqual({
      ...base,
      status: 'avbruten',
      rating: 4.5,
      totalSeasons: 8,
      lastWatchedSeason: 3,
      lastWatchedEpisode: 9,
      providers: [8],
      genreIds: [18, 10765],
      tmdbStatus: 'Ended',
    });
  });

  it('lets a caller-supplied value win over the existing row', () => {
    const payload = buildWatchlistAddPayload({
      ...base,
      current: existing(),
      lastWatchedSeason: 8,
      lastWatchedEpisode: 6,
      providers: [337],
      tmdbStatus: 'Returning Series',
    });
    expect(payload).toEqual({
      ...base,
      lastWatchedSeason: 8,
      lastWatchedEpisode: 6,
      providers: [337],
      tmdbStatus: 'Returning Series',
      rating: 4.5, // untouched fields still carry
      totalSeasons: 8,
      genreIds: [18, 10765],
    });
  });

  // Explicit null is a write, not an omission — StatusButton relies on this to
  // clear the season count when its own prop is absent.
  it('treats an explicit null as "write null" rather than "carry forward"', () => {
    const payload = buildWatchlistAddPayload({ ...base, current: existing(), totalSeasons: null });
    expect(payload.totalSeasons).toBeNull();
    expect(Object.keys(payload)).toContain('totalSeasons');
    expect(payload.lastWatchedSeason).toBe(3);
  });

  it('omits the key when the existing row itself holds null — merge then preserves the server copy', () => {
    // The client cache says "no rating". Writing null would ASSERT that against
    // Firestore; omitting lets the stored document stay authoritative, which is the
    // safe direction when the local snapshot may simply not have settled yet.
    const payload = buildWatchlistAddPayload({
      ...base,
      current: existing({ rating: null, totalSeasons: null }),
    });
    expect(Object.keys(payload)).not.toContain('rating');
    expect(Object.keys(payload)).not.toContain('totalSeasons');
    // …while a genuinely-empty array on the current row still carries, because []
    // is a real value the user's row holds, not an absence.
    const withEmptyArrays = buildWatchlistAddPayload({
      ...base,
      current: existing({ providers: [], genreIds: [] }),
    });
    expect(withEmptyArrays.providers).toEqual([]);
    expect(withEmptyArrays.genreIds).toEqual([]);
  });
});

// BIN-640 — a compile-time pin, not a runtime one.
//
// `addedAtIsFallback` is derived at READ time (did the doc have a stored
// `addedAt`?) and is never persisted. It lives on `WatchlistItem`, and
// `WatchlistAddPayload` is derived FROM `WatchlistItem`, so without an explicit
// exclusion the payload type would structurally admit it — and a stray key in the
// merge-write fails the WHOLE write against firestore.rules' `hasOnly` allowlist,
// which is exactly what `notes` once did.
//
// A runtime test cannot catch this: nothing sets the field today. Only the type
// can, so this asserts the type rejects it. If the `ts-expect-error` ever goes
// unused, tsc fails — which is the alarm.
describe('WatchlistAddPayload — never carries read-derived fields (BIN-640)', () => {
  it('rejects addedAtIsFallback at the type level', () => {
    const payload: WatchlistAddPayload = {
      tmdbId: 1,
      mediaType: 'movie',
      status: 'sedd',
      title: 'X',
      posterPath: null,
      releaseYear: null,
      // @ts-expect-error addedAtIsFallback must not be assignable to the payload
      addedAtIsFallback: true,
    };
    expect(payload.tmdbId).toBe(1);
  });
});

// BIN-814. The add path is the most common way a title enters the library, and it
// also stamps providersCheckedAt — which gates the title-page repair out for 60
// days. An add that wrote only the broad field would therefore lock the advisor onto
// the fallback for exactly the titles the split exists for.
describe('buildWatchlistAddPayload — the two provider fields travel together', () => {
  const base = {
    tmdbId: 1, mediaType: 'movie' as const, status: 'vill_se' as const,
    title: 'A film', posterPath: null, releaseYear: 2026,
  };

  it('writes the subscription subset alongside the broad list', () => {
    const p = buildWatchlistAddPayload({
      ...base, current: null, providers: [76, 8], subscriptionProviders: [8],
    });
    expect(p.providers).toEqual([76, 8]);
    expect(p.subscriptionProviders).toEqual([8]);
  });

  it('an empty subset is written, not dropped — it is a real answer', () => {
    // A rent-only-on-Viaplay film. `[]` here is what stops it anchoring Viaplay.
    const p = buildWatchlistAddPayload({
      ...base, current: null, providers: [76], subscriptionProviders: [],
    });
    expect(p.subscriptionProviders).toEqual([]);
  });

  it('a re-mark that knows neither omits both, preserving what is stored', () => {
    const p = buildWatchlistAddPayload({ ...base, current: null });
    expect('providers' in p).toBe(false);
    expect('subscriptionProviders' in p).toBe(false);
  });

  it('carries the stored subset forward when the caller does not supply one', () => {
    const current = { providers: [76], subscriptionProviders: [8] } as never;
    const p = buildWatchlistAddPayload({ ...base, current });
    expect(p.subscriptionProviders).toEqual([8]);
  });
});
