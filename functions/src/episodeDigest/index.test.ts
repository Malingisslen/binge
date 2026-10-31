import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- a small in-memory Firestore -------------------------------------------------
const DELETE = vi.hoisted(() => Symbol('fieldDelete'));
const TS = vi.hoisted(() => ({ __serverTimestamp: true }));

type Doc = Record<string, unknown>;
const h = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>>(),
  /** Throw this error from create() for the given path. */
  createErrors: new Map<string, unknown>(),
  push: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function snapOf(path: string) {
  const data = h.store.get(path);
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
    get: (f: string) => (data === undefined ? undefined : structuredClone(data[f])),
  };
}

function refOf(path: string): Record<string, unknown> {
  return {
    path,
    id: path.split('/').pop(),
    collection: (name: string) => collOf(`${path}/${name}`),
    get: async () => snapOf(path),
    create: async (data: Doc) => {
      if (h.createErrors.has(path)) throw h.createErrors.get(path);
      if (h.store.has(path)) throw Object.assign(new Error('already exists'), { code: 6 });
      h.store.set(path, { ...data });
    },
  };
}

function collOf(path: string): Record<string, unknown> {
  return {
    doc: (id: string) => refOf(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => ({
      get: async () => ({
        docs: [...h.store.entries()]
          .filter(([p, d]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/') && d[field] === value)
          .map(([p]) => snapOf(p)),
      }),
    }),
  };
}

function applyUpdate(path: string, patch: Doc) {
  const cur = { ...(h.store.get(path) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === DELETE) delete cur[k];
    else cur[k] = v;
  }
  h.store.set(path, cur);
}

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => TS, delete: () => DELETE },
  getFirestore: () => ({
    collection: (name: string) => collOf(name),
    getAll: async (...refs: Array<{ path: string }>) => refs.map((r) => snapOf(r.path)),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const writes: Array<[string, Doc]> = [];
      await fn({
        get: async (ref: { path: string }) => snapOf(ref.path),
        update: (ref: { path: string }, patch: Doc) => { writes.push([ref.path, patch]); },
      });
      for (const [p, patch] of writes) applyUpdate(p, patch);
    },
  }),
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: () => Promise<void>) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: h.logger }));
vi.mock('../push', () => ({ sendPushToUser: h.push }));

import { episodeMorningDigest } from './index';
import { mediaTypeDocId } from '../shared/mediaTypeDocId';

// ---- fixtures ---------------------------------------------------------------------
// 07:00 UTC on 2026-10-31 is 08:00 in Stockholm (CET, DST ended 2026-10-25).
const NOW = new Date('2026-10-31T07:00:00Z');
const CARD = 'episode-digest-2026-10-31';

const notifPath = (uid: string) => `users/${uid}/notifications/${CARD}`;
const queuePath = (tmdbId: number) => `episodeNotifyState/${tmdbId}`;

function addUser(uid: string, settings?: Doc) {
  h.store.set(`users/${uid}`, settings ? { notificationSettings: settings } : {});
}
function follow(uid: string, tmdbId: number, over: Doc = {}) {
  h.store.set(`users/${uid}/watchlist/${mediaTypeDocId('tv', tmdbId)}`, {
    mediaType: 'tv', status: 'mina', title: tmdbId === 100 ? 'Alpha' : 'Beta',
    lastWatchedSeason: 1, lastWatchedEpisode: 1, ...over,
  });
}
function queue(tmdbId: number, uids: string[], over: Doc = {}) {
  h.store.set(queuePath(tmdbId), {
    hasPending: true,
    pending: [{ episodeId: tmdbId * 10, season: 1, episode: 2, airDate: '2026-10-30', uids, queuedAt: NOW.getTime() - 1000, ...over }],
  });
}
const pendingUids = (tmdbId: number) =>
  ((h.store.get(queuePath(tmdbId))?.pending ?? []) as Array<{ uids: string[] }>).flatMap((p) => p.uids);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.store.clear();
  h.createErrors.clear();
  h.push.mockReset();
  h.push.mockResolvedValue(undefined);
  Object.values(h.logger).forEach((f) => f.mockReset());
});
afterEach(() => { vi.useRealTimers(); });

const run = () => (episodeMorningDigest as unknown as () => Promise<void>)();

describe('episodeMorningDigest', () => {
  it('(1) writes one dated card and sends exactly one push per user, with the card and push saying the same thing', async () => {
    addUser('u1', { pushEnabled: true });
    addUser('u2');
    follow('u1', 100); follow('u1', 200);
    follow('u2', 100);
    queue(100, ['u1', 'u2']);
    queue(200, ['u1']);

    await run();

    expect(h.push).toHaveBeenCalledTimes(2);
    const byUid = new Map(h.push.mock.calls.map((c) => [c[0] as string, c]));
    expect([...byUid.keys()].sort()).toEqual(['u1', 'u2']);

    const card1 = h.store.get(notifPath('u1'))!;
    expect(card1).toMatchObject({
      kind: 'episode_digest',
      title: 'Igår kom 2 avsnitt du följer',
      summary: 'Alpha S01E02, Beta S01E02',
      actionUrl: '/my/igar/',
      read: false,
      createdAt: TS,
    });
    expect(card1.episodes).toEqual([
      { tmdbId: 100, title: 'Alpha', season: 1, episode: 2 },
      { tmdbId: 200, title: 'Beta', season: 1, episode: 2 },
    ]);
    expect(byUid.get('u1')![1]).toEqual({ title: card1.title, body: card1.summary, actionUrl: '/my/igar/', tag: 'episode-digest' });
    expect(byUid.get('u1')![2]).toEqual({ pushEnabled: true });

    expect(h.store.get(notifPath('u2'))).toMatchObject({ title: 'Igår kom ett avsnitt du följer', summary: 'Alpha S01E02' });
    expect(byUid.get('u2')![2]).toEqual({ pushEnabled: false });

    // Both users were told, so both queues are emptied.
    expect(h.store.get(queuePath(100))).toEqual({});
    expect(h.store.get(queuePath(200))).toEqual({});
  });

  it('(2) a rerun that hits ALREADY_EXISTS (code 6) sends no second push and keeps the first card', async () => {
    addUser('u1', { pushEnabled: true });
    follow('u1', 100);
    queue(100, ['u1']);

    await run();
    expect(h.push).toHaveBeenCalledTimes(1);
    const firstCard = h.store.get(notifPath('u1'));

    // Same day, the queue is back (e.g. the settle transaction failed on the first run).
    queue(100, ['u1']);
    await run();

    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.store.get(notifPath('u1'))).toBe(firstCard);
    expect(h.logger.error).not.toHaveBeenCalled();
    // The user counts as done on the rerun, so the queue is cleared again.
    expect(h.store.get(queuePath(100))).toEqual({});
  });

  it('(3) re-checks at send time: episodeReleases=false, a series no longer "mina" and an already seen episode get no card and no push', async () => {
    addUser('optedOut', { episodeReleases: false, pushEnabled: true });
    follow('optedOut', 100);
    addUser('dropped', { pushEnabled: true });
    follow('dropped', 100, { status: 'avbruten' });
    addUser('seen', { pushEnabled: true });
    follow('seen', 100, { lastWatchedSeason: 1, lastWatchedEpisode: 2 });
    addUser('seenLater', { pushEnabled: true });
    follow('seenLater', 100, { lastWatchedSeason: 2, lastWatchedEpisode: 1 });
    addUser('keeper', { pushEnabled: true });
    follow('keeper', 100);
    queue(100, ['optedOut', 'dropped', 'seen', 'seenLater', 'keeper']);

    await run();

    for (const uid of ['optedOut', 'dropped', 'seen', 'seenLater']) {
      expect(h.store.has(notifPath(uid)), uid).toBe(false);
    }
    expect(h.store.has(notifPath('keeper'))).toBe(true);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0][0]).toBe('keeper');
    // Skipped users are finished too: nobody is left on the queue.
    expect(h.store.get(queuePath(100))).toEqual({});
  });

  it('(4) the settle transaction removes only the uids that finished: a user whose dispatch threw stays queued', async () => {
    addUser('ok', { pushEnabled: true });
    follow('ok', 100);
    addUser('boom', { pushEnabled: true });
    follow('boom', 100);
    queue(100, ['ok', 'boom']);
    h.createErrors.set(notifPath('boom'), Object.assign(new Error('unavailable'), { code: 14 }));

    await run();

    expect(h.store.has(notifPath('ok'))).toBe(true);
    expect(h.store.has(notifPath('boom'))).toBe(false);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push.mock.calls[0][0]).toBe('ok');
    expect(h.store.get(queuePath(100))!.hasPending).toBe(true);
    expect(pendingUids(100)).toEqual(['boom']);
    expect(h.logger.error).toHaveBeenCalledWith('episodeMorningDigest: user boom failed', expect.any(Error));
  });

  it('(4b) an episode queued while the run was going is kept untouched', async () => {
    addUser('u1', { pushEnabled: true });
    follow('u1', 100);
    queue(100, ['u1']);
    // A second episode lands on the queue after the run read it (during the push).
    h.push.mockImplementationOnce(async () => {
      const cur = h.store.get(queuePath(100))!;
      (cur.pending as unknown[]).push({ episodeId: 999, season: 1, episode: 3, airDate: '2026-10-31', uids: ['u1'], queuedAt: NOW.getTime() });
    });

    await run();

    expect(h.store.get(queuePath(100))!.hasPending).toBe(true);
    expect(h.store.get(queuePath(100))!.pending).toEqual([
      { episodeId: 999, season: 1, episode: 3, airDate: '2026-10-31', uids: ['u1'], queuedAt: NOW.getTime() },
    ]);
  });

  it('(4c) a deleted account (no users/{uid}) gets no card and no push, and its uid leaves the queue, even with leftover watchlist rows', async () => {
    // A half-erased tree: the profile is gone but a watchlist row survived, so the
    // profile check alone is what keeps the run from writing under a deleted uid.
    follow('gone', 100);
    addUser('keeper', { pushEnabled: true });
    follow('keeper', 100);
    queue(100, ['gone', 'keeper']);

    await run();

    expect([...h.store.keys()].filter((p) => p.startsWith('users/gone/notifications/'))).toEqual([]);
    expect(h.push.mock.calls.map((c) => c[0])).toEqual(['keeper']);
    expect(pendingUids(100)).toEqual([]);
    expect(h.store.get(queuePath(100))).toEqual({});
  });

  it('(5) a push failure after the card was written does not make the user failed: card stays, queue is cleared, no error logged', async () => {
    addUser('u1', { pushEnabled: true });
    follow('u1', 100);
    queue(100, ['u1']);
    const pushErr = new Error('fcm down');
    h.push.mockRejectedValueOnce(pushErr);

    await run();

    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.store.has(notifPath('u1'))).toBe(true);
    expect(h.store.get(queuePath(100))).toEqual({});
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith('episodeMorningDigest: push to u1 failed after the card was written', pushErr);
    expect(h.logger.info).toHaveBeenCalledWith('episodeMorningDigest done', { shows: 1, users: 1, sent: 1, failed: 0 });
  });
});
