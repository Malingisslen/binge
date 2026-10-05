import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readBuildCacheEntry,
  writeBuildCache,
  readContentChangedAt,
  contentFingerprint,
  recordBuildFetchOutcome,
  buildFetchFailed,
} from './buildCache';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tmdb-cache-test-'));
  process.env.TMDB_CACHE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
});

describe('buildCache', () => {
  it('skriver och läser tillbaka data + tidsstämpel', () => {
    const now = 1_000_000;
    writeBuildCache('tv', 1438, { name: 'The Wire' }, now);
    const entry = readBuildCacheEntry<{ name: string }>('tv', 1438, now);
    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual({ name: 'The Wire' });
    expect(entry!.fetchedAt).toBe(now);
  });

  it('returnerar null vid miss', () => {
    expect(readBuildCacheEntry('tv', 999)).toBeNull();
  });

  it('separerar nycklar på kind + id', () => {
    writeBuildCache('tv', 1, { k: 'tv' });
    writeBuildCache('movie', 1, { k: 'movie' });
    expect(readBuildCacheEntry<{ k: string }>('tv', 1)!.data).toEqual({ k: 'tv' });
    expect(readBuildCacheEntry<{ k: string }>('movie', 1)!.data).toEqual({ k: 'movie' });
  });

  it('serverar fortfarande en stale post (färskhet avgörs av anroparen, inte här)', () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 dagar sedan
    writeBuildCache('tv', 1438, { name: 'stale' }, past);
    // 8 dagar är "stale" men inom HARD_TTL → posten returneras (buildFetch
    // beslutar om refresh). Detta är den medvetna kontraktsändringen mot den
    // gamla TTL-filtreringen.
    const entry = readBuildCacheEntry<{ name: string }>('tv', 1438);
    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual({ name: 'stale' });
  });

  it('behandlar en post bortom HARD_TTL (30 dagar) som miss', () => {
    const ancient = 5_000_000_000;
    writeBuildCache('tv', 1438, { name: 'urgammal' }, ancient);
    // Läs 31 dagar senare med explicit now → deterministiskt vid gränsen.
    const readAt = ancient + 31 * 24 * 60 * 60 * 1000;
    expect(readBuildCacheEntry('tv', 1438, readAt)).toBeNull();
  });

  it('returnerar null vid korrupt JSON (behandlas som miss, kastar inte)', () => {
    writeBuildCache('tv', 1438, { ok: true });
    writeFileSync(join(dir, 'tv-1438.json'), '{ inte json');
    expect(readBuildCacheEntry('tv', 1438)).toBeNull();
  });

  it('returnerar null när fetchedAt saknas/ogiltig', () => {
    writeFileSync(join(dir, 'tv-77.json'), JSON.stringify({ data: { x: 1 } }));
    expect(readBuildCacheEntry('tv', 77)).toBeNull();
  });
});

describe('buildCache — innehållsstämpeln för sitemapens lastmod (SEO-5)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const base = { title: 'Testfilm', overview: 'x', popularity: 10, vote_count: 5,
    'watch/providers': { results: { SE: { flatrate: [{ provider_id: 8 }] } } } };

  it('stämplar första skrivningen', () => {
    writeBuildCache('movie', 1, base, 1_000_000);
    expect(readContentChangedAt('movie', 1)).toBe(1_000_000);
  });

  it('flyttar inte stämpeln när bara rankningstal ändrats', () => {
    writeBuildCache('movie', 1, base, 1_000_000);
    writeBuildCache('movie', 1, { ...base, popularity: 99, vote_count: 500 }, 1_000_000 + 7 * DAY);
    expect(readContentChangedAt('movie', 1)).toBe(1_000_000);
  });

  it('flyttar stämpeln när tillgängligheten ändrats', () => {
    writeBuildCache('movie', 1, base, 1_000_000);
    const later = 1_000_000 + 7 * DAY;
    writeBuildCache('movie', 1, { ...base, 'watch/providers': { results: { SE: { flatrate: [{ provider_id: 337 }] } } } }, later);
    expect(readContentChangedAt('movie', 1)).toBe(later);
  });

  it('ger en post från före stämplarna dess egen hämttid, inte nu', () => {
    // A cache entry written before this change: data on disk, no sidecar.
    writeFileSync(join(dir, 'movie-2.json'), JSON.stringify({ fetchedAt: 1_000_000, data: base }));
    writeBuildCache('movie', 2, base, 1_000_000 + 7 * DAY);
    expect(readContentChangedAt('movie', 2)).toBe(1_000_000);
  });

  it('är okänd utan stämpel', () => {
    expect(readContentChangedAt('movie', 404)).toBeNull();
  });

  it('fingeravtrycket bortser från de flyktiga fälten och inget annat', () => {
    expect(contentFingerprint({ ...base, popularity: 1, recommendations: { results: [1] } }))
      .toBe(contentFingerprint({ ...base, popularity: 2, recommendations: { results: [2] } }));
    expect(contentFingerprint({ ...base, overview: 'y' })).not.toBe(contentFingerprint(base));
  });
});

describe('buildCache — markören för misslyckad bygghämtning (SEO-13)', () => {
  it('sätts vid misslyckande och tas bort vid nästa lyckade', () => {
    expect(buildFetchFailed('tv', 7)).toBe(false);
    recordBuildFetchOutcome('tv', 7, false);
    expect(buildFetchFailed('tv', 7)).toBe(true);
    recordBuildFetchOutcome('tv', 7, true);
    expect(buildFetchFailed('tv', 7)).toBe(false);
  });

  it('är per kind + id', () => {
    recordBuildFetchOutcome('tv', 7, false);
    expect(buildFetchFailed('movie', 7)).toBe(false);
  });
});
