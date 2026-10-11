import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn();
const deleteDocMock = vi.fn();

vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...path: string[]) => ({ _path: path.join('/') }),
    setDoc: setDocMock,
    deleteDoc: deleteDocMock,
    serverTimestamp: () => 'SERVER_TS',
  }),
}));

import { sendTip, dismissTip } from './tips';

beforeEach(() => {
  setDocMock.mockReset();
  deleteDocMock.mockReset();
});

// firestore.rules lists exactly these keys; a renamed key here is refused for every tip in
// production while the rules tests, which build their own payload, stay green.
describe('sendTip', () => {
  it('writes exactly the fields the rules allow, at the recipient and the sender-keyed id', async () => {
    await sendTip('bea', { fromUid: 'anna', mediaType: 'movie', tmdbId: 603, title: 'The Matrix', note: 'Se den!' });
    const [ref, data] = setDocMock.mock.calls[0];
    expect(ref._path).toBe('users/bea/tips/anna_movie_603');
    expect(Object.keys(data).sort()).toEqual(['createdAt', 'fromUid', 'mediaType', 'note', 'title', 'tmdbId']);
    expect(data.createdAt).toBe('SERVER_TS');
    expect(data.fromUid).toBe('anna');
  });

  it('refuses to tip yourself without writing', async () => {
    await expect(sendTip('anna', { fromUid: 'anna', mediaType: 'tv', tmdbId: 1, title: 'X', note: '' })).rejects.toThrow();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('dismissTip', () => {
  it('deletes the tip from my own tree', async () => {
    await dismissTip('bea', 'anna_movie_603');
    expect(deleteDocMock.mock.calls[0][0]._path).toBe('users/bea/tips/anna_movie_603');
  });
});
