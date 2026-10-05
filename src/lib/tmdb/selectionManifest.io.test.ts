import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_VERSION,
  type SelectionManifest,
  readSelectionManifest,
  writeSelectionManifest,
} from './selectionManifest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'selection-manifest-test-'));
  process.env.TMDB_CACHE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.TMDB_CACHE_DIR;
});

function manifest(type: SelectionManifest['type'], ids: number[]): SelectionManifest {
  return {
    version: MANIFEST_VERSION,
    type,
    derivedAt: 1_000_000,
    ids: ids.map(id => ({ id, lastDerived: 1_000_000 })),
  };
}

describe('selectionManifest IO', () => {
  it('skriver och läser tillbaka ett manifest', () => {
    writeSelectionManifest(manifest('movie', [1, 2, 3]));

    const read = readSelectionManifest('movie');
    expect(read?.ids.map(e => e.id)).toEqual([1, 2, 3]);
    expect(read?.derivedAt).toBe(1_000_000);
  });

  it('håller typerna isär i egna filer', () => {
    writeSelectionManifest(manifest('movie', [1]));
    writeSelectionManifest(manifest('tv', [2]));

    expect(readSelectionManifest('movie')?.ids.map(e => e.id)).toEqual([1]);
    expect(readSelectionManifest('tv')?.ids.map(e => e.id)).toEqual([2]);
  });

  // ADR 0024: produktionens cache bär ett version 1-manifest med topplisteurvalet.
  // Det ska läsas som saknat, så att första bygget härleder kärnan från grunden.
  it('läser ett version 1-manifest ur den gamla cachen som saknat', () => {
    writeFileSync(
      join(dir, 'selection-movie.json'),
      JSON.stringify({ version: 1, type: 'movie', derivedAt: 1_000_000, ids: [{ id: 1, lastDerived: 1_000_000 }] }),
    );

    expect(readSelectionManifest('movie')).toBeNull();
  });

  it('ger null när filen inte finns', () => {
    expect(readSelectionManifest('movie')).toBeNull();
  });

  it('ger null för en korrupt fil i stället för att kasta', () => {
    writeFileSync(join(dir, 'selection-movie.json'), '{ trasig');

    expect(readSelectionManifest('movie')).toBeNull();
  });

  // Atomiciteten är inte teoretisk: cache-sparningen i deploy.yml kör med
  // `if: always()` och tarar katalogen även när bygget fällts halvvägs. En
  // direktskrivning hade kunnat bevara en halvskriven fil till nästa bygge.
  it('lämnar inga temp-filer efter en lyckad skrivning', () => {
    writeSelectionManifest(manifest('movie', [1, 2]));

    const stray = readdirSync(dir).filter(f => f.endsWith('.tmp'));
    expect(stray).toEqual([]);
    expect(readdirSync(dir)).toContain('selection-movie.json');
  });

  it('ersätter ett tidigare manifest i stället för att slå ihop med det', () => {
    writeSelectionManifest(manifest('movie', [1, 2, 3]));
    writeSelectionManifest(manifest('movie', [9]));

    expect(readSelectionManifest('movie')?.ids.map(e => e.id)).toEqual([9]);
  });

  // Skrivfel får aldrig fälla bygget — samma best-effort-kontrakt som buildCache.
  it('sväljer ett skrivfel mot en omöjlig katalog', () => {
    process.env.TMDB_CACHE_DIR = join(dir, 'fil-inte-katalog', 'x');
    writeFileSync(join(dir, 'fil-inte-katalog'), 'jag är en fil');

    expect(() => writeSelectionManifest(manifest('movie', [1]))).not.toThrow();
  });
});
