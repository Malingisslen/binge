import { describe, it, expect } from 'vitest';
import { resolveRoute } from './resolveRoute';

describe('resolveRoute — happy path per branch', () => {
  it.each([
    ['/tillsammans/abc', { kind: 'tillsammans', id: 'abc' }],
    ['/grupper/g1', { kind: 'grupper', id: 'g1' }],
    ['/user/malin', { kind: 'user', username: 'malin' }],
    ['/list/l9', { kind: 'list', listId: 'l9' }],
    ['/provider/8', { kind: 'provider', id: '8' }],
    ['/person/287', { kind: 'person', id: '287' }],
    ['/movie/42', { kind: 'movie', id: '42' }],
    ['/tv/42', { kind: 'tv', id: '42' }],
  ] as const)('%s → %o', (path, expected) => {
    expect(resolveRoute(path)).toEqual(expected);
  });
});

describe('resolveRoute — the season-before-tv ordering dependency (BIN-345)', () => {
  it('matches /tv/:id/season/:num as a season, NOT the bare tv branch', () => {
    expect(resolveRoute('/tv/42/season/3')).toEqual({ kind: 'season', id: '42', num: '3' });
  });
  it('carries the id and num separately so the page can fetch the right season', () => {
    const m = resolveRoute('/tv/100/season/7');
    expect(m).toEqual({ kind: 'season', id: '100', num: '7' });
  });
  it('falls back to the bare tv page when season has no number', () => {
    expect(resolveRoute('/tv/42/season')).toEqual({ kind: 'tv', id: '42' });
  });
  it('a trailing slash after season (empty segment) is dropped → still bare tv', () => {
    expect(resolveRoute('/tv/42/season/')).toEqual({ kind: 'tv', id: '42' });
  });
});

describe('resolveRoute — /ny create-page guards', () => {
  it('/tillsammans/ny is NOT a session id (create page is a separate static route)', () => {
    expect(resolveRoute('/tillsammans/ny')).toBeNull();
  });
  it('/grupper/ny is NOT a group id', () => {
    expect(resolveRoute('/grupper/ny')).toBeNull();
  });
  it('but a session/group literally named via another segment still resolves', () => {
    // Only the exact reserved word 'ny' is guarded; e.g. 'nyx' is a real id.
    expect(resolveRoute('/grupper/nyx')).toEqual({ kind: 'grupper', id: 'nyx' });
  });
  it('the /ny guard is intentionally tillsammans/grupper-only — /user/ny is a real username', () => {
    // Only tillsammans + grupper have create-pages at /<x>/ny. If a future /user/ny
    // (or /list/ny etc.) create-page is added, this test must flip and a guard added.
    expect(resolveRoute('/user/ny')).toEqual({ kind: 'user', username: 'ny' });
  });
});

describe('resolveRoute — non-matches resolve to null (NotFound fallback)', () => {
  it.each([
    ['/'],                 // root
    ['/_'],                // the prerender placeholder path — must never match a branch
    ['/movie'],            // no id
    ['/tv'],               // no id
    ['/foo/1'],            // unknown segment[0]
    ['/Movie/42'],         // case-sensitive: URLs are lowercase-canonical
    ['/TV/42'],
    ['/user'],             // no username
  ])('%s → null', (path) => {
    expect(resolveRoute(path)).toBeNull();
  });
});

describe('resolveRoute — lenient trailing segments (preserves prior behavior)', () => {
  it('ignores junk after a movie id rather than 404ing', () => {
    expect(resolveRoute('/movie/42/extra')).toEqual({ kind: 'movie', id: '42' });
  });
  it('ignores junk after a tv id', () => {
    expect(resolveRoute('/tv/42/extra')).toEqual({ kind: 'tv', id: '42' });
  });
});
