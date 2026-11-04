// BIN-1490: ångra veto skriver rösten 'no' före uppräkningen av vetot, och
// räknar inte upp vetot om röstskrivningen fallerar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: Array<{ op: string; path: string; data: unknown }> = [];
  const setDocMock = vi.fn((ref: { _path: string }, data: unknown) => {
    calls.push({ op: 'set', path: ref._path, data });
    return Promise.resolve();
  });
  const updateDocMock = vi.fn((ref: { _path: string }, data: unknown) => {
    calls.push({ op: 'update', path: ref._path, data });
    return Promise.resolve();
  });
  return { calls, setDocMock, updateDocMock };
});

vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
  lazySubscribe: () => () => {},
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
  setDoc: (ref: { _path: string }, data: unknown) => mocks.setDocMock(ref, data),
  updateDoc: (ref: { _path: string }, data: unknown) => mocks.updateDocMock(ref, data),
  serverTimestamp: () => 'TS',
}));

import { undoVeto } from './sessions';

const params = { sessionId: 's1', participantId: 'u1', tmdbId: 42, mediaType: 'movie' as const };

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.setDocMock.mockClear();
});

describe('undoVeto', () => {
  it('skriver rösten nej och räknar sedan upp vetot till 1', async () => {
    await undoVeto(params);
    expect(mocks.calls[0]).toEqual({
      op: 'set', path: 'sessions/s1/swipes/movie_42', data: { votes: { u1: 'no' }, updatedAt: 'TS' },
    });
    const last = mocks.calls[mocks.calls.length - 1];
    expect(last).toEqual({
      op: 'update', path: 'sessions/s1/participants/u1', data: { vetoRemaining: 1, lastActiveAt: 'TS' },
    });
  });

  it('räknar inte upp vetot när rösten inte kunde sparas', async () => {
    mocks.setDocMock.mockRejectedValueOnce(new Error('offline'));
    await expect(undoVeto(params)).rejects.toThrow('offline');
    expect(mocks.calls.some(c => (c.data as { vetoRemaining?: number }).vetoRemaining === 1)).toBe(false);
  });
});
