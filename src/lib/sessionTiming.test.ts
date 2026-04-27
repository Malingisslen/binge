import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isSessionExpired } from './sessionTiming';
import type { TogetherSession } from '@/types';

function makeSession(expiresAt: Date): TogetherSession {
  return {
    id: 'test-session',
    hostUid: 'uid-1',
    hostName: 'Test',
    groupId: null,
    config: {
      providerMode: 'intersect',
      aggregation: 'least_misery',
      mediaType: 'both',
      maxRuntimeMin: null,
      allowAsymmetry: false,
    },
    status: 'active',
    candidates: [],
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
    expiresAt,
  };
}

describe('isSessionExpired', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('returns false for null session', () => {
    expect(isSessionExpired(null)).toBe(false);
  });

  it('returns false for session that expires in the future', () => {
    const future = new Date('2026-05-01T12:00:00Z');
    expect(isSessionExpired(makeSession(future))).toBe(false);
  });

  it('returns true for session that expired 1 second ago', () => {
    const past = new Date('2026-04-24T11:59:59Z');
    expect(isSessionExpired(makeSession(past))).toBe(true);
  });

  it('returns true for session that expired long ago', () => {
    const past = new Date('2026-03-01T00:00:00Z');
    expect(isSessionExpired(makeSession(past))).toBe(true);
  });
});
