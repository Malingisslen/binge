import { describe, it, expect } from 'vitest';
import { parseTvCode, groupTvCode, cleanTvCode, TV_CODE_ALPHABET } from './tvPairingCode';

describe('parseTvCode', () => {
  it('accepts lowercase with a dash and returns it upper-cased', () => {
    expect(parseTvCode('k7m2-9qxh')).toBe('K7M29QXH');
  });
  it('accepts spaces and surrounding whitespace', () => {
    expect(parseTvCode('  K7M2 9QXH ')).toBe('K7M29QXH');
  });
  it('rejects too short and too long codes', () => {
    expect(parseTvCode('K7M29QX')).toBeNull();
    expect(parseTvCode('K7M29QXHA')).toBeNull();
  });
  it('uses the alphabet the server hands out', () => {
    expect(TV_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  });
  it('accepts every character of the alphabet in every position', () => {
    for (const ch of TV_CODE_ALPHABET) {
      for (let pos = 0; pos < 8; pos++) {
        const code = 'K7M29QXH'.split('');
        code[pos] = ch;
        expect(parseTvCode(code.join(''))).toBe(code.join(''));
      }
    }
  });
  it.each(['O', '0', 'I', '1'])('rejects the look-alike %s at the start, middle and end', (ch) => {
    expect(parseTvCode(`${ch}7M29QXH`)).toBeNull();
    expect(parseTvCode(`K7M${ch}9QXH`)).toBeNull();
    expect(parseTvCode(`K7M29QX${ch}`)).toBeNull();
  });
  it('ignores repeated separators', () => {
    expect(parseTvCode('K7M2 -- 9QXH')).toBe('K7M29QXH');
  });
  it('rejects empty, missing and punctuation', () => {
    expect(parseTvCode('')).toBeNull();
    expect(parseTvCode(null)).toBeNull();
    expect(parseTvCode(undefined)).toBeNull();
    expect(parseTvCode('K7M2!9QX')).toBeNull();
  });
});

describe('groupTvCode', () => {
  it('groups as 4 + 4', () => {
    expect(groupTvCode('K7M29QXH')).toBe('K7M2 9QXH');
  });
});

describe('cleanTvCode', () => {
  it('strips every dash and space', () => {
    expect(cleanTvCode('a b-c')).toBe('ABC');
  });
});
