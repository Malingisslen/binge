import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildCacheEntry, writeBuildCache } from './buildCache';

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
