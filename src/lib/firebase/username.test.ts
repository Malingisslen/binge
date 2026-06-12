import { describe, it, expect, vi } from 'vitest';

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

import { slugifyUsername, suggestUsernameFromIdentity, validateUsername } from './username';

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
