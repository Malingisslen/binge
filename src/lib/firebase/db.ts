import app from './config';
import type { Firestore } from 'firebase/firestore';

// Lat Firestore-laddning: firebase/firestore (~109 KB gzip, 26 % av
// first-load) hålls utanför init-bundlen och hämtas via dynamic import först
// när något faktiskt rör databasen (inloggad användare, publik profil).
// Anonyma besökare på landningssidan betalar aldrig för SDK:n.
//
// Alla konsumenter går via fsdb() — `const { db, doc, getDoc } = await fsdb()`
// — istället för statiska imports från 'firebase/firestore' + module-level
// `db`. Det gör också signOut/deleteAccount-rensningen möjlig: terminate()
// + clearIndexedDbPersistence() kräver att nästa användning får en NY
// instans, vilket inte går med en module-level `export const db`.

type FirestoreModule = typeof import('firebase/firestore');
export type FirestoreKit = FirestoreModule & { db: Firestore };

let modPromise: Promise<FirestoreModule> | null = null;
let dbPromise: Promise<Firestore> | null = null;
let kitPromise: Promise<FirestoreKit> | null = null;

function loadFirestoreModule(): Promise<FirestoreModule> {
  if (!modPromise) modPromise = import('firebase/firestore');
  return modPromise;
}

async function initDb(): Promise<Firestore> {
  const mod = await loadFirestoreModule();

  // IndexedDB-cache: första onSnapshot-callbacken serveras momentant från disk
  // (fromCache=true) och servern skickar bara deltan via resume-token. Det gör
  // watchlist-rendering vid återbesök omedelbar OCH sänker debiterade reads
  // (~160–200 per kallt besök utan cache). multipleTabManager så flera flikar
  // delar samma cache utan lås-konflikt.
  let db: Firestore;
  try {
    db = mod.initializeFirestore(app, {
      localCache: mod.persistentLocalCache({ tabManager: mod.persistentMultipleTabManager() }),
    });
  } catch {
    // HMR i dev: initializeFirestore på en redan-initierad app kastar.
    // Återanvänd den befintliga instansen.
    db = mod.getFirestore(app);
  }

  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
    try {
      mod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      console.info('[firebase] emulator mode — firestore:8080');
    } catch (err) {
      // Dubbel-koppling (HMR-fallback ovan ger samma instans) → redan kopplad.
      console.warn('[firebase] emulator connect skipped:', err);
    }
  }

  return db;
}

export function getDb(): Promise<Firestore> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

export function fsdb(): Promise<FirestoreKit> {
  if (!kitPromise) {
    kitPromise = Promise.all([loadFirestoreModule(), getDb()]).then(([mod, db]) => ({ ...mod, db }));
  }
  return kitPromise;
}

// Behåller det synkrona subscribe-APIet (unsubscribe returneras direkt)
// trots lat SDK-laddning: lyssnaren kopplas när fsdb() resolvat, och en
// avregistrering före dess avbryter kopplingen istället. try/catch i
// unsubscribe för att instansen kan ha terminerats av signOut-rensningen.
export function lazySubscribe(attach: (kit: FirestoreKit) => () => void): () => void {
  let unsub: (() => void) | undefined;
  let cancelled = false;
  void fsdb().then(kit => {
    if (cancelled) return;
    unsub = attach(kit);
  });
  return () => {
    cancelled = true;
    try { unsub?.(); } catch { /* instansen terminerad */ }
  };
}

// GDPR-hygien på delad enhet: persistentLocalCache överlever signOut och
// deleteAccount, så föregående användares watchlist ligger kvar på disk.
// terminate() krävs innan clearIndexedDbPersistence() får anropas; därefter
// nollas promisarna så nästa getDb() skapar en fräsch instans mot en tom
// cache. Fel sväljs medvetet (failed-precondition när en annan flik håller
// persistensen aktiv) — en misslyckad rensning får aldrig blockera utloggning.
export async function clearFirestorePersistence(): Promise<void> {
  const mod = await loadFirestoreModule();
  const db = await getDb();
  dbPromise = null;
  kitPromise = null;
  try {
    await mod.terminate(db);
    await mod.clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('[firestore] persistence clear failed:', err);
  }
}
