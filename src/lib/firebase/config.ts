import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// App Check — bot-abuse-skydd. Körs bara i browser + när site-key satts.
// Debug-token (APP_CHECK_DEBUG_TOKEN) skapas automatiskt av SDK:n när
// globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN=true satts i dev-miljö.
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY &&
  getApps().length === 1
) {
  try {
    // Fail-closed: debug-token enablas bara om NEXT_PUBLIC_APP_ENV === 'development'.
    // Om variabeln glöms eller missformatteras i prod-build → debug är AV (säkert).
    if (process.env.NEXT_PUBLIC_APP_ENV === 'development') {
      // Firebase SDK kräver att debug-flaggan sätts INNAN initializeAppCheck.
      (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // HMR kan re-trigga — swallow det, annars skriv till DevTools.

    console.warn('[app-check] init skipped:', err);
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);

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
