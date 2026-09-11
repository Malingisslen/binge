/**
 * BIN-1156: varje PRODUCENT av ett Tillsammans-namn drivs for sig.
 *
 * Varfor separata fall per producent: i BIN-1134 overlevde exakt en av tre
 * klampningar sviten, for att inget test nadde just den vagen. De tre vagarna
 * har ar createSession -> sessions/{id}.hostName, createSession ->
 * participants/{pid}.displayName, och joinSession -> participants/{pid}
 * .displayName pa BADA sina grenar (forstagangsintrade och aterintrade).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const addDocMock = vi.fn((coll: unknown, _data: unknown) =>
    Promise.resolve({ _path: `${(coll as { _path: string })._path}/sess-1`, id: 'sess-1' }));
  const setDocMock = vi.fn((..._args: unknown[]) => Promise.resolve());
  const getDocMock = vi.fn();
  const docMock = vi.fn((_db: unknown, ...path: string[]) => ({ _path: path.join('/') }));
  return { addDocMock, setDocMock, getDocMock, docMock };
});

vi.mock('./db', () => ({
  fsdb: async () => ({ ...(await import('firebase/firestore')), db: {} }),
  lazySubscribe: () => () => {},
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ _path: path.join('/') })),
  doc: (...args: unknown[]) => mocks.docMock(...(args as [unknown, ...string[]])),
  setDoc: (...args: unknown[]) => mocks.setDocMock(...(args as [unknown, ...unknown[]])),
  addDoc: (...args: unknown[]) => mocks.addDocMock(...(args as [unknown, unknown])),
  getDoc: (...args: unknown[]) => mocks.getDocMock(...args),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  deleteField: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  Timestamp: { fromDate: vi.fn((d: Date) => d) },
}));

const { addDocMock, setDocMock, getDocMock } = mocks;

import { createSession, joinSession } from './sessions';
import { MAX_SESSION_DISPLAY_NAME } from '@/lib/clampText';

// En over taket, sa varje producent maste kapa nagot for att passera.
const TOO_LONG = 'a'.repeat(MAX_SESSION_DISPLAY_NAME + 40);

function participantPayload() {
  const call = setDocMock.mock.calls.find(([ref]) =>
    (ref as { _path?: string })?._path?.includes('/participants/'));
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  addDocMock.mockClear();
  setDocMock.mockClear();
  getDocMock.mockReset();
});

describe('createSession klampar bada falten den matar (BIN-1156)', () => {
  it('sessions/{id}.hostName kapas — etiketten har inget tak i reglerna alls', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await createSession({
      hostUid: 'u1', hostName: TOO_LONG, hostProviders: [],
      config: {} as never,
    });
    const written = addDocMock.mock.calls[0][1] as { hostName: string };
    expect(written.hostName.length).toBe(MAX_SESSION_DISPLAY_NAME);
  });

  it('participants/{pid}.displayName kapas nar hostDisplayName saknas', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await createSession({
      hostUid: 'u1', hostName: TOO_LONG, hostProviders: [],
      config: {} as never,
    });
    expect((participantPayload()!.displayName as string).length).toBe(MAX_SESSION_DISPLAY_NAME);
  });

  it('participants/{pid}.displayName kapas aven nar hostDisplayName ar satt (grupp-startad session)', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await createSession({
      hostUid: 'u1', hostName: 'Filmklubben', hostDisplayName: TOO_LONG, hostProviders: [],
      config: {} as never,
    });
    expect((participantPayload()!.displayName as string).length).toBe(MAX_SESSION_DISPLAY_NAME);
  });
});

describe('joinSession klampar pa BADA grenarna (BIN-1156)', () => {
  it('forstagangsintrade', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await joinSession({ sessionId: 's1', participantId: 'p1', uid: null, displayName: TOO_LONG, providers: [] });
    const payload = setDocMock.mock.calls[0][1] as { displayName: string; vetoRemaining?: number };
    expect(payload.vetoRemaining).toBe(1);
    expect(payload.displayName.length).toBe(MAX_SESSION_DISPLAY_NAME);
  });

  it('aterintrade — samma plats, forbrukad veto, nytt langre namn', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ vetoRemaining: 0, isHost: false }),
    });
    await joinSession({ sessionId: 's1', participantId: 'p1', uid: 'u9', displayName: TOO_LONG, providers: [] });
    const payload = setDocMock.mock.calls[0][1] as { displayName: string; vetoRemaining?: number };
    // Aterintradet far inte bevapna om vetot (BIN-540) OCH namnet ska vara kapat.
    expect(payload.vetoRemaining).toBeUndefined();
    expect(payload.displayName.length).toBe(MAX_SESSION_DISPLAY_NAME);
  });
});

describe('klampningen klyver inte ett surrogatpar', () => {
  it('slapper det avslutande emojit i stallet for att lamna en ensam halva', async () => {
    // Ett emoji ar tva kodenheter. Snittet skulle annars landa mitt i paret.
    const name = 'x'.repeat(MAX_SESSION_DISPLAY_NAME - 1) + '\u{1F600}' + 'y';
    getDocMock.mockResolvedValue({ exists: () => false });
    await joinSession({ sessionId: 's1', participantId: 'p1', uid: null, displayName: name, providers: [] });
    const written = (setDocMock.mock.calls[0][1] as { displayName: string }).displayName;
    expect(written.length).toBe(MAX_SESSION_DISPLAY_NAME - 1);
    expect(written).toBe('x'.repeat(MAX_SESSION_DISPLAY_NAME - 1));
  });
});
