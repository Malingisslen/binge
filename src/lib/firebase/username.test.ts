import { describe, it, expect, vi, beforeEach } from 'vitest';

// slugifyUsername/suggestUsernameFromIdentity är pure och rör inte Firestore,
// men ./username importerar fsdb från ./db för andra exporter — mocka så
// auth/Firestore inte triggar init i testmiljön.
vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(),
}));

import { slugifyUsername, suggestUsernameFromIdentity, validateUsername, claimUsername } from './username';
import { markDeletionStarted, clearDeletionStarted } from '../deletionMarker';
import { DELETION_IN_PROGRESS } from './userDocWrite';
import { writeBatch } from 'firebase/firestore';

describe('slugifyUsername', () => {
  it('lowercaserar och stripperar mellanslag', () => {
    expect(slugifyUsername('Malin Gisslen')).toBe('malingisslen');
  });

  it('tar bort accenter (Gisslén → gisslen)', () => {
    expect(slugifyUsername('Gisslén')).toBe('gisslen');
    expect(slugifyUsername('café')).toBe('cafe');
    expect(slugifyUsername('Åsa Öberg')).toBe('asaoberg');
  });

  it('strippar specialtecken men behåller bindestreck', () => {
    expect(slugifyUsername("John O'Brien")).toBe('johnobrien');
    expect(slugifyUsername('Joe (Smith)')).toBe('joesmith');
    expect(slugifyUsername('cool-user-123')).toBe('cool-user-123');
  });

  it('kollapsar och trimmar bindestreck', () => {
    expect(slugifyUsername('--foo--bar--')).toBe('foo-bar');
    expect(slugifyUsername('a -- b')).toBe('a-b');
  });

  it('cap:ar på 20 tecken', () => {
    expect(slugifyUsername('a'.repeat(30))).toHaveLength(20);
  });

  it('returnerar tom sträng om inget alfanumeriskt finns kvar', () => {
    expect(slugifyUsername('!!!')).toBe('');
    expect(slugifyUsername('   ')).toBe('');
  });
});

describe('suggestUsernameFromIdentity', () => {
  it('föredrar slugifierad displayName', () => {
    expect(suggestUsernameFromIdentity('Malin Gisslén', 'malin@kommerskollegium.se'))
      .toBe('malingisslen');
  });

  it('faller tillbaka till email local-part när displayName ger ogiltig kandidat', () => {
    expect(suggestUsernameFromIdentity('A', 'filmnerden@example.com'))
      .toBe('filmnerden');
  });

  it('returnerar null när varken displayName eller email duger', () => {
    expect(suggestUsernameFromIdentity(null, null)).toBeNull();
    expect(suggestUsernameFromIdentity('!!', '!!@x.se')).toBeNull();
  });

  it('respekterar validateUsername — bindestreck-i-kanten är ogiltigt', () => {
    // Slugify trimmar redan kant-bindestreck, men dubbelkollar att vi inte
    // smyger in en kandidat som validateUsername skulle nita.
    const candidate = suggestUsernameFromIdentity('-foo-', null);
    expect(candidate === null || validateUsername(candidate) === null).toBe(true);
  });
});


// BIN-816 / ADR 0019 condition 1 — `claimUsername` is one of the two writers that
// cannot go through `mergeUserDoc`, because `users/{uid}.username` rides in the
// same atomic batch as the reservation move. It calls `assertProfileWritable`
// directly instead, and that call is the thing a future refactor is most likely
// to drop: the chokepoint scan only checks that the TOKEN appears in the file, so
// `if (false) assertProfileWritable(uid)` would keep the guard test green (test
// review, 2026-08-13). This pins the behaviour.
//
// It matters here more than anywhere else: `tryAutoClaimUsername` reaches this
// with no user action at all, so an unguarded call re-reserves the very handle
// the deletion cascade just released.
describe('claimUsername mot en påbörjad radering (BIN-816)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(writeBatch).mockReset();
  });

  it('vägrar, och bygger aldrig ens sin batch', async () => {
    markDeletionStarted('u1', 1_000);

    await expect(claimUsername('u1', 'nytt', null)).rejects.toThrow(DELETION_IN_PROGRESS);

    // Inte bara "den kastade": grinden ligger FÖRE batchen, så reservationen kan
    // inte ha skrivits och sedan rullats tillbaka.
    expect(writeBatch).not.toHaveBeenCalled();
  });

  it('släpper igenom när ingen radering pågår', async () => {
    // Kontrollprovet. Utan det passerar påståendet ovan på en funktion som
    // vägrar för alla.
    const commit = vi.fn(async () => {});
    vi.mocked(writeBatch).mockReturnValue({
      set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit,
    } as unknown as ReturnType<typeof writeBatch>);
    clearDeletionStarted('u1');

    await claimUsername('u1', 'nytt', null);

    expect(commit).toHaveBeenCalledTimes(1);
  });
});
