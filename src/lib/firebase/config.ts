import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// App Check init flyttades till src/lib/firebase/appCheck.ts + körs från
// Providers useEffect. Anledning: ReCaptchaV3Provider skapar en hidden
// placeholder-div via document.body.appendChild. Görs det på module-load
// (innan React 19 hydrerar body) så klubbar hydrationen bort divet och
// grecaptcha.render() failar med "placeholder element must be an element
// or id". useEffect körs efter hydration → divet överlever.

export const auth = getAuth(app);

// IndexedDB-cache: första onSnapshot-callbacken serveras momentant från disk
// (fromCache=true) och servern skickar bara deltan via resume-token. Det gör
// watchlist-rendering vid återbesök omedelbar OCH sänker debiterade reads
// (~160–200 per kallt besök utan cache). multipleTabManager så flera flikar
// delar samma cache utan lås-konflikt.
let firestoreDb: Firestore;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  // HMR i dev: initializeFirestore på en redan-initierad app kastar.
  // Återanvänd den befintliga instansen.
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;

// Emulator-koppling: aktiveras när NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true.
// Vi kopplar bara en gång per app-instans — getApps()-guarden ovan säkerställer
// att detta bara körs en gång per page load.
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true' &&
  getApps().length === 1
) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    console.info('[firebase] emulator mode — auth:9099, firestore:8080');
  } catch (err) {
    // Dubbel-initialisering (HMR i dev) → redan kopplad. Okej att svälja.

    console.warn('[firebase] emulator connect skipped:', err);
  }
}

export default app;
