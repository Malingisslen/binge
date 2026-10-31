import { describe, it, expect, vi, beforeEach } from 'vitest';

const DELETE = vi.hoisted(() => Symbol('fieldDelete'));
const h = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const snapOf = (path: string) => {
  const data = h.store.get(path);
  return { id: path.split('/').pop() as string, get: (f: string) => (data === undefined ? undefined : structuredClone(data[f])) };
};

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => DELETE },
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: [...h.store.entries()].filter(([, d]) => d[field] === value).map(([p]) => snapOf(p)),
        }),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const writes: Array<[string, Record<string, unknown>]> = [];
      await fn({
        get: async (ref: { path: string }) => snapOf(ref.path),
        update: (ref: { path: string }, patch: Record<string, unknown>) => { writes.push([ref.path, patch]); },
      });
      for (const [p, patch] of writes) {
        const cur = { ...(h.store.get(p) ?? {}) };
        for (const [k, v] of Object.entries(patch)) { if (v === DELETE) delete cur[k]; else cur[k] = v; }
        h.store.set(p, cur);
      }
    },
  }),
}));
vi.mock('firebase-functions/v2', () => ({ logger: h.logger }));

import { trimStaleQueue } from './trimQueue';
import { MAX_QUEUE_AGE_MS } from './logic';

const NOW = Date.parse('2026-10-31T07:00:00Z');
const entry = (episodeId: number, uids: string[], queuedAt: number) =>
  ({ episodeId, season: 1, episode: 2, airDate: '2026-10-20', uids, queuedAt });

beforeEach(() => { h.store.clear(); });

describe('trimStaleQueue', () => {
  it('drops entries older than the limit and keeps the episode marker', async () => {
    h.store.set('episodeNotifyState/1', {
      lastNotifiedEpisode: 11, hasPending: true, pending: [entry(11, ['gone'], NOW - MAX_QUEUE_AGE_MS - 1)],
    });
    expect(await trimStaleQueue(NOW)).toBe(1);
    expect(h.store.get('episodeNotifyState/1')).toEqual({ lastNotifiedEpisode: 11 });
  });

  it('keeps fresh entries and only removes the stale one on a mixed queue', async () => {
    const fresh = entry(12, ['keeper'], NOW - 1000);
    h.store.set('episodeNotifyState/2', {
      lastNotifiedEpisode: 12, hasPending: true, pending: [entry(11, ['gone'], NOW - MAX_QUEUE_AGE_MS - 1), fresh],
    });
    expect(await trimStaleQueue(NOW)).toBe(1);
    expect(h.store.get('episodeNotifyState/2')).toEqual({ lastNotifiedEpisode: 12, hasPending: true, pending: [fresh] });
  });

  it('leaves a fully fresh queue untouched', async () => {
    const doc = { lastNotifiedEpisode: 13, hasPending: true, pending: [entry(13, ['keeper'], NOW - 1000)] };
    h.store.set('episodeNotifyState/3', structuredClone(doc));
    expect(await trimStaleQueue(NOW)).toBe(0);
    expect(h.store.get('episodeNotifyState/3')).toEqual(doc);
  });
});
