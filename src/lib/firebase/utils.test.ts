import { describe, it, expect } from 'vitest';
import { sha256Hex, generateSecureToken } from './utils';

describe('sha256Hex', () => {
  it('matchar känt sha256 hex-värde för "" (tom sträng)', async () => {
    // Firestore-regelns hashing.sha256("").toHexString() ger samma värde.
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matchar känt sha256 hex-värde för "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returnerar lowercase hex (matchar Firestore-rule)', async () => {
    const out = await sha256Hex('Test123');
    expect(out).toMatch(/^[0-9a-f]{64}$/);
    expect(out).toBe(out.toLowerCase());
  });

  it('är deterministisk (samma input → samma hash)', async () => {
    const a = await sha256Hex('binge');
    const b = await sha256Hex('binge');
    expect(a).toBe(b);
  });

  it('olika input ger olika hash', async () => {
    const a = await sha256Hex('binge');
    const b = await sha256Hex('Binge');
    expect(a).not.toBe(b);
  });
});

describe('generateSecureToken', () => {
  it('returnerar 32-char hex (16 bytes = 128 bitars entropi)', () => {
    const t = generateSecureToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it('genererar olika värden vid varje anrop', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
  });
});
