import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteDocMock: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));

// episodeProgress.ts hämtar firestore-fns via fsdb() (lazy-laddningen i ./db) —
// mocken returnerar den mockade firebase/firestore-modulen + dummy-db.
vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...path) => ({ _path: path.join('/') })),
  deleteDoc: (...args: unknown[]) => mocks.deleteDocMock(...args),
}));

import { clearEpisodeProgress } from './episodeProgress';

beforeEach(() => {
  mocks.deleteDocMock.mockClear();
});

describe('clearEpisodeProgress', () => {
  it('raderar episodeProgress-docen för titeln', async () => {
    await clearEpisodeProgress('user-1', 1438);
    expect(mocks.deleteDocMock).toHaveBeenCalledTimes(1);
    // BIN-560 Phase 4: episodeProgress is TV-only → namespaced doc id tv_1438.
    expect(mocks.deleteDocMock).toHaveBeenCalledWith({ _path: 'users/user-1/episodeProgress/tv_1438' });
  });
});
