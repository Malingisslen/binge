import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  trim: vi.fn(),
  read: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}), FieldValue: {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: () => Promise<void>) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: h.logger }));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({}) }));
vi.mock('../episodeDigest/trimQueue', () => ({ trimStaleQueue: h.trim }));
vi.mock('../shared/followedSeries', () => ({ readFollowedSeries: h.read }));
vi.mock('./tmdb', () => ({ fetchTvAiringInfo: vi.fn() }));

import { episodeReleaseNotify } from './index';

const run = episodeReleaseNotify as unknown as () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T07:00:00Z'));
  h.order.length = 0;
  h.trim.mockReset().mockImplementation(async () => { h.order.push('trim'); return 0; });
  h.read.mockReset().mockImplementation(async () => { h.order.push('scan'); return []; });
  Object.values(h.logger).forEach((f) => f.mockReset());
});

afterEach(() => { vi.useRealTimers(); });

describe('episodeReleaseNotify queue trim', () => {
  it('trims the digest queue before it scans the watchlist', async () => {
    await run();
    expect(h.order).toEqual(['trim', 'scan']);
  });

  it('trims against the current time', async () => {
    await run();
    expect(h.trim).toHaveBeenCalledWith(Date.now());
  });

  it('trims even when the watchlist scan fails', async () => {
    h.read.mockRejectedValue(new Error('scan down'));
    await run();
    expect(h.trim).toHaveBeenCalledTimes(1);
  });

  it('still scans when the trim fails, and logs it', async () => {
    h.trim.mockRejectedValue(new Error('trim down'));
    await run();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledWith('episodeNotify: queue trim failed', expect.any(Error));
  });
});
