import { describe, it, expect } from 'vitest';
import { isMacLikePlatform, shortcutHint } from './platform';

describe('isMacLikePlatform', () => {
  it.each([
    ['MacIntel', true],
    ['macOS', true],
    ['iPhone', true],
    ['iPad', true],
    ['iPod touch', true],
    ['Win32', false],
    ['Windows', false],
    ['Linux x86_64', false],
    ['Linux armv81', false], // Android
    ['', false],
  ])('%s → %s', (platform, expected) => {
    expect(isMacLikePlatform(platform)).toBe(expected);
  });
});

describe('shortcutHint', () => {
  it('visar ⌘K på Mac', () => {
    expect(shortcutHint(true)).toBe('⌘K');
  });
  it('visar Ctrl K annars (även SSR-default)', () => {
    expect(shortcutHint(false)).toBe('Ctrl K');
  });
});
