import { describe, it, expect } from 'vitest';
import { decideFollowPrompt, isAppleMobile, isFirstFollow } from './useFollowConfirmation.helpers';
import type { WatchlistItem } from '@/types';

const env = (over: Partial<Parameters<typeof decideFollowPrompt>[0]> = {}) => ({
  pushEnabled: false, pushSupported: true, permission: 'default' as NotificationPermission,
  appleMobile: false, standalone: false, ...over,
});

describe('decideFollowPrompt (BIN-1442)', () => {
  it('asks when the browser can still ask', () => {
    expect(decideFollowPrompt(env())).toBe('ask');
  });
  it('stays quiet when push is already on, granted or blocked', () => {
    expect(decideFollowPrompt(env({ pushEnabled: true }))).toBe('none');
    expect(decideFollowPrompt(env({ permission: 'granted' }))).toBe('none');
    expect(decideFollowPrompt(env({ permission: 'denied' }))).toBe('none');
  });
  it('gives the home-screen tip on iPhone Safari, where push needs a home-screen app', () => {
    expect(decideFollowPrompt(env({ pushSupported: false, permission: null, appleMobile: true }))).toBe('homescreen-tip');
  });
  it('gives no tip on a home-screen app or on other unsupported browsers', () => {
    expect(decideFollowPrompt(env({ pushSupported: false, permission: null, appleMobile: true, standalone: true }))).toBe('none');
    expect(decideFollowPrompt(env({ pushSupported: false, permission: null }))).toBe('none');
  });
});

describe('isAppleMobile', () => {
  it('knows iPhone, and iPad behind a desktop user agent', () => {
    expect(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isAppleMobile('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
  });
});

describe('isFirstFollow', () => {
  const followed = { mediaType: 'tv', status: 'mina' } as WatchlistItem;
  it('is the first followed series only', () => {
    expect(isFirstFollow([], 'tv', 'mina', false)).toBe(true);
    expect(isFirstFollow([{ mediaType: 'movie', status: 'vill_se' } as WatchlistItem], 'tv', 'mina', false)).toBe(true);
    expect(isFirstFollow([followed], 'tv', 'mina', false)).toBe(false);
  });
  it('is never a film, another status, or a title already in the library', () => {
    expect(isFirstFollow([], 'movie', 'vill_se', false)).toBe(false);
    expect(isFirstFollow([], 'tv', 'avbruten', false)).toBe(false);
    expect(isFirstFollow([], 'tv', 'mina', true)).toBe(false);
  });
});
