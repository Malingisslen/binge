import { describe, it, expect } from 'vitest';
import {
  CODE_ALPHABET, CODE_LENGTH, generateUserCode, normalizeUserCode, sha256Hex, secretMatches,
  generateDeviceSecret, sanitizeDeviceName, nextRateState, ipRateKey, pollTooSoon, isExpired,
  tvPrincipalUid, RATE_LIMITS, PAIRING_TTL_MS, PAIRING_ROW_TTL_MS, MAX_TV_DEVICES, isTvPrincipalUid, generateDeviceId,
  isTvAuth,
} from './logic';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('isTvAuth', () => {
  it('is true only for a token carrying tv: true', () => {
    expect(isTvAuth({ token: { tv: true } })).toBe(true);
    expect(isTvAuth({ token: { tv: 'true' } })).toBe(false);
    expect(isTvAuth({ token: {} })).toBe(false);
    expect(isTvAuth(undefined)).toBe(false);
    expect(isTvAuth(null)).toBe(false);
  });
  // A TV token survives "Koppla bort" (only the rules read the tvDevices row), so an
  // account-gated callable has to refuse it itself.
  it.each(['../askbinge/parse.ts', '../submitReport/index.ts', './index.ts'])('%s refuses a TV caller', (file) => {
    const src = readFileSync(resolve(__dirname, file), 'utf8');
    expect(src).toMatch(/if \(isTvAuth\(request\.auth\)\) \{?\s*throw new HttpsError\('permission-denied'/);
  });
});

describe('user code', () => {
  it('is 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateUserCode();
      expect(c).toHaveLength(CODE_LENGTH);
      for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
    }
  });
  it('has no look-alike characters', () => {
    for (const ch of ['I', 'O', '0', '1']) expect(CODE_ALPHABET).not.toContain(ch);
    expect(CODE_ALPHABET.length).toBe(32);
  });
  it('normalizes case, spaces and dashes', () => {
    expect(normalizeUserCode('k7m2-9qxh')).toBe('K7M29QXH');
    expect(normalizeUserCode('K7M2 9QXH')).toBe('K7M29QXH');
  });
  it('rejects wrong length, look-alikes and non-strings', () => {
    expect(normalizeUserCode('K7M29QX')).toBeNull();
    expect(normalizeUserCode('K7M29QX0')).toBeNull();
    expect(normalizeUserCode('K7M29QXI')).toBeNull();
    expect(normalizeUserCode(12345678)).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
  });
});

describe('device secret', () => {
  it('matches only the secret it was hashed from', () => {
    const s = generateDeviceSecret();
    expect(secretMatches(s, sha256Hex(s))).toBe(true);
    expect(secretMatches(s + 'x', sha256Hex(s))).toBe(false);
    expect(secretMatches('', sha256Hex(s))).toBe(false);
  });
  it('refuses non-string and malformed stored hashes', () => {
    expect(secretMatches(undefined, 'abcd')).toBe(false);
    expect(secretMatches('x', 'zz')).toBe(false);
    expect(secretMatches('x', undefined)).toBe(false);
  });
  it('is long enough (256 bit)', () => {
    expect(Buffer.from(generateDeviceSecret(), 'base64url')).toHaveLength(32);
  });
});

describe('sanitizeDeviceName', () => {
  it('keeps a normal model name', () => expect(sanitizeDeviceName('Chromecast (Google TV)')).toBe('Chromecast (Google TV)'));
  it('strips markup and control characters', () => expect(sanitizeDeviceName('<b>TV</b>\n')).toBe('bTVb'));
  it('caps length at 40', () => expect(sanitizeDeviceName('a'.repeat(100))).toHaveLength(40));
  it('falls back for empty or non-string', () => {
    expect(sanitizeDeviceName('')).toBe('Google TV');
    expect(sanitizeDeviceName(42)).toBe('Google TV');
  });
});

describe('nextRateState', () => {
  const lim = { max: 3, windowMs: 1000 };
  it('starts a window', () => expect(nextRateState(null, 5, lim)).toEqual({ windowStartMs: 5, count: 1 }));
  it('counts up to the max and then refuses', () => {
    let s = nextRateState(null, 0, lim);
    s = nextRateState(s, 10, lim);
    s = nextRateState(s, 20, lim);
    expect(s).toEqual({ windowStartMs: 0, count: 3 });
    expect(nextRateState(s, 30, lim)).toBeNull();
  });
  it('opens a fresh window after it expires', () => {
    expect(nextRateState({ windowStartMs: 0, count: 3 }, 1000, lim)).toEqual({ windowStartMs: 1000, count: 1 });
  });
  it('keeps counting one millisecond before the window ends', () => {
    expect(nextRateState({ windowStartMs: 0, count: 2 }, 999, lim)).toEqual({ windowStartMs: 0, count: 3 });
    expect(nextRateState({ windowStartMs: 0, count: 3 }, 999, lim)).toBeNull();
  });
  it('uses the agreed limits', () => {
    expect(RATE_LIMITS.start.max).toBe(10);
    expect(RATE_LIMITS.approveUid.max).toBe(10);
    expect(RATE_LIMITS.approveIp.max).toBe(20);
  });
});

describe('misc', () => {
  it('ipRateKey never contains the IP and changes with the day', () => {
    const a = ipRateKey('start', '1.2.3.4', '2026-10-31');
    expect(a).not.toContain('1.2.3.4');
    expect(a).not.toBe(ipRateKey('start', '1.2.3.4', '2026-11-01'));
    expect(a).toBe(ipRateKey('start', '1.2.3.4', '2026-10-31'));
  });
  it('pollTooSoon refuses polls closer than 4 s', () => {
    expect(pollTooSoon(1000, 4999)).toBe(true);
    expect(pollTooSoon(1000, 5000)).toBe(false);
    expect(pollTooSoon(null, 0)).toBe(false);
  });
  it('isExpired is inclusive at the boundary', () => {
    expect(isExpired(100, 99)).toBe(false);
    expect(isExpired(100, 100)).toBe(true);
  });
  it('device ids are 24 hex characters and differ between calls', () => {
    const id = generateDeviceId();
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(generateDeviceId()).not.toBe(id);
  });
  it('pairing lifetimes and device cap are the agreed ones', () => {
    expect(PAIRING_TTL_MS).toBe(60_000);
    expect(PAIRING_ROW_TTL_MS).toBeGreaterThan(PAIRING_TTL_MS);
    expect(MAX_TV_DEVICES).toBe(5);
  });
  it('tv principal uid is prefixed', () => expect(tvPrincipalUid('abc')).toBe('tv_abc'));
  it('isTvPrincipalUid recognises exactly what the poll mints', () => {
    expect(isTvPrincipalUid(tvPrincipalUid(generateDeviceId()))).toBe(true);
    expect(isTvPrincipalUid('Xk3vQ9pLmN2bR7tY1wZ0aB4cD5eF')).toBe(false); // ordinary 28-char Firebase uid
    expect(isTvPrincipalUid('tv_abc')).toBe(false);
    expect(isTvPrincipalUid(`tv_${'a'.repeat(24)}x`)).toBe(false);
    expect(isTvPrincipalUid(undefined)).toBe(false);
  });
});
