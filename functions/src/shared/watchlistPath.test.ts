import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isUserWatchlistDocPath, onlyUserWatchlistDocs } from './watchlistPath';

const HERE = join(fileURLToPath(import.meta.url), '..');
const REPO = join(HERE, '..', '..', '..');

describe('onlyUserWatchlistDocs — the rows a collection-group scan may process (BIN-1291)', () => {
  const row = (path: string) => ({ ref: { path } });

  it('keeps user library rows and drops group rows, in order', () => {
    const page = [
      row('groups/victim/watchlist/tv_1399'),
      row('users/a/watchlist/movie_1'),
      row('groups/g/watchlist/movie_2'),
      row('users/b/watchlist/tv_3'),
    ];
    expect(onlyUserWatchlistDocs(page).map((d) => d.ref.path)).toEqual([
      'users/a/watchlist/movie_1',
      'users/b/watchlist/tv_3',
    ]);
  });

  it('drops a group whose id looks like a user id — the attack shape', () => {
    expect(isUserWatchlistDocPath('groups/uid_of_someone/watchlist/tv_1')).toBe(false);
  });

  it('returns an empty list for a page of only group rows, without touching the input', () => {
    const page = [row('groups/g/watchlist/1')];
    expect(onlyUserWatchlistDocs(page)).toEqual([]);
    expect(page).toHaveLength(1);
  });
});

// Every file that runs `collectionGroup('watchlist')` must apply the path guard,
// in that file or in a module it imports directly (BIN-1299: a sibling in the same
// folder that the reader never imports proves nothing). Derived from the tracked
// files rather than listed, and read whole so a call split over two lines is still
// seen. Any quote style is matched; a collection id held in a constant is not.
describe('every collectionGroup(\'watchlist\') reader applies the path guard (BIN-1291)', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const QUERY = /collectionGroup\(\s*(['"`])watchlist\1\s*\)/;
  const GUARD_CALL = /(?<!function\s+)\b(onlyUserWatchlistDocs|isUserWatchlistDocPath)\s*\(/;
  const source = (file: string) => stripComments(readFileSync(join(REPO, file), 'utf8'));

  const files = execFileSync('git', ['ls-files', '--', 'functions/src'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => QUERY.test(source(f)));

  /** The reader's relative imports, resolved to tracked `.ts` files. */
  function directImports(file: string): string[] {
    const dir = dirname(file);
    return [...source(file).matchAll(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g)]
      .map((m) => join(dir, m[2]).replace(/\\/g, '/') + '.ts')
      .filter((f) => files.includes(f) || execFileSync('git', ['ls-files', '--', f], { cwd: REPO, encoding: 'utf8' }).trim() !== '')
      // The guard's own module defines it; a definition is not a call.
      .filter((f) => !f.endsWith('shared/watchlistPath.ts'));
  }

  it('finds the readers at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s filters on the path', (file) => {
    const guarded = [file, ...directImports(file)].some((f) => GUARD_CALL.test(source(f)));
    expect(guarded, `${file} scans collectionGroup('watchlist') but neither it nor a module it imports filters group rows`).toBe(true);
  });

  // The scan's own reach: a call split across lines must be seen.
  it('sees a guard call split over two lines', () => {
    expect(GUARD_CALL.test('const rows = onlyUserWatchlistDocs\n  (page);')).toBe(true);
    expect(GUARD_CALL.test('export function onlyUserWatchlistDocs(rows) {}')).toBe(false);
  });
});
