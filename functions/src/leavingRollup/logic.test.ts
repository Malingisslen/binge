import { describe, it, expect } from 'vitest';
import {
  buildLeavingRollupFromChanges,
  parseTmdbRef,
  isoFromUnix,
  MOTN_SERVICE_TO_TMDB,
  type ChangeItem,
  type ShowRef,
} from './logic';

const ts = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);

const change = (showId: string, over: Partial<ChangeItem> = {}): ChangeItem => ({
  showId,
  streamingOptionType: 'subscription',
  serviceId: 'netflix',
  timestamp: ts('2026-07-10'),
  ...over,
});

describe('parseTmdbRef', () => {
  it('parses movie and tv tmdbIds', () => {
    expect(parseTmdbRef('movie/597')).toEqual({ mediaType: 'movie', id: 597 });
    expect(parseTmdbRef('tv/1396')).toEqual({ mediaType: 'tv', id: 1396 });
  });
  it('rejects missing/malformed/unknown-type ids', () => {
    expect(parseTmdbRef(undefined)).toBeNull();
    expect(parseTmdbRef('')).toBeNull();
    expect(parseTmdbRef('597')).toBeNull();      // no slash
    expect(parseTmdbRef('movie/')).toBeNull();   // no number
    expect(parseTmdbRef('movie/abc')).toBeNull();
    expect(parseTmdbRef('person/5')).toBeNull(); // unsupported type
  });
});

describe('isoFromUnix', () => {
  it('converts unix seconds to a UTC date string', () => {
    expect(isoFromUnix(ts('2026-07-10'))).toBe('2026-07-10');
  });
});

describe('MOTN_SERVICE_TO_TMDB', () => {
  it('maps the major SE services to their TMDB provider ids', () => {
    expect(MOTN_SERVICE_TO_TMDB.netflix).toBe(8);
    expect(MOTN_SERVICE_TO_TMDB.disney).toBe(337);
    expect(MOTN_SERVICE_TO_TMDB.max).toBe(384);
    expect(MOTN_SERVICE_TO_TMDB.viaplay).toBe(76);
  });
});

describe('buildLeavingRollupFromChanges', () => {
  const shows: Record<string, ShowRef> = {
    a: { tmdbId: 'movie/597' },
    b: { tmdbId: 'tv/1396' },
    c: { tmdbId: 'movie/603' },
  };

  it('groups a subscription expiry under its TMDB provider', () => {
    const r = buildLeavingRollupFromChanges([change('a')], shows);
    expect(r.byProvider).toEqual({ '8': [{ tmdbId: 597, mediaType: 'movie', leaving: '2026-07-10' }] });
  });

  it('carries the tv media type through', () => {
    const r = buildLeavingRollupFromChanges([change('b', { serviceId: 'disney' })], shows);
    expect(r.byProvider['337']).toEqual([{ tmdbId: 1396, mediaType: 'tv', leaving: '2026-07-10' }]);
  });

  it('ignores rent/buy expirations — only subscription', () => {
    const r = buildLeavingRollupFromChanges([change('a', { streamingOptionType: 'rent' })], shows);
    expect(r.byProvider).toEqual({});
  });

  it('ignores changes with no exact timestamp', () => {
    const r = buildLeavingRollupFromChanges([change('a', { timestamp: null })], shows);
    expect(r.byProvider).toEqual({});
  });

  it('ignores services we have no /forsvinner page for', () => {
    const r = buildLeavingRollupFromChanges([change('a', { serviceId: 'hulu' })], shows);
    expect(r.byProvider).toEqual({});
  });

  it('ignores a change whose show has no resolvable tmdbId', () => {
    const r = buildLeavingRollupFromChanges([change('zzz')], shows); // not in shows map
    expect(r.byProvider).toEqual({});
  });

  it('keeps the soonest date when a title expires twice on a service', () => {
    const r = buildLeavingRollupFromChanges([
      change('a', { timestamp: ts('2026-07-20') }),
      change('a', { timestamp: ts('2026-07-05') }),
    ], shows);
    expect(r.byProvider['8']).toEqual([{ tmdbId: 597, mediaType: 'movie', leaving: '2026-07-05' }]);
  });

  it('sorts each provider nearest-deadline-first', () => {
    const r = buildLeavingRollupFromChanges([
      change('a', { timestamp: ts('2026-07-20') }),
      change('c', { timestamp: ts('2026-07-05') }),
    ], shows);
    expect(r.byProvider['8'].map((e) => e.tmdbId)).toEqual([603, 597]);
  });

  it('separates titles by service into different providers', () => {
    const r = buildLeavingRollupFromChanges([
      change('a', { serviceId: 'netflix' }),
      change('c', { serviceId: 'viaplay' }),
    ], shows);
    expect(r.byProvider['8']).toHaveLength(1);
    expect(r.byProvider['76']).toHaveLength(1);
  });

  it('caps each provider list', () => {
    const many: ChangeItem[] = [];
    const manyShows: Record<string, ShowRef> = {};
    for (let i = 0; i < 100; i++) {
      many.push(change(`s${i}`, { timestamp: ts('2026-07-10') }));
      manyShows[`s${i}`] = { tmdbId: `movie/${1000 + i}` };
    }
    const r = buildLeavingRollupFromChanges(many, manyShows, 80);
    expect(r.byProvider['8'].length).toBe(80);
  });
});
