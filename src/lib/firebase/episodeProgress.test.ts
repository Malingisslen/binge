import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteDocMock: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));

vi.mock('./config', () => ({ db: {} }));
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
    expect(mocks.deleteDocMock).toHaveBeenCalledWith({ _path: 'users/user-1/episodeProgress/1438' });
  });
});
