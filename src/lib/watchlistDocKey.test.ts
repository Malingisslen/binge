import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchlistDocKey } from './watchlistDocKey';

// BIN-1022 — one formula, three readers.
//
// `removeItem` WRITES the removal generation under this key and `updateProgress` READS it.
// Nothing type-checks that the two build the same string, so if they ever drift the guard
// stops guarding and the suite stays green. Pinning the formula is half the answer; the
// other half is the source guard at the bottom, which is what notices a fourth site
// spelling it out again.

describe('watchlistDocKey', () => {
  it('is uid, colon, media-type doc id', () => {
    expect(watchlistDocKey('u1', 'tv', 1399)).toBe('u1:tv_1399');
    expect(watchlistDocKey('u1', 'movie', 27205)).toBe('u1:movie_27205');
  });

  it('separates the two media types for the same tmdb id', () => {
    // The whole reason the doc id is namespaced (BIN-560): a film and a series can share a
    // TMDB id, and a key that collided would let one title's removal mask the other's add.
    expect(watchlistDocKey('u1', 'tv', 42)).not.toBe(watchlistDocKey('u1', 'movie', 42));
  });

  it('separates accounts', () => {
    // The uid prefix is why an account switch does not inherit the previous user's
    // in-flight state. Same title, different person, different key.
    expect(watchlistDocKey('u1', 'tv', 42)).not.toBe(watchlistDocKey('u2', 'tv', 42));
  });

  it('no call site in WatchlistContext builds the formula by hand any more', () => {
    // The guard that outlives the three rows above. A new `${uid}:` template in that file
    // is a fourth definition of a shared key, and it would pass every assertion here.
    //
    // Matches the CONSTRUCTION, not a mention: a guard that reddened on the word would
    // push the next person to delete the explanation instead of the code. Comment lines
    // are dropped before matching for exactly that reason.
    const src = readFileSync(
      join(process.cwd(), 'src', 'contexts', 'WatchlistContext.tsx'),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).toMatch(/watchlistDocKey\(/); // the slice really found live code
    expect(code).not.toMatch(/`\$\{uid\}:/);
  });
});
