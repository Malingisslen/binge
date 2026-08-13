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
  revokedUidsFromLookup,
  chunkUids,
  GET_USERS_BATCH,
  revokedUidsInBatches,
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

// BIN-848. This is the only sweep in retentionCleanup whose false positive
// destroys something a LIVE account is using — a working push registration — so
// the buckets are pinned individually rather than as one "revoked" blob.
describe('revokedUidsFromLookup (BIN-848)', () => {
  it('takes a uid Auth does not know — read from notFound, not from absence', () => {
    expect(revokedUidsFromLookup({ users: [], notFound: [{ uid: 'gone' }] })).toEqual(['gone']);
  });

  it('takes a disabled account, which Auth RETURNS in users', () => {
    // The trap: a disabled account is present in `users`, not in `notFound`.
    // Inferring "gone" from absence would miss it entirely.
    expect(revokedUidsFromLookup({
      users: [{ uid: 'barred', disabled: true }],
      notFound: [],
    })).toEqual(['barred']);
  });

  it('leaves a live account alone', () => {
    expect(revokedUidsFromLookup({
      users: [{ uid: 'alive', disabled: false }],
      notFound: [],
    })).toEqual([]);
  });

  it('treats a missing disabled flag as live, never as revoked', () => {
    expect(revokedUidsFromLookup({ users: [{ uid: 'alive' }], notFound: [] })).toEqual([]);
  });

  it('never infers a deletion from absence in users', () => {
    // A uid asked for but returned in neither list. Whatever that means, it is
    // not a licence to delete — only the explicit notFound list is.
    expect(revokedUidsFromLookup({ users: [], notFound: [] })).toEqual([]);
  });

  it('skips a notFound entry that is not a uid lookup', () => {
    // The SDK's notFound is a union covering email/phone lookups too. We only
    // ever ask by uid, so anything else is unexpected and must not be guessed at.
    expect(revokedUidsFromLookup({
      users: [],
      notFound: [{ email: 'x@example.com' }, { uid: 'gone' }],
    })).toEqual(['gone']);
  });

  it('collects both buckets in one response', () => {
    const out = revokedUidsFromLookup({
      users: [{ uid: 'alive', disabled: false }, { uid: 'barred', disabled: true }],
      notFound: [{ uid: 'gone' }],
    });
    expect(out.sort()).toEqual(['barred', 'gone']);
  });
});

describe('chunkUids (BIN-848)', () => {
  it('never exceeds the Admin SDK cap of 100 per call', () => {
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const chunks = chunkUids(uids);
    expect(chunks.every(c => c.length <= GET_USERS_BATCH)).toBe(true);
    expect(chunks.map(c => c.length)).toEqual([100, 100, 50]);
  });

  it('loses no uid across the split', () => {
    const uids = Array.from({ length: 205 }, (_, i) => `u${i}`);
    expect(chunkUids(uids).flat()).toEqual(uids);
  });

  it('returns nothing for an empty input', () => {
    expect(chunkUids([])).toEqual([]);
  });
});

describe('revokedUidsInBatches (BIN-848)', () => {
  const alive = (uid: string) => ({ uid, disabled: false });

  it('splits the lookup at the SDK cap and loses no uid', async () => {
    const seen: string[][] = [];
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    await revokedUidsInBatches(uids, async (batch) => {
      seen.push(batch);
      return { users: batch.map(alive), notFound: [] };
    });
    expect(seen.map(b => b.length)).toEqual([100, 100, 50]);
    expect(seen.flat()).toEqual(uids);
  });

  it('a batch that throws skips ONLY itself — the others still revoke', async () => {
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    let call = 0;
    const { revoked, skippedBatches } = await revokedUidsInBatches(uids, async (batch) => {
      call += 1;
      if (call === 2) throw new Error('auth outage');
      return { users: batch.map(alive), notFound: [{ uid: batch[0] }] };
    });
    // Batch 1 and 3 each named their first uid as gone; batch 2 named nobody.
    expect(revoked).toEqual(['u0', 'u200']);
    expect(skippedBatches).toBe(1);
    expect(call).toBe(3);
  });

  it('a batch that throws contributes NO uid — not even a partial one', async () => {
    const { revoked, skippedBatches } = await revokedUidsInBatches(['a', 'b'], async () => {
      throw new Error('quota');
    });
    expect(revoked).toEqual([]);
    expect(skippedBatches).toBe(1);
  });

  it('reports every failed batch so a total outage cannot read as a clean run', async () => {
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const { revoked, skippedBatches } = await revokedUidsInBatches(uids, async () => {
      throw new Error('down');
    });
    expect(revoked).toEqual([]);
    expect(skippedBatches).toBe(3);
  });

  it('hands the caller each failure with the batch size', async () => {
    const errors: number[] = [];
    await revokedUidsInBatches(['a', 'b', 'c'], async () => { throw new Error('x'); },
      (_err, size) => errors.push(size));
    expect(errors).toEqual([3]);
  });

  it('a reporting callback that throws does not abort the remaining batches', async () => {
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    let call = 0;
    const { revoked, skippedBatches } = await revokedUidsInBatches(
      uids,
      async (batch) => {
        call += 1;
        if (call === 1) throw new Error('auth outage');
        return { users: batch.map(alive), notFound: [{ uid: batch[0] }] };
      },
      () => { throw new Error('logger blew up'); },
    );
    // Batch 1 failed and its logger failed too; batches 2 and 3 still ran.
    expect(revoked).toEqual(['u100', 'u200']);
    expect(skippedBatches).toBe(1);
    expect(call).toBe(3);
  });

  it('an all-live lookup revokes nobody and skips nothing', async () => {
    const { revoked, skippedBatches } = await revokedUidsInBatches(['a', 'b'],
      async (batch) => ({ users: batch.map(alive), notFound: [] }));
    expect(revoked).toEqual([]);
    expect(skippedBatches).toBe(0);
  });

  it('never calls the lookup for an empty uid list', async () => {
    let calls = 0;
    const out = await revokedUidsInBatches([], async () => { calls += 1; return { users: [], notFound: [] }; });
    expect(calls).toBe(0);
    expect(out).toEqual({ revoked: [], skippedBatches: 0 });
  });

  // BIN-875 added the optional `extract`. Every fixture above uses live or
  // not-found accounts, under which the two extractors agree — so swapping the
  // DEFAULT to the narrower one left this whole suite green and would silently
  // have ended BIN-848's disabled-account coverage (test review, 2026-08-13).
  it('defaults to revokedUidsFromLookup — a DISABLED account is still revoked', async () => {
    const { revoked } = await revokedUidsInBatches(['sus'],
      async () => ({ users: [{ uid: 'sus', disabled: true }], notFound: [] }));

    // This is the default's whole job, and the only assertion in the file that
    // can tell the two extractors apart.
    expect(revoked).toEqual(['sus']);
  });

  it('uses the supplied extract instead of the default when one is given', async () => {
    // The username sweep passes `absentUidsFromLookup`, which deliberately does
    // NOT treat `disabled` as absent: a suspended account still exists and still
    // owns its handle. Without this, the parameter could be ignored entirely and
    // nothing here would notice.
    const { revoked } = await revokedUidsInBatches(
      ['sus'],
      async () => ({ users: [{ uid: 'sus', disabled: true }], notFound: [] }),
      undefined,
      (result) => result.notFound.map((n) => (n as { uid: string }).uid),
    );

    expect(revoked).toEqual([]);
  });
});
