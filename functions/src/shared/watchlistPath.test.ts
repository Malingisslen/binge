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
// in that file or in a sibling module of the same function. Derived with git grep
// rather than listed. Any quote style is matched; a collection id held in a
// constant is not.
describe('every collectionGroup(\'watchlist\') reader applies the path guard (BIN-1291)', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const QUERY = /collectionGroup\(\s*(['"`])watchlist\1\s*\)/;

  const files = execFileSync('git', ['grep', '-l', '-E', 'collectionGroup\\(\\s*.watchlist.', '--', 'functions/src'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => QUERY.test(stripComments(readFileSync(join(REPO, f), 'utf8'))));

  it('finds the readers at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s filters on the path', (file) => {
    const dir = dirname(join(REPO, file));
    const siblings = execFileSync('git', ['ls-files', '--', dir], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      // The guard's own module defines it; a definition is not a call.
      .filter((f) => !f.endsWith('shared/watchlistPath.ts'));
    const guarded = siblings.some((f) =>
      /(?<!function )\b(onlyUserWatchlistDocs|isUserWatchlistDocPath)\(/.test(stripComments(readFileSync(join(REPO, f), 'utf8'))),
    );
    expect(guarded, `${file} scans collectionGroup('watchlist') but nothing in its folder filters group rows`).toBe(true);
  });
});
