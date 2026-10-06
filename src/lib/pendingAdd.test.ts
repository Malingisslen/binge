import { describe, it, expect, beforeEach } from 'vitest';
import {
  PENDING_ADD_LOGIN_ARRIVAL_MS, PENDING_ADD_MAX_AGE_MS, clearPendingAdd, dropStalePendingAdd, parsePendingAdd,
  rememberPendingAdd, takePendingAdd,
} from './pendingAdd';
import { pendingAddStatus } from './pendingAdd.helpers';

// BIN-1442: a signed-out "Lägg till" survives the sign-in trip and is performed after.

const NOW = 1_800_000_000_000;
const add = { tmdbId: 1399, mediaType: 'tv' as const, title: 'Game of Thrones', posterPath: '/p.jpg', releaseYear: 2011, providers: [8], genreIds: [18] };

describe('pendingAdd', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('round-trips the tapped title, once', () => {
    rememberPendingAdd(add, NOW);
    expect(takePendingAdd(NOW + 1000)).toEqual(add);
    expect(takePendingAdd(NOW + 1000)).toBeNull();
  });

  it('forgets a tap older than the limit', () => {
    rememberPendingAdd(add, NOW);
    expect(takePendingAdd(NOW + PENDING_ADD_MAX_AGE_MS + 1)).toBeNull();
  });

  it('clearPendingAdd drops it', () => {
    rememberPendingAdd(add, NOW);
    clearPendingAdd();
    expect(takePendingAdd(NOW)).toBeNull();
  });

  it('refuses a malformed value planted in storage', () => {
    const base = { ...add, savedAt: NOW };
    const bad = [
      'not json',
      JSON.stringify({ ...base, tmdbId: -1 }),
      JSON.stringify({ ...base, tmdbId: '1399' }),
      JSON.stringify({ ...base, mediaType: 'person' }),
      JSON.stringify({ ...base, title: '' }),
      JSON.stringify({ ...base, providers: ['x'] }),
      JSON.stringify({ ...base, savedAt: NOW + 60_000 }),
      JSON.stringify({ ...base, savedAt: undefined }),
      JSON.stringify({ ...base, posterPath: 'https://evil.example/p.jpg' }),
      JSON.stringify({ ...base, releaseYear: 99999 }),
    ];
    for (const raw of bad) expect(parsePendingAdd(raw, NOW)).toBeNull();
  });

  // Shared computer: visitor A taps and walks away from /login; visitor B opens
  // /login later in the same tab. A's title must not land in B's library.
  it('the login page drops a tap left by an earlier, abandoned trip', () => {
    rememberPendingAdd(add, NOW);
    dropStalePendingAdd(NOW + PENDING_ADD_LOGIN_ARRIVAL_MS + 1);
    expect(takePendingAdd(NOW + PENDING_ADD_LOGIN_ARRIVAL_MS + 2)).toBeNull();
  });

  it('the login page keeps the tap that just sent the visitor there', () => {
    rememberPendingAdd(add, NOW);
    dropStalePendingAdd(NOW + 2000);
    expect(takePendingAdd(NOW + 5 * 60 * 1000)).toEqual(add);
  });

  it('a series becomes Följer, a film Vill se', () => {
    expect(pendingAddStatus('tv')).toBe('mina');
    expect(pendingAddStatus('movie')).toBe('vill_se');
  });
});
