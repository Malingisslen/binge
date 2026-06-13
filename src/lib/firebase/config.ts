import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

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

// Firestore bor INTE här längre — den initieras lat i ./db.ts (getDb/fsdb)
// via dynamic import, så firebase/firestore (~109 KB gzip) hålls utanför
// first-load-bundlen för anonyma besökare. Emulator-kopplingen för Firestore
// följde med dit; här kopplas bara Auth.
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true' &&
  getApps().length === 1
) {
  try {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

    console.info('[firebase] emulator mode — auth:9099');
  } catch (err) {
    // Dubbel-initialisering (HMR i dev) → redan kopplad. Okej att svälja.

    console.warn('[firebase] emulator connect skipped:', err);
  }
}

export default app;
