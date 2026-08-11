import { describe, it, expect, vi, beforeEach } from 'vitest';

// The localStorage pointer `binge:fcm:tokenId:{uid}` is NOT the registration — it is a
// doc id. Three things delete `users/{uid}/fcmTokens/{id}` without touching it: FCM's
// self-heal on an unregistered token, BIN-848's sweep, and a sign-out whose delete lands
// after the page is gone. Reading the pointer alone therefore renders the Settings box
// ticked over a device that receives nothing — the BIN-844 lie one door further in.
//
// The direction is the whole design. This may only answer `false` on an explicit server
// "that doc is not there". Offline, cache-only and thrown reads keep the optimistic
// answer, because the opposite trades a box that lies one way for a box that lies the
// other — and THAT one makes people re-tick push on a device that already works, leaving
// a second orphan token doc. Binding condition from #19 Customer Support.

/** Only the two dimensions hasLivePushToken reads off a snapshot. */
type Snap = { exists: () => boolean; metadata: { fromCache: boolean } };

const mocks = vi.hoisted(() => ({
  getDocMock: vi.fn(
    async (...args: unknown[]): Promise<{ exists: () => boolean; metadata: { fromCache: boolean } }> => {
      void args;
      return { exists: () => true, metadata: { fromCache: false } };
    },
  ),
}));

vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...path: string[]) => ({ _path: path.join('/') })),
  getDoc: (...args: unknown[]) => mocks.getDocMock(...args),
}));

import { hasLivePushToken, hasLocalPushToken } from './messaging';

const KEY = 'binge:fcm:tokenId:u1';

/** A getDoc result, in the two dimensions that decide the answer. */
const snap = (exists: boolean, fromCache: boolean) => async (): Promise<Snap> => ({
  exists: () => exists,
  metadata: { fromCache },
});

beforeEach(() => {
  window.localStorage.clear();
  mocks.getDocMock.mockClear();
  mocks.getDocMock.mockImplementation(snap(true, false));
});

describe('hasLivePushToken — only the server may un-tick the box', () => {
  it('is true when the pointer names a doc that exists', async () => {
    window.localStorage.setItem(KEY, 'tok-1');
    expect(await hasLivePushToken('u1')).toBe(true);
    expect(mocks.getDocMock).toHaveBeenCalledWith({ _path: 'users/u1/fcmTokens/tok-1' });
  });

  it('is false — and drops the stale pointer — when the SERVER says the doc is gone', async () => {
    window.localStorage.setItem(KEY, 'tok-1');
    mocks.getDocMock.mockImplementation(snap(false, false));

    expect(await hasLivePushToken('u1')).toBe(false);
    // Self-heal: a pointer proven to outlive its doc is worthless, and keeping it
    // would make every later call pay for the same read.
    expect(hasLocalPushToken('u1')).toBe(false);
  });

  it('stays true when the "missing" answer came from the local cache', async () => {
    // An offline session has never seen this doc. Trusting absence here would report
    // every live registration on the device as gone.
    window.localStorage.setItem(KEY, 'tok-1');
    mocks.getDocMock.mockImplementation(snap(false, true));

    expect(await hasLivePushToken('u1')).toBe(true);
    expect(hasLocalPushToken('u1')).toBe(true);
  });

  it('stays true when the read throws — could not check is not gone', async () => {
    window.localStorage.setItem(KEY, 'tok-1');
    mocks.getDocMock.mockImplementation(async () => { throw new Error('offline'); });

    expect(await hasLivePushToken('u1')).toBe(true);
    expect(hasLocalPushToken('u1')).toBe(true);
  });

  it('is false without reading anything when there is no pointer', async () => {
    expect(await hasLivePushToken('u1')).toBe(false);
    expect(mocks.getDocMock).not.toHaveBeenCalled();
  });

  it('asks about THIS account only', async () => {
    window.localStorage.setItem('binge:fcm:tokenId:u2', 'tok-other');
    expect(await hasLivePushToken('u1')).toBe(false);
    expect(mocks.getDocMock).not.toHaveBeenCalled();
  });

  it('a cache-only answer never clears a pointer a later online read could confirm', async () => {
    // The sequence that matters: offline visit, then a real one. If the offline pass
    // had dropped the pointer, the second pass has nothing left to check and the
    // working registration is unreachable from the toggle.
    window.localStorage.setItem(KEY, 'tok-1');
    mocks.getDocMock.mockImplementation(snap(false, true));
    expect(await hasLivePushToken('u1')).toBe(true);

    mocks.getDocMock.mockImplementation(snap(true, false));
    expect(await hasLivePushToken('u1')).toBe(true);
    expect(hasLocalPushToken('u1')).toBe(true);
  });
});
