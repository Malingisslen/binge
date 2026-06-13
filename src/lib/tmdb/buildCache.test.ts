import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildCache, writeBuildCache } from './buildCache';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tmdb-cache-test-'));
  process.env.TMDB_CACHE_DIR = dir;
  delete process.env.TMDB_CACHE_BUST;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
  delete process.env.TMDB_CACHE_BUST;
});

describe('buildCache', () => {
  it('skriver och läser tillbaka data', () => {
    writeBuildCache('tv', 1438, { name: 'The Wire' });
    expect(readBuildCache('tv', 1438)).toEqual({ name: 'The Wire' });
  });

  it('returnerar null vid miss', () => {
    expect(readBuildCache('tv', 999)).toBeNull();
  });

  it('separerar nycklar på kind + id', () => {
    writeBuildCache('tv', 1, { k: 'tv' });
    writeBuildCache('movie', 1, { k: 'movie' });
    expect(readBuildCache('tv', 1)).toEqual({ k: 'tv' });
    expect(readBuildCache('movie', 1)).toEqual({ k: 'movie' });
  });

  it('returnerar null när posten är äldre än TTL', () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 dagar sedan
    writeBuildCache('tv', 1438, { name: 'gammal' }, past);
    expect(readBuildCache('tv', 1438)).toBeNull();
  });

  it('returnerar null när TMDB_CACHE_BUST=1 (även för färsk post)', () => {
    writeBuildCache('tv', 1438, { name: 'färsk' });
    process.env.TMDB_CACHE_BUST = '1';
    expect(readBuildCache('tv', 1438)).toBeNull();
  });

  it('returnerar null vid korrupt JSON (behandlas som miss, kastar inte)', () => {
    writeBuildCache('tv', 1438, { ok: true });
    writeFileSync(join(dir, 'tv-1438.json'), '{ inte json');
    expect(readBuildCache('tv', 1438)).toBeNull();
  });
});
