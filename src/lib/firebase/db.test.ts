import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.ts importerar app från ./config — mocka så firebase/app inte initieras
// med tomma env-värden i testmiljön.
vi.mock('./config', () => ({ default: {} }));

// Delat hoisted mock-objekt: vi.mock-factoryn kan köras om efter
// vi.resetModules(), men referenserna här är samma över alla omkörningar
// så assertions fungerar oavsett när modulen importerades.
const fsMocks = vi.hoisted(() => ({
  initializeFirestore: vi.fn<(app: unknown, settings?: unknown) => Record<string, never>>(() => ({})),
  getFirestore: vi.fn(() => ({}) as Record<string, never>),
  persistentLocalCache: vi.fn((opts: unknown) => ({ kind: 'persistentLocalCache', opts })),
  persistentMultipleTabManager: vi.fn(() => ({ kind: 'multiTabManager' })),
  connectFirestoreEmulator: vi.fn(),
  terminate: vi.fn(async () => {}),
  clearIndexedDbPersistence: vi.fn(async () => {}),
  doc: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => fsMocks);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('getDb', () => {
  it('initierar Firestore lat med persistentLocalCache + multipleTabManager och memoiserar instansen', async () => {
    const { getDb } = await import('./db');
    const a = await getDb();
    const b = await getDb();

    expect(a).toBe(b);
    expect(fsMocks.initializeFirestore).toHaveBeenCalledTimes(1);
    expect(fsMocks.persistentLocalCache).toHaveBeenCalledWith({
      tabManager: expect.objectContaining({ kind: 'multiTabManager' }),
    });
    expect(fsMocks.initializeFirestore.mock.calls[0][1]).toEqual({
      localCache: expect.objectContaining({ kind: 'persistentLocalCache' }),
    });
    // Ingen emulator-connect utan NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true.
    expect(fsMocks.connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it('faller tillbaka till getFirestore när initializeFirestore kastar (HMR i dev)', async () => {
    fsMocks.initializeFirestore.mockImplementationOnce(() => {
      throw new Error('Firestore has already been initialized');
    });
    const { getDb } = await import('./db');
    const db = await getDb();

    expect(fsMocks.getFirestore).toHaveBeenCalledTimes(1);
    expect(db).toBe(fsMocks.getFirestore.mock.results[0].value);
  });
});

describe('fsdb', () => {
  it('exponerar db + firestore-funktionerna i ett kit', async () => {
    const { fsdb, getDb } = await import('./db');
    const kit = await fsdb();

    expect(kit.db).toBe(await getDb());
    expect(kit.doc).toBe(fsMocks.doc);
    expect(kit.getDoc).toBe(fsMocks.getDoc);
  });
});

describe('clearFirestorePersistence', () => {
  it('terminerar instansen, rensar IndexedDB och låter nästa getDb skapa en NY instans', async () => {
    const { getDb, fsdb, clearFirestorePersistence } = await import('./db');
    const first = await getDb();

    await clearFirestorePersistence();

    expect(fsMocks.terminate).toHaveBeenCalledWith(first);
    expect(fsMocks.clearIndexedDbPersistence).toHaveBeenCalledWith(first);

    const second = await getDb();
    expect(second).not.toBe(first);
    expect(fsMocks.initializeFirestore).toHaveBeenCalledTimes(2);
    // fsdb-kitet ska också peka på den nya instansen, inte den terminerade.
    expect((await fsdb()).db).toBe(second);
  });

  it('sväljer fel (t.ex. failed-precondition från annan öppen flik) utan att kasta', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fsMocks.clearIndexedDbPersistence.mockRejectedValueOnce(
      Object.assign(new Error('persistence in use'), { code: 'failed-precondition' }),
    );
    const { getDb, clearFirestorePersistence } = await import('./db');
    await getDb();

    await expect(clearFirestorePersistence()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
