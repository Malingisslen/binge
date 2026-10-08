import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GUEST_PROVIDERS_KEY,
  GUEST_PRICED_PROVIDERS,
  clearGuestSelection,
  loadGuestSelection,
  sanitizeGuestSelection,
  saveGuestSelection,
} from './guestProviders';

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('sanitizeGuestSelection', () => {
  it('keeps known canonical paid providers with an existing tier or null', () => {
    expect(sanitizeGuestSelection({ 8: 'standard', 119: null })).toEqual({ 8: 'standard', 119: null });
  });

  it('drops a tier the catalog does not have', () => {
    expect(sanitizeGuestSelection({ 8: 'ultra', 337: 'ads' })).toEqual({ 337: 'ads' });
  });

  it('drops a tier on an untiered provider', () => {
    expect(sanitizeGuestSelection({ 119: 'standard' })).toEqual({});
  });

  it('drops alias ids, free, ad-funded, rent and unknown providers', () => {
    // 175 = Netflix alias, 520 = SVT Play (free), 300 = Pluto TV (ads), 35 = Rakuten (rent), 999999 unknown
    expect(sanitizeGuestSelection({ 175: null, 520: null, 300: null, 35: null, 999999: null })).toEqual({});
  });

  it('drops non-numeric keys and non-string tier values', () => {
    expect(sanitizeGuestSelection({ abc: null, 8: 5, 76: { x: 1 } })).toEqual({});
  });

  it.each([null, undefined, 42, 'x', [8, 76]])('returns an empty selection for %j', (raw) => {
    expect(sanitizeGuestSelection(raw)).toEqual({});
  });
});

describe('GUEST_PRICED_PROVIDERS', () => {
  it('lists only paid flatrate providers', () => {
    expect(GUEST_PRICED_PROVIDERS.length).toBeGreaterThan(0);
    for (const p of GUEST_PRICED_PROVIDERS) {
      expect(p.type).toBe('flatrate');
      expect(p.isFree || p.isAds).toBeFalsy();
      expect(p.defaultMonthlyCost ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('session storage round trip', () => {
  it('saves under the one key and loads it back', () => {
    saveGuestSelection({ 8: 'basic', 76: null });
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).not.toBeNull();
    expect(loadGuestSelection()).toEqual({ 8: 'basic', 76: null });
  });

  it('validates what it reads back', () => {
    window.sessionStorage.setItem(GUEST_PROVIDERS_KEY, JSON.stringify({ 8: 'gone', 76: 'standard', 520: null }));
    expect(loadGuestSelection()).toEqual({ 76: 'standard' });
  });

  it('returns empty on corrupt JSON', () => {
    window.sessionStorage.setItem(GUEST_PROVIDERS_KEY, '{nope');
    expect(loadGuestSelection()).toEqual({});
  });

  it('removes the key when the selection is empty, and on clear', () => {
    saveGuestSelection({ 8: null });
    saveGuestSelection({});
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).toBeNull();
    saveGuestSelection({ 8: null });
    clearGuestSelection();
    expect(window.sessionStorage.getItem(GUEST_PROVIDERS_KEY)).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const proto = Object.getPrototypeOf(window.sessionStorage) as Storage;
    vi.spyOn(proto, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(proto, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(proto, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(loadGuestSelection()).toEqual({});
    expect(() => saveGuestSelection({ 8: null })).not.toThrow();
    expect(() => clearGuestSelection()).not.toThrow();
  });
});
