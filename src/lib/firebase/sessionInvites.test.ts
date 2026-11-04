// Bjud in till Tillsammans — the client writes. Mocked Firestore: this proves the shape of
// each call (path, payload, which document is read and deleted) and what is reported. It
// evaluates no rule; src/test/rules/session-invites.test.ts does that against the emulator.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Ref = { path: string };
const fs = vi.hoisted(() => ({
  setDoc: vi.fn(async (_ref: Ref, _data: unknown) => {}),
  deleteDoc: vi.fn(async (_ref: Ref) => {}),
  getDoc: vi.fn(async (_ref: Ref) => ({ exists: (): boolean => false, data: (): unknown => undefined })),
}));
const sentry = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('./db', () => ({
  fsdb: async () => ({
    db: {},
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    setDoc: fs.setDoc,
    deleteDoc: fs.deleteDoc,
    getDoc: fs.getDoc,
    serverTimestamp: () => 'SERVER_TS',
  }),
}));
vi.mock('@/lib/sentry', () => sentry);

import { openSessionInvite, sendSessionInvites } from './sessionInvites';
import { MAX_SESSION_INVITEES, type SessionInvite } from '@/lib/sessionInvites';

beforeEach(() => {
  vi.clearAllMocks();
  fs.setDoc.mockImplementation(async () => {});
  fs.deleteDoc.mockImplementation(async () => {});
});

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

describe('sendSessionInvites', () => {
  it('writes one invite per recipient into the recipient\'s tree, under {sessionId}_{fromUid}', async () => {
    const result = await sendSessionInvites({ sessionId: 'S1', fromUid: 'me', fromName: 'Malin', recipientUids: ['a', 'b'] });
    expect(fs.setDoc.mock.calls.map(c => c[0].path)).toEqual([
      'users/a/sessionInvites/S1_me',
      'users/b/sessionInvites/S1_me',
    ]);
    expect(fs.setDoc.mock.calls[0][1]).toEqual({ fromUid: 'me', fromName: 'Malin', sessionId: 'S1', createdAt: 'SERVER_TS' });
    expect(result).toEqual({ sent: ['a', 'b'], failed: [] });
  });

  it('never writes to the sender, a duplicate or past the cap', async () => {
    const many = ['me', 'a', 'a', ...Array.from({ length: MAX_SESSION_INVITEES + 3 }, (_, i) => `u${i}`)];
    await sendSessionInvites({ sessionId: 'S1', fromUid: 'me', fromName: null, recipientUids: many });
    const paths = fs.setDoc.mock.calls.map(c => c[0].path);
    expect(paths).toHaveLength(MAX_SESSION_INVITEES);
    expect(paths).not.toContain('users/me/sessionInvites/S1_me');
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('a refused recipient does not stop the others, and an expected refusal is not reported', async () => {
    fs.setDoc.mockImplementation(async (ref: Ref) => { if (ref.path.startsWith('users/b/')) throw denied(); });
    const result = await sendSessionInvites({ sessionId: 'S1', fromUid: 'me', fromName: null, recipientUids: ['a', 'b', 'c'] });
    expect(result).toEqual({ sent: ['a', 'c'], failed: ['b'] });
    expect(sentry.captureError).not.toHaveBeenCalled();
  });

  // The session id is an access key: an unexpected failure is reported by code only.
  it('reports an unexpected failure by its code, never with the path', async () => {
    fs.setDoc.mockImplementation(async () => { throw Object.assign(new Error('users/a/sessionInvites/S1_me unavailable'), { code: 'unavailable' }); });
    await sendSessionInvites({ sessionId: 'S1', fromUid: 'me', fromName: null, recipientUids: ['a'] });
    expect(sentry.captureError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sentry.captureError.mock.calls[0])).not.toContain('S1');
    expect(sentry.captureError.mock.calls[0][1]).toMatchObject({ extra: { codes: 'unavailable' } });
  });

  it('writes nothing when nobody is left to invite', async () => {
    await expect(sendSessionInvites({ sessionId: 'S1', fromUid: 'me', fromName: null, recipientUids: ['me'] }))
      .resolves.toEqual({ sent: [], failed: [] });
    expect(fs.setDoc).not.toHaveBeenCalled();
  });
});

describe('openSessionInvite', () => {
  const INVITE: SessionInvite = { id: 'S1_host', fromUid: 'host', fromName: null, sessionId: 'S1', createdAt: new Date() };
  const live = () => ({ exists: () => true, data: () => ({ expiresAt: { toMillis: () => Date.now() + 60_000 } }) });

  it('opens a live session and removes the invite', async () => {
    fs.getDoc.mockResolvedValueOnce(live());
    await expect(openSessionInvite('me', INVITE)).resolves.toEqual({ status: 'open', sessionId: 'S1' });
    expect(fs.getDoc.mock.calls[0][0].path).toBe('sessions/S1');
    expect(fs.deleteDoc.mock.calls[0][0].path).toBe('users/me/sessionInvites/S1_host');
  });

  it('answers gone for a missing session and removes the invite', async () => {
    fs.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(openSessionInvite('me', INVITE)).resolves.toEqual({ status: 'gone' });
    expect(fs.deleteDoc).toHaveBeenCalledTimes(1);
  });

  it('answers gone for a session past its expiry', async () => {
    fs.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ expiresAt: { toMillis: () => Date.now() - 1 } }) });
    await expect(openSessionInvite('me', INVITE)).resolves.toEqual({ status: 'gone' });
  });

  it('still opens a live session when removing the invite fails, and reports it without the path', async () => {
    fs.getDoc.mockResolvedValueOnce(live());
    fs.deleteDoc.mockRejectedValueOnce(Object.assign(new Error('users/me/sessionInvites/S1_host'), { code: 'unavailable' }));
    await expect(openSessionInvite('me', INVITE)).resolves.toEqual({ status: 'open', sessionId: 'S1' });
    expect(sentry.captureError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sentry.captureError.mock.calls[0])).not.toContain('S1');
  });

  it('throws when the session is gone and the invite could not be removed', async () => {
    fs.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    fs.deleteDoc.mockRejectedValueOnce(denied());
    await expect(openSessionInvite('me', INVITE)).rejects.toThrow('denied');
  });
});
