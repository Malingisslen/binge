// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { rememberLoginBounce, takeLoginBounce } from './loginBounce';

describe('loginBounce', () => {
  beforeEach(() => sessionStorage.clear());

  it('is false when nothing bounced the visitor', () => {
    expect(takeLoginBounce()).toBe(false);
  });

  it('is true exactly once after a bounce', () => {
    rememberLoginBounce();
    expect(takeLoginBounce()).toBe(true);
    expect(takeLoginBounce()).toBe(false);
  });
});
