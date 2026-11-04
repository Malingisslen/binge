import { describe, it, expect, vi } from 'vitest';

const where = vi.fn((...a: unknown[]) => ({ where: a }));
const query = vi.fn((...a: unknown[]) => ({ query: a }));
const getDocs = vi.fn();
vi.mock('./db', () => ({
  fsdb: async () => ({ db: 'DB', collection: (_d: unknown, n: string) => n, query, where, getDocs }),
  lazySubscribe: vi.fn(),
}));

import { listHostedSessions } from './sessions';

describe('listHostedSessions', () => {
  it('frågar sessions på hostUid och mappar dokumenten', async () => {
    getDocs.mockResolvedValue({
      docs: [{ id: 's1', data: () => ({ hostUid: 'u1', hostName: 'Malin', status: 'active', candidates: [] }) }],
    });
    const out = await listHostedSessions('u1');
    expect(where).toHaveBeenCalledWith('hostUid', '==', 'u1');
    expect(query.mock.calls[0][0]).toBe('sessions');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 's1', hostUid: 'u1', hostName: 'Malin' });
  });
});
