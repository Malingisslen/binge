import { describe, it, expect } from 'vitest';
import {
  isExpiredSession,
  isStaleNotification,
  isStaleJoinAttempt,
  isStaleReleaseMarker,
  tsToMillis,
  SESSION_MAX_AGE_MS,
  NOTIFICATION_MAX_AGE_MS,
  JOIN_ATTEMPT_MAX_AGE_MS,
  RELEASE_MARKER_MAX_AGE_MS,
} from './logic';

const now = 1_000_000_000_000; // fixed "now" for deterministic boundaries

describe('tsToMillis', () => {
  it('reads epoch ms from a Timestamp-like object (has toMillis)', () => {
    expect(tsToMillis({ toMillis: () => 1_700_000_000_000 })).toBe(1_700_000_000_000);
  });

  it('returns null for missing / legacy / non-timestamp shapes', () => {
    expect(tsToMillis(undefined)).toBe(null);
    expect(tsToMillis(null)).toBe(null);
    expect(tsToMillis(1_700_000_000_000)).toBe(null); // a raw number, not a Timestamp
    expect(tsToMillis('2026-01-01')).toBe(null);
    expect(tsToMillis({})).toBe(null);
  });

  it('returns null when toMillis yields a non-finite value', () => {
    expect(tsToMillis({ toMillis: () => NaN })).toBe(null);
    expect(tsToMillis({ toMillis: () => Infinity })).toBe(null);
  });
});

describe('isExpiredSession', () => {
  it('reaps when expiresAt is in the past', () => {
    expect(isExpiredSession(now - 1, null, now)).toBe(true);
  });

  it('keeps when expiresAt is still in the future', () => {
    expect(isExpiredSession(now + 1, null, now)).toBe(false);
    expect(isExpiredSession(now, null, now)).toBe(false); // exactly now is not yet past
  });

  it('expiresAt takes precedence over createdAt', () => {
    // Old createdAt but a future expiresAt → kept (the session was extended).
    expect(isExpiredSession(now + 1, now - 10 * SESSION_MAX_AGE_MS, now)).toBe(false);
  });

  it('legacy session (no expiresAt): reaps only past the 30-day age', () => {
    expect(isExpiredSession(null, now - SESSION_MAX_AGE_MS - 1, now)).toBe(true);
    expect(isExpiredSession(null, now - SESSION_MAX_AGE_MS, now)).toBe(false); // exact boundary = kept
    expect(isExpiredSession(null, now - SESSION_MAX_AGE_MS + 1, now)).toBe(false);
  });

  it('never reaps an undateable session (no expiresAt, no createdAt)', () => {
    expect(isExpiredSession(null, null, now)).toBe(false);
  });
});

describe('isStaleNotification', () => {
  it('reaps when older than 90 days', () => {
    expect(isStaleNotification(now - NOTIFICATION_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it('keeps when within 90 days (boundary inclusive of "exactly 90 days" = kept)', () => {
    expect(isStaleNotification(now - NOTIFICATION_MAX_AGE_MS + 1, now)).toBe(false);
    expect(isStaleNotification(now - NOTIFICATION_MAX_AGE_MS, now)).toBe(false);
    expect(isStaleNotification(now, now)).toBe(false);
  });

  it('never reaps an undateable notification (no createdAt)', () => {
    expect(isStaleNotification(null, now)).toBe(false);
  });
});

describe('isStaleJoinAttempt (BIN-329)', () => {
  it('reaps an orphan attempt older than 1 hour (spent plaintext token)', () => {
    expect(isStaleJoinAttempt(now - JOIN_ATTEMPT_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it('keeps a fresh attempt within the hour (boundary inclusive of "exactly 1h" = kept)', () => {
    expect(isStaleJoinAttempt(now - JOIN_ATTEMPT_MAX_AGE_MS + 1, now)).toBe(false);
    expect(isStaleJoinAttempt(now - JOIN_ATTEMPT_MAX_AGE_MS, now)).toBe(false);
    expect(isStaleJoinAttempt(now, now)).toBe(false);
  });

  it('never reaps an undateable attempt (no createdAt)', () => {
    expect(isStaleJoinAttempt(null, now)).toBe(false);
  });

  it('TTL is exactly one hour', () => {
    expect(JOIN_ATTEMPT_MAX_AGE_MS).toBe(60 * 60 * 1000);
  });
});

describe('isStaleReleaseMarker (BIN-464)', () => {
  it('reaps a marker older than 30 days (GDPR Art. 17 erasure + growth bound)', () => {
    expect(isStaleReleaseMarker(now - RELEASE_MARKER_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it('keeps a marker within 30 days (boundary inclusive of "exactly 30 days" = kept)', () => {
    expect(isStaleReleaseMarker(now - RELEASE_MARKER_MAX_AGE_MS + 1, now)).toBe(false);
    expect(isStaleReleaseMarker(now - RELEASE_MARKER_MAX_AGE_MS, now)).toBe(false);
    expect(isStaleReleaseMarker(now, now)).toBe(false);
  });

  it('never reaps an undateable marker (no updatedAt)', () => {
    expect(isStaleReleaseMarker(null, now)).toBe(false);
  });

  it('TTL comfortably exceeds the 3-day catch-up fire window so a live marker is never reaped', () => {
    const graceWindowMs = 3 * 24 * 60 * 60 * 1000;
    expect(RELEASE_MARKER_MAX_AGE_MS).toBeGreaterThan(graceWindowMs);
    expect(RELEASE_MARKER_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
