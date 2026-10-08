import { describe, it, expect } from 'vitest';
import { chromeMode, chromePart } from './chromeMode';

describe('chromeMode', () => {
  it('is unknown before mount and while auth is loading', () => {
    expect(chromeMode(false, false, null)).toBe('unknown');
    expect(chromeMode(true, true, null)).toBe('unknown');
    expect(chromeMode(true, true, 'u1')).toBe('unknown');
  });
  it('is app for a signed-in visitor and guest for a signed-out one', () => {
    expect(chromeMode(true, false, 'u1')).toBe('app');
    expect(chromeMode(true, false, null)).toBe('guest');
  });
});

describe('chromePart', () => {
  it('shows only the matching audience once auth has answered', () => {
    expect(chromePart('app', 'app')).toEqual({ show: true, className: undefined });
    expect(chromePart('app', 'guest').show).toBe(false);
    expect(chromePart('guest', 'guest')).toEqual({ show: true, className: undefined });
    expect(chromePart('guest', 'app').show).toBe(false);
  });
  it('shows both, each with its CSS class, while unknown', () => {
    expect(chromePart('unknown', 'app')).toEqual({ show: true, className: 'pre-app' });
    expect(chromePart('unknown', 'guest')).toEqual({ show: true, className: 'pre-guest' });
  });
});
